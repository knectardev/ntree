from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from engine.rl.feature_pipeline import FeaturePipeline, FeaturePipelineConfig
from engine.rl.feature_registry import FeatureRegistry
from utils import is_market_hours


@dataclass(frozen=True)
class RLEnvConfig:
    max_hold: int = 60
    cost_per_change: float = 0.00005  # 0.5 bp
    breakout_penalty: float = 0.0002  # 2 bp
    session_mode: str = "RTH"  # "RTH" | "ALL"
    min_bars_per_episode: int = 300
    return_reward_components: bool = False
    return_debug_series: bool = False


class DiscreteActions:
    HOLD = 0
    ENTER_LONG = 1
    ENTER_SHORT = 2
    EXIT = 3


class TradingRLEnv:
    """
    Minimal stepper-style environment:
    - Discrete(4) actions {HOLD, ENTER_LONG, ENTER_SHORT, EXIT}
    - No instant flip: ENTER_* against an opposite position is treated as EXIT
    - Reward: pos_t * ΔlogP_{t+1} - cost_per_change*|pos_t - pos_{t-1}| - breakout_penalty*I(break and pos_t!=0)
    - Episode: by trading day (one day per episode)
    """

    def __init__(
        self,
        *,
        df_bars: pd.DataFrame,
        registry: Optional[FeatureRegistry] = None,
        feat_cfg: Optional[FeaturePipelineConfig] = None,
        env_cfg: Optional[RLEnvConfig] = None,
    ):
        self.registry = registry or FeatureRegistry.schema_v1()
        self.env_cfg = env_cfg or RLEnvConfig()

        df = df_bars.copy()
        if str(self.env_cfg.session_mode).upper() == "RTH":
            # Keep regular-hours bars only (SPY v1 default).
            if "ts" in df.columns:
                ts = pd.to_datetime(df["ts"], utc=True)
            else:
                ts = pd.to_datetime(df.index, utc=True)
            mask = [is_market_hours(t.to_pydatetime()) == "regular" for t in ts]
            df = df.loc[mask].copy()

        if df.empty:
            raise ValueError("No bars available after applying session filter")

        # Ensure a ts column for convenient export/info; FeaturePipeline will set index.
        if "ts" not in df.columns:
            df = df.copy()
            df["ts"] = df.index

        self.pipeline = FeaturePipeline(df_bars=df, registry=self.registry, cfg=feat_cfg)

        # Precompute episode boundaries (by date in US/Eastern via utils.get_trading_day).
        # We'll use UTC date here because df is already regular session; it's sufficient for 1-day episodes.
        ts_idx = self.pipeline.df.index
        day_keys = ts_idx.date
        self._day_starts: List[int] = []
        self._day_ends: List[int] = []
        self._skipped_days: List[str] = []
        self._skipped_day_counts: Dict[str, int] = {}
        cur = 0
        while cur < len(day_keys):
            d = day_keys[cur]
            j = cur + 1
            while j < len(day_keys) and day_keys[j] == d:
                j += 1
            if (j - cur) >= int(self.env_cfg.min_bars_per_episode):
                self._day_starts.append(cur)
                self._day_ends.append(j)  # exclusive
            else:
                ds = str(d)
                self._skipped_days.append(ds)
                self._skipped_day_counts[ds] = int(j - cur)
            cur = j

        self._day_idx = 0
        self._t = 0
        self._pos = 0.0
        self._pos_prev = 0.0
        self._time_in_pos = 0
        self.attempted_flip_count = 0
        self.coerced_to_exit_count = 0

    @property
    def n_days(self) -> int:
        return len(self._day_starts)

    @property
    def skipped_days(self) -> List[str]:
        return list(self._skipped_days)

    @property
    def skipped_day_counts(self) -> Dict[str, int]:
        return dict(self._skipped_day_counts)

    @property
    def t(self) -> int:
        return int(self._t)

    def reset(self, *, day_index: int = 0) -> np.ndarray:
        di = int(day_index)
        if di < 0 or di >= self.n_days:
            raise IndexError("day_index out of range")
        self._day_idx = di
        self._t = self._day_starts[di]
        self._pos = 0.0
        self._pos_prev = 0.0
        self._time_in_pos = 0
        self.attempted_flip_count = 0
        self.coerced_to_exit_count = 0
        return self.pipeline.get_observation(
            self._t, position=self._pos, time_in_pos=self._time_in_pos, max_hold=self.env_cfg.max_hold
        )

    def _apply_action(self, action: int) -> float:
        a = int(action)
        cur = float(self._pos)

        desired = cur
        if a == DiscreteActions.HOLD:
            desired = cur
        elif a == DiscreteActions.ENTER_LONG:
            if cur < 0:
                self.attempted_flip_count += 1
                self.coerced_to_exit_count += 1
                desired = 0.0  # no flip; short->exit
            else:
                desired = 1.0
        elif a == DiscreteActions.ENTER_SHORT:
            if cur > 0:
                self.attempted_flip_count += 1
                self.coerced_to_exit_count += 1
                desired = 0.0  # no flip; long->exit
            else:
                desired = -1.0
        elif a == DiscreteActions.EXIT:
            desired = 0.0
        else:
            desired = cur

        # Max hold enforcement (force flatten).
        if cur != 0.0 and int(self._time_in_pos) >= int(self.env_cfg.max_hold):
            desired = 0.0

        return desired

    def step(self, action: int) -> Tuple[np.ndarray, float, bool, Dict[str, Any]]:
        """
        Step from time t -> t+1.
        Returns: (obs_{t+1}, reward_{t+1}, done, info)
        """
        t = int(self._t)
        end = int(self._day_ends[self._day_idx])
        # If we're already at the last bar of the day, we can't step further.
        if t + 1 >= end:
            obs = self.pipeline.get_observation(
                t, position=self._pos, time_in_pos=self._time_in_pos, max_hold=self.env_cfg.max_hold
            )
            return obs, 0.0, True, {"reason": "end_of_day"}

        # Apply action at time t -> define pos_t.
        self._pos_prev = float(self._pos)
        self._pos = float(self._apply_action(action))

        # Update time in position.
        if self._pos == 0.0:
            self._time_in_pos = 0
        else:
            if self._pos_prev == self._pos:
                self._time_in_pos += 1
            else:
                self._time_in_pos = 1

        # Reward uses ΔlogP_{t+1} and pos_t.
        ret = float(self.pipeline._series["ret_1"][t + 1])  # logP[t+1]-logP[t]
        if not np.isfinite(ret):
            ret = 0.0

        pos_change = abs(float(self._pos) - float(self._pos_prev))
        cost = float(self.env_cfg.cost_per_change) * pos_change

        break_flag = float(self.pipeline._series["range_break_flag"][t])
        breakout_pen = float(self.env_cfg.breakout_penalty) if (self._pos != 0.0 and break_flag >= 0.5) else 0.0

        pnl = float(self._pos) * ret
        reward = pnl - cost - breakout_pen

        # Advance time.
        self._t = t + 1
        done = (self._t + 1 >= end)

        obs_next = self.pipeline.get_observation(
            self._t, position=self._pos, time_in_pos=self._time_in_pos, max_hold=self.env_cfg.max_hold
        )
        info = {
            "t": self._t,
            "pos": float(self._pos),
            "pos_prev": float(self._pos_prev),
            "time_in_pos": int(self._time_in_pos),
            "cost": float(cost),
            "breakout_penalty": float(breakout_pen),
            "attempted_flip_count": int(self.attempted_flip_count),
            "coerced_to_exit_count": int(self.coerced_to_exit_count),
        }
        if bool(self.env_cfg.return_reward_components):
            info["reward_components"] = {
                "pnl": float(pnl),
                "cost": float(cost),
                "breakout_penalty": float(breakout_pen),
                "pos_change": float(pos_change),
            }
        if bool(self.env_cfg.return_debug_series):
            # Keep this cheap: just expose a few core series for debugging/explanations.
            info["breakout_flag"] = float(break_flag)
            try:
                info["mr_z"] = float(self.pipeline._series["mr_z"][t])
            except Exception:
                info["mr_z"] = float("nan")
            try:
                info["sigma"] = float(self.pipeline._series["sigma"][t])
            except Exception:
                info["sigma"] = float("nan")
        return obs_next, float(reward), bool(done), info


