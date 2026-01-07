import sqlite3
import pandas as pd
import numpy as np
import math
try:
    import pandas_ta as ta
except ImportError:
    ta = None
from database import get_db_connection, init_database
from utils import calculate_vwap_per_trading_day

def backfill_indicators():
    """Iterate through all data in stock_data and calculate missing indicators."""
    print("Initializing database...")
    init_database()
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get all unique ticker/interval combinations
    cursor.execute("SELECT DISTINCT ticker, interval FROM stock_data")
    groups = cursor.fetchall()
    
    if not groups:
        print("No data found in stock_data table.")
        conn.close()
        return

    for ticker, interval in groups:
        print(f"\nBackfilling {ticker} ({interval})...")
        
        # Fetch all data for this group
        df = pd.read_sql_query(
            "SELECT * FROM stock_data WHERE ticker = ? AND interval = ? ORDER BY timestamp ASC",
            conn,
            params=(ticker, interval)
        )
        
        if df.empty:
            continue
            
        print(f"  Calculating indicators for {len(df)} rows...")
        
        # Use 'price' as the close price for calculations
        close = df['price']
        
        # Calculate indicators using pandas_ta if available, else pandas fallback
        if ta:
            df['ema_9_calc'] = ta.ema(close, length=9)
            df['ema_21_calc'] = ta.ema(close, length=21)
            df['ema_50_calc'] = ta.ema(close, length=50)
            df['ema_200_calc'] = ta.ema(close, length=200)
            df['rsi_calc'] = ta.rsi(close, length=14)
            
            macd = ta.macd(close)
            if macd is not None and not macd.empty:
                df['macd_calc'] = macd.iloc[:, 0]
                df['macd_signal_calc'] = macd.iloc[:, 1]
                df['macd_hist_calc'] = macd.iloc[:, 2]
            else:
                df['macd_calc'] = df['macd_signal_calc'] = df['macd_hist_calc'] = None
                
            bbands = ta.bbands(close, length=20, std=2)
            if bbands is not None and not bbands.empty:
                df['bb_lower_calc'] = bbands.iloc[:, 0]
                df['bb_middle_calc'] = bbands.iloc[:, 1]
                df['bb_upper_calc'] = bbands.iloc[:, 2]
            else:
                df['bb_lower_calc'] = df['bb_middle_calc'] = df['bb_upper_calc'] = None
                
            df['sma_20_calc'] = ta.sma(close, length=20)
            df['sma_50_calc'] = ta.sma(close, length=50)
            df['sma_200_calc'] = ta.sma(close, length=200)
        else:
            # Fallback using pandas only
            df['ema_9_calc'] = close.ewm(span=9, adjust=False).mean()
            df['ema_21_calc'] = close.ewm(span=21, adjust=False).mean()
            df['ema_50_calc'] = close.ewm(span=50, adjust=False).mean()
            df['ema_200_calc'] = close.ewm(span=200, adjust=False).mean()
            
            # Simple RSI fallback
            delta = close.diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
            rs = gain / loss
            df['rsi_calc'] = 100 - (100 / (1 + rs))
            
            ema12 = close.ewm(span=12, adjust=False).mean()
            ema26 = close.ewm(span=26, adjust=False).mean()
            df['macd_calc'] = ema12 - ema26
            df['macd_signal_calc'] = df['macd_calc'].ewm(span=9, adjust=False).mean()
            df['macd_hist_calc'] = df['macd_calc'] - df['macd_signal_calc']
            
            df['sma_20_calc'] = close.rolling(window=20).mean()
            df['sma_50_calc'] = close.rolling(window=50).mean()
            df['sma_200_calc'] = close.rolling(window=200).mean()
            
            std20 = close.rolling(window=20).std()
            df['bb_middle_calc'] = df['sma_20_calc']
            df['bb_upper_calc'] = df['bb_middle_calc'] + (std20 * 2)
            df['bb_lower_calc'] = df['bb_middle_calc'] - (std20 * 2)
            
        # VWAP calculation
        vwap_input = df.rename(columns={
            'high_price': 'high',
            'low_price': 'low',
            'price': 'close'
        })
        vwap_input.index = pd.to_datetime(df['timestamp'])
        df['vwap_calc'] = calculate_vwap_per_trading_day(vwap_input).values
        
        # Update database
        print(f"  Updating database...")
        update_data = []
        for _, row in df.iterrows():
            def _v(val):
                if val is None: return None
                try:
                    f = float(val)
                    return f if not math.isnan(f) else None
                except: return None

            update_data.append((
                _v(row['ema_9_calc']), _v(row['ema_21_calc']), _v(row['ema_50_calc']), _v(row['ema_200_calc']), _v(row['vwap_calc']),
                _v(row['rsi_calc']), _v(row['macd_calc']), _v(row['macd_signal_calc']), _v(row['macd_hist_calc']),
                _v(row['bb_upper_calc']), _v(row['bb_middle_calc']), _v(row['bb_lower_calc']),
                _v(row['sma_20_calc']), _v(row['sma_50_calc']), _v(row['sma_200_calc']),
                row['id']
            ))
            
        cursor.executemany('''
            UPDATE stock_data 
            SET ema_9 = ?, ema_21 = ?, ema_50 = ?, ema_200 = ?, vwap = ?,
                rsi = ?, macd = ?, macd_signal = ?, macd_histogram = ?,
                bb_upper = ?, bb_middle = ?, bb_lower = ?,
                sma_20 = ?, sma_50 = ?, sma_200 = ?
            WHERE id = ?
        ''', update_data)
        
        conn.commit()
        print(f"  Done with {ticker} ({interval}).")
        
    conn.close()
    print("\nBackfill completed successfully!")

if __name__ == '__main__':
    backfill_indicators()
