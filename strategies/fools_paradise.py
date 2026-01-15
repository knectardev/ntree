"""
Fools Paradise Strategy

Bullish:
- EMA9, EMA21, and EMA50 are all sloping upward (positive direction)
- Price is above VWAP
- After the first green candle closes, set an entry point
- Exit at the close of the red candle

Bearish:
- EMA9, EMA21, and EMA50 are all sloping downward (negative direction)
- Price is below VWAP
- After the first red candle closes, set an entry point
- Exit at the close of the green candle
"""
import pandas as pd
from strategies.utils import clean_series
from utils import calculate_vwap_per_trading_day

try:
    import pandas_ta as ta
except ImportError:
    ta = None


def compute_fools_paradise_signals(df_prices, rth_mask=None):
    """
    Fools Paradise strategy: enter on first green/red candle after setup conditions,
    exit on opposite colored candle.
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

    # Calculate EMAs if not already present
    if 'ema9' not in df.columns:
        if ta:
            df['ema9'] = ta.ema(df['close'], length=9)
        else:
            df['ema9'] = df['close'].ewm(span=9, adjust=False).mean()
    
    if 'ema21' not in df.columns:
        if ta:
            df['ema21'] = ta.ema(df['close'], length=21)
        else:
            df['ema21'] = df['close'].ewm(span=21, adjust=False).mean()
    
    if 'ema50' not in df.columns:
        if ta:
            df['ema50'] = ta.ema(df['close'], length=50)
        else:
            df['ema50'] = df['close'].ewm(span=50, adjust=False).mean()
    
    if 'ema200' not in df.columns:
        if ta:
            df['ema200'] = ta.ema(df['close'], length=200)
        else:
            df['ema200'] = df['close'].ewm(span=200, adjust=False).mean()
    
    if 'vwap' not in df.columns:
        vwap_series = calculate_vwap_per_trading_day(df.rename(columns={
            'open': 'open',
            'high': 'high',
            'low': 'low',
            'close': 'close',
            'volume': 'volume'
        }))
        df['vwap'] = vwap_series

    # Calculate EMA slopes (current > previous = upward, current < previous = downward)
    ema9_slope = df['ema9'] > df['ema9'].shift(1)
    ema21_slope = df['ema21'] > df['ema21'].shift(1)
    ema50_slope = df['ema50'] > df['ema50'].shift(1)
    
    # All EMAs sloping up (bullish setup)
    all_emas_up = ema9_slope & ema21_slope & ema50_slope
    
    # All EMAs sloping down (bearish setup)
    all_emas_down = (~ema9_slope) & (~ema21_slope) & (~ema50_slope)
    
    # Price relative to VWAP
    price_above_vwap = df['close'] > df['vwap']
    price_below_vwap = df['close'] < df['vwap']
    
    # Optional: Price relative to EMA 200 (not currently used for signals)
    price_above_ema200 = df['close'] > df['ema200']
    price_below_ema200 = df['close'] < df['ema200']
    
    # Determine if candle is green (close > open) or red (close < open)
    is_green = df['close'] > df['open']
    is_red = df['close'] < df['open']
    
    # Bullish setup: all EMAs up AND price above VWAP
    bullish_setup = all_emas_up & price_above_vwap & rth_mask
    
    # Bearish setup: all EMAs down AND price below VWAP
    bearish_setup = all_emas_down & price_below_vwap & rth_mask
    
    # Initialize signals
    long_entry = [False] * len(df)
    long_exit = [False] * len(df)  # Track exit signals for visualization
    direction = [None] * len(df)
    exit_direction = [None] * len(df)  # Track exit direction
    entry_price_list = [None] * len(df)
    exit_price_list = [None] * len(df)  # Track exit prices
    cross_y = [None] * len(df)
    exit_y = [None] * len(df)  # Track exit Y positions for markers
    
    # Track state: None = no position, 'bullish_setup' = waiting for green candle,
    # 'bearish_setup' = waiting for red candle, 'long' = in long position, 'short' = in short position
    position_state = None
    setup_start_idx = None
    current_direction = None  # Track current position direction
    
    for i in range(1, len(df)):  # Start from 1 to have previous values for slope
        # Skip if EMAs or VWAP are not available
        if (pd.isna(df.iloc[i]['ema9']) or pd.isna(df.iloc[i]['ema21']) or 
            pd.isna(df.iloc[i]['ema50']) or pd.isna(df.iloc[i]['vwap'])):
            continue
        
        # Handle bullish logic
        if bullish_setup.iloc[i] and position_state is None:
            # Enter bullish setup - wait for first green candle
            position_state = 'bullish_setup'
            setup_start_idx = i
        
        elif position_state == 'bullish_setup':
            # Check if green candle closed
            if is_green.iloc[i]:
                # First green candle after setup - enter long
                long_entry[i] = True
                direction[i] = 'bullish'
                entry_price_list[i] = df.iloc[i]['close']  # Entry at close of green candle
                cross_y[i] = df.iloc[i]['close']
                position_state = 'long'
                current_direction = 'bullish'
                setup_start_idx = None
            elif not bullish_setup.iloc[i]:
                # Setup conditions no longer met, cancel setup
                position_state = None
                setup_start_idx = None
        
        elif position_state == 'long':
            # In long position - exit on red candle close
            if is_red.iloc[i]:
                # Exit at close of red candle
                long_exit[i] = True
                exit_direction[i] = 'bullish'  # Exiting a bullish position
                exit_price_list[i] = df.iloc[i]['close']
                exit_y[i] = df.iloc[i]['close']
                position_state = None
                setup_start_idx = None
                current_direction = None
        
        # Handle bearish logic (short positions)
        elif bearish_setup.iloc[i] and position_state is None:
            # Enter bearish setup - wait for first red candle
            position_state = 'bearish_setup'
            setup_start_idx = i
        
        elif position_state == 'bearish_setup':
            # Check if red candle closed
            if is_red.iloc[i]:
                # First red candle after setup - enter short (marked as long_entry=False but direction='bearish')
                # Note: For now, we'll use long_entry=False to indicate short, but the backtest may need adjustment
                # Actually, let's use long_entry=True for both, and use direction to distinguish
                long_entry[i] = True  # Entry signal (but bearish direction)
                direction[i] = 'bearish'
                entry_price_list[i] = df.iloc[i]['close']  # Entry at close of red candle
                cross_y[i] = df.iloc[i]['close']
                position_state = 'short'
                current_direction = 'bearish'
                setup_start_idx = None
            elif not bearish_setup.iloc[i]:
                # Setup conditions no longer met, cancel setup
                position_state = None
                setup_start_idx = None
        
        elif position_state == 'short':
            # In short position - exit on green candle close
            if is_green.iloc[i]:
                # Exit at close of green candle
                long_exit[i] = True
                exit_direction[i] = 'bearish'  # Exiting a bearish position
                exit_price_list[i] = df.iloc[i]['close']
                exit_y[i] = df.iloc[i]['close']
                position_state = None
                setup_start_idx = None
                current_direction = None

    return {
        'long_entry': [bool(x) if x else False for x in long_entry],
        'long_exit': [bool(x) if x else False for x in long_exit],  # Exit signals
        'direction': direction,
        'exit_direction': exit_direction,  # Exit direction
        'cross_y': cross_y,
        'exit_y': exit_y,  # Exit Y positions
        'entry_price': clean_series(pd.Series(entry_price_list, index=idx)),
        'exit_price': clean_series(pd.Series(exit_price_list, index=idx)),  # Exit prices
        'ema9': clean_series(df['ema9']),
        'ema21': clean_series(df['ema21']),
        'ema50': clean_series(df['ema50']),
        'ema200': clean_series(df['ema200']),
        'vwap': clean_series(df['vwap']),
        'timestamp': [ts.isoformat() for ts in df.index]
    }
