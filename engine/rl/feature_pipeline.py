from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from engine.rl.feature_registry import FeatureRegistry
from utils import calculate_vwap_per_trading_day


def _as_utc_dt(ts: Any) -> datetime:
    if isinstance(ts, datetime):
        dt = ts
    else:
        s = str(ts)
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _rolling_mean_std(x: np.ndarray, window: int) -> Tuple[np.ndarray, np.ndarray]:
    """
    Trailing rolling mean/std (no lookahead).
    NaNs are treated as 0 for stability (keeps behavior predictable).
    """
    n = int(x.shape[0])
    w = max(1, int(window))
    mean = np.full(n, np.nan, dtype=np.float64)
    std = np.full(n, np.nan, dtype=np.float64)
    q = np.zeros(w, dtype=np.float64)
    sum_v = 0.0
    sum2_v = 0.0
    cnt = 0
    qi = 0

    for i in range(n):
        v = float(x[i])
        if not math.isfinite(v):
            v = 0.0
        if cnt < w:
            q[qi] = v
            qi = (qi + 1) % w
            sum_v += v
            sum2_v += v * v
            cnt += 1
        else:
            # pop oldest at qi
            old = float(q[qi])
            q[qi] = v
            qi = (qi + 1) % w
            sum_v += v - old
            sum2_v += v * v - old * old

        if cnt <= 0:
            continue
        mu = sum_v / cnt
        mean[i] = mu
        if cnt <= 1:
            continue
        var = max(0.0, (sum2_v / cnt) - mu * mu)
        std[i] = math.sqrt(var)

    return mean.astype(np.float64), std.astype(np.float64)


def _rolling_std(x: np.ndarray, window: int) -> np.ndarray:
    _, s = _rolling_mean_std(x, window)
    return s


def _ema(x: np.ndarray, period: int) -> np.ndarray:
    """
    Causal EMA, seeded with x[0] (matches UI intent).
    """
    n = int(x.shape[0])
    p = max(1, int(period))
    k = 2.0 / (p + 1.0)
    out = np.zeros(n, dtype=np.float64)
    ema = float(x[0]) if n else 0.0
    if not math.isfinite(ema):
        ema = 0.0
    if n:
        out[0] = ema
    for i in range(1, n):
        v = float(x[i])
        if not math.isfinite(v):
            v = ema
        ema = v * k + ema * (1.0 - k)
        out[i] = ema
    return out.astype(np.float64)


def _rolling_corr(x: np.ndarray, *, lag: int, window: int) -> np.ndarray:
    """
    Causal rolling correlation corr(x_t, x_{t-lag}) over a trailing window.
    """
    n = int(x.shape[0])
    L = max(1, int(lag))
    W = max(5, int(window))
    out = np.full(n, np.nan, dtype=np.float64)

    for i in range(n):
        j0 = i - W + 1
        if j0 < L:
            continue
        a = x[j0 : i + 1]
        b = x[j0 - L : i + 1 - L]
        if a.shape[0] != b.shape[0] or a.shape[0] < 5:
            continue
        # Replace non-finite with 0 for stability (matches "emit 0 while warm" philosophy).
        aa = np.where(np.isfinite(a), a, 0.0)
        bb = np.where(np.isfinite(b), b, 0.0)
        ma = float(np.mean(aa))
        mb = float(np.mean(bb))
        da = aa - ma
        db = bb - mb
        va = float(np.mean(da * da))
        vb = float(np.mean(db * db))
        if va <= 1e-18 or vb <= 1e-18:
            continue
        cov = float(np.mean(da * db))
        out[i] = cov / math.sqrt(va * vb)

    return out.astype(np.float64)

