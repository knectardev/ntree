import sqlite3
import os
from datetime import datetime
from typing import Any, Dict, List

_REPO_DIR = os.path.dirname(os.path.abspath(__file__))
# Always anchor the DB path to the repo (avoids accidentally creating/reading a DB from whatever the current
# working directory is when you start the server).
DB_NAME = os.environ.get("NTREE_DB_PATH") or os.path.join(_REPO_DIR, "stock_data.db")

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

    # Replay sessions + event log (append-only)
    # This supports deterministic "practice field" replay sessions.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS replay_sessions (
            session_id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            exec_tf_sec INTEGER NOT NULL,         -- execution clock resolution (v1: 60)
            disp_tf_sec INTEGER NOT NULL,         -- display clock resolution (e.g. 300/900/1800/3600)
            t_start TEXT NOT NULL,                -- ISO-8601 UTC
            t_end TEXT NOT NULL,                  -- ISO-8601 UTC
            seed INTEGER,                         -- optional RNG seed for deterministic scenarios
            status TEXT NOT NULL DEFAULT 'active',-- active|ended|error
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            summary_json TEXT                     -- optional summary metrics at end
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_replay_sessions_symbol_created
        ON replay_sessions(symbol, created_at DESC)
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS replay_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            ts_exec TEXT NOT NULL,                -- execution timestamp (ISO-8601 UTC)
            ts_market TEXT,                       -- optional market/display timestamp (ISO-8601 UTC)
            event_type TEXT NOT NULL,             -- ORDER_PLACED|ORDER_CANCELED|ORDER_MODIFIED|FILL|PAUSE|PLAY|...
            payload_json TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(session_id) REFERENCES replay_sessions(session_id) ON DELETE CASCADE
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_replay_events_session_id
        ON replay_events(session_id, id)
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_replay_events_session_time
        ON replay_events(session_id, ts_exec)
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
            ref_symbol TEXT,                     -- optional "reference" real symbol for synthetic datasets
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Migration: add ref_symbol column if this DB already existed.
    try:
        cursor.execute("ALTER TABLE bars ADD COLUMN ref_symbol TEXT")
    except sqlite3.OperationalError:
        pass
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
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_bars_synth_query
        ON bars(symbol, scenario, timeframe, ts_start)
        WHERE data_source = 'synthetic'
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


def get_synthetic_datasets() -> List[Dict[str, Any]]:
    """Return distinct synthetic datasets grouped by symbol/scenario/timeframe."""
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                symbol,
                scenario,
                timeframe,
                MIN(ts_start) AS ts_start_min,
                MAX(ts_start) AS ts_start_max,
                COUNT(*)      AS bar_count,
                MAX(ref_symbol) AS ref_symbol
            FROM bars_synth
            GROUP BY symbol, scenario, timeframe
            ORDER BY symbol, scenario, timeframe
            """
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    return [
        {
            "symbol": row[0],
            "scenario": row[1],
            "timeframe": row[2],
            "ts_start_min": row[3],
            "ts_start_max": row[4],
            "bar_count": row[5],
            "ref_symbol": row[6],
        }
        for row in rows
    ]


def list_real_tickers(interval: str = "1Min") -> List[str]:
    """Return distinct real tickers present in stock_data for the given interval."""
    iv = (interval or "1Min").strip()
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT DISTINCT ticker
            FROM stock_data
            WHERE interval = ?
            ORDER BY ticker ASC
            """,
            (iv,),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    out: List[str] = []
    for (t,) in rows:
        if not t:
            continue
        out.append(str(t).strip().upper())
    return out


def list_chart_tickers() -> List[str]:
    """
    Return distinct tickers that are chartable in this app.

    In Alpaca-only mode, the band chart uses 1-minute (`interval='1Min'`) as the base resolution.
    """
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT DISTINCT ticker
            FROM stock_data
            WHERE interval = '1Min'
            ORDER BY ticker ASC
            """
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    out: List[str] = []
    for (t,) in rows:
        if not t:
            continue
        out.append(str(t).strip().upper())
    return out


def list_all_tickers() -> List[str]:
    """Return distinct tickers present in stock_data across all intervals."""
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT DISTINCT ticker
            FROM stock_data
            ORDER BY ticker ASC
            """
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    out: List[str] = []
    for (t,) in rows:
        if not t:
            continue
        out.append(str(t).strip().upper())
    return out

if __name__ == '__main__':
    init_database()

