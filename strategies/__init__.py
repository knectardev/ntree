"""
Trading strategies package.

This package contains individual trading strategy implementations.
Each strategy is in its own module and exports a compute function.
"""
from strategies.vwap_ema_crossover_v1 import compute_vwap_ema_crossover_signals
from strategies.fools_paradise import compute_fools_paradise_signals
from strategies.new_strat import compute_new_strat_signals
from strategies.test_write import compute_test_write_signals
from strategies.utils import clean_series, build_regular_mask
from strategies.contracts import (
    REQUIRED_BAR_COLUMNS,
    TIME_SEMANTICS,
    StrategyTimeSemantics,
    derive_entry_and_side,
    normalize_signals,
    validate_bars_df,
    validate_signals,
)

# Export all strategy compute functions
__all__ = [
    'compute_vwap_ema_crossover_signals',
    'compute_fools_paradise_signals',
    'compute_new_strat_signals',
    'compute_test_write_signals',
    'clean_series',
    'build_regular_mask',
    # contract utilities
    'REQUIRED_BAR_COLUMNS',
    'TIME_SEMANTICS',
    'StrategyTimeSemantics',
    'derive_entry_and_side',
    'normalize_signals',
    'validate_bars_df',
    'validate_signals',
]

# Strategy registry - maps strategy names to their compute functions
STRATEGY_REGISTRY = {
    'vwap_ema_crossover_v1': compute_vwap_ema_crossover_signals,
    'fools_paradise': compute_fools_paradise_signals,
    'new_strat': compute_new_strat_signals,
    'test_write': compute_test_write_signals,
}
