from flask import Flask, render_template, jsonify, request
from database import get_db_connection, init_database, get_synthetic_datasets
from datetime import datetime, timedelta, timezone
import alpaca_trade_api as tradeapi
import time
import pandas as pd
import json
from typing import Optional
try:
    import pandas_ta as ta
except ImportError:
    ta = None
import math
from utils import calculate_vwap_per_trading_day, get_market_hours_info, get_market_open_times
from strategies import compute_vwap_ema_crossover_signals, compute_fools_paradise_signals, STRATEGY_REGISTRY, build_regular_mask
from backtesting import run_backtest, RiskRewardExecutionModel
from candlestick_analysis import compute_candlestick_bias, count_pattern_instances

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


@app.route('/')
def index():
    """Main page showing grid of tickers with latest prices."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get latest price for each ticker
    tickers_data = []
    for ticker in ['SPY', 'QQQ']:
        cursor.execute('''
            SELECT ticker, price, timestamp, interval
            FROM stock_data
            WHERE ticker = ?
            ORDER BY timestamp DESC
            LIMIT 1
        ''', (ticker,))
        
        result = cursor.fetchone()
        if result:
            tickers_data.append({
                'ticker': result[0],
                'price': result[1],
                'timestamp': result[2],
                'interval': result[3]
            })
        else:
            tickers_data.append({
                'ticker': ticker,
                'price': None,
                'timestamp': None,
                'interval': None
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

@app.route("/api/synthetic_datasets")
def api_synthetic_datasets():
    """List available synthetic datasets (symbol/scenario/timeframe groups)."""
    datasets = get_synthetic_datasets()
    return jsonify(datasets)


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
    from flask import request
    interval = request.args.get('interval', '1Min')
    return render_template(
        'detail.html',
        ticker=ticker,
        interval=interval,
        is_synthetic=False,
        scenario=None,
        timeframe=_timeframe_from_interval(interval),
    )


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


def perform_strategy_backtest(name, ticker, interval, fee_bp, risk_percent, reward_multiple):
    """Shared backtest execution used by multiple endpoints."""
    supported = STRATEGY_REGISTRY

    if name not in supported:
        raise ValueError('Unsupported strategy')
    if not ticker:
        raise ValueError('ticker required')

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT timestamp, price, open_price, high_price, low_price, volume
        FROM stock_data
        WHERE ticker = ? AND interval = ?
        ORDER BY timestamp ASC
    ''', (ticker, interval))
    results = cursor.fetchall()
    conn.close()

    if not results:
        raise LookupError('no data')

    timestamps = [row[0] for row in results]
    market_hours = get_market_hours_info(timestamps)
    regular_mask = build_regular_mask(timestamps, market_hours)
    ohlc = [
        {
            'open': row[2] if row[2] is not None else row[1],
            'high': row[3] if row[3] is not None else row[1],
            'low': row[4] if row[4] is not None else row[1],
            'close': row[1],
            'volume': row[5] if row[5] is not None else 0
        }
        for row in results
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
    cursor.execute('''
        SELECT timestamp, price, open_price, high_price, low_price, volume
        FROM stock_data
        WHERE ticker = ? AND interval = ?
        ORDER BY timestamp ASC
    ''', (ticker, interval))
    
    results = cursor.fetchall()
    conn.close()
    
    timestamps = [row[0] for row in results]
    market_hours = get_market_hours_info(timestamps)
    market_opens = get_market_open_times(timestamps)

    ohlc = [
        {
            'open': row[2] if row[2] is not None else row[1],
            'high': row[3] if row[3] is not None else row[1],
            'low': row[4] if row[4] is not None else row[1],
            'close': row[1],
            'volume': row[5] if row[5] is not None else 0
        }
        for row in results
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
            strategy_payload['vwap_ema_crossover_v1'] = signals_vwap_ema_cross
        
        # Compute Fools Paradise strategy signals
        signals_fools_paradise = compute_fools_paradise_signals(df_strategy, rth_mask=None)
        if signals_fools_paradise:
            strategy_payload['fools_paradise'] = signals_fools_paradise
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
        'prices': _clean([row[1] for row in results]),
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
            reward_multiple=reward_multiple
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
                reward_multiple=reward_multiple
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
            reward_multiple=bt['reward_multiple']
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
        
        if latest_timestamp:
            # Start from the latest timestamp (add 1 minute to avoid duplicates)
            try:
                start_time = datetime.fromisoformat(latest_timestamp.replace('Z', '+00:00'))
                start_time = start_time + timedelta(minutes=1)  # Start 1 minute after last record
            except:
                # Fallback: use 1 day ago if timestamp parsing fails
                start_time = end_time - timedelta(days=1)
        else:
            # No data exists, fetch last 5 days
            start_time = end_time - timedelta(days=5)
        
        # Format as RFC3339 strings
        start_str = start_time.strftime('%Y-%m-%dT%H:%M:%SZ')
        end_str = end_time.strftime('%Y-%m-%dT%H:%M:%SZ')
        
        TICKERS = ['SPY', 'QQQ']
        INTERVALS = ['1Min', '5Min']
        
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
                    time.sleep(0.5)  # Rate limiting
                    
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

