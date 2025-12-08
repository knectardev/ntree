import alpaca_trade_api as tradeapi
import sqlite3
from datetime import datetime, timedelta, timezone
from database import get_db_connection, init_database
import time
import pandas as pd
import numpy as np
import pandas_ta as ta
from utils import calculate_vwap_per_trading_day

# Alpaca API credentials
API_KEY = 'PK57P4EYJODEZTVL7QYOX7J53W'
API_SECRET = '6PXLeTmf6wKNJBSCKZAhg3SgCkieGag1Bgvf5Yeq53qD'
BASE_URL = 'https://paper-api.alpaca.markets/v2'

TICKERS = ['SPY', 'QQQ']
INTERVALS = ['1Min', '5Min']

def ingest_stock_data():
    """Ingest stock data from Alpaca API and store in SQLite database."""
    # Initialize database
    init_database()
    
    # Initialize Alpaca API
    api = tradeapi.REST(API_KEY, API_SECRET, BASE_URL, api_version='v2')
    
    # Calculate time range (5 days ago to now)
    # Use UTC timezone for Alpaca API (RFC3339 format)
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(days=5)
    
    # Format as RFC3339 strings for Alpaca API
    start_str = start_time.strftime('%Y-%m-%dT%H:%M:%SZ')
    end_str = end_time.strftime('%Y-%m-%dT%H:%M:%SZ')
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    for ticker in TICKERS:
        for interval in INTERVALS:
            try:
                print(f"Fetching {interval} data for {ticker}...")
                
                # Fetch bars from Alpaca
                # Use IEX feed (available on free plan) instead of SIP
                # Use RFC3339 formatted strings
                bars = api.get_bars(
                    ticker,
                    interval,
                    start=start_str,
                    end=end_str,
                    feed='iex'
                ).df
                
                if bars.empty:
                    print(f"No data found for {ticker} at {interval} interval")
                    continue
                
                # Calculate technical indicators
                # Sort by timestamp to ensure proper calculation
                bars = bars.sort_index()
                
                # Calculate EMAs (Exponential Moving Averages)
                bars['ema_9'] = bars['close'].ewm(span=9, adjust=False).mean()
                bars['ema_21'] = bars['close'].ewm(span=21, adjust=False).mean()
                bars['ema_50'] = bars['close'].ewm(span=50, adjust=False).mean()
                # pandas_ta equivalents
                bars['ta_ema_9'] = ta.ema(bars['close'], length=9)
                bars['ta_ema_21'] = ta.ema(bars['close'], length=21)
                bars['ta_ema_50'] = ta.ema(bars['close'], length=50)
                
                # Calculate VWAP per trading day (resets at market open each day)
                bars['vwap'] = calculate_vwap_per_trading_day(bars)
                # pandas_ta VWAP anchored per trading day (match Alpaca anchor)
                bars['ta_vwap'] = calculate_vwap_per_trading_day(bars)
                
                # Insert data into database with OHLC data and technical indicators
                inserted_count = 0
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
                        inserted_count += 1
                    except Exception as e:
                        print(f"Error inserting data point: {e}")
                        continue
                
                conn.commit()
                print(f"Inserted {inserted_count} data points for {ticker} at {interval} interval")
                
                # Rate limiting - be nice to the API
                time.sleep(0.5)
                
            except Exception as e:
                print(f"Error fetching data for {ticker} at {interval} interval: {e}")
                continue
    
    conn.close()
    print("Data ingestion completed!")

if __name__ == '__main__':
    ingest_stock_data()

