from flask import Flask, render_template, jsonify, request, send_file, redirect
from database import get_db_connection, init_database, get_synthetic_datasets, list_real_tickers, list_all_tickers, list_chart_tickers
from datetime import datetime, timedelta, timezone
import alpaca_trade_api as tradeapi
import time
import os
import pandas as pd
import json
import re
import importlib
from typing import Optional
from typing import Any, Dict, List, Tuple
try:
    import pandas_ta as ta
except ImportError:
    ta = None
import math
from utils import calculate_vwap_per_trading_day, get_market_hours_info, get_market_open_times
from strategies import (
    compute_vwap_ema_crossover_signals,
    compute_fools_paradise_signals,
    STRATEGY_REGISTRY,
    build_regular_mask,
    normalize_signals,
)
from backtesting import run_backtest, RiskRewardExecutionModel
from candlestick_analysis import compute_candlestick_bias, count_pattern_instances
from replay.session import ReplaySession, ReplaySessionConfig
from synthetic_generators import get_generator, write_synthetic_series_to_db

# Optional imports for predictive analytics - won't break app if not installed
try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False
    np = None

try:
    import scipy
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False
    scipy = None

try:
    import statsmodels.api as sm
    STATSMODELS_AVAILABLE = True
except ImportError:
    STATSMODELS_AVAILABLE = False
    sm = None

app = Flask(__name__)

# Initialize database on startup
init_database()

VALID_SYNTH_TIMEFRAMES = {"1m", "5m", "15m"}
SYNTH_DEFAULT_LIMIT = 1000
SYNTH_MAX_LIMIT = 5000

# In-memory replay sessions (v1). Persist logs to SQLite; sessions are ephemeral.
_REPLAY_SESSIONS: Dict[str, ReplaySession] = {}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STRATEGIES_DIR = os.path.join(BASE_DIR, 'strategies')


_STRAT_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,50}$")


def _is_valid_strategy_name(name: str) -> bool:
    try:
        nm = (name or "").strip()
        if not nm:
            return False
        if "/" in nm or "\\" in nm or ".." in nm:
            return False
        return bool(_STRAT_NAME_RE.match(nm))
    except Exception:
        return False


def _strategy_file_path(name: str) -> str:
    return os.path.join(STRATEGIES_DIR, f"{name}.py")


def _ensure_strategy_registered_in_init(strategy_name: str, compute_fn_name: str) -> None:
    """
    Best-effort persistence: patch `strategies/__init__.py` to import + export the new strategy and
    add it to STRATEGY_REGISTRY. Keeps existing file structure intact.
    """
    init_path = os.path.join(STRATEGIES_DIR, "__init__.py")
    if not os.path.exists(init_path):
        return
    try:
        with open(init_path, "r", encoding="utf-8") as f:
            src = f.read()
    except Exception:
        return

    # Skip if already present
    if f"'{strategy_name}'" in src or f"strategies.{strategy_name}" in src:
        return

    lines = src.splitlines(True)

    # Insert import after existing strategy compute imports.
    import_line = f"from strategies.{strategy_name} import {compute_fn_name}\n"
    insert_at = 0
    for i, ln in enumerate(lines):
        if ln.startswith("from strategies.") and " import compute_" in ln and ".utils" not in ln and ".contracts" not in ln:
            insert_at = i + 1
    lines.insert(insert_at, import_line)

    # Insert into __all__ before clean_series (keeps grouping)
    try:
        for i, ln in enumerate(lines):
            if ln.strip() == "'clean_series'," or ln.strip() == '"clean_series",':
                lines.insert(i, f"    '{compute_fn_name}',\n")
                break
    except Exception:
        pass

    # Insert into STRATEGY_REGISTRY dict before closing brace
    try:
        reg_start = None
        reg_end = None
        for i, ln in enumerate(lines):
            if "STRATEGY_REGISTRY" in ln and "{" in ln:
                reg_start = i
            if reg_start is not None and reg_end is None and ln.strip() == "}":
                reg_end = i
                break
        if reg_end is not None:
            # Ensure previous entry has trailing comma (avoid breaking dict syntax)
            j = reg_end - 1
            while j >= 0 and (lines[j].strip() == "" or lines[j].strip().startswith("#")):
                j -= 1
            if j >= 0:
                prev = lines[j].rstrip()
                if prev and not prev.endswith(",") and not prev.endswith("{"):
                    lines[j] = prev + ",\n"
            lines.insert(reg_end, f"    '{strategy_name}': {compute_fn_name},\n")
    except Exception:
        pass

    try:
        with open(init_path, "w", encoding="utf-8") as f:
            f.write("".join(lines))
    except Exception:
        return


def _get_replay_session(session_id: str) -> Optional[ReplaySession]:
    sid = (session_id or "").strip()
    if not sid:
        return None
    return _REPLAY_SESSIONS.get(sid)


def _bad_request(code: str, message: str, **extra):
    payload = {"error": {"code": code, "message": message}}
    if extra:
        payload["error"].update(extra)
    return jsonify(payload), 400


def _parse_iso_ts(value: str) -> Optional[str]:
    """Parse an ISO timestamp to UTC ISO string with Z, or return None on failure."""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)

    return parsed.isoformat().replace("+00:00", "Z")


def _parse_iso_to_epoch_ms(value: str) -> Optional[int]:
    """Parse an ISO timestamp into epoch ms (UTC). Returns None if parsing fails."""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)
    return int(parsed.timestamp() * 1000)


def _epoch_ms_to_iso_z(ms: int) -> str:
    """Convert epoch ms to compact ISO Z."""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _aggregate_ohlcv(
    rows: List[Tuple[int, float, float, float, float, float]],
    target_bar_s: int,
) -> Dict[str, List[float]]:
    """
    Aggregate base OHLCV rows (epoch_ms, o,h,l,c,v) into a larger bar size.
    Aligns buckets relative to the first timestamp for stability (same as demo chart).
    """
    if not rows:
        return {"t_ms": [], "o": [], "h": [], "l": [], "c": [], "v": []}

    tgt = int(target_bar_s)
    if tgt <= 0:
        raise ValueError("bar_s must be > 0")
    bucket_ms = tgt * 1000
    t0 = int(rows[0][0])

    out_t: List[int] = []
    out_o: List[float] = []
    out_h: List[float] = []
    out_l: List[float] = []
    out_c: List[float] = []
    out_v: List[float] = []

    cur_bucket: Optional[int] = None
    bo = 0.0
    bh = float("-inf")
    bl = float("inf")
    bc = 0.0
    bv = 0.0
    bt = 0

    def flush() -> None:
        nonlocal cur_bucket, bo, bh, bl, bc, bv, bt
        if cur_bucket is None:
            return
        out_t.append(bt)
        out_o.append(float(bo))
        out_h.append(float(bh))
        out_l.append(float(bl))
        out_c.append(float(bc))
        out_v.append(float(bv))

    for (t_ms, o, h, l, c, v) in rows:
        ti = int(t_ms)
        b = (ti - t0) // bucket_ms
        if cur_bucket is None:
            cur_bucket = int(b)
            bt = int(t0 + cur_bucket * bucket_ms)
            bo = float(o)
            bh = float(h)
            bl = float(l)
            bc = float(c)
            bv = float(v or 0.0)
            continue
        if int(b) != cur_bucket:
            flush()
            cur_bucket = int(b)
            bt = int(t0 + cur_bucket * bucket_ms)
            bo = float(o)
            bh = float(h)
            bl = float(l)
            bc = float(c)
            bv = float(v or 0.0)
            continue
        # same bucket
        bh = max(bh, float(h))
        bl = min(bl, float(l))
        bc = float(c)
        bv += float(v or 0.0)

    flush()
    return {"t_ms": out_t, "o": out_o, "h": out_h, "l": out_l, "c": out_c, "v": out_v}


def _fetch_stock_data_ohlcv(
    cursor,
    *,
    ticker: str,
    interval: str,
    start_iso: str | None = None,
    end_iso: str | None = None,
) -> List[Tuple[str, float, float, float, float, float]]:
    """
    Fetch OHLCV rows from `stock_data` as:
      (timestamp_iso, close, open, high, low, volume)

    Note:
    - In the current Alpaca-only setup, we expect 1-minute data to be stored as `interval='1Min'`.
    """
    if start_iso and end_iso:
        cursor.execute(
            """
            SELECT timestamp, price, open_price, high_price, low_price, volume
            FROM stock_data
            WHERE ticker = ?
              AND interval = ?
              AND timestamp >= ?
              AND timestamp <= ?
            ORDER BY timestamp ASC
            """,
            (ticker, interval, start_iso, end_iso),
        )
    else:
        cursor.execute(
            """
            SELECT timestamp, price, open_price, high_price, low_price, volume
            FROM stock_data
            WHERE ticker = ? AND interval = ?
            ORDER BY timestamp ASC
            """,
            (ticker, interval),
        )
    results = cursor.fetchall()
    out: List[Tuple[str, float, float, float, float, float]] = []
    for (ts, c, o, h, l, v) in results:
        out.append(
            (
                ts,
                float(c),
                float(o) if o is not None else float(c),
                float(h) if h is not None else float(c),
                float(l) if l is not None else float(c),
                float(v) if v is not None else 0.0,
            )
        )
    return out


