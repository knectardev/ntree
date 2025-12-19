import unittest
from datetime import datetime, timedelta, timezone

import pandas as pd

# Import via compatibility shim to ensure old API remains stable.
from backtesting import RiskRewardExecutionModel, run_backtest


def _df_from_rows(rows):
    """
    rows: list of dicts with open/high/low/close/volume
    """
    start = datetime(2025, 1, 1, 14, 30, tzinfo=timezone.utc)
    idx = [start + timedelta(minutes=i) for i in range(len(rows))]
    df = pd.DataFrame(rows, index=pd.to_datetime(idx))
    return df


class EngineSemanticsTests(unittest.TestCase):
    def test_entry_fills_on_next_open(self):
        # Signal at bar 0 should enter at bar 1 open.
        df = _df_from_rows(
            [
                {"open": 50.0, "high": 50.0, "low": 50.0, "close": 50.0, "volume": 1.0},
                {"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "volume": 1.0},
                {"open": 100.0, "high": 100.0, "low": 100.0, "close": 100.0, "volume": 1.0},
            ]
        )
        signals = {"long_entry": [True, False, False], "direction": ["bullish", None, None]}
        model = RiskRewardExecutionModel(risk_percent=1.0, reward_multiple=1.0)
        metrics = run_backtest(df, signals, fee_bp=0.0, execution_model=model)

        # If entry incorrectly used bar0 open=50, TP would be 50.5 and we'd win immediately.
        # With correct next-open entry at 100, the final close is 100 => ret == 0.
        self.assertEqual(metrics["n_trades"], 1)
        self.assertAlmostEqual(metrics["avg_ret"], 0.0, places=9)

    def test_tp_sl_same_bar_tiebreak_prefers_closer_to_open_long(self):
        # One trade: entry at bar1 open=100 (signal at bar0)
        # risk 1%, reward 1 => SL=99, TP=101
        df = _df_from_rows(
            [
                {"open": 100.0, "high": 100.0, "low": 100.0, "close": 100.0, "volume": 1.0},
                {"open": 100.0, "high": 100.0, "low": 100.0, "close": 100.0, "volume": 1.0},
                # both hit in this bar; open is closer to TP -> TP wins
                {"open": 100.9, "high": 101.5, "low": 98.5, "close": 100.0, "volume": 1.0},
            ]
        )
        signals = {"long_entry": [True, False, False], "direction": ["bullish", None, None]}
        model = RiskRewardExecutionModel(risk_percent=1.0, reward_multiple=1.0)
        metrics = run_backtest(df, signals, fee_bp=0.0, execution_model=model)
        self.assertEqual(metrics["n_trades"], 1)
        self.assertAlmostEqual(metrics["avg_ret"], 0.01, places=9)

        # Now open is closer to SL -> SL wins => ret -1%
        df2 = _df_from_rows(
            [
                {"open": 100.0, "high": 100.0, "low": 100.0, "close": 100.0, "volume": 1.0},
                {"open": 100.0, "high": 100.0, "low": 100.0, "close": 100.0, "volume": 1.0},
                {"open": 99.1, "high": 101.5, "low": 98.5, "close": 100.0, "volume": 1.0},
            ]
        )
        metrics2 = run_backtest(df2, signals, fee_bp=0.0, execution_model=model)
        self.assertEqual(metrics2["n_trades"], 1)
        self.assertAlmostEqual(metrics2["avg_ret"], -0.01, places=9)


if __name__ == "__main__":
    unittest.main()