def _rolling_count(mask: np.ndarray, window: int) -> np.ndarray:
    """
    Causal rolling count of True values over the last `window` points (inclusive).
    """
    n = int(mask.shape[0])
    w = max(1, int(window))
    out = np.zeros(n, dtype=np.int32)
    q = np.zeros(w, dtype=np.int32)
    cnt = 0
    qi = 0
    run = 0
    for i in range(n):
        v = 1 if bool(mask[i]) else 0
        if cnt < w:
            q[qi] = v
            qi = (qi + 1) % w
            run += v
            cnt += 1
        else:
            old = int(q[qi])
            q[qi] = v
            qi = (qi + 1) % w
            run += v - old
        out[i] = int(run)
    return out


@dataclass(frozen=True)
class FeaturePipelineConfig:
    sigma_window: int = 120
    sigma_short_window: int = 60
    bands_window: int = 120
    breakout_k: float = 2.0
    bp_ema_fast: int = 10
    bp_ema_slow: int = 60
    bp_stat_window: int = 120
    acorr_window: int = 120
    acorr_lags: Tuple[int, int, int] = (15, 30, 60)
    trend_window: int = 120
    sigma_floor: float = 1e-12


class FeaturePipeline:
    """
    Causal (no-lookahead) feature computation + observation builder.
    """

    def __init__(
        self,
        *,
        df_bars: pd.DataFrame,
        registry: Optional[FeatureRegistry] = None,
        cfg: Optional[FeaturePipelineConfig] = None,
    ):
        self.registry = registry or FeatureRegistry.schema_v1()
        self.cfg = cfg or FeaturePipelineConfig()

        if df_bars is None or df_bars.empty:
            raise ValueError("df_bars must be a non-empty DataFrame")
        self.df = df_bars.copy()

        # Accept either an explicit 'ts' column or a datetime-like index.
        if "ts" in self.df.columns:
            ts = self.df["ts"].map(_as_utc_dt)
            self.df = self.df.drop(columns=["ts"])
            self.df.index = pd.DatetimeIndex(ts, tz="UTC")
        else:
            if not isinstance(self.df.index, pd.DatetimeIndex):
                raise ValueError("df_bars must have a 'ts' column or a DatetimeIndex")
            if self.df.index.tz is None:
                self.df.index = self.df.index.tz_localize("UTC")
            else:
                self.df.index = self.df.index.tz_convert("UTC")

        # Required OHLCV
        for c in ["open", "high", "low", "close"]:
            if c not in self.df.columns:
                raise ValueError(f"df_bars missing required column: {c}")
        if "volume" not in self.df.columns:
            self.df["volume"] = 0.0

        self._compute_core()

    def _compute_core(self) -> None:
        c = self.cfg
        close = self.df["close"].astype(float).to_numpy(dtype=np.float64)
        logp = np.where(close > 0, np.log(close), np.nan).astype(np.float64)
        n = int(close.shape[0])

        ret = np.full(n, np.nan, dtype=np.float64)
        for i in range(1, n):
            a = float(logp[i - 1])
            b = float(logp[i])
            if math.isfinite(a) and math.isfinite(b):
                ret[i] = b - a

        sigma = _rolling_std(np.where(np.isfinite(ret), ret, 0.0), c.sigma_window)
        sigma_short = _rolling_std(np.where(np.isfinite(ret), ret, 0.0), c.sigma_short_window)
        sigma_eff = np.where(np.isfinite(sigma) & (sigma > c.sigma_floor), sigma, c.sigma_floor)
        vol_z = np.where(np.isfinite(sigma_short) & (sigma_short > c.sigma_floor), sigma_short, c.sigma_floor) / sigma_eff

        # VWAP anchored to 09:30 ET (util function already matches this behavior).
        df_for_vwap = self.df.copy()
        df_for_vwap.index = self.df.index  # ensure aligned DatetimeIndex
        vwap = calculate_vwap_per_trading_day(df_for_vwap)
        vwap_arr = vwap.to_numpy(dtype=np.float64)
        vwap_dev_z = np.full(n, np.nan, dtype=np.float64)
        for i in range(n):
            vw = float(vwap_arr[i]) if i < len(vwap_arr) else math.nan
            if not math.isfinite(vw) or vw <= 0 or not math.isfinite(float(logp[i])):
                continue
            vwap_dev_z[i] = (logp[i] - math.log(vw)) / float(sigma_eff[i])

        # Mean-reversion bands on log price.
        mu_lp, sd_lp = _rolling_mean_std(np.where(np.isfinite(logp), logp, 0.0), c.bands_window)
        mr_z = np.full(n, np.nan, dtype=np.float64)
        band_w_z = np.full(n, np.nan, dtype=np.float64)
        for i in range(n):
            s = float(sd_lp[i])
            if not math.isfinite(s) or s <= 1e-18:
                continue
            mr_z[i] = (float(logp[i]) - float(mu_lp[i])) / s if math.isfinite(float(logp[i])) else math.nan
            band_w_z[i] = s / float(sigma_eff[i])

        # Range break flag on close price (SMA ± k*STD).
        mu_c, sd_c = _rolling_mean_std(np.where(np.isfinite(close), close, 0.0), c.bands_window)
        rb = np.zeros(n, dtype=np.float64)
        for i in range(n):
            m = float(mu_c[i])
            s = float(sd_c[i])
            if not math.isfinite(m) or not math.isfinite(s) or s <= 1e-18:
                continue
            up = m + float(c.breakout_k) * s
            dn = m - float(c.breakout_k) * s
            px = float(close[i])
            if math.isfinite(px) and (px > up or px < dn):
                rb[i] = 1.0

        # Cycle proxy: EMA diff on log price.
        ema_fast = _ema(np.where(np.isfinite(logp), logp, 0.0), c.bp_ema_fast)
        ema_slow = _ema(np.where(np.isfinite(logp), logp, 0.0), c.bp_ema_slow)
        bp = (ema_fast - ema_slow).astype(np.float64)
        bp_mu, bp_sd = _rolling_mean_std(bp, c.bp_stat_window)
        bp_z = np.full(n, np.nan, dtype=np.float64)
        for i in range(n):
            s = float(bp_sd[i])
            if not math.isfinite(s) or s <= 1e-18:
                continue
            bp_z[i] = (float(bp[i]) - float(bp_mu[i])) / s
        bp_slope = np.full(n, np.nan, dtype=np.float64)
        for i in range(1, n):
            bp_slope[i] = float(bp[i]) - float(bp[i - 1])

        acorr = {
            int(lag): _rolling_corr(np.where(np.isfinite(ret), ret, 0.0), lag=int(lag), window=c.acorr_window)
            for lag in c.acorr_lags
        }

        # Trend slope (rolling OLS slope on log price over a fixed window).
        trend_slope_z = np.full(n, np.nan, dtype=np.float64)
        W = max(5, int(c.trend_window))
        xbar = (W - 1) / 2.0
        denom = sum((j - xbar) * (j - xbar) for j in range(W))
        sum_y = 0.0
        sum_xy = 0.0
        # ring buffer for logp
        qy = np.zeros(W, dtype=np.float64)
        cnt = 0
        qi = 0
        for i in range(n):
            y = float(logp[i])
            if not math.isfinite(y):
                y = 0.0
            if cnt < W:
                qy[qi] = y
                qi = (qi + 1) % W
                sum_y += y
                # x index is cnt (not stable until full), but we only emit once full.
                sum_xy += float(cnt) * y
                cnt += 1
            else:
                # remove oldest which corresponds to x=0 after shifting; we must rebuild sum_xy for fixed x.
                # For simplicity and correctness, recompute window sums when full (W=120 => fine).
                qy[qi] = y
                qi = (qi + 1) % W
                # rebuild contiguous window ending at i
                # order oldest..newest:
                win = np.concatenate([qy[qi:], qy[:qi]])
                sum_y = float(np.sum(win))
                sum_xy = float(np.dot(np.arange(W, dtype=np.float64), win))
                cnt = W

            if cnt == W:
                num = sum_xy - xbar * sum_y
                slope = num / denom if denom > 0 else 0.0  # log-price change per bar
                trend_slope_z[i] = slope / float(sigma_eff[i])

        # Time-of-day features (minutes since 09:30 ET encoded as sin/cos).
        # If you filter to regular session only, this naturally ranges 0..390.
        tod_sin = np.zeros(n, dtype=np.float64)
        tod_cos = np.ones(n, dtype=np.float64)
        try:
            import pytz

            et = pytz.timezone("US/Eastern")
        except Exception:  # pragma: no cover
            et = None
        for i, ts in enumerate(self.df.index):
            dt = ts.to_pydatetime()
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if et is None:
                mins_from_open = 0.0
            else:
                dt_et = dt.astimezone(et)
                mins = dt_et.hour * 60 + dt_et.minute
                mins_from_open = float(mins - (9 * 60 + 30))
                mins_from_open = max(0.0, min(390.0, mins_from_open))
            frac = mins_from_open / 390.0 if 390.0 > 0 else 0.0
            ang = 2.0 * math.pi * frac
            tod_sin[i] = math.sin(ang)
            tod_cos[i] = math.cos(ang)

        self._series: Dict[str, np.ndarray] = {
            "ret_1": ret,
            "ret_1_z": np.where(np.isfinite(ret), ret / sigma_eff, np.nan),
            "sigma": sigma_eff,
            "vol_z": vol_z,
            "vwap_dev_z": vwap_dev_z,
            "mr_z": mr_z,
            "mr_band_width_z": band_w_z,
            "bp": bp,
            "bp_z": bp_z,
            "bp_slope": bp_slope,
            "acorr_ret_l15": acorr.get(15, np.full(n, np.nan, dtype=np.float64)),
            "acorr_ret_l30": acorr.get(30, np.full(n, np.nan, dtype=np.float64)),
            "acorr_ret_l60": acorr.get(60, np.full(n, np.nan, dtype=np.float64)),
            "trend_slope_z": trend_slope_z,
            "range_break_flag": rb,
            "tod_sin": tod_sin,
            "tod_cos": tod_cos,
            # placeholders (kept as 0)
            "cycle_period_norm": np.zeros(n, dtype=np.float64),
            "cycle_coherence": np.zeros(n, dtype=np.float64),
            "cycle_phase_sin": np.zeros(n, dtype=np.float64),
            "cycle_phase_cos": np.zeros(n, dtype=np.float64),
            "cycle_amplitude": np.zeros(n, dtype=np.float64),
        }

        # Warmup/availability masks (per-group), based on *actual trailing window satisfaction*.
        # Key rule from notes: treat sigma warm when you have at least N returns in the trailing window.
        ret_ok = np.isfinite(ret)
        logp_ok = np.isfinite(logp)
        close_ok = np.isfinite(close)

        sigma_cnt = _rolling_count(ret_ok, c.sigma_window)
        bands_cnt_lp = _rolling_count(logp_ok, c.bands_window)
        bands_cnt_c = _rolling_count(close_ok, c.bands_window)
        bp_cnt = _rolling_count(logp_ok, c.bp_stat_window)
        ac_cnt = _rolling_count(ret_ok, c.acorr_window)
        trend_cnt = _rolling_count(logp_ok, c.trend_window)

        self._group_ready: Dict[str, np.ndarray] = {
            "price_base": (sigma_cnt >= int(c.sigma_window)).astype(np.int32),
            "mr_bands": (bands_cnt_lp >= int(c.bands_window)).astype(np.int32),
            "risk": (bands_cnt_c >= int(c.bands_window)).astype(np.int32),
            "cycle_proxy": (
                (bp_cnt >= int(c.bp_stat_window))
                & (ac_cnt >= int(c.acorr_window))
                & (np.arange(n) >= int(c.bp_ema_slow))
            ).astype(np.int32),
            "trend": (trend_cnt >= int(c.trend_window)).astype(np.int32),
            "time": np.ones(n, dtype=np.int32),
            "position_state": np.ones(n, dtype=np.int32),
            "cycle_scan": np.ones(n, dtype=np.int32),
            "flags": np.ones(n, dtype=np.int32),
        }

    @property
    def n(self) -> int:
        return int(self.df.shape[0])

    @property
    def group_warmup(self) -> Dict[str, int]:
        # Backwards-compatible informational view: first index where group becomes ready.
        out: Dict[str, int] = {}
        for g, m in self._group_ready.items():
            idxs = np.where(m.astype(bool))[0]
            out[g] = int(idxs[0]) if len(idxs) else self.n
        return out

    def get_observation(
        self,
        i: int,
        *,
        position: float = 0.0,
        time_in_pos: int = 0,
        max_hold: int = 60,
    ) -> np.ndarray:
        """
        Return fixed-length observation vector for bar i (schema_v1 order).

        Enforcements:
        - per-group warmup: emit 0 for all features in group until warm
        - per-group missing: emit 0 when missing (and flag is_missing_<group>=1)
        - registry-driven clipping
        """
        idx = int(i)
        if idx < 0 or idx >= self.n:
            raise IndexError("bar index out of range")

        obs = np.zeros(self.registry.dim, dtype=np.float32)

        # Determine per-group warm/missing at this index.
        warm: Dict[str, int] = {}
        miss: Dict[str, int] = {}
        for g in self.registry.feature_groups:
            gm = self._group_ready.get(g)
            warm[g] = int(gm[idx]) if gm is not None else 1
            miss[g] = 0

        # Missing checks (only meaningful once warm).
        # Note: vwap_dev_z can be missing premarket; mark missing for price_base in that case.
        if warm.get("price_base", 0) == 1:
            v = float(self._series["vwap_dev_z"][idx])
            if not math.isfinite(v):
                miss["price_base"] = 1

        # Build observation in registry order.
        for j, spec in enumerate(self.registry.specs):
            name = spec.name
            g = spec.group

            if name.startswith("is_warm_"):
                gg = name.replace("is_warm_", "", 1)
                obs[j] = float(warm.get(gg, 0))
                continue
            if name.startswith("is_missing_"):
                gg = name.replace("is_missing_", "", 1)
                obs[j] = float(miss.get(gg, 0))
                continue

            # Position-state values are provided by env/runner.
            if name == "position":
                val = float(position)
            elif name == "time_in_pos_norm":
                mh = max(1, int(max_hold))
                val = float(max(0, int(time_in_pos))) / float(mh)
            else:
                arr = self._series.get(name)
                if arr is None:
                    val = 0.0
                else:
                    val = float(arr[idx])

            # Enforce warmup/missing -> hard zero.
            if warm.get(g, 1) == 0:
                val = 0.0
            elif miss.get(g, 0) == 1:
                val = 0.0
            elif not math.isfinite(val):
                # Treat non-finite as missing within the group.
                miss[g] = 1
                val = 0.0

            # Apply clip.
            if spec.clip is not None:
                lo, hi = spec.clip
                if val < lo:
                    val = lo
                elif val > hi:
                    val = hi

            obs[j] = float(val)

        # Second pass: ensure flags reflect any missing triggered during build.
        # (Because we may mark miss[g]=1 after encountering a non-finite feature.)
        for j, spec in enumerate(self.registry.specs):
            name = spec.name
            if name.startswith("is_missing_"):
                gg = name.replace("is_missing_", "", 1)
                obs[j] = float(miss.get(gg, 0))
            if name.startswith("is_warm_"):
                gg = name.replace("is_warm_", "", 1)
                obs[j] = float(warm.get(gg, 0))

        return obs


