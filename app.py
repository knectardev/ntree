from flask import Flask, render_template, jsonify, request
from database import get_db_connection, init_database
from datetime import datetime, timedelta, timezone
import alpaca_trade_api as tradeapi
import time
import pandas as pd
try:
    import pandas_ta as ta
except ImportError:
    ta = None
import math
from utils import calculate_vwap_per_trading_day, get_market_hours_info, get_market_open_times

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

# --- Strategy utilities (v1: EMA + VWAP pullback) ---
def _clean_series(series):
    """Convert a pandas Series to list with None for nan/NaT."""
    return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else v for v in series]


def build_regular_mask(timestamps, market_hours=None):
    """Return a pandas Series boolean mask for regular sessions aligned to timestamps."""
    try:
        idx = pd.to_datetime(timestamps)
    except Exception:
        return None

    mask = pd.Series(False, index=idx)
    if market_hours:
        for period in market_hours:
            if period.get('type') != 'regular':
                continue
            start = period.get('start')
            end = period.get('end')
            try:
                start_dt = pd.to_datetime(start)
                end_dt = pd.to_datetime(end)
                mask |= (idx >= start_dt) & (idx <= end_dt)
            except Exception:
                continue

    # If no regular periods resolved, fall back to naive time-of-day filter (ET-like)
    if not mask.any():
        rth_mask = (
            ((idx.hour > 9) | ((idx.hour == 9) & (idx.minute >= 30))) &
            ((idx.hour < 16) | ((idx.hour == 16) & (idx.minute == 0)))
        )
        mask = pd.Series(rth_mask, index=idx)

    return mask


def compute_strategy_signals(df_prices, rth_mask=None):
    """
    EMA + VWAP pullback v1.3
    - RTH only (via rth_mask)
    - Trend: ema21 > vwap and ema21 slope > 0
    - Pullback: at least 2 of last 3 bars closed below ema9
    - Entry: close crosses up through ema9
    - Throttle: at most one entry every 20 bars
    """
    if df_prices is None or df_prices.empty:
        return {}

    df = df_prices.copy()
    df.index = pd.to_datetime(df.index)

    # RTH mask (prefer provided mask; fallback to naive)
    idx = df.index
    if rth_mask is not None:
        try:
            rth_mask = pd.Series(rth_mask, index=idx)
        except Exception:
            pass
    if rth_mask is None or len(rth_mask) != len(df):
        rth_mask = (
            ((idx.hour > 9) | ((idx.hour == 9) & (idx.minute >= 30))) &
            ((idx.hour < 16) | ((idx.hour == 16) & (idx.minute == 0)))
        )
        rth_mask = pd.Series(rth_mask, index=idx)
    if isinstance(rth_mask, pd.Series):
        rth_mask = rth_mask.astype(bool)

    # Compute indicators (reuse existing columns when present)
    if 'ema9' not in df.columns or 'ema21' not in df.columns:
        if ta:
            df['ema9'] = ta.ema(df['close'], length=9)
            df['ema21'] = ta.ema(df['close'], length=21)
        else:
            df['ema9'] = df['close'].ewm(span=9, adjust=False).mean()
            df['ema21'] = df['close'].ewm(span=21, adjust=False).mean()

    if 'vwap' not in df.columns:
        vwap_series = calculate_vwap_per_trading_day(df.rename(columns={
            'open': 'open',
            'high': 'high',
            'low': 'low',
            'close': 'close',
            'volume': 'volume'
        }))
        df['vwap'] = vwap_series

    close = df['close']
    ema9 = df['ema9']
    ema21 = df['ema21']
    vwap = df['vwap']

    # Trend filter: EMA21 above VWAP and sloping up
    ema21_slope = ema21 - ema21.shift(5)
    trend = (ema21 > vwap) & (ema21_slope > 0)

    # Pullback: at least 2 of last 3 bars below EMA9
    below_fast = close < ema9
    pullback = below_fast.rolling(window=3, min_periods=3).sum() >= 2

    # Cross-up through ema9
    cross_up = (close > ema9) & (close.shift(1) <= ema9.shift(1))

    # preliminary signal
    pre_signal = trend & pullback & cross_up & rth_mask

    # Throttle: at most one entry every 20 bars (keep the first)
    recent_signal = pre_signal.shift(1).rolling(window=20, min_periods=1).max().fillna(False)
    if isinstance(recent_signal, pd.Series):
        recent_signal = recent_signal.astype(bool)
    long_entry = pre_signal & (~recent_signal)

    entry_price = df['open'].shift(-1)

    return {
        'long_entry': [bool(x) if pd.notna(x) else False for x in long_entry],
        'entry_price': _clean_series(entry_price),
        'ema9': _clean_series(ema9),
        'ema21': _clean_series(ema21),
        'vwap': _clean_series(vwap),
        'timestamp': [ts.isoformat() for ts in df.index]
    }


