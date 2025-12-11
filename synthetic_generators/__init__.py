from __future__ import annotations

from typing import Callable, Dict, Tuple, List

from .base import SyntheticBar, SyntheticL2, write_synthetic_series_to_db
from .trend_regime_v1 import generate_trend_regime_series


Generator = Callable[..., Tuple[List[SyntheticBar], List[SyntheticL2]]]

GENERATOR_REGISTRY: Dict[str, Generator] = {
    "trend_regime_v1": generate_trend_regime_series,
}


def get_generator(name: str) -> Generator:
    try:
        return GENERATOR_REGISTRY[name]
    except KeyError as exc:
        raise KeyError(f"Unknown synthetic generator: {name}") from exc


__all__ = [
    "SyntheticBar",
    "SyntheticL2",
    "write_synthetic_series_to_db",
    "generate_trend_regime_series",
    "get_generator",
    "GENERATOR_REGISTRY",
]

