import alpaca_trade_api as tradeapi
import sqlite3
from datetime import datetime, timedelta, timezone
from database import get_db_connection, init_database
import time
import pandas as pd
import numpy as np
try:
    import pandas_ta as ta
except ImportError:
    ta = None
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
                
                # Sort by timestamp to ensure proper calculation
                bars = bars.sort_index()

                # Calculate technical indicators
                if ta:
                    bars['ema_9'] = ta.ema(bars['close'], length=9)
                    bars['ema_21'] = ta.ema(bars['close'], length=21)
                    bars['ema_50'] = ta.ema(bars['close'], length=50)
                    bars['ema_200'] = ta.ema(bars['close'], length=200)
                    bars['rsi'] = ta.rsi(bars['close'], length=14)
                    
                    macd = ta.macd(bars['close'])
                    if macd is not None and not macd.empty:
                        bars['macd'] = macd.iloc[:, 0]
                        bars['macd_signal'] = macd.iloc[:, 1]
                        bars['macd_histogram'] = macd.iloc[:, 2]
                    else:
                        bars['macd'] = bars['macd_signal'] = bars['macd_histogram'] = np.nan
                        
                    bbands = ta.bbands(bars['close'], length=20, std=2)
                    if bbands is not None and not bbands.empty:
                        bars['bb_lower'] = bbands.iloc[:, 0]
                        bars['bb_middle'] = bbands.iloc[:, 1]
                        bars['bb_upper'] = bbands.iloc[:, 2]
                    else:
                        bars['bb_lower'] = bars['bb_middle'] = bars['bb_upper'] = np.nan
                        
                    bars['sma_20'] = ta.sma(bars['close'], length=20)
                    bars['sma_50'] = ta.sma(bars['close'], length=50)
                    bars['sma_200'] = ta.sma(bars['close'], length=200)
                else:
                    # Fallback using pandas only
                    bars['ema_9'] = bars['close'].ewm(span=9, adjust=False).mean()
                    bars['ema_21'] = bars['close'].ewm(span=21, adjust=False).mean()
                    bars['ema_50'] = bars['close'].ewm(span=50, adjust=False).mean()
                    bars['ema_200'] = bars['close'].ewm(span=200, adjust=False).mean()
                    
                    # Simple RSI fallback
                    delta = bars['close'].diff()
                    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
                    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
                    rs = gain / loss
                    bars['rsi'] = 100 - (100 / (1 + rs))
                    
                    ema12 = bars['close'].ewm(span=12, adjust=False).mean()
                    ema26 = bars['close'].ewm(span=26, adjust=False).mean()
                    bars['macd'] = ema12 - ema26
                    bars['macd_signal'] = bars['macd'].ewm(span=9, adjust=False).mean()
                    bars['macd_histogram'] = bars['macd'] - bars['macd_signal']
                    
                    bars['sma_20'] = bars['close'].rolling(window=20).mean()
                    bars['sma_50'] = bars['close'].rolling(window=50).mean()
                    bars['sma_200'] = bars['close'].rolling(window=200).mean()
                    
                    std20 = bars['close'].rolling(window=20).std()
                    bars['bb_middle'] = bars['sma_20']
                    bars['bb_upper'] = bars['bb_middle'] + (std20 * 2)
                    bars['bb_lower'] = bars['bb_middle'] - (std20 * 2)
                
                bars['vwap'] = calculate_vwap_per_trading_day(bars)

                # Insert data into database with OHLC data and technical indicators
                inserted_count = 0
                for timestamp, row in bars.iterrows():
                    try:
                        cursor.execute('''
                            INSERT OR REPLACE INTO stock_data 
                            (ticker, timestamp, price, open_price, high_price, low_price, volume, 
                             interval, ema_9, ema_21, ema_50, ema_200, vwap, rsi, macd, macd_signal, macd_histogram, 
                             bb_upper, bb_middle, bb_lower, sma_20, sma_50, sma_200)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                            float(row['ema_200']) if pd.notna(row['ema_200']) else None,
                            float(row['vwap']) if pd.notna(row['vwap']) else None,
                            float(row['rsi']) if pd.notna(row['rsi']) else None,
                            float(row['macd']) if pd.notna(row['macd']) else None,
                            float(row['macd_signal']) if pd.notna(row['macd_signal']) else None,
                            float(row['macd_histogram']) if pd.notna(row['macd_histogram']) else None,
                            float(row['bb_upper']) if pd.notna(row['bb_upper']) else None,
                            float(row['bb_middle']) if pd.notna(row['bb_middle']) else None,
                            float(row['bb_lower']) if pd.notna(row['bb_lower']) else None,
                            float(row['sma_20']) if pd.notna(row['sma_20']) else None,
                            float(row['sma_50']) if pd.notna(row['sma_50']) else None,
                            float(row['sma_200']) if pd.notna(row['sma_200']) else None
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