def compute_vwap_crossover_signals(df_prices, rth_mask=None):
    """
    VWAP cross-over v1
    - RTH only (via rth_mask)
    - Intersection: VWAP crosses down from above both EMA9 and EMA21
    - Follow-through: EMA9, EMA21, and VWAP slopes positive for at least 8 bars
    - Entry at next bar open
    """
    if df_prices is None or df_prices.empty:
        return {}

    df = df_prices.copy()
    df.index = pd.to_datetime(df.index)
    idx = df.index

    # RTH mask
    if rth_mask is not None:
        try:
            rth_mask = pd.Series(rth_mask, index=idx)
        except Exception:
            rth_mask = None
    if rth_mask is None or len(rth_mask) != len(df):
        rth_mask = (
            ((idx.hour > 9) | ((idx.hour == 9) & (idx.minute >= 30))) &
            ((idx.hour < 16) | ((idx.hour == 16) & (idx.minute == 0)))
        )
        rth_mask = pd.Series(rth_mask, index=idx)
    if isinstance(rth_mask, pd.Series):
        rth_mask = rth_mask.astype(bool)

    # Indicators (reuse if present)
    if 'ema9' not in df.columns or 'ema21' not in df.columns:
        if ta:
            df['ema9'] = ta.ema(df['close'], length=9)
            df['ema21'] = ta.ema(df['close'], length=21)
        else:
            df['ema9'] = df['close'].ewm(span=9, adjust=False).mean()
            df['ema21'] = df['close'].ewm(span=21, adjust=False).mean()

    if 'vwap' not in df.columns:
        vwap_series = calculate_vwap_per_trading_day(df.rename(columns={
            'open': 'open',
            'high': 'high',
            'low': 'low',
            'close': 'close',
            'volume': 'volume'
        }))
        df['vwap'] = vwap_series

    close = df['close']
    ema9 = df['ema9']
    ema21 = df['ema21']
    vwap = df['vwap']

    # Intersection: VWAP crosses down from above both EMA9 and EMA21
    cross_down = (
        (vwap < ema9) & (vwap < ema21) &
        (vwap.shift(1) >= ema9.shift(1)) &
        (vwap.shift(1) >= ema21.shift(1))
    )

    # Slopes positive (follow-through) for at least 8 bars
    slope9 = ema9.diff()
    slope21 = ema21.diff()
    slope_vwap = vwap.diff()
    slopes_pos = (slope9 > 0) & (slope21 > 0) & (slope_vwap > 0)
    slope_run = slopes_pos.rolling(window=8, min_periods=8).sum() == 8

    pre_signal = cross_down & slope_run & rth_mask

    # Entry at next bar open
    entry_price = df['open'].shift(-1)

    return {
        'long_entry': [bool(x) if pd.notna(x) else False for x in pre_signal],
        'entry_price': _clean_series(entry_price),
        'ema9': _clean_series(ema9),
        'ema21': _clean_series(ema21),
        'vwap': _clean_series(vwap),
        'timestamp': [ts.isoformat() for ts in df.index]
    }


def compute_vwap_ema_crossover_signals(df_prices, rth_mask=None):
    """
    VWAP / EMA crossover (simple): mark every intersection between VWAP and EMA21.
    - Uses provided rth_mask; if none, allows all sessions (pre/after-hours included)
    - Intersection when sign of (vwap - ema21) changes from prior bar
    """
    if df_prices is None or df_prices.empty:
        return {}

    df = df_prices.copy()
    df.index = pd.to_datetime(df.index)
    idx = df.index

    # Session mask: use provided; otherwise keep all sessions (including off-hours)
    if rth_mask is not None:
        try:
            rth_mask = pd.Series(rth_mask, index=idx).astype(bool)
        except Exception:
            rth_mask = None
    if rth_mask is None or len(rth_mask) != len(df):
        rth_mask = pd.Series([True] * len(df), index=idx)

    # Indicators (reuse existing)
    if 'ema21' not in df.columns:
        if ta:
            df['ema21'] = ta.ema(df['close'], length=21)
        else:
            df['ema21'] = df['close'].ewm(span=21, adjust=False).mean()
    if 'vwap' not in df.columns:
        vwap_series = calculate_vwap_per_trading_day(df.rename(columns={
            'open': 'open',
            'high': 'high',
            'low': 'low',
            'close': 'close',
            'volume': 'volume'
        }))
        df['vwap'] = vwap_series

    ema21 = df['ema21']
    vwap = df['vwap']

    diff = vwap - ema21
    prev_diff = diff.shift(1)
    cross = (diff.notna() & prev_diff.notna()) & (diff * prev_diff <= 0) & (diff != prev_diff)
    long_entry = cross & rth_mask

    # Direction: bullish if VWAP dips below EMA21 on/after cross; bearish otherwise
    direction = []
    cross_y = []
    for curr_diff, curr_vwap, curr_ema in zip(diff, vwap, ema21):
        if pd.isna(curr_diff) or pd.isna(curr_vwap) or pd.isna(curr_ema):
            direction.append(None)
            cross_y.append(None)
            continue
        direction.append('bullish' if curr_diff < 0 else 'bearish')
        cross_y.append(float((curr_vwap + curr_ema) / 2.0))

    entry_price = df['open'].shift(-1)

    return {
        'long_entry': [bool(x) if pd.notna(x) else False for x in long_entry],
        'direction': direction,
        'cross_y': cross_y,
        'entry_price': _clean_series(entry_price),
        'ema21': _clean_series(ema21),
        'vwap': _clean_series(vwap),
        'timestamp': [ts.isoformat() for ts in df.index]
    }


