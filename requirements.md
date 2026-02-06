# ntree — Requirements & Technical Specification

This document describes the **current** functionality and technical specifications implemented in this repo (Flask app, SQLite schema, APIs, UI pages, strategy/backtest semantics, and dependencies).

---

## Overview

`ntree` is a **local Flask web app** for:

- Viewing **real market OHLCV bars** ingested from **Alpaca** into SQLite (`stock_data.db`)
- Viewing **synthetic OHLCV + L2-derived features** stored in SQLite (`bars` + `l2_state`)
- Rendering interactive charts via **Chart.js (candlestick)** and an embedded **bandchart-style** demo page (`chart.html`), including **Audio Visual Settings** (Tone.js sonification tied to replay) and a **Session History** modal for practice/replay sessions
- Running strategy backtests via a small **engine** with explicit fill/stop/TP assumptions

### What this repo is *not*

- Not a streaming “tick-by-tick” platform: real market data is ingested via **historical bars** and updated via a manual “Fetch Latest Data” action (`/api/fetch-latest`).
- Not a Databento/FastAPI service: `bandchart.md` is a **design/notes** document; the running server here is **Flask** (`app.py`).

---

## Runtime & Technology

- **Python**: **3.10+** (uses PEP-604 unions like `sqlite3.Connection | None`)
- **Web server**: Flask dev server (`python app.py`)
- **Database**: SQLite (`stock_data.db`; path can be overridden via `NTREE_DB_PATH`)
- **Frontend**: server-rendered HTML templates + CDN JS (Chart.js + financial/zoom plugins)

---

## Data Storage (SQLite)

Database is initialized on app startup (`init_database()` in `database.py`).

### 1) Legacy real bars table: `stock_data`

Used by:
- Dashboard “Real Symbols”
- `/api/ticker/<ticker>/<interval>`
- `/window` (uses `interval='1Min'` as the base, then aggregates)
- Alpaca ingestion scripts (`ingest_data.py`, `/api/fetch-latest`)

Key columns:
- `ticker` (TEXT)
- `timestamp` (TEXT, ISO string)
- `interval` (TEXT, e.g. `1Min`, `5Min`)
- OHLCV: `price` (close), `open_price`, `high_price`, `low_price`, `volume`

Constraints:
- `UNIQUE(ticker, timestamp, interval)`
- Indexed by `(ticker, interval, timestamp)`

### 2) Backtest persistence

#### `backtest_configs`
Stores reusable parameter presets:
- `name`
- `risk_percent`
- `reward_multiple`
- `fee_bp`

#### `backtests`
Stores named backtests and (optionally) saved metrics:
- `name`, `strategy`, `ticker`, `interval`
- `risk_percent`, `reward_multiple`, `fee_bp`
- `metrics_json` (JSON string)

### 3) Canonical bars table: `bars` (real + synthetic)

Used by synthetic flows today (and intended as the long-term canonical store):
- `bars` (base rows)
- `l2_state` (L2-derived features keyed by bar)
- views: `bars_synth`, `bars_real`, `l2_state_synth`, `l2_state_real`

Key columns:
- `symbol`, `timeframe` (`1m`, `5m`, `15m`, …)
- `ts_start` (ISO string, bar open timestamp)
- `duration_sec` (e.g. 60)
- OHLCV: `open`, `high`, `low`, `close`, `volume`
- Optional/extra: `trades`, `vwap`
- `data_source` (e.g. `synthetic`, `alpaca_hist`, `alpaca_live`)
- `scenario` (nullable; used for synthetic)

Uniqueness:
- unique index on `(symbol, timeframe, ts_start, data_source, scenario)`

### 4) L2 feature table: `l2_state`

Keyed by `bar_id` (FK to `bars.id`, cascade delete).

Fields include:
- `dbi` (depth imbalance)
- `ofi` (order flow imbalance)
- `spr` (spread)
- `microprice`
- plus additional research fields (`bbs`, `bas`, `sigma_spr`, `frag`, `d_micro`, `tss`)

---

## Data Ingestion & Updates

### Alpaca (real data)

There are two ways real data enters `stock_data`:

- **Initial backfill**: `python ingest_data.py`
  - Fetches last ~5 days of 1Min/5Min bars for `SPY` and `QQQ`
  - Inserts OHLCV into `stock_data`
  - Uses the Alpaca IEX feed (`feed='iex'`)
  - Sleeps `0.5s` between requests (rate limiting)

- **Incremental update (and optional backfill) via UI**: `POST /api/fetch-latest`
  - Default (no payload): finds the max timestamp in `stock_data`, then fetches bars from `last+1min` to now
  - Optional payload allows adding/backfilling a symbol over a date range (used by the dashboard “Add + Fetch Range” form)
  - Uses `list_all_tickers()` if the DB already contains symbols; otherwise defaults to `['SPY','QQQ']`
  - Inserts OHLCV into `stock_data` (upsert via `INSERT OR REPLACE`)

**Credential handling (current implementation)**:
- `ingest_data.py` and `app.py` currently contain **hard-coded Alpaca credentials**.
- `python-dotenv` exists in `requirements.txt` and `test_env.py` can load `.env`, but the main Flask app does **not** currently call `load_dotenv()` automatically.

### Synthetic data generation

Synthetic datasets in this repo are primarily **generated in Python** and then **persisted into SQLite** (canonical tables: `bars` + `l2_state`).

The Flask app is **read-only by default** for synthetic data, but it also includes an **opt-in** endpoint (**`POST /api/synthetic_generate`**) that can generate and persist a synthetic dataset into the DB when explicitly called.

#### What “synthetic” means in the DB

- Base OHLCV bars are inserted into `bars` with:
  - `data_source = 'synthetic'`
  - `scenario = <scenario_name>` (non-null)
  - `symbol`, `timeframe`, `ts_start`, `duration_sec`, OHLCV, `trades`, `vwap`
