#!/usr/bin/env python
"""
Smoke test for the replay (practice-field) engine.

This does NOT start the Flask server. It:
- Picks a symbol that exists in `stock_data` (interval=1Min)
- Creates a replay session over the last ~2 hours of available data
- Places one limit order
- Steps a few display bars
- Prints event counts written to SQLite
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from database import get_db_connection, init_database
from replay.session import ReplaySession, ReplaySessionConfig


def _parse_iso(ts: str) -> datetime:
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt


def _iso_z(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def main() -> int:
    init_database()

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT ticker
            FROM stock_data
            WHERE interval = '1Min'
            GROUP BY ticker
            ORDER BY ticker
            LIMIT 1
            """
        )
        row = cur.fetchone()
        if not row:
            print("No 1Min data found in stock_data. Run ingest_data.py first.")
            return 2
        symbol = str(row[0]).strip().upper()

        cur.execute(
            """
            SELECT MIN(timestamp), MAX(timestamp)
            FROM stock_data
            WHERE ticker = ? AND interval = '1Min'
            """,
            (symbol,),
        )
        lo, hi = cur.fetchone()
        if not lo or not hi:
            print(f"No usable timestamps for {symbol}.")
            return 2
        hi_dt = _parse_iso(str(hi))
        start_dt = max(_parse_iso(str(lo)), hi_dt - timedelta(hours=2))
        end_dt = hi_dt
    finally:
        conn.close()

    cfg = ReplaySessionConfig(
        symbol=symbol,
        t_start=_iso_z(start_dt),
        t_end=_iso_z(end_dt),
        exec_tf_sec=60,
        disp_tf_sec=300,
        seed=1,
    )
    sess = ReplaySession.create(cfg)
    print(f"Created session: {sess.session_id} symbol={symbol} range={cfg.t_start}..{cfg.t_end}")

    # Diagnostics: validate bar spacing (should be 1-minute bars for exec clock).
    bars = sess.feed.bars
    print(f"Feed bars loaded: n={len(bars)} first={bars[0].ts.isoformat()} last={bars[-1].ts.isoformat()}")
    deltas = []
    for i in range(1, min(12, len(bars))):
        dt_sec = (bars[i].ts - bars[i - 1].ts).total_seconds()
        deltas.append(dt_sec)
    if deltas:
        print(f"First deltas (sec): {deltas}")
    gap_count = 0
    for i in range(1, len(bars)):
        dt_sec = (bars[i].ts - bars[i - 1].ts).total_seconds()
        if dt_sec > 60.0:
            gap_count += 1
    if gap_count:
        print(f"WARNING: detected {gap_count} gaps where delta > 60s in the 1Min feed (market closures or missing data).")

    # Place a limit near the last close (not guaranteed to fill; this is just to test logging).
    last_close = bars[-1].close
    o = sess.place_limit(side="buy", price=float(last_close), qty=1, tag="smoke")
    print(f"Placed order: {o.order_id} price={o.limit_price} (last_close={last_close})")

    st0 = sess.get_state()
    st1 = sess.step(disp_steps=3)
    print(f"Cursor moved: {st0.cursor_exec_ts.isoformat()} -> {st1.cursor_exec_ts.isoformat()}")
    print(f"Position: qty={st1.position.qty} avg={st1.position.avg_price} realized={st1.position.realized_pnl}")

    # Option A expectation: the *display clock* advances exactly disp_steps * disp_tf_sec.
    disp_steps = 3
    expected_sec = disp_steps * cfg.disp_tf_sec
    ds0 = st0.extra.get("cursor_disp_start_ts")
    ds1 = st1.extra.get("cursor_disp_start_ts")
    if ds0 and ds1:
        try:
            d0 = _parse_iso(str(ds0))
            d1 = _parse_iso(str(ds1))
            disp_actual_sec = (d1 - d0).total_seconds()
            print(f"Display clock advanced: expected {expected_sec:.0f}s ({expected_sec/60:.1f}m), actual {disp_actual_sec:.0f}s ({disp_actual_sec/60:.1f}m)")
        except Exception:
            disp_actual_sec = None
    else:
        disp_actual_sec = None

    # Exec cursor can move less (or not at all) if windows are empty due to gaps/closures.
    actual_exec_sec = (st1.cursor_exec_ts - st0.cursor_exec_ts).total_seconds()
    print(f"Exec cursor delta: {actual_exec_sec:.0f}s ({actual_exec_sec/60:.1f}m) (may differ due to gaps)")
    try:
        i0 = int(st0.extra.get("exec_idx", -1))
        i1 = int(st1.extra.get("exec_idx", -1))
        if i0 >= 0 and i1 >= 0:
            print(f"Exec bars consumed: {i1 - i0} (exec_idx {i0} -> {i1})")
    except Exception:
        pass

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM replay_events WHERE session_id = ?", (sess.session_id,))
        n_events = int(cur.fetchone()[0])
        print(f"Events written: {n_events}")
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())


