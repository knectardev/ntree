"""test write

test write description

Strategy contract:
- Input: pandas.DataFrame with index timestamps and columns: open, high, low, close, volume
- Output: dict of same-length arrays. Minimum required by engine/UI:
  - long_entry: list[bool]
  - direction: list['bullish'|'bearish'|None]
Optional UI fields:
  - cross_y (entry marker y), exit_y, long_exit, exit_direction
"""

import pandas as pd


def compute_test_write_signals(df_prices, rth_mask=None):
    """Skeleton strategy: no entries by default."""
    if df_prices is None or getattr(df_prices, 'empty', False):
        return {}

    df = df_prices.copy()
    df.index = pd.to_datetime(df.index)

    n = len(df)
    # TODO: replace with real logic
    long_entry = [False] * n
    direction = [None] * n

    return {
        'long_entry': long_entry,
        'direction': direction,
        'timestamp': [ts.isoformat() for ts in df.index],
    }
