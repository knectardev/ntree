"""
Backtest engine package.

This package is intentionally framework-agnostic: it consumes canonical strategy
signals (entry/side) plus an execution model to produce metrics/trades.
"""

from engine.execution import RiskRewardExecutionModel
from engine.runner import run_backtest

__all__ = ["RiskRewardExecutionModel", "run_backtest"]


