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
class TrendRegimeV3Params:
    # Regime model (per-bar log-return = drift + vol * N(0,1))
    regimes: Dict[Regime, Dict[str, float]]
    stay_prob: float

    # Market hours model (supports extended hours) + overnight gaps
    tz_name: str
    session_open_local: time
    session_minutes: int
    overnight_gap_sigma: float
    overnight_gap_mu: float

    # Extended hours multipliers (applied to volume/spread/return-vol outside RTH)
    pre_market_volume_mult: float
    after_hours_volume_mult: float
    pre_market_spread_mult: float
    after_hours_spread_mult: float
    pre_market_ret_vol_mult: float
    after_hours_ret_vol_mult: float

    # Diurnal profiles (U-shaped) for volume and volatility/spread
    diurnal_volume_strength: float
    diurnal_vol_strength: float
    base_spread: float
    spread_diurnal_strength: float

    # Depth / microstructure scalars
    depth_scale: float

    # Volume dynamics (multi-scale)
    # Daily multiplier is lognormal with AR(1)-like persistence in log-space.
    daily_vol_sigma: float        # std-dev of daily log-mult innovations
    daily_vol_rho: float          # persistence of daily log-mult (0..1)
    daily_vol_mu: float           # mean of daily log-mult (typically 0)

    # Event days (rare spikes)
    event_prob: float             # probability a trading day is an "event" day
    event_sigma: float            # extra log-mult sigma for event days

    # Coupling volume to absolute returns (more movement => more volume)
    vol_ret_coupling: float       # strength; 0 disables

    # Baseline per-bar volume level (arbitrary units)
    base_volume: float


DEFAULT_PARAMS = TrendRegimeV3Params(
    regimes={
        "UP": {"drift": 0.0006, "vol": 0.0022},
        "DOWN": {"drift": -0.0006, "vol": 0.0022},
        "CHOP": {"drift": 0.0, "vol": 0.0014},
    },
    stay_prob=0.92,
    tz_name="America/New_York",
    # Default to include extended hours like SPY (premarket + after-hours).
    # This makes session shading in chart.html behave like real data.
    session_open_local=time(4, 0),
    session_minutes=960,  # 04:00–20:00 ET
    overnight_gap_sigma=0.0030,
    overnight_gap_mu=0.0,
    pre_market_volume_mult=0.22,
    after_hours_volume_mult=0.22,
    pre_market_spread_mult=1.75,
    after_hours_spread_mult=1.75,
    pre_market_ret_vol_mult=0.95,
    after_hours_ret_vol_mult=0.95,
    diurnal_volume_strength=1.0,
    diurnal_vol_strength=0.8,
    base_spread=0.015,
    spread_diurnal_strength=0.6,
    depth_scale=1000.0,
    # Volume defaults tuned for "SPY-ish" variability at daily aggregation:
    daily_vol_sigma=0.25,    # ~25% log stdev -> noticeable day-to-day variation
    daily_vol_rho=0.65,      # clustering / persistence
    daily_vol_mu=0.0,
    event_prob=0.03,         # ~1 event day per ~33 trading days
    event_sigma=0.60,        # event days can be much larger
    vol_ret_coupling=12.0,   # scale |ret| into a meaningful multiplier
    base_volume=1000.0,
)


def _u_shape(t: float) -> float:
    """U-shaped profile in [0,1] with peaks at open/close."""
    x = 2.0 * (float(t) - 0.5)
    return max(0.0, min(1.0, x * x))


def _timeframe_to_minutes(timeframe: str) -> int:
    mapping = {"1m": 1, "5m": 5, "15m": 15}
    if timeframe not in mapping:
        raise ValueError(f"Unsupported timeframe: {timeframe}")
    return mapping[timeframe]


