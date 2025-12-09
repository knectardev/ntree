"""
Candlestick pattern analysis module.

This module provides functions to analyze candlestick patterns and classify them
as bullish, bearish, or neutral. It supports single-candle, two-candle (pair),
and three-candle (trio) pattern detection.

This is an educational tool to help learn classical candlestick patterns,
not a trading strategy.
"""
import pandas as pd
import numpy as np


def compute_candle_features(df):
    """
    Compute basic features for each candle needed for pattern detection.
    
    Args:
        df: DataFrame with columns: open, high, low, close
        
    Returns:
        DataFrame with additional columns: body, range_, upper_wick, lower_wick,
        body_ratio, upper_ratio, lower_ratio, direction
    """
    df = df.copy()
    
    # Calculate body size (absolute difference between open and close)
    df['body'] = (df['close'] - df['open']).abs()
    
    # Calculate total range
    df['range_'] = df['high'] - df['low']
    
    # Calculate wicks
    df['upper_wick'] = df['high'] - df[['open', 'close']].max(axis=1)
    df['lower_wick'] = df[['open', 'close']].min(axis=1) - df['low']
    
    # Calculate ratios (avoid division by zero)
    df['body_ratio'] = df['body'] / df['range_'].replace(0, np.nan)
    df['upper_ratio'] = df['upper_wick'] / df['range_'].replace(0, np.nan)
    df['lower_ratio'] = df['lower_wick'] / df['range_'].replace(0, np.nan)
    
    # Determine direction
    df['direction'] = 'neutral'
    df.loc[df['close'] > df['open'], 'direction'] = 'bull'
    df.loc[df['close'] < df['open'], 'direction'] = 'bear'
    
    return df


