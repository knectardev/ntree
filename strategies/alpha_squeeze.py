import numpy as np
import pandas as pd

try:
    from strategies.utils import clean_series
except Exception:
    clean_series = None


def _clean(s: pd.Series) -> pd.Series:
    if clean_series is None:
        # conservative fallback: replace inf/nan with None-like values
        return s.replace([np.inf, -np.inf], np.nan)
    return clean_series(s)


def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def _true_range(df: pd.DataFrame) -> pd.Series:
    high = df["high"]
    low = df["low"]
    close = df["close"]
    prev_close = close.shift(1)
    tr1 = (high - low).abs()
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    return pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)


def _atr_sma(df: pd.DataFrame, period: int = 14) -> pd.Series:
    tr = _true_range(df)
    return tr.rolling(period, min_periods=period).mean()


def _bollinger(close: pd.Series, period: int = 20, stdev: float = 2.0):
    mid = close.rolling(period, min_periods=period).mean()
    sd = close.rolling(period, min_periods=period).std(ddof=0)
    upper = mid + stdev * sd
    lower = mid - stdev * sd
    return mid, upper, lower


def compute_alpha_squeeze_macro_trend_signals(df_prices: pd.DataFrame, rth_mask=None):
    """
    Active-instrument version of Alpha Squeeze Macro Trend.

    Entry (long only):
      - close > daily EMA50
      - bandwidth low vs last 100h mean (bw < mean100 * 1.1)
      - close > upper BB(20,2)  (hourly)

    Exit:
      - close < trailing stop  OR close < daily EMA50
      - 12h cooldown after exit

    Semantics aligned to your working example:
      - rth_mask is normalized to a boolean Series
      - signals are gated by rth_mask (entry/exit only), not by skipping all state updates
      - emits cross_y/exit_y + entry_price/exit_price
      - exit_direction describes side being exited ("bullish" here)
    """

    if df_prices is None or df_prices.empty:
        return {}

    df = df_prices.copy()
    df.index = pd.to_datetime(df.index)
    df = df.sort_index()
    idx = df.index

    # Normalize rth_mask exactly like your example
    if rth_mask is not None:
        try:
            rth_mask = pd.Series(rth_mask, index=idx).astype(bool)
        except Exception:
            rth_mask = None
    if rth_mask is None or len(rth_mask) != len(df):
        rth_mask = pd.Series([True] * len(df), index=idx)

    close = df["close"]

    # Hourly indicators
    bb_mid, bb_upper, bb_lower = _bollinger(close, period=20, stdev=2.0)
    atr14 = _atr_sma(df, period=14)

    bandwidth = (bb_upper - bb_lower) / bb_mid.replace(0, np.nan)
    bandwidth = bandwidth.replace([np.inf, -np.inf], np.nan)

    bw_avg_100 = bandwidth.rolling(100, min_periods=1).mean()
    is_squeezed = bandwidth < (bw_avg_100 * 1.1)

    # Daily trend filter: daily close EMA(50), forward-filled to hourly
    daily_close = close.resample("1D").last()
    daily_ema_50 = _ema(daily_close, span=50)
    daily_ema_50_h = daily_ema_50.reindex(idx, method="ffill")

    # Outputs (match your structure)
    long_entry = [False] * len(df)
    long_exit = [False] * len(df)
    direction = [None] * len(df)
    exit_direction = [None] * len(df)
    entry_price_list = [None] * len(df)
    exit_price_list = [None] * len(df)
    cross_y = [None] * len(df)
    exit_y = [None] * len(df)

    # Stateful position
    in_pos = False
    entry_price = 0.0
    highest_price = 0.0
    stop_price = 0.0
    cooldown_until = pd.Timestamp.min

    for i in range(len(df)):
        t = idx[i]
        c = close.iat[i]

        # Need indicator values
        e = daily_ema_50_h.iat[i]
        u = bb_upper.iat[i]
        a = atr14.iat[i]
        sq = bool(is_squeezed.iat[i]) if pd.notna(is_squeezed.iat[i]) else False

        if pd.isna(c) or pd.isna(e) or pd.isna(u) or pd.isna(a):
            continue

        # Label trend (optional)
        if c > e:
            direction[i] = "bullish"

        # Cooldown check
        if t < cooldown_until:
            continue

        # ENTRY (gated by rth_mask)
        if not in_pos:
            if rth_mask.iat[i]:
                if (c > e) and sq and (c > u):
                    stop_dist = float(a) * 2.5
                    if stop_dist > 0:
                        in_pos = True
                        entry_price = float(c)
                        highest_price = float(c)
                        stop_price = float(c) - stop_dist

                        long_entry[i] = True
                        direction[i] = "bullish"
                        entry_price_list[i] = float(c)
                        cross_y[i] = float(c)

        # EXIT / TRAIL (you can choose whether to gate exits by rth_mask; your example does)
        else:
            # Update trailing even outside RTH (state continues)
            if float(c) > highest_price:
                highest_price = float(c)

            profit_pct = (float(c) - entry_price) / entry_price if entry_price else 0.0
            mult = 1.5 if profit_pct > 0.02 else 2.5
            trailing_level = highest_price - (float(a) * mult)
            stop_price = max(stop_price, trailing_level)

            should_exit = (float(c) < stop_price) or (float(c) < float(e))

            if should_exit and rth_mask.iat[i]:
                long_exit[i] = True
                exit_direction[i] = "bullish"
                exit_price_list[i] = float(c)
                exit_y[i] = float(c)

                in_pos = False
                cooldown_until = t + pd.Timedelta(hours=12)
                entry_price = highest_price = stop_price = 0.0

    return {
        "long_entry": [bool(x) if x else False for x in long_entry],
        "long_exit": [bool(x) if x else False for x in long_exit],
        "direction": direction,
        "exit_direction": exit_direction,
        "cross_y": cross_y,
        "exit_y": exit_y,
        "entry_price": _clean(pd.Series(entry_price_list, index=idx)),
        "exit_price": _clean(pd.Series(exit_price_list, index=idx)),

        # Indicators/debug series (optional but useful)
        "daily_ema50": _clean(daily_ema_50_h),
        "bb_upper": _clean(bb_upper),
        "bb_mid": _clean(bb_mid),
        "bb_lower": _clean(bb_lower),
        "bandwidth": _clean(bandwidth.fillna(0.0)),
        "bw_avg_100": _clean(bw_avg_100.fillna(0.0)),
        "atr14": _clean(atr14),
        "timestamp": [ts.isoformat() for ts in idx],
    }


# ntree entrypoint wrapper (keep whatever name your UI expects)
def compute_my_strategy_v1_signals(df_prices, rth_mask=None):
    return compute_alpha_squeeze_macro_trend_signals(df_prices, rth_mask=rth_mask)
