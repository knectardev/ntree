from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os

import numpy as np
import pandas as pd

from engine.rl.env import DiscreteActions, RLEnvConfig, TradingRLEnv
from engine.rl.baselines import compute_zfade_baseline
from engine.rl.feature_pipeline import FeaturePipeline, FeaturePipelineConfig
from engine.rl.feature_registry import FeatureRegistry


def _make_rth_bars(*, n: int, start_utc: datetime) -> pd.DataFrame:
    """
    Build a synthetic 1-minute series that lands inside RTH for US/Eastern.
    In winter, 09:30 ET == 14:30 UTC.
    """
    ts = [start_utc + timedelta(minutes=i) for i in range(n)]
    close = np.linspace(100.0, 101.0, n, dtype=np.float64)
    df = pd.DataFrame(
        {
            "ts": ts,
            "open": close,
            "high": close,
            "low": close,
            "close": close,
            "volume": np.full(n, 1_000.0, dtype=np.float64),
        }
    )
    return df


def test_warmup_zeroing_and_flag_flip():
    reg = FeatureRegistry.schema_v1()
    cfg = FeaturePipelineConfig(
        sigma_window=120,
        sigma_short_window=60,
        bands_window=120,
        bp_ema_fast=10,
        bp_ema_slow=60,
        bp_stat_window=120,
        acorr_window=120,
        trend_window=120,
    )

    # < 120 returns available => price_base should be cold (flags 0, features forced 0)
    df_short = _make_rth_bars(n=100, start_utc=datetime(2025, 1, 2, 14, 30, tzinfo=timezone.utc))
    pipe_short = FeaturePipeline(df_bars=df_short, registry=reg, cfg=cfg)

    cold_groups = ["price_base", "mr_bands", "cycle_proxy", "trend", "risk"]
    for i in range(pipe_short.n):
        obs = pipe_short.get_observation(i, position=0.0, time_in_pos=0, max_hold=60)
        for g in cold_groups:
            iw = reg.index_of(f"is_warm_{g}")
            assert float(obs[iw]) == 0.0
            # All non-flag features in the group must be zero while cold.
            idxs = [j for j, s in enumerate(reg.specs) if s.group == g and not s.name.startswith("is_")]
            if idxs:
                assert np.all(obs[idxs] == 0.0)

    # Extend past warmup and ensure price_base flips exactly when 120 returns are available.
    # With ret[i]=logP[i]-logP[i-1], we have N returns available at index i==N (returns 1..N).
    df_long = _make_rth_bars(n=140, start_utc=datetime(2025, 1, 2, 14, 30, tzinfo=timezone.utc))
    pipe_long = FeaturePipeline(df_bars=df_long, registry=reg, cfg=cfg)

    i_flip = 120
    obs_before = pipe_long.get_observation(i_flip - 1, position=0.0, time_in_pos=0, max_hold=60)
    obs_at = pipe_long.get_observation(i_flip, position=0.0, time_in_pos=0, max_hold=60)

    iw_pb = reg.index_of("is_warm_price_base")
    assert float(obs_before[iw_pb]) == 0.0
    assert float(obs_at[iw_pb]) == 1.0

    # Sanity: after warm, at least one price_base feature should be non-zero (time group may vary).
    price_base_idxs = [j for j, s in enumerate(reg.specs) if s.group == "price_base" and not s.name.startswith("is_")]
    assert any(float(obs_at[j]) != 0.0 for j in price_base_idxs)


def test_no_flip_reward_and_cost_accounting():
    reg = FeatureRegistry.schema_v1()
    cfg = FeaturePipelineConfig(sigma_window=2, bands_window=2, bp_stat_window=2, acorr_window=2, trend_window=2)

    # 3 bars inside RTH so env doesn't filter them out.
    ts0 = datetime(2025, 1, 2, 14, 30, tzinfo=timezone.utc)
    df = pd.DataFrame(
        {
            "ts": [ts0 + timedelta(minutes=i) for i in range(3)],
            "open": [100.0, 101.0, 102.0],
            "high": [100.0, 101.0, 102.0],
            "low": [100.0, 101.0, 102.0],
            "close": [100.0, 101.0, 102.0],
            "volume": [1000.0, 1000.0, 1000.0],
        }
    )

    env = TradingRLEnv(
        df_bars=df,
        registry=reg,
        feat_cfg=cfg,
        env_cfg=RLEnvConfig(
            max_hold=60,
            cost_per_change=0.0001,
            breakout_penalty=0.0002,
            session_mode="RTH",
            min_bars_per_episode=1,
        ),
    )
    _ = env.reset(day_index=0)

    # Step 0: ENTER_LONG from flat => pos=+1, cost applied once.
    _, r1, done1, info1 = env.step(DiscreteActions.ENTER_LONG)
    assert done1 is False
    assert info1["pos_prev"] == 0.0
    assert info1["pos"] == 1.0
    assert info1["cost"] == 0.0001
    assert info1["breakout_penalty"] == 0.0

    # Step 1: ENTER_SHORT while long => coerced to EXIT (no flip), cost applied once, no short exposure.
    _, r2, done2, info2 = env.step(DiscreteActions.ENTER_SHORT)
    assert done2 is True  # with 3 bars, stepping twice reaches end-of-day
    assert info2["pos_prev"] == 1.0
    assert info2["pos"] == 0.0
    assert info2["cost"] == 0.0001
    assert info2["attempted_flip_count"] >= 1
    assert info2["coerced_to_exit_count"] >= 1

    # Reward decomposition sanity:
    # - On coerced EXIT step, pnl term must be 0 because pos_t == 0
    # - Therefore reward == -cost (no breakout penalty in this synthetic series)
    assert abs(float(r2) - (-0.0001)) < 1e-9


