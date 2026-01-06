from __future__ import annotations

"""
Minimal RL training scaffold (optional Stable-Baselines3 dependency).

Behavior:
- If SB3 + Gymnasium are available: run a short PPO training loop and print basic metrics.
- If not available: print a clear message and exit successfully.

This script is intentionally conservative and is meant as a sanity-check runner,
not a full research harness.
"""

import sys
from dataclasses import asdict
from pathlib import Path

import pandas as pd

# Ensure repo root is on sys.path when running as `python scripts/...py` on Windows.
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from engine.rl.env import DiscreteActions, RLEnvConfig, TradingRLEnv
from engine.rl.export import serialize_dataset


def main(argv: list[str]) -> int:
    try:
        import gymnasium  # noqa: F401
        from stable_baselines3 import PPO  # noqa: F401
    except Exception:
        print("Stable-Baselines3 and/or Gymnasium not installed. Training skipped.")
        print("You can still export datasets via engine.rl.export.serialize_dataset().")
        return 0

    if len(argv) < 2:
        print("Usage: python scripts/train_rl.py <csv_or_parquet_bars_file> [out_dir]")
        return 2

    bars_path = Path(argv[1])
    out_dir = Path(argv[2]) if len(argv) >= 3 else Path("rl_runs")
    out_dir.mkdir(parents=True, exist_ok=True)

    if not bars_path.exists():
        print(f"Bars file not found: {bars_path}")
        return 2

    if bars_path.suffix.lower() == ".parquet":
        df = pd.read_parquet(bars_path)
    else:
        df = pd.read_csv(bars_path)

    env_cfg = RLEnvConfig(
        session_mode="RTH",
        min_bars_per_episode=300,
        cost_per_change=0.00005,
        breakout_penalty=0.0002,
        max_hold=60,
        return_reward_components=False,
        return_debug_series=False,
    )

    # Export dataset artifact (documentable input).
    data_path, meta_path = serialize_dataset(df_bars=df, out_path=str(out_dir / "dataset"), env_cfg=env_cfg)
    print(f"Wrote dataset: {data_path}")
    print(f"Wrote metadata: {meta_path}")
    print(f"Env cfg: {asdict(env_cfg)}")

    # Build env for training.
    tre = TradingRLEnv(df_bars=df, env_cfg=env_cfg)
    if tre.n_days <= 0:
        print("No valid episodes after filtering. Nothing to train.")
        return 0

    from stable_baselines3 import PPO
    from engine.rl.gym_env import TradingGymEnv

    gym_env = TradingGymEnv(tre)

    model = PPO(
        "MlpPolicy",
        gym_env,
        verbose=1,
        n_steps=256,
        batch_size=256,
        gamma=0.999,
        learning_rate=3e-4,
    )

    model.learn(total_timesteps=50_000)
    model_path = out_dir / "ppo_model.zip"
    model.save(str(model_path))
    print(f"Saved model: {model_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))