def simple_backtest(df_prices, signals, fee_bp=0.0):
    """
    Toy backtest: enter next bar open, exit same-bar close (shifted),
    subtract fee basis points.
    """
    if df_prices is None or df_prices.empty or not signals:
        return {
            "n_trades": 0,
            "win_rate": None,
            "avg_ret": None,
            "median_ret": None
        }

    df = df_prices.copy()
    df['long_entry'] = signals.get('long_entry', [])
    df['entry_price'] = df['open'].shift(-1)
    df['exit_price'] = df['close'].shift(-1)

    trades = df[df['long_entry'] == True].copy()  # noqa: E712
    trades['ret'] = (trades['exit_price'] - trades['entry_price']) / trades['entry_price']
    trades['ret'] -= fee_bp / 10000.0

    if len(trades) == 0:
        return {
            "n_trades": 0,
            "win_rate": None,
            "avg_ret": None,
            "median_ret": None
        }

    return {
        "n_trades": int(len(trades)),
        "win_rate": float((trades['ret'] > 0).mean()),
        "avg_ret": float(trades['ret'].mean()),
        "median_ret": float(trades['ret'].median())
    }

# Initialize database on startup
init_database()

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

@app.route('/ticker/<ticker>')
def ticker_detail(ticker):
    """Detail view for a specific ticker."""
    from flask import request
    interval = request.args.get('interval', '1Min')
    return render_template('detail.html', ticker=ticker, interval=interval)

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
    
    # Get all data for the ticker and interval with OHLC data and technical indicators
    cursor.execute('''
        SELECT timestamp, price, open_price, high_price, low_price, volume, 
               ema_9, ema_21, ema_50, vwap,
               ta_ema_9, ta_ema_21, ta_ema_50, ta_vwap
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

    # Use stored Alpaca indicators
    indicators_alpaca = {
        'ema_9': [row[6] if row[6] is not None else None for row in results],
        'ema_21': [row[7] if row[7] is not None else None for row in results],
        'ema_50': [row[8] if row[8] is not None else None for row in results],
        'vwap': [row[9] if row[9] is not None else None for row in results]
    }

    # Start with stored pandas_ta indicators if present
    indicators_ta = {
        'ema_9': [row[10] if row[10] is not None else None for row in results],
        'ema_21': [row[11] if row[11] is not None else None for row in results],
        'ema_50': [row[12] if row[12] is not None else None for row in results],
        'vwap': [row[13] if row[13] is not None else None for row in results],
        'macd': [row[14] if len(row) > 14 and row[14] is not None else None for row in results],
        'macd_signal': [row[15] if len(row) > 15 and row[15] is not None else None for row in results]
    }

    # If we have missing pandas_ta values, compute on the fly
    needs_ta = any((v is None) for series in indicators_ta.values() for v in series)
    if needs_ta and len(ohlc) > 0:
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
    else:
        # Ensure JSON-serializable if we used stored values
        indicators_ta = {
            key: [None if v is None or (isinstance(v, float) and pd.isna(v)) else v for v in series]
            for key, series in indicators_ta.items()
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

    # Build strategy signals (EMA + VWAP pullback v1)
    strategy_payload = {}
    regular_mask = build_regular_mask(timestamps, market_hours)
    try:
        df_strategy = pd.DataFrame(ohlc)
        df_strategy.index = pd.to_datetime(timestamps)
        signals_pullback = compute_strategy_signals(df_strategy, rth_mask=regular_mask)
        if signals_pullback:
            strategy_payload['ema_vwap_pullback_v1'] = signals_pullback

        signals_vwap_cross = compute_vwap_crossover_signals(df_strategy, rth_mask=regular_mask)
        if signals_vwap_cross:
            strategy_payload['vwap_crossover_v1'] = signals_vwap_cross

        # Allow off-hours for the simple VWAP/EMA crossover
        signals_vwap_ema_cross = compute_vwap_ema_crossover_signals(df_strategy, rth_mask=None)
        if signals_vwap_ema_cross:
            strategy_payload['vwap_ema_crossover_v1'] = signals_vwap_ema_cross
    except Exception as e:
        # Keep strategies empty if anything fails; don't break main payload
        strategy_payload = {}

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
        'indicators': {k: _clean(v) for k, v in indicators_alpaca.items()},
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
        'strategies': strategy_payload
    }
    
    return jsonify(data)


@app.route('/api/strategy/<name>/backtest', methods=['POST'])
def run_strategy_backtest(name):
    """Run a simple backtest for a supported strategy."""
    payload = request.get_json(silent=True) or {}
    ticker = payload.get('ticker')
    interval = payload.get('interval', '1Min')
    fee_bp = float(payload.get('fee_bp', 0.0) or 0.0)

    supported = {
        'ema_vwap_pullback_v1': compute_strategy_signals,
        'vwap_crossover_v1': compute_vwap_crossover_signals,
        'vwap_ema_crossover_v1': compute_vwap_ema_crossover_signals
    }

    if name not in supported:
        return jsonify({'error': 'Unsupported strategy'}), 400

    if not ticker:
        return jsonify({'error': 'ticker required'}), 400

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
        return jsonify({'error': 'no data'}), 404

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

    # Allow off-hours for VWAP/EMA crossover
    if name == 'vwap_ema_crossover_v1':
        signals = supported[name](df, rth_mask=None)
    else:
        signals = supported[name](df, rth_mask=regular_mask)
    metrics = simple_backtest(df, signals, fee_bp=fee_bp)

    return jsonify({
        'strategy': name,
        'ticker': ticker,
        'interval': interval,
        'metrics': metrics,
        'n_bars': len(df),
        'generated_at': datetime.now(timezone.utc).isoformat()
    })

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
                    
                    # Calculate technical indicators
                    bars['ema_9'] = bars['close'].ewm(span=9, adjust=False).mean()
                    bars['ema_21'] = bars['close'].ewm(span=21, adjust=False).mean()
                    bars['ema_50'] = bars['close'].ewm(span=50, adjust=False).mean()
                    bars['ta_ema_9'] = ta.ema(bars['close'], length=9)
                    bars['ta_ema_21'] = ta.ema(bars['close'], length=21)
                    bars['ta_ema_50'] = ta.ema(bars['close'], length=50)
                    
                    # Calculate VWAP per trading day (resets at market open each day)
                    bars['vwap'] = calculate_vwap_per_trading_day(bars)
                    bars['ta_vwap'] = calculate_vwap_per_trading_day(bars)
                    
                    # Insert data into database
                    for timestamp, row in bars.iterrows():
                        try:
                            cursor.execute('''
                                INSERT OR REPLACE INTO stock_data 
                                (ticker, timestamp, price, open_price, high_price, low_price, volume, 
                                 interval, ema_9, ema_21, ema_50, vwap,
                                 ta_ema_9, ta_ema_21, ta_ema_50, ta_vwap)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ''', (
                                ticker,
                                timestamp.isoformat(),
                                float(row['close']),
                                float(row['open']),
                                float(row['high']),
                                float(row['low']),
                                float(row['volume']) if 'volume' in row and pd.notna(row['volume']) else None,
                                interval,
                                float(row['ema_9']) if pd.notna(row['ema_9']) else None,
                                float(row['ema_21']) if pd.notna(row['ema_21']) else None,
                                float(row['ema_50']) if pd.notna(row['ema_50']) else None,
                                float(row['vwap']) if 'vwap' in row and pd.notna(row['vwap']) else None,
                                float(row['ta_ema_9']) if 'ta_ema_9' in row and pd.notna(row['ta_ema_9']) else None,
                                float(row['ta_ema_21']) if 'ta_ema_21' in row and pd.notna(row['ta_ema_21']) else None,
                                float(row['ta_ema_50']) if 'ta_ema_50' in row and pd.notna(row['ta_ema_50']) else None,
                                float(row['ta_vwap']) if 'ta_vwap' in row and pd.notna(row['ta_vwap']) else None
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

