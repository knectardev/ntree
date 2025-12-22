from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, List, Optional

from database import get_db_connection
from replay.types import Bar


def _parse_ts(ts: str) -> datetime:
    # Accept Z or offset; if tz-less assume UTC (keeps consistent with existing code style)
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


@dataclass
class MarketFeed:
    """
    Simple preloaded market feed for deterministic replay.

    v1 uses `stock_data` (1Min bars) as the execution clock.
    """

    symbol: str
    bars: List[Bar]

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
        for (ts, o, h, l, c, v) in rows:
            bars.append(
                Bar(
                    ts=_parse_ts(ts),
                    open=float(o),
                    high=float(h),
                    low=float(l),
                    close=float(c),
                    volume=float(v or 0.0),
                )
            )
        return cls(symbol=symbol, bars=bars)

    def iter_window(self, *, start_idx: int, end_idx_exclusive: int) -> Iterable[Bar]:
        for i in range(start_idx, min(end_idx_exclusive, len(self.bars))):
            yield self.bars[i]

    def index_for_ts(self, ts: datetime) -> Optional[int]:
        # Linear scan is fine for v1; we can binary-search later.
        for i, b in enumerate(self.bars):
            if b.ts == ts:
                return i
        return None


