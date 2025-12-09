"""
Trading strategies package.

This package contains individual trading strategy implementations.
Each strategy is in its own module and exports a compute function.
"""
from strategies.vwap_ema_crossover_v1 import compute_vwap_ema_crossover_signals
from strategies.fools_paradise import compute_fools_paradise_signals
from strategies.utils import clean_series, build_regular_mask

# Export all strategy compute functions
__all__ = [
    'compute_vwap_ema_crossover_signals',
    'compute_fools_paradise_signals',
    'clean_series',
    'build_regular_mask'
]

# Strategy registry - maps strategy names to their compute functions
STRATEGY_REGISTRY = {
    'vwap_ema_crossover_v1': compute_vwap_ema_crossover_signals,
    'fools_paradise': compute_fools_paradise_signals
}
