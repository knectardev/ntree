from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone
from typing import List, Tuple, Literal

from .base import SyntheticBar, SyntheticL2

Regime = Literal["UP", "DOWN", "CHOP"]


def generate_trend_regime_series(
    symbol: str,
    start_price: float,
    n_bars: int,
    *,
    timeframe: str = "1m",
    duration_sec: int = 60,
    scenario: str = "trend_regime_v1",
    start_ts: datetime | None = None,
    seed: int | None = None,
) -> Tuple[List[SyntheticBar], List[SyntheticL2]]:
    """
    Generate a synthetic price + L2 series with a simple 3-regime model: UP, DOWN, CHOP.
    """
    rng = random.Random(seed) if seed is not None else random

    if start_ts is None:
        now = datetime.now(timezone.utc)
        start_ts = now.replace(second=0, microsecond=0)

    regimes: dict[Regime, dict[str, float]] = {
        "UP": {"drift": 0.0007, "vol": 0.0025},
        "DOWN": {"drift": -0.0007, "vol": 0.0025},
        "CHOP": {"drift": 0.0, "vol": 0.0015},
    }

    stay_prob = 0.92
    current_regime: Regime = "CHOP"
    price = float(start_price)
    microprice_prev = price

    bars: List[SyntheticBar] = []
    l2_states: List[SyntheticL2] = []

    for i in range(n_bars):
        if rng.random() > stay_prob:
            candidates = [r for r in regimes.keys() if r != current_regime]
            current_regime = rng.choice(candidates)  # type: ignore[assignment]

        params = regimes[current_regime]

        ret = params["drift"] + params["vol"] * rng.gauss(0, 1)
        price_close = price * math.exp(ret)

        base_range = abs(ret) * price if abs(ret) > 0 else 0.001 * price
        extra = (0.5 + rng.random()) * params["vol"] * price
        bar_range = base_range + extra

        upper_wiggle = 0.3 * bar_range + rng.random() * 0.7 * bar_range
        lower_wiggle = 0.3 * bar_range + rng.random() * 0.7 * bar_range

        price_open = price
        price_high = max(price_open, price_close) + upper_wiggle
        price_low = min(price_open, price_close) - lower_wiggle

        price_high = max(price_high, price_open, price_close)
        price_low = min(price_low, price_open, price_close)

        regime_vol_multiplier = {"UP": 1.2, "DOWN": 1.2, "CHOP": 0.8}[current_regime]
        base_volume = 1000.0 * regime_vol_multiplier
        vol_noise = rng.uniform(0.5, 1.5)
        volume = base_volume * vol_noise

        trades = int(volume / 10.0 * rng.uniform(0.7, 1.3))

        vwap_alpha = rng.uniform(0.3, 0.7)
        vwap = vwap_alpha * price_close + (1.0 - vwap_alpha) * 0.5 * (price_high + price_low)

        spread_base = {"UP": 0.02, "DOWN": 0.02, "CHOP": 0.01}[current_regime]
        spr = spread_base * rng.uniform(0.8, 1.6)

        depth_scale = {"UP": 800, "DOWN": 800, "CHOP": 1200}[current_regime]
        bullish = price_close > price_open
        bearish = price_close < price_open

        if bullish:
            bbs = depth_scale * rng.uniform(1.0, 1.6)
            bas = depth_scale * rng.uniform(0.6, 1.1)
        elif bearish:
            bbs = depth_scale * rng.uniform(0.6, 1.1)
            bas = depth_scale * rng.uniform(1.0, 1.6)
        else:
            bbs = depth_scale * rng.uniform(0.8, 1.3)
            bas = depth_scale * rng.uniform(0.8, 1.3)

        if bullish:
            dbi_center = 0.62
        elif bearish:
            dbi_center = 0.38
        else:
            dbi_center = 0.5
        dbi = max(0.0, min(1.0, rng.gauss(dbi_center, 0.08)))

        midprice = price_close  # Treat close as the mid for this synthetic model.
        depth_sum = bbs + bas
        if depth_sum <= 0:
            microprice = midprice
        else:
            micro_shift = (bas - bbs) / depth_sum
            micro_shift = -micro_shift
            microprice = midprice + micro_shift * spr * rng.uniform(0.5, 1.5)

        ofi_scale = volume * 0.1
        if bullish:
            ofi_mean = +0.4 * ofi_scale
        elif bearish:
            ofi_mean = -0.4 * ofi_scale
        else:
            ofi_mean = 0.0
        ofi = rng.gauss(ofi_mean, 0.6 * ofi_scale)

        sigma_spr_base = {"UP": 0.005, "DOWN": 0.005, "CHOP": 0.002}[current_regime]
        sigma_spr = sigma_spr_base * rng.uniform(0.8, 2.0)

        total_l1 = bbs + bas
        frag = 1.0 / total_l1 if total_l1 > 0 else 0.0

        d_micro = microprice - microprice_prev

        tss_center = 1.0 if ofi_mean > 0 else (-1.0 if ofi_mean < 0 else 0.0)
        tss = rng.gauss(tss_center, 0.8)

        ts_start_bar = start_ts + timedelta(seconds=i * duration_sec)

        bars.append(
            SyntheticBar(
                symbol=symbol,
                timeframe=timeframe,
                ts_start=ts_start_bar,
                duration_sec=duration_sec,
                open=price_open,
                high=price_high,
                low=price_low,
                close=price_close,
                volume=volume,
                trades=trades,
                vwap=vwap,
                data_source="synthetic",
                scenario=scenario,
            )
        )

        l2_states.append(
            SyntheticL2(
                spr=spr,
                bbs=bbs,
                bas=bas,
                dbi=dbi,
                microprice=microprice,
                ofi=ofi,
                sigma_spr=sigma_spr,
                frag=frag,
                d_micro=d_micro,
                tss=tss,
            )
        )

        price = price_close
        microprice_prev = microprice

    return bars, l2_states