def classify_single_candle(candle, candles_before=None):
    """
    Classify a single candle pattern.
    
    Args:
        candle: Series with candle features (body, range_, upper_wick, lower_wick,
                body_ratio, upper_ratio, lower_ratio, direction, open, high, low, close)
        candles_before: Optional list of candles before this one for trend context
    
    Returns:
        dict with keys: scope, bias, pattern, explanation
    """
    body_ratio = candle.get('body_ratio', 0)
    upper_ratio = candle.get('upper_ratio', 0)
    lower_ratio = candle.get('lower_ratio', 0)
    direction = candle.get('direction', 'neutral')
    open1 = candle.get('open', 0)
    close = candle.get('close', 0)
    low = candle.get('low', 0)
    high = candle.get('high', 0)
    range_ = candle.get('range_', 0)
    
    # Handle NaN values
    if pd.isna(body_ratio):
        body_ratio = 0
    if pd.isna(upper_ratio):
        upper_ratio = 0
    if pd.isna(lower_ratio):
        lower_ratio = 0
    
    # Doji-like (very small body)
    if body_ratio < 0.1:
        return {
            'scope': 'single',
            'bias': 'neutral',
            'pattern': 'doji_like',
            'explanation': 'Very small body relative to range → indecision (neutral bias).'
        }
    
    # Hammer-like (potential bullish reversal) - refined rules
    # Lower wick ≥ 2× body, upper wick ≤ 30% of body, body in top 25–35% of candle
    # Should occur after a downtrend
    if (range_ > 0 and body_ratio > 0):
        body = candle.get('body', 0)
        upper_wick = candle.get('upper_wick', 0)
        lower_wick = candle.get('lower_wick', 0)
        
        lower_wick_to_body = lower_wick / body if body > 0 else 0
        upper_wick_to_body = upper_wick / body if body > 0 else 0
        body_position = (close - low) / range_ if range_ > 0 else 0
        
        # Check for downtrend before (if we have context)
        has_downtrend = False  # Default to False to avoid firing without context
        if candles_before and len(candles_before) >= 3:
            # Check if prior 3 candles show a downtrend (lower closes)
            closes = [c.get('close', 0) for c in candles_before[-3:]]
            has_downtrend = all(closes[i] > closes[i+1] for i in range(len(closes) - 1))
        
        if (lower_wick_to_body >= 2.0 and  # Lower wick ≥ 2× body
            upper_wick_to_body <= 0.30 and  # Upper wick ≤ 30% of body (was 25%, now 30% per notes)
            body_position >= 0.65 and body_position <= 0.75 and  # Body in top 25–35%
            has_downtrend):  # Should occur after downtrend
            return {
                'scope': 'single',
                'bias': 'bullish',
                'pattern': 'hammer_like',
                'explanation': 'Downtrend + long lower wick (≥2× body) + small upper wick (≤30% body) + body in top 25–35% → hammer-like (bullish bias).'
            }
    
    # Shooting star-like (potential bearish reversal) - refined rules
    # Upper wick ≥ 2.5× body, lower wick ≤ 0.2× body OR ≤ 0.1× upper_wick, body at bottom
    # Should occur after an uptrend (bearish body is the stronger textbook version)
    if (range_ > 0 and body_ratio > 0):
        body = candle.get('body', 0)
        upper_wick = candle.get('upper_wick', 0)
        lower_wick = candle.get('lower_wick', 0)
        
        upper_wick_to_body = upper_wick / body if body > 0 else 0
        lower_wick_to_body = lower_wick / body if body > 0 else 0
        lower_wick_to_upper = lower_wick / upper_wick if upper_wick > 0 else 0
        # Body at bottom means the bottom of the body (min of open/close) is near the low
        body_bottom = min(open1, close)
        body_position = (body_bottom - low) / range_ if range_ > 0 else 0
        
        # Check for uptrend before (if we have context)
        has_uptrend = False  # Default to False to avoid firing without context
        if candles_before and len(candles_before) >= 3:
            # Check if prior 3 candles show an uptrend (higher closes)
            closes = [c.get('close', 0) for c in candles_before[-3:]]
            has_uptrend = all(closes[i] < closes[i+1] for i in range(len(closes) - 1))
        
        # Lower wick must be very small: <= 0.2 * body OR <= 0.1 * upper_wick
        lower_wick_small = (lower_wick_to_body <= 0.2) or (lower_wick_to_upper <= 0.1)
        
        if (upper_wick_to_body >= 2.5 and  # Upper wick ≥ 2.5× body
            lower_wick_small and  # Lower wick ≤ 0.2× body OR ≤ 0.1× upper_wick
            body_position <= 0.30 and  # Body at bottom (within bottom 30% of candle)
            has_uptrend):  # Should occur after uptrend
            return {
                'scope': 'single',
                'bias': 'bearish',
                'pattern': 'shooting_star_like',
            'explanation': 'Uptrend + long upper wick (≥2.5× body) + tiny lower wick (≤0.2× body or ≤0.1× upper) + body at bottom → shooting star-like (bearish bias, stronger with a bearish body).'
            }
    
    # Hanging man-like (potential bearish reversal) - refined rules
    # Lower wick ≥ 2× body, upper wick ≤ 25% of range, body in top 25% of candle
    # Should occur after an uptrend
    if (range_ > 0 and body_ratio > 0):
        lower_wick_to_body = lower_ratio / body_ratio if body_ratio > 0 else 0
        upper_wick_to_range = upper_ratio  # Already a ratio of range
        body_position = (close - low) / range_ if range_ > 0 else 0
        
        # Check for uptrend before (if we have context) - require previous 5 bars with rising highs
        has_uptrend = False  # Default to False to avoid firing without context
        if candles_before and len(candles_before) >= 5:
            # Check if prior 5 candles show an uptrend (rising highs)
            highs = [c.get('high', 0) for c in candles_before[-5:]]
            highs.append(high)  # Include current candle's high
            has_uptrend = all(highs[i] < highs[i+1] for i in range(len(highs) - 1))
        elif candles_before and len(candles_before) >= 3:
            # Fallback: check 3 candles if we don't have 5
            highs = [c.get('high', 0) for c in candles_before[-3:]]
            highs.append(high)
            has_uptrend = all(highs[i] < highs[i+1] for i in range(len(highs) - 1))
        
        if (lower_wick_to_body >= 2.0 and  # Lower wick ≥ 2× body
            upper_wick_to_range <= 0.25 and  # Upper wick ≤ 25% of range
            body_position >= 0.75 and  # Body in top 25% of candle
            has_uptrend):  # Should occur after uptrend
            return {
                'scope': 'single',
                'bias': 'bearish',
                'pattern': 'hanging_man_like',
                'explanation': 'Uptrend + long lower wick (≥2× body) + small upper wick + body in top 25% → hanging man-like (bearish bias).'
            }
    
    # Strong bullish body (marubozu-style) - refined rules
    # Body ≥ 65–70% of range, both wicks ≤ 20% of range
    if (direction == 'bull' and range_ > 0):
        if (body_ratio >= 0.65 and  # Body ≥ 65% of total range
            upper_ratio <= 0.20 and  # Upper wick ≤ 20% of range
            lower_ratio <= 0.20):    # Lower wick ≤ 20% of range
            return {
                'scope': 'single',
                'bias': 'bullish',
                'pattern': 'strong_bullish_body',
                'explanation': 'Large bullish body (≥65% range) with small wicks (≤20%) → strong buying pressure (bullish bias).'
            }
    
    # Strong bearish body (marubozu-style) - refined rules
    # Body ≥ 65% of range, upper wick ≤ 25% of range, lower wick ≤ 35% of range
    if (direction == 'bear' and range_ > 0):
        if (body_ratio >= 0.65 and  # Body ≥ 65% of total range
            upper_ratio <= 0.25 and  # Upper wick ≤ 25% of range
            lower_ratio <= 0.35):    # Lower wick ≤ 35% of range (not dominating)
            return {
                'scope': 'single',
                'bias': 'bearish',
                'pattern': 'strong_bearish_body',
                'explanation': 'Large bearish body (≥65% range) with small wicks → strong selling pressure (bearish bias).'
            }
    
    # Check for Neutral pattern: both wicks > body * 1.2 (uncertainty/indecision)
    # This should be checked before weak bullish/bearish
    body = candle.get('body', 0)
    upper_wick = candle.get('upper_wick', 0)
    lower_wick = candle.get('lower_wick', 0)
    
    if body > 0 and upper_wick > body * 1.2 and lower_wick > body * 1.2:
        return {
            'scope': 'single',
            'bias': 'neutral',
            'pattern': 'neutral',
            'explanation': 'Medium body with long wicks on both sides → high uncertainty/indecision (neutral bias).'
        }
    
    # Weak bullish - refined rules
    # Body between 10-35% of range, lower wick > upper wick (bullish bias)
    if direction == 'bull' and range_ > 0:
        if (body_ratio >= 0.10 and body_ratio <= 0.35 and  # Body 10-35% of range
            lower_ratio > upper_ratio):  # Lower wick > upper wick (bullish bias)
            return {
                'scope': 'single',
                'bias': 'bullish',
                'pattern': 'weak_bullish',
                'explanation': 'Small bullish candle (10-35% body) with lower wick > upper wick → weak bullish bias.'
            }
    
    # Weak bearish - similar logic for bearish
    if direction == 'bear' and range_ > 0:
        if (body_ratio >= 0.10 and body_ratio <= 0.35 and  # Body 10-35% of range
            upper_ratio > lower_ratio):  # Upper wick > lower wick (bearish bias)
            return {
                'scope': 'single',
                'bias': 'bearish',
                'pattern': 'weak_bearish',
                'explanation': 'Small bearish candle (10-35% body) with upper wick > lower wick → weak bearish bias.'
            }

    # Default fallback: neutral single-candle bias
    return {
        'scope': 'single',
        'bias': 'neutral',
        'pattern': 'neutral',
        'explanation': 'No clear pattern → neutral bias.'
    }


