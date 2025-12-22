"""
Replay (practice-field) engine.

Design goals (see notes.txt):
- Deterministic replay
- Two-clock model (execution vs display cadence)
- Append-only event log (SQLite) as the primary product

This package is intentionally headless: it exposes pure-Python session objects
that the Flask app can wrap with API endpoints.
"""

from replay.session import ReplaySession, ReplaySessionConfig
from replay.types import (
    Bar,
    Order,
    OrderSide,
    OrderType,
    ReplayState,
)

__all__ = [
    "ReplaySession",
    "ReplaySessionConfig",
    "Bar",
    "Order",
    "OrderSide",
    "OrderType",
    "ReplayState",
]


