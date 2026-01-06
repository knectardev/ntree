from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import textwrap
import base64
from io import BytesIO
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.dates as mdates

# Optional dependencies for HTML report
try:
    import jinja2
    import markdown
except ImportError:
    jinja2 = None
    markdown = None

try:
    import pytz
except ImportError:
    pytz = None

# Ensure repo root is on sys.path
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import database
from engine.rl.baselines import z_fade_actions
from engine.rl.env import DiscreteActions, RLEnvConfig, TradingRLEnv
from engine.rl.feature_pipeline import FeaturePipeline

def _load_spy_1m_for_date(date_str: str) -> pd.DataFrame:
    """Load SPY 1m bars for a specific date (and some buffer for features)."""
    conn = sqlite3.connect(database.DB_NAME)
    try:
        cur = conn.cursor()
        q = """
        SELECT timestamp, price, open_price, high_price, low_price, volume
        FROM stock_data
        WHERE ticker = 'SPY'
          AND interval = '1Min'
          AND date(timestamp) = ?
        ORDER BY timestamp ASC
        """
        cur.execute(q, (date_str,))
        rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        raise RuntimeError(f"No SPY 1Min rows returned for date {date_str}.")

    ts = [r[0] for r in rows]
    close = [float(r[1]) for r in rows]
    open_ = [float(r[2] if r[2] is not None else r[1]) for r in rows]
    high = [float(r[3] if r[3] is not None else r[1]) for r in rows]
    low = [float(r[4] if r[4] is not None else r[1]) for r in rows]
    vol = [float(r[5] if r[5] is not None else 0.0) for r in rows]

    df = pd.DataFrame({
        "ts": pd.to_datetime(ts, utc=True),
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": vol,
    })
    return df

def _calculate_metrics(df: pd.DataFrame) -> Dict[str, Any]:
    """Calculate summary metrics including action counts and reward components."""
    pos = df["pos"].values
    rew = df["reward"].values
    breaks = df["breakout_flag"].values
    actions = df["action"].values
    
    in_market = (pos != 0)
    
    # Basic metrics
    total_reward = float(np.sum(rew))
    turnover = float(np.sum(np.abs(np.diff(pos)) > 0))
    time_in_market_frac = float(np.mean(in_market))
    
    # Breakout exposure: fraction of time in market during breakout
    breakout_exposure = float(np.sum(in_market & (breaks > 0.5))) / max(1, np.sum(in_market))
    
    # Average hold time
    is_pos = in_market.astype(int)
    pos_started = np.diff(np.insert(is_pos, 0, 0)) == 1
    pos_ended = np.diff(np.append(is_pos, 0)) == -1
    
    start_indices = np.where(pos_started)[0]
    end_indices = np.where(pos_ended)[0]
    
    hold_times = end_indices - start_indices + 1
    avg_hold_time = float(np.mean(hold_times)) if len(hold_times) > 0 else 0.0
    
    # Max drawdown
    eq = np.cumsum(np.nan_to_num(rew, nan=0.0))
    peak = np.maximum.accumulate(eq) if eq.size else eq
    dd = (eq - peak) if eq.size else eq
    max_dd = float(np.min(dd)) if dd.size else 0.0

    # Action counts
    action_counts = {
        "HOLD": int(np.sum(actions == DiscreteActions.HOLD)),
        "ENTER_LONG": int(np.sum(actions == DiscreteActions.ENTER_LONG)),
        "ENTER_SHORT": int(np.sum(actions == DiscreteActions.ENTER_SHORT)),
        "EXIT": int(np.sum(actions == DiscreteActions.EXIT))
    }

    # Reward components
    comp_pnl = float(df["pnl"].sum())
    comp_cost = float(df["cost"].sum())
    comp_break = float(df["breakout_penalty"].sum())
    
    return {
        "total_reward": total_reward,
        "pnl_raw": comp_pnl,
        "cost_total": comp_cost,
        "breakout_penalty_total": comp_break,
        "turnover_changes": turnover,
        "time_in_market_frac": time_in_market_frac,
        "max_drawdown_reward_units": max_dd,
        "breakout_exposure": breakout_exposure,
        "avg_hold_time": avg_hold_time,
        "n_trades": len(hold_times),
        "action_counts": action_counts
    }

