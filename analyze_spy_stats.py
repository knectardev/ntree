"""
Statistical analysis of SPY data to answer:
1. Correlation between opening and closing prices by day of week
2. Average price movement between 4pm close and 9:30am open next day
"""

import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime, timezone
import pytz
from database import get_db_connection

# Eastern timezone for market hours
ET = pytz.timezone('US/Eastern')

def fetch_spy_data():
    """Fetch all SPY 1-minute data from the database."""
    conn = get_db_connection()
    
    query = """
    SELECT 
        timestamp,
        open_price,
        high_price,
        low_price,
        price as close_price,
        volume
    FROM stock_data
    WHERE ticker = 'SPY' AND interval = '1Min'
    ORDER BY timestamp
    """
    
    df = pd.read_sql_query(query, conn)
    conn.close()
    
    # Convert timestamp to datetime
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    # Convert to Eastern Time for analysis
    if df['timestamp'].dt.tz is None:
        df['timestamp_et'] = df['timestamp'].dt.tz_localize('UTC').dt.tz_convert(ET)
    else:
        df['timestamp_et'] = df['timestamp'].dt.tz_convert(ET)
    
    # Add date and time components
    df['date'] = df['timestamp_et'].dt.date
    df['time'] = df['timestamp_et'].dt.time
    df['hour'] = df['timestamp_et'].dt.hour
    df['minute'] = df['timestamp_et'].dt.minute
    df['day_of_week'] = df['timestamp_et'].dt.day_name()
    df['weekday'] = df['timestamp_et'].dt.weekday  # 0=Monday, 6=Sunday
    
    return df

def identify_daily_opens_and_closes(df):
    """
    Identify the opening price (9:30am) and closing price (4:00pm) for each trading day.
    """
    # Filter for regular trading hours
    df_market = df[
        ((df['hour'] == 9) & (df['minute'] >= 30)) |  # 9:30am onwards
        ((df['hour'] > 9) & (df['hour'] < 16)) |      # 10am-3:59pm
        ((df['hour'] == 16) & (df['minute'] == 0))    # 4:00pm
    ].copy()
    
    daily_data = []
    
    for date in df_market['date'].unique():
        day_data = df_market[df_market['date'] == date].sort_values('timestamp_et')
        
        if len(day_data) == 0:
            continue
        
        # Get opening price (first bar at or after 9:30am)
        open_bars = day_data[(day_data['hour'] == 9) & (day_data['minute'] >= 30)]
        if len(open_bars) == 0:
            open_bars = day_data  # Fallback to first available
        
        # Get closing price (last bar at or before 4:00pm)
        close_bars = day_data[
            ((day_data['hour'] == 16) & (day_data['minute'] == 0)) |
            ((day_data['hour'] == 15) & (day_data['minute'] == 59))
        ]
        if len(close_bars) == 0:
            close_bars = day_data  # Fallback to last available
        
        daily_data.append({
            'date': date,
            'day_of_week': day_data.iloc[0]['day_of_week'],
            'weekday': day_data.iloc[0]['weekday'],
            'open': open_bars.iloc[0]['open_price'],
            'close': close_bars.iloc[-1]['close_price'],
            'high': day_data['high_price'].max(),
            'low': day_data['low_price'].min(),
            'volume': day_data['volume'].sum()
        })
    
    return pd.DataFrame(daily_data)

def analyze_open_close_correlation(daily_df):
    """
    Analyze correlation between opening and closing prices by day of week.
    """
    print("\n" + "="*80)
    print("ANALYSIS 1: Opening vs Closing Price by Day of Week")
    print("="*80)
    
    # Calculate daily return (close - open)
    daily_df['daily_return'] = daily_df['close'] - daily_df['open']
    daily_df['daily_return_pct'] = (daily_df['daily_return'] / daily_df['open']) * 100
    
    # Overall statistics
    print("\n--- Overall Statistics ---")
    print(f"Total trading days: {len(daily_df)}")
    print(f"Date range: {daily_df['date'].min()} to {daily_df['date'].max()}")
    print(f"\nAverage daily return: ${daily_df['daily_return'].mean():.4f} ({daily_df['daily_return_pct'].mean():.4f}%)")
    print(f"Median daily return: ${daily_df['daily_return'].median():.4f} ({daily_df['daily_return_pct'].median():.4f}%)")
    print(f"Std dev of daily return: ${daily_df['daily_return'].std():.4f} ({daily_df['daily_return_pct'].std():.4f}%)")
    
    # Group by day of week
    print("\n--- Statistics by Day of Week ---")
    dow_stats = daily_df.groupby('day_of_week').agg({
        'daily_return': ['count', 'mean', 'median', 'std'],
        'daily_return_pct': ['mean', 'median', 'std']
    }).round(4)
    
    # Order by weekday
    day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    dow_stats = dow_stats.reindex([d for d in day_order if d in dow_stats.index])
    
    print("\nDaily Return ($ change from open to close):")
    print(dow_stats['daily_return'])
    
    print("\nDaily Return (% change from open to close):")
    print(dow_stats['daily_return_pct'])
    
    # Calculate correlation between open and close prices
    print("\n--- Correlation Analysis ---")
    overall_corr = daily_df['open'].corr(daily_df['close'])
    print(f"Overall correlation (open vs close): {overall_corr:.4f}")
    
    print("\nCorrelation by day of week:")
    for day in day_order:
        if day in daily_df['day_of_week'].values:
            day_data = daily_df[daily_df['day_of_week'] == day]
            corr = day_data['open'].corr(day_data['close'])
            print(f"  {day}: {corr:.4f} (n={len(day_data)})")
    
    # Probability of positive days
    print("\n--- Win Rate by Day of Week ---")
    for day in day_order:
        if day in daily_df['day_of_week'].values:
            day_data = daily_df[daily_df['day_of_week'] == day]
            positive_days = (day_data['daily_return'] > 0).sum()
            total_days = len(day_data)
            pct = (positive_days / total_days) * 100 if total_days > 0 else 0
            print(f"  {day}: {positive_days}/{total_days} ({pct:.1f}% positive)")
    
    return daily_df

