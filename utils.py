"""
Utility functions for stock data processing.
"""
import pandas as pd
from datetime import datetime, time as dt_time, timezone
import pytz

# Market hours in Eastern Time
MARKET_OPEN_TIME = dt_time(9, 30)  # 9:30 AM ET
MARKET_CLOSE_TIME = dt_time(16, 0)  # 4:00 PM ET
PRE_MARKET_START = dt_time(4, 0)  # 4:00 AM ET
AFTER_HOURS_END = dt_time(20, 0)  # 8:00 PM ET

ET = pytz.timezone('US/Eastern')


def get_trading_day(timestamp):
    """
    Get the trading day for a given timestamp.
    Trading day is determined by the date in Eastern Time.
    If before 4:00 AM ET, it belongs to the previous trading day.
    """
    if isinstance(timestamp, str):
        # Parse ISO format string
        if timestamp.endswith('Z'):
            timestamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        else:
            timestamp = datetime.fromisoformat(timestamp)
    
    # Convert to Eastern Time
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    
    et_time = timestamp.astimezone(ET)
    et_date = et_time.date()
    et_time_only = et_time.time()
    
    # If before 4:00 AM ET, it belongs to previous trading day
    if et_time_only < PRE_MARKET_START:
        from datetime import timedelta
        et_date = et_date - timedelta(days=1)
    
    return et_date


def is_market_hours(timestamp):
    """
    Determine if a timestamp is during regular market hours (9:30 AM - 4:00 PM ET).
    Returns: 'regular', 'pre_market', 'after_hours', or 'closed'
    """
    if isinstance(timestamp, str):
        if timestamp.endswith('Z'):
            timestamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        else:
            timestamp = datetime.fromisoformat(timestamp)
    
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    
    et_time = timestamp.astimezone(ET)
    et_time_only = et_time.time()
    
    if MARKET_OPEN_TIME <= et_time_only < MARKET_CLOSE_TIME:
        return 'regular'
    elif PRE_MARKET_START <= et_time_only < MARKET_OPEN_TIME:
        return 'pre_market'
    elif MARKET_CLOSE_TIME <= et_time_only < AFTER_HOURS_END:
        return 'after_hours'
    else:
        return 'closed'


def calculate_vwap_per_trading_day(bars):
    """
    Calculate VWAP per trading day, resetting at market open (9:30 AM ET).
    
    Args:
        bars: pandas DataFrame with datetime index and columns: open, high, low, close, volume
    
    Returns:
        pandas Series with VWAP values
    """
    if bars.empty or 'volume' not in bars.columns:
        return pd.Series(index=bars.index, dtype=float)
    
    # Sort by timestamp
    bars = bars.sort_index()
    
    # Calculate typical price
    typical_price = (bars['high'] + bars['low'] + bars['close']) / 3
    
    # Group by trading day
    bars['trading_day'] = bars.index.map(get_trading_day)
    
    # Calculate VWAP per trading day
    result = pd.Series(index=bars.index, dtype=float)
    
    for trading_day, group in bars.groupby('trading_day'):
        # Filter to regular market hours only (9:30 AM - 4:00 PM ET)
        group_regular = group[group.index.map(lambda ts: is_market_hours(ts) == 'regular')]
        
        if group_regular.empty:
            # No regular hours data for this day, use all data
            group_regular = group
        
        if group_regular['volume'].sum() > 0:
            # Calculate cumulative VWAP for this trading day
            typical = (group_regular['high'] + group_regular['low'] + group_regular['close']) / 3
            vwap_day = (typical * group_regular['volume']).cumsum() / group_regular['volume'].cumsum()
            
            # Create a series with VWAP values for regular hours
            vwap_series = pd.Series(index=group_regular.index, data=vwap_day.values)
            
            # Map VWAP to all timestamps in this trading day
            last_vwap = None
            for idx in group.index:
                if idx in vwap_series.index:
                    # Regular hours - use calculated VWAP
                    result[idx] = vwap_series[idx]
                    last_vwap = vwap_series[idx]
                else:
                    # Non-regular hours - use last known VWAP from regular hours
                    if last_vwap is not None:
                        result[idx] = last_vwap
                    elif len(vwap_series) > 0:
                        # Use the first VWAP value if we haven't seen any yet
                        result[idx] = vwap_series.iloc[0]
                    else:
                        result[idx] = None
        else:
            # No volume data - set all to None
            result[group.index] = None
    
    return result


def get_market_hours_info(timestamps):
    """
    Get market hours information for a list of timestamps.
    Returns a list of dictionaries with start, end, and type for each period.
    """
    if not timestamps:
        return []
    
    periods = []
    current_period = None
    
    for ts in timestamps:
        if isinstance(ts, str):
            if ts.endswith('Z'):
                ts = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            else:
                ts = datetime.fromisoformat(ts)
        
        period_type = is_market_hours(ts)
        
        if current_period is None or current_period['type'] != period_type:
            # Start new period
            if current_period is not None:
                current_period['end'] = ts
                periods.append(current_period)
            
            current_period = {
                'start': ts,
                'end': ts,
                'type': period_type
            }
        else:
            # Continue current period
            current_period['end'] = ts
    
    # Add last period
    if current_period is not None:
        periods.append(current_period)
    
    return periods


def get_market_open_times(timestamps):
    """
    Get market open times (9:30 AM ET) from a list of timestamps.
    Returns a list of timestamps that represent market opens (where VWAP resets).
    """
    if not timestamps:
        return []
    
    market_opens = []
    seen_days = set()
    
    # Process timestamps to find market opens
    for i, ts in enumerate(timestamps):
        if isinstance(ts, str):
            if ts.endswith('Z'):
                ts = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            else:
                ts = datetime.fromisoformat(ts)
        
        # Convert to Eastern Time
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        
        et_time = ts.astimezone(ET)
        et_date = et_time.date()
        et_time_only = et_time.time()
        
        # Check if this is market open (9:30 AM ET) and we haven't seen this day yet
        # Allow some tolerance (within 5 minutes of 9:30 AM)
        market_open_time = MARKET_OPEN_TIME
        time_diff = abs((et_time_only.hour * 60 + et_time_only.minute) - 
                       (market_open_time.hour * 60 + market_open_time.minute))
        
        if time_diff <= 5 and et_date not in seen_days:
            # Check if this is the start of regular hours
            period_type = is_market_hours(ts)
            if period_type == 'regular':
                # Check if previous timestamp was not regular hours (to catch the transition)
                if i == 0:
                    market_opens.append(ts)
                    seen_days.add(et_date)
                else:
                    # Check previous timestamp
                    prev_ts = timestamps[i-1]
                    if isinstance(prev_ts, str):
                        if prev_ts.endswith('Z'):
                            prev_ts = datetime.fromisoformat(prev_ts.replace('Z', '+00:00'))
                        else:
                            prev_ts = datetime.fromisoformat(prev_ts)
                    if prev_ts.tzinfo is None:
                        prev_ts = prev_ts.replace(tzinfo=timezone.utc)
                    
                    prev_period = is_market_hours(prev_ts)
                    if prev_period != 'regular':
                        market_opens.append(ts)
                        seen_days.add(et_date)
    
    return market_opens

