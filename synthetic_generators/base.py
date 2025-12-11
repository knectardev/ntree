from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Sequence
import sqlite3

from database import get_db_connection


@dataclass
class SyntheticBar:
    symbol: str
    timeframe: str
    ts_start: datetime
    duration_sec: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    trades: int
    vwap: float
    data_source: str
    scenario: str


@dataclass
class SyntheticL2:
    spr: float
    bbs: float
    bas: float
    dbi: float
    microprice: float
    ofi: float
    sigma_spr: float
    frag: float
    d_micro: float
    tss: float


def write_synthetic_series_to_db(
    bars: Sequence[SyntheticBar],
    l2_states: Sequence[SyntheticL2],
    *,
    conn: sqlite3.Connection | None = None,
) -> None:
    """
    Persist a generated synthetic series into the SQLite DB using the existing
    `bars` and `l2_state` tables. Accepts an optional connection to make tests
    easier to isolate.
    """
    if len(bars) != len(l2_states):
        raise ValueError("bars and l2_states must have same length")

    owns_conn = conn is None
    conn = conn or get_db_connection()

    try:
        cur = conn.cursor()

        for bar, l2 in zip(bars, l2_states):
            cur.execute(
                """
                INSERT INTO bars (
                    symbol, timeframe, ts_start, duration_sec,
                    open, high, low, close, volume,
                    trades, vwap,
                    data_source, scenario
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    bar.symbol,
                    bar.timeframe,
                    bar.ts_start.isoformat(),
                    bar.duration_sec,
                    bar.open,
                    bar.high,
                    bar.low,
                    bar.close,
                    bar.volume,
                    bar.trades,
                    bar.vwap,
                    bar.data_source,
                    bar.scenario,
                ),
            )
            bar_id = cur.lastrowid

            cur.execute(
                """
                INSERT INTO l2_state (
                    bar_id,
                    spr, bbs, bas, dbi, microprice,
                    ofi, sigma_spr, frag, d_micro, tss
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    bar_id,
                    l2.spr,
                    l2.bbs,
                    l2.bas,
                    l2.dbi,
                    l2.microprice,
                    l2.ofi,
                    l2.sigma_spr,
                    l2.frag,
                    l2.d_micro,
                    l2.tss,
                ),
            )

        conn.commit()
    finally:
        if owns_conn:
            conn.close()

