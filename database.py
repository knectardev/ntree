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
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(ticker, timestamp, interval)
        )
    ''')
    
    # Add new columns if they don't exist (for migration)
    columns_to_add = [
        ('open_price', 'REAL'),
        ('high_price', 'REAL'),
        ('low_price', 'REAL'),
        ('volume', 'REAL')
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

    # Table for global backtest configurations (strategy-neutral presets)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS backtest_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            risk_percent REAL NOT NULL,
            reward_multiple REAL NOT NULL,
            fee_bp REAL NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_bt_configs_name ON backtest_configs(name)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_bt_configs_created ON backtest_configs(created_at DESC)
    ''')

    # Table for saved/named backtests (parameters + optional metrics)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS backtests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            strategy TEXT NOT NULL,
            ticker TEXT NOT NULL,
            interval TEXT NOT NULL,
            risk_percent REAL NOT NULL,
            reward_multiple REAL NOT NULL,
            fee_bp REAL NOT NULL,
            metrics_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_backtests_name ON backtests(name)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_backtests_created ON backtests(created_at DESC)
    ''')
    
    conn.commit()
    conn.close()
    print(f"Database {DB_NAME} initialized successfully.")

def get_db_connection():
    """Get a database connection."""
    return sqlite3.connect(DB_NAME)

if __name__ == '__main__':
    init_database()

