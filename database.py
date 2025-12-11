import sqlite3
import os
from datetime import datetime

DB_NAME = 'stock_data.db'

def init_database():
    """Initialize the SQLite database with the required schema."""
    conn = sqlite3.connect(DB_NAME)
    # Ensure foreign key constraints are enforced (SQLite requires this per-connection)
    conn.execute('PRAGMA foreign_keys = ON;')
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

    # New canonical bars table (supports real and synthetic sources)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS bars (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            timeframe TEXT NOT NULL,
            ts_start TEXT NOT NULL,              -- ISO-8601 UTC start of bar
            duration_sec INTEGER NOT NULL,       -- e.g., 60 for 1Min
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume REAL,
            trades INTEGER,
            vwap REAL,
            data_source TEXT NOT NULL,           -- alpaca_live | alpaca_hist | synthetic | ...
            scenario TEXT,                       -- NULL for real sources
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Ensure unique bars per source/scenario (drop old expression index if present)
    cursor.execute('DROP INDEX IF EXISTS idx_bars_unique')
    cursor.execute('''
        CREATE UNIQUE INDEX IF NOT EXISTS idx_bars_unique
        ON bars(symbol, timeframe, ts_start, data_source, scenario)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_bars_symbol_tf_ts
        ON bars(symbol, timeframe, ts_start)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_bars_source
        ON bars(data_source, scenario)
    ''')

    # Level 2 state features keyed to bars
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS l2_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bar_id INTEGER NOT NULL,
            spr REAL,
            bbs REAL,
            bas REAL,
            dbi REAL,
            microprice REAL,
            ofi REAL,
            sigma_spr REAL,
            frag REAL,
            d_micro REAL,
            tss REAL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(bar_id),
            FOREIGN KEY(bar_id) REFERENCES bars(id) ON DELETE CASCADE
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_l2_bar ON l2_state(bar_id)
    ''')

    # Convenience views separating real vs synthetic sources
    cursor.execute('''
        CREATE VIEW IF NOT EXISTS bars_real AS
        SELECT * FROM bars
        WHERE data_source IN ('alpaca_live', 'alpaca_hist') AND scenario IS NULL
    ''')
    cursor.execute('''
        CREATE VIEW IF NOT EXISTS bars_synth AS
        SELECT * FROM bars
        WHERE data_source = 'synthetic'
    ''')
    cursor.execute('''
        CREATE VIEW IF NOT EXISTS l2_state_real AS
        SELECT l2.* FROM l2_state l2
        JOIN bars b ON b.id = l2.bar_id
        WHERE b.data_source IN ('alpaca_live', 'alpaca_hist') AND b.scenario IS NULL
    ''')
    cursor.execute('''
        CREATE VIEW IF NOT EXISTS l2_state_synth AS
        SELECT l2.* FROM l2_state l2
        JOIN bars b ON b.id = l2.bar_id
        WHERE b.data_source = 'synthetic'
    ''')
    
    conn.commit()
    conn.close()
    print(f"Database {DB_NAME} initialized successfully.")

def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DB_NAME)
    conn.execute('PRAGMA foreign_keys = ON;')
    return conn

if __name__ == '__main__':
    init_database()

