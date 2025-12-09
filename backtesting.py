"""
Backtesting engine decoupled from strategy implementations.

Strategies are expected to emit signal dictionaries (e.g., long_entry, direction).
The engine applies a neutral execution model so strategies stay focused on signal
generation while fills/PNL assumptions live here.
"""
from dataclasses import dataclass
from typing import Dict, Any, Optional

import pandas as pd


@dataclass
class RiskRewardExecutionModel:
    """
    Simple 2:1 reward-to-risk model using next-bar open entries.
    This mirrors the previous inline backtest logic to preserve behavior.
    """
    risk_percent: float = 0.5  # expressed in percent, e.g., 0.5 => 0.5%
    reward_multiple: float = 2.0  # take-profit distance relative to risk (2.0 => 2:1)

    def run(self, df_prices: pd.DataFrame, signals: Dict[str, Any], fee_bp: float = 0.0) -> Dict[str, Optional[float]]:
        """
        Execute a backtest using long_entry/direction signals.
        - Entry at next bar open after a True long_entry signal
        - Stop loss at risk_percent below (or above for shorts)
        - Take profit at 2x that distance
        - Exits on stop/take-profit or end of data
        """
        if df_prices is None or df_prices.empty or not signals:
            return {
                "n_trades": 0,
                "win_rate": None,
                "avg_ret": None,
                "median_ret": None
            }

        df = df_prices.copy()
        long_entry_signals = signals.get('long_entry', [])
        directions = signals.get('direction', [None] * len(df))

        # Ensure OHLC is present
        required_cols = {'open', 'high', 'low', 'close'}
        if not required_cols.issubset(df.columns):
            return {
                "n_trades": 0,
                "win_rate": None,
                "avg_ret": None,
                "median_ret": None
            }

        risk = max(self.risk_percent, 0.0) / 100.0
        reward_mult = self.reward_multiple if self.reward_multiple > 0 else 2.0

        trades = []
        i = 0
        while i < len(df):
            # Look for entry signal
            if i < len(long_entry_signals) and long_entry_signals[i]:
                # Entry at next bar's open
                if i + 1 < len(df):
                    entry_idx = i + 1
                    entry_price = df.iloc[entry_idx]['open']

                    # Determine direction
                    direction = directions[i] if i < len(directions) else 'bullish'
                    is_long = direction == 'bullish'

                    # Stop loss / take profit
                    if is_long:
                        stop_loss = entry_price * (1 - risk)
                        take_profit = entry_price * (1 + reward_mult * risk)
                    else:
                        stop_loss = entry_price * (1 + risk)
                        take_profit = entry_price * (1 - reward_mult * risk)

                    # Track exit
                    exit_idx = None
                    exit_price = None
                    exit_reason = None

                    # Walk forward until exit
                    for j in range(entry_idx + 1, len(df)):
                        bar_high = df.iloc[j]['high']
                        bar_low = df.iloc[j]['low']
                        bar_open = df.iloc[j]['open']

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
                                exit_reason = 'take_profit'
                                break
                            else:
                                exit_idx = j
                                exit_price = stop_loss
                                exit_reason = 'stop_loss'
                                break
                        elif hit_take_profit:
                            exit_idx = j
                            exit_price = take_profit
                            exit_reason = 'take_profit'
                            break
                        elif hit_stop_loss:
                            exit_idx = j
                            exit_price = stop_loss
                            exit_reason = 'stop_loss'
                            break

                    # If nothing hit, close at final bar
                    if exit_idx is None:
                        exit_idx = len(df) - 1
                        exit_price = df.iloc[exit_idx]['close']
                        exit_reason = 'end_of_data'

                    # Return calculation (shorts profit when price declines)
                    if is_long:
                        ret = (exit_price - entry_price) / entry_price
                    else:
                        ret = (entry_price - exit_price) / entry_price
                    ret -= fee_bp / 10000.0

                    trades.append({
                        'entry_idx': entry_idx,
                        'exit_idx': exit_idx,
                        'entry_price': entry_price,
                        'exit_price': exit_price,
                        'ret': ret,
                        'exit_reason': exit_reason
                    })

                    # Skip to after exit to avoid overlapping trades
                    i = exit_idx + 1
                else:
                    i += 1
            else:
                i += 1

        if len(trades) == 0:
            return {
                "n_trades": 0,
                "win_rate": None,
                "avg_ret": None,
                "median_ret": None
            }

        returns = [t['ret'] for t in trades]
        win_rate = sum(1 for r in returns if r > 0) / len(returns) if returns else 0.0
        avg_ret = sum(returns) / len(returns) if returns else 0.0

        sorted_returns = sorted(returns)
        n = len(sorted_returns)
        if n == 0:
            median_ret = 0.0
        elif n % 2 == 0:
            median_ret = (sorted_returns[n // 2 - 1] + sorted_returns[n // 2]) / 2.0
        else:
            median_ret = sorted_returns[n // 2]

        return {
            "n_trades": int(len(trades)),
            "win_rate": float(win_rate),
            "avg_ret": float(avg_ret),
            "median_ret": float(median_ret)
        }


def run_backtest(df_prices: pd.DataFrame, signals: Dict[str, Any], fee_bp: float = 0.0,
                 execution_model: Optional[RiskRewardExecutionModel] = None) -> Dict[str, Optional[float]]:
    """
    Entry point for running a backtest with a pluggable execution model.
    Defaults to the RiskRewardExecutionModel for backward compatibility.
    """
    model = execution_model or RiskRewardExecutionModel()
    return model.run(df_prices, signals, fee_bp=fee_bp)

