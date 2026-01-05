import sqlite3
con=sqlite3.connect("stock_data.db")
cur=con.cursor()
print("stock_data SPY ranges by interval:")
cur.execute("SELECT interval, COUNT(*), MIN(timestamp), MAX(timestamp) FROM stock_data WHERE ticker=? GROUP BY interval ORDER BY interval", ("SPY",))
print(cur.fetchall())
print("bars SPY groups:")
try:
    cur.execute("SELECT data_source, timeframe, duration_sec, COUNT(*), MIN(ts_start), MAX(ts_start) FROM bars WHERE symbol=? GROUP BY data_source, timeframe, duration_sec ORDER BY data_source, duration_sec", ("SPY",))
    print(cur.fetchall())
    cur.execute("SELECT MIN(ts_start), MAX(ts_start), COUNT(*) FROM bars WHERE symbol=?", ("SPY",))
    print("bars overall:", cur.fetchone())
    cur.execute("SELECT COUNT(*) FROM bars WHERE symbol=? AND substr(ts_start,1,4)=?", ("SPY","2024"))
    print("bars_2024_rows:", cur.fetchone()[0])
except Exception as e:
    print("bars_err", e)
con.close()
