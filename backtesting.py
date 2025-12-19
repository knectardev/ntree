"""
Compatibility shim for the backtest engine.

The implementation moved to `engine/` to keep responsibilities clean and future
adapters easy. This module intentionally preserves the old imports used across
the repo (e.g. `from backtesting import run_backtest, RiskRewardExecutionModel`).
"""

from engine.execution import RiskRewardExecutionModel
from engine.runner import run_backtest

__all__ = ["RiskRewardExecutionModel", "run_backtest"]