def classify_candle_pair(candle1, candle2, candles_before=None):
    """
    Classify a two-candle pattern.
    
    Args:
        candle1: First candle (Series with features)
        candle2: Second candle (Series with features)
        candles_before: Optional list of candles before candle1 for trend context
    
    Returns:
        dict with keys: scope, bias, pattern, explanation, or None if no pattern
    """
    dir1 = candle1.get('direction', 'neutral')
    dir2 = candle2.get('direction', 'neutral')
    body1 = candle1.get('body', 0)
    body2 = candle2.get('body', 0)
    body_ratio1 = candle1.get('body_ratio', 0)
    body_ratio2 = candle2.get('body_ratio', 0)
    open1 = candle1.get('open', 0)
    close1 = candle1.get('close', 0)
    open2 = candle2.get('open', 0)
    close2 = candle2.get('close', 0)
    high1 = candle1.get('high', 0)
    low1 = candle1.get('low', 0)
    high2 = candle2.get('high', 0)
    low2 = candle2.get('low', 0)
    
    # Parameters for tweezers detection (tunable)
    MIN_UPTREND_COUNT = 2   # Need at least 2 candles trending up/down
    MIN_BODY_RATIO = 0.15   # Minimum body ratio to avoid micro-bodies/dojis
    
    # Handle NaN values in body ratios
    if pd.isna(body_ratio1):
        body_ratio1 = 0
    if pd.isna(body_ratio2):
        body_ratio2 = 0
    
    # Bullish engulfing - refined rules
    # Candle1: bearish, Candle2: bullish
    # Body of Candle2 fully engulfs body of Candle1: (N+1 open <= N close) AND (N+1 close >= N open)
    # Works best after a downtrend or micro-pullback
    if (dir1 == 'bear' and dir2 == 'bull'):
        # Strict engulf rule: Candle2's body fully engulfs Candle1's body
        body_engulfs = (open2 <= close1 and close2 >= open1)
        
        # Check for micro-downtrend before (optional but recommended)
        has_downtrend = True  # Default to True if no context
        if candles_before and len(candles_before) >= 2:
            # Check if prior 2-3 candles show downward bias (lower highs)
            closes = [c.get('close', 0) for c in candles_before[-2:]]
            closes.append(close1)  # Include first candle of pair
            # Check for lower highs (downtrend)
            has_downtrend = all(closes[i] >= closes[i+1] for i in range(len(closes) - 1))
        
        # Avoid extremely small prior candles (dojis) - require minimum body size
        candle1_not_tiny = body_ratio1 >= 0.05  # At least 5% body to avoid doji engulfing
        
        if body_engulfs and has_downtrend and candle1_not_tiny:
            return {
                'scope': 'pair',
                'bias': 'bullish',
                'pattern': 'bullish_engulfing',
                'explanation': 'Bearish candle followed by bullish candle that fully engulfs its body → bullish engulfing (bullish bias).'
            }
    
    # Bearish engulfing - refined rules
    # Candle1: bullish, Candle2: bearish
    # Body of Candle2 fully engulfs body of Candle1: (N+1 open >= N close) AND (N+1 close <= N open)
    # Works best in context of an uptrend or overextension
    if (dir1 == 'bull' and dir2 == 'bear'):
        # Strict engulf rule: Candle2's body fully engulfs Candle1's body
        body_engulfs = (open2 >= close1 and close2 <= open1)
        
        # Check for uptrend before (optional but recommended)
        has_uptrend = True  # Default to True if no context
        if candles_before and len(candles_before) >= 2:
            # Check if prior 2-3 candles show upward bias (higher highs)
            closes = [c.get('close', 0) for c in candles_before[-2:]]
            closes.append(close1)  # Include first candle of pair
            # Check for higher highs (uptrend)
            has_uptrend = all(closes[i] <= closes[i+1] for i in range(len(closes) - 1))
        
        # Avoid extremely small prior candles (dojis) - require minimum body size
        candle1_not_tiny = body_ratio1 >= 0.05  # At least 5% body to avoid doji engulfing
        
        # Candle2 should have above-average range (to avoid tiny noise candles)
        # We'll check if body2 is reasonably sized
        candle2_has_strength = body_ratio2 >= 0.30  # At least 30% body for meaningful engulfing
        
        if body_engulfs and has_uptrend and candle1_not_tiny and candle2_has_strength:
            return {
                'scope': 'pair',
                'bias': 'bearish',
                'pattern': 'bearish_engulfing',
                'explanation': 'Bullish candle followed by bearish candle that fully engulfs its body → bearish engulfing (bearish bias).'
            }
    
    # Tweezers top (bearish) - refined rules to reduce false positives
    # Must have: uptrend before, matching highs within tight tolerance, first candle bullish with real body,
    # second candle bearish with reversal (close lower)
    if dir2 == 'bear':
        # Check if highs match within tighter tolerance (~0.02% of price) with minimum clamp
        avg_high = (high1 + high2) / 2
        price_tolerance = max(avg_high * 0.0002, 0.001)
        high_match = avg_high > 0 and abs(high1 - high2) <= price_tolerance
        
        if high_match:
            # Check for uptrend before the pattern (if we have previous candles)
            # Default to False if we don't have enough context - this reduces false positives
            has_uptrend = False
            if candles_before and len(candles_before) >= MIN_UPTREND_COUNT:
                # Check if last 2-3 candles show an uptrend (higher closes)
                closes = [c.get('close', 0) for c in candles_before[-MIN_UPTREND_COUNT:]]
                closes.append(close1)  # Include first candle of pair
                has_uptrend = all(closes[i] > closes[i-1] for i in range(1, len(closes)))
            
            # First candle should be bullish with a real body (avoid dojis)
            first_candle_bullish = (dir1 == 'bull' and body_ratio1 >= MIN_BODY_RATIO)
            
            # Second candle must be bearish with a real body (not tiny)
            second_candle_bearish = (dir2 == 'bear') and (body_ratio2 >= MIN_BODY_RATIO)
            
            # Require reversal: second candle closes lower than first
            reversal = close2 < close1
            
            if has_uptrend and first_candle_bullish and second_candle_bearish and reversal:
                return {
                    'scope': 'pair',
                    'bias': 'bearish',
                    'pattern': 'tweezers_top',
                    'explanation': 'Uptrend + two candles with matching highs, first bullish with real body then bearish reversal → tweezers top (bearish bias).'
                }
    
    # Tweezers bottom (bullish) - refined rules to reduce false positives
    # Must have: downtrend before, matching lows within tight tolerance, first candle bearish with real body,
    # second candle bullish with reversal (close higher)
    if dir2 == 'bull':
        # Check if lows match within tighter tolerance (~0.02% of price) with minimum clamp
        avg_low = (low1 + low2) / 2
        price_tolerance = max(avg_low * 0.0002, 0.001)
        low_match = avg_low > 0 and abs(low1 - low2) <= price_tolerance
        
        if low_match:
            # Check for downtrend before the pattern - require prior 3 candles with lower highs
            has_downtrend = False
            if candles_before and len(candles_before) >= 3:
                # Check if prior 3 candles show lower highs (downtrend)
                highs = [c.get('high', 0) for c in candles_before[-3:]]
                highs.append(high1)  # Include first candle of pair
                has_downtrend = all(highs[i] > highs[i+1] for i in range(len(highs) - 1))
            
            # First candle should be bearish with a real body (avoid dojis)
            first_candle_bearish = (dir1 == 'bear' and body_ratio1 >= MIN_BODY_RATIO)
            
            # Second candle must be bullish with a real body (not tiny)
            second_candle_bullish = (dir2 == 'bull') and (body_ratio2 >= MIN_BODY_RATIO)
            
            # Require reversal: second candle closes higher than first
            reversal = close2 > close1
            
            if has_downtrend and first_candle_bearish and second_candle_bullish and reversal:
                return {
                    'scope': 'pair',
                    'bias': 'bullish',
                    'pattern': 'tweezers_bottom',
                    'explanation': 'Downtrend + two candles with matching lows, first bearish with real body then bullish reversal → tweezers bottom (bullish bias).'
                }
    
    return None