@app.route("/window")
def api_window():
    """
    Chart contract endpoint (bandchart-style).
    Returns arrays: t_ms,o,h,l,c,v plus dataset_start/dataset_end and served start/end.
    """
    # NOTE:
    # - For real tickers we normalize to uppercase.
    # - For synthetic dataset "symbol" we allow mixed-case names, so we keep both the raw and an
    #   uppercased variant for case-insensitive lookup.
    symbol_raw = (request.args.get("symbol") or "").strip()
    symbol = symbol_raw.upper()
    if not symbol_raw:
        return _bad_request("missing_params", "symbol is required", fields=["symbol"])

    bar_s = request.args.get("bar_s", type=int) or 60
    # Alpaca-only mode: minimum bar size is 60 seconds.
    # Normalize to a multiple of 60 seconds to keep candle boundaries consistent.
    try:
        bar_s = int(bar_s)
    except Exception:
        bar_s = 60
    if bar_s < 60:
        bar_s = 60
    if bar_s % 60 != 0:
        bar_s = max(60, (bar_s // 60) * 60)

    max_bars = request.args.get("max_bars", type=int)
    limit_legacy = request.args.get("limit", type=int)
    eff_max_bars = max_bars if (max_bars and max_bars > 0) else (limit_legacy if (limit_legacy and limit_legacy > 0) else 5000)
    eff_max_bars = max(1, min(200_000, int(eff_max_bars)))

    start_q = (request.args.get("start") or "").strip()
    end_q = (request.args.get("end") or "").strip()

    # Optional selection hints (useful when symbol exists in both real + synthetic worlds).
    # - source=real|synthetic|auto (default auto)
    # - scenario/timeframe only apply to synthetic selection
    source = (request.args.get("source") or "auto").strip().lower()
    scenario_q = (request.args.get("scenario") or "").strip()
    timeframe_q = (request.args.get("timeframe") or "").strip()

    conn = get_db_connection()
    try:
        cur = conn.cursor()

        def respond_empty(dataset_start=None, dataset_end=None):
            return jsonify(
                {
                    "symbol": symbol,
                    "bar_s": int(bar_s),
                    "dataset_start": dataset_start,
                    "dataset_end": dataset_end,
                    "start": None,
                    "end": None,
                    "t_ms": [],
                    "o": [],
                    "h": [],
                    "l": [],
                    "c": [],
                    "v": [],
                    "truncated": False,
                }
            )

        # Auto-detect whether this symbol is present in real stock_data at 1Min.
        # If not, fall back to synthetic (bars_synth).
        use_real = True
        if source == "synthetic":
            use_real = False
        elif source == "real":
            use_real = True
        else:
            cur.execute(
                """
                SELECT 1
                FROM stock_data
                WHERE ticker = ? AND interval = '1Min'
                LIMIT 1
                """,
                (symbol,),
            )
            use_real = cur.fetchone() is not None

        if not use_real:
            # -------- Synthetic datasets (bars_synth) --------
            # Determine which (scenario,timeframe) group to use:
            # - If scenario/timeframe provided: use them.
            # - Else: pick the most recent group for this symbol (max ts_start).
            if scenario_q and not timeframe_q:
                # if only scenario provided, choose most recent timeframe within it
                cur.execute(
                    """
                    SELECT timeframe
                    FROM bars_synth
                    WHERE UPPER(symbol) = UPPER(?)
                      AND scenario = ?
                    ORDER BY ts_start DESC
                    LIMIT 1
                    """,
                    (symbol_raw, scenario_q),
                )
                r = cur.fetchone()
                timeframe_q = r[0] if r else ""

            if not scenario_q or not timeframe_q:
                cur.execute(
                    """
                    SELECT scenario, timeframe, MIN(ts_start) AS ts_min, MAX(ts_start) AS ts_max
                    FROM bars_synth
                    WHERE UPPER(symbol) = UPPER(?)
                    GROUP BY scenario, timeframe
                    ORDER BY ts_max DESC
                    LIMIT 1
                    """,
                    (symbol_raw,),
                )
                pick = cur.fetchone()
                if not pick:
                    return respond_empty()
                if not scenario_q:
                    scenario_q = pick[0] or ""
                if not timeframe_q:
                    timeframe_q = pick[1] or ""

            # Map timeframe to base duration.
            tf_to_s = {"1m": 60, "5m": 300, "15m": 900}
            base_bar_s = tf_to_s.get(timeframe_q, 60)

            if int(bar_s) < int(base_bar_s):
                bar_s = int(base_bar_s)

            # Dataset bounds
            cur.execute(
                """
                SELECT MIN(ts_start) AS min_ts, MAX(ts_start) AS max_ts
                FROM bars_synth
                WHERE UPPER(symbol) = UPPER(?)
                  AND scenario = ?
                  AND timeframe = ?
                """,
                (symbol_raw, scenario_q, timeframe_q),
            )
            row = cur.fetchone()
            if not row or not row[0] or not row[1]:
                return respond_empty()

            ds_start_ms = _parse_iso_to_epoch_ms(row[0])
            ds_end_ms = _parse_iso_to_epoch_ms(row[1])
            if ds_start_ms is None or ds_end_ms is None:
                return _bad_request("dataset_parse_error", "Could not parse synthetic dataset bounds timestamps from DB")

            dataset_start = _epoch_ms_to_iso_z(ds_start_ms)
            dataset_end = _epoch_ms_to_iso_z(ds_end_ms)

            # Window selection policy (same as real).
            default_span_ms = 60 * 60 * 1000
            start_ms = _parse_iso_to_epoch_ms(start_q) if start_q else None
            end_ms = _parse_iso_to_epoch_ms(end_q) if end_q else None
            if start_ms is None and end_ms is None:
                end_ms = ds_end_ms
                start_ms = max(ds_start_ms, end_ms - default_span_ms)
            elif start_ms is not None and end_ms is None:
                end_ms = ds_end_ms
            elif start_ms is None and end_ms is not None:
                start_ms = max(ds_start_ms, end_ms - default_span_ms)
            assert start_ms is not None and end_ms is not None
            if end_ms < start_ms:
                return _bad_request("invalid_range", "start must be <= end")
            start_ms = max(ds_start_ms, int(start_ms))
            end_ms = min(ds_end_ms, int(end_ms))

            start_sec = int(start_ms // 1000)
            end_sec = int(end_ms // 1000)
            cur.execute(
                """
                SELECT ts_start, open, high, low, close, COALESCE(volume, 0) AS v
                FROM bars_synth
                WHERE UPPER(symbol) = UPPER(?)
                  AND scenario = ?
                  AND timeframe = ?
                  AND strftime('%s', ts_start) >= ?
                  AND strftime('%s', ts_start) <= ?
                ORDER BY ts_start ASC
                """,
                (symbol_raw, scenario_q, timeframe_q, str(start_sec), str(end_sec)),
            )
            base_rows = cur.fetchall()
            parsed: List[Tuple[int, float, float, float, float, float]] = []
            for (ts, o, h, l, c, v) in base_rows:
                t_ms = _parse_iso_to_epoch_ms(ts)
                if t_ms is None:
                    continue
                parsed.append((t_ms, float(o), float(h), float(l), float(c), float(v or 0.0)))

            agg = _aggregate_ohlcv(parsed, int(bar_s))
            truncated = False
            if len(agg["t_ms"]) > eff_max_bars:
                truncated = True
                keep = eff_max_bars
                for k in ["t_ms", "o", "h", "l", "c", "v"]:
                    agg[k] = agg[k][-keep:]
                if agg["t_ms"]:
                    start_ms = int(agg["t_ms"][0])

            served_start = _epoch_ms_to_iso_z(int(start_ms)) if start_ms is not None else None
            served_end = _epoch_ms_to_iso_z(int(end_ms)) if end_ms is not None else None

            return jsonify(
                {
                    "symbol": symbol,
                    "bar_s": int(bar_s),
                    "dataset_start": dataset_start,
                    "dataset_end": dataset_end,
                    "start": served_start,
                    "end": served_end,
                    "t_ms": agg["t_ms"],
                    "o": agg["o"],
                    "h": agg["h"],
                    "l": agg["l"],
                    "c": agg["c"],
                    "v": agg["v"],
                    "truncated": truncated,
                    "max_bars": eff_max_bars,
                    "live_merged": False,
                    "source": "synthetic",
                    "scenario": scenario_q,
                    "timeframe": timeframe_q,
                }
            )

        # -------- Real datasets (stock_data) --------
        # Alpaca-only mode: base resolution is 1-minute.
        base_interval = "1Min"
        base_bar_s = 60

        # Never downsample below the stored base resolution (60s).
        if int(bar_s) < int(base_bar_s):
            bar_s = int(base_bar_s)

        # Find dataset bounds from the base store.
        cur.execute(
            """
            SELECT MIN(timestamp) AS min_ts, MAX(timestamp) AS max_ts
            FROM stock_data
            WHERE ticker = ? AND interval = ?
            """,
            (symbol, base_interval),
        )
        row = cur.fetchone()
        if not row or not row[0] or not row[1]:
            return respond_empty()

        ds_start_ms = _parse_iso_to_epoch_ms(row[0])
        ds_end_ms = _parse_iso_to_epoch_ms(row[1])
        if ds_start_ms is None or ds_end_ms is None:
            return _bad_request("dataset_parse_error", "Could not parse dataset bounds timestamps from DB")

        dataset_start = _epoch_ms_to_iso_z(ds_start_ms)
        dataset_end = _epoch_ms_to_iso_z(ds_end_ms)

        # Window selection policy:
        # - If start/end are missing: return last 1h ending at dataset_end (fast cold-load).
        # - If end is missing but start present: treat end as dataset_end (follow-latest).
        # - If start missing but end present: treat start as end-1h.
        default_span_ms = 60 * 60 * 1000
        start_ms = _parse_iso_to_epoch_ms(start_q) if start_q else None
        end_ms = _parse_iso_to_epoch_ms(end_q) if end_q else None

        if start_ms is None and end_ms is None:
            end_ms = ds_end_ms
            start_ms = max(ds_start_ms, end_ms - default_span_ms)
        elif start_ms is not None and end_ms is None:
            end_ms = ds_end_ms
        elif start_ms is None and end_ms is not None:
            start_ms = max(ds_start_ms, end_ms - default_span_ms)

        assert start_ms is not None and end_ms is not None
        if end_ms < start_ms:
            return _bad_request("invalid_range", "start must be <= end")

        # Clamp to dataset bounds.
        start_ms = max(ds_start_ms, int(start_ms))
        end_ms = min(ds_end_ms, int(end_ms))

        # Pull base bars in the requested window.
        start_sec = int(start_ms // 1000)
        end_sec = int(end_ms // 1000)
        cur.execute(
            """
            SELECT
                timestamp,
                COALESCE(open_price, price)  AS o,
                COALESCE(high_price, price)  AS h,
                COALESCE(low_price, price)   AS l,
                price                        AS c,
                COALESCE(volume, 0)          AS v
            FROM stock_data
            WHERE ticker = ?
              AND interval = ?
              AND strftime('%s', timestamp) >= ?
              AND strftime('%s', timestamp) <= ?
            ORDER BY timestamp ASC
            """,
            (symbol, base_interval, str(start_sec), str(end_sec)),
        )
        base_rows = cur.fetchall()

        parsed: List[Tuple[int, float, float, float, float, float]] = []
        for (ts, o, h, l, c, v) in base_rows:
            t_ms = _parse_iso_to_epoch_ms(ts)
            if t_ms is None:
                continue
            parsed.append((t_ms, float(o), float(h), float(l), float(c), float(v or 0.0)))

        # Aggregate to bar_s.
        agg = _aggregate_ohlcv(parsed, int(bar_s))
        t_ms_arr = agg["t_ms"]

        truncated = False
        if len(t_ms_arr) > eff_max_bars:
            truncated = True
            # Keep last max_bars (most relevant for chart) and adjust served start.
            keep = eff_max_bars
            for k in ["t_ms", "o", "h", "l", "c", "v"]:
                agg[k] = agg[k][-keep:]
            if agg["t_ms"]:
                start_ms = int(agg["t_ms"][0])

        served_start = _epoch_ms_to_iso_z(int(start_ms)) if start_ms is not None else None
        served_end = _epoch_ms_to_iso_z(int(end_ms)) if end_ms is not None else None

        # Build strategy signals for the aggregated window.
        # This ensures strategy markers appear when using /window (e.g. chart.html?mode=api).
        strategy_payload = {}
        try:
            df_strategy = pd.DataFrame({
                "open": agg["o"],
                "high": agg["h"],
                "low": agg["l"],
                "close": agg["c"],
                "volume": agg["v"]
            })
            df_strategy.index = pd.to_datetime(agg["t_ms"], unit="ms")
            
            # Use the same signal compute functions as get_ticker_data
            signals_vwap_ema_cross = compute_vwap_ema_crossover_signals(df_strategy, rth_mask=None)
            if signals_vwap_ema_cross:
                strategy_payload["vwap_ema_crossover_v1"] = normalize_signals(signals_vwap_ema_cross, df_strategy)
            
            signals_fools_paradise = compute_fools_paradise_signals(df_strategy, rth_mask=None)
            if signals_fools_paradise:
                strategy_payload["fools_paradise"] = normalize_signals(signals_fools_paradise, df_strategy)
        except Exception as e:
            # print(f"Strategy compute in /window failed: {e}")
            strategy_payload = {}

        return jsonify(
            {
                "symbol": symbol,
                "bar_s": int(bar_s),
                "dataset_start": dataset_start,
                "dataset_end": dataset_end,
                "start": served_start,
                "end": served_end,
                "t_ms": agg["t_ms"],
                "o": agg["o"],
                "h": agg["h"],
                "l": agg["l"],
                "c": agg["c"],
                "v": agg["v"],
                "truncated": truncated,
                "max_bars": eff_max_bars,
                "live_merged": False,
                "source": "real",
                "strategies": strategy_payload,
            }
        )
    finally:
        conn.close()


@app.route('/')
def index():
    """Main page showing grid of tickers with latest prices."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Pre-compute per-ticker date ranges (min/max timestamps) for the dashboard's real symbols.
    # The dashboard uses 1-minute data as the canonical "real" series (see list_chart_tickers()).
    per_ticker_range = {}
    try:
        cursor.execute(
            """
            SELECT ticker, MIN(timestamp) AS ts_min, MAX(timestamp) AS ts_max
            FROM stock_data
            WHERE interval = '1Min'
            GROUP BY ticker
            """
        )
        for (t, ts_min, ts_max) in cursor.fetchall():
            if not t:
                continue
            per_ticker_range[str(t).strip().upper()] = (ts_min, ts_max)
    except Exception:
        # If anything goes wrong, keep ranges empty and fall back to '-' in the UI.
        per_ticker_range = {}

    # Get latest price for each ticker
    tickers_data = []
    real_tickers = list_chart_tickers()
    for ticker in real_tickers:
        cursor.execute('''
            SELECT ticker, price, timestamp, interval
            FROM stock_data
            WHERE ticker = ?
            ORDER BY timestamp DESC
            LIMIT 1
        ''', (ticker,))
        
        result = cursor.fetchone()
        ts_min, ts_max = per_ticker_range.get(str(ticker).strip().upper(), (None, None))
        if result:
            tickers_data.append({
                'ticker': result[0],
                'price': result[1],
                'timestamp': result[2],
                'interval': result[3],
                'range_start': ts_min,
                'range_end': ts_max,
            })
        else:
            tickers_data.append({
                'ticker': ticker,
                'price': None,
                'timestamp': None,
                'interval': None,
                'range_start': ts_min,
                'range_end': ts_max,
            })
    
    # Get date range of imported data
    cursor.execute('''
        SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest, COUNT(*) as total_records
        FROM stock_data
    ''')
    
    date_range_result = cursor.fetchone()
    conn.close()
    
    # Format date range for display
    date_range = None
    if date_range_result and date_range_result[0]:
        try:
            earliest = datetime.fromisoformat(date_range_result[0].replace('Z', '+00:00'))
            latest = datetime.fromisoformat(date_range_result[1].replace('Z', '+00:00'))
            date_range = {
                'earliest': earliest.strftime('%Y-%m-%d %H:%M:%S UTC'),
                'latest': latest.strftime('%Y-%m-%d %H:%M:%S UTC'),
                'total_records': date_range_result[2]
            }
        except:
            # Fallback to raw values if parsing fails
            date_range = {
                'earliest': date_range_result[0],
                'latest': date_range_result[1],
                'total_records': date_range_result[2]
            }
    
    return render_template('index.html', tickers=tickers_data, date_range=date_range)


@app.route("/api/symbols")
def api_symbols():
    """List real symbols available in the SQLite DB (matches dashboard 'Real Symbols')."""
    syms = list_chart_tickers()
    # chart.html expects items shaped like {dataset,symbol}; we set dataset=symbol
    # so the single dropdown can show the symbols directly.
    return jsonify([{"dataset": s, "symbol": s} for s in syms])

@app.route("/api/synthetic_datasets")
def api_synthetic_datasets():
    """List available synthetic datasets (symbol/scenario/timeframe groups)."""
    datasets = get_synthetic_datasets()
    return jsonify(datasets)


@app.route("/api/synthetic_dataset", methods=["DELETE"])
def api_synthetic_dataset_delete():
    """Delete an entire synthetic dataset group (symbol + scenario + timeframe)."""
    symbol = (request.args.get("symbol") or "").strip()
    scenario = (request.args.get("scenario") or "").strip()
    timeframe = (request.args.get("timeframe") or "").strip()

    if not symbol or not scenario or not timeframe:
        return _bad_request(
            "missing_params",
            "symbol, scenario, and timeframe are required",
            fields=["symbol", "scenario", "timeframe"],
        )

    if timeframe not in VALID_SYNTH_TIMEFRAMES:
        return _bad_request(
            "invalid_timeframe",
            "timeframe is not allowed",
            allowed=sorted(VALID_SYNTH_TIMEFRAMES),
        )

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        # Delete bars for this dataset group; l2_state rows cascade delete via FK.
        cur.execute(
            """
            DELETE FROM bars
            WHERE data_source = 'synthetic'
              AND UPPER(symbol) = UPPER(?)
              AND scenario = ?
              AND timeframe = ?
            """,
            (symbol, scenario, timeframe),
        )
        deleted = cur.rowcount or 0
        conn.commit()
    finally:
        conn.close()

    return jsonify({"ok": True, "deleted_bars": int(deleted), "symbol": symbol, "scenario": scenario, "timeframe": timeframe})


@app.route("/api/synthetic_generate", methods=["POST"])
def api_synthetic_generate():
    """
    Generate a new synthetic dataset and persist it to SQLite (`bars` + `l2_state`).

    Notes:
    - This is an opt-in endpoint. The core app remains read-only for synthetic unless called explicitly.
    - Default generator is trend_regime_v2 (market hours + overnight gaps + diurnal volume).
    """
    body = request.get_json(silent=True) or {}

    dataset_name = str(body.get("dataset_name") or "").strip()
    if not dataset_name:
        return _bad_request("missing_params", "dataset_name is required", fields=["dataset_name"])

    generator_name = str(body.get("generator") or "trend_regime_v2").strip()
    try:
        gen = get_generator(generator_name)
    except KeyError:
        return _bad_request("invalid_generator", "unknown generator", generator=generator_name)

    timeframe = str(body.get("timeframe") or "1m").strip()
    if timeframe not in VALID_SYNTH_TIMEFRAMES:
        return _bad_request(
            "invalid_timeframe",
            "timeframe is not allowed",
            allowed=sorted(VALID_SYNTH_TIMEFRAMES),
        )

    # Optional "reference" symbol for calibration/labeling (stored on each bar).
    ref_symbol = body.get("ref_symbol")
    ref_symbol = str(ref_symbol).strip().upper() if ref_symbol else None

    # Horizon:
    # - Accept `trading_days` (preferred) or legacy `n_days`.
    # - Cap to a safe upper bound to avoid accidental multi-million-row inserts.
    raw_days = body.get("trading_days", body.get("n_days", 1))
    try:
        trading_days = int(raw_days)
    except Exception:
        return _bad_request("invalid_trading_days", "trading_days must be an integer", trading_days=raw_days)
    trading_days = max(1, min(1_000, trading_days))  # ~4 years of trading sessions max

    # Start date interpreted in America/New_York trading day terms.
    start_date = str(body.get("start_date") or "").strip()  # YYYY-MM-DD
    start_date_local = None
    if start_date:
        try:
            y, m, d = start_date.split("-")
            start_date_local = datetime(int(y), int(m), int(d)).date()
        except Exception:
            return _bad_request("invalid_start_date", "start_date must be YYYY-MM-DD", start_date=start_date)

    seed = body.get("seed")
    seed = int(seed) if seed is not None and str(seed).strip() != "" else None

    start_price = body.get("start_price")
    if start_price is None or str(start_price).strip() == "":
        # Convenience: if user picked a ref_symbol, default to its latest stored price.
        if ref_symbol:
            conn = get_db_connection()
            try:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT price
                    FROM stock_data
                    WHERE ticker = ? AND interval = '1Min'
                    ORDER BY timestamp DESC
                    LIMIT 1
                    """,
                    (ref_symbol,),
                )
                row = cur.fetchone()
            finally:
                conn.close()
            if row and row[0] is not None:
                start_price = float(row[0])
        if start_price is None:
            start_price = 100.0
    try:
        start_price_f = float(start_price)
    except Exception:
        return _bad_request("invalid_start_price", "start_price must be a number", start_price=start_price)
    if start_price_f <= 0:
        return _bad_request("invalid_start_price", "start_price must be > 0", start_price=start_price_f)

    # Optional advanced knobs. We keep this intentionally whitelisted.
    params_in = body.get("params") or {}
    if params_in is None or not isinstance(params_in, dict):
        return _bad_request("invalid_params", "params must be an object if provided")

    # Generate (v2 supports market hours, gaps, diurnal volume).
    try:
        if generator_name in ("trend_regime_v2", "trend_regime_v3"):
            from dataclasses import replace
            if generator_name == "trend_regime_v2":
                from synthetic_generators.trend_regime_v2 import DEFAULT_PARAMS as D, TrendRegimeV2Params

                regimes = {
                    "UP": {"drift": float(params_in.get("up_drift", D.regimes["UP"]["drift"])), "vol": float(params_in.get("up_vol", D.regimes["UP"]["vol"]))},
                    "DOWN": {"drift": float(params_in.get("down_drift", D.regimes["DOWN"]["drift"])), "vol": float(params_in.get("down_vol", D.regimes["DOWN"]["vol"]))},
                    "CHOP": {"drift": float(params_in.get("chop_drift", D.regimes["CHOP"]["drift"])), "vol": float(params_in.get("chop_vol", D.regimes["CHOP"]["vol"]))},
                }

                p: TrendRegimeV2Params = replace(
                    D,
                    regimes=regimes,
                    stay_prob=float(params_in.get("stay_prob", D.stay_prob)),
                    overnight_gap_sigma=float(params_in.get("overnight_gap_sigma", D.overnight_gap_sigma)),
                    overnight_gap_mu=float(params_in.get("overnight_gap_mu", D.overnight_gap_mu)),
                    diurnal_volume_strength=float(params_in.get("diurnal_volume_strength", D.diurnal_volume_strength)),
                    diurnal_vol_strength=float(params_in.get("diurnal_vol_strength", D.diurnal_vol_strength)),
                    base_volume=float(params_in.get("base_volume", D.base_volume)),
                    base_spread=float(params_in.get("base_spread", D.base_spread)),
                    spread_diurnal_strength=float(params_in.get("spread_diurnal_strength", D.spread_diurnal_strength)),
                    depth_scale=float(params_in.get("depth_scale", D.depth_scale)),
                )

                bars, l2 = gen(
                    dataset_name=dataset_name,
                    ref_symbol=ref_symbol,
                    start_price=start_price_f,
                    n_trading_days=trading_days,
                    timeframe=timeframe,
                    scenario=generator_name,
                    start_date_local=start_date_local,
                    seed=seed,
                    params=p,
                )
            else:
                from synthetic_generators.trend_regime_v3 import DEFAULT_PARAMS as D, TrendRegimeV3Params

                regimes = {
                    "UP": {"drift": float(params_in.get("up_drift", D.regimes["UP"]["drift"])), "vol": float(params_in.get("up_vol", D.regimes["UP"]["vol"]))},
                    "DOWN": {"drift": float(params_in.get("down_drift", D.regimes["DOWN"]["drift"])), "vol": float(params_in.get("down_vol", D.regimes["DOWN"]["vol"]))},
                    "CHOP": {"drift": float(params_in.get("chop_drift", D.regimes["CHOP"]["drift"])), "vol": float(params_in.get("chop_vol", D.regimes["CHOP"]["vol"]))},
                }

                p: TrendRegimeV3Params = replace(
                    D,
                    regimes=regimes,
                    stay_prob=float(params_in.get("stay_prob", D.stay_prob)),
                    overnight_gap_sigma=float(params_in.get("overnight_gap_sigma", D.overnight_gap_sigma)),
                    overnight_gap_mu=float(params_in.get("overnight_gap_mu", D.overnight_gap_mu)),
                    diurnal_volume_strength=float(params_in.get("diurnal_volume_strength", D.diurnal_volume_strength)),
                    diurnal_vol_strength=float(params_in.get("diurnal_vol_strength", D.diurnal_vol_strength)),
                    base_volume=float(params_in.get("base_volume", D.base_volume)),
                    base_spread=float(params_in.get("base_spread", D.base_spread)),
                    spread_diurnal_strength=float(params_in.get("spread_diurnal_strength", D.spread_diurnal_strength)),
                    depth_scale=float(params_in.get("depth_scale", D.depth_scale)),
                    daily_vol_sigma=float(params_in.get("daily_vol_sigma", D.daily_vol_sigma)),
                    daily_vol_rho=float(params_in.get("daily_vol_rho", D.daily_vol_rho)),
                    daily_vol_mu=float(params_in.get("daily_vol_mu", D.daily_vol_mu)),
                    event_prob=float(params_in.get("event_prob", D.event_prob)),
                    event_sigma=float(params_in.get("event_sigma", D.event_sigma)),
                    vol_ret_coupling=float(params_in.get("vol_ret_coupling", D.vol_ret_coupling)),
                )

                bars, l2 = gen(
                    dataset_name=dataset_name,
                    ref_symbol=ref_symbol,
                    start_price=start_price_f,
                    n_trading_days=trading_days,
                    timeframe=timeframe,
                    scenario=generator_name,
                    start_date_local=start_date_local,
                    seed=seed,
                    params=p,
                )
        else:
            # Legacy generators: best-effort mapping.
            # NOTE: these do not implement market-hours/overnight-gap semantics.
            n_bars = int(body.get("n_bars") or 500)
            n_bars = max(1, min(200_000, n_bars))
            bars, l2 = gen(
                symbol=dataset_name,
                start_price=start_price_f,
                n_bars=n_bars,
                timeframe=timeframe,
                duration_sec={"1m": 60, "5m": 300, "15m": 900}[timeframe],
                scenario=generator_name,
                seed=seed,
            )
    except Exception as e:
        return _bad_request("generation_failed", str(e))

    try:
        write_synthetic_series_to_db(bars, l2)
    except Exception as e:
        # Most common: unique constraint violation when reusing the same name/timeframe/timestamps.
        return _bad_request("persist_failed", str(e))

    # Return the dataset group info (what the dashboard expects).
    ts_start_min = bars[0].ts_start.isoformat().replace("+00:00", "Z") if bars else None
    ts_start_max = bars[-1].ts_start.isoformat().replace("+00:00", "Z") if bars else None
    return jsonify(
        {
            "ok": True,
            "symbol": dataset_name,
            "scenario": generator_name,
            "timeframe": timeframe,
            "ref_symbol": ref_symbol,
            "bar_count": len(bars),
            "ts_start_min": ts_start_min,
            "ts_start_max": ts_start_max,
        }
    )


@app.route("/api/synthetic_bars")
def api_synthetic_bars():
    """Fetch synthetic OHLCV bars with validation, optional time bounds, and limits."""
    symbol = request.args.get("symbol")
    scenario = request.args.get("scenario")
    timeframe = request.args.get("timeframe", "1m")

    if not symbol or not scenario:
        return _bad_request("missing_params", "symbol and scenario are required")

    if timeframe not in VALID_SYNTH_TIMEFRAMES:
        return _bad_request(
            "invalid_timeframe",
            "timeframe is not allowed",
            allowed=sorted(VALID_SYNTH_TIMEFRAMES),
        )

    start_raw = request.args.get("start_ts")
    end_raw = request.args.get("end_ts")
    limit = request.args.get("limit", type=int) or SYNTH_DEFAULT_LIMIT
    limit = max(1, min(SYNTH_MAX_LIMIT, limit))

    start_ts = _parse_iso_ts(start_raw) if start_raw else None
    end_ts = _parse_iso_ts(end_raw) if end_raw else None

    if start_raw and not start_ts:
        return _bad_request("invalid_start_ts", "start_ts must be ISO-8601 (e.g. 2025-01-01T09:30:00Z)")
    if end_raw and not end_ts:
        return _bad_request("invalid_end_ts", "end_ts must be ISO-8601 (e.g. 2025-01-01T16:00:00Z)")
    if start_ts and end_ts and start_ts > end_ts:
        return _bad_request("invalid_range", "start_ts must be <= end_ts")

    where_clauses = [
        "symbol = ?",
        "scenario = ?",
        "timeframe = ?",
    ]
    params = [symbol, scenario, timeframe]

    if start_ts:
        where_clauses.append("ts_start >= ?")
        params.append(start_ts)
    if end_ts:
        where_clauses.append("ts_start <= ?")
        params.append(end_ts)

    where_sql = " AND ".join(where_clauses)

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT ts_start, open, high, low, close, volume
            FROM bars_synth
            WHERE {where_sql}
            ORDER BY ts_start ASC
            LIMIT ?
            """,
            (*params, limit),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    bars = [
        {
            "ts_start": ts,
            "open": o,
            "high": h,
            "low": l,
            "close": c,
            "volume": v,
        }
        for (ts, o, h, l, c, v) in rows
    ]
    return jsonify(bars)


@app.route("/api/synthetic_l2")
def api_synthetic_l2():
    """Depth imbalance + related L2 fields aligned to synthetic bars."""
    symbol = request.args.get("symbol")
    scenario = request.args.get("scenario")
    timeframe = request.args.get("timeframe", "1m")

    if not symbol or not scenario:
        return _bad_request(
            "missing_params",
            "symbol and scenario are required",
            fields=["symbol", "scenario"],
        )

    if timeframe not in VALID_SYNTH_TIMEFRAMES:
        return _bad_request(
            "invalid_timeframe",
            "timeframe is not allowed",
            allowed=sorted(VALID_SYNTH_TIMEFRAMES),
        )

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                b.ts_start,
                l.dbi,
                l.ofi,
                l.spr,
                l.microprice
            FROM bars_synth b
            LEFT JOIN l2_state l
                ON l.bar_id = b.id
            WHERE b.symbol = ?
              AND b.scenario = ?
              AND b.timeframe = ?
            ORDER BY b.ts_start ASC
            """,
            (symbol, scenario, timeframe),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    data = [
        {
            "ts_start": ts,
            "dbi": dbi,
            "ofi": ofi,
            "spr": spr,
            "microprice": microprice,
        }
        for (ts, dbi, ofi, spr, microprice) in rows
    ]

    return jsonify(data)


def _interval_from_timeframe(timeframe: str) -> str:
    mapping = {
        "1m": "1Min",
        "5m": "5Min",
        "15m": "15Min",
    }
    return mapping.get(timeframe, timeframe)


def _timeframe_from_interval(interval: str) -> str:
    mapping = {
        "1Min": "1m",
        "5Min": "5m",
        "15Min": "15m",
    }
    return mapping.get(interval, interval.lower())


@app.route("/synthetic/<symbol>")
def synthetic_detail(symbol: str):
    """Detail page for a synthetic dataset."""
    scenario = request.args.get("scenario")
    timeframe = request.args.get("timeframe", "1m")
    interval = _interval_from_timeframe(timeframe)

    if not scenario:
        return _bad_request("missing_params", "scenario is required for synthetic detail")

    if timeframe not in VALID_SYNTH_TIMEFRAMES:
        return _bad_request(
            "invalid_timeframe",
            "timeframe is not allowed",
            allowed=sorted(VALID_SYNTH_TIMEFRAMES),
        )

    return render_template(
        "detail.html",
        ticker=symbol,
        interval=interval,
        is_synthetic=True,
        scenario=scenario,
        timeframe=timeframe,
    )


@app.route('/ticker/<ticker>')
def ticker_detail(ticker):
    """Detail view for a specific ticker."""
    # Alternate chart view: /ticker/SPY?band
    # (keeps existing detail view intact unless explicitly requested).
    if "band" in request.args:
        # Legacy wrapper template used an iframe (templates/ticker_band.html). This is no longer
        # necessary and made debugging/caching confusing. Redirect directly to the demo page.
        #
        # Preserve any relevant query params (bar_s/span/etc), but force API mode and symbol.
        try:
            cache_bust = int(os.path.getmtime("chart.html"))
        except Exception:
            cache_bust = int(time.time())

        params = dict(request.args)
        params.pop("band", None)
        params["mode"] = "api"
        params["symbol"] = ticker
        params["v"] = str(cache_bust)

        # Rebuild query string without importing url_for (keep it simple).
        from urllib.parse import urlencode

        return redirect("/chart.html?" + urlencode(params), code=302)
    interval = request.args.get('interval', '1Min')
    return render_template(
        'detail.html',
        ticker=ticker,
        interval=interval,
        is_synthetic=False,
        scenario=None,
        timeframe=_timeframe_from_interval(interval),
    )


@app.route("/chart.html")
def chart_page():
    """Serve the standalone band/candle canvas demo (also used by /ticker/<sym>?band)."""
    resp = send_file("chart.html", mimetype="text/html", max_age=0)
    # Avoid sticky caching in Chrome during rapid iteration.
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


@app.route("/demo_static.html")
def demo_static_page():
    """Back-compat: redirect old demo_static.html URL to /chart.html (preserve query string)."""
    try:
        from urllib.parse import urlencode

        qs = urlencode(dict(request.args)) if request.args else ""
        return redirect("/chart.html" + (("?" + qs) if qs else ""), code=302)
    except Exception:
        return redirect("/chart.html", code=302)


@app.route('/backtest-config')
def backtest_config():
    """Page with a form to run backtests with adjustable parameters."""
    strategy_names = sorted(list(STRATEGY_REGISTRY.keys()))
    intervals = ['1Min', '5Min', '15Min', '1H', '1D']
    return render_template(
        'backtest_config.html',
        strategies=strategy_names,
        intervals=intervals,
        default_ticker='SPY'
    )

@app.route('/api/strategies', methods=['GET'])
def list_strategies():
    """Return strategy metadata (name, display_name, description, enabled)."""
    defaults = {
        'vwap_ema_crossover_v1': {
            'display_name': 'VWAP / EMA Crossover (v1)',
            'description': 'Entry on sign change of (VWAP - EMA21). Bullish when VWAP < EMA21, bearish otherwise.'
        },
        'fools_paradise': {
            'display_name': 'Fools Paradise',
            'description': 'EMA9/21/50 alignment + VWAP bias; enter on first candle in trend. Emits exits for visualization.'
        }
    }

    reg_names = sorted(list(STRATEGY_REGISTRY.keys()))
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT name, display_name, description, enabled FROM strategies_meta")
    rows = {r[0]: {'display_name': r[1], 'description': r[2], 'enabled': int(r[3]) if r[3] is not None else 1} for r in cur.fetchall()}

    out = []
    for name in reg_names:
        meta = rows.get(name)
        if not meta:
            dflt = defaults.get(name, {})
            display_name = dflt.get('display_name', name)
            description = dflt.get('description', '')
            cur.execute(
                """
                INSERT OR IGNORE INTO strategies_meta (name, display_name, description, enabled)
                VALUES (?, ?, ?, 1)
                """,
                (name, display_name, description)
            )
            meta = {'display_name': display_name, 'description': description, 'enabled': 1}
        out.append({
            'name': name,
            'display_name': meta.get('display_name') or name,
            'description': meta.get('description') or '',
            'enabled': bool(meta.get('enabled', 1))
        })

    conn.commit()
    conn.close()
    return jsonify(out)

@app.route('/api/strategy/<name>/code', methods=['GET', 'POST'])
def strategy_code(name):
    """Read or update strategy source code for strategies in the registry."""
    nm = (name or '').strip()
    if nm not in STRATEGY_REGISTRY:
        return jsonify({'error': 'Unknown strategy'}), 404
    if not _is_valid_strategy_name(nm):
        return jsonify({'error': 'Invalid strategy name'}), 400
    path = _strategy_file_path(nm)
    if not os.path.exists(path):
        return jsonify({'error': 'Strategy file not found'}), 404

    if request.method == 'GET':
        try:
            with open(path, 'r', encoding='utf-8') as f:
                code = f.read()
            return jsonify({'name': nm, 'code': code})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    # POST: update
    payload = request.get_json(silent=True) or {}
    code = payload.get('code')
    if code is None:
        return jsonify({'error': 'code is required'}), 400
    try:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(code)
        return jsonify({'ok': True, 'name': nm})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/strategies/create', methods=['POST'])
def create_strategy():
    """
    Create a new strategy:
    - creates strategies/<name>.py
    - inserts/updates strategies_meta
    - dynamically imports and registers in STRATEGY_REGISTRY (available immediately)
    - patches strategies/__init__.py for persistence across restarts
    """
    payload = request.get_json(silent=True) or {}
    name = (payload.get('name') or '').strip()
    display_name = (payload.get('display_name') or '').strip()
    description = (payload.get('description') or '').strip()
    code_override = payload.get('code')

    if not _is_valid_strategy_name(name):
        return jsonify({'error': 'Invalid name. Use snake_case like my_strategy_v1.'}), 400
    if name in STRATEGY_REGISTRY:
        return jsonify({'error': 'Strategy already exists'}), 400

    path = _strategy_file_path(name)
    if os.path.exists(path):
        return jsonify({'error': 'Strategy file already exists'}), 400

    if not display_name:
        display_name = name

    compute_fn_name = f"compute_{name}_signals"

    template = f"""\"\"\"{display_name}

{description or 'TODO: Describe this strategy.'}

Strategy contract:
- Input: pandas.DataFrame with index timestamps and columns: open, high, low, close, volume
- Output: dict of same-length arrays. Minimum required by engine/UI:
  - long_entry: list[bool]
  - direction: list['bullish'|'bearish'|None]
Optional UI fields:
  - cross_y (entry marker y), exit_y, long_exit, exit_direction
\"\"\"

import pandas as pd


def {compute_fn_name}(df_prices, rth_mask=None):
    \"\"\"Skeleton strategy: no entries by default.\"\"\"
    if df_prices is None or getattr(df_prices, 'empty', False):
        return {{}}

    df = df_prices.copy()
    df.index = pd.to_datetime(df.index)

    n = len(df)
    # TODO: replace with real logic
    long_entry = [False] * n
    direction = [None] * n

    return {{
        'long_entry': long_entry,
        'direction': direction,
        'timestamp': [ts.isoformat() for ts in df.index],
    }}
"""

    code_to_write = template if code_override is None else str(code_override)

    try:
        os.makedirs(STRATEGIES_DIR, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(code_to_write)
    except Exception as e:
        return jsonify({'error': f'Failed to write strategy file: {e}'}), 500

    # Insert/Update metadata
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO strategies_meta (name, display_name, description, enabled)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(name) DO UPDATE SET
              display_name=excluded.display_name,
              description=excluded.description,
              enabled=excluded.enabled,
              updated_at=CURRENT_TIMESTAMP
            """,
            (name, display_name, description)
        )
        conn.commit()
        conn.close()
    except Exception:
        # Don't fail creation if metadata insert fails; file exists and can be edited.
        pass

    # Dynamically import and register in-memory
    try:
        importlib.invalidate_caches()
        mod = importlib.import_module(f"strategies.{name}")
        fn = getattr(mod, compute_fn_name, None)
        if not callable(fn):
            return jsonify({'error': f'Created file but did not find callable {compute_fn_name}()'}), 500
        STRATEGY_REGISTRY[name] = fn  # mutate in-place so app references see it immediately
    except Exception as e:
        return jsonify({'error': f'Created file but failed to import/register: {e}'}), 500

    # Persist in strategies/__init__.py best-effort
    try:
        _ensure_strategy_registered_in_init(name, compute_fn_name)
    except Exception:
        pass

    return jsonify({'ok': True, 'name': name, 'display_name': display_name, 'description': description})


@app.route('/api/strategy/<name>/meta', methods=['POST'])
def update_strategy_meta(name):
    """Update strategy metadata stored in SQLite (display_name, description, enabled)."""
    nm = (name or '').strip()
    if nm not in STRATEGY_REGISTRY:
        return jsonify({'error': 'Unknown strategy'}), 404
    if not _is_valid_strategy_name(nm):
        return jsonify({'error': 'Invalid strategy name'}), 400

    payload = request.get_json(silent=True) or {}
    display_name = (payload.get('display_name') or '').strip()
    description = (payload.get('description') or '').strip()
    enabled = payload.get('enabled')
    enabled_i = 1 if (enabled is None or bool(enabled)) else 0

    if not display_name:
        display_name = nm

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO strategies_meta (name, display_name, description, enabled)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
              display_name=excluded.display_name,
              description=excluded.description,
              enabled=excluded.enabled,
              updated_at=CURRENT_TIMESTAMP
            """,
            (nm, display_name, description, enabled_i)
        )
        conn.commit()
        conn.close()
        return jsonify({'ok': True, 'name': nm, 'display_name': display_name, 'description': description, 'enabled': bool(enabled_i)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def perform_strategy_backtest(name, ticker, interval, fee_bp, risk_percent, reward_multiple, start: str | None = None, end: str | None = None):
    """Shared backtest execution used by multiple endpoints."""
    supported = STRATEGY_REGISTRY

    if name not in supported:
        raise ValueError('Unsupported strategy')
    if not ticker:
        raise ValueError('ticker required')

    # Normalize ticker to uppercase for real symbols
    ticker = ticker.upper()

    # Map interval string to bar_s in seconds if needed
    interval_map = {
        '1Min': 60, '5Min': 300, '15Min': 900,
        '1h': 3600, '4h': 14400, '1d': 86400
    }
    
    # Try to determine target bar_s. If interval looks like a number, use it.
    try:
        target_bar_s = int(interval)
    except (ValueError, TypeError):
        target_bar_s = interval_map.get(interval, 60)

    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Strategy: 
    # 1. Try fetching exact interval requested.
    # 2. If no data, fetch 1Min data and aggregate to target_bar_s.
    fetched = _fetch_stock_data_ohlcv(cursor, ticker=ticker, interval=interval, start_iso=start, end_iso=end)
    
    if not fetched and target_bar_s != 60:
        # Fallback: fetch 1Min data and aggregate
        fetched_1m = _fetch_stock_data_ohlcv(cursor, ticker=ticker, interval='1Min', start_iso=start, end_iso=end)
        if fetched_1m:
            # _fetch_stock_data_ohlcv returns (ts, c, o, h, l, v)
            # _aggregate_ohlcv expects (epoch_ms, o, h, l, v, c) - wait, check order!
            # Let's check _aggregate_ohlcv signature again.
            
            # From _aggregate_ohlcv: 
            # rows: List[Tuple[int, float, float, float, float, float]] (epoch_ms, o,h,l,c,v)
            
            agg_input = []
            for (ts_iso, c, o, h, l, v) in fetched_1m:
                try:
                    dt = datetime.fromisoformat(ts_iso.replace('Z', '+00:00'))
                    ms = int(dt.timestamp() * 1000)
                    agg_input.append((ms, o, h, l, c, v))
                except Exception:
                    continue
            
            if agg_input:
                agg = _aggregate_ohlcv(agg_input, target_bar_s)
                # Reconstruct 'fetched' format: (ts_iso, c, o, h, l, v)
                fetched = []
                for i in range(len(agg['t_ms'])):
                    ts_iso = datetime.fromtimestamp(agg['t_ms'][i]/1000, tz=timezone.utc).isoformat().replace('+00:00', 'Z')
                    fetched.append((
                        ts_iso,
                        agg['c'][i],
                        agg['o'][i],
                        agg['h'][i],
                        agg['l'][i],
                        agg['v'][i]
                    ))

    conn.close()

    if not fetched:
        raise LookupError('no data')

    timestamps = [row[0] for row in fetched]
    market_hours = get_market_hours_info(timestamps)
    regular_mask = build_regular_mask(timestamps, market_hours)
    ohlc = [
        {
            'open': row[2],
            'high': row[3],
            'low': row[4],
            'close': row[1],
            'volume': row[5] if row[5] is not None else 0,
        }
        for row in fetched
    ]

    try:
        df = pd.DataFrame(ohlc)
        df.index = pd.to_datetime(timestamps)
    except Exception:
        df = pd.DataFrame(ohlc)

    # Allow off-hours for VWAP/EMA crossover and Fools Paradise
    if name in ['vwap_ema_crossover_v1', 'fools_paradise']:
        signals = supported[name](df, rth_mask=None)
    else:
        signals = supported[name](df, rth_mask=regular_mask)

    execution_model = RiskRewardExecutionModel(
        risk_percent=risk_percent,
        reward_multiple=reward_multiple
    )
    metrics = run_backtest(df, signals, fee_bp=fee_bp, execution_model=execution_model)

    return {
        'strategy': name,
        'ticker': ticker,
        'interval': interval,
        'metrics': metrics,
        'n_bars': len(df),
        'generated_at': datetime.now(timezone.utc).isoformat()
    }

@app.route('/api/ticker/<ticker>/<interval>')
def get_ticker_data(ticker, interval):
    """API endpoint to get ticker data for charting."""
    def _clean(series):
        cleaned = []
        for v in series:
            if v is None:
                cleaned.append(None)
            elif isinstance(v, float) and math.isnan(v):
                cleaned.append(None)
            else:
                cleaned.append(v)
        return cleaned

    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get all data for the ticker and interval (OHLC + volume only)
    fetched = _fetch_stock_data_ohlcv(cursor, ticker=ticker, interval=interval)
    conn.close()
    
    timestamps = [row[0] for row in fetched]
    market_hours = get_market_hours_info(timestamps)
    market_opens = get_market_open_times(timestamps)

    ohlc = [
        {
            'open': row[2],
            'high': row[3],
            'low': row[4],
            'close': row[1],
            'volume': row[5] if row[5] is not None else 0,
        }
        for row in fetched
    ]

    # Compute pandas_ta indicators on the fly (always)
    indicators_ta = {}
    if len(ohlc) > 0:
        df = pd.DataFrame(ohlc)
        # set index to timestamps to match VWAP anchoring per trading day
        try:
            df.index = pd.to_datetime(timestamps)
        except Exception:
            pass

        if ta:
            df['ta_ema_9'] = ta.ema(df['close'], length=9)
            df['ta_ema_21'] = ta.ema(df['close'], length=21)
            df['ta_ema_50'] = ta.ema(df['close'], length=50)
            macd_df = ta.macd(df['close'])
            if macd_df is not None and not macd_df.empty:
                macd_cols = list(macd_df.columns)
                macd_col = macd_cols[0] if len(macd_cols) > 0 else None
                macd_signal_col = macd_cols[1] if len(macd_cols) > 1 else None
                df['ta_macd'] = macd_df[macd_col] if macd_col else None
                df['ta_macd_signal'] = macd_df[macd_signal_col] if macd_signal_col else None
        else:
            # Fallback using pandas only
            df['ta_ema_9'] = df['close'].ewm(span=9, adjust=False).mean()
            df['ta_ema_21'] = df['close'].ewm(span=21, adjust=False).mean()
            df['ta_ema_50'] = df['close'].ewm(span=50, adjust=False).mean()
            macd_line = df['close'].ewm(span=12, adjust=False).mean() - df['close'].ewm(span=26, adjust=False).mean()
            df['ta_macd'] = macd_line
            df['ta_macd_signal'] = macd_line.ewm(span=9, adjust=False).mean()

        # VWAP anchored per trading day to match Alpaca anchor logic
        vwap_series = calculate_vwap_per_trading_day(df.rename(columns={
            'open': 'open',
            'high': 'high',
            'low': 'low',
            'close': 'close',
            'volume': 'volume'
        }))
        df['ta_vwap'] = vwap_series

        # Normalize to JSON-serializable lists (replace NaN/NA with None)
        indicators_ta = {
            'ema_9': df['ta_ema_9'].where(pd.notna(df['ta_ema_9']), None).tolist(),
            'ema_21': df['ta_ema_21'].where(pd.notna(df['ta_ema_21']), None).tolist(),
            'ema_50': df['ta_ema_50'].where(pd.notna(df['ta_ema_50']), None).tolist(),
            'vwap': vwap_series.where(pd.notna(vwap_series), None).tolist(),
            'macd': df['ta_macd'].where(pd.notna(df['ta_macd']), None).tolist() if 'ta_macd' in df else [None]*len(df),
            'macd_signal': df['ta_macd_signal'].where(pd.notna(df['ta_macd_signal']), None).tolist() if 'ta_macd_signal' in df else [None]*len(df)
        }

    # Always align pandas_ta VWAP to anchored calculation if we have timestamps
    if len(ohlc) > 0:
        df_vwap = pd.DataFrame(ohlc)
        try:
            df_vwap.index = pd.to_datetime(timestamps)
        except Exception:
            pass
        vwap_anchored = calculate_vwap_per_trading_day(df_vwap.rename(columns={
            'open': 'open',
            'high': 'high',
            'low': 'low',
            'close': 'close',
            'volume': 'volume'
        }))
        indicators_ta['vwap'] = vwap_anchored.where(pd.notna(vwap_anchored), None).tolist()

    # Build strategy signals
    strategy_payload = {}
    try:
        df_strategy = pd.DataFrame(ohlc)
        df_strategy.index = pd.to_datetime(timestamps)
        # Allow off-hours for the simple VWAP/EMA crossover
        signals_vwap_ema_cross = compute_vwap_ema_crossover_signals(df_strategy, rth_mask=None)
        if signals_vwap_ema_cross:
            strategy_payload['vwap_ema_crossover_v1'] = normalize_signals(signals_vwap_ema_cross, df_strategy)
        
        # Compute Fools Paradise strategy signals
        signals_fools_paradise = compute_fools_paradise_signals(df_strategy, rth_mask=None)
        if signals_fools_paradise:
            strategy_payload['fools_paradise'] = normalize_signals(signals_fools_paradise, df_strategy)
    except Exception as e:
        # Keep strategies empty if anything fails; don't break main payload
        strategy_payload = {}
    
    # Compute candlestick bias overlay (educational tool, not a strategy)
    candle_bias = []
    pattern_counts = {}
    try:
        if len(ohlc) > 0:
            df_candles = pd.DataFrame(ohlc)
            candle_bias = compute_candlestick_bias(df_candles)
            pattern_counts = count_pattern_instances(candle_bias)
    except Exception as e:
        # Keep candle_bias empty if computation fails; don't break main payload
        candle_bias = []
        pattern_counts = {}

    data = {
        'labels': timestamps,
        'prices': _clean([row[1] for row in fetched]),
        'ohlc': [
            {
                'open': None if (entry['open'] is None or (isinstance(entry['open'], float) and math.isnan(entry['open']))) else entry['open'],
                'high': None if (entry['high'] is None or (isinstance(entry['high'], float) and math.isnan(entry['high']))) else entry['high'],
                'low': None if (entry['low'] is None or (isinstance(entry['low'], float) and math.isnan(entry['low']))) else entry['low'],
                'close': None if (entry['close'] is None or (isinstance(entry['close'], float) and math.isnan(entry['close']))) else entry['close'],
                'volume': entry['volume'] if entry['volume'] is not None else 0
            }
            for entry in ohlc
        ],
        'indicators': {},  # deprecated: alpaca imports removed
        'indicators_ta': {k: _clean(v) for k, v in indicators_ta.items()},
        'market_hours': [
            {
                'start': period['start'].isoformat() if isinstance(period['start'], datetime) else period['start'],
                'end': period['end'].isoformat() if isinstance(period['end'], datetime) else period['end'],
                'type': period['type']
            }
            for period in market_hours
        ],
        'market_opens': [
            mo.isoformat() if isinstance(mo, datetime) else mo
            for mo in market_opens
        ],
        'strategies': strategy_payload,
        'candle_bias': candle_bias,
        'pattern_counts': pattern_counts
    }
    
    return jsonify(data)


@app.route('/api/strategy/<name>/backtest', methods=['POST'])
def run_strategy_backtest(name):
    """Run a backtest for a supported strategy with 2:1 profit-to-loss ratio."""
    payload = request.get_json(silent=True) or {}
    ticker = payload.get('ticker')
    interval = payload.get('interval', '1Min')
    start = (payload.get("start") or "").strip() or None
    end = (payload.get("end") or "").strip() or None
    fee_bp = float(payload.get('fee_bp', 0.0) or 0.0)
    risk_percent = float(payload.get('risk_percent', 0.5) or 0.5)  # Default 0.5% risk
    reward_multiple = float(payload.get('reward_multiple', 2.0) or 2.0)  # Default 2:1
    try:
        result = perform_strategy_backtest(
            name=name,
            ticker=ticker,
            interval=interval,
            fee_bp=fee_bp,
            risk_percent=risk_percent,
            reward_multiple=reward_multiple,
            start=start,
            end=end,
        )
        return jsonify(result)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except LookupError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _row_to_backtest(row):
    """Convert a DB row from backtests into a dict."""
    if not row:
        return None
    metrics = None
    try:
        metrics = json.loads(row[8]) if row[8] else None
    except Exception:
        metrics = None
    return {
        'id': row[0],
        'name': row[1],
        'strategy': row[2],
        'ticker': row[3],
        'interval': row[4],
        'risk_percent': row[5],
        'reward_multiple': row[6],
        'fee_bp': row[7],
        'metrics': metrics,
        'created_at': row[9],
        'updated_at': row[10] if len(row) > 10 else None
    }


@app.route('/api/backtests', methods=['GET', 'POST'])
def backtests():
    """List or create named backtests (stores parameters and summary metrics)."""
    if request.method == 'GET':
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, name, strategy, ticker, interval, risk_percent, reward_multiple, fee_bp, metrics_json, created_at, updated_at
            FROM backtests
            ORDER BY datetime(created_at) DESC
            LIMIT 100
        ''')
        rows = cursor.fetchall()
        conn.close()
        return jsonify([_row_to_backtest(r) for r in rows])

    # POST: create and persist a named backtest
    payload = request.get_json(silent=True) or {}
    name = (payload.get('name') or '').strip()
    strategy = payload.get('strategy')
    ticker = payload.get('ticker')
    interval = payload.get('interval', '1Min')
    fee_bp = float(payload.get('fee_bp', 0.0) or 0.0)
    risk_percent = float(payload.get('risk_percent', 0.5) or 0.5)
    reward_multiple = float(payload.get('reward_multiple', 2.0) or 2.0)
    run_flag = payload.get('run', True)
    run_backtest = not (isinstance(run_flag, bool) and run_flag is False)

    if not name:
        return jsonify({'error': 'name required'}), 400

    result = {
        'strategy': strategy,
        'ticker': ticker,
        'interval': interval,
        'metrics': None,
        'generated_at': None
    }

    if run_backtest:
        try:
            result = perform_strategy_backtest(
                name=strategy,
                ticker=ticker,
                interval=interval,
                fee_bp=fee_bp,
                risk_percent=risk_percent,
                reward_multiple=reward_multiple,
            )
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        except LookupError as e:
            return jsonify({'error': str(e)}), 404
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    # Persist the parameters and summary metrics
    conn = get_db_connection()
    cursor = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()
    metrics_json = json.dumps(result.get('metrics', {})) if run_backtest else None
    cursor.execute('''
        INSERT INTO backtests (name, strategy, ticker, interval, risk_percent, reward_multiple, fee_bp, metrics_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (name, strategy, ticker, interval, risk_percent, reward_multiple, fee_bp, metrics_json, now_iso, now_iso))
    backtest_id = cursor.lastrowid
    conn.commit()
    conn.close()

    result_with_id = dict(result)
    result_with_id['id'] = backtest_id
    result_with_id['name'] = name
    return jsonify(result_with_id), 201


@app.route('/api/backtests/<int:bt_id>', methods=['GET'])
def get_backtest(bt_id):
    """Fetch a saved backtest by id."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, name, strategy, ticker, interval, risk_percent, reward_multiple, fee_bp, metrics_json, created_at, updated_at
        FROM backtests
        WHERE id = ?
    ''', (bt_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return jsonify({'error': 'not found'}), 404
    return jsonify(_row_to_backtest(row))


@app.route('/api/backtests/<int:bt_id>/run', methods=['POST'])
def rerun_backtest(bt_id):
    """Re-run a saved backtest using current market data and update its metrics."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, name, strategy, ticker, interval, risk_percent, reward_multiple, fee_bp, metrics_json, created_at, updated_at
        FROM backtests
        WHERE id = ?
    ''', (bt_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'not found'}), 404

    bt = _row_to_backtest(row)
    try:
        result = perform_strategy_backtest(
            name=bt['strategy'],
            ticker=bt['ticker'],
            interval=bt['interval'],
            fee_bp=bt['fee_bp'],
            risk_percent=bt['risk_percent'],
            reward_multiple=bt['reward_multiple'],
        )
    except ValueError as e:
        conn.close()
        return jsonify({'error': str(e)}), 400
    except LookupError as e:
        conn.close()
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500

    # Update stored metrics
    updated_iso = datetime.now(timezone.utc).isoformat()
    metrics_json = json.dumps(result.get('metrics', {}))
    cursor.execute('''
        UPDATE backtests
        SET metrics_json = ?, updated_at = ?
        WHERE id = ?
    ''', (metrics_json, updated_iso, bt_id))
    conn.commit()
    conn.close()

    result_with_id = dict(result)
    result_with_id['id'] = bt_id
    result_with_id['name'] = bt['name']
    return jsonify(result_with_id)


@app.route('/api/backtests/<int:bt_id>', methods=['DELETE'])
def delete_backtest(bt_id):
    """Delete a saved backtest."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM backtests WHERE id = ?', (bt_id,))
    deleted = cursor.rowcount
    conn.commit()
    conn.close()
    if deleted == 0:
        return jsonify({'error': 'not found'}), 404
    return jsonify({'deleted': bt_id})


def _row_to_backtest_config(row):
    """Convert a DB row from backtest_configs into a dict."""
    if not row:
        return None
    return {
        'id': row[0],
        'name': row[1],
        'risk_percent': row[2],
        'reward_multiple': row[3],
        'fee_bp': row[4],
        'created_at': row[5],
        'updated_at': row[6] if len(row) > 6 else None
    }


@app.route('/api/backtest-configs', methods=['GET', 'POST'])
def backtest_configs():
    """List or create global backtest configurations (strategy-neutral presets)."""
    if request.method == 'GET':
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, name, risk_percent, reward_multiple, fee_bp, created_at, updated_at
            FROM backtest_configs
            ORDER BY datetime(created_at) DESC
            LIMIT 100
        ''')
        rows = cursor.fetchall()
        conn.close()
        return jsonify([_row_to_backtest_config(r) for r in rows])

    payload = request.get_json(silent=True) or {}
    name = (payload.get('name') or '').strip()
    risk_percent = float(payload.get('risk_percent', 0.5) or 0.5)
    reward_multiple = float(payload.get('reward_multiple', 2.0) or 2.0)
    fee_bp = float(payload.get('fee_bp', 0.0) or 0.0)

    if not name:
        return jsonify({'error': 'name required'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()
    cursor.execute('''
        INSERT INTO backtest_configs (name, risk_percent, reward_multiple, fee_bp, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (name, risk_percent, reward_multiple, fee_bp, now_iso, now_iso))
    cfg_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return jsonify({
        'id': cfg_id,
        'name': name,
        'risk_percent': risk_percent,
        'reward_multiple': reward_multiple,
        'fee_bp': fee_bp,
        'created_at': now_iso,
        'updated_at': now_iso
    }), 201


@app.route('/api/backtest-configs/<int:cfg_id>', methods=['DELETE'])
def delete_backtest_config(cfg_id):
    """Delete a global backtest configuration."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM backtest_configs WHERE id = ?', (cfg_id,))
    deleted = cursor.rowcount
    conn.commit()
    conn.close()
    if deleted == 0:
        return jsonify({'error': 'not found'}), 404
    return jsonify({'deleted': cfg_id})

@app.route('/api/fetch-latest', methods=['POST'])
def fetch_latest_data():
    """Fetch latest data from Alpaca API starting from the last timestamp in database."""
    try:
        payload = request.get_json(silent=True) or {}
        req_ticker = (payload.get("ticker") or payload.get("symbol") or "").strip().upper()
        req_interval = (payload.get("interval") or "1Min").strip()
        start_date_raw = (payload.get("start_date") or payload.get("start") or "").strip()
        end_date_raw = (payload.get("end_date") or payload.get("end") or "").strip()

        def _parse_date_or_iso(s: str, *, end_of_day: bool = False) -> Optional[datetime]:
            """
            Accepts:
              - YYYY-MM-DD (date input)
              - full ISO timestamp (with or without Z)
            Returns timezone-aware UTC datetime, or None if invalid/empty.
            """
            s0 = (s or "").strip()
            if not s0:
                return None
            # Date-only
            try:
                if "T" not in s0 and len(s0) == 10:
                    d = datetime.fromisoformat(s0).date()
                    if end_of_day:
                        return datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=timezone.utc)
                    return datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=timezone.utc)
            except Exception:
                pass
            # ISO timestamp
            try:
                dt = datetime.fromisoformat(s0.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                else:
                    dt = dt.astimezone(timezone.utc)
                return dt
            except Exception:
                return None

        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get the latest timestamp from database
        cursor.execute('''
            SELECT MAX(timestamp) as latest_timestamp
            FROM stock_data
        ''')
        
        result = cursor.fetchone()
        latest_timestamp = result[0] if result and result[0] else None
        
        # Initialize Alpaca API
        API_KEY = 'PK57P4EYJODEZTVL7QYOX7J53W'
        API_SECRET = '6PXLeTmf6wKNJBSCKZAhg3SgCkieGag1Bgvf5Yeq53qD'
        BASE_URL = 'https://paper-api.alpaca.markets/v2'
        
        api = tradeapi.REST(API_KEY, API_SECRET, BASE_URL, api_version='v2')
        
        # Calculate time range
        end_time = datetime.now(timezone.utc)

        # Optional: user-provided date range (for adding a new ticker / backfilling).
        req_start = _parse_date_or_iso(start_date_raw, end_of_day=False)
        req_end = _parse_date_or_iso(end_date_raw, end_of_day=True)
        if req_start and req_end and req_end < req_start:
            conn.close()
            return jsonify({"success": False, "error": "Invalid range: end_date must be >= start_date"}), 400

        if req_start or req_end:
            # If only one side provided, clamp the other to "now" or same day.
            start_time = req_start or (req_end or end_time) - timedelta(days=5)
            end_time = req_end or end_time
        else:
            # Default behavior: incremental update from max timestamp.
            if latest_timestamp:
                # Start from the latest timestamp (add 1 minute to avoid duplicates)
                try:
                    start_time = datetime.fromisoformat(latest_timestamp.replace('Z', '+00:00'))
                    if start_time.tzinfo is None:
                        start_time = start_time.replace(tzinfo=timezone.utc)
                    else:
                        start_time = start_time.astimezone(timezone.utc)
                    start_time = start_time + timedelta(minutes=1)  # Start 1 minute after last record
                except Exception:
                    # Fallback: use 1 day ago if timestamp parsing fails
                    start_time = end_time - timedelta(days=1)
            else:
                # No data exists, fetch last 5 days
                start_time = end_time - timedelta(days=5)
        
        # Format as RFC3339 strings
        start_str = start_time.strftime('%Y-%m-%dT%H:%M:%SZ')
        end_str = end_time.strftime('%Y-%m-%dT%H:%M:%SZ')
        
        # Determine which tickers to fetch:
        # - If user provided a ticker: only fetch that ticker (lets you add new symbols).
        # - Else: fetch for all tickers already known to the system (present in SQLite),
        #   falling back to a small default set.
        TICKERS = [req_ticker] if req_ticker else (list_all_tickers() or ['SPY', 'QQQ'])

        # Focus: Alpaca free tier 1-minute data.
        # Allow overriding interval explicitly, but default to 1Min.
        INTERVALS = [req_interval] if req_interval else ['1Min']
        
        total_records = 0
        last_timestamp = None
        
        for ticker in TICKERS:
            for interval in INTERVALS:
                try:
                    # Fetch bars from Alpaca
                    bars = api.get_bars(
                        ticker,
                        interval,
                        start=start_str,
                        end=end_str,
                        feed='iex'
                    ).df
                    
                    if bars.empty:
                        continue
                    
                    # Sort by timestamp
                    bars = bars.sort_index()
                    
                    # Insert data into database (only OHLCV)
                    for timestamp, row in bars.iterrows():
                        try:
                            cursor.execute('''
                                INSERT OR REPLACE INTO stock_data 
                                (ticker, timestamp, price, open_price, high_price, low_price, volume, 
                                 interval)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            ''', (
                                ticker,
                                timestamp.isoformat(),
                                float(row['close']),
                                float(row['open']),
                                float(row['high']),
                                float(row['low']),
                                float(row['volume']) if 'volume' in row and pd.notna(row['volume']) else None,
                                interval
                            ))
                            total_records += 1
                            last_timestamp = timestamp.isoformat()
                        except Exception as e:
                            print(f"Error inserting data point: {e}")
                            continue
                    
                    conn.commit()
                    # Rate limiting: if you're fetching many symbols, keep this gentle.
                    # For single-symbol range loads, it's usually fine, but we keep the old behavior.
                    time.sleep(0.5)
                    
                except Exception as e:
                    print(f"Error fetching data for {ticker} at {interval} interval: {e}")
                    continue
        
        conn.close()
        
        return jsonify({
            'success': True,
            'records_added': total_records,
            'last_timestamp': last_timestamp
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/package-proof-of-concept')
def package_poc():
    """Proof of concept page demonstrating analytics packages are installed and working."""
    try:
        # Get package versions (only for installed packages)
        package_versions = {
            'pandas': pd.__version__
        }
        
        if NUMPY_AVAILABLE:
            package_versions['numpy'] = np.__version__
        if SCIPY_AVAILABLE:
            package_versions['scipy'] = scipy.__version__
        if STATSMODELS_AVAILABLE:
            package_versions['statsmodels'] = sm.__version__
        
        numpy_demo = None
        scipy_demo = None
        statsmodels_demo = None
        
        # NumPy demo: Create array and do operations
        if NUMPY_AVAILABLE:
            numpy_demo = {
                'array': np.array([1, 2, 3, 4, 5]).tolist(),
                'mean': float(np.mean([1, 2, 3, 4, 5])),
                'std': float(np.std([1, 2, 3, 4, 5])),
                'sum': int(np.sum([1, 2, 3, 4, 5]))
            }
        
        # Pandas demo: Create DataFrame
        pandas_demo_data = {
            'Date': pd.date_range('2024-01-01', periods=5, freq='D').strftime('%Y-%m-%d').tolist(),
            'Price': [100.5, 102.3, 101.8, 103.2, 102.9],
            'Volume': [1000000, 1200000, 950000, 1100000, 1050000]
        }
        df = pd.DataFrame(pandas_demo_data)
        pandas_demo = {
            'dataframe_head': df.head().to_dict('records'),
            'mean_price': float(df['Price'].mean()),
            'total_volume': int(df['Volume'].sum())
        }
        
        # SciPy demo: Statistical operations
        if SCIPY_AVAILABLE and NUMPY_AVAILABLE:
            from scipy import stats
            sample_data = [10, 20, 30, 40, 50]
            scipy_demo = {
                'data': sample_data,
                'mean': float(stats.tmean(sample_data)),
                't_statistic': float(stats.ttest_1samp(sample_data, 25).statistic),
                'p_value': float(stats.ttest_1samp(sample_data, 25).pvalue)
            }
        
        # Statsmodels demo: Simple linear regression
        if STATSMODELS_AVAILABLE and NUMPY_AVAILABLE:
            x = np.array([1, 2, 3, 4, 5])
            y = np.array([2.1, 3.9, 6.1, 8.0, 9.9])
            X = sm.add_constant(x)  # Add intercept
            model = sm.OLS(y, X).fit()
            statsmodels_demo = {
                'x_values': x.tolist(),
                'y_values': y.tolist(),
                'intercept': float(model.params[0]),
                'slope': float(model.params[1]),
                'r_squared': float(model.rsquared),
                'p_values': [float(p) for p in model.pvalues],
                'summary_stats': {
                    'f_statistic': float(model.fvalue),
                    'p_value_f': float(model.f_pvalue)
                }
            }
        
        return render_template('package_poc.html',
                             package_versions=package_versions,
                             numpy_demo=numpy_demo,
                             pandas_demo=pandas_demo,
                             scipy_demo=scipy_demo,
                             statsmodels_demo=statsmodels_demo,
                             numpy_available=NUMPY_AVAILABLE,
                             scipy_available=SCIPY_AVAILABLE,
                             statsmodels_available=STATSMODELS_AVAILABLE)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return render_template('package_poc.html',
                             error=str(e),
                             package_versions={},
                             numpy_available=False,
                             scipy_available=False,
                             statsmodels_available=False)


# ---------------------------
# Replay (practice-field) API
# ---------------------------

@app.route("/replay/start", methods=["POST"])
def replay_start():
    payload = request.get_json(silent=True) or {}
    symbol = (payload.get("symbol") or payload.get("ticker") or "").strip().upper()
    t_start = (payload.get("t_start") or payload.get("start") or "").strip()
    t_end = (payload.get("t_end") or payload.get("end") or "").strip()
    disp_tf_sec = int(payload.get("disp_tf_sec") or payload.get("disp_tf") or 300)
    exec_tf_sec = int(payload.get("exec_tf_sec") or 60)
    snap_to_disp_boundary = payload.get("snap_to_disp_boundary")
    if snap_to_disp_boundary is None:
        snap_to_disp_boundary = True
    snap_to_disp_boundary = bool(snap_to_disp_boundary)
    seed = payload.get("seed")
    try:
        seed_int = int(seed) if seed is not None else None
    except Exception:
        seed_int = None
    initial_history_bars = payload.get("initial_history_bars")
    min_future_disp_bars = payload.get("min_future_disp_bars")
    min_anchor_age_days = payload.get("min_anchor_age_days")
    delta_mode = bool(payload.get("delta_mode") or payload.get("delta") or False)

    try:
        initial_history_bars_int = int(initial_history_bars) if initial_history_bars is not None else 200
    except Exception:
        initial_history_bars_int = 200
    try:
        min_future_disp_bars_int = int(min_future_disp_bars) if min_future_disp_bars is not None else 3
    except Exception:
        min_future_disp_bars_int = 3
    try:
        min_anchor_age_days_int = int(min_anchor_age_days) if min_anchor_age_days is not None else 30
    except Exception:
        min_anchor_age_days_int = 30
    min_anchor_age_days_int = max(0, min(3650, min_anchor_age_days_int))

    if not symbol:
        return _bad_request("missing_params", "symbol is required", fields=["symbol"])

    # UI contract (chart.html): allow omitting t_start/t_end; derive from DB.
    if not t_start or not t_end:
        conn = get_db_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT MIN(timestamp), MAX(timestamp)
                FROM stock_data
                WHERE ticker = ? AND interval = '1Min'
                """,
                (symbol,),
            )
            lo, hi = cur.fetchone()
        finally:
            conn.close()
        if not lo or not hi:
            return _bad_request("no_data", f"no 1Min data found for {symbol}")
        t_start = str(lo)
        t_end = str(hi)

    # Choose a deterministic anchor time so replay starts with history + some future.
    try:
        from datetime import timedelta
        import random

        start_dt = datetime.fromisoformat(t_start.replace("Z", "+00:00")).astimezone(timezone.utc)
        end_dt = datetime.fromisoformat(t_end.replace("Z", "+00:00")).astimezone(timezone.utc)
        disp_s = max(60, int(disp_tf_sec))
        # Require enough history and future around anchor.
        hist_span = timedelta(seconds=disp_s * max(1, initial_history_bars_int))
        fut_span = timedelta(seconds=disp_s * max(1, min_future_disp_bars_int))

        # Enforce that the anchor is at least N days before the dataset end (when possible),
        # but never at the cost of pushing the start all the way back to the dataset beginning.
        latest_anchor_by_age = end_dt - timedelta(days=min_anchor_age_days_int)
        latest_anchor_by_future = end_dt - fut_span
        latest_anchor = min(latest_anchor_by_age, latest_anchor_by_future)
        if latest_anchor <= start_dt:
            # Can't satisfy age constraint; fall back to "as late as we can while still having future".
            latest_anchor = max(start_dt, latest_anchor_by_future)

        low = start_dt + hist_span
        high = min(latest_anchor, end_dt - fut_span)
        if high <= low:
            # If we can't satisfy both "history" + "future" windows, bias toward a useful start
            # near the end of available data (still future-blind for the UI).
            anchor_dt = max(start_dt, end_dt - fut_span)
        else:
            # If seed isn't provided, randomize per-session.
            rnd = random.Random(seed_int) if seed_int is not None else random.SystemRandom()
            span_sec = int((high - low).total_seconds())
            pick = rnd.randint(0, max(0, span_sec))
            anchor_dt = low + timedelta(seconds=pick)
        t_anchor = anchor_dt.isoformat().replace("+00:00", "Z")
    except Exception:
        t_anchor = None

    try:
        cfg = ReplaySessionConfig(
            symbol=symbol,
            t_start=t_start,
            t_end=t_end,
            exec_tf_sec=exec_tf_sec,
            disp_tf_sec=disp_tf_sec,
            seed=seed_int,
            snap_to_disp_boundary=snap_to_disp_boundary,
            t_anchor=t_anchor,
            initial_history_bars=initial_history_bars_int,
            min_future_disp_bars=min_future_disp_bars_int,
        )
        sess = ReplaySession.create(cfg)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    _REPLAY_SESSIONS[sess.session_id] = sess
    # Default: keep existing snapshot payload for backwards compatibility.
    # Delta mode (opt-in): return a fixed-length window snapshot aligned with delta-only stepping.
    state_payload = sess.get_state_payload_delta() if delta_mode else sess.get_state_payload()
    return jsonify({"session_id": sess.session_id, "state": state_payload})


@app.route("/replay/step", methods=["POST"])
def replay_step():
    payload = request.get_json(silent=True) or {}
    session_id = (payload.get("session_id") or "").strip()
    disp_steps = int(payload.get("disp_steps") or 1)
    return_states = bool(payload.get("return_states") or payload.get("batch") or False)
    delta_only = bool(payload.get("delta_only") or (str(payload.get("mode") or "").lower() == "delta"))
    # Resync controls (delta mode only)
    force_state = bool(payload.get("force_state") or payload.get("resync") or False)
    try:
        resync_every = int(payload.get("resync_every") or payload.get("resync_interval") or 0)
    except Exception:
        resync_every = 0
    resync_every = max(0, min(5000, resync_every))
    return_deltas = bool(payload.get("return_deltas") or payload.get("deltas") or False)
    sess = _get_replay_session(session_id)
    if not sess:
        return jsonify({"error": "session not found"}), 404

    # Delta-only stepping (opt-in): return tiny payloads.
    # Supports batching by returning one delta item per step (safe to buffer client-side).
    if delta_only:
        steps = max(1, int(disp_steps))
        if steps > 1 or return_deltas:
            deltas = sess.step_delta_payloads(disp_steps=steps, resync_every=resync_every, force_state=force_state)
            last = deltas[-1] if deltas else None
            # Convenience: also include the last state if it was included (helps some callers).
            return jsonify({"deltas": deltas, "state": (last or {}).get("state")})
        d = sess.step_delta(resync_every=resync_every, force_state=force_state)
        return jsonify(d)

    # For smooth browser playback we optionally return one state payload per display step.
    # Backwards-compatible: if return_states is false (or disp_steps==1), return a single state.
    if return_states and disp_steps > 1:
        states = sess.step_payloads(disp_steps=disp_steps)
        last_state = states[-1] if states else sess.get_state_payload()
        return jsonify({"state": last_state, "states": states, "delta": {}})

    sess.step(disp_steps=disp_steps)
    return jsonify({"state": sess.get_state_payload(), "delta": {}})


@app.route("/replay/order/place", methods=["POST"])
def replay_order_place():
    payload = request.get_json(silent=True) or {}
    session_id = (payload.get("session_id") or "").strip()
    otype = (payload.get("type") or "limit").strip().lower()
    side = (payload.get("side") or "").strip().lower()
    qty = float(payload.get("qty") or 0)
    price = payload.get("price")
    tag = payload.get("tag")

    sess = _get_replay_session(session_id)
    if not sess:
        return jsonify({"error": "session not found"}), 404
    if side not in ("buy", "sell"):
        return _bad_request("invalid_side", "side must be buy or sell")
    if qty <= 0:
        return _bad_request("invalid_qty", "qty must be > 0")
    if otype not in ("limit", "market"):
        return _bad_request("invalid_type", "type must be limit or market")
    if otype == "limit" and price is None:
        return _bad_request("missing_price", "price is required for limit orders in v1")

    try:
        if otype == "market":
            sess.place_market(side=side, qty=float(qty), tag=tag)
        else:
            sess.place_limit(side=side, price=float(price), qty=float(qty), tag=tag)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    return jsonify({"state": sess.get_state_payload(), "delta": {}})


@app.route("/replay/flatten", methods=["POST"])
def replay_flatten():
    payload = request.get_json(silent=True) or {}
    session_id = (payload.get("session_id") or "").strip()
    sess = _get_replay_session(session_id)
    if not sess:
        return jsonify({"error": "session not found"}), 404
    try:
        sess.flatten_now(tag="ui")
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"state": sess.get_state_payload(), "delta": {}})


@app.route("/replay/order/cancel", methods=["POST"])
def replay_order_cancel():
    payload = request.get_json(silent=True) or {}
    session_id = (payload.get("session_id") or "").strip()
    order_id = (payload.get("order_id") or "").strip()
    sess = _get_replay_session(session_id)
    if not sess:
        return jsonify({"error": "session not found"}), 404
    if not order_id:
        return _bad_request("missing_order_id", "order_id is required")
    ok = sess.cancel(order_id=order_id)
    if not ok:
        return jsonify({"error": "order not found or not cancelable"}), 404
    return jsonify({"canceled": order_id, "last_event_id": sess.get_state().last_event_id})


@app.route("/replay/order/modify", methods=["POST"])
def replay_order_modify():
    payload = request.get_json(silent=True) or {}
    session_id = (payload.get("session_id") or "").strip()
    order_id = (payload.get("order_id") or "").strip()
    new_price = payload.get("new_price")
    sess = _get_replay_session(session_id)
    if not sess:
        return jsonify({"error": "session not found"}), 404
    if not order_id or new_price is None:
        return _bad_request("missing_params", "order_id and new_price are required")
    ok = sess.modify(order_id=order_id, new_price=float(new_price))
    if not ok:
        return jsonify({"error": "order not found or not modifiable"}), 404
    return jsonify({"modified": order_id, "new_price": float(new_price), "last_event_id": sess.get_state().last_event_id})


@app.route("/replay/end", methods=["POST"])
def replay_end():
    payload = request.get_json(silent=True) or {}
    session_id = (payload.get("session_id") or "").strip()
    sess = _get_replay_session(session_id)
    if not sess:
        return jsonify({"error": "session not found"}), 404
    # Persist an explicit end so the session is visible in history.
    try:
        sess.end()
    except Exception:
        pass
    # Remove from in-memory sessions (events remain in SQLite).
    _REPLAY_SESSIONS.pop(session_id, None)
    return jsonify({"ended": session_id})


# ---------------------------
# Replay history (UI endpoints)
# ---------------------------


@app.route("/replay/session_summaries", methods=["GET"])
def replay_session_summaries():
    """
    Returns recent replay sessions from SQLite for the chart.html History modal.
    Query params:
      - limit_sessions (default 8)
      - only_with_fills (default 1)
    """
    limit_sessions = request.args.get("limit_sessions", default="8")
    only_with_fills = request.args.get("only_with_fills", default="1")
    try:
        limit_int = max(1, min(100, int(limit_sessions)))
    except Exception:
        limit_int = 8
    try:
        only_fills = bool(int(only_with_fills))
    except Exception:
        only_fills = True

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM replay_sessions")
        total_sessions = int(cur.fetchone()[0] or 0)
        cur.execute(
            """
            SELECT COUNT(*)
            FROM replay_sessions s
            WHERE EXISTS (
              SELECT 1 FROM replay_events e
              WHERE e.session_id = s.session_id AND e.event_type = 'FILL'
            )
            """
        )
        total_with_fills = int(cur.fetchone()[0] or 0)

        where = ""
        if only_fills:
            where = "WHERE EXISTS (SELECT 1 FROM replay_events e WHERE e.session_id = s.session_id AND e.event_type = 'FILL')"

        cur.execute(
            f"""
            SELECT s.session_id, s.symbol, s.exec_tf_sec, s.disp_tf_sec, s.t_start, s.t_end, s.seed, s.status,
                   s.created_at, s.updated_at, s.summary_json
            FROM replay_sessions s
            {where}
            ORDER BY s.updated_at DESC
            LIMIT ?
            """,
            (limit_int,),
        )
        rows = cur.fetchall()

        def _safe_float(x, default=0.0):
            try:
                return float(x)
            except Exception:
                return float(default)

        def _safe_int(x, default=0):
            try:
                return int(x)
            except Exception:
                return int(default)

        sessions = []
        for idx, r in enumerate(rows):
            (
                sid,
                sym,
                exec_tf,
                disp_tf,
                t_start,
                t_end,
                seed,
                status,
                created_at,
                updated_at,
                summary_json,
            ) = r

            # Activity: count fills + some basic stats derived from fill payloads.
            cur.execute(
                """
                SELECT id, ts_exec, event_type, payload_json
                FROM replay_events
                WHERE session_id = ? AND event_type = 'FILL'
                ORDER BY id ASC
                """,
                (sid,),
            )
            fill_rows = cur.fetchall()
            fills = len(fill_rows)
            max_abs_pos = 0.0
            last_realized = None
            # Build "strip segments" (colored pills) by grouping fills into round-trips (pos -> flat).
            segs = []
            trip_idx = 0
            cur_dir = None  # 'long'|'short'
            seg_qty_peak = 0.0
            seg_adds = 0
            seg_realized_start = 0.0
            prev_pos = 0.0
            prev_realized_val = 0.0

            for (_eid, _ts, _et, payload_json) in fill_rows:
                try:
                    p = json.loads(payload_json) if payload_json else {}
                except Exception:
                    p = {}
                try:
                    q = float(p.get("position_qty") or 0.0)
                    max_abs_pos = max(max_abs_pos, abs(q))
                except Exception:
                    pass
                try:
                    last_realized = float(p.get("realized_pnl"))
                except Exception:
                    pass

                # Segment/trip logic
                pos = _safe_float(p.get("position_qty"), 0.0)
                realized_val = _safe_float(p.get("realized_pnl"), prev_realized_val)
                side = str(p.get("side") or "").lower()
                fill_qty = abs(_safe_float(p.get("qty"), 0.0))

                # If we were flat and now entered a position, start a new trip.
                if prev_pos == 0.0 and pos != 0.0:
                    trip_idx += 1
                    cur_dir = "long" if pos > 0 else "short"
                    seg_qty_peak = abs(pos)
                    seg_adds = 0
                    seg_realized_start = realized_val
                # If we stayed in a position, track peak and count "adds" when abs(pos) increases.
                if prev_pos != 0.0 and pos != 0.0:
                    seg_qty_peak = max(seg_qty_peak, abs(pos))
                    if abs(pos) > abs(prev_pos) + 1e-9:
                        seg_adds += 1
                # If we returned to flat, finalize trip segment.
                if prev_pos != 0.0 and pos == 0.0 and cur_dir is not None:
                    realized_trip = realized_val - seg_realized_start
                    segs.append(
                        {
                            "trip_index": trip_idx,
                            "dir": cur_dir,
                            "realized": realized_trip,
                            "qty_peak": seg_qty_peak,
                            "adds": seg_adds,
                        }
                    )
                    cur_dir = None
                    seg_qty_peak = 0.0
                    seg_adds = 0
                    seg_realized_start = realized_val

                prev_pos = pos
                prev_realized_val = realized_val

            realized = None
            if summary_json:
                try:
                    sj = json.loads(summary_json)
                    realized = sj.get("realized_pnl")
                except Exception:
                    realized = None
            if realized is None and last_realized is not None:
                realized = last_realized

            realized_f = None
            try:
                if realized is not None:
                    realized_f = float(realized)
            except Exception:
                realized_f = None

            # Win rate / headline
            wins = 0
            for sg in segs:
                try:
                    if float(sg.get("realized") or 0.0) > 0:
                        wins += 1
                except Exception:
                    pass
            n_trips = len(segs)
            win_rate = (wins / n_trips) if n_trips > 0 else None
            headline = None
            if realized_f is not None:
                headline = f"{'+' if realized_f >= 0 else ''}{realized_f:.2f}"

            # Duration: best-effort from timestamps; UI tolerates blank.
            duration_sec = None
            try:
                t0 = datetime.fromisoformat(str(t_start).replace("Z", "+00:00"))
                t1 = datetime.fromisoformat(str(t_end).replace("Z", "+00:00"))
                duration_sec = max(0, int((t1 - t0).total_seconds()))
            except Exception:
                duration_sec = None

            sessions.append(
                {
                    "session_id": str(sid),
                    "symbol": str(sym),
                    "label": f"S{idx+1}",
                    "exec_tf_sec": int(exec_tf),
                    "disp_tf_sec": int(disp_tf),
                    "t_start": str(t_start),
                    "t_end": str(t_end),
                    "created_at": str(created_at),
                    "updated_at": str(updated_at),
                    "status": str(status),
                    "duration_sec": duration_sec,
                    "realized": realized_f,
                    "pnl": {"realized": realized_f, "win_rate": win_rate},
                    "activity": {
                        "fills": fills,
                        "round_trips": n_trips,
                        "adds": _safe_int(sum([_safe_int(sg.get("adds"), 0) for sg in segs]), 0),
                        "max_abs_position_qty": max_abs_pos,
                    },
                    # Optional UI fields; we keep them minimal.
                    "strip": {"segments": segs},
                    "outcome": {
                        "headline": headline,
                        "confidence_hint": "History derived from FILL events",
                    },
                }
            )

        return jsonify(
            {
                "sessions": sessions,
                "total_sessions": total_sessions,
                "total_sessions_with_fills": total_with_fills,
            }
        )
    finally:
        conn.close()


@app.route("/replay/trade_ledger", methods=["GET"])
def replay_trade_ledger():
    """
    Ledger view for History modal. Derived from replay_events (FILL events).
    Query params:
      - limit_sessions (default 8)
    """
    limit_sessions = request.args.get("limit_sessions", default="8")
    try:
        limit_int = max(1, min(100, int(limit_sessions)))
    except Exception:
        limit_int = 8

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM replay_sessions")
        total_sessions = int(cur.fetchone()[0] or 0)

        cur.execute(
            """
            SELECT session_id, symbol, created_at, updated_at
            FROM replay_sessions
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (limit_int,),
        )
        sess_rows = cur.fetchall()

        sessions = []
        for i, (sid, sym, created_at, updated_at) in enumerate(sess_rows):
            cur.execute(
                """
                SELECT id, ts_exec, payload_json
                FROM replay_events
                WHERE session_id = ? AND event_type = 'FILL'
                ORDER BY id ASC
                """,
                (sid,),
            )
            fill_rows = cur.fetchall()

            prev_realized = 0.0
            rows = []
            for j, (eid, ts_exec, payload_json) in enumerate(fill_rows):
                try:
                    p = json.loads(payload_json) if payload_json else {}
                except Exception:
                    p = {}
                side = str(p.get("side") or "")
                qty = float(p.get("qty") or 0.0)
                price = float(p.get("price") or 0.0)
                signed_qty = qty if side == "buy" else -qty
                value = signed_qty * price
                realized = float(p.get("realized_pnl") or 0.0)
                realized_delta = realized - prev_realized
                prev_realized = realized

                rows.append(
                    {
                        "exec_ts": ts_exec,
                        "fill_id": int(eid),
                        "row_in_fill": 1,
                        "trade_id": j + 1,
                        "entry_type": "FILL",
                        "open_close": "",
                        "reference": str(p.get("order_id") or ""),
                        "qty": qty,
                        "signed_qty": signed_qty,
                        "price": price,
                        "value": value,
                        "realized_pnl_delta": realized_delta,
                    }
                )

            sessions.append(
                {
                    "session_id": str(sid),
                    "label": f"S{i+1}",
                    "symbol": str(sym),
                    "created_at": str(created_at),
                    "updated_at": str(updated_at),
                    "rows": rows,
                }
            )

        return jsonify({"sessions": sessions, "total_sessions": total_sessions})
    finally:
        conn.close()


@app.route("/replay/trade_matrix", methods=["GET"])
def replay_trade_matrix():
    """
    Minimal matrix endpoint for History modal.
    For now, returns sessions with empty trades (UI will render '—').
    """
    limit_sessions = request.args.get("limit_sessions", default="8")
    try:
        limit_int = max(1, min(20, int(limit_sessions)))
    except Exception:
        limit_int = 8

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT session_id, symbol, created_at
            FROM replay_sessions
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (limit_int,),
        )
        rows = cur.fetchall()
        sessions = []
        for i, (sid, sym, created_at) in enumerate(rows):
            sessions.append(
                {
                    "session_id": str(sid),
                    "label": f"S{i+1}",
                    "symbol": str(sym),
                    "created_at": str(created_at),
                    "trades": [],
                }
            )
        return jsonify({"sessions": sessions, "max_trades": 1})
    finally:
        conn.close()


@app.route("/replay/session/delete", methods=["POST"])
def replay_session_delete():
    payload = request.get_json(silent=True) or {}
    session_id = (payload.get("session_id") or "").strip()
    if not session_id:
        return _bad_request("missing_session_id", "session_id is required")

    # Remove from in-memory sessions if present.
    _REPLAY_SESSIONS.pop(session_id, None)

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        # Deleting the session cascades to replay_events via FK.
        cur.execute("DELETE FROM replay_sessions WHERE session_id = ?", (session_id,))
        conn.commit()
    finally:
        conn.close()

    return jsonify({"deleted": session_id})

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors with helpful message."""
    error_msg = f"""
    <!DOCTYPE html>
    <html>
    <head><title>404 - Page Not Found</title></head>
    <body style="font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5;">
        <h1>404 - Page Not Found</h1>
        <h2>Available Routes:</h2>
        <ul>
            <li><a href='/'>GET / - Main Dashboard</a></li>
            <li><a href='/package-proof-of-concept'>GET /package-proof-of-concept - Package POC</a></li>
            <li>GET /ticker/&lt;ticker&gt; - Ticker Detail Page (e.g., /ticker/SPY)</li>
            <li>GET /api/ticker/&lt;ticker&gt;/&lt;interval&gt; - API Endpoint</li>
            <li>POST /api/fetch-latest - Fetch Latest Data</li>
        </ul>
        <p><strong>Requested URL:</strong> {request.url}</p>
    </body>
    </html>
    """
    return error_msg, 404

if __name__ == '__main__':
    print("="*70)
    print("Starting Flask Application...")
    print("="*70)
    print(f"Available routes:")
    with app.app_context():
        for rule in app.url_map.iter_rules():
            methods = ', '.join([m for m in rule.methods if m not in ['HEAD', 'OPTIONS']])
            print(f"  {methods:20} {rule}")
    print("="*70)
    print("\nServer running at: http://127.0.0.1:5000")
    print("Main dashboard: http://127.0.0.1:5000/")
    print("Package POC:    http://127.0.0.1:5000/package-proof-of-concept")
    print("="*70)
    print()
    app.run(debug=True, host='127.0.0.1', port=5000)

