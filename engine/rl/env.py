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
    regular_session_only: bool = True


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
        if self.env_cfg.regular_session_only:
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
        cur = 0
        while cur < len(day_keys):
            d = day_keys[cur]
            self._day_starts.append(cur)
            j = cur + 1
            while j < len(day_keys) and day_keys[j] == d:
                j += 1
            self._day_ends.append(j)  # exclusive
            cur = j

        self._day_idx = 0
        self._t = 0
        self._pos = 0.0
        self._pos_prev = 0.0
        self._time_in_pos = 0

    @property
    def n_days(self) -> int:
        return len(self._day_starts)

    def reset(self, *, day_index: int = 0) -> np.ndarray:
        di = int(day_index)
        if di < 0 or di >= self.n_days:
            raise IndexError("day_index out of range")
        self._day_idx = di
        self._t = self._day_starts[di]
        self._pos = 0.0
        self._pos_prev = 0.0
        self._time_in_pos = 0
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
            desired = 1.0 if cur >= 0 else 0.0  # no flip; short->exit
        elif a == DiscreteActions.ENTER_SHORT:
            desired = -1.0 if cur <= 0 else 0.0  # no flip; long->exit
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

        cost = float(self.env_cfg.cost_per_change) * abs(float(self._pos) - float(self._pos_prev))

        break_flag = float(self.pipeline._series["range_break_flag"][t])
        breakout_pen = float(self.env_cfg.breakout_penalty) if (self._pos != 0.0 and break_flag >= 0.5) else 0.0

        reward = float(self._pos) * ret - cost - breakout_pen

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
        }
        return obs_next, float(reward), bool(done), info


