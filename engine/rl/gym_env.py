from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import numpy as np

import gymnasium as gym
from gymnasium import spaces

from engine.rl.env import TradingRLEnv


class TradingGymEnv(gym.Env):
    """
    Gymnasium Env wrapper for Stable-Baselines3.

    Notes:
    - One episode == one trading day (per TradingRLEnv.reset(day_index=...)).
    - When we run out of days, we wrap back to day 0 (SB3 expects infinite streams).
    """

    metadata = {"render_modes": []}

    def __init__(self, env: TradingRLEnv):
        super().__init__()
        self._env = env
        self._day = 0

        self.action_space = spaces.Discrete(4)
        self.observation_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(env.registry.dim,),
            dtype=np.float32,
        )

    def reset(
        self, *, seed: Optional[int] = None, options: Optional[Dict[str, Any]] = None
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        super().reset(seed=seed)
        _ = options
        if self._day >= self._env.n_days:
            self._day = 0
        obs = self._env.reset(day_index=self._day)
        self._day += 1
        return obs.astype(np.float32, copy=False), {}

    def step(self, action: Any) -> Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]:
        obs, r, done, info = self._env.step(int(action))
        terminated = bool(done)
        truncated = False
        return obs.astype(np.float32, copy=False), float(r), terminated, truncated, info