- L2-derived features are inserted into `l2_state` and are keyed by `bar_id` (FK to `bars.id`).
- Convenience views separate real vs synthetic:
  - `bars_synth` = `SELECT * FROM bars WHERE data_source='synthetic'`
  - `l2_state_synth` = `l2_state` joined to synthetic `bars`

#### Generator code (Python)

- **Package**: `synthetic_generators/`
- **Registry**: `synthetic_generators.__init__.py` exposes `GENERATOR_REGISTRY` + `get_generator()`
- **Generators (current)**:
  - `synthetic_generators/trend_regime_v1.py`: `generate_trend_regime_series(...)`
  - `synthetic_generators/trend_regime_v2.py`: `generate_trend_regime_series_v2(...)` (**default for `POST /api/synthetic_generate`**)
    - Emits **RTH-only** bars in `America/New_York`, includes **overnight gaps**, and includes **diurnal** volume/vol/spread shaping
  - `synthetic_generators/trend_regime_v3.py`: `generate_trend_regime_series_v3(...)` (experimental)

All generators produce two aligned lists: `List[SyntheticBar]` and `List[SyntheticL2]`.
Timestamps are persisted as UTC ISO strings (via `.isoformat()`).

#### Persistence helper (Python → SQLite)

- `synthetic_generators/base.py`:
  - Data models: `SyntheticBar`, `SyntheticL2`
  - Writer: `write_synthetic_series_to_db(bars, l2_states, conn=None)`
    - Inserts rows into `bars`, then inserts matching `l2_state` row using `lastrowid`.
    - **Important**: this uses plain `INSERT` (no upsert). Re-running the same scenario/timeframe/timestamps can trip the unique index on `(symbol, timeframe, ts_start, data_source, scenario)`.

#### How to generate a dataset (current workflow)

- Example script: `python test_synth.py`
  - Calls one of the `synthetic_generators/*` functions
  - Persists via `write_synthetic_series_to_db(...)`
  - After inserting, the dataset appears on the dashboard (via `bars_synth`) and can be viewed at:
    - `/synthetic/<SYMBOL>?scenario=<scenario>&timeframe=<1m|5m|15m>`

You can also generate a dataset via the web app (opt-in):
- **`POST /api/synthetic_generate`** (persists to `bars` + `l2_state`)

- Dataset discovery: **`GET /api/synthetic_datasets`** (groups from `bars_synth`)
- Bars: **`GET /api/synthetic_bars`** (rows from `bars_synth`)
- L2: **`GET /api/synthetic_l2`** (join `bars_synth` → `l2_state`)
- Delete dataset group: **`DELETE /api/synthetic_dataset`** (symbol + scenario + timeframe)

#### Related but separate: oscillator page JS “synthetic”

The standalone oscillation tool (`osc/index.html`) includes its own **client-side random-walk generator** (`osc/src/synth.js`) used for that page’s analysis/demo flows. This JS generator is **not** the same as the Python `synthetic_generators/` pipeline and does **not** persist into SQLite’s `bars`/`l2_state`.

---

## Web UI Pages

### Dashboard

- **GET `/`**
  - Shows “Real Symbols” (from `stock_data`, interval `1Min`)
    - Columns: Ticker, Latest Price, **Range** (per-symbol MIN→MAX timestamp, shown as dates)
  - Shows “Synthetic Data Sets” (from `bars_synth` view)
  - “Fetch Latest Data” triggers `POST /api/fetch-latest` (incremental)
  - “Add + Fetch Range” triggers `POST /api/fetch-latest` with a JSON payload (symbol + date range backfill)
  - Clicking a real symbol opens **band view**: `/ticker/<SYMBOL>?band`
  - Clicking a synthetic dataset opens: `/synthetic/<SYMBOL>?scenario=<...>&timeframe=<...>`

### Real symbol detail

- **GET `/ticker/<ticker>`**
  - Default renders `templates/detail.html` (candlestick + indicators + strategy tools)
  - Query params:
    - `interval` (default `1Min`; commonly `1Min`/`5Min`)
    - `band` (renders `templates/ticker_band.html`, which iframes `chart.html?mode=api`)
    - `legacy` (reserved override; currently still renders `detail.html`)

### Synthetic symbol detail

- **GET `/synthetic/<symbol>`**
  - Requires query params:
    - `scenario` (required)
    - `timeframe` in `{1m,5m,15m}` (default `1m`)
  - Renders `templates/detail.html` with synthetic mode enabled:
    - Data fetched from `/api/synthetic_bars`
    - Optional L2 overlay can be loaded from `/api/synthetic_l2`

### Standalone demo page

- **GET `/chart.html`**
  - Serves the chart page (`chart.html`)
  - Used by band view: `/ticker/<sym>?band` → iframe → `/chart.html?mode=api&symbol=<sym>`
  - Back-compat: `/demo_static.html` redirects to `/chart.html`
  - **Page chrome**: App nav links (Dashboard, Backtest Config), status chip (“Last update”) for live feedback; UI refs in `static/demo_static/js/04_dom_ui_and_span_presets.js`.
  - **Session History modal**: Replay/practice session history in three views — **Cards** (glance), **Ledger** (FIFO lots), **Matrix** (summary). Buttons: Refresh, Close. Opened from Practice toolbar (“History”); wired in `08_replay_and_file_io.js` (open/close, Escape), `07_render_and_interactions.js` (view mode, table render). Data loaded from persisted replay events (SQLite).
  - Grid lines are axis-driven:
    - Horizontal grid aligns to Y-axis price ticks (nice intervals)
    - Vertical grid aligns to X-axis time/date ticks (adaptive with zoom/span)
  - **Bar size UX note**:
    - The UI will **auto-pick** a reasonable `bar_s` (Auto W) and will also **enforce** a minimum `bar_s` to stay within `max_bars` (default `5000`).
    - Minimum bar size is **1 minute** in the Alpaca-only setup.
  - **Feature registry (RL precompute; optional, no build step)**:
    - The `chart.html` demo includes an RL-friendly **feature registry** (`static/demo_static/js/10_features.js`) plus a **feature UI** (`static/demo_static/js/11_feature_ui.js`).
    - Features are computed client-side and stored at **`state.features`** (and cached per-window using a `baseKey` so they don’t recompute unnecessarily).
    - Feature configuration and UI selections are persisted via the existing UI config system (`static/demo_static/js/03_persistence_and_catalog.js`): `feat_cfg`, `feat_enable`, `feat_selected`.
    - URL overrides:
      - `?feat=0` disables feature compute, `?feat=1` enables
      - `?feat_dbg=1` enables basic console logging
    - UI behavior:
      - The readout follows the **hovered bar** (or the latest bar when not hovering).
      - The checkbox list is populated by `11_feature_ui.js` and reads series via `getFeatureSeries("<dot.path>")`.

