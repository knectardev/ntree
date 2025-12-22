# ntree — Requirements & Technical Specification

This document describes the **current** functionality and technical specifications implemented in this repo (Flask app, SQLite schema, APIs, UI pages, strategy/backtest semantics, and dependencies).

---

## Overview

`ntree` is a **local Flask web app** for:

- Viewing **real market OHLCV bars** ingested from **Alpaca** into SQLite (`stock_data.db`)
- Viewing **synthetic OHLCV + L2-derived features** stored in SQLite (`bars` + `l2_state`)
- Rendering interactive charts via **Chart.js (candlestick)** and an embedded **bandchart-style** demo page
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

Synthetic series are generated in Python and persisted into `bars` + `l2_state`.

- Example script: `python test_synth.py`
- Generator: `synthetic_generators/trend_regime_v1.py`
  - Produces OHLCV bars and aligned L2 feature rows
  - Scenario name: `trend_regime_v1`
  - Supported timeframes: `1m`, `5m`, `15m` (app validation)

Persistence helper:
- `synthetic_generators.base.write_synthetic_series_to_db()`

---

## Web UI Pages

### Dashboard

- **GET `/`**
  - Shows “Real Symbols” (from `stock_data`, interval `1Min`)
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
    - `band` (renders `templates/ticker_band.html`, which iframes `demo_static.html?mode=api`)
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

- **GET `/demo_static.html`**
  - Serves the static demo (`demo_static.html`)
  - Used by band view: `/ticker/<sym>?band` → iframe → `/demo_static.html?mode=api&symbol=<sym>`
  - Grid lines are axis-driven:
    - Horizontal grid aligns to Y-axis price ticks (nice intervals)
    - Vertical grid aligns to X-axis time/date ticks (adaptive with zoom/span)
  - **Bar size UX note**:
    - The UI will **auto-pick** a reasonable `bar_s` (Auto W) and will also **enforce** a minimum `bar_s` to stay within `max_bars` (default `5000`).
    - Minimum bar size is **1 minute** in the Alpaca-only setup.

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
  - Enforced minimum is **60s** (Alpaca-only base resolution)
  - Values not divisible by 60 are rounded down to the nearest 60s multiple (and clamped to >= 60)
- `start`, `end` (optional ISO timestamps): window selection; if both omitted, defaults to **last 1 hour**
- `max_bars` (optional) or legacy `limit` (optional): truncation cap (clamped to `[1, 200000]`)

Data source:
- Reads base rows from `stock_data` interval `1Min`, then aggregates to `bar_s`.

Response shape (arrays aligned 1:1):
- `t_ms`, `o`, `h`, `l`, `c`, `v`
- `dataset_start`, `dataset_end` (bounds of available data for the symbol)
- `start`, `end` (served window bounds)
- `truncated`, `max_bars`

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

## Notes & Constraints

- **Base resolution**: real data is stored as 1-minute bars (Alpaca).
- **Time zones**:
  - DB timestamps are treated as ISO strings, generally UTC
  - VWAP anchoring and “trading day” logic is based on **US/Eastern** market session rules.


