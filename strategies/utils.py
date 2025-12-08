"""
Shared utility functions for trading strategies.
"""
import pandas as pd
import math


def clean_series(series):
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
