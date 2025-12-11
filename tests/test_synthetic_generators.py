import os
import tempfile
import unittest
from datetime import datetime, timezone, timedelta

import database
from synthetic_generators import (
    GENERATOR_REGISTRY,
    SyntheticBar,
    SyntheticL2,
    get_generator,
    write_synthetic_series_to_db,
)
from synthetic_generators.trend_regime_v1 import generate_trend_regime_series


class TrendRegimeGeneratorTests(unittest.TestCase):
    def test_generate_trend_regime_series_shapes(self):
        start_ts = datetime(2025, 1, 1, 9, 30, tzinfo=timezone.utc)
        bars, l2 = generate_trend_regime_series(
            symbol="MES_SYNTH",
            start_price=5000.0,
            n_bars=5,
            timeframe="1m",
            duration_sec=60,
            scenario="trend_regime_v1",
            start_ts=start_ts,
            seed=42,
        )

        self.assertEqual(len(bars), 5)
        self.assertEqual(len(l2), 5)
        self.assertTrue(all(isinstance(b, SyntheticBar) for b in bars))
        self.assertTrue(all(isinstance(x, SyntheticL2) for x in l2))
        self.assertEqual(bars[0].ts_start, start_ts)
        self.assertEqual(bars[1].ts_start, start_ts + timedelta(seconds=60))
        self.assertTrue(all(bar.data_source == "synthetic" for bar in bars))
        self.assertTrue(all(bar.scenario == "trend_regime_v1" for bar in bars))

    def test_write_synthetic_series_to_db_inserts_rows(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            database.DB_NAME = os.path.join(tmpdir, "test.db")
            database.init_database()

            bars, l2 = generate_trend_regime_series(
                symbol="MES_SYNTH",
                start_price=5000.0,
                n_bars=3,
                seed=123,
                start_ts=datetime(2025, 1, 1, tzinfo=timezone.utc),
            )

            conn = database.get_db_connection()
            try:
                write_synthetic_series_to_db(bars, l2, conn=conn)
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) FROM bars")
                bar_count = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM l2_state")
                l2_count = cur.fetchone()[0]
            finally:
                conn.close()

            self.assertEqual(bar_count, 3)
            self.assertEqual(l2_count, 3)


class RegistryTests(unittest.TestCase):
    def test_registry_contains_trend_regime(self):
        gen = get_generator("trend_regime_v1")
        self.assertIn("trend_regime_v1", GENERATOR_REGISTRY)
        self.assertIs(gen, generate_trend_regime_series)

    def test_registry_unknown_name(self):
        with self.assertRaises(KeyError):
            get_generator("unknown_scenario")


if __name__ == "__main__":
    unittest.main()

