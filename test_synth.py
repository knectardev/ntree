# test_synth.py
from datetime import datetime, timezone

from synthetic_generators.trend_regime_v1 import generate_trend_regime_series
from synthetic_generators.base import write_synthetic_series_to_db

if __name__ == "__main__":
    start_ts = datetime(2025, 1, 1, 9, 30, tzinfo=timezone.utc)

    bars, l2 = generate_trend_regime_series(
        symbol="MES_SYNTH",
        start_price=5000.0,
        n_bars=500,
        timeframe="1m",
        duration_sec=60,
        scenario="trend_regime_v1",
        start_ts=start_ts,
        seed=42,
    )

    write_synthetic_series_to_db(bars, l2)

    print(f"Inserted {len(bars)} synthetic bars.")