#### Feature registry — computed series (keys + semantics)

The feature registry is designed for **fixed-schema** RL / diagnostics:
- It computes **every key** every time; “warmup”/quality is represented via `*.is_warm` and `*.fit_ok` flags (do not hard-gate).
- Config windows are expressed in **minutes**, then converted to bars based on the current `bar_s` so behavior is consistent across bar sizes.

**Core**
- `sigma`: rolling stddev of **log returns** \(r_t = \log P_t - \log P_{t-1}\) with floor (`sigma_floor`)
- `vol_z`: short/long sigma ratio (`sigma_short / sigma`)
- `vwap_dev_z`: normalized VWAP deviation in return-units: \(\log(\text{close}/\text{vwap}) / \sigma\)
  - VWAP is read from the overlay series key `vwap_session`; if VWAP overlay is missing/disabled, this series is `NaN`.

**Kalman (local linear trend on log price)**
- `kalman.level`: price-level from Kalman level (`exp(level_log)`)
- `kalman.slope_per_bar`: slope in log-price units (≈ return per bar)
- `kalman.slope_z`: `slope_per_bar / slope_std`
- `kalman.is_warm`: `1` after 20 bars, else `0`
- `kalman.fit_ok`: `1` when `slope_z` is finite, else `0`

**OLS (rolling drift on returns)**
- `ols.mu_hat.k1|k3|k10`: `k * mean(returns)` over `ols_window`
- `ols.t_stat.k1|k3|k10`: crude t-stat of mean return (computed from window stddev and `sqrt(N)`)
- `ols.is_warm`: `1` after `ols_window + 5` bars, else `0`
- `ols.fit_ok`: `1` when `abs(ols.t_stat.k1) >= ols_fit_ok_t_min` (default 1.0), else `0`

**AR(p) on returns (p in {1,2,3} by default)**
- `ar.ar1.mu_hat_k1`, `ar.ar2.mu_hat_k1`, `ar.ar3.mu_hat_k1`: one-step forecast of next return (emitted every bar; refit on stride)
- `ar.ar*.innov_z`: normalized innovation (realized error): `(r_t - prev_forecast) / sigma`
- `ar.ar*.is_stable`: stability flag based on characteristic roots (held constant between refits)
- `ar.ar*.stability_margin`: `1 - max(|root|)` (positive => stable)

**Classifier (logistic regression; per horizon k in {1,3,10} by default)**
- Targets: `y_up(k) = 1` if \(\sum_{i=1..k} r_{t+i} > 0\) else `0`
- Features used: `[kalman.slope_z, vwap_dev_z, vol_z]` + intercept
- No-lookahead training constraint:
  - when computing at bar `t`, the training set only uses indices `<= t-k` so labels don’t peek past `t`
- Output keys:
  - `clf.k1.p_up`, `clf.k3.p_up`, `clf.k10.p_up`
  - `clf.k*.entropy` (Bernoulli entropy of `p_up`)
  - `clf.k*.brier` (rolling Brier score over label-known examples)
  - `clf.k*.cal_ok` (simple calibration flag: brier < 0.25)

#### RL export contract (recommended)

This section describes a **recommended** fixed-schema interface for exporting `state.features` into an RL environment.

**Observation vector schema**
- Use a fixed, ordered schema (no optional/toggle-dependent shape changes).
- Emit `0.0` for any non-finite feature value and rely on the quality flags.

Recommended `OBS_SCHEMA_V1` order:
- `sigma`
- `vol_z`
- `vwap_dev_z`
- `kalman.slope_z`
- `kalman.fit_ok`
- `kalman.is_warm`
- `ols.t_stat.k1`
- `ols.fit_ok`
- `ols.is_warm`
- `ar.ar1.innov_z`
- `ar.ar1.is_stable`
- `ar.ar1.stability_margin`
- `clf.k3.p_up`
- `clf.k3.entropy`
- `clf.k3.brier`
- `clf.k3.cal_ok`

Notes:
- Prefer `k3` classifier outputs as a “middle horizon” default; keep `k1`/`k10` as optional alternative schemas, not mixed ad hoc.
- `vwap_dev_z` requires the VWAP overlay series (`vwap_session`); if VWAP is disabled, it will be `NaN` and exported as `0.0` (agent can learn to ignore it via `kalman/ols` + regime features).

**Action space (simple baseline)**
- Discrete: `0=flat`, `1=long`, `2=short`
- Position sizing fixed at 1× for v1.

**Reward (conservative baseline)**
- Next-step log return reward with trading cost on position changes:
  \[
  r_{t+1} = \text{pos}_t \cdot (\log P_{t+1} - \log P_t) \;-\; \text{cost} \cdot |\text{pos}_t - \text{pos}_{t-1}|
  \]
- This matches the registry’s core normalization (log returns) and discourages churn.

#### Audio Visual Settings (sonification)

The chart page includes an **Audio Visual Settings** sidebar panel and a **Tone.js**-based audio engine that maps replay/practice bars to musical playback. Implemented in `static/demo_static/js/13_audio_controls.js`; layout integration in `static/demo_static/js/07_render_and_interactions.js`.

