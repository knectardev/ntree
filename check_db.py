"""Quick script to verify stock_data.db integrity and contents."""
import os
import sqlite3

db_path = os.environ.get("NTREE_DB_PATH", "stock_data.db")
print("DB path:", os.path.abspath(db_path))
print("Exists:", os.path.exists(db_path))
if not os.path.exists(db_path):
    exit(1)

print("Size:", os.path.getsize(db_path), "bytes")

try:
    conn = sqlite3.connect(db_path)
    (integrity,) = conn.execute("PRAGMA integrity_check").fetchone()
    print("Integrity:", integrity)

    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()]
    print("Tables:", tables)

    if "stock_data" in tables:
        n = conn.execute("SELECT COUNT(*) FROM stock_data").fetchone()[0]
        print("stock_data rows:", n)
        if n > 0:
            sample = conn.execute("SELECT ticker, timestamp, interval FROM stock_data LIMIT 3").fetchall()
            print("Sample stock_data:", sample)
            tickers = [r[0] for r in conn.execute("SELECT DISTINCT ticker FROM stock_data").fetchall()]
            print("Tickers in stock_data:", tickers)

    if "bars" in tables:
        n = conn.execute("SELECT COUNT(*) FROM bars").fetchone()[0]
        print("bars rows:", n)

    conn.close()
    print("OK: Database is valid and readable.")
except Exception as e:
    print("Error:", e)
    exit(1)
