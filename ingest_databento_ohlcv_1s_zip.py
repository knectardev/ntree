"""
Ingest Databento OHLCV-1s JSON (.json.zst inside a .zip bundle) into local SQLite.

This repo's UI uses `stock_data` (SQLite) and the band chart (`/ticker/<sym>?band`) reads
bars via `/window`. This script aggregates 1-second OHLCV into:

- `interval='30Sec'` (30-second bars)  -> enables sub-minute candles in the band chart
- `interval='1Min'`  (1-minute bars)   -> keeps the rest of the app working as before

Usage (PowerShell):
  python ingest_databento_ohlcv_1s_zip.py `
    --zip "C:/local_dev/ntree/sample_data/Databento/Equities/GOOGL_JSON_6MO.zip" `
    --symbol GOOGL

Optional cleanup examples:
  # 1) RTH-only (drop pre/after-hours entirely)
  python ingest_databento_ohlcv_1s_zip.py --zip "C:/.../GOOGL_JSON_6MO.zip" --symbol GOOGL --rth-only

  # 2) Keep all sessions, but drop tiny-volume outlier prints (helps remove bogus long wicks)
  #    Example: reject >=15% jumps when the 1-second bar volume <= 200
  python ingest_databento_ohlcv_1s_zip.py --zip "C:/.../GOOGL_JSON_6MO.zip" --symbol GOOGL --reject-outlier-pct 15 --reject-max-vol 200
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sqlite3
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Iterator, Optional, Tuple

import importlib

try:
    zstd = importlib.import_module("zstandard")
except ModuleNotFoundError as e:
    raise ImportError(
        "Missing dependency 'zstandard'. Install it with: python -m pip install zstandard"
    ) from e

from database import init_database

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None


def _parse_ts_event_to_epoch_ms(ts: str) -> int:
    """
    Parse Databento nanosecond ISO timestamp like:
      2025-06-20T08:00:07.000000000Z
    into epoch milliseconds (UTC).
    """
    s = (ts or "").strip()
    if not s:
        raise ValueError("missing ts_event")
    if s.endswith("Z"):
        s = s[:-1]
    micro = 0
    if "." in s:
        main, frac = s.split(".", 1)
        digits = "".join(ch for ch in frac if ch.isdigit())
        micro = int((digits + "000000")[:6]) if digits else 0
    else:
        main = s
    dt = datetime.strptime(main, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc, microsecond=micro)
    return int(dt.timestamp() * 1000)


def _epoch_ms_to_iso_z(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class AggState:
    bucket_start_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float


def _bucket_start_ms(t_ms: int, bucket_s: int) -> int:
    step = int(bucket_s) * 1000
    return (int(t_ms) // step) * step


def _iter_databento_json_lines_from_zip(zip_path: str) -> Iterator[str]:
    with zipfile.ZipFile(zip_path) as zf:
        zst_files = [n for n in zf.namelist() if n.lower().endswith(".json.zst")]
        if not zst_files:
            raise FileNotFoundError("No .json.zst found inside zip bundle")
        # Prefer OHLCV-1s payload if multiple are present.
        zst_name = sorted(zst_files, key=lambda n: (("ohlcv-1s" not in n.lower()), n))[0]
        with zf.open(zst_name) as raw:
            dctx = zstd.ZstdDecompressor()
            with dctx.stream_reader(raw) as reader:
                text = io.TextIOWrapper(reader, encoding="utf-8")
                for line in text:
                    line = line.strip()
                    if line:
                        yield line


def _aggregate_stream(
    lines: Iterable[str],
    symbol: str,
    bucket_s: int,
    *,
    rth_only: bool = False,
    reject_outlier_pct: float = 0.0,
    reject_max_vol: float = 0.0,
    clip_ext_wicks_pct: float = 0.0,
) -> Iterator[Tuple[str, str, float, float, float, float, float]]:
    """
    Yield rows shaped for stock_data upsert:
      (ticker, timestamp_iso_z, close_price, open, high, low, volume)
    """
    sym = symbol.strip().upper()
    cur: Optional[AggState] = None
    # Anchor used for outlier detection. We intentionally update this only when volume is not "tiny"
    # so sequences of tiny-volume bad prints can't drag the reference price around.
    anchor_close: Optional[float] = None

    ny = None
    if rth_only:
        if ZoneInfo is None:
            raise RuntimeError("Python zoneinfo not available; cannot use --rth-only")
        ny = ZoneInfo("America/New_York")
    elif clip_ext_wicks_pct and clip_ext_wicks_pct > 0:
        if ZoneInfo is None:
            raise RuntimeError("Python zoneinfo not available; cannot use --clip-ext-wicks-pct")
        ny = ZoneInfo("America/New_York")

    def _maybe_clip_extended_wicks(bar: AggState) -> None:
        if not (clip_ext_wicks_pct and clip_ext_wicks_pct > 0 and ny is not None):
            return
        # Only apply to pre/after-hours (leave RTH untouched).
        dt_ny = datetime.fromtimestamp(bar.bucket_start_ms / 1000, tz=timezone.utc).astimezone(ny)
        hhmmss = dt_ny.hour * 3600 + dt_ny.minute * 60 + dt_ny.second
        is_pre = (4 * 3600) <= hhmmss < (9 * 3600 + 30 * 60)
        is_after = (16 * 3600) <= hhmmss <= (20 * 3600)
        if not (is_pre or is_after):
            return
        pct = float(clip_ext_wicks_pct) / 100.0
        body_lo = min(float(bar.open), float(bar.close))
        body_hi = max(float(bar.open), float(bar.close))
        if body_hi > 0 and float(bar.high) > body_hi * (1.0 + pct):
            bar.high = body_hi
        if body_lo > 0 and float(bar.low) < body_lo * (1.0 - pct):
            bar.low = body_lo
        if float(bar.high) < float(bar.low):
            bar.high = body_hi
            bar.low = body_lo

    for line in lines:
        try:
            j = json.loads(line)
        except Exception:
            continue
        jsym = str(j.get("symbol") or "").strip().upper()
        if sym and jsym and jsym != sym:
            continue
        hd = j.get("hd") or {}
        ts_event = hd.get("ts_event")
        if not ts_event:
            continue
        try:
            t_ms = _parse_ts_event_to_epoch_ms(str(ts_event))
        except Exception:
            continue

        try:
            o = float(j.get("open"))
            h = float(j.get("high"))
            l = float(j.get("low"))
            c = float(j.get("close"))
        except Exception:
            continue
        try:
            v = float(j.get("volume") or 0)
        except Exception:
            v = 0.0

        # Optional: keep only Regular Trading Hours (09:30–16:00 America/New_York).
        if rth_only:
            dt_ny = datetime.fromtimestamp(t_ms / 1000, tz=timezone.utc).astimezone(ny)
            hhmmss = dt_ny.hour * 3600 + dt_ny.minute * 60 + dt_ny.second
            if hhmmss < (9 * 3600 + 30 * 60) or hhmmss > (16 * 3600):
                continue

        # Optional: reject tiny-volume outlier prints (common in extended hours).
        #
        # Important: 1-second OHLCV bars can have a normal close but a bogus low/high (single bad trade),
        # which creates long wicks at 30s. So we evaluate *extremes*, not only close-to-close jumps.
        if (
            reject_outlier_pct
            and reject_outlier_pct > 0
            and reject_max_vol
            and reject_max_vol > 0
        ):
            thr = reject_outlier_pct / 100.0
            # Initialize anchor as soon as we see a valid close.
            if anchor_close is None and c and float(c) > 0:
                anchor_close = float(c)

            # If this is NOT tiny volume, treat it as trustworthy enough to refresh the anchor.
            if anchor_close is not None and v > reject_max_vol:
                anchor_close = float(c)

            # Only apply outlier logic to tiny-volume bars, using the stable anchor.
            if anchor_close is not None and anchor_close > 0 and v <= reject_max_vol:

                def _dev(x: float) -> float:
                    try:
                        return abs(float(x) - float(anchor_close)) / float(anchor_close)
                    except Exception:
                        return 0.0

                dev_o = _dev(o)
                dev_h = _dev(h)
                dev_l = _dev(l)
                dev_c = _dev(c)

                # If the close itself is a large jump, treat it as a bad print and skip the whole 1s bar.
                if dev_c >= thr:
                    continue

                # If close looks fine but O/H/L are outliers vs anchor, replace those outlier legs
                # with the close. This handles pathological 1s bars like:
                #   o=166, h=267, l=166, c=267  (tiny volume)
                # where using the {open,close} "body" would otherwise preserve the outlier open/low.
                if dev_o >= thr:
                    o = c
                if dev_h >= thr:
                    h = c
                if dev_l >= thr:
                    l = c

                # Suspicious internal extremes: clamp wick(s) relative to own close as a second line of defense.
                body_lo = min(o, c)
                body_hi = max(o, c)
                try:
                    c0 = float(c)
                    if c0 != 0:
                        dev_hi_self = abs(float(h) - c0) / abs(c0)
                        dev_lo_self = abs(float(l) - c0) / abs(c0)
                    else:
                        dev_hi_self = 0.0
                        dev_lo_self = 0.0
                except Exception:
                    dev_hi_self = 0.0
                    dev_lo_self = 0.0

                if dev_lo_self >= thr:
                    l = body_lo
                if dev_hi_self >= thr:
                    h = body_hi
                if h < l:
                    h = body_hi
                    l = body_lo

        b0 = _bucket_start_ms(t_ms, bucket_s=bucket_s)
        if cur is None:
            cur = AggState(bucket_start_ms=b0, open=o, high=h, low=l, close=c, volume=v)
            continue
        if b0 != cur.bucket_start_ms:
            _maybe_clip_extended_wicks(cur)
            ts_iso = _epoch_ms_to_iso_z(cur.bucket_start_ms)
            yield (sym or jsym, ts_iso, float(cur.close), float(cur.open), float(cur.high), float(cur.low), float(cur.volume))
            cur = AggState(bucket_start_ms=b0, open=o, high=h, low=l, close=c, volume=v)
            continue
        # same bucket
        cur.high = max(cur.high, h)
        cur.low = min(cur.low, l)
        cur.close = c
        cur.volume += v

    if cur is not None:
        _maybe_clip_extended_wicks(cur)
        ts_iso = _epoch_ms_to_iso_z(cur.bucket_start_ms)
        yield (sym, ts_iso, float(cur.close), float(cur.open), float(cur.high), float(cur.low), float(cur.volume))


def _upsert_rows(
    conn: sqlite3.Connection,
    rows: Iterable[Tuple[str, str, float, float, float, float, float]],
    interval: str,
    batch_size: int = 20_000,
) -> int:
    cur = conn.cursor()
    n = 0
    buf = []
    sql = """
        INSERT OR REPLACE INTO stock_data
        (ticker, timestamp, price, open_price, high_price, low_price, volume, interval)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """
    for (ticker, ts, price, o, h, l, v) in rows:
        buf.append((ticker, ts, price, o, h, l, v, interval))
        if len(buf) >= batch_size:
            cur.executemany(sql, buf)
            conn.commit()
            n += len(buf)
            buf.clear()
    if buf:
        cur.executemany(sql, buf)
        conn.commit()
        n += len(buf)
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", dest="zip_path", required=True, help="Path to Databento zip bundle (contains *.ohlcv-1s.json.zst)")
    ap.add_argument("--symbol", required=True, help="Ticker symbol to ingest (e.g. GOOGL)")
    ap.add_argument("--db", default="stock_data.db", help="SQLite DB path (default: stock_data.db in repo root)")
    ap.add_argument("--no-1min", action="store_true", help="Only write 30Sec bars (skip 1Min materialization)")
    ap.add_argument("--rth-only", action="store_true", help="Only keep Regular Trading Hours (09:30–16:00 ET). Drops pre/after-hours bars.")
    ap.add_argument("--reject-outlier-pct", type=float, default=0.0, help="Reject 1s bars whose close deviates >= this %% from last good close (requires --reject-max-vol).")
    ap.add_argument("--reject-max-vol", type=float, default=0.0, help="Only reject outliers when 1s bar volume <= this threshold (used with --reject-outlier-pct).")
    ap.add_argument("--clip-ext-wicks-pct", type=float, default=0.0, help="In extended hours only (pre/after), clamp wicks larger than this %% to the bar body (Webull-like).")
    ap.add_argument("--batch", type=int, default=20_000, help="SQLite executemany batch size (default: 20000)")
    args = ap.parse_args()

    zip_path = os.path.abspath(args.zip_path)
    if not os.path.exists(zip_path):
        raise FileNotFoundError(zip_path)

    # Ensure schema exists.
    init_database()

    db_path = os.path.abspath(args.db)
    conn = sqlite3.connect(db_path)
    try:
        # 30-second bars
        lines = _iter_databento_json_lines_from_zip(zip_path)
        rows_30 = _aggregate_stream(
            lines,
            symbol=args.symbol,
            bucket_s=30,
            rth_only=bool(args.rth_only),
            reject_outlier_pct=float(args.reject_outlier_pct or 0.0),
            reject_max_vol=float(args.reject_max_vol or 0.0),
            clip_ext_wicks_pct=float(args.clip_ext_wicks_pct or 0.0),
        )
        n30 = _upsert_rows(conn, rows_30, interval="30Sec", batch_size=int(args.batch))
        print(f"[OK] inserted/updated {n30:,} rows into stock_data (interval=30Sec)")

        # Optional 1-minute bars (compat with legacy UI paths)
        if not args.no_1min:
            lines2 = _iter_databento_json_lines_from_zip(zip_path)
            rows_60 = _aggregate_stream(
                lines2,
                symbol=args.symbol,
                bucket_s=60,
                rth_only=bool(args.rth_only),
                reject_outlier_pct=float(args.reject_outlier_pct or 0.0),
                reject_max_vol=float(args.reject_max_vol or 0.0),
                clip_ext_wicks_pct=float(args.clip_ext_wicks_pct or 0.0),
            )
            n60 = _upsert_rows(conn, rows_60, interval="1Min", batch_size=int(args.batch))
            print(f"[OK] inserted/updated {n60:,} rows into stock_data (interval=1Min)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()