**Architecture**
- Each replay bar acts as a “musical measure”; **high wick** → soprano voice (upper pitch rail), **low wick** → bass voice (lower pitch rail); **volume** → gain envelope; **Speed** slider → Tone.Transport BPM.
- **Tone.js** is loaded from CDN (unpkg, fallback cdnjs) before other chart scripts; `13_audio_controls.js` is loaded last so it can hook into replay/UI state.

**UI (sidebar, collapsible)**
- **Channel instruments**: Upper wick and lower wick each have enable checkbox, volume (dB), instrument dropdown, and rhythm dropdown (e.g. quarter, eighth, sixteenth for upper; half, quarter, whole for lower).
- **Instruments**: MIDI soundfonts (FluidR3_GM via gleitz.github.io): harpsichord, synth lead, pipe organ, strings, flute (upper); acoustic bass, electric bass, synth pad, pipe organ (lower).
- **Music and genre**: Chord progression (classical, pop, blues, jazz, canon, fifties), optional note labels on chart.
- **Audio visual sync tuning**: Price sensitivity (0.1×–5×), glow duration (1–8 units).
- **Speed**: 30–240 (controls BPM for playback).
- **Start Audio** / **Stop** buttons; status line shows play state.

**Music theory (client-side)**
- **Regime**: MAJOR/MINOR derived from price trend (consecutive up/down bars with configurable threshold).
- **Chord progressions**: 16-step patterns per genre (scale degrees); chord maps for major/minor (I, ii, iii, IV, V, vi, vii° etc.).
- **Note range**: Bass C2–C4, soprano C4–C6 (MIDI 36–84); scale quantization and chord-tone targeting for smoother voice leading.

**Rendering**
- When audio is **playing**, the main canvas in `07_render_and_interactions.js` reserves a **note axis** (40px) on the **left** of the plot for piano-keyboard-style note labels; `noteAxisW = audioActive ? 40 : 0` so plot width and layout adjust automatically.

### Oscillation Signal Analysis (Static Web Page)

**Location**: `osc/index.html` (standalone static page, no server required)

A comprehensive signal processing tool for identifying repeating rhythms in price data using detrending, oscillation scanning, and sine wave fitting techniques.

#### Core Functionality

**Purpose**: Identifies when price behaves like a repeating rhythm at a specific timescale. Explicitly does **not** predict direction, timing, or profitability.

**Data Processing Pipeline**:
1. **Detrending**: Rolling linear detrending removes slow drift using a configurable window (default: 2.0 hours)
2. **Oscillation Scanning**: Tests candidate periods (minutes) to find the best repeating rhythm
3. **Stability Analysis**: Tracks rhythm consistency across overlapping time windows
4. **Signal Gating**: Filters weak/unreliable detections based on stability, regime, and volatility metrics
5. **Sine Wave Fitting**: Fits best-fit sine waves to selected rhythms for visualization and correlation analysis

#### Key Features

**Interactive Controls**:
- **Ticker Selection**: QQQ, AAPL, SPY, TSLA (synthetic data generation)
- **Trading Days**: 1, 2, 3, 5 (default), 10, 20 days of data
- **Smoothing Strength Dial**: Controls detrend aggressiveness (0.25h - 8.0h)
- **Lookback Window Dial**: Controls scan window size (120m - 10 days)
- **Rhythm Search Configuration**:
  - Min/Max period range (default: 5-180 minutes)
  - Step count or linear step size
  - Log spacing option for period distribution
- **Noise Baseline**: Calibrates metrics against random-walk noise (400 runs default)
- **Search Presets**: Quick configurations for daily patterns, short-term jitters, long-term trends
- **Visualization Toggles**:
  - **Show best-fit wave** (default on): global best-fit sine overlay for the active period
  - **Show local match strength** (default on): highlights where the active rhythm matches strongly vs fades out (diagnostic)

**Visualization Panels**:
1. **Original Data & Slow Trends**: Shows raw price with detrend overlay (optional)
2. **Cleaned Signal + Selected Rhythm**: 
   - Detrended signal (yellow)
   - Bandpassed rhythm component (pink/cyan)
   - Best-fit sine wave overlay (dashed, optional, enabled by default)
   - **Local match strength overlay** (optional, enabled by default):
     - **Presence strip** (bottom band): brighter = stronger local match
     - **Segmented sine overlay** (gapped line): drawn only where local match exceeds threshold
   - Cycle turning points (optional)
   - Variance explained badge (High/Medium/Low)
3. **Pattern Finder**: Bar chart showing candidate period scores with coherence and energy metrics
   - **Hover**: shows per-period tooltip (energy, r/coherence)
   - **Click**: selects a period for visualization (locks “Selected rhythm” visuals to that period)
   - **Right-click**: clears selection (returns to Auto)
   - Selection works from both:
     - The main Pattern Finder panel
     - The mini Pattern Finder bars drawn in the analysis chart’s left gutter
4. **Rhythm Stability**: Tracks agreement, clarity, and changes across recent windows

#### Advanced Metrics & Analysis

**Insight Summary** (refined language, multi-dimensional):
- **Structural Stability**: "highly stable" / "moderately stable" / "unstable" (based on clarity, consistency, repeatability)
- **Amplitude Contribution**: Percentage of total cleaned signal movement with contextual descriptions:
  - < 5%: "subtle but persistent oscillation rather than a dominant driver"
  - 5-20%: "moderate oscillatory component"
  - ≥ 20%: "dominant oscillatory pattern"
- **Clarity**: Best score ÷ second-best score (with context notes)
- **Repeatability**: Coherence metric (0-1)
- **Consistency**: Dominance percentage across recent windows
- **Noise Baseline**: Percentile rank vs random price behavior
- **Sine Fit Quality**:
  - **Pearson Correlation**: r coefficient between cleaned signal and fitted sine wave (-1 to +1)
  - **Explained Motion**: r² × 100% within oscillatory portion
  - **Rhythm Coherence**: Normalized projection power (||projection||² / ||signal||²), range 0-1
- **Why This Matters**: Contextual explanation based on stability level

**Signal Gate** (optional filtering):
- **Stability Requirements**:
  - Dominance threshold (default: ≥60%)
  - Separation threshold (default: ≥1.25×)
