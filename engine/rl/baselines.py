from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np

from engine.rl.env import DiscreteActions, RLEnvConfig, TradingRLEnv
from engine.rl.feature_pipeline import FeaturePipeline, FeaturePipelineConfig
from engine.rl.feature_registry import FeatureRegistry


@dataclass(frozen=True)
class ZFadeConfig:
    enter_z: float = 2.0
    exit_z: float = 0.2


def z_fade_actions(*, mr_z: np.ndarray, cfg: Optional[ZFadeConfig] = None) -> np.ndarray:
    """
    Baseline policy:
    - enter short if z > +enter_z
    - enter long if z < -enter_z
    - exit if |z| <= exit_z
    - otherwise hold
    """
    cfg = cfg or ZFadeConfig()
    n = int(mr_z.shape[0])
    actions = np.full(n, DiscreteActions.HOLD, dtype=np.int32)
    pos = 0.0
    for t in range(n):
        z = float(mr_z[t])
        if not np.isfinite(z):
            actions[t] = DiscreteActions.HOLD
            continue
        if abs(z) <= float(cfg.exit_z):
            actions[t] = DiscreteActions.EXIT
            pos = 0.0
        elif z > float(cfg.enter_z):
            actions[t] = DiscreteActions.ENTER_SHORT
            pos = -1.0 if pos <= 0 else 0.0  # no flip (policy-level)
        elif z < -float(cfg.enter_z):
            actions[t] = DiscreteActions.ENTER_LONG
            pos = 1.0 if pos >= 0 else 0.0  # no flip (policy-level)
        else:
            actions[t] = DiscreteActions.HOLD
    return actions


def simulate_actions_in_env(
    *,
    df_bars,
    actions: np.ndarray,
    registry: Optional[FeatureRegistry] = None,
    feat_cfg: Optional[FeaturePipelineConfig] = None,
    env_cfg: Optional[RLEnvConfig] = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Simulate actions in TradingRLEnv day-by-day and return (pos, reward) arrays aligned to bars.
    """
    reg = registry or FeatureRegistry.schema_v1()
    feat_cfg = feat_cfg or FeaturePipelineConfig()
    env_cfg = env_cfg or RLEnvConfig()
    env = TradingRLEnv(df_bars=df_bars, registry=reg, feat_cfg=feat_cfg, env_cfg=env_cfg)

    n = int(env.pipeline.n)
    pos = np.zeros(n, dtype=np.float64)
    rew = np.zeros(n, dtype=np.float64)
    for day_i in range(env.n_days):
        _ = env.reset(day_index=day_i)
        done = False
        while not done:
            t = int(env.t)
            a = int(actions[t])
            _, r, done, info = env.step(a)
            pos[int(info["t"])] = float(info["pos"])
            rew[int(info["t"])] = float(r)
    return pos.astype(np.float64), rew.astype(np.float64)


def compute_zfade_baseline(
    *,
    df_bars,
    registry: Optional[FeatureRegistry] = None,
    feat_cfg: Optional[FeaturePipelineConfig] = None,
    env_cfg: Optional[RLEnvConfig] = None,
    zfade_cfg: Optional[ZFadeConfig] = None,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Compute z-fade baseline (actions + env-simulated pos/reward) for a given bars frame.
    """
    reg = registry or FeatureRegistry.schema_v1()
    feat_cfg = feat_cfg or FeaturePipelineConfig()
    env_cfg = env_cfg or RLEnvConfig()

    pipe = FeaturePipeline(df_bars=df_bars, registry=reg, cfg=feat_cfg)
    acts = z_fade_actions(mr_z=pipe._series["mr_z"], cfg=zfade_cfg)
    pos, rew = simulate_actions_in_env(df_bars=pipe.df.reset_index().rename(columns={"index": "ts"}), actions=acts, registry=reg, feat_cfg=feat_cfg, env_cfg=env_cfg)
    return acts.astype(np.int32), pos.astype(np.float64), rew.astype(np.float64)