def run_policy(env: TradingRLEnv, policy_fn) -> pd.DataFrame:
    """Run a policy through the environment and return step-by-step results."""
    obs = env.reset(day_index=0)
    steps = []
    done = False
    closes = env.pipeline.df["close"].values
    
    while not done:
        t_current = env.t
        action = policy_fn(obs, t_current)
        obs_next, reward, done, info = env.step(action)
        
        step_data = {
            "ts": env.pipeline.df.index[info["t"]],
            "day": env.pipeline.df.index[info["t"]].date().isoformat(),
            "close": float(closes[info["t"]]),
            "action": action,
            "pos": info["pos"],
            "reward": reward,
            "pnl": info.get("reward_components", {}).get("pnl", 0.0),
            "cost": info.get("reward_components", {}).get("cost", 0.0),
            "breakout_penalty": info.get("reward_components", {}).get("breakout_penalty", 0.0),
            "breakout_flag": info.get("breakout_flag", 0.0),
            "mr_z": info.get("mr_z", np.nan),
            "sigma": info.get("sigma", np.nan),
        }
        steps.append(step_data)
        obs = obs_next
        
    return pd.DataFrame(steps)

def _plot_position_track(ax, ts_display, df, title):
    """Helper to plot a position track with colored ribbons and action markers."""
    pos = df["pos"].values
    
    # Position ribbons
    for i in range(len(df) - 1):
        p = pos[i]
        color = 'white'
        if p > 0: color = 'green'
        elif p < 0: color = 'red'
        
        if color != 'white':
            ax.axvspan(ts_display[i], ts_display[i+1], color=color, alpha=0.25)
    
    # Action markers mapping
    marker_map = {
        'ENTER_LONG': ('^', 'darkgreen', '▲ Long'),
        'ENTER_SHORT': ('v', 'darkred', '▼ Short'),
        'EXIT': ('x', 'black', '× Exit')
    }
    
    marked_handles = {}
    for i in range(len(df)):
        curr_p = pos[i]
        prev_p = pos[i-1] if i > 0 else 0
        if curr_p != prev_p:
            marker_key = None
            if curr_p > 0: marker_key = 'ENTER_LONG'
            elif curr_p < 0: marker_key = 'ENTER_SHORT'
            elif curr_p == 0: marker_key = 'EXIT'
            
            if marker_key:
                m, c, label = marker_map[marker_key]
                h = ax.scatter(ts_display[i], 0, marker=m, color=c, s=60, zorder=5, label=label)
                if label not in marked_handles:
                    marked_handles[label] = h

    ax.set_ylim(-1.5, 1.5)
    ax.set_yticks([-1, 0, 1])
    ax.set_yticklabels(['Short', 'Flat', 'Long'])
    ax.set_title(title)
    ax.grid(True, alpha=0.3)
    
    if marked_handles:
        sorted_labels = sorted(marked_handles.keys())
        ax.legend([marked_handles[l] for l in sorted_labels], sorted_labels, 
                  loc='upper right', fontsize='xx-small', framealpha=0.6)

def _get_db_data_range(ticker: str, interval: str) -> Tuple[str, str]:
    """Fetch the overall min/max timestamps for this ticker/interval from DB."""
    conn = sqlite3.connect(database.DB_NAME)
    try:
        cur = conn.cursor()
        cur.execute("SELECT MIN(timestamp), MAX(timestamp) FROM stock_data WHERE ticker=? AND interval=?", (ticker, interval))
        row = cur.fetchone()
        if row and row[0] and row[1]:
            start = pd.to_datetime(row[0]).strftime("%Y-%m-%d")
            end = pd.to_datetime(row[1]).strftime("%Y-%m-%d")
            return start, end
    except Exception:
        pass
    finally:
        conn.close()
    return "Unknown", "Unknown"

