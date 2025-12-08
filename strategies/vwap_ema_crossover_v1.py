"""
VWAP / EMA Crossover Strategy (v1)

This strategy marks every intersection between VWAP and EMA21.
- Uses provided rth_mask; if none, allows all sessions (pre/after-hours included)
- Intersection when sign of (vwap - ema21) changes from prior bar
"""
import pandas as pd
from strategies.utils import clean_series
from utils import calculate_vwap_per_trading_day

try:
    import pandas_ta as ta
except ImportError:
    ta = None


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
        'entry_price': clean_series(entry_price),
        'ema21': clean_series(ema21),
        'vwap': clean_series(vwap),
        'timestamp': [ts.isoformat() for ts in df.index]
    }