def analyze_overnight_gap(df):
    """
    Analyze price movement from 4pm close to next day 9:30am open.
    """
    print("\n" + "="*80)
    print("ANALYSIS 2: Overnight Gap (4:00 PM Close to 9:30 AM Open)")
    print("="*80)
    
    # Get 4pm closes
    closes_4pm = df[
        (df['hour'] == 16) & (df['minute'] == 0)
    ][['date', 'close_price', 'timestamp_et']].copy()
    closes_4pm = closes_4pm.rename(columns={'close_price': 'close_4pm'})
    
    # Get 9:30am opens
    opens_930am = df[
        (df['hour'] == 9) & (df['minute'] == 30)
    ][['date', 'open_price', 'timestamp_et']].copy()
    opens_930am = opens_930am.rename(columns={'open_price': 'open_930am'})
    
    # For each 9:30am open, find the previous day's 4pm close
    overnight_gaps = []
    
    opens_930am = opens_930am.sort_values('timestamp_et')
    closes_4pm = closes_4pm.sort_values('timestamp_et')
    
    for idx, open_row in opens_930am.iterrows():
        # Find most recent 4pm close before this open
        prior_closes = closes_4pm[closes_4pm['timestamp_et'] < open_row['timestamp_et']]
        
        if len(prior_closes) > 0:
            last_close = prior_closes.iloc[-1]
            gap = open_row['open_930am'] - last_close['close_4pm']
            gap_pct = (gap / last_close['close_4pm']) * 100
            
            overnight_gaps.append({
                'close_date': last_close['date'],
                'open_date': open_row['date'],
                'close_4pm': last_close['close_4pm'],
                'open_930am': open_row['open_930am'],
                'gap': gap,
                'gap_pct': gap_pct,
                'day_of_week': pd.Timestamp(open_row['date']).day_name()
            })
    
    gaps_df = pd.DataFrame(overnight_gaps)
    
    if len(gaps_df) == 0:
        print("No overnight gaps found in the data.")
        return
    
    # Overall statistics
    print("\n--- Overall Overnight Gap Statistics ---")
    print(f"Total overnight periods: {len(gaps_df)}")
    print(f"Average overnight gap: ${gaps_df['gap'].mean():.4f} ({gaps_df['gap_pct'].mean():.4f}%)")
    print(f"Median overnight gap: ${gaps_df['gap'].median():.4f} ({gaps_df['gap_pct'].median():.4f}%)")
    print(f"Std dev of gap: ${gaps_df['gap'].std():.4f} ({gaps_df['gap_pct'].std():.4f}%)")
    
    # Positive vs negative gaps
    positive_gaps = (gaps_df['gap'] > 0).sum()
    negative_gaps = (gaps_df['gap'] < 0).sum()
    neutral_gaps = (gaps_df['gap'] == 0).sum()
    
    print(f"\nPositive gaps (gap up): {positive_gaps} ({positive_gaps/len(gaps_df)*100:.1f}%)")
    print(f"Negative gaps (gap down): {negative_gaps} ({negative_gaps/len(gaps_df)*100:.1f}%)")
    print(f"Neutral gaps: {neutral_gaps}")
    
    # By day of week
    print("\n--- Overnight Gap by Day of Week (of the opening) ---")
    day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    
    for day in day_order:
        if day in gaps_df['day_of_week'].values:
            day_data = gaps_df[gaps_df['day_of_week'] == day]
            avg_gap = day_data['gap'].mean()
            avg_gap_pct = day_data['gap_pct'].mean()
            pos_count = (day_data['gap'] > 0).sum()
            total = len(day_data)
            print(f"\n  {day} (n={total}):")
            print(f"    Average gap: ${avg_gap:.4f} ({avg_gap_pct:.4f}%)")
            print(f"    Gap up rate: {pos_count}/{total} ({pos_count/total*100:.1f}%)")
    
    return gaps_df

def main():
    """Main analysis function."""
    print("Fetching SPY data from database...")
    df = fetch_spy_data()
    
    if len(df) == 0:
        print("ERROR: No SPY data found in database!")
        return
    
    print(f"Loaded {len(df):,} 1-minute bars for SPY")
    print(f"Date range: {df['timestamp_et'].min()} to {df['timestamp_et'].max()}")
    
    # Get daily open/close data
    print("\nProcessing daily open/close data...")
    daily_df = identify_daily_opens_and_closes(df)
    
    # Run analyses
    daily_df = analyze_open_close_correlation(daily_df)
    gaps_df = analyze_overnight_gap(df)
    
    # Export results
    print("\n" + "="*80)
    print("Exporting results to CSV files...")
    daily_df.to_csv('spy_daily_analysis.csv', index=False)
    print("  - spy_daily_analysis.csv (daily open/close data)")
    
    if gaps_df is not None and len(gaps_df) > 0:
        gaps_df.to_csv('spy_overnight_gaps.csv', index=False)
        print("  - spy_overnight_gaps.csv (overnight gap data)")
    
    print("\nAnalysis complete!")

if __name__ == '__main__':
    main()