def render_plot(df_base: pd.DataFrame, df_ppo: pd.DataFrame | None, date_str: str, 
                out_path: str):
    """Render a clean 4-track plot without captions (for HTML embedding)."""
    ts_raw = df_base["ts"]
    if pytz is not None:
        tz_et = pytz.timezone("US/Eastern")
        ts_display = [t.astimezone(tz_et) for t in ts_raw]
        tz_label = " (ET)"
    else:
        ts_display = ts_raw
        tz_label = " (UTC)"

    fig, axes = plt.subplots(4, 1, figsize=(12, 10), sharex=True, 
                             gridspec_kw={'height_ratios': [2, 0.4, 1.2, 1.2]})
    ax_ctx, ax_break, ax_base, ax_ppo = axes
    
    ax_ctx.set_title(f"Behavior Timeline: SPY 1m RTH ({date_str}){tz_label}")
    ax_ctx.plot(ts_display, df_base["mr_z"], color='blue', alpha=0.6, label='mr_z')
    ax_ctx.axhline(0, color='black', linestyle='--', alpha=0.3)
    ax_ctx.axhline(2.0, color='red', linestyle=':', alpha=0.3)
    ax_ctx.axhline(-2.0, color='green', linestyle=':', alpha=0.3)
    ax_ctx.set_ylabel("Z-score")
    ax_ctx.legend(loc='upper left', fontsize='small')
    ax_ctx.grid(True, alpha=0.2)
    
    for i in range(len(df_base) - 1):
        if df_base["breakout_flag"].iloc[i] > 0.5:
            ax_break.axvspan(ts_display[i], ts_display[i+1], color='orange', alpha=0.6)
    ax_break.set_yticks([])
    ax_break.set_ylabel("Breakout", rotation=0, labelpad=30, va='center')
    ax_break.set_ylim(0, 1)

    _plot_position_track(ax_base, ts_display, df_base, "Baseline (Z-FADE)")
    
    if df_ppo is not None:
        _plot_position_track(ax_ppo, ts_display, df_ppo, "Learned Policy (PPO)")
    else:
        ax_ppo.set_title("Learned Policy (PPO)")
        ax_ppo.text(0.5, 0.5, "(no model provided)", ha='center', va='center', 
                    transform=ax_ppo.transAxes, color='gray', alpha=0.5, fontsize=14)
        ax_ppo.set_ylim(-1.5, 1.5)
        ax_ppo.set_yticks([-1, 0, 1])
        ax_ppo.set_yticklabels(['Short', 'Flat', 'Long'])

    ax_ppo.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M'))
    
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches='tight')
    plt.close()

