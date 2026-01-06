"""
Execution model implementations.

Execution models are responsible for turning entry/side signals into fills and PnL
under explicit assumptions (fill policy, stops/targets, tie-break rules, fees, etc.).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

import pandas as pd

from strategies.contracts import normalize_signals


@dataclass
class RiskRewardExecutionModel:
    """
    Simple risk/reward model using next-bar open entries.

    Semantics preserved from previous `backtesting.py`:
    - Entry at next bar open after a True entry signal
    - Stop loss at risk_percent away (below for longs, above for shorts)
    - Take profit at reward_multiple * risk distance
    - Exits on stop/take-profit or end of data
    - If both TP and SL hit in the same bar, tie-break uses bar open proximity
    """

    risk_percent: float = 0.5  # expressed in percent, e.g., 0.5 => 0.5%
    reward_multiple: float = 2.0  # take-profit distance relative to risk (2.0 => 2:1)

    def run(
        self,
        df_prices: pd.DataFrame,
        signals: Dict[str, Any],
        fee_bp: float = 0.0,
    ) -> Dict[str, Optional[float]]:
        if df_prices is None or df_prices.empty or not signals:
            return {
                "n_trades": 0,
                "win_rate": None,
                "avg_ret": None,
                "median_ret": None,
            }

        df = df_prices.copy()

        # Ensure OHLC is present
        required_cols = {"open", "high", "low", "close"}
        if not required_cols.issubset(df.columns):
            return {
                "n_trades": 0,
                "win_rate": None,
                "avg_ret": None,
                "median_ret": None,
            }

        # Canonicalize signals to entry/side.
        sig = normalize_signals(signals, df)
        entry_signals = sig.get("entry", [])
        sides = sig.get("side", [1] * len(df))

        risk = max(self.risk_percent, 0.0) / 100.0
        reward_mult = self.reward_multiple if self.reward_multiple > 0 else 2.0

        trades = []
        execution_events = []
        i = 0
        while i < len(df):
            if i < len(entry_signals) and entry_signals[i]:
                # Entry at next bar's open
                if i + 1 < len(df):
                    entry_idx = i + 1
                    entry_price = float(df.iloc[entry_idx]["open"])

                    side = int(sides[i]) if i < len(sides) else 1
                    is_long = side >= 0

                    # Stop loss / take profit
                    if is_long:
                        stop_loss = entry_price * (1 - risk)
                        take_profit = entry_price * (1 + reward_mult * risk)
                    else:
                        stop_loss = entry_price * (1 + risk)
                        take_profit = entry_price * (1 - reward_mult * risk)

                    exit_idx = None
                    exit_price = None
                    exit_reason: Optional[str] = None

                    for j in range(entry_idx + 1, len(df)):
                        bar_high = float(df.iloc[j]["high"])
                        bar_low = float(df.iloc[j]["low"])
                        bar_open = float(df.iloc[j]["open"])

                        if is_long:
                            hit_take_profit = bar_high >= take_profit
                            hit_stop_loss = bar_low <= stop_loss
                        else:
                            hit_take_profit = bar_low <= take_profit
                            hit_stop_loss = bar_high >= stop_loss

                        if hit_take_profit and hit_stop_loss:
                            dist_to_tp = abs(bar_open - take_profit)
                            dist_to_sl = abs(bar_open - stop_loss)
                            if dist_to_tp <= dist_to_sl:
                                exit_idx = j
                                exit_price = take_profit
                                exit_reason = "take_profit"
                                break
                            exit_idx = j
                            exit_price = stop_loss
                            exit_reason = "stop_loss"
                            break
                        if hit_take_profit:
                            exit_idx = j
                            exit_price = take_profit
                            exit_reason = "take_profit"
                            break
                        if hit_stop_loss:
                            exit_idx = j
                            exit_price = stop_loss
                            exit_reason = "stop_loss"
                            break

                    if exit_idx is None:
                        exit_idx = len(df) - 1
                        exit_price = float(df.iloc[exit_idx]["close"])
                        exit_reason = "end_of_data"

                    if is_long:
                        ret = (float(exit_price) - entry_price) / entry_price
                    else:
                        ret = (entry_price - float(exit_price)) / entry_price
                    ret -= fee_bp / 10000.0

                    trades.append(ret)

                    # Backtest-time artifact: only exists after execution.
                    # Emit stop-loss / take-profit events for charting/debugging.
                    try:
                        if exit_reason in ("stop_loss", "take_profit"):
                            t_ms = None
                            ts_iso = None
                            try:
                                ts = df.index[exit_idx]
                                if isinstance(ts, pd.Timestamp):
                                    if ts.tzinfo is None:
                                        ts = ts.tz_localize("UTC")
                                    else:
                                        ts = ts.tz_convert("UTC")
                                    t_ms = int(ts.value // 1_000_000)
                                    ts_iso = ts.isoformat()
                                else:
                                    # Best-effort: try pandas conversion
                                    ts2 = pd.to_datetime(ts, utc=True, errors="coerce")
                                    if pd.notna(ts2):
                                        t_ms = int(pd.Timestamp(ts2).value // 1_000_000)
                                        ts_iso = pd.Timestamp(ts2).isoformat()
                            except Exception:
                                t_ms = None
                                ts_iso = None

                            execution_events.append(
                                {
                                    "event": exit_reason,  # "stop_loss" | "take_profit"
                                    "side": "long" if is_long else "short",
                                    "t_ms": t_ms,
                                    "ts": ts_iso,
                                    "price": float(exit_price),
                                    "entry_idx": int(entry_idx),
                                    "exit_idx": int(exit_idx),
                                }
                            )
                    except Exception:
                        # Never let optional diagnostics break metrics.
                        pass

                    # Skip to after exit to avoid overlapping trades
                    i = exit_idx + 1
                    continue
            i += 1

        if not trades:
            return {
                "n_trades": 0,
                "win_rate": None,
                "avg_ret": None,
                "median_ret": None,
            }

        win_rate = sum(1 for r in trades if r > 0) / len(trades)
        avg_ret = sum(trades) / len(trades)

        sorted_returns = sorted(trades)
        n = len(sorted_returns)
        if n % 2 == 0:
            median_ret = (sorted_returns[n // 2 - 1] + sorted_returns[n // 2]) / 2.0
        else:
            median_ret = sorted_returns[n // 2]

        out = {
            "n_trades": int(len(trades)),
            "win_rate": float(win_rate),
            "avg_ret": float(avg_ret),
            "median_ret": float(median_ret),
        }
        out["execution_events"] = execution_events
        return out