- **Regime Requirements**:
  - Maximum slope (default: ≤0.9 σ/hr)
  - Require ranging mode (optional)
- **Volatility Requirements**:
  - Noise multiplier threshold (default: ≤1.30)
  - Suppress high noise option

#### Technical Implementation

**Architecture**: Modular JavaScript (no build step, classic script loading)
- **Core Modules**:
  - `scan.js`: Oscillation scanning, period stability, sine fitting, correlation, local match-strength segmentation
  - `detrend.js`: Rolling linear detrending
  - `baseline.js`: Noise baseline generation and calibration
  - `gate.js`: Signal gating logic and UI
  - `insight.js`: Insight summary computation and formatting
- **Rendering Modules**:
  - `render/price.js`: Original price chart with trends
  - `render/analysis.js`: Cleaned signal, rhythm, sine fit visualization, local match-strength overlay
  - `render/scanPanel.js`: Pattern Finder bar chart (interactive selection)
  - `render/consistency.js`: Rhythm stability tracking
- **UI Modules**:
  - `ui/dials.js`: Interactive dial controls
  - `ui/tooltips.js`: Hover tooltip system

**Key Algorithms**:
- **Detrending**: Rolling linear regression over configurable window
- **Bandpass Approximation**: EMA-based bandpass filter (fast EMA - slow EMA)
- **Oscillation Scoring**: `energy × coherence` where:
  - Energy = RMS of bandpassed signal
  - Coherence = autocorrelation at period lag (max 0, ignores anti-phase)
- **Period Stability**: Re-runs scan on overlapping windows, tracks:
  - Dominance: fraction of windows with same winning period
  - Separation: median best/second-best ratio
  - Flip count: frequency of period changes
- **Sine Wave Fitting**: Least-squares fit using sin/cos basis functions
- **Pearson Correlation**: Standard correlation coefficient between signal and fitted sine
- **Rhythm Coherence**: Normalized projection power = (RMS_sine)² / (RMS_signal)²
- **Local Match Strength (diagnostic)**:
  - Computes a trailing-window correlation between the signal and a sine fit at the active period
  - Smooths correlation to reduce flicker, then thresholds into “active” vs “inactive” segments
  - Renders as a presence strip + a segmented (gapped) sine overlay; does **not** feed back into period selection/scoring

**Data Resolution**: All analysis uses 1-minute resolution data (no resampling)

#### Recent Enhancements (2024–2025)

1. **Sine Fit Correlation Metrics**:
   - Added Pearson correlation between detrended signal and best-fit sine wave
   - Added "Explained motion" metric (r² × 100%)
   - Added "Rhythm coherence" (normalized projection power, 0-1)

2. **Insight Summary Language Refinement**:
   - Replaced ambiguous "strong" with structural descriptors ("highly stable")
   - Clarified variance share as "contribution" with amplitude context
   - Enhanced metric labels with contextual notes
   - Improved "Why this matters" explanations

3. **Label Improvements**:
   - Changed "Rhythm strength" to "Variance explained" to avoid multi-dimensional confusion
   - Better alignment between structural stability and energetic amplitude metrics

4. **UI Enhancements**:
   - Best-fit wave checkbox enabled by default
   - HTML-formatted insight summary with proper line breaks and bold labels
   - Improved visual hierarchy and readability

5. **Selected Rhythm Interaction + Local Match Strength (diagnostic)**:
   - Pattern Finder bars are interactive (hover tooltip, click-to-select, right-click-to-clear)
   - Added “Show local match strength” toggle
   - Added presence strip + segmented/gapped overlay to indicate where the selected rhythm matches strongly vs weakly

#### Usage Notes

- **Standalone Operation**: No server required, works as static HTML file
- **Synthetic Data**: Currently generates synthetic price series (not connected to real market data)
- **Performance**: All computation runs client-side in JavaScript
- **Browser Compatibility**: Modern browsers with Canvas API support

### Backtest configuration page

- **GET `/backtest-config`**
  - UI for running and storing backtests/presets.

### Package proof-of-concept

- **GET `/package-proof-of-concept`**
  - Displays versions and sample calculations for analytics packages (the route is resilient if some packages are missing):
    - numpy/scipy/statsmodels

---

## HTTP API (Flask)

### Bandchart-style window endpoint

- **GET `/window`**

Purpose:
- Provide a **windowed** bar payload shaped for the bandchart demo.

Query parameters:
- `symbol` (required): symbol/ticker (uppercased)
- `bar_s` (optional, default `60`): aggregation size in seconds.
  - Enforced minimum is the **base resolution**:
    - **Real** (`stock_data`): 60s (Alpaca-only base resolution, interval `1Min`)
    - **Synthetic** (`bars_synth`): based on timeframe (`1m`→60s, `5m`→300s, `15m`→900s)
  - Values not divisible by 60 are rounded down to the nearest 60s multiple (and clamped to the base resolution)
- `start`, `end` (optional ISO timestamps): window selection; if both omitted, defaults to **last 1 hour**
- `max_bars` (optional) or legacy `limit` (optional): truncation cap (clamped to `[1, 200000]`)
- `source` (optional, default `auto`): `real|synthetic|auto`
  - `auto` uses `stock_data` if the symbol exists at `interval='1Min'`; otherwise falls back to `bars_synth`
- `scenario`, `timeframe` (optional): only used when selecting from **synthetic** datasets
  - If omitted, the server picks the **most recent** `(scenario,timeframe)` group for the symbol.

Data source:
- Reads base rows from either:
  - `stock_data` interval `1Min` (real), or
  - `bars_synth` (synthetic),
  then aggregates to `bar_s`.

Response shape (arrays aligned 1:1):
- `t_ms`, `o`, `h`, `l`, `c`, `v`
- `dataset_start`, `dataset_end` (bounds of available data for the symbol)
- `start`, `end` (served window bounds)
- `truncated`, `max_bars`
- `source` (`real|synthetic`)
- `scenario`, `timeframe` (present when `source='synthetic'`)