def generate_trend_regime_series_v3(
    *,
    dataset_name: str,
    ref_symbol: str | None,
    start_price: float,
    n_trading_days: int,
    timeframe: str = "1m",
    scenario: str = "trend_regime_v3",
    start_date_local: date | None = None,
    seed: int | None = None,
    params: TrendRegimeV3Params = DEFAULT_PARAMS,
) -> Tuple[List[SyntheticBar], List[SyntheticL2]]:
    """
    V3: Like v2 (market hours + overnight gaps, diurnal patterns) but improves volume realism:
    - Day-to-day volume variation via a lognormal daily multiplier
    - Volume clustering via persistence (AR-like) in log-mult space
    - Coupling volume to absolute returns (big moves => more volume)
    - Optional rare event-day spikes

    Notes:
    - Timestamps are generated in market local time then converted to UTC.
    - Weekends are skipped (holiday calendar not modeled).
    """
    if n_trading_days <= 0:
        raise ValueError("n_trading_days must be >= 1")

    rng = random.Random(seed) if seed is not None else random
    tz = pytz.timezone(params.tz_name)

    if start_date_local is None:
        now_local = datetime.now(timezone.utc).astimezone(tz)
        start_date_local = now_local.date()

    tf_min = _timeframe_to_minutes(timeframe)
    duration_sec = tf_min * 60
    bars_per_day = params.session_minutes // tf_min
    if bars_per_day <= 0:
        raise ValueError("timeframe too large for session_minutes")

    # Session boundaries in ET minutes since midnight.
    pre_start_m = 4 * 60
    rth_start_m = 9 * 60 + 30
    rth_end_m = 16 * 60
    ah_end_m = 20 * 60
    rth_minutes = rth_end_m - rth_start_m  # 390

    def is_trading_day(d: date) -> bool:
        return d.weekday() < 5  # Mon-Fri

    current_regime: Regime = "CHOP"
    price = float(start_price)
    microprice_prev = price

    bars: List[SyntheticBar] = []
    l2_states: List[SyntheticL2] = []

    # Daily volume multiplier process in log-space.
    rho = max(0.0, min(0.99, float(params.daily_vol_rho)))
    sigma_d = max(0.0, float(params.daily_vol_sigma))
    mu_d = float(params.daily_vol_mu)
    log_mult_prev = mu_d

    produced = 0
    cur = start_date_local
    while produced < n_trading_days:
        if not is_trading_day(cur):
            cur = cur + timedelta(days=1)
            continue

        d = cur

        # Overnight gap at start of day except the first produced trading day
        if produced > 0:
            gap_ret = params.overnight_gap_mu + params.overnight_gap_sigma * rng.gauss(0, 1)
            price = price * math.exp(gap_ret)
            microprice_prev = price
            current_regime = "CHOP"

        # Update daily volume multiplier with persistence (AR-like in log-space).
        # log_mult_t = mu + rho*(log_mult_{t-1}-mu) + sigma*sqrt(1-rho^2)*z
        z = rng.gauss(0, 1)
        innov = sigma_d * math.sqrt(max(0.0, 1.0 - rho * rho)) * z
        log_mult = mu_d + rho * (log_mult_prev - mu_d) + innov
        log_mult_prev = log_mult

        # Optional event spike on top of daily multiplier.
        if float(params.event_prob) > 0 and rng.random() < float(params.event_prob):
            log_mult += abs(float(params.event_sigma)) * rng.gauss(0, 1)

        daily_mult = math.exp(log_mult)

        open_dt_local = tz.localize(datetime.combine(d, params.session_open_local))

        for i in range(bars_per_day):
            # Local session clock for this bar.
            ts_start_local = open_dt_local + timedelta(minutes=i * tf_min)
            mins = ts_start_local.hour * 60 + ts_start_local.minute

            # Session classification (used for both visuals and realism).
            if mins >= pre_start_m and mins < rth_start_m:
                sess = "pre_market"
                vol_mult_sess = float(params.pre_market_volume_mult)
                spread_mult_sess = float(params.pre_market_spread_mult)
                ret_vol_mult_sess = float(params.pre_market_ret_vol_mult)
                u = 0.0
            elif mins >= rth_start_m and mins < rth_end_m:
                sess = "regular"
                vol_mult_sess = 1.0
                spread_mult_sess = 1.0
                ret_vol_mult_sess = 1.0
                # U-shape should be within RTH (open/close of regular session), not the full 4am–8pm window.
                t_rth = ((mins - rth_start_m) + (tf_min * 0.5)) / max(1.0, float(rth_minutes))
                u = _u_shape(t_rth)
            elif mins >= rth_end_m and mins < ah_end_m:
                sess = "after_hours"
                vol_mult_sess = float(params.after_hours_volume_mult)
                spread_mult_sess = float(params.after_hours_spread_mult)
                ret_vol_mult_sess = float(params.after_hours_ret_vol_mult)
                u = 0.0
            else:
                # In case session_minutes configuration extends beyond expected bounds.
                sess = "closed"
                vol_mult_sess = 0.05
                spread_mult_sess = 2.0
                ret_vol_mult_sess = 0.8
                u = 0.0

            # Regime transitions
            if rng.random() > params.stay_prob:
                candidates = [r for r in params.regimes.keys() if r != current_regime]
                current_regime = rng.choice(candidates)  # type: ignore[assignment]

            rp = params.regimes[current_regime]
            drift = float(rp["drift"])
            vol = float(rp["vol"])

            vol_mult = (1.0 + params.diurnal_vol_strength * u) * ret_vol_mult_sess
            ret = (drift * tf_min) + (vol * math.sqrt(tf_min) * vol_mult) * rng.gauss(0, 1)

            price_open = price
            price_close = price * math.exp(ret)

            # Intrabar range/wicks
            base_range = max(0.001 * price_open, abs(ret) * price_open)
            extra = (0.7 + rng.random()) * (vol * vol_mult) * price_open
            bar_range = base_range + extra
            upper_wiggle = (0.25 + 0.75 * rng.random()) * 0.6 * bar_range
            lower_wiggle = (0.25 + 0.75 * rng.random()) * 0.6 * bar_range
            price_high = max(price_open, price_close) + upper_wiggle
            price_low = min(price_open, price_close) - lower_wiggle
            price_high = max(price_high, price_open, price_close)
            price_low = min(price_low, price_open, price_close)

            # Volume:
            # - diurnal u-shape intraday
            # - daily multiplier (varies per day, clusters across days)
            # - coupling to abs returns (movement => more volume)
            # - modest iid noise so it doesn't look too "perfect"
            # Diurnal volume only really applies to regular session. Pre/after use a flatter profile.
            if sess == "regular":
                vol_u = 0.65 + 0.85 * u
                vol_u = 1.0 + params.diurnal_volume_strength * (vol_u - 1.0)
            else:
                vol_u = 1.0

            # Couple to movement (use |ret| relative to a "typical" sigma scale).
            coupling = max(0.0, float(params.vol_ret_coupling))
            move_mult = 1.0
            if coupling > 0:
                # Scale by sqrt(tf_min) so coupling feels similar across timeframes.
                ret_scale = max(1e-9, vol * math.sqrt(tf_min))
                move_mult = 1.0 + coupling * (abs(ret) / ret_scale)

            noise_mult = rng.lognormvariate(0.0, 0.25)  # heavy-tailed noise
            volume = params.base_volume * vol_u * daily_mult * move_mult * noise_mult * vol_mult_sess

            # Trades roughly proportional to volume
            trades = max(1, int(volume / 10.0 * rng.uniform(0.7, 1.3)))

            vwap_alpha = rng.uniform(0.3, 0.7)
            vwap = vwap_alpha * price_close + (1.0 - vwap_alpha) * 0.5 * (price_high + price_low)

            spr = params.base_spread * (1.0 + params.spread_diurnal_strength * u) * rng.uniform(0.8, 1.6) * spread_mult_sess

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

            ofi_scale = volume * 0.1
            ofi_mean = (+0.4 if bullish else (-0.4 if bearish else 0.0)) * ofi_scale
            ofi = rng.gauss(ofi_mean, 0.6 * ofi_scale)

            sigma_spr = (0.002 + 0.004 * u) * rng.uniform(0.8, 2.0)
            frag = 1.0 / (bbs + bas) if (bbs + bas) > 0 else 0.0
            d_micro = microprice - microprice_prev
            tss_center = 1.0 if ofi_mean > 0 else (-1.0 if ofi_mean < 0 else 0.0)
            tss = rng.gauss(tss_center, 0.8)

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