def classify_candle_trio(candle1, candle2, candle3, candles_before=None):
    """
    Classify a three-candle pattern.
    
    Args:
        candle1: First candle (Series with features)
        candle2: Second candle (Series with features)
        candle3: Third candle (Series with features)
        candles_before: Optional list of candles before candle1 for trend context
    
    Returns:
        dict with keys: scope, bias, pattern, explanation, or None if no pattern
    """
    dir1 = candle1.get('direction', 'neutral')
    dir2 = candle2.get('direction', 'neutral')
    dir3 = candle3.get('direction', 'neutral')
    body1 = candle1.get('body', 0)
    body2 = candle2.get('body', 0)
    body3 = candle3.get('body', 0)
    body_ratio1 = candle1.get('body_ratio', 0)
    body_ratio2 = candle2.get('body_ratio', 0)
    body_ratio3 = candle3.get('body_ratio', 0)
    open1 = candle1.get('open', 0)
    close1 = candle1.get('close', 0)
    open2 = candle2.get('open', 0)
    close2 = candle2.get('close', 0)
    open3 = candle3.get('open', 0)
    close3 = candle3.get('close', 0)
    high1 = candle1.get('high', 0)
    low1 = candle1.get('low', 0)
    high3 = candle3.get('high', 0)
    low3 = candle3.get('low', 0)
    
    # Parameters for star patterns (tunable)
    MIN_UPTREND_COUNT = 3  # Need at least 3 candles trending up for evening star
    MIN_DOWNTREND_COUNT = 3  # Need at least 3 candles trending down for morning star
    
    # Handle NaN values
    if pd.isna(body_ratio1):
        body_ratio1 = 0
    if pd.isna(body_ratio2):
        body_ratio2 = 0
    if pd.isna(body_ratio3):
        body_ratio3 = 0
    
    # Morning star (bullish reversal) - refined rules
    # Must have: downtrend before, strong bearish candle1 (≥70% body), small-bodied candle2 (≤25% body),
    # strong bullish candle3 (≥70% body) closing ≥ midpoint of candle1
    if dir1 == 'bear' and dir3 == 'bull':
        # Check for downtrend before the pattern - require last 4 candles trending down
        has_downtrend = False
        if candles_before and len(candles_before) >= 4:
            # Check if last 4 candles show a downtrend (lower closes)
            closes = [c.get('close', 0) for c in candles_before[-4:]]
            closes.append(close1)  # Include first candle of trio
            has_downtrend = all(closes[i] > closes[i+1] for i in range(len(closes) - 1))
        
        # Candle 1: Strong bearish candle - body >= 70% of range
        candle1_strong = (dir1 == 'bear' and body_ratio1 >= 0.7)
        
        # Candle 2: Small body (doji/spinning top) - body <= 25% of range
        candle2_small = body_ratio2 <= 0.25
        
        # Candle 3: Strong bullish candle - body >= 70% of range
        candle3_strong = (dir3 == 'bull' and body_ratio3 >= 0.7)
        
        # Candle 3 must close >= midpoint of candle1's body
        candle1_mid = (open1 + close1) / 2
        candle3_retraces = close3 >= candle1_mid
        
        if (has_downtrend and candle1_strong and candle2_small and candle3_strong and candle3_retraces):
            return {
                'scope': 'trio',
                'bias': 'bullish',
                'pattern': 'morning_star',
                'explanation': 'Downtrend + strong bear (≥70% body) → small body (≤25%) → strong bull (≥70% body) closing ≥ midpoint → morning star (bullish bias).'
            }
    
    # Evening star (bearish reversal) - refined rules
    # Must have: uptrend before, strong bullish candle1 (≥70% body), small-bodied candle2 (≤30% of avg body),
    # strong bearish candle3 (≥70% body) closing ≤ midpoint of candle1
    if dir1 == 'bull' and dir3 == 'bear':
        # Check for uptrend before the pattern - require 3+ candles with increasing highs
        has_uptrend = False
        if candles_before and len(candles_before) >= 3:
            # Check if last 3+ candles show an uptrend (increasing highs)
            highs = [c.get('high', 0) for c in candles_before[-3:]]
            highs.append(high1)  # Include first candle of trio
            has_uptrend = all(highs[i] < highs[i+1] for i in range(len(highs) - 1))
        
        # Candle 1: Strong bullish candle
        candle1_strong = (dir1 == 'bull' and body_ratio1 >= 0.7)
        
        # Candle 2: Small body - should be <= 30% of range (doji/spinner)
        candle2_small = body_ratio2 <= 0.30
        
        # Candle 3: Strong bearish candle
        candle3_strong = (dir3 == 'bear' and body_ratio3 >= 0.7)
        
        # Candle 3 must close <= midpoint of candle1's body
        candle1_mid = (open1 + close1) / 2
        candle3_retraces = close3 <= candle1_mid
        
        if (has_uptrend and candle1_strong and candle2_small and candle3_strong and candle3_retraces):
            return {
                'scope': 'trio',
                'bias': 'bearish',
                'pattern': 'evening_star',
                'explanation': 'Uptrend + strong bull (≥70% body) → small body (≤30% range) → strong bear (≥70% body) closing ≤ midpoint → evening star (bearish bias).'
            }
    
    # Three white soldiers (bullish) - refined rules
    # Must follow a downtrend/pullback, three strong bullish candles with small upper wicks,
    # each opening within previous body, each closing higher
    if dir1 == 'bull' and dir2 == 'bull' and dir3 == 'bull':
        # Check for downtrend/pullback before the pattern (if we have previous candles)
        has_downtrend = False
        if candles_before and len(candles_before) >= 3:
            # Check if last 3 candles show a downtrend (lower closes)
            closes = [c.get('close', 0) for c in candles_before[-3:]]
            has_downtrend = all(closes[i] > closes[i+1] for i in range(len(closes) - 1))
        
        # Helper function to check if a candle is a strong bullish candle
        def is_strong_bullish(candle):
            c_dir = candle.get('direction', 'neutral')
            c_body_ratio = candle.get('body_ratio', 0)
            c_upper_ratio = candle.get('upper_ratio', 0)
            if pd.isna(c_body_ratio):
                c_body_ratio = 0
            if pd.isna(c_upper_ratio):
                c_upper_ratio = 0
            return (c_dir == 'bull' and 
                    c_body_ratio >= 0.6 and  # Long body
                    c_upper_ratio < 0.2)    # Small upper wick
        
        # All three candles must be strong bullish
        if (is_strong_bullish(candle1) and is_strong_bullish(candle2) and is_strong_bullish(candle3)):
            # Each candle opens within previous candle's body
            c2_opens_in_c1 = (open2 >= open1 and open2 <= close1)
            c3_opens_in_c2 = (open3 >= open2 and open3 <= close2)
            
            # Each candle closes higher than previous
            closes_higher = (close2 > close1 and close3 > close2)
            
            if has_downtrend and c2_opens_in_c1 and c3_opens_in_c2 and closes_higher:
                return {
                    'scope': 'trio',
                    'bias': 'bullish',
                    'pattern': 'three_white_soldiers',
                    'explanation': 'Downtrend + three strong bullish candles with small wicks, each opening in prior body → three white soldiers (bullish bias).'
                }
    
    # Three black crows (bearish) - refined rules
    # Must follow an uptrend, three consecutive strong bearish candles (≥60% body, ≤20% lower wick),
    # each opening within previous body, each closing near its low
    if dir1 == 'bear' and dir2 == 'bear' and dir3 == 'bear':
        # Check for uptrend before the pattern (if we have previous candles)
        has_uptrend = False
        if candles_before and len(candles_before) >= 3:
            # Check if last 3 candles show an uptrend (higher closes)
            closes = [c.get('close', 0) for c in candles_before[-3:]]
            has_uptrend = all(closes[i] < closes[i+1] for i in range(len(closes) - 1))
        
        # Helper function to check if a candle is a strong bearish candle
        def is_strong_bearish(candle):
            c_dir = candle.get('direction', 'neutral')
            c_body_ratio = candle.get('body_ratio', 0)
            c_lower_ratio = candle.get('lower_ratio', 0)
            if pd.isna(c_body_ratio):
                c_body_ratio = 0
            if pd.isna(c_lower_ratio):
                c_lower_ratio = 0
            return (c_dir == 'bear' and 
                    c_body_ratio >= 0.6 and  # Body >= 60% of range
                    c_lower_ratio <= 0.2)    # Lower wick <= 20% of range
        
        # All three candles must be strong bearish
        if (is_strong_bearish(candle1) and is_strong_bearish(candle2) and is_strong_bearish(candle3)):
            # Each candle opens within previous candle's body
            c2_opens_in_c1 = (open2 <= open1 and open2 >= close1)
            c3_opens_in_c2 = (open3 <= open2 and open3 >= close2)
            
            # Each candle closes lower than previous
            closes_lower = (close2 < close1 and close3 < close2)
            
            if has_uptrend and c2_opens_in_c1 and c3_opens_in_c2 and closes_lower:
                return {
                    'scope': 'trio',
                    'bias': 'bearish',
                    'pattern': 'three_black_crows',
                    'explanation': 'Uptrend + three consecutive strong bearish candles (≥60% body, ≤20% lower wick), each opening in prior body → three black crows (bearish bias).'
                }
    
    # Fair Value Gap (FVG) patterns - based on ICT methodology
    # FVGs are three-candle patterns where the middle candle creates a price gap/imbalance
    
    # Get additional candle2 data for FVG detection
    high2 = candle2.get('high', 0)
    low2 = candle2.get('low', 0)
    range1 = candle1.get('range_', 0)
    range2 = candle2.get('range_', 0)
    range3 = candle3.get('range_', 0)
    
    # Handle NaN values for ranges
    if pd.isna(range1):
        range1 = 0
    if pd.isna(range2):
        range2 = 0
    if pd.isna(range3):
        range3 = 0
    
    # Bullish Fair Value Gap (FVG)
    # Requirements:
    # 1. Candle2 (middle) is bullish (green) and large relative to candles on left and right
    # 2. High of candle1 (left) < Low of candle3 (right) - no overlap (creates gap)
    # 3. The gap zone is between high1 and low3
    if dir2 == 'bull':
        # Check if candle2 is large relative to candles on left and right
        # Candle2 should be at least 1.5x the average range of candle1 and candle3
        avg_range_adjacent = (range1 + range3) / 2.0 if (range1 > 0 or range3 > 0) else 0
        candle2_large = (range2 > 0 and avg_range_adjacent > 0 and range2 >= 1.5 * avg_range_adjacent) or (range2 > 0 and avg_range_adjacent == 0)
        
        # Check for gap: high of candle1 should be below low of candle3 (no overlap)
        gap_exists = high1 < low3
        
        if candle2_large and gap_exists:
            return {
                'scope': 'trio',
                'bias': 'bullish',
                'pattern': 'bullish_fair_value_gap',
                'explanation': f'Large bullish candle (middle) with gap: high of left candle ({high1:.2f}) < low of right candle ({low3:.2f}). Gap zone: {high1:.2f} - {low3:.2f}. Price likely to reverse upward when it returns to this zone (bullish bias).'
            }
    
    # Bearish Fair Value Gap (FVG)
    # Requirements:
    # 1. Candle2 (middle) is bearish (red) and large relative to candles on left and right
    # 2. Low of candle1 (left) > High of candle3 (right) - no overlap (creates gap)
    # 3. The gap zone is between low1 and high3
    if dir2 == 'bear':
        # Check if candle2 is large relative to candles on left and right
        # Candle2 should be at least 1.5x the average range of candle1 and candle3
        avg_range_adjacent = (range1 + range3) / 2.0 if (range1 > 0 or range3 > 0) else 0
        candle2_large = (range2 > 0 and avg_range_adjacent > 0 and range2 >= 1.5 * avg_range_adjacent) or (range2 > 0 and avg_range_adjacent == 0)
        
        # Check for gap: low of candle1 should be above high of candle3 (no overlap)
        gap_exists = low1 > high3
        
        if candle2_large and gap_exists:
            return {
                'scope': 'trio',
                'bias': 'bearish',
                'pattern': 'bearish_fair_value_gap',
                'explanation': f'Large bearish candle (middle) with gap: low of left candle ({low1:.2f}) > high of right candle ({high3:.2f}). Gap zone: {high3:.2f} - {low1:.2f}. Price likely to reverse downward when it returns to this zone (bearish bias).'
            }
    
    return None


