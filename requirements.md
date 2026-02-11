# ntree — Requirements & Technical Specification

> **IMPORTANT — DO NOT USE WORKTREES**
>
> All edits must be made in the **main project** at `c:\local_dev\ntree`. Do **NOT** edit files under `C:\Users\chris\.cursor\worktrees\ntree\*` (e.g. wrn, uso, cpe, ooo). The active directory is the main project only.

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
  - **Main toolbar toggles** include `Bands`, `Grid`, `Fill bands`, `Smooth`, `High/Low bands (or wicks)`, `Open/Close bands`, and `Avg line`; `Grid` is user-toggleable and persisted via UI config.
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

The chart page includes an **Audio Visual Settings** sidebar panel and a **Tone.js**-based audio engine that maps replay/practice bars to musical playback. Layout integration in `static/demo_static/js/07_render_and_interactions.js`.

**Source files (modular, in `static/demo_static/js/audio/`)**

The audio system was refactored from a single 3,454-line file into 9 focused modules that communicate via the shared `window._audioModule` namespace (`_am`). Each module is an IIFE that reads dependencies from `_am` and exports its own functions back to `_am`. Load order in `chart.html` must be preserved:

| File | Lines | Responsibility | Key exports to `_am` |
|------|-------|----------------|----------------------|
| `config.js` | ~280 | Pure constants: instruments, note ranges, chord progressions, chord maps, genre/scale configs, kick config | `INSTRUMENT_MAP`, `NOTE_CONFIG`, `CHORD_PROGRESSIONS`, `CHORD_MAP_MAJOR/MINOR`, `GENRES`, `SCALES`, `ROOT_KEY_OFFSETS`, `KICK_CONFIG` |
| `bass_styles.js` | ~90 | Bass line style registry and interval presets for walking-bass variants | `BASS_LINE_STYLES`, `DEFAULT_BASS_LINE_STYLE`, `getBassLineStyle()` |
| `drums.js` | ~780 | Legacy synthesized drum engine and historical beat-pattern implementation (kept in repo for reference/back-compat; not loaded by `chart.html` in current samples-only mode) | `DRUM_BEATS`, `playDrumStep()`, `setDrumVolume()`, `setDrumKitParams()`, `previewDrumPiece()`, `previewFullKit()`, `disposeDrums()` |
| `drums2.js` | ~340 | Active sample/WAV-first drum engine override using Tone.Sampler with folder-matched kit voices (`kick`, `snare`, `hat`, `tom`, `ride`, `cajon`, `clap`, `log`, `tabla`, `timbale`, `misc`), legacy-key compatibility mapping, local-file round-robin loading, and remote fallback when local files are missing; exports override drum APIs in `samples_only` mode | `playDrumStep()`, `setDrumVolume()`, `setDrumKitParams()`, `setDrumNaturalRoom()`, `previewDrumPiece()`, `previewFullKit()`, `disposeDrums()` |
| `state.js` | ~250 | Shared state objects + small utilities | `musicState`, `audioState`, `ui`, `allAudioDropdowns`, `updateStatus()`, `midiToNoteName()`, `rhythmToDuration()`, `rhythmToDurationMs()` |
| `theory.js` | ~370 | Scale/chord math, regime detection, pattern detection, voice separation, chord label helpers | `updateRegimeFromPrice()`, `getScaleNotes()`, `getCurrentChordToneMods()`, `quantizeToChord()`, `nearestScaleNote()`, `offsetScaleDegree()`, `nearestScaleNoteAbove()`, `updateVisiblePriceRange()`, `detectMelodicPattern()`, `getDynamicMidiRange()`, `getChordTonesInRange()`, `forceNoteDifference()`, `forceNoteDifferenceStrict()`, `ensureVoiceSeparation()`, `advanceProgression()`, `getChordLabel()`, `getChordSequence()`, `getChordComponentPCs()` |
| `pathfinder.js` | ~580 | Melodic cell system: soprano/bass note generation, scale runs, orbits, arpeggios, enclosures, walking bass, wick gravity, genre complexity | `generateSopranoNote()`, `getScaleRunNote()`, `getArpeggioNote()`, `applyGenrePhrasing()`, `updateSopranoHistory()`, `updateBassHistory()`, `startMelodicRun()`, `executeRunStep()`, `applyWickGravity()`, `needsWickReturn()`, `startVoiceCell()`, `executeSopranoRunStep()`, `executeWalkingStep()`, `applyGenreComplexity()`, `generateBassNote()` |
| `engine.js` | ~310 | Tone.js lifecycle: sampler load/dispose, init/stop, hot-swap, price-to-MIDI, generateScore | `loadSampler()`, `reloadSampler()`, `initAudioEngine()`, `getSelectedInstrument()`, `stopAudioEngine()`, `updatePriceRange()`, `priceToMidi()`, `generateScore()` |
| `conductor.js` | ~1100 | Animation loop (RAF), processSubStep orchestrator, visual note emission, chart scroll sync, replay integration, pattern override engine, chord event emission | `startAudioAnimation()`, `stopAudioAnimation()`, `pauseAudioAnimation()`, `resumeAudioAnimation()`, `processSubStep()`, `emitSubStepNote()`, `emitNoteEvent()`, `emitChordEvent()`, `generatePatternNote()`, `onBarAdvance()`, `hookIntoReplaySystem()`, `PLAYHEAD_POSITION`, `SUB_STEP_COUNT`, `SUB_STEP_SECONDS` |
| `ui.js` | ~430 | UI wiring (dropdowns/sliders), settings persistence (localStorage), init entry point, keyboard shortcuts | N/A (self-contained; calls into other modules) |

**Inter-module namespace pattern**: Each file follows:
```js
(function() {
    'use strict';
    const _am = window._audioModule = window._audioModule || {};  // config.js creates it
    // or: const _am = window._audioModule;                       // all others read it
    
    // Destructure dependencies from _am for local use
    const musicState = _am.musicState;
    const audioState = _am.audioState;
    // ... function definitions ...
    
    // Export to namespace
    _am.myFunction = myFunction;
})();
```

