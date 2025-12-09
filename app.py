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
from strategies import compute_vwap_ema_crossover_signals, compute_fools_paradise_signals, STRATEGY_REGISTRY, build_regular_mask
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

# Strategy functions are now imported from the strategies package


def simple_backtest(df_prices, signals, fee_bp=0.0, risk_percent=0.5):
    """
    Backtest with 2:1 profit-to-loss ratio.
    - Enters at next bar open after signal
    - Stop loss: entry_price * (1 - risk_percent)
    - Take profit: entry_price * (1 + 2 * risk_percent)
    - Exits when stop loss or take profit is hit, or at end of data
    - Subtracts fee basis points from returns
    """
    if df_prices is None or df_prices.empty or not signals:
        return {
            "n_trades": 0,
            "win_rate": None,
            "avg_ret": None,
            "median_ret": None
        }

    df = df_prices.copy()
    long_entry_signals = signals.get('long_entry', [])
    directions = signals.get('direction', [None] * len(df))
    
    # Ensure we have OHLC data
    if 'open' not in df.columns or 'high' not in df.columns or \
       'low' not in df.columns or 'close' not in df.columns:
        return {
            "n_trades": 0,
            "win_rate": None,
            "avg_ret": None,
            "median_ret": None
        }
    
    # Convert risk_percent to decimal (e.g., 0.5% -> 0.005)
    risk = risk_percent / 100.0
    
    trades = []
    i = 0
    while i < len(df):
        # Look for entry signal
        if i < len(long_entry_signals) and long_entry_signals[i]:
            # Entry at next bar's open
            if i + 1 < len(df):
                entry_idx = i + 1
                entry_price = df.iloc[entry_idx]['open']
                
                # Determine if this is a long or short position
                direction = directions[i] if i < len(directions) else 'bullish'
                is_long = direction == 'bullish'
                
                # Calculate stop loss and take profit
                if is_long:
                    # Long position: stop loss below, take profit above
                    stop_loss = entry_price * (1 - risk)
                    take_profit = entry_price * (1 + 2 * risk)
                else:
                    # Short position: stop loss above, take profit below
                    stop_loss = entry_price * (1 + risk)
                    take_profit = entry_price * (1 - 2 * risk)
                
                # Track position until exit
                exit_idx = None
                exit_price = None
                exit_reason = None
                
                # Check each bar after entry for stop loss or take profit
                for j in range(entry_idx + 1, len(df)):
                    bar_high = df.iloc[j]['high']
                    bar_low = df.iloc[j]['low']
                    bar_open = df.iloc[j]['open']
                    
                    # Check if both could be hit in the same bar
                    if is_long:
                        # Long position: take profit hit when high >= target, stop loss when low <= stop
                        hit_take_profit = bar_high >= take_profit
                        hit_stop_loss = bar_low <= stop_loss
                    else:
                        # Short position: take profit hit when low <= target, stop loss when high >= stop
                        hit_take_profit = bar_low <= take_profit
                        hit_stop_loss = bar_high >= stop_loss
                    
                    if hit_take_profit and hit_stop_loss:
                        # Both could be hit - determine which was hit first based on bar open
                        # If open is closer to take_profit, assume take_profit hit first
                        dist_to_tp = abs(bar_open - take_profit)
                        dist_to_sl = abs(bar_open - stop_loss)
                        if dist_to_tp <= dist_to_sl:
                            exit_idx = j
                            exit_price = take_profit
                            exit_reason = 'take_profit'
                            break
                        else:
                            exit_idx = j
                            exit_price = stop_loss
                            exit_reason = 'stop_loss'
                            break
                    elif hit_take_profit:
                        exit_idx = j
                        exit_price = take_profit
                        exit_reason = 'take_profit'
                        break
                    elif hit_stop_loss:
                        exit_idx = j
                        exit_price = stop_loss
                        exit_reason = 'stop_loss'
                        break
                
                # If neither was hit, exit at last bar's close
                if exit_idx is None:
                    exit_idx = len(df) - 1
                    exit_price = df.iloc[exit_idx]['close']
                    exit_reason = 'end_of_data'
                
                # Calculate return (for shorts, profit when price goes down)
                if is_long:
                    ret = (exit_price - entry_price) / entry_price
                else:
                    ret = (entry_price - exit_price) / entry_price
                ret -= fee_bp / 10000.0
                
                trades.append({
                    'entry_idx': entry_idx,
                    'exit_idx': exit_idx,
                    'entry_price': entry_price,
                    'exit_price': exit_price,
                    'ret': ret,
                    'exit_reason': exit_reason
                })
                
                # Move to after exit to avoid overlapping trades
                i = exit_idx + 1
            else:
                i += 1
        else:
            i += 1
    
    if len(trades) == 0:
        return {
            "n_trades": 0,
            "win_rate": None,
            "avg_ret": None,
            "median_ret": None
        }
    
    # Calculate metrics
    returns = [t['ret'] for t in trades]
    win_rate = sum(1 for r in returns if r > 0) / len(returns) if returns else 0.0
    avg_ret = sum(returns) / len(returns) if returns else 0.0
    
    # Calculate median
    sorted_returns = sorted(returns)
    n = len(sorted_returns)
    if n == 0:
        median_ret = 0.0
    elif n % 2 == 0:
        median_ret = (sorted_returns[n//2 - 1] + sorted_returns[n//2]) / 2.0
    else:
        median_ret = sorted_returns[n//2]
    
    return {
        "n_trades": int(len(trades)),
        "win_rate": float(win_rate),
        "avg_ret": float(avg_ret),
        "median_ret": float(median_ret)
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

    # Use the strategy registry from the strategies package
    supported = STRATEGY_REGISTRY

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

    # Allow off-hours for VWAP/EMA crossover and Fools Paradise
    if name in ['vwap_ema_crossover_v1', 'fools_paradise']:
        signals = supported[name](df, rth_mask=None)
    else:
        signals = supported[name](df, rth_mask=regular_mask)
    metrics = simple_backtest(df, signals, fee_bp=fee_bp, risk_percent=risk_percent)

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

