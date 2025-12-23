from database import get_db_connection
sym = "QQQ"
conn = get_db_connection()
cur = conn.cursor()
cur.execute("SELECT MIN(timestamp), MAX(timestamp), COUNT(*) FROM stock_data WHERE ticker=? AND interval='1Min'", (sym,))
lo, hi, n = cur.fetchone()
print("QQQ rows", n, "lo", lo, "hi", hi)
cur.execute("SELECT timestamp, open_price, high_price, low_price, price, volume FROM stock_data WHERE ticker=? AND interval='1Min' ORDER BY timestamp ASC LIMIT 5", (sym,))
print("first5:")
for r in cur.fetchall():
    print(r)
cur.execute("SELECT timestamp, open_price, high_price, low_price, price, volume FROM stock_data WHERE ticker=? AND interval='1Min' ORDER BY timestamp DESC LIMIT 5", (sym,))
print("last5:")
for r in cur.fetchall():
    print(r)
conn.close()