**Window-level globals** (used by the chart renderer and external code):
- `window.audioState` — the canonical audio state object (also at `_am.audioState`)
- `window._musicState` — alias to `_am.musicState`
- `window._midiToNoteName` — alias to `_am.midiToNoteName`
- `window._audioPlayheadIndex` — current smooth playback position (float bar index); set by conductor, read by renderer
- `window._audioNoteEvents` — array of note event objects for visual rendering; set by conductor, read by renderer
- `window._audioChordEvents` — array of chord region objects for chord overlay rendering; set by `emitChordEvent()`, read by renderer. Each entry has `startBarIndex`, `endBarIndex`, `degree`, `roman`, `noteName`, `quality`, `regime`, `cycleStart`, `cycleNum`
- `window._audioDrumEvents` — short-lived drum hit events (`barIndex`, `subStepInBar`, `hits`, `time`, `glowUntil`) emitted by conductor and consumed by the drum pulse strip renderer for per-component glow highlighting
- `window._audioSubStepSeconds` — sub-step duration (1/16 sec); set by conductor
- `window.onReplayBarAdvance` — callback registered by `hookIntoReplaySystem()` for Practice mode integration

**Architecture -- Pathfinding Sequencer**
- Each replay bar acts as a "musical measure" with **16 sub-steps**; **high wick** -> soprano voice (upper pitch rail), **low wick** -> bass voice (lower pitch rail); **volume** -> gain envelope; **Speed** slider -> BPM.
- **Unified playback**: All note generation routes through `processSubStep()` (the "Conductor" in `conductor.js`). Both the independent animation loop and the Replay/Practice hook use the same code path, ensuring identical sound in all modes.
- **Distance-based pathfinding** (core algorithm in `conductor.js` → `processSubStep()`):
  - **Far from wick (>4 semitones)**: SCALE RUN — walk exactly 1 scale degree per step toward the wick target, creating audible scale passages in the selected genre's mode (Dorian, Yaman, Mixolydian, etc.). When the run reaches within 2 degrees it transitions to a mini-orbit around the target.
  - **Near wick (≤4 semitones)**: ORBIT — dance around the wick target using a scale-degree pattern (Target → +2 → -1 → Target → +1 → -2 → Target → +3), creating the melodic "hugging" effect.
  - **Complexity slider** controls probability of stochastic interruption: at 0 = pure runs/orbits, at 1 = up to 30-40% chance of genre-flavored alternative cells (enclosures, sequences, chord skips, leap+fills).
- **Dynamic cell sizing**: Cell length depends on distance to target (4-8 steps for scale runs, 6-8 for orbits, 4 for enclosures/arpeggios). Longer cells when far away = sustained, audible scale passages.
- **Per-voice pathfinding** (in `pathfinder.js`):
  - **Soprano** (high wick): High agility -- scale runs (1 degree per step), orbits, arpeggios, enclosures, sequences, chord skips, leap+fills. Uses `executeSopranoRunStep()`.
  - **Bass** (low wick): High stability -- walking bass patterns (root/4th/5th leaps), chromatic approaches, chord-tone arpeggios. Uses `executeWalkingStep()`.
- **Genre-aware stochastic interruptions** (in `pathfinder.js` → `applyGenreComplexity()`): Beat-gated -- genre ornaments are NOT applied mid-scale-run (which would break melodic momentum). Each genre defines complexity probabilities (ornament, trill, chromatic passing, enclosure, blue note, etc.) that are multiplied by the **Complexity** slider. At Complexity=0: pure melodic cells; at Complexity=1: maximum genre-specific ornamentation at cell boundaries and weak beats.
- **Wick gravity as safety net** (in `pathfinder.js` → `applyWickGravity()`): Only activates for extreme drift (>14 semitones soprano, >16 bass) -- the distance-based cell selection handles normal wick-tracking. Scale runs and orbits have room to breathe.
- **Scale constraint enforcement** (in `theory.js`): Every generated note is passed through `nearestScaleNote()`, which forces the note onto the current genre's scale (e.g. Yaman, Dorian, Mixolydian). No "free" chromatic notes are emitted unless the genre is explicitly chromatic (Techno/Experimental).
- **Tone.js** is loaded from CDN (unpkg, fallback cdnjs) before other chart scripts; the `audio/` modules are loaded last so they can hook into replay/UI state.

**Price-to-MIDI mapping (in `engine.js` → `priceToMidi()`)**

The price-to-MIDI conversion is the critical bridge between market data and musical pitch. It determines how closely notes "hug" the wick lines.

