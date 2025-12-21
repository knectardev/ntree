"""
Purge all local database records associated with one or more symbols/tickers.

This script is intentionally blunt: it's for reclaiming space when you no longer
want a symbol in your local SQLite DB.

Targets:
- `stock_data`  (Flask app's main historical store)
- `bars`        (canonical bars table used by synthetic/real pipelines)
  - `l2_state` rows are deleted automatically via FK ON DELETE CASCADE when bars are deleted
- `backtests`   (saved backtests referencing the ticker)

Usage (PowerShell):
  # Dry run (shows counts only)
  python purge_symbols.py --symbols AAPL,GOOGL --dry-run

  # Purge + vacuum to physically shrink DB file
  python purge_symbols.py --symbols AAPL,GOOGL --vacuum
"""

from __future__ import annotations

import argparse
import os
import sqlite3
from typing import Dict, List, Tuple

from database import DB_NAME, init_database


def _parse_symbols(value: str) -> List[str]:
    syms = [s.strip().upper() for s in (value or "").split(",") if s.strip()]
    # de-dupe, stable
    out: List[str] = []
    seen = set()
    for s in syms:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _apply_pragmas(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")


def _counts(conn: sqlite3.Connection, syms: List[str]) -> Dict[str, Dict[str, int]]:
    cur = conn.cursor()
    out: Dict[str, Dict[str, int]] = {}
    for sym in syms:
        stock_n = cur.execute("SELECT COUNT(1) FROM stock_data WHERE ticker = ?", (sym,)).fetchone()[0]
        bars_n = cur.execute("SELECT COUNT(1) FROM bars WHERE symbol = ?", (sym,)).fetchone()[0]
        bt_n = cur.execute("SELECT COUNT(1) FROM backtests WHERE ticker = ?", (sym,)).fetchone()[0]
        out[sym] = {"stock_data": int(stock_n), "bars": int(bars_n), "backtests": int(bt_n)}
    return out


def _print_counts(title: str, counts: Dict[str, Dict[str, int]]) -> None:
    print(title)
    for sym, d in counts.items():
        print(
            f"  {sym}: stock_data={d.get('stock_data', 0):,} "
            f"bars={d.get('bars', 0):,} backtests={d.get('backtests', 0):,}"
        )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", required=True, help="Comma-separated list. Example: AAPL,GOOGL")
    ap.add_argument("--db", default=DB_NAME, help="SQLite DB path (default: repo-anchored stock_data.db)")
    ap.add_argument("--dry-run", action="store_true", help="Show what would be deleted, but do not delete.")
    ap.add_argument("--vacuum", action="store_true", help="Run VACUUM after deletion to shrink file on disk.")
    args = ap.parse_args()

    syms = _parse_symbols(args.symbols)
    if not syms:
        ap.error("No symbols parsed. Provide something like: --symbols AAPL,GOOGL")

    # Ensure schema exists (so counts/deletes won't fail on missing tables).
    init_database()

    db_path = os.path.abspath(args.db)
    if not os.path.exists(db_path):
        raise FileNotFoundError(db_path)

    before_size = os.path.getsize(db_path)
    conn = sqlite3.connect(db_path)
    try:
        _apply_pragmas(conn)
        before = _counts(conn, syms)
        _print_counts("[BEFORE]", before)

        if args.dry_run:
            print("[DRY-RUN] no changes made.")
            return

        cur = conn.cursor()

        # Delete from bars first (to cascade-delete l2_state for those bars).
        cur.executemany("DELETE FROM bars WHERE symbol = ?", [(s,) for s in syms])

        # Delete from stock_data.
        cur.executemany("DELETE FROM stock_data WHERE ticker = ?", [(s,) for s in syms])

        # Delete saved backtests referencing these symbols.
        cur.executemany("DELETE FROM backtests WHERE ticker = ?", [(s,) for s in syms])

        conn.commit()

        after = _counts(conn, syms)
        _print_counts("[AFTER]", after)
    finally:
        conn.close()

    if args.vacuum:
        conn2 = sqlite3.connect(db_path)
        try:
            _apply_pragmas(conn2)
            print("[INFO] running VACUUM (this may take a while)...")
            conn2.execute("VACUUM;")
            print("[OK] VACUUM completed")
        finally:
            conn2.close()

    after_size = os.path.getsize(db_path)
    print(f"[DONE] db_size_mb: {before_size/1024/1024:.2f} -> {after_size/1024/1024:.2f}")


if __name__ == "__main__":
    main()


