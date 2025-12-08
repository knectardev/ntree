import sqlite3
import os
from datetime import datetime

DB_NAME = 'stock_data.db'

def init_database():
    """Initialize the SQLite database with the required schema."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Create table for stock data with OHLC (Open, High, Low, Close) for candlestick charts
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stock_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            price REAL NOT NULL,
            open_price REAL,
            high_price REAL,
            low_price REAL,
            volume REAL,
            interval TEXT NOT NULL,
            ema_9 REAL,
            ema_21 REAL,
            ema_50 REAL,
            vwap REAL,
            ta_ema_9 REAL,
            ta_ema_21 REAL,
            ta_ema_50 REAL,
            ta_vwap REAL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(ticker, timestamp, interval)
        )
    ''')
    
    # Add new columns if they don't exist (for migration)
    columns_to_add = [
        ('open_price', 'REAL'),
        ('high_price', 'REAL'),
        ('low_price', 'REAL'),
        ('volume', 'REAL'),
        ('ema_9', 'REAL'),
        ('ema_21', 'REAL'),
        ('ema_50', 'REAL'),
        ('vwap', 'REAL'),
        ('ta_ema_9', 'REAL'),
        ('ta_ema_21', 'REAL'),
        ('ta_ema_50', 'REAL'),
        ('ta_vwap', 'REAL')
    ]
    
    for column_name, column_type in columns_to_add:
        try:
            cursor.execute(f'ALTER TABLE stock_data ADD COLUMN {column_name} {column_type}')
        except sqlite3.OperationalError:
            pass  # Column already exists
    
    # Create index for faster queries
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_ticker_interval_timestamp 
        ON stock_data(ticker, interval, timestamp)
    ''')
    
    conn.commit()
    conn.close()
    print(f"Database {DB_NAME} initialized successfully.")

def get_db_connection():
    """Get a database connection."""
    return sqlite3.connect(DB_NAME)

if __name__ == '__main__':
    init_database()