- **Viewport-based mapping** (primary): Uses the **visible chart viewport** price range (from `musicState.visiblePriceMin/Max`, updated every bar by `updateVisiblePriceRange()` in `theory.js`). This means notes tightly track the wicks regardless of absolute price levels or full data range.
  - Normalizes price to 0..1 within visible viewport
  - Applies **Melodic Range** multiplier around the midpoint: `priceNorm = 0.5 + (priceNorm - 0.5) * melodicRange`
  - Maps to voice-specific MIDI range: Soprano 54-84 (F#3-C6), Bass 24-54 (C1-F#3)
- **Reference-based fallback**: If no visible price range is available, falls back to a reference-based algorithm using `audioState._sopranoRef/bassRef` (set from the starting bar, slowly drifts toward current price at 2% per bar).
- **Price direction tracking**: Stores `musicState._sopranoDirection` and `musicState._bassDirection` (+1/-1/0) for melodic algorithms that want to respond to trend.
- **Viewport update** (`theory.js` → `updateVisiblePriceRange()`): Reads the visible bar range from `state.xOffset` and `computeVisibleBars()`, scans high/low prices, and stores in `musicState.visiblePriceMin/Max` with 2% padding. Falls back to full data range if viewport info unavailable.

**Animation & playback loop (in `conductor.js`)**

The audio playback uses a `requestAnimationFrame`-based loop for smooth, frame-rate-independent progression:

1. **`startAudioAnimation()`**: Calculates `barsPerMs` from BPM, sets initial `_smoothPosition` so the playhead starts at center-screen, resets all melodic state (voice cells, histories, regime), calls `updateVisiblePriceRange()`.
2. **`smoothAnimationLoop(timestamp)`**: RAF callback. Calculates `deltaMs` since last frame (clamped to 100ms for backgrounded tabs). Converts to sub-step advancement: `subStepsPerMs = (bpm / 60) * 16 / 1000`. Calls `processSubStep()` for each new sub-step crossed. Calls `updateSmoothScroll()` every frame for continuous chart scrolling.
3. **`processSubStep(barIndex, subStepInBar, globalSubStep)`**: The Conductor.
   - Every sub-step: drum beat (via `playDrumStep()` from `drums.js`; pattern selected from Drum Beat dropdown).
   - Bar boundary (subStepInBar=0): regime update, progression advance, viewport refresh, target updates for both voices.
   - Soprano rhythm boundary: runs soprano pathfinder (cell selection → `executeSopranoRunStep()` → genre complexity → wick gravity → audio trigger → visual emit).
   - Bass rhythm boundary: runs bass pathfinder (cell selection → `executeWalkingStep()` → genre complexity → wick gravity → audio trigger → visual emit).
   - Voice separation check. Status label update on bar boundaries.
4. **`updateSmoothScroll(smoothPosition)`**: Positions `state.xOffset` so the current audio bar appears at the playhead (center of screen). Calls `draw()` every frame.

**Pause/Resume**: `pauseAudioAnimation()` stops the RAF loop and silences ringing notes but preserves `_smoothPosition` and all melodic state. `resumeAudioAnimation()` re-enters the RAF loop from where it left off with a fresh frame timer.

**Visual note events (emitted by `conductor.js`, consumed by `07_render_and_interactions.js`)**

Note events are pushed to the `window._audioNoteEvents` array (max 400 entries). Each event:
```js
{
  voice: 'soprano' | 'bass',
  midi: 72,              // MIDI note number
  price: 450.25,         // Original price value (for Y positioning on chart)
  barIndex: 123.5,       // Precise fractional bar position (for X positioning)
  rhythm: '4',           // Rhythm setting for visual sizing
  time: 1234567890,      // performance.now() start
  endTime: 1234568090,   // start + durationMs
  durationMs: 200,       // Note duration in ms
  glowUntil: 1234568490  // Glow expiry (start + glowDuration * 200ms)
}
```

The renderer in `07_render_and_interactions.js` reads this array, maps `barIndex` to canvas X and `price` to canvas Y, and draws horizontal bars (or circles in circle mode) with glow fade-out.

**Settings persistence (in `ui.js`, localStorage key: `ntree_audio_visual_settings`)**

Saved on every UI change. Restored on page load. Includes: upper/lower wick settings (enabled, volume, instrument, rhythm, pattern, patternOverride, restartOnChord), drumVolume, drumNaturalRoom, drumGlowIntensity, drumKit (per-piece On/Off + level/decay for `kick`, `snare`, `hat`, `tom`, `ride`, `cajon`, `clap`, `log`, `tabla`, `timbale`, `misc`; legacy saved keys are mapped for compatibility), genre (internally keyed; user-facing label is "Scale"), rootKey, chordProgression, bassLineStyle, drumBeat, displayNotes, chordOverlay, sensitivity, beatStochasticity, melodicRange, glowDuration, displayMode, panel open/closed states, speed (BPM).

**Shared state objects (in `state.js`)**

- **`musicState`**: Music theory state. Regime (UPTREND/DOWNTREND), currentGenre, consecutiveUp/DownBars, progressionStep, rootMidi, prevSoprano/prevBass, soprano/bass history arrays, per-voice cell state (`soprano.runMode/runStepsRemaining/runTargetNote/...`, `bass.runMode/...`), visible price min/max, subStepCounter.
- **`audioState`** (also `window.audioState`): Audio engine config and runtime. Upper/lower wick settings, genre, rootKey, chordProgression, UI display settings, playing/paused flags, internal Tone.js references (`_sopranoSampler`, `_bassSampler`, `_kickSynth`), animation state (`_animationRunning`, `_smoothPosition`, `_subStepPosition`, `_barsPerMs`, `_currentBpm`), price mapping references (`_priceRange`, `_sopranoRef`, `_bassRef`).
- **`ui`**: DOM element cache. All `document.getElementById()` calls are done once at load time and stored here. Every audio UI element (checkboxes, sliders, dropdowns, buttons, labels) is accessed via `ui.elementName` rather than repeated DOM queries.

**Hierarchical Composition Layer (implemented via Complexity slider)**

The Pathfinding Sequencer implements a **"Hierarchical Composition Layer"** — a structured ladder of melodic complexity where each level builds on the previous one, rather than the engine trying to be "creative" all at once. This is expressed as a **continuous Complexity slider (0-1)** rather than discrete tiers, but the conceptual mapping is:

- **Complexity = 0 ("Naked" / Tier 0)**: Pure scale runs (ascending/descending, 1 degree per step) and orbit patterns around the wick. Bass plays chord-tone arpeggios near the wick and root/4th/5th walks when far. Zero genre ornaments are applied. This is the **ground truth** mode — you can hear the raw scale intervals (e.g. Yaman's Lydian intervals, Bhairavi's Phrygian color) cleanly, and verify that the scale pool and wick-hugging are correct. For Indian Raags, this sounds like a formal *Arohana/Avarohana* (scale exercise).
- **Complexity = low-mid ("Structured" / Tier 1)**: Patterned cells begin to appear — arpeggios, enclosures, simple sequences. Bass adds chromatic approaches. Distance-based cell selection still dominates, but variety at cell boundaries increases.
- **Complexity = high ("Dynamic" / Tier 2)**: Full stochastic modulation with genre-specific ornaments (Jazz bebop enclosures, Classical trills, Raag gamaka/meend, Rock blue notes, Techno clusters). Ornaments are **beat-gated** — they only fire at cell boundaries and weak beats, never mid-scale-run.

**Debugging benefit**: If a Raag or mode sounds "off," set Complexity to 0. If it still sounds off, the scale interval array itself is wrong. If it sounds correct at 0 but wrong at higher complexity, the issue is in the ornament/interruption logic.

**UI (sidebar, collapsible)**
- **Channel instruments**: Upper wick and lower wick each have enable checkbox, volume (dB), instrument dropdown, and rhythm dropdown (e.g. quarter, eighth, sixteenth for upper; half, quarter, whole for lower). **Drum** layer has volume (dB) slider. Each voice also has:
  - **Pattern Override** checkbox: When checked, bypasses the deep pathfinder algorithm and uses the selected simple pattern from the voice's pattern dropdown instead. When unchecked (default), the full pathfinder algorithm runs.
  - **Soprano Pattern** dropdown (visible when Pattern Override is checked): Linear Ascending Scale, Asc/Desc Scale, Linear Ascending Arpeggio, Asc/Desc Arpeggio, Alternating Scale/Arpeggio, Alt. Scale/Arp. (Asc/Desc), Random Notes from Chord.
  - **Bass Pattern** dropdown: Chord Root Only, Root/3rd/5th.
  - **Restart on chord change** checkbox (per voice): When checked, the pattern index resets to the nearest note in the new chord when the chord progression advances. When unchecked, the pattern continues from wherever it left off.
- **Instruments**: MIDI soundfonts (FluidR3_GM via gleitz.github.io): harpsichord, synth lead, pipe organ, strings, flute (upper); acoustic bass, electric bass, synth pad, pipe organ (lower).
- **Music and Scale Settings**: Scale selection (Major/Natural Minor, Lydian/Phrygian (Raag), Dorian/Altered, Pentatonic (Major/Minor), Phrygian/Chromatic), chord progression (classical, pop, blues, jazz, canon, fifties, old, bridge), **Bass Line Style** dropdown (Walking Bass, Bluegrass, Baroque Counterpoint, Motown, Reggae, Latin Tumbao, Afrobeat, Pop/Rock Melodic, Electronic/Synth, Minimal/Drone), **Drum Beat** dropdown (Simple, Minimal Jazz, Latin/Salsa, Reggaeton/Latin Trap, Folk-Country Shuffle, Indian Tabla, Afrobeat, Funk Pocket, Lo-Fi/Dilla, Brazilian Samba, Electronic House), root key (C through B), Note Labels toggle, Chord Overlay toggle.
- **Audio visual sync tuning**:
  - **Complexity** (0-1): Controls stochastic interruption probability, scaled by genre-specific ornament chances. 0 = pure melodic cells; 1 = maximum genre ornamentation.
  - **Beat Stochasticity** (0-1): Humanization for drum beats. At 0 = deterministic; at 1 = note dropout (up to 30% skip), ghost notes (soft hi-hat/snare on off-beats), velocity variation, and micro-timing jitter. Reduces mechanical repetition.
  - **Melodic Range** (0.3x-3.0x): Vertical zoom -- expands or compresses the price-to-MIDI mapping. Low = compressed (tighter movements); High = expanded (wider, dramatic leaps).
  - **Glow Duration** (1-8 units): Controls visual glow persistence of note events on chart.
- **Speed**: 30-240 (controls BPM for playback).
- **Start Audio** / **Pause** / **Resume** tri-state button + **Stop** (full reset); spacebar toggles Start/Pause/Resume. Status line shows play state + current regime + active cell type.

**Music theory (client-side, in `config.js` + `theory.js`)**
- **Regime**: UPTREND/DOWNTREND derived from price trend (consecutive up/down bars with configurable threshold of 3). Maps to genre-specific ascending/descending scales.
- **Scales** (defined in `config.js` → `GENRES`; user-facing label is "Scale"): Each scale option defines two scale arrays (uptrend/downtrend) and a complexity config with ornament probabilities:
  - Major / Natural Minor: Major (Ionian) `[0,2,4,5,7,9,11]` / Natural Minor (Aeolian) `[0,2,3,5,7,8,10]`; passing tones, neighbor tones, trills
  - Lydian / Phrygian (Raag): Yaman (Lydian) `[0,2,4,6,7,9,11]` / Bhairavi (Phrygian) `[0,1,3,5,7,8,10]`; gamaka oscillation, meend slides
  - Dorian / Altered: Dorian `[0,2,3,5,7,9,10]` / Altered (Super Locrian) `[0,1,3,4,6,8,10]`; chromatic approaches, bebop enclosures, tritone subs
  - Pentatonic (Major / Minor): Major Pentatonic `[0,2,4,7,9]` / Minor Pentatonic `[0,3,5,7,10]`; blue notes, bends, slides
  - Phrygian / Chromatic: Phrygian `[0,1,3,5,7,8,10]` / Chromatic `[0-11]`; random jumps, clusters
- **Chord progressions** (in `config.js` → `CHORD_PROGRESSIONS`): 16-step patterns per preset (classical, pop, blues, jazz, canon, fifties, old, bridge), each with MAJOR and MINOR variants. Chord maps for major/minor keys map scale degrees to intervals (I=major, ii=minor, etc.). "Old" and "Bridge" are user-defined custom progressions.
- **Chord quantization** (in `theory.js` → `quantizeToChord()`): Maps raw MIDI to the nearest chord tone with voice-leading preference (weighted blend of proximity to target: 60%, smooth motion from previous note: 40%).
- **Note range**: Bass C1-F#3 (MIDI 24-54), Soprano F#3-C6 (MIDI 54-84); scale quantization and chord-tone targeting for smoother voice leading. Root key defaults to C (MIDI 60) and is adjustable via `ROOT_KEY_OFFSETS`.

**Pattern Override Engine** (in `conductor.js` → `generatePatternNote()`)
- When a voice's **Pattern Override** checkbox is checked, `processSubStep()` calls `generatePatternNote()` instead of the deep pathfinder for that voice. This bypasses cell selection, genre complexity, and wick gravity entirely.
- Patterns generate notes deterministically from the current scale pool or chord pool: ascending scales, ascending/descending scales, ascending arpeggios, ascending/descending arpeggios, alternating scale/arpeggio, alternating scale/arpeggio with ascending/descending direction, random chord tones, chord root only, root/3rd/5th.
- Override state (`_overrideState`) tracks per-voice: current index, direction, last progression step, alternation toggle/counter, previous MIDI. Reset on start/stop.
- **Restart on chord change**: When enabled, the pattern index snaps to the nearest note in the new chord's pool when the progression step changes. When disabled, the pattern continues from its current position.

**Rendering**
- When audio is **playing**, the main canvas in `07_render_and_interactions.js` reserves a **note axis** (40px) on the **left** of the plot for piano-keyboard-style note labels; `noteAxisW = audioActive ? 40 : 0` so plot width and layout adjust automatically.
- **Chord progression overlay** (`drawChordOverlay()` in `07_render_and_interactions.js`): Dashed vertical lines at chord boundaries with two-tone pill labels (roman numeral + note name) in a band near the bottom of the price pane. Toggled via "Chord Overlay" checkbox. Labels are **regime-colored**: green (`#7cffc2`) in uptrend/major, red/rose (`#ff6b8a`) in downtrend/minor.
- **Chord look-ahead rendering**: While audio is active, the overlay projects chord regions ahead of the playhead using the current progression step, so upcoming chord labels remain visible in the forward (future) viewport area.
- **Cycle restart indicator**: When the 16-step chord progression loops, a solid amber vertical line replaces the dashed separator, with a numbered badge (`↺ 1`, `↺ 2`, ...) at the top showing which cycle is starting.
- **Regime-aware note colors**: Soprano dots are green in uptrend/major, rose-red in downtrend/minor. Bass dots are blue in uptrend/major, purple in downtrend/minor. The regime is stamped on each note event at emission time for historical accuracy.

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
- **Tone.js** (e.g. `tone@14.7.77` from unpkg; fallback cdnjs) — used by Audio Visual Settings sonification (`static/demo_static/js/audio/*.js`). Loaded before other chart scripts; no build step.
- Chart demo scripts load in order: core/overlays → mode/loader → persistence → DOM/span presets → state/math → loaders → features → render → replay → dials/boot → feature UI → strategy backtest → **audio modules** (last, 9 files: config → bass_styles → state → drums → theory → pathfinder → engine → conductor → ui).

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
- **Audio module refactor**: Split monolithic `13_audio_controls.js` (3,454 lines) into 7 focused modules in `static/demo_static/js/audio/`: `config.js`, `state.js`, `theory.js`, `pathfinder.js`, `engine.js`, `conductor.js`, `ui.js`. Modules communicate via `window._audioModule` namespace. Original archived to `_archive/13_audio_controls.js`. See "Audio Visual Settings" section above for full module inventory.
- **Audio Pathfinding Sequencer architecture**: Unified all playback through `processSubStep()` (the "Conductor" in `conductor.js`). Replaced static snap-to-nearest-note with **4-note melodic cells** (scale runs, arpeggios, orbits) that walk toward wick targets through scale degrees and cross bar boundaries. Added per-voice pathfinding: soprano uses `executeSopranoRunStep()` (high agility), bass uses `executeWalkingStep()` (root/4th/5th walking bass). Implemented `quantizeToChord()` for voice-leading-aware chord quantization. Updated `priceToMidi()` to use visible viewport for tight wick-hugging. Added **Melodic Range** slider (vertical zoom). Repurposed Sensitivity slider as **Complexity** (0-1, multiplies genre-specific ornament probabilities). Genre complexity configs now drive stochastic interruptions (Jazz enclosures, Classical trills, Raag gamaka, etc.).
- **Audio Pathfinder v2 — Hierarchical Composition Layer**: Overhauled melody engine to fix "repeating arpeggiated chords" problem. Implements the **Hierarchical Composition** concept: complexity is built in layers controlled by the Complexity slider (0 = "Naked" ground-truth scale runs, mid = structured cells, 1 = full genre-specific ornamentation). Key changes: (1) Distance-based cell selection: >4 semitones from wick = SCALE_RUN (walk 1 degree/step), ≤4 = ORBIT (dance pattern around wick). (2) **orbit** cell type: Target→+2→-1→Target→+1→-2 pattern for wick-hugging. (3) **Dynamic cell sizing**: 4-8 steps based on distance (longer runs when far). (4) **Beat-gated genre ornaments**: genre complexity no longer interrupts mid-scale-run. (5) **Relaxed wick gravity**: safety net only (>14 semitones), not constant pull. (6) Scale runs step exactly 1 degree for audible genre-specific scale passages. (7) Bass pathfinder uses same distance-based logic (>5 semitones = walk, ≤5 = arpeggio). (8) `nearestScaleNote()` constraint enforcement on every note — ensures genre scale integrity at all complexity levels.
- **stock_data.db**: Modified by normal ingestion/backfill or replay event persistence (no schema change implied by the above).
- **Genre → Scale UI rename**: User-facing label changed from "Genre" to "Scale" across `chart.html`, `config.js` label properties, and `ui.js` console logs. Internal keys (`audioState.genre`, `GENRES`, `musicState.currentGenre`) kept stable for localStorage compatibility. Scale option labels now show actual scale names: Major/Natural Minor, Lydian/Phrygian (Raag), Dorian/Altered, Pentatonic (Major/Minor), Phrygian/Chromatic.
- **Pentatonic scale fix**: Rock/Bluegrass option changed from Mixolydian (uptrend) / Major Pentatonic (downtrend) to **Major Pentatonic** `[0,2,4,7,9]` (uptrend) / **Minor Pentatonic** `[0,3,5,7,10]` (downtrend). The previous Major Pentatonic in downtrend mode clashed with minor chord tones (major 3rd vs minor 3rd, major 6th vs flat 6th).
- **Chord progression overlay**: New `drawChordOverlay()` IIFE in `07_render_and_interactions.js` renders dashed vertical lines at chord change boundaries with two-tone pill labels (roman numeral + note name). Data sourced from `window._audioChordEvents` populated by `emitChordEvent()` in `conductor.js`. Toggleable via "Chord Overlay" checkbox next to "Note Labels".
- **Pattern Override system**: Added per-voice (soprano/bass) pattern override with dropdown, enable checkbox, and restart-on-chord-change checkbox. `generatePatternNote()` in `conductor.js` handles all pattern types. `processSubStep()` now has an `if (patternOverride)` branch that bypasses the full pathfinder.
- **Regime-aware note colors**: Note dots are now colored by regime at emission time: soprano green/red, bass blue/purple. Chord labels also colored green (major/uptrend) or red (minor/downtrend).
- **Cycle restart indicator**: Amber solid line + numbered `↺ N` badge at top of price pane when the 16-step chord progression loops.
- **Custom chord progressions**: Added "Old" (D-F-C-G pattern, 16 single-step chords) and "Bridge" (I-V-vi-IV verse + ii-I-V-ii chorus, 8 paired chords).
- **Drum Beat dropdown**: New `drums.js` module with 11 selectable beat patterns (Simple, Minimal Jazz, Latin/Salsa, Reggaeton/Latin Trap, Folk-Country Shuffle, Indian Tabla, Afrobeat, Funk Pocket, Lo-Fi/Dilla, Brazilian Samba, Electronic House). Drum Beat dropdown added to Music and Scale Settings section. Percussion synths (kick, snare, hi-hat, ride, clave) created lazily; `playDrumStep()` called every sub-step from conductor. Selection persisted in `drumBeat` via localStorage.
- **Drum volume control**: Volume slider for drum layer added to Channel Instruments section (below Lower wick). Controls kick + all percussion. `setDrumVolume()` in drums.js updates all drum synths. Persisted in `drumVolume` (default -12 dB).
- **Beat Stochasticity slider**: Added to Audio Visual Tuning. `playDrumStep()` in drums.js now applies humanization when `beatStochasticity` > 0: note dropout (30% max skip), ghost notes (soft hi-hat/snare on off-beats), velocity variation, micro-timing jitter. Persisted in `beatStochasticity` (default 0).
- **Chart runtime hotfix**: Removed accidental merge-conflict markers from `static/demo_static/js/07_render_and_interactions.js` that caused browser parse failure (`Unexpected token '<<'`), which in turn prevented global draw/practice helpers from initializing (`draw`, `_syncPracticeSpeedLabel`).
- **Folder-matched drum kit controls**: Updated `chart.html`, `state.js`, `ui.js`, and `drums2.js` so drum controls and sampler voices match the local folders exactly (`cajon`, `clap`, `hat`, `kick`, `log`, `misc`, `ride`, `snare`, `tabla`, `timbale`, `tom`), removed the dedicated `cymbal` control/voice, and promoted default beat key/title to `standard_11piece` / "Standard 11-Instrument Groove".
- **Drum pulse strip highlighting**: Drum visualization now highlights whichever component actually fires (kick/snare/hat/ride/clave) with short glow decay, driven by emitted drum-hit events (`window._audioDrumEvents`) from `conductor.js` + `drums.js` and rendered in `07_render_and_interactions.js`.
- **Chord overlay look-ahead**: `drawChordOverlay()` now blends historical emitted chord events with deterministic forward projection from the current progression step, showing upcoming chord labels in the right-side future window while playback runs.
- **Chord progression timing fix**: Audio progression state now initializes with a pre-advance sentinel step (`15`) so the first processed bar aligns to step `0`; this removes the one-bar offset in chord overlays/progression sequencing (notably visible in Blues 12-bar mode).
- **Grid toggle in main chart toolbar**: Added visible `Grid` checkbox (`id="grid"`) to the top chart controls; rendering now respects user on/off state and persists/restores via UI config.
- **Bass Line Style dropdown + registry module**: Added `Bass Line Style` to Music and Scale Settings with 10 starter options from backlog; new `audio/bass_styles.js` defines style keys/interval presets, selection persists as `bassLineStyle`, and `pathfinder.js` uses the selected style for walking-bass interval patterns.
- **Note-axis zoom alignment**: Note-axis and note-dot Y mapping in `07_render_and_interactions.js` now use the current visible/audio price range (with fallback to rendered y-range) instead of full-dataset range, so note spacing stays visually aligned with zoomed price scale.
- **Chart vertical space rebalance**: Increased chart canvas height in `demo_static.css` (710px -> 780px) and reduced volume-pane allocation in `07_render_and_interactions.js` (~22% -> ~14%, tighter clamps) so the main price pane has more vertical room.
- **Zoom persistence across sessions**: UI config persistence now stores and restores chart zoom scale (`zoom_x` for wheel/X zoom, `zoom_y` for Y-axis zoom) in `char_ui_config_v1`; zoom changes are saved on wheel debounce, Y-axis drag release, and Y-axis auto-fit reset.
- **Zoom restore boot-order fix + unload flush**: Initialization now reapplies zoom after URL span handling (so `setSpanPreset()` does not reset restored zoom), accepts optional URL `zoom_x`/`zoom_y` overrides, writes zoom params into the URL for refresh/share continuity, and flushes UI config on `beforeunload`/`pagehide`/hidden-tab transitions to preserve the latest interaction.
- **Audio volume label semantics fix**: Audio Visual Settings volume readouts now show signed dB values (`-60 dB` to `0 dB`) instead of absolute values, so rightward slider movement clearly corresponds to louder output; updated in `audio/ui.js` and default labels in `chart.html`.
- **Audio level usability retune**: Audio volume sliders now use a tighter practical range (`-36 dB` to `+6 dB`) so useful loudness appears earlier in travel; saved volumes are clamped to this range, default wick levels were rebalanced to `-18 dB`, and sampler initialization now honors configured wick volume instead of forcing `-10 dB`.
- **Rhythmic Phrasing engine (Euclidean + Tie/Legato)**: Added global `Pattern Density` (1-16) and `Flow / Sustain` (0-100%) sliders in Audio Visual Tuning, persisted as `audioState.rhythmDensity` and `audioState.sustainFactor`; `processSubStep()` now gates note triggers with a Euclidean pulse mask, applies deterministic tie logic when pitch is unchanged and price movement is small, and maps note duration to candle wick range for volatility-shaped phrasing.
- **Bass phrasing opt-in toggle**: Added `Apply to Bass` checkbox (`audioPhrasingApplyBass`) next to rhythmic phrasing controls; default behavior is soprano-only phrasing, while enabling the toggle applies Euclidean gating, tie/legato, and dynamic duration mapping to bass as well. Persisted as `audioState.phrasingApplyToBass`.
- **Soprano rhythm randomization modes**: Added two Upper-wick rhythm options — `Random (1/4, 1/8, 1/16)` and `Random (1/4, 1/8)` — that randomize soprano note duration per triggered note while preserving existing phrasing/gating logic.
- **Drum timbre enrichment**: Upgraded `audio/drums.js` percussion synthesis with a warm drum bus (EQ + mild saturation + compression + limiter), added sub-kick and snare-body layers, and retuned metallic voices (hat/ride) to reduce brittle highs and improve perceived weight while preserving existing drum-volume and stochasticity controls.
- **Drum realism layers**: Added parallel room ambience send (`Freeverb`) and additional acoustic-style transients (kick click + snare rattle tail) to increase perceived depth and realism without changing UI controls or beat-pattern behavior.
- **Natural Drum Room toggle**: Added `audioDrumNaturalRoom` checkbox in Channel Instruments to A/B drum realism layers live. Toggle persists via `ntree_audio_visual_settings` as `drumNaturalRoom`, controls room-send wetness and transient realism layers while leaving core drum pattern playback unchanged.
- **Dedicated Drum Kit panel (5-piece controls)**: Added `Drum Kit (5-Piece)` sub-panel with per-piece level/decay controls for Kick, Snare, Hi-Hat, Tom, and Cymbal plus `Natural Drum Room`; settings persist in `ntree_audio_visual_settings` (`drumKit.*`, `drumNaturalRoom`) and are applied live in `audio/drums.js` through `setDrumKitParams()` and updated voice synthesis/trigger durations.
- **Drum kit audibility pass**: Added a `Standard 5-Piece Groove` drum beat option and live per-piece preview triggering on drum-kit slider input (`kick/snare/hat/tom/cymbal`) so each control has immediate audible feedback even outside dense pattern sections.
- **Drum voice separation/routing fix**: Routed core kick through the shared drum bus (matching all other kit voices), rebalanced per-voice gain staging/trigger velocities for clearer timbral separation, included tom/cymbal in emitted drum-hit events, and added automatic 5-piece audition when selecting `Standard 5-Piece Groove`.
- **Drum kit playback integration**: Editing any dedicated drum-kit control (piece level/decay or `Natural Drum Room`) now auto-promotes `Drum Beat` from `Simple` to `Standard 5-Piece Groove`, so kit adjustments are reflected in the main chart playback pattern instead of preview-only audition.
- **5-piece beat pattern pass**: Updated drum pattern definitions so named playback beats explicitly drive tom/cymbal parts (not fallback-only) and refreshed Drum Beat dropdown labels to indicate 5-piece variants, making main chart playback reflect full-kit voicing across beat selections.
- **Default drum-beat behavior**: Set default/fallback drum beat to `standard_5piece` in state, UI settings load fallback, conductor runtime fallback, and default selected dropdown item so new sessions start with full-kit playback rather than legacy kick-only.
- **Drum strip 5-lane visualization**: Updated `drawDrumPulseStrip()` in `07_render_and_interactions.js` to render distinct lanes for Cymbal, Hi-Hat, Tom, Snare, and Kick (plus ride/clave overlays), with per-voice glow from `window._audioDrumEvents` including tom/cymbal hits for direct playback validation.
- **Drum strip glow brightness boost**: Increased per-instrument glow opacity and shadow intensity in `drawDrumPulseStrip()` so active beat hits are brighter and easier to read during playback across kick/snare/hat/tom/cymbal/ride/clave lanes.
- **Drum glow intensity slider**: Added `Glow Intensity` control in the Drum Kit panel (`audioDrumGlowIntensity`) with persisted state (`drumGlowIntensity`, default `1.0`, range `0.4-2.5`) and live renderer scaling in `drawDrumPulseStrip()` for user-tunable beat glow brightness.
- **Per-piece drum enable toggles**: Added checkboxes for Kick, Snare, Hi-Hat, Tom, and Cymbal in the Drum Kit panel; persisted via `drumKit.*On`, applied live in `audio/drums.js` trigger/ghost-note logic and preview audition, and reflected in the drum-strip renderer so muted pieces are hidden from playback validation.
- **Hi-hat/cymbal audibility rebalance**: Retuned metallic drum voices (higher synth frequencies/resonance for hat/ride/cymbal), raised hat/cymbal gain staging and trigger velocities, and adjusted drum-bus high EQ from cut to slight boost so hi-frequency kit pieces remain audible alongside kick/snare/tom.
- **Hi-hat/cymbal reinforcement pass**: Added noise-layer transients for hi-hat/cymbal, enabled fallback hit scheduling when a selected beat omits explicit hat/cymbal arrays, and aligned drum-strip hat fallback rendering with playback so high-frequency percussion presence is both audible and visible.
- **Timbre contour pass (open hats / wash ride / bright crash)**: Updated metallic percussion articulation in `audio/drums.js` to blend short hat ticks with longer sizzle tails, shift ride toward a wash-bed profile (soft ping + sustained pink-noise wash), and shape cymbal crashes with a two-stage non-linear decay (fast transient + extended shimmer tail) for more natural high-frequency timbre.
- **Elvin Jones cymbal feel pass**: Applied jazz-style cymbal humanization in `audio/drums.js` (5-10ms micro-timing drift and wider cymbal velocity spread near MIDI 90-110 equivalent) across hi-hat, ride, and cymbal triggers to reduce machine-like repetition while keeping the ride-led wash character.
- **7-piece drum-kit expansion (conga + clave)**: Expanded Drum Kit UI from 5-piece to 7-piece with new Conga and Clave toggles/level/decay controls (`chart.html`, `audio/state.js`, `audio/ui.js`), added conga/clave synthesis and trigger logic with per-piece gating + preview support (`audio/drums.js`), updated beat labels/default to `standard_7piece` with backward mapping for legacy `standard_5piece` saves, and extended drum-step events/render strip lanes to include conga + dedicated clave lane (`audio/conductor.js`, `07_render_and_interactions.js`).
- **Sample-based drum engine override (`drums2.js`)**: Added a new sampler-driven drum module that uses source sample files (Tone.Sampler + midi-js-soundfonts base URLs) for all drum pieces and overrides `_audioModule` drum exports while preserving existing drum UI controls and beat routing.
- **Local drum sample drop-in convention**: Updated `audio/drums2.js` to detect and use local one-shot files from `static/demo_static/audio/drums/<piece>/` (with round-robin across multiple files per piece), fallback per-piece to remote sampler sources when local files are missing, and exposed `primeDrumSamples()` preload hook (called from `audio/ui.js` init) to reduce first-hit latency; documented expected filenames and format in `static/demo_static/audio/drums/README.md`.
- **Local sample alias support**: Extended `audio/drums2.js` local detection to accept existing numbered filenames and folder aliases already present in this project (`hat/`, `ride/`, `tabla/`, `timbale/`, `cajon/`, `log/`, `clap/`) so local kits bind without additional renaming, while keeping canonical `hihat/cymbal/conga/clave` paths as preferred structure.
- **Samples-only drum mode enforcement**: Removed `audio/drums.js` from `chart.html` load order, made `audio/drums2.js` self-contained with full drum-beat definitions + compatibility alias key (`standard_5piece`), and added explicit `samples_only` mode handling in `audio/engine.js` to prevent legacy synthesized kick initialization/test-note playback when sample drums are active.
- **WAV decay response strengthening**: In `audio/drums2.js`, decay sliders now drive a broadened per-piece decay envelope mapping (normalized slider -> piece-specific trigger duration + sampler release shaping) so decay controls are audibly stronger on sample playback across the current 11-folder kit (`kick`, `snare`, `hat`, `tom`, `ride`, `cajon`, `clap`, `log`, `tabla`, `timbale`, `misc`).
- **WAV-first 11-folder drum model (current)**: Drum playback now uses the folder-matched local sample model first (`static/demo_static/audio/drums/<piece>/`) with `Tone.Sampler` round-robin file selection per piece and remote fallback only when local files are absent; drum UI defaults and beat defaults are aligned to `standard_11piece`, and the dedicated `cymbal` control/voice has been removed in favor of `ride`.
- **Noise-first cymbal voicing pass**: Rebalanced hi-hat/ride/cymbal synthesis toward SHHH/CHHH texture by lowering metallic layer level/decay and increasing noise-layer level/decay dominance (including preview triggers), while retaining subtle transient attack so high-frequency percussion sounds less like metallic ping and more like open-air shimmer.
- **Cymbal realism refactor from notes**: Updated `audio/drums.js` cymbal path with shared hi-hat high-pass filtering (7.5kHz+ automated rise during hat decay), higher-complexity ride overtones (`harmonicity: 4.7`, richer modulation), softened crash attack with delayed bloom wash (~10ms), subtle cymbal-only glue distortion (`wet: 0.1`), and higher room dampening to reduce tin-can metallic reverb.
- **Cymbal harshness taming pass**: Reduced ride/crash metallic dominance (lower cymbal/ride metal gain, lower harmonicity/modulation/resonance, shorter metal release), lowered cymbal glue distortion wetness, and extended noise-tail dominance for crash bloom to remove low-mid clang/"metal gate" character while preserving bright air.
- **Cymbal-from-hi-hat voicing pass**: Revoiced ride/crash to inherit hi-hat-like noise character (white-noise shimmer + related overtone profile) while scaling for larger-disk behavior via lower metal center frequency, slower bloom, and longer resonance tail so cymbal timbre feels like a bigger hi-hat rather than a separate clanky metal source.
- **Cymbal decay parameter hard-hook**: Added explicit `applyCymbalDecayArticulation()` mapping in `audio/drums.js` so `drumKit.cymbalDecay` continuously retunes ride/crash synth envelope attack/decay/release plus wash/noise decay (applied on synth init and `setDrumKitParams()`), and aligned trigger durations/previews to the same stronger scaling for clearly audible decay slider response.

---

## Notes & Constraints

- **Base resolution**: real data is stored as 1-minute bars (Alpaca).
- **Time zones**:
  - DB timestamps are treated as ISO strings, generally UTC
  - VWAP anchoring and “trading day” logic is based on **US/Eastern** market session rules.


