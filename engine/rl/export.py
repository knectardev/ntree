from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional, Tuple

import numpy as np
import pandas as pd

from engine.rl.env import DiscreteActions, RLEnvConfig, TradingRLEnv
from engine.rl.feature_pipeline import FeaturePipeline, FeaturePipelineConfig
from engine.rl.feature_registry import FeatureRegistry


@dataclass(frozen=True)
class DatasetMetadata:
    schema_id: str
    feature_names: list[str]
    feature_groups: list[str]
    env_cfg: Dict[str, Any]
    feat_cfg: Dict[str, Any]


def _write_meta(meta_path: str, meta: DatasetMetadata) -> None:
    os.makedirs(os.path.dirname(meta_path) or ".", exist_ok=True)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(asdict(meta), f, indent=2, sort_keys=True)


def _baseline_z_fade_actions(mr_z: np.ndarray) -> np.ndarray:
    """
    Baseline:
    - enter short if z > +2
    - enter long if z < -2
    - exit if |z| <= 0.2
    """
    n = int(mr_z.shape[0])
    actions = np.full(n, DiscreteActions.HOLD, dtype=np.int32)
    pos = 0.0
    for t in range(n):
        z = float(mr_z[t])
        if not np.isfinite(z):
            actions[t] = DiscreteActions.HOLD
            continue
        if abs(z) <= 0.2:
            actions[t] = DiscreteActions.EXIT
            pos = 0.0
        elif z > 2.0:
            actions[t] = DiscreteActions.ENTER_SHORT
            pos = -1.0 if pos <= 0 else 0.0  # no flip
        elif z < -2.0:
            actions[t] = DiscreteActions.ENTER_LONG
            pos = 1.0 if pos >= 0 else 0.0  # no flip
        else:
            actions[t] = DiscreteActions.HOLD
    return actions


def serialize_dataset(
    *,
    df_bars: pd.DataFrame,
    out_path: str,
    registry: Optional[FeatureRegistry] = None,
    feat_cfg: Optional[FeaturePipelineConfig] = None,
    env_cfg: Optional[RLEnvConfig] = None,
) -> Tuple[str, str]:
    """
    Export an RL dataset with:
    - per-bar observations (one column per feature, stable schema/order)
    - raw next-bar log return (ret_1)
    - optional baseline actions/positions/rewards (z-fade)
    - metadata sidecar JSON containing schema_id + feature names/groups

    Returns: (data_path, meta_path)
    """
    reg = registry or FeatureRegistry.schema_v1()
    feat_cfg = feat_cfg or FeaturePipelineConfig()
    env_cfg = env_cfg or RLEnvConfig()

    # Build pipeline once to reuse computed series.
    pipe = FeaturePipeline(df_bars=df_bars, registry=reg, cfg=feat_cfg)

    # Build observation matrix assuming a neutral position-state baseline (pos=0).
    # Training env will supply the true position features during rollouts.
    obs = np.zeros((pipe.n, reg.dim), dtype=np.float32)
    for i in range(pipe.n):
        obs[i, :] = pipe.get_observation(i, position=0.0, time_in_pos=0, max_hold=env_cfg.max_hold)

    # Assemble dataset frame.
    out = pd.DataFrame(index=pipe.df.index)
    out["ts"] = pipe.df.index.astype("datetime64[ns]").astype("datetime64[ns]")
    for col in ["open", "high", "low", "close", "volume"]:
        if col in pipe.df.columns:
            out[col] = pipe.df[col].astype(float).values

    for j, name in enumerate(reg.feature_names):
        out[name] = obs[:, j].astype(np.float32)

    out["ret_1"] = pipe._series["ret_1"].astype(np.float64)

    # Baseline simulation via the env to ensure the same cost + no-flip semantics.
    env = TradingRLEnv(df_bars=pipe.df.reset_index().rename(columns={"index": "ts"}), registry=reg, feat_cfg=feat_cfg, env_cfg=env_cfg)
    # Use pipeline mr_z (computed on the same bars).
    base_actions = _baseline_z_fade_actions(pipe._series["mr_z"])
    base_pos = np.zeros(pipe.n, dtype=np.float64)
    base_rew = np.zeros(pipe.n, dtype=np.float64)

    # Step day-by-day; align arrays by absolute index.
    for day_i in range(env.n_days):
        obs0 = env.reset(day_index=day_i)
        _ = obs0
        # env internal t is absolute index
        done = False
        while not done:
            t = int(env._t)
            a = int(base_actions[t])
            _, r, done, info = env.step(a)
            base_pos[int(info["t"])] = float(info["pos"])
            base_rew[int(info["t"])] = float(r)

    out["baseline_zfade_action"] = base_actions.astype(np.int32)
    out["baseline_zfade_pos"] = base_pos.astype(np.float32)
    out["baseline_zfade_reward"] = base_rew.astype(np.float64)

    # Write metadata sidecar.
    meta = DatasetMetadata(
        schema_id=reg.schema_id,
        feature_names=reg.feature_names,
        feature_groups=reg.feature_groups,
        env_cfg=asdict(env_cfg),
        feat_cfg=asdict(feat_cfg),
    )
    meta_path = out_path + ".meta.json"
    _write_meta(meta_path, meta)

    # Write data: prefer parquet; fallback to csv if parquet engine isn't available.
    data_path = out_path
    try:
        if not data_path.lower().endswith(".parquet"):
            data_path = data_path + ".parquet"
        out.to_parquet(data_path, index=False)
    except Exception:
        data_path = out_path
        if not data_path.lower().endswith(".csv"):
            data_path = data_path + ".csv"
        out.to_csv(data_path, index=False)

    return data_path, meta_path


