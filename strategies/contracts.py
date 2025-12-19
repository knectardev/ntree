"""
Strategy contract utilities.

Goal: keep strategy implementations focused on signal generation while the rest of
the system (UI, backtest engine, future library adapters) relies on a stable,
explicit interface.

Time semantics (explicit to avoid lookahead bugs):
- Strategies compute signals using information available at the CLOSE of bar i.
- The default engine fill policy is NEXT-OPEN: an ENTRY signal at bar i is
  eligible to fill at the OPEN of bar i+1.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Tuple

import pandas as pd

# Minimal bar contract (even if a specific strategy doesn't use every field).
REQUIRED_BAR_COLUMNS: Tuple[str, ...] = ("open", "high", "low", "close", "volume")


@dataclass(frozen=True)
class StrategyTimeSemantics:
    """Documented semantics (not enforced at runtime beyond basic validation)."""

    computed_on: str = "close"  # signals computed using info available at close of bar i
    default_fill_policy: str = "next_open"  # entry fills on open of bar i+1


TIME_SEMANTICS = StrategyTimeSemantics()


def validate_bars_df(df_prices: pd.DataFrame) -> None:
    """Raise ValueError if the input bars DataFrame violates the minimal contract."""
    if df_prices is None or df_prices.empty:
        raise ValueError("df_prices is empty")
    missing = [c for c in REQUIRED_BAR_COLUMNS if c not in df_prices.columns]
    if missing:
        raise ValueError(f"df_prices missing required columns: {missing}")


def _to_bool_list(values: Any, n: int, *, default: bool = False) -> List[bool]:
    if values is None:
        return [bool(default) for _ in range(n)]
    if isinstance(values, pd.Series):
        values = values.tolist()
    try:
        seq = list(values)
    except Exception:
        return [bool(default) for _ in range(n)]
    if len(seq) != n:
        return [bool(default) for _ in range(n)]
    out: List[bool] = []
    for v in seq:
        out.append(bool(v) if v is not None else bool(default))
    return out


def _to_int_side_list(values: Any, n: int, *, default: int = 1) -> List[int]:
    if values is None:
        return [int(default) for _ in range(n)]
    if isinstance(values, pd.Series):
        values = values.tolist()
    try:
        seq = list(values)
    except Exception:
        return [int(default) for _ in range(n)]
    if len(seq) != n:
        return [int(default) for _ in range(n)]
    out: List[int] = []
    for v in seq:
        if v is None:
            out.append(int(default))
            continue
        try:
            iv = int(v)
        except Exception:
            iv = int(default)
        out.append(1 if iv >= 0 else -1)
    return out


def derive_entry_and_side(signals: Mapping[str, Any], n_bars: int) -> Tuple[List[bool], List[int]]:
    """
    Derive canonical (entry, side) arrays from a strategy's output dict.

    Compatibility rules (lowest churn):
    - If `entry` exists -> use it, else fall back to `long_entry`.
    - If `side` exists -> use it, else derive from `direction`:
        - 'bullish' => +1
        - 'bearish' => -1
      unknown/None => +1
    """
    entry_src = signals.get("entry", None)
    if entry_src is None:
        entry_src = signals.get("long_entry", None)
    entry = _to_bool_list(entry_src, n_bars, default=False)

    side_src = signals.get("side", None)
    if side_src is not None:
        side = _to_int_side_list(side_src, n_bars, default=1)
        return entry, side

    # direction fallback
    direction = signals.get("direction", None)
    if isinstance(direction, pd.Series):
        direction = direction.tolist()
    try:
        direction_list = list(direction) if direction is not None else [None] * n_bars
    except Exception:
        direction_list = [None] * n_bars
    if len(direction_list) != n_bars:
        direction_list = [None] * n_bars

    out_side: List[int] = []
    for d in direction_list:
        if isinstance(d, str) and d.lower().strip() == "bearish":
            out_side.append(-1)
        else:
            out_side.append(1)
    return entry, out_side


def normalize_signals(
    signals: Mapping[str, Any],
    df_prices: pd.DataFrame,
) -> Dict[str, Any]:
    """
    Return a copy of signals that always contains canonical keys:
    - entry: list[bool]
    - side: list[int] (+1 long, -1 short)

    This preserves existing keys (`long_entry`, `direction`, chart helpers, etc.)
    so the UI stays stable while the engine can consume a consistent interface.
    """
    n = 0 if df_prices is None else int(len(df_prices))
    entry, side = derive_entry_and_side(signals or {}, n)

    out: Dict[str, Any] = dict(signals or {})
    out["entry"] = entry
    out["side"] = side
    return out


def validate_signals(signals: Mapping[str, Any], df_prices: pd.DataFrame) -> None:
    """Raise ValueError if signals are not aligned to df_prices."""
    if df_prices is None:
        raise ValueError("df_prices is None")
    n = int(len(df_prices))
    norm = normalize_signals(signals or {}, df_prices)
    entry = norm.get("entry")
    side = norm.get("side")
    if not isinstance(entry, list) or len(entry) != n:
        raise ValueError("signals.entry must be a list aligned 1:1 with bars")
    if not isinstance(side, list) or len(side) != n:
        raise ValueError("signals.side must be a list aligned 1:1 with bars")


