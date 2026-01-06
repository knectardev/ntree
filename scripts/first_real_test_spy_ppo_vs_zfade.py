from __future__ import annotations

"""
First real test runner (SPY 1m RTH):

- Pull bars from SQLite stock_data (ticker=SPY, interval=1Min)
- Filter to RTH via env_cfg.session_mode="RTH"
- Build day episodes (skip short days)
- Compute z-fade baseline metrics on train and test slices
- Optionally train PPO (Stable-Baselines3) on train days and evaluate on test days

Outputs:
- Prints metrics for baseline and PPO (if available)
- Writes dataset artifact + meta.json for reproducibility
"""

import sys
import argparse
import sqlite3
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

# Ensure repo root is on sys.path when running as `python scripts/...py` on Windows.
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import database
from engine.rl.baselines import compute_zfade_baseline
from engine.rl.env import RLEnvConfig, TradingRLEnv
from engine.rl.export import serialize_dataset


def _load_spy_1m(*, start_iso: str | None, end_iso: str | None) -> pd.DataFrame:
    conn = sqlite3.connect(database.DB_NAME)
    try:
        cur = conn.cursor()
        q = """
        SELECT timestamp, price, open_price, high_price, low_price, volume
        FROM stock_data
        WHERE ticker = 'SPY'
          AND interval = '1Min'
        """
        params: List[str] = []
        if start_iso:
            q += " AND timestamp >= ?"
            params.append(start_iso)
        if end_iso:
            q += " AND timestamp <= ?"
            params.append(end_iso)
        q += " ORDER BY timestamp ASC"
        cur.execute(q, tuple(params))
        rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        raise RuntimeError("No SPY 1Min rows returned for the requested range.")

    ts = [r[0] for r in rows]
    close = [float(r[1]) for r in rows]
    open_ = [float(r[2] if r[2] is not None else r[1]) for r in rows]
    high = [float(r[3] if r[3] is not None else r[1]) for r in rows]
    low = [float(r[4] if r[4] is not None else r[1]) for r in rows]
    vol = [float(r[5] if r[5] is not None else 0.0) for r in rows]

    df = pd.DataFrame(
        {
            "ts": pd.to_datetime(ts, utc=True),
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": vol,
        }
    )
    return df


def _episode_day_bounds(env: TradingRLEnv) -> List[Tuple[int, int]]:
    # Internal lists are aligned; safe to use.
    return list(zip(env._day_starts, env._day_ends))  # noqa: SLF001 (script-level)


def _day_key(ts: pd.Timestamp) -> str:
    return ts.date().isoformat()


def _slice_by_days(df: pd.DataFrame, day_keys: List[str]) -> pd.DataFrame:
    # df.ts must be UTC datetime
    keys = df["ts"].dt.date.astype(str)
    mask = keys.isin(set(day_keys))
    return df.loc[mask].copy()


