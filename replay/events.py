from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from database import get_db_connection


def _iso_z(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


@dataclass
class EventLogger:
    """
    Minimal append-only event logger.
    Keeps replay deterministic by treating SQLite as the authoritative event sink.
    """

    session_id: str

    def emit(
        self,
        *,
        event_type: str,
        ts_exec: datetime,
        payload: Dict[str, Any],
        ts_market: Optional[datetime] = None,
    ) -> int:
        conn = get_db_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO replay_events (session_id, ts_exec, ts_market, event_type, payload_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    self.session_id,
                    _iso_z(ts_exec),
                    _iso_z(ts_market) if ts_market is not None else None,
                    event_type,
                    json.dumps(payload, separators=(",", ":"), sort_keys=True),
                ),
            )
            conn.commit()
            return int(cur.lastrowid)
        finally:
            conn.close()