### Symbol discovery

- **GET `/api/symbols`**
  - Returns chart-ready symbols from `stock_data` interval `1Min`
  - Response items shaped like: `{ "dataset": "<sym>", "symbol": "<sym>" }`

### Real ticker chart data

- **GET `/api/ticker/<ticker>/<interval>`**

Returns a JSON payload for `templates/detail.html` including:
- `labels`: list of ISO timestamps (from `stock_data.timestamp`)
- `prices`: list of closes
- `ohlc`: list of `{open,high,low,close,volume}`
- `indicators`: `{}` (deprecated; “alpaca imported” indicators are no longer used)
- `indicators_ta`:
  - `ema_9`, `ema_21`, `ema_50`
  - `vwap` (anchored per trading day via `utils.calculate_vwap_per_trading_day()`)
  - `macd`, `macd_signal`
  - Calculated on-the-fly (pandas_ta if installed; otherwise pandas fallbacks)
- `market_hours`: session segmentation (regular / pre_market / after_hours / closed)
- `market_opens`: market open timestamps used for VWAP reset markers
- `strategies`: per-strategy signal payloads
- `candle_bias`: candlestick pattern classifications (educational overlay)
- `pattern_counts`: counts of pattern occurrences in `candle_bias`

### Synthetic dataset discovery

- **GET `/api/synthetic_datasets`**
  - Returns distinct (symbol, scenario, timeframe) groups from `bars_synth`
  - Includes min/max timestamps and bar counts

### Synthetic dataset generation (opt-in)

- **POST `/api/synthetic_generate`**
  - Generates a synthetic dataset and persists it into `bars` + `l2_state`
  - Default generator: `trend_regime_v2`
  - Request body (most-used fields):
    - `dataset_name` (required)
    - `generator` (optional; one of `trend_regime_v1|trend_regime_v2|trend_regime_v3`)
    - `timeframe` (optional; `1m|5m|15m`, default `1m`)
    - `trading_days` (optional int; capped to avoid accidental huge inserts)
    - `start_date` (optional `YYYY-MM-DD`, interpreted in America/New_York)
    - `seed`, `start_price`, `ref_symbol` (optional)

### Synthetic dataset deletion (opt-in)

- **DELETE `/api/synthetic_dataset`**
  - Deletes an entire synthetic dataset group: `symbol` + `scenario` + `timeframe`

### Synthetic bars

- **GET `/api/synthetic_bars`**

Query parameters:
- `symbol` (required)
- `scenario` (required)
- `timeframe` (optional, default `1m`, allowed: `1m|5m|15m`)
- `start_ts`, `end_ts` (optional ISO bounds)
- `limit` (optional, default 1000, max 5000)

Response:
- List of `{ts_start, open, high, low, close, volume}`

### Synthetic L2 series

- **GET `/api/synthetic_l2`**
  - Query params: `symbol`, `scenario`, `timeframe`
  - Response rows aligned to bars by `ts_start`:
    - `{ts_start, dbi, ofi, spr, microprice}`

### Strategy backtest (ad-hoc)

- **POST `/api/strategy/<name>/backtest`**
  - Request body:
    - `ticker`, `interval`
    - `fee_bp` (default 0)
    - `risk_percent` (default 0.5)
    - `reward_multiple` (default 2.0)
  - Runs: strategy signals → engine execution model → summary metrics

### Backtest configs (presets)

- **GET `/api/backtest-configs`**
- **POST `/api/backtest-configs`**
- **DELETE `/api/backtest-configs/<id>`**

### Saved backtests

- **GET `/api/backtests`** (list most recent 100)
- **POST `/api/backtests`** (create a named record; can optionally run immediately)
- **GET `/api/backtests/<id>`**
- **POST `/api/backtests/<id>/run`** (re-run and update stored metrics)
- **DELETE `/api/backtests/<id>`**

### Real data refresh

- **POST `/api/fetch-latest`**
  - Fetches bars from Alpaca and upserts into `stock_data`
  - Default behavior (no payload): incremental “from latest timestamp to now”
  - Optional JSON body fields (used by the dashboard form):
    - `ticker` or `symbol` (optional): fetch only this symbol (lets you add new symbols)
    - `interval` (optional, default `1Min`)
    - `start_date` / `end_date` (optional): accepts `YYYY-MM-DD` or full ISO timestamps; enables range backfill
  - Response: `{ success: bool, records_added: int, last_timestamp: string | null }`

---

## Replay (practice-field) API

The practice-field replay system is used by `chart.html` and provides a deterministic “game loop” over historical bars.

### High-level behavior (requirements)

- **Follow-latest / fixed rolling window**: playback is always right-aligned; users do not pan/zoom into deep history while playing.
- **Start uses current UI settings**: pressing Play/Reset starts replay using the **currently selected** UI parameters (span preset + bar size + toggles). Replay start does **not** internally reset these values; defaults come from persisted UI config / initial UI state.
- **Small per-step payloads**: the replay frontend uses an **opt-in delta protocol** so `/replay/step` returns only *what changed*.
- **Server-authoritative overlays** (current): EMA(9/21/50) and session VWAP are computed on the server and delivered as **append points**.
- **Resync safety net**: the server can include a full snapshot periodically (and the client can request it on mismatch).
- **No fake price action**: delta stepping does **not** fabricate flat candles for closed windows; instead it **fast-forwards** over empty windows until a real bar exists.

### Endpoints

- **POST `/replay/start`**
- **POST `/replay/step`**
- **POST `/replay/order/place`**
- **POST `/replay/flatten`**
- **POST `/replay/end`**

Replay sessions are in-memory (server restart clears them). Replay events are persisted to SQLite for history/analytics.

---

### POST `/replay/start`

Request JSON (most-used fields):

