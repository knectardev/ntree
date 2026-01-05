from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Literal, Tuple

import pytz

from .base import SyntheticBar, SyntheticL2

Regime = Literal["UP", "DOWN", "CHOP"]


@dataclass(frozen=True)
class TrendRegimeV2Params:
    # Regime model (per-bar log-return = drift + vol * N(0,1))
    regimes: Dict[Regime, Dict[str, float]]
    stay_prob: float

    # Market hours model (RTH only) + overnight gaps
    tz_name: str
    session_open_local: time
    session_minutes: int
    overnight_gap_sigma: float
    overnight_gap_mu: float

    # Diurnal profiles (U-shaped) for volume and volatility
    diurnal_volume_strength: float
    diurnal_vol_strength: float

    # Microstructure-ish scalars
    base_volume: float
    base_spread: float
    spread_diurnal_strength: float
    depth_scale: float


DEFAULT_PARAMS = TrendRegimeV2Params(
    regimes={
        "UP": {"drift": 0.0006, "vol": 0.0022},
        "DOWN": {"drift": -0.0006, "vol": 0.0022},
        "CHOP": {"drift": 0.0, "vol": 0.0014},
    },
    stay_prob=0.92,
    tz_name="America/New_York",
    session_open_local=time(9, 30),
    session_minutes=390,  # 6.5 hours
    overnight_gap_sigma=0.0030,  # ~0.30% (log-return sigma)
    overnight_gap_mu=0.0,
    diurnal_volume_strength=1.0,
    diurnal_vol_strength=0.8,
    base_volume=1000.0,
    base_spread=0.015,
    spread_diurnal_strength=0.6,
    depth_scale=1000.0,
)


def _u_shape(t: float) -> float:
    """
    U-shaped profile in [0,1] where:
    - near open/close => ~1
    - near mid-session => ~0
    """
    x = 2.0 * (float(t) - 0.5)
    return max(0.0, min(1.0, x * x))


def _timeframe_to_minutes(timeframe: str) -> int:
    mapping = {"1m": 1, "5m": 5, "15m": 15}
    if timeframe not in mapping:
        raise ValueError(f"Unsupported timeframe: {timeframe}")
    return mapping[timeframe]


