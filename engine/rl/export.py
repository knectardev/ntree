from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Optional, Tuple

import numpy as np
import pandas as pd

from engine.rl.baselines import compute_zfade_baseline
from engine.rl.env import RLEnvConfig, TradingRLEnv
from engine.rl.feature_pipeline import FeaturePipeline, FeaturePipelineConfig
from engine.rl.feature_registry import FeatureRegistry
from utils import is_market_hours


@dataclass(frozen=True)
class DatasetMetadata:
    schema_id: str
    feature_names: list[str]
    feature_groups: list[str]
    env_cfg: Dict[str, Any]
    feat_cfg: Dict[str, Any]
    skipped_days: list[str] = field(default_factory=list)
    skipped_days_reason: str = "min_bars_per_episode"
    episode_day_counts: Dict[str, int] = field(default_factory=dict)


def _write_meta(meta_path: str, meta: DatasetMetadata) -> None:
    os.makedirs(os.path.dirname(meta_path) or ".", exist_ok=True)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(asdict(meta), f, indent=2, sort_keys=True)


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

    # Default session filtering for both env + exports.
    df_in = df_bars.copy()
    if str(env_cfg.session_mode).upper() == "RTH":
        if "ts" in df_in.columns:
            ts = pd.to_datetime(df_in["ts"], utc=True)
        else:
            ts = pd.to_datetime(df_in.index, utc=True)
        mask = [is_market_hours(t.to_pydatetime()) == "regular" for t in ts]
        df_in = df_in.loc[mask].copy()

    # Build pipeline once to reuse computed series.
    pipe = FeaturePipeline(df_bars=df_in, registry=reg, cfg=feat_cfg)

    # Build observation matrix assuming a neutral position-state baseline (pos=0).
    # Training env will supply the true position features during rollouts.
    obs = np.zeros((pipe.n, reg.dim), dtype=np.float32)
    for i in range(pipe.n):
        obs[i, :] = pipe.get_observation(i, position=0.0, time_in_pos=0, max_hold=env_cfg.max_hold)

    # Assemble dataset frame.
    out = pd.DataFrame(index=pipe.df.index)
    # Persist timestamps as UTC-naive datetimes (representing UTC) to avoid tz conversion issues
    # across parquet/csv and pandas versions.
    ts_utc = pipe.df.index.tz_convert("UTC") if getattr(pipe.df.index, "tz", None) is not None else pipe.df.index
    out["ts"] = ts_utc.tz_localize(None)
    for col in ["open", "high", "low", "close", "volume"]:
        if col in pipe.df.columns:
            out[col] = pipe.df[col].astype(float).values

    for j, name in enumerate(reg.feature_names):
        out[name] = obs[:, j].astype(np.float32)

    out["ret_1"] = pipe._series["ret_1"].astype(np.float64)

    # Episode selection metadata (so runs are reproducible/documentable)
    env_meta = TradingRLEnv(
        df_bars=pipe.df.reset_index().rename(columns={"index": "ts"}),
        registry=reg,
        feat_cfg=feat_cfg,
        env_cfg=env_cfg,
    )

    base_actions, base_pos, base_rew = compute_zfade_baseline(
        df_bars=pipe.df.reset_index().rename(columns={"index": "ts"}),
        registry=reg,
        feat_cfg=feat_cfg,
        env_cfg=env_cfg,
    )

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
        skipped_days=env_meta.skipped_days,
        skipped_days_reason="min_bars_per_episode",
        episode_day_counts=env_meta.skipped_day_counts,
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


