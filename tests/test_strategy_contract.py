import unittest
from datetime import datetime, timedelta, timezone

import pandas as pd

from strategies import STRATEGY_REGISTRY
from strategies.contracts import REQUIRED_BAR_COLUMNS, normalize_signals, validate_bars_df, validate_signals


def _make_dummy_bars(n: int = 50) -> pd.DataFrame:
    start = datetime(2025, 1, 1, 14, 30, tzinfo=timezone.utc)
    idx = [start + timedelta(minutes=i) for i in range(n)]
    # Simple monotonic bars with volume.
    close = [100.0 + 0.1 * i for i in range(n)]
    df = pd.DataFrame(
        {
            "open": close,
            "high": [c + 0.2 for c in close],
            "low": [c - 0.2 for c in close],
            "close": close,
            "volume": [1000.0 for _ in close],
        },
        index=pd.to_datetime(idx),
    )
    return df


class StrategyContractTests(unittest.TestCase):
    def test_all_strategies_produce_aligned_entry_side(self):
        df = _make_dummy_bars(80)
        validate_bars_df(df)
        self.assertTrue(all(c in df.columns for c in REQUIRED_BAR_COLUMNS))

        for name, fn in STRATEGY_REGISTRY.items():
            with self.subTest(strategy=name):
                signals = fn(df, rth_mask=None)
                # normalize always adds entry/side with correct lengths
                norm = normalize_signals(signals, df)
                self.assertIn("entry", norm)
                self.assertIn("side", norm)
                self.assertEqual(len(norm["entry"]), len(df))
                self.assertEqual(len(norm["side"]), len(df))

                # validate_signals must not raise
                validate_signals(signals, df)


if __name__ == "__main__":
    unittest.main()