def render_html_report(df_base: pd.DataFrame, df_ppo: pd.DataFrame | None, date_str: str, 
                       meta_base: Dict[str, Any], meta_ppo: Dict[str, Any] | None,
                       data_context: Dict[str, Any], annotation_md: str | None, 
                       plot_png_path: Path, out_path: Path):
    """Generate a standalone HTML report."""
    if jinja2 is None or markdown is None:
        print("Warning: jinja2 or markdown not installed. Skipping HTML report generation.")
        return

    with open(plot_png_path, "rb") as f:
        img_base64 = base64.b64encode(f.read()).decode('utf-8')
    
    anno_html = ""
    if annotation_md:
        anno_html = markdown.markdown(annotation_md, extensions=['fenced_code', 'tables'])

    template_str = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Behavior Timeline - {{ date_str }}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f7f9; }
        .card { background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); padding: 25px; margin-bottom: 30px; }
        h1 { color: #1a2a3a; border-bottom: 2px solid #eee; padding-bottom: 10px; margin-top: 0; }
        h2 { color: #2c3e50; margin-top: 0; font-size: 1.4em; }
        .metadata-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 10px; }
        .meta-item { border-left: 4px solid #3498db; padding-left: 15px; }
        .meta-label { font-weight: bold; font-size: 0.8em; color: #7f8c8d; text-transform: uppercase; display: block; }
        .meta-value { font-family: monospace; font-size: 1.1em; color: #2c3e50; }
        .metrics-container { display: flex; gap: 30px; flex-wrap: wrap; margin-bottom: 20px; }
        .policy-metrics { flex: 1; min-width: 300px; padding: 15px; border-radius: 6px; }
        .policy-metrics.baseline { background: #f0f4f8; border-top: 4px solid #95a5a6; }
        .policy-metrics.ppo { background: #e8f4fd; border-top: 4px solid #3498db; }
        .metric-row { display: flex; justify-content: space-between; margin-bottom: 5px; border-bottom: 1px dashed #ddd; }
        .metric-name { color: #555; font-size: 0.9em; }
        .metric-val { font-weight: bold; font-family: monospace; }
        .action-counts { display: flex; gap: 10px; margin-top: 10px; font-size: 0.85em; }
        .action-pill { padding: 2px 8px; border-radius: 12px; background: white; border: 1px solid #ccc; }
        .plot-container { text-align: center; }
        .plot-container img { max-width: 100%; height: auto; border: 1px solid #ddd; }
        .annotation-content { font-size: 1.05em; }
        .annotation-content h1, .annotation-content h2, .annotation-content h3 { border-bottom: none; }
        .annotation-content code { background: #f0f0f0; padding: 2px 4px; border-radius: 4px; font-size: 0.9em; }
        .annotation-content pre { background: #2d3436; color: #dfe6e9; padding: 15px; border-radius: 6px; overflow-x: auto; }
    </style>
</head>
<body>
    <h1>Behavior Timeline: SPY 1m RTH</h1>
    <div class="card">
        <h2>Data Context & Metadata</h2>
        <div class="metadata-grid">
            <div class="meta-item"><span class="meta-label">Date</span><span class="meta-value">{{ date_str }}</span></div>
            <div class="meta-item"><span class="meta-label">Data Source</span><span class="meta-value">{{ data_context.source }}</span></div>
            <div class="meta-item"><span class="meta-label">DB Range</span><span class="meta-value">{{ data_context.db_start }} to {{ data_context.db_end }}</span></div>
            <div class="meta-item"><span class="meta-label">Costs / Penalty</span><span class="meta-value">{{ data_context.cost_bp|round(1) }} bp | {{ data_context.breakout_bp|round(1) }} bp</span></div>
        </div>
    </div>
    <div class="card plot-container">
        <h2>Visualization</h2>
        <img src="data:image/png;base64,{{ img_base64 }}" alt="Behavior Timeline Plot">
    </div>
    <div class="card">
        <h2>Policy Performance</h2>
        <div class="metrics-container">
            <div class="policy-metrics baseline">
                <h3 style="margin-top:0">Baseline (Z-FADE)</h3>
                <div class="metric-row"><span class="metric-name">Total Reward</span><span class="metric-val">{{ meta_base.total_reward|round(4) }}</span></div>
                <div class="metric-row"><span class="metric-name">PnL / Cost / Penalty</span><span class="metric-val">{{ meta_base.pnl_raw|round(4) }} / {{ meta_base.cost_total|round(4) }} / {{ meta_base.breakout_penalty_total|round(4) }}</span></div>
                <div class="metric-row"><span class="metric-name">Avg Hold Time</span><span class="metric-val">{{ meta_base.avg_hold_time|round(1) }}m</span></div>
                <div class="metric-row"><span class="metric-name">Turnover Changes</span><span class="metric-val">{{ meta_base.turnover_changes }}</span></div>
                <div class="metric-row"><span class="metric-name">Breakout Exposure</span><span class="metric-val">{{ (meta_base.breakout_exposure*100)|round(2) }}%</span></div>
                <div class="action-counts">
                    <span class="action-pill">HOLD: {{ meta_base.action_counts.HOLD }}</span>
                    <span class="action-pill">LONG: {{ meta_base.action_counts.ENTER_LONG }}</span>
                    <span class="action-pill">SHORT: {{ meta_base.action_counts.ENTER_SHORT }}</span>
                    <span class="action-pill">EXIT: {{ meta_base.action_counts.EXIT }}</span>
                </div>
            </div>
            {% if meta_ppo %}
            <div class="policy-metrics ppo">
                <h3 style="margin-top:0">Learned Policy (PPO)</h3>
                <div class="metric-row"><span class="metric-name">Total Reward</span><span class="metric-val">{{ meta_ppo.total_reward|round(4) }}</span></div>
                <div class="metric-row"><span class="metric-name">PnL / Cost / Penalty</span><span class="metric-val">{{ meta_ppo.pnl_raw|round(4) }} / {{ meta_ppo.cost_total|round(4) }} / {{ meta_ppo.breakout_penalty_total|round(4) }}</span></div>
                <div class="metric-row"><span class="metric-name">Avg Hold Time</span><span class="metric-val">{{ meta_ppo.avg_hold_time|round(1) }}m</span></div>
                <div class="metric-row"><span class="metric-name">Turnover Changes</span><span class="metric-val">{{ meta_ppo.turnover_changes }}</span></div>
                <div class="metric-row"><span class="metric-name">Breakout Exposure</span><span class="metric-val">{{ (meta_ppo.breakout_exposure*100)|round(2) }}%</span></div>
                <div class="action-counts">
                    <span class="action-pill">HOLD: {{ meta_ppo.action_counts.HOLD }}</span>
                    <span class="action-pill">LONG: {{ meta_ppo.action_counts.ENTER_LONG }}</span>
                    <span class="action-pill">SHORT: {{ meta_ppo.action_counts.ENTER_SHORT }}</span>
                    <span class="action-pill">EXIT: {{ meta_ppo.action_counts.EXIT }}</span>
                </div>
            </div>
            {% else %}
            <div class="policy-metrics" style="background:#eee; display:flex; align-items:center; justify-content:center;">
                <span style="color:#777">PPO Model Not Provided</span>
            </div>
            {% endif %}
        </div>
    </div>
    {% if anno_html %}
    <div class="card">
        <h2>Interpretation</h2>
        <div class="annotation-content">{{ anno_html }}</div>
    </div>
    {% endif %}
    <div style="text-align: center; color: #7f8c8d; font-size: 0.8em; margin-top: 40px; margin-bottom: 20px;">
        Generated by Behavior Timeline Tool &bull; {{ now }}
    </div>
</body>
</html>
    """
    
    env = jinja2.Environment()
    template = env.from_string(template_str)
    html_out = template.render(
        date_str=date_str,
        data_context=data_context,
        meta_base=meta_base,
        meta_ppo=meta_ppo,
        img_base64=img_base64,
        anno_html=anno_html,
        now=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    )
    
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html_out)

def _find_windows(mask: np.ndarray, ts: pd.Series) -> List[Dict[str, Any]]:
    if not mask.any(): return []
    is_bool = mask.astype(bool)
    diff = np.diff(np.insert(is_bool.astype(int), 0, 0))
    starts = np.where(diff == 1)[0]
    ends = np.where(diff == -1)[0]
    if len(ends) < len(starts): ends = np.append(ends, len(is_bool))
    windows = []
    for s, e in zip(starts, ends):
        windows.append({
            "start": ts.iloc[s].strftime("%H:%M"),
            "end": ts.iloc[min(e, len(ts)-1)].strftime("%H:%M"),
            "duration_min": int(e - s)
        })
    return windows

def _get_drawdown_window(rewards: np.ndarray, ts: pd.Series) -> Dict[str, Any]:
    eq = np.cumsum(np.nan_to_num(rewards, nan=0.0))
    if len(eq) == 0: return {}
    pk, max_dd, ds, de = 0, 0, 0, 0
    for i in range(len(eq)):
        if eq[i] > eq[pk]: pk = i
        dd = eq[i] - eq[pk]
        if dd < max_dd: max_dd, ds, de = dd, pk, i
    if max_dd >= 0: return {}
    return {"start": ts.iloc[ds].strftime("%H:%M"), "end": ts.iloc[de].strftime("%H:%M"), "max_dd": float(max_dd)}

def _get_pnl_gain_window(rewards: np.ndarray, ts: pd.Series) -> Dict[str, Any]:
    eq = np.cumsum(np.nan_to_num(rewards, nan=0.0))
    if len(eq) == 0: return {}
    tr, max_gain, gs, ge = 0, 0, 0, 0
    for i in range(len(eq)):
        if eq[i] < eq[tr]: tr = i
        gain = eq[i] - eq[tr]
        if gain > max_gain: max_gain, gs, ge = gain, tr, i
    if max_gain <= 0: return {}
    return {"start": ts.iloc[gs].strftime("%H:%M"), "end": ts.iloc[ge].strftime("%H:%M"), "max_gain": float(max_gain)}

def generate_digest(df_combined: pd.DataFrame, meta_base: Dict[str, Any], meta_ppo: Dict[str, Any] | None, 
                   args: argparse.Namespace) -> Dict[str, Any]:
    ts = df_combined["ts"]
    if pytz is not None:
        tz_et = pytz.timezone("US/Eastern")
        ts_et = ts.dt.tz_convert(tz_et)
    else: ts_et = ts

    digest = {
        "identifiers": {"symbol": "SPY", "bar_size": "1m", "session_mode": args.session_mode, "date": args.date, "timezone": "US/Eastern" if pytz else "UTC"},
        "schema_id": "schema_v1", "model_id": Path(args.ppo_model_path).name if args.ppo_model_path else "none", "baseline_metrics": meta_base,
    }
    if meta_ppo: digest["ppo_metrics"] = meta_ppo

    ev = {}
    brk_mask = (df_combined["pos_baseline"] != 0) & (df_combined["breakout_flag"] > 0.5)
    ev["breakout_exposure_windows_baseline"] = sorted(_find_windows(brk_mask.values, ts_et), key=lambda x: x["duration_min"], reverse=True)[:3]
    if meta_ppo:
        brk_mask_ppo = (df_combined["pos_ppo"] != 0) & (df_combined["breakout_flag"] > 0.5)
        ev["breakout_exposure_windows_ppo"] = sorted(_find_windows(brk_mask_ppo.values, ts_et), key=lambda x: x["duration_min"], reverse=True)[:3]
        ev["notable_divergence_windows"] = sorted(_find_windows((df_combined["pos_baseline"] != df_combined["pos_ppo"]).values, ts_et), key=lambda x: x["duration_min"], reverse=True)[:3]

    ev["largest_drawdown_window_baseline"] = _get_drawdown_window(df_combined["reward_baseline"].values, ts_et)
    ev["largest_pnl_gain_window_baseline"] = _get_pnl_gain_window(df_combined["reward_baseline"].values, ts_et)
    if meta_ppo:
        ev["largest_drawdown_window_ppo"] = _get_drawdown_window(df_combined["reward_ppo"].values, ts_et)
        ev["largest_pnl_gain_window_ppo"] = _get_pnl_gain_window(df_combined["reward_ppo"].values, ts_et)

    turn_base = np.abs(np.diff(df_combined["pos_baseline"].values, prepend=0)) > 0
    ev["top_trade_clusters_baseline"] = sorted(_find_windows((pd.Series(turn_base).rolling(window=20).sum() >= 2).values, ts_et), key=lambda x: x["duration_min"], reverse=True)[:3]
    digest["events"] = ev
    return digest

def generate_offline_annotation(digest: Dict[str, Any], tone: str) -> str:
    id, mb, mp, ev = digest["identifiers"], digest["baseline_metrics"], digest.get("ppo_metrics"), digest["events"]
    md = f"# Behavior Timeline Interpretation — {id['symbol']} {id['bar_size']} {id['session_mode']} ({id['date']})\n\n"
    md += "## Data Context & Metadata\n"
    md += f"- **Symbol**: {id['symbol']} | **Interval**: {id['bar_size']}\n"
    md += f"- **Data Source**: SQLite (stock_data) | **Timezone**: {id['timezone']}\n"
    md += f"- **Historical DB Span**: {id.get('db_start', 'Unknown')} to {id.get('db_end', 'Unknown')}\n"
    md += f"- **Execution Costs**: {mb.get('cost_bp', 0.5):.1f} bp / change\n"
    md += f"- **Breakout Penalty**: {mb.get('breakout_bp', 2.0):.1f} bp\n\n"
    md += "## Summary\n"
    if mp:
        verb = "outperformed" if mp['total_reward'] > mb['total_reward'] else "underperformed"
        md += f"- PPO {verb} baseline by {abs(mp['total_reward'] - mb['total_reward']):.4f}.\n- Breakout exposure: {mp['breakout_exposure']:.2%} vs {mb['breakout_exposure']:.2%}.\n- Hold time: {mp['avg_hold_time']:.1f}m vs {mb['avg_hold_time']:.1f}m.\n"
    else: md += f"- Baseline reward: {mb['total_reward']:.4f}.\n- Market exposure: {mb['time_in_market_frac']:.2%}, breakout exposure: {mb['breakout_exposure']:.2%}.\n"
    md += f"\n## What the baseline did\n- {mb['action_counts']['ENTER_LONG'] + mb['action_counts']['ENTER_SHORT']} entries, {mb['turnover_changes']} changes.\n- Session exposure: {mb['time_in_market_frac']:.2%}.\n"
    if mp:
        md += f"\n## What the learned policy did differently\n- {mp['action_counts']['ENTER_LONG'] + mp['action_counts']['ENTER_SHORT']} entries (vs {mb['action_counts']['ENTER_LONG'] + mb['action_counts']['ENTER_SHORT']}).\n"
        if ev.get("notable_divergence_windows"): md += f"- Key divergence at {ev['notable_divergence_windows'][0]['start']} ({ev['notable_divergence_windows'][0]['duration_min']}m).\n"
    md += "\n## Notable moments (callouts)\n"
    co = []
    if ev.get("largest_drawdown_window_baseline"): co.append(f"- {ev['largest_drawdown_window_baseline']['start']}–{ev['largest_drawdown_window_baseline']['end']} ET: Baseline max drawdown ({ev['largest_drawdown_window_baseline']['max_dd']:.4f}).")
    if ev.get("breakout_exposure_windows_baseline"): co.append(f"- {ev['breakout_exposure_windows_baseline'][0]['start']}–{ev['breakout_exposure_windows_baseline'][0]['end']} ET: Baseline breakout exposure.")
    if mp and ev.get("notable_divergence_windows"): co.append(f"- {ev['notable_divergence_windows'][0]['start']}–{ev['notable_divergence_windows'][0]['end']} ET: Policy divergence.")
    md += "\n".join(co[:3]) + "\n\n## One lever to try next\n"
    if mp:
        if mp['cost_total'] > abs(mp['total_reward']) * 0.5: md += "Reduce costs by increasing turnover penalty.\n"
        elif mp['breakout_exposure'] > 0.3: md += "Increase breakout penalty.\n"
        else: md += "Try increasing max_hold.\n"
    else: md += "Optimize z-score thresholds.\n"
    return md

def call_llm_annotation(digest: Dict[str, Any], args: argparse.Namespace) -> Tuple[str, Dict[str, Any]]:
    if args.llm_offline: return generate_offline_annotation(digest, args.annotation_tone), {"mode": "offline"}
    return generate_offline_annotation(digest, args.annotation_tone), {"mode": "fallback_no_api_impl"}

def main():
    print(f"--- Running behavior timeline script ---")
    print(f"Location: {Path(__file__).resolve()}")
    
    parser = argparse.ArgumentParser(description="Render Behavior Timeline.")
    parser.add_argument("--date", type=str, required=True)
    parser.add_argument("--ppo_model_path", type=str)
    parser.add_argument("--out_dir", type=str, default="rl_runs/timelines")
    parser.add_argument("--session_mode", type=str, default="RTH")
    parser.add_argument("--min_bars_per_episode", type=int, default=300)
    parser.add_argument("--llm_annotate", action="store_true")
    parser.add_argument("--llm_offline", action="store_true")
    parser.add_argument("--annotation_tone", type=str, default="plain")
    parser.add_argument("--seed", type=int, default=123)
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    df_bars = _load_spy_1m_for_date(args.date)
    
    env_cfg = RLEnvConfig(
        session_mode=args.session_mode, 
        min_bars_per_episode=args.min_bars_per_episode, 
        return_reward_components=True, 
        return_debug_series=True
    )
    env = TradingRLEnv(df_bars=df_bars, env_cfg=env_cfg)
    if env.n_days == 0: return 1

    base_actions = z_fade_actions(mr_z=env.pipeline._series["mr_z"])
    df_base = run_policy(env, lambda obs, t: base_actions[t])
    meta_base = _calculate_metrics(df_base)

    df_ppo, meta_ppo = None, None
    if args.ppo_model_path:
        from stable_baselines3 import PPO
        model = PPO.load(args.ppo_model_path)
        df_ppo = run_policy(env, lambda obs, t: int(model.predict(obs, deterministic=True)[0]))
        meta_ppo = _calculate_metrics(df_ppo)

    db_start, db_end = _get_db_data_range("SPY", "1Min")
    data_context = {
        "source": "SQLite Local (stock_data)",
        "db_start": db_start,
        "db_end": db_end,
        "cost_bp": env_cfg.cost_per_change * 10000,
        "breakout_bp": env_cfg.breakout_penalty * 10000
    }

    base_fn = f"spy_1m_{args.session_mode.lower()}_{args.date}"
    df_combined = df_base.rename(columns={"action":"action_baseline","pos":"pos_baseline","reward":"reward_baseline","pnl":"pnl_base","cost":"cost_base","breakout_penalty":"brk_base"})
    if df_ppo is not None:
        for c in ["action","pos","reward","pnl","cost","breakout_penalty"]: df_combined[f"{c}_ppo"] = df_ppo[c].values
    
    pq_path = out_dir / f"{base_fn}.timeline.parquet"
    try:
        df_combined.to_parquet(pq_path, index=False)
    except Exception as e:
        print(f"Warning: Could not save Parquet ({e}). Saving CSV instead.")
        df_combined.to_csv(out_dir / f"{base_fn}.timeline.csv", index=False)

    with open(out_dir / f"{base_fn}.summary.json", "w") as f: json.dump({"date": args.date, "baseline": meta_base, "ppo": meta_ppo or {}, "data_context": data_context}, f, indent=2)
    
    plot_path = out_dir / f"{base_fn}.timeline.png"
    render_plot(df_base, df_ppo, args.date, str(plot_path))

    md_content = None
    if args.llm_annotate:
        digest = generate_digest(df_combined.rename(columns={"pnl_base":"pnl","cost_base":"cost","brk_base":"breakout_penalty"}), meta_base, meta_ppo, args)
        digest["identifiers"].update({"db_start": db_start, "db_end": db_end})
        with open(out_dir / f"{base_fn}.digest.json", "w") as f: json.dump(digest, f, indent=2)
        
        md_content, l_meta = call_llm_annotation(digest, args)
        with open(out_dir / f"{base_fn}.annotation.md", "w") as f: f.write(md_content)
        with open(out_dir / f"{base_fn}.annotation.json", "w") as f: json.dump({"digest": digest, "llm_meta": l_meta, "annotation_md": md_content}, f, indent=2)
        print(f"Annotation: {out_dir / f'{base_fn}.annotation.md'}")

    html_path = out_dir / f"{base_fn}.timeline.html"
    render_html_report(df_base, df_ppo, args.date, meta_base, meta_ppo, data_context, md_content, plot_path, html_path)

    print(f"Artifacts in: {out_dir}")
    print(f"HTML Report: {html_path}")
    return 0

if __name__ == "__main__": sys.exit(main())
