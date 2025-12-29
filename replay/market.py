from __future__ import annotations

import bisect
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, List, Optional

from database import get_db_connection
from replay.types import Bar


def _parse_ts(ts: str) -> datetime:
    # Accept Z or offset; if tz-less assume UTC (keeps consistent with existing code style)
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


@dataclass
class MarketFeed:
    """
    Simple preloaded market feed for deterministic replay.

    v1 uses `stock_data` (1Min bars) as the execution clock.
    """

    symbol: str
    bars: List[Bar]
    # Precomputed timestamps for bisect (epoch ms). Keeps replay payload generation fast.
    _t_ms: Optional[List[int]] = None

    @classmethod
    def from_stock_data(
        cls,
        *,
        symbol: str,
        start_ts: str,
        end_ts: str,
        interval: str = "1Min",
    ) -> "MarketFeed":
        conn = get_db_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT
                    timestamp,
                    COALESCE(open_price, price)  AS o,
                    COALESCE(high_price, price)  AS h,
                    COALESCE(low_price, price)   AS l,
                    price                        AS c,
                    COALESCE(volume, 0)          AS v
                FROM stock_data
                WHERE ticker = ?
                  AND interval = ?
                  AND timestamp >= ?
                  AND timestamp <= ?
                ORDER BY timestamp ASC
                """,
                (symbol, interval, start_ts, end_ts),
            )
            rows = cur.fetchall()
        finally:
            conn.close()

        bars: List[Bar] = []
        t_ms: List[int] = []
        for (ts, o, h, l, c, v) in rows:
            dt = _parse_ts(ts)
            bars.append(
                Bar(
                    ts=dt,
                    open=float(o),
                    high=float(h),
                    low=float(l),
                    close=float(c),
                    volume=float(v or 0.0),
                )
            )
            try:
                t_ms.append(int(dt.timestamp() * 1000))
            except Exception:
                # Fallback: keep list aligned even if parsing is odd.
                t_ms.append(0)
        return cls(symbol=symbol, bars=bars, _t_ms=t_ms)

    def iter_window(self, *, start_idx: int, end_idx_exclusive: int) -> Iterable[Bar]:
        for i in range(start_idx, min(end_idx_exclusive, len(self.bars))):
            yield self.bars[i]

    def index_for_ts(self, ts: datetime) -> Optional[int]:
        # Linear scan is fine for v1; we can binary-search later.
        for i, b in enumerate(self.bars):
            if b.ts == ts:
                return i
        return None

    def range_indices(self, *, start_ts: datetime, end_ts_exclusive: datetime) -> tuple[int, int]:
        """
        Return (start_idx, end_idx) for bars whose timestamps are in [start_ts, end_ts_exclusive).
        Uses bisect on epoch-ms list when available; falls back to linear scan if needed.
        """
        if not self.bars:
            return (0, 0)
        if self._t_ms and len(self._t_ms) == len(self.bars):
            s = int(start_ts.timestamp() * 1000)
            e = int(end_ts_exclusive.timestamp() * 1000)
            i0 = bisect.bisect_left(self._t_ms, s)
            i1 = bisect.bisect_left(self._t_ms, e)
            return (max(0, i0), max(0, i1))
        # Fallback: linear scan (should be rare).
        i0 = 0
        while i0 < len(self.bars) and self.bars[i0].ts < start_ts:
            i0 += 1
        i1 = i0
        while i1 < len(self.bars) and self.bars[i1].ts < end_ts_exclusive:
            i1 += 1
        return (i0, i1)