def _metrics_from_pos_reward(pos: np.ndarray, rew: np.ndarray) -> Dict[str, float]:
    pos = np.asarray(pos, dtype=np.float64)
    rew = np.asarray(rew, dtype=np.float64)
    turnover = float(np.sum(np.abs(np.diff(pos)) > 0))
    time_in_mkt = float(np.mean(np.abs(pos) > 0))
    total_reward = float(np.sum(rew))

    # crude equity curve + drawdown
    eq = np.cumsum(np.nan_to_num(rew, nan=0.0))
    peak = np.maximum.accumulate(eq) if eq.size else eq
    dd = (eq - peak) if eq.size else eq
    max_dd = float(np.min(dd)) if dd.size else 0.0
    return {
        "total_reward": total_reward,
        "turnover_changes": turnover,
        "time_in_market_frac": time_in_mkt,
        "max_drawdown_reward_units": max_dd,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--train_days", type=int, default=10)
    ap.add_argument("--test_days", type=int, default=3)
    ap.add_argument("--min_bars_per_episode", type=int, default=300)
    ap.add_argument("--seed", type=int, default=123)
    ap.add_argument("--timesteps", type=int, default=100_000)
    ap.add_argument("--out_dir", type=str, default="rl_runs/first_real_test")
    ap.add_argument("--start", type=str, default=None, help="Optional ISO start bound (UTC).")
    ap.add_argument("--end", type=str, default=None, help="Optional ISO end bound (UTC).")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    df_all = _load_spy_1m(start_iso=args.start, end_iso=args.end)

    env_cfg = RLEnvConfig(
        session_mode="RTH",
        min_bars_per_episode=int(args.min_bars_per_episode),
        cost_per_change=0.00005,
        breakout_penalty=0.0002,
        max_hold=60,
        return_reward_components=False,
        return_debug_series=False,
    )

    # Build env just to get available day keys and skip list.
    env_all = TradingRLEnv(df_bars=df_all, env_cfg=env_cfg)
    bounds = _episode_day_bounds(env_all)
    if not bounds:
        raise RuntimeError("No valid RTH day episodes found after filtering.")

    ts_idx = env_all.pipeline.df.index
    day_keys = []
    for s, _e in bounds:
        day_keys.append(_day_key(ts_idx[s]))

    # Take the most recent contiguous block for the test.
    need = int(args.train_days) + int(args.test_days)
    if len(day_keys) < need:
        raise RuntimeError(f"Not enough full RTH days available. Need {need}, have {len(day_keys)}.")

    selected = day_keys[-need:]
    train_keys = selected[: int(args.train_days)]
    test_keys = selected[int(args.train_days) :]

    df_train = _slice_by_days(df_all, train_keys)
    df_test = _slice_by_days(df_all, test_keys)

    # Export artifacts (train + test).
    train_data, train_meta = serialize_dataset(df_bars=df_train, out_path=str(out_dir / "train_dataset"), env_cfg=env_cfg)
    test_data, test_meta = serialize_dataset(df_bars=df_test, out_path=str(out_dir / "test_dataset"), env_cfg=env_cfg)
    print("Wrote:", train_data, train_meta)
    print("Wrote:", test_data, test_meta)
    print("Env cfg:", asdict(env_cfg))

    # Baseline metrics.
    a_tr, p_tr, r_tr = compute_zfade_baseline(df_bars=df_train, env_cfg=env_cfg)
    a_te, p_te, r_te = compute_zfade_baseline(df_bars=df_test, env_cfg=env_cfg)
    print("\nZ-FADE baseline (train):", _metrics_from_pos_reward(p_tr, r_tr))
    print("Z-FADE baseline (test): ", _metrics_from_pos_reward(p_te, r_te))

    # Optional PPO training.
    try:
        import gymnasium  # noqa: F401
        from stable_baselines3 import PPO  # noqa: F401
    except Exception:
        print("\nSB3/Gymnasium not installed -> skipping PPO training. (Baseline artifacts still produced.)")
        return 0

    from stable_baselines3 import PPO
    from engine.rl.gym_env import TradingGymEnv

    # Train env on train slice.
    env_train = TradingRLEnv(df_bars=df_train, env_cfg=env_cfg)
    gym_env = TradingGymEnv(env_train)

    model = PPO(
        "MlpPolicy",
        gym_env,
        verbose=1,
        seed=int(args.seed),
        n_steps=256,
        batch_size=256,
        gamma=0.999,
        learning_rate=3e-4,
    )
    model.learn(total_timesteps=int(args.timesteps))
    model.save(str(out_dir / "ppo_model.zip"))

    # Evaluate on test slice deterministically by replaying policy in env stepper.
    env_test = TradingRLEnv(
        df_bars=df_test,
        env_cfg=RLEnvConfig(**{**asdict(env_cfg), "return_reward_components": True, "return_debug_series": True}),
    )
    pos = np.zeros(env_test.pipeline.n, dtype=np.float64)
    rew = np.zeros(env_test.pipeline.n, dtype=np.float64)
    for day_i in range(env_test.n_days):
        obs = env_test.reset(day_index=day_i)
        done = False
        while not done:
            action, _state = model.predict(obs, deterministic=True)
            obs, r, done, info = env_test.step(int(action))
            pos[int(info["t"])] = float(info["pos"])
            rew[int(info["t"])] = float(r)
    print("\nPPO (test):", _metrics_from_pos_reward(pos, rew))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


