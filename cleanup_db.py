import sqlite3
import os

_REPO_DIR = os.path.dirname(os.path.abspath(__file__))
DB_NAME = os.environ.get("NTREE_DB_PATH") or os.path.join(_REPO_DIR, "stock_data.db")

def cleanup_redundant_columns():
    """Drop the redundant ta_ prefixed columns from the stock_data table."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Redundant columns to drop
    columns_to_drop = [
        'ta_ema_9',
        'ta_ema_21',
        'ta_ema_50',
        'ta_ema_200',
        'ta_vwap'
    ]
    
    print(f"Cleaning up database: {DB_NAME}")
    
    for column in columns_to_drop:
        try:
            print(f"  Attempting to drop column: {column}...")
            cursor.execute(f'ALTER TABLE stock_data DROP COLUMN {column}')
            print(f"  Successfully dropped {column}.")
        except sqlite3.OperationalError as e:
            if "no such column" in str(e):
                print(f"  Column {column} already gone or never existed.")
            else:
                print(f"  Error dropping {column}: {e}")
                
    conn.commit()
    conn.close()
    print("\nDatabase cleanup completed successfully!")

if __name__ == '__main__':
    cleanup_redundant_columns()