def compute_candlestick_bias(df):
    """
    Compute candlestick bias for all candles in the DataFrame.
    
    This function analyzes each candle in context (single, pair, trio) and
    assigns a bias classification. Priority: trio > pair > single.
    
    Args:
        df: DataFrame with columns: open, high, low, close
        
    Returns:
        List of dicts, one per candle, with keys: scope, bias, pattern, explanation
    """
    if df.empty or len(df) < 1:
        return []
    
    # Compute features
    df_features = compute_candle_features(df)
    
    results = []
    
    for i in range(len(df_features)):
        candle = df_features.iloc[i]
        
        # Try trio first (if we have enough candles)
        if i >= 2:
            # Get previous candles for trend context (need at least MIN_UPTREND_COUNT candles before the trio)
            candles_before = None
            if i >= 5:  # Need at least 5 candles total (3 before + 3 in trio)
                # Get the 3-5 candles before the trio for trend checking
                start_idx = max(0, i - 2 - 5)  # Get up to 5 candles before candle1
                candles_before = [df_features.iloc[j] for j in range(start_idx, i - 2)]
            
            trio_result = classify_candle_trio(
                df_features.iloc[i-2],
                df_features.iloc[i-1],
                candle,
                candles_before=candles_before
            )
            if trio_result:
                results.append(trio_result)
                continue
        
        # Try pair (if we have enough candles)
        if i >= 1:
            # Get previous candles for trend context (need at least MIN_UPTREND_COUNT candles before the pair)
            candles_before = None
            if i >= 3:  # Need at least 3 candles total (2 before + 1 in pair)
                # Get the 2-3 candles before the pair for trend checking
                start_idx = max(0, i - 1 - 3)  # Get up to 3 candles before candle1
                candles_before = [df_features.iloc[j] for j in range(start_idx, i - 1)]
            
            pair_result = classify_candle_pair(
                df_features.iloc[i-1],
                candle,
                candles_before=candles_before
            )
            if pair_result:
                results.append(pair_result)
                continue
        
        # Fall back to single candle
        # Get previous candles for trend context
        candles_before_single = None
        if i >= 5:  # Need at least 5 candles for trend context
            start_idx = max(0, i - 5)
            candles_before_single = [df_features.iloc[j] for j in range(start_idx, i)]
        elif i >= 3:  # Fallback: use 3 candles if available
            start_idx = max(0, i - 3)
            candles_before_single = [df_features.iloc[j] for j in range(start_idx, i)]
        
        single_result = classify_single_candle(candle, candles_before=candles_before_single)
        results.append(single_result)
    
    return results


def count_pattern_instances(candle_bias_results):
    """
    Count the number of instances for each pattern type in the candlestick bias results.
    
    Args:
        candle_bias_results: List of dicts from compute_candlestick_bias, each with a 'pattern' key
        
    Returns:
        dict mapping pattern names to counts
    """
    pattern_counts = {}
    
    for result in candle_bias_results:
        if result and 'pattern' in result:
            pattern = result['pattern']
            pattern_counts[pattern] = pattern_counts.get(pattern, 0) + 1
    
    return pattern_counts
