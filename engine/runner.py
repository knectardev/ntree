"""
Engine runner/orchestration.

This is the stable entry-point the web app and future CLI/config runners call.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import pandas as pd

from engine.execution import RiskRewardExecutionModel


def run_backtest(
    df_prices: pd.DataFrame,
    signals: Dict[str, Any],
    fee_bp: float = 0.0,
    execution_model: Optional[RiskRewardExecutionModel] = None,
) -> Dict[str, Optional[float]]:
    """
    Entry point for running a backtest with a pluggable execution model.
    Defaults to RiskRewardExecutionModel to preserve existing behavior.
    """
    model = execution_model or RiskRewardExecutionModel()
    return model.run(df_prices, signals, fee_bp=fee_bp)