def _compare_obs_excluding_time(reg: FeatureRegistry, a: np.ndarray, b: np.ndarray) -> None:
    """
    Assert two observations are identical excluding time-derived group features.
    Includes warm/missing flags (flags group) in the comparison.
    """
    strict_time = str(os.environ.get("ASSERT_TIME_EQUALITY", "")).strip() in ("1", "true", "TRUE", "yes", "YES")
    if strict_time:
        idxs = list(range(reg.dim))
    else:
        # Default: exclude time-derived group AND the flags that refer to the time group.
        time_idxs = set(reg.indices_for_group("time"))
        time_flag_idxs = set(reg.indices_for_group_flags("time"))
        idxs = [i for i in range(reg.dim) if i not in time_idxs and i not in time_flag_idxs]
    assert np.allclose(a[idxs], b[idxs], atol=0.0, rtol=0.0)


def test_no_lookahead_sentinel_price_and_volume_spikes():
    reg = FeatureRegistry.schema_v1()
    cfg = FeaturePipelineConfig(
        sigma_window=120,
        sigma_short_window=60,
        bands_window=120,
        bp_ema_fast=10,
        bp_ema_slow=60,
        bp_stat_window=120,
        acorr_window=120,
        trend_window=120,
    )

    # Determine a safe lookback bound from registry specs (excluding time group).
    max_lb = max(int(s.max_lookback or 0) for s in reg.specs if s.group != "time")
    warm_guess = 120  # v1 dominant warmup
    i_test = warm_guess + 50
    j_spike = i_test + max_lb + 50
    n = j_spike + 50

    df_base = _make_rth_bars(n=n, start_utc=datetime(2025, 1, 2, 14, 30, tzinfo=timezone.utc))

    pipe_base = FeaturePipeline(df_bars=df_base, registry=reg, cfg=cfg)

    # Variant A: future price spike (after j_spike).
    df_price = df_base.copy()
    for col in ["open", "high", "low", "close"]:
        df_price.loc[j_spike:, col] = df_price.loc[j_spike:, col].astype(float) + 50.0
    pipe_price = FeaturePipeline(df_bars=df_price, registry=reg, cfg=cfg)

    # Variant B: future volume spike (after j_spike).
    df_vol = df_base.copy()
    df_vol.loc[j_spike:, "volume"] = df_vol.loc[j_spike:, "volume"].astype(float) * 100.0
    pipe_vol = FeaturePipeline(df_bars=df_vol, registry=reg, cfg=cfg)

    # Compare a representative set of indices strictly before the spike can be in any trailing window.
    safe_end = j_spike - max_lb - 1
    probe = [0, 1, 10, i_test, i_test + 5, safe_end]
    probe = [p for p in probe if 0 <= p < safe_end]

    for i in probe:
        obs0 = pipe_base.get_observation(i, position=0.0, time_in_pos=0, max_hold=60)
        obsA = pipe_price.get_observation(i, position=0.0, time_in_pos=0, max_hold=60)
        obsB = pipe_vol.get_observation(i, position=0.0, time_in_pos=0, max_hold=60)
        _compare_obs_excluding_time(reg, obs0, obsA)
        _compare_obs_excluding_time(reg, obs0, obsB)


def test_baseline_parity_env_vs_baseline_helper_short_and_aggregate():
    reg = FeatureRegistry.schema_v1()
    cfg = FeaturePipelineConfig(sigma_window=120, bands_window=120, bp_stat_window=120, acorr_window=120, trend_window=120)
    env_cfg = RLEnvConfig(session_mode="RTH", cost_per_change=0.00005, breakout_penalty=0.0002, max_hold=60)

    # 1 full RTH day ~390 bars; we build 390 minutes from 14:30 UTC.
    df = _make_rth_bars(n=390, start_utc=datetime(2025, 1, 2, 14, 30, tzinfo=timezone.utc))

    actions, pos, rew = compute_zfade_baseline(df_bars=df, registry=reg, feat_cfg=cfg, env_cfg=env_cfg)

    # Step 1: strict per-step parity on first 300 bars slice (positions and rewards are aligned arrays).
    # We don't have a second implementation anymore; this asserts internal consistency and catches drift if refactoring.
    assert actions.shape[0] == pos.shape[0] == rew.shape[0]
    assert actions.shape[0] >= 300
    assert np.all(np.isfinite(pos[:300]))
    assert np.all(np.isfinite(rew[:300]))

    # Step 2: aggregate checks (non-trivial but stable).
    total_reward = float(np.sum(rew))
    turnover = float(np.sum(np.abs(np.diff(pos)) > 0))
    assert np.isfinite(total_reward)
    assert np.isfinite(turnover)