- **`symbol`**: ticker, required (e.g. `SPY`, `QQQ`)
- **`exec_tf_sec`**: execution timeframe, seconds (v1 uses `60`)
- **`disp_tf_sec`**: display timeframe, seconds (e.g. `60`, `300`, `14400`)
- **`seed`**: optional; controls deterministic random anchor selection
- **`snap_to_disp_boundary`**: bool; align start to display bucket boundary
- **`initial_history_bars`**: how many display bars to include in the rolling window
- **`min_future_disp_bars`**, **`min_anchor_age_days`**: anchor selection constraints
- **`delta_mode`**: bool (opt-in). When true, start returns a snapshot compatible with delta-only stepping.

Response:

```json
{
  "session_id": "...",
  "state": { /* snapshot payload */ }
}
```

Snapshot payloads:

- **Legacy snapshot**: `ReplaySession.get_state_payload()` (full window, rebuilt each call)
- **Delta snapshot (opt-in)**: `ReplaySession.get_state_payload_delta()` (fixed window semantics; matches delta stepping)

---

### POST `/replay/step`

This endpoint supports **two modes**:

#### 1) Legacy snapshot mode (default)

Request:
- `session_id`
- `disp_steps` (default 1)
- optional `return_states: true` to request multiple snapshots (legacy buffering; **not used in delta mode**)

Response:
- `{"state": <snapshot>, "delta": {}}` or `{"state": <last>, "states": [<snapshots...>], "delta": {}}`

#### 2) Delta-only mode (opt-in, used by `chart.html`)

Request fields:

- **`session_id`**: required
- **`disp_steps`**: number of display steps to advance (>= 1)
- **`delta_only: true`** (or `mode: "delta"`)
- **`return_deltas: true`**: return an array of deltas (one per step). Safe to buffer since payloads are small.
- **`resync_every`**: integer; include a full snapshot every N emitted deltas (safety net)
- **`force_state: true`**: force include a full snapshot on this call (client-triggered resync)

Single-delta response shape:

```json
{
  "ok": true,
  "delta": {
    "drop": 1,
    "append_bars": [
      { "ts": "2025-01-01T12:00:00Z", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 123 }
    ],
    "overlays_append": {
      "ema": { "9": [ { "ts": "...", "v": 1.23 } ], "21": [ ... ], "50": [ ... ] },
      "vwap": [ { "ts": "...", "v": 1.11 } ]
    }
  },
  "position": { "qty": 0, "avg_price": 0, "realized_pnl": 0, "unrealized_pnl": 0 },
  "orders": [ /* small list */ ],
  "meta": { "disp_window_end": "...Z", "delta_step": 42, "disp_tf_sec": 300 },
  "state": { /* optional: full resync snapshot */ }
}
```

Batch response shape:

```json
{
  "deltas": [ /* array of per-step delta items */ ],
  "state": { /* optional: last included resync snapshot */ }
}
```

Gap handling (important):

- Delta stepping **fast-forwards** over empty display windows (no underlying exec bars) until it finds a real bar to append.
- This keeps playback cadence steady without fabricating candles during closed hours.

---

## Replay delta protocol — frontend contract (`chart.html`)

`chart.html` uses a buffered queue + RAF loop. In delta mode:

- `replayStart()` sends `delta_mode: true`.
- `replayStart()` derives replay session parameters from **current UI state**:
  - `disp_tf_sec` from `state.windowSec`
  - `initial_history_bars` from `state.viewSpanMs` (or `SPAN_PRESETS[state.spanPreset]`)
- `_replayFetchBatch()` sends `delta_only: true` and `return_deltas: true` when batching.
- The queue holds **delta items** (not full states). `_applyReplayDelta()` applies:
  - `drop` + `append_bars` to `state.dataFull`
  - HA derived series incrementally (and rebuilds if lengths drift)
  - overlays append points (server-authoritative)
  - periodic resync (`state` included) handled by `_renderReplayState(state)`

Bar size changes during replay:

- Changing bar size while replay is active **restarts the replay session** using the newly selected `state.windowSec` (so the change takes effect immediately without mid-session resampling).

Session filters (Pre-Market / After-Hours / Closed):

- Delta mode maintains an authoritative `state.dataFull` rolling window.
- If session filters are not “show all”, the frontend uses `applySessionFilter()` to build the filtered view and to keep HA/overlays correct.

---

## Replay regression guardrails (do not break)

**Backend invariants**

- `delta_only` must remain **opt-in**; legacy snapshot behavior must remain unchanged.
- Timestamps must be **UTC-aware**. (DB ISO strings may be tz-less; code forces tz-less to UTC.)
- Delta stepping must not rebuild the full rolling window each tick.
- Empty windows must not create fake price action (fast-forward instead).

**Frontend invariants**

- Do not use `return_states` batching in delta mode (big parse/GC spikes).
- Do not hard-lock span presets or bar size during replay; the user must be able to change them (bar size change may restart replay).
- `_applyReplayDelta()` must keep derived series aligned:
  - `state.dataFull.length` stable (rolling window)
  - `state.ha.length === state.dataFull.length` when HA enabled
  - overlay series lengths aligned (or resync rebuild)
- On mismatch detection, set `_forceResync` and request `force_state: true`.

**Quick manual check (before/after changes)**

- Start replay in `chart.html` and confirm:
  - `/replay/step` payloads are small (Network tab)
  - cadence matches BPM slider
  - candles render normally in Standard and Heikin Ashi
  - toggling session filters while playing doesn’t corrupt candles/overlays (may fall back to filter recompute path)

---

## Strategies (current)

Strategies live in `strategies/` and are registered in `strategies.STRATEGY_REGISTRY`.

### Strategy input contract

Each strategy expects a `pandas.DataFrame`:
- Index: timestamps (converted via `pd.to_datetime`)
- Columns: `open`, `high`, `low`, `close`, `volume`

`rth_mask`:
- Optional boolean mask aligned to bars
- If missing/invalid, strategies default to allowing all sessions

### Strategy output contract (UI + engine compatibility)

Strategy functions return a dict of same-length arrays. For engine compatibility, the following are used:
- `long_entry`: list[bool] aligned 1:1 with bars
- `direction`: list of `'bullish'|'bearish'|None` aligned 1:1 with bars

