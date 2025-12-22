from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Literal, Optional


OrderSide = Literal["buy", "sell"]
OrderType = Literal["limit", "market"]


@dataclass(frozen=True)
class Bar:
    """
    Execution-bar representation (v1: 1-minute bars from `stock_data`).
    Times are UTC datetimes.
    """

    ts: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


@dataclass
class Order:
    order_id: str
    side: OrderSide
    type: OrderType
    qty: float
    limit_price: Optional[float] = None
    tag: Optional[str] = None
    created_ts: Optional[datetime] = None
    status: Literal["working", "filled", "canceled"] = "working"


@dataclass
class Position:
    qty: float = 0.0  # + long, - short
    avg_price: float = 0.0
    realized_pnl: float = 0.0


@dataclass
class ReplayState:
    session_id: str
    symbol: str
    exec_tf_sec: int
    disp_tf_sec: int
    cursor_exec_ts: datetime
    paused: bool
    position: Position
    orders: list[Order]
    last_event_id: int
    extra: Dict[str, Any]