def generate_trend_regime_series_v2(
    *,
    dataset_name: str,
    ref_symbol: str | None,
    start_price: float,
    n_trading_days: int,
    timeframe: str = "1m",
    scenario: str = "trend_regime_v2",
    start_date_local: date | None = None,
    seed: int | None = None,
    params: TrendRegimeV2Params = DEFAULT_PARAMS,
) -> Tuple[List[SyntheticBar], List[SyntheticL2]]:
    """
    Generate a synthetic OHLCV + L2 series that:
    - Emits RTH-only bars (US equities-style market hours) in America/New_York
    - Includes overnight gaps between days
    - Includes U-shaped diurnal volume (and optional diurnal volatility/spread effects)

    Notes:
    - This is not a calibrated model; "ref_symbol" is metadata for labeling/filtering.
    - Timestamps are generated in local market time then converted to UTC.
    """
    if n_trading_days <= 0:
        raise ValueError("n_trading_days must be >= 1")

    rng = random.Random(seed) if seed is not None else random
    tz = pytz.timezone(params.tz_name)

    if start_date_local is None:
        # Default to "today" in market local time.
        now_local = datetime.now(timezone.utc).astimezone(tz)
        start_date_local = now_local.date()

    tf_min = _timeframe_to_minutes(timeframe)
    duration_sec = tf_min * 60
    bars_per_day = params.session_minutes // tf_min
    if bars_per_day <= 0:
        raise ValueError("timeframe too large for session_minutes")

    current_regime: Regime = "CHOP"
    price = float(start_price)
    microprice_prev = price

    bars: List[SyntheticBar] = []
    l2_states: List[SyntheticL2] = []

    def is_trading_day(d: date) -> bool:
        # Mon-Fri only. (Holiday calendar not modeled in this synthetic generator.)
        return d.weekday() < 5

    # Produce N trading days, skipping weekends.
    produced = 0
    cur = start_date_local
    while produced < n_trading_days:
        if not is_trading_day(cur):
            cur = cur + timedelta(days=1)
            continue

        d = cur

        # Overnight gap applied at the start of each day except the first.
        if produced > 0:
            gap_ret = params.overnight_gap_mu + params.overnight_gap_sigma * rng.gauss(0, 1)
            price = price * math.exp(gap_ret)
            microprice_prev = price
            # New day open tends to be choppier in many markets; reset regime bias.
            current_regime = "CHOP"

        open_dt_local = tz.localize(datetime.combine(d, params.session_open_local))

        for i in range(bars_per_day):
            # Diurnal progress t in [0,1]
            t = (i + 0.5) / bars_per_day
            u = _u_shape(t)

            # Regime transitions
            if rng.random() > params.stay_prob:
                candidates = [r for r in params.regimes.keys() if r != current_regime]
                current_regime = rng.choice(candidates)  # type: ignore[assignment]

            rp = params.regimes[current_regime]
            drift = float(rp["drift"])
            vol = float(rp["vol"])

            # Scale drift/vol by timeframe length and diurnal volatility
            vol_mult = 1.0 + params.diurnal_vol_strength * u
            ret = (drift * tf_min) + (vol * math.sqrt(tf_min) * vol_mult) * rng.gauss(0, 1)

            price_open = price
            price_close = price * math.exp(ret)

            # Make intrabar range/wicks depend on vol + diurnal intensity
            base_range = max(0.001 * price_open, abs(ret) * price_open)
            extra = (0.7 + rng.random()) * (vol * vol_mult) * price_open
            bar_range = base_range + extra

            upper_wiggle = (0.25 + 0.75 * rng.random()) * 0.6 * bar_range
            lower_wiggle = (0.25 + 0.75 * rng.random()) * 0.6 * bar_range

            price_high = max(price_open, price_close) + upper_wiggle
            price_low = min(price_open, price_close) - lower_wiggle
            price_high = max(price_high, price_open, price_close)
            price_low = min(price_low, price_open, price_close)

            # U-shaped volume profile + noise
            vol_u = 0.65 + 0.85 * u
            vol_u = 1.0 + params.diurnal_volume_strength * (vol_u - 1.0)
            volume = params.base_volume * vol_u * rng.uniform(0.6, 1.6)

            trades = max(1, int(volume / 10.0 * rng.uniform(0.7, 1.3)))

            vwap_alpha = rng.uniform(0.3, 0.7)
            vwap = vwap_alpha * price_close + (1.0 - vwap_alpha) * 0.5 * (price_high + price_low)

            # Spread also tends to be wider at open/close.
            spr = params.base_spread * (1.0 + params.spread_diurnal_strength * u) * rng.uniform(0.8, 1.6)

            # Depth + imbalance heuristics
            depth_scale = params.depth_scale * (1.0 + 0.2 * u)
            bullish = price_close > price_open
            bearish = price_close < price_open

            if bullish:
                bbs = depth_scale * rng.uniform(1.0, 1.6)
                bas = depth_scale * rng.uniform(0.6, 1.1)
                dbi_center = 0.62
            elif bearish:
                bbs = depth_scale * rng.uniform(0.6, 1.1)
                bas = depth_scale * rng.uniform(1.0, 1.6)
                dbi_center = 0.38
            else:
                bbs = depth_scale * rng.uniform(0.8, 1.3)
                bas = depth_scale * rng.uniform(0.8, 1.3)
                dbi_center = 0.5

            dbi = max(0.0, min(1.0, rng.gauss(dbi_center, 0.08)))

            midprice = price_close
            depth_sum = bbs + bas
            if depth_sum <= 0:
                microprice = midprice
            else:
                micro_shift = (bas - bbs) / depth_sum
                micro_shift = -micro_shift
                microprice = midprice + micro_shift * spr * rng.uniform(0.5, 1.5)

            # OFI magnitude scales with volume.
            ofi_scale = volume * 0.1
            ofi_mean = (+0.4 if bullish else (-0.4 if bearish else 0.0)) * ofi_scale
            ofi = rng.gauss(ofi_mean, 0.6 * ofi_scale)

            sigma_spr = (0.002 + 0.004 * u) * rng.uniform(0.8, 2.0)
            frag = 1.0 / (bbs + bas) if (bbs + bas) > 0 else 0.0
            d_micro = microprice - microprice_prev
            tss_center = 1.0 if ofi_mean > 0 else (-1.0 if ofi_mean < 0 else 0.0)
            tss = rng.gauss(tss_center, 0.8)

            ts_start_local = open_dt_local + timedelta(minutes=i * tf_min)
            ts_start_utc = ts_start_local.astimezone(timezone.utc)

            bars.append(
                SyntheticBar(
                    symbol=str(dataset_name),
                    timeframe=timeframe,
                    ts_start=ts_start_utc,
                    duration_sec=duration_sec,
                    open=float(price_open),
                    high=float(price_high),
                    low=float(price_low),
                    close=float(price_close),
                    volume=float(volume),
                    trades=int(trades),
                    vwap=float(vwap),
                    data_source="synthetic",
                    scenario=str(scenario),
                    ref_symbol=str(ref_symbol).strip().upper() if ref_symbol else None,
                )
            )

            l2_states.append(
                SyntheticL2(
                    spr=float(spr),
                    bbs=float(bbs),
                    bas=float(bas),
                    dbi=float(dbi),
                    microprice=float(microprice),
                    ofi=float(ofi),
                    sigma_spr=float(sigma_spr),
                    frag=float(frag),
                    d_micro=float(d_micro),
                    tss=float(tss),
                )
            )

            price = float(price_close)
            microprice_prev = float(microprice)

        produced += 1
        cur = cur + timedelta(days=1)

    return bars, l2_states