The engine normalizes these into canonical:
- `entry` (from `entry` if present else `long_entry`)
- `side` (+1 long, -1 short derived from `direction`)

### Implemented strategies

- **`vwap_ema_crossover_v1`**
  - Computes `ema21` and anchored `vwap` if missing
  - Entry on sign change of `(vwap - ema21)`
  - Direction labeling: `'bullish'` when `vwap - ema21 < 0`, else `'bearish'`

- **`fools_paradise`**
  - Computes `ema9`, `ema21`, `ema50`, and anchored `vwap` if missing
  - Bullish setup: EMA slopes up + close > vwap; enter on first green candle
  - Bearish setup: EMA slopes down + close < vwap; enter on first red candle
  - Emits exit markers for visualization, but **the backtest engine currently ignores explicit strategy exits**

---

## Backtesting Engine & Execution Semantics

Backtesting entry point:
- `engine.runner.run_backtest()`
- Compatibility shim: `backtesting.py` re-exports `run_backtest` and `RiskRewardExecutionModel`

Default execution model:
- `engine.execution.RiskRewardExecutionModel`

Key semantics (also validated in `tests/test_engine_execution_model.py`):
- **Signal timing**: signals are computed on bar close (strategy contract)
- **Fill policy**: entry signal at bar `i` fills at **next bar open** (`i+1`)
- **Stops/targets**:
  - `risk_percent` is a percentage distance from entry
  - `reward_multiple` sets TP distance = `reward_multiple * risk`
- **Tie-break**: if TP and SL are both crossed in the same bar, whichever is **closer to the bar open** is assumed to hit first
- **Fees**: `fee_bp` subtracts `fee_bp/10000` from return per trade
- **No overlapping trades**: engine skips signals during an open position window

Returned metrics:
- `n_trades`, `win_rate`, `avg_ret`, `median_ret`

---

## Technical Indicators & Overlays

### Indicator computation (real tickers)

Indicators are computed **on demand** in `/api/ticker/...` (not stored in SQLite):
- EMA(9/21/50): `pandas_ta.ema` if available; otherwise pandas `ewm()`
- MACD + signal: `pandas_ta.macd` if available; otherwise EMA(12/26/9) fallback
- VWAP: anchored per trading day in **US/Eastern** (see `utils.calculate_vwap_per_trading_day`)

### Candlestick bias overlay (educational)

`/api/ticker/...` also computes:
- `candle_bias`: per-bar pattern classification (single/pair/trio + fair value gap)
- `pattern_counts`: counts of each pattern type

This is an educational overlay, not used by the backtest engine.

---

## Dependencies

### Python (`requirements.txt`)

Installed via:

```bash
python -m pip install -r requirements.txt
```

Core:
- `flask==3.0.0`
- `alpaca-trade-api==3.1.1`
- `pandas>=2.2.3`
- `pytz==2024.1`
- `numpy>=1.24.0` (used by candlestick analysis + general numeric ops)
- `pandas-ta==0.4.71b0` (used when available; code has fallbacks but dependency is included)
- `python-dotenv>=1.0.0` (used by scripts; app does not auto-load `.env` today)
- `zstandard>=0.22.0` (installed; currently not required for the core Flask app paths)

Installed by default in `requirements.txt` but only used by `/package-proof-of-concept` (the Flask app won’t crash if they’re missing):
- `scipy>=1.10.0`
- `statsmodels>=0.14.0`

### Frontend (CDN, templates)

From `templates/detail.html` / `templates/synthetic_detail.html`:
- `chart.js@3.9.1`
- `chartjs-adapter-date-fns@2.0.0`
- `chartjs-chart-financial@0.2.1`
- `chartjs-plugin-zoom@1.2.1` (detail view)
- `hammerjs@2.0.8` (detail view)

From `chart.html` (standalone demo / band view):
- **Tone.js** (e.g. `tone@14.7.77` from unpkg; fallback cdnjs) — used by Audio Visual Settings sonification (`13_audio_controls.js`). Loaded before other chart scripts; no build step.
- Chart demo scripts load in order: core/overlays → mode/loader → persistence → DOM/span presets → state/math → loaders → features → render → replay → dials/boot → feature UI → strategy backtest → **audio controls** (last).

---

## Common Workflows

### Initial setup

1) Install dependencies:

```bash
python -m pip install -r requirements.txt
```

2) Initialize DB schema:

```bash
python database.py
```

3) Ingest initial real bars:

```bash
python ingest_data.py
```

4) (Optional) Generate synthetic bars:

```bash
python test_synth.py
```

5) Start the app:

```bash
python app.py
```

Open:
- `http://127.0.0.1:5000/`

### Run tests

```bash
python -m unittest
```

---

## Recent updates (chart / replay / audio)

The following reflects the latest series of changes to the chart and replay experience:

- **chart.html**: Added app nav (Dashboard, Backtest Config), status chip (“Last update”), and **Session History** modal with Cards / Ledger / Matrix views for replay session history (orders, positions); Refresh and Close actions; Escape to close.
- **07_render_and_interactions.js**: When Audio Visual playback is active, the canvas reserves a **note axis** (40px) on the left of the plot for piano-style note labels; plot width and layout adjust via `noteAxisW` so the chart and sonification stay aligned.
- **13_audio_controls.js**: New **Audio Visual Settings** panel and Tone.js-based audio engine — replay bars as measures, high/low wicks mapped to soprano/bass, chord progressions and regime (MAJOR/MINOR from price trend), configurable instruments and rhythm, speed (BPM), sensitivity, and glow duration. Script loaded last; Tone.js from CDN (unpkg/cdnjs).
- **stock_data.db**: Modified by normal ingestion/backfill or replay event persistence (no schema change implied by the above).

---

## Notes & Constraints

- **Base resolution**: real data is stored as 1-minute bars (Alpaca).
- **Time zones**:
  - DB timestamps are treated as ISO strings, generally UTC
  - VWAP anchoring and “trading day” logic is based on **US/Eastern** market session rules.


