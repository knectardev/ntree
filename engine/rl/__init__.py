"""
RL utilities built on top of ntree's replay + feature pipeline.

This package is intentionally opt-in and does not change existing backtesting
or web-app behavior unless explicitly imported/used.
"""

from engine.rl.feature_registry import FeatureRegistry, FeatureSpec

__all__ = ["FeatureRegistry", "FeatureSpec"]


