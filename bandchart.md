## Overview
This repo serves **pre-aggregated OHLCV bars** via a local FastAPI endpoint:

- **`GET /window`**: returns arrays `t_ms,o,h,l,c,v` for the chart
- **`GET /live/status`**: shows whether Databento Live ingestion is enabled/connected
- **`GET /symbols`**: lists chart-ready symbols discovered from local `data/*/historical/...` folders (plus synthetic `ES_CONT`)

Historical bars come from the on-disk DBN in `data/ES/historical/.../data.dbn`.

## Live data (Databento)
Live ingestion is **optional** and **off by default**.

- **Required**: set an API key in an environment variable (default: `DATABENTO_API_KEY`)
- **Catch-up**: on startup, the server subscribes with `start=` set to *(historical DBN end − overlap)* so gaps since the DBN end are replayed.

### Config env vars
See `env.example` for the full list. Common ones:

- **`DATABENTO_API_KEY`**: enables live
- **`CHAR_DATABENTO_SYMBOLS`**: comma-separated symbols (default `ESZ5`)
- **`CHAR_LIVE_CATCHUP_OVERLAP_S`**: seconds of overlap before DBN end (default `300`)
- **`CHAR_LIVE_CATCHUP_START_ISO`**: override replay start (optional)

## Running (Windows PowerShell)
Install deps:

```powershell
python -m pip install -r requirements.txt
```

Run API:

```powershell
$env:DATABENTO_API_KEY="YOUR_KEY_HERE"   # omit to run historical-only
uvicorn api_server:app --reload --port 8001
```

If port `8001` is stuck/busy (common after multiple `--reload` runs on Windows), use a different port:

```powershell
uvicorn api_server:app --port 8002
```

### “Set it once” local key (recommended)
Create a local file that is already gitignored:

```powershell
copy env.local.example env.local
notepad env.local
```

Then start the API (loads `env.local` into the process env and runs on port 8002):

```powershell
.\run_api.ps1
```

Open the demo:

- `demo_api.html` (in browser), or visit `/` when the server is running.

## UI settings persistence
The demo UI (toggles like **Volume/Grid/Auto-scale**, etc.) now persists its latest state to a local JSON file:

- `ui_config.local.json` (created next to `api_server.py`)

When you reload the app, the server serves those saved settings back to the frontend so your last selections are restored. This file is gitignored and intended to be machine-local.

## Troubleshooting
Check live status:

- `GET /live/status`

What to look for:

- **`enabled: true`**: key env var is set
- **`connected: true`**: Live client is running
- **`last_error`**: populated if subscription/streaming failed

Chart refreshing/snapping:

- When “Go live” mode is enabled, the demo polls periodically.
- Any manual pan/zoom now disables follow-latest until you click **Go live** again.

Live symbols:

- Live streaming only produces bars for the raw symbols you subscribe to via `CHAR_DATABENTO_SYMBOLS`.
- If you add contract-specific symbols in the UI (e.g. `ESU5`), make sure they are included or they will appear historical-only.
- Note: **expired contracts may not resolve in Databento live**; if included, they can prevent the live stream from connecting. Prefer subscribing to the **currently active** contract.

## Continuous ES (synthetic)
If you chart a single expiry (e.g. `ESZ5`) over a long lookback, earlier months can show tiny volume simply because that deferred contract was illiquid. To get a “how ES trades” view over months, use the synthetic continuous symbol:

- **Symbol**: `ES_CONT` (aliases: `ES1!`, `ES`)
- **Roll mode**: **calendar roll** (deterministic)
  - Switch **M → U** on the **second Thursday of June** (00:00 UTC)
  - Switch **U → Z** on the **second Thursday of September** (00:00 UTC)
- **Back-adjust**: **disabled by default** (no price adjustment; pure “switch”, not a stitched back-adjusted series)
- **Volume at roll**: **switches** source contract; it does **not** merge bars across contracts (avoids double-counting)
- **Live**: when live ingest is enabled, `ES_CONT` merges in live bars from the appropriate underlying contract for each bucket.

### Debug: verify the source contract per bar
Use `include_src=1` to return an additional array:

- `src_sym[]`: per-bar source symbol (`ESM5` / `ESU5` / `ESZ5`), aligned with `t_ms[]`

Example (Windows PowerShell):

```powershell
curl "http://localhost:8002/window?symbol=ES_CONT&start=2025-09-08T00:00:00Z&end=2025-09-15T00:00:00Z&bar_s=3600&max_bars=5000&include_src=1"
```

### Quick roll-date test checklist
- Request a window that straddles the September roll week (see example above).
- Confirm `src_sym[]` is **all `ESU5`** before the roll threshold and **all `ESZ5`** after it.
- Confirm there is **no bar** where `src_sym[]` flips back and forth (single switch, no oscillation).

Cool — that’s the right order of operations: UI first, then a thin data adapter.

Here’s what you need to hook the ntree template up to a SQLite bar store sourced from Alpaca (free), with the important constraint that your base resolution is 1 minute.

1) Decide the “contract” between UI ↔ backend

Your UI already knows how to “load a window” of bars. Keep that shape.

Define one endpoint:

GET /api/bars/window with params:

symbol (e.g., AAPL, SPY)

tf (timeframe) — for now: 1Min, optionally also 5Min, 15Min, 1Hour, 1Day

start (ISO string or epoch ms)

end (ISO or epoch ms)

limit (optional safety limit, e.g., 5000)

Response should match your renderer’s expectations:

{
  "symbol": "SPY",
  "bar_s": 60,
  "dataset_start": "2025-11-01T00:00:00Z",
  "dataset_end": "2025-12-18T15:59:00Z",
  "start": "2025-12-18T14:30:00Z",
  "end": "2025-12-18T15:59:00Z",
  "t_ms": [ ... ],
  "o": [ ... ],
  "h": [ ... ],
  "l": [ ... ],
  "c": [ ... ],
  "v": [ ... ]
}


That way your static JSON loader becomes “the same loader, but fetching from /api/...”.

2) SQLite schema that makes window queries fast

Use 1-minute bars as the canonical store.

Table: bars_1m

symbol TEXT NOT NULL

t_ms INTEGER NOT NULL (UTC epoch ms at bar open)

o REAL NOT NULL

h REAL NOT NULL

l REAL NOT NULL

c REAL NOT NULL

v REAL NOT NULL

PRIMARY KEY (symbol, t_ms)

Indexes

The primary key is already the key index you need for range queries.

Optional: INDEX bars_1m_symbol_time ON bars_1m(symbol, t_ms) (redundant if PK is (symbol,t_ms), but some people still add it for clarity).

Why epoch ms?
It avoids timezone/string parsing overhead and makes [start,end] range queries trivial.

3) Server-side window query (core path)

When /api/bars/window is called:

Parse start/end → epoch ms

Query:

SELECT t_ms, o, h, l, c, v
FROM bars_1m
WHERE symbol = ?
  AND t_ms >= ?
  AND t_ms <= ?
ORDER BY t_ms ASC
LIMIT ?


Pack into arrays (t_ms, o, h, l, c, v)

Include dataset_start/dataset_end cheaply:

SELECT MIN(t_ms), MAX(t_ms) FROM bars_1m WHERE symbol = ?


(cache this per symbol in memory; it barely changes once you’re caught up)

4) Handling timeframes above 1 minute

Since Alpaca-free bottoms at 1Min, you have two options for 5Min/15Min/1H/1D:

Option A (recommended): aggregate on the fly from 1m

For a requested tf=5Min:

bucket start = floor(t_ms / (5601000)) * (5601000)

o = first o in bucket

h = max h

l = min l

c = last c

v = sum v

Implementation choices:

Aggregate in Python after pulling the needed 1m rows for the window (simple).

Or aggregate in SQL using grouping logic (harder, can be faster, but more annoying in SQLite).

Rule of thumb: do Python aggregation first; optimize later if needed.

Option B: materialize higher timeframes into separate tables

bars_5m, bars_15m, etc. This is faster at runtime but adds maintenance complexity.
Only do this if/when the UI is consistently requesting big windows at 5m+.

5) How the Alpaca “fetcher” should work

You want a separate process/module that keeps SQLite up to date.

Data ingestion loop (per symbol)

Look up last stored bar for symbol:

SELECT MAX(t_ms) FROM bars_1m WHERE symbol = ?


If none exists, choose a backfill start (e.g., last 30/90 days).

Call Alpaca historical bars endpoint for 1Min bars for [start, now].

Upsert into SQLite:

INSERT INTO bars_1m(symbol,t_ms,o,h,l,c,v)
VALUES(?,?,?,?,?,?,?)
ON CONFLICT(symbol,t_ms) DO UPDATE SET
  o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c, v=excluded.v


Repeat periodically (poll every 5–15 seconds is fine for research UI).

Important: Alpaca “free” may not give you every symbol’s full depth or may have market-hours quirks; don’t fight perfection here. The UI is for research, not execution.

6) UI-side changes

Your static template currently loads ./static/bars/*.json.

Replace the “load bars” function with:

Build URL: /api/bars/window?symbol=...&tf=1Min&start=...&end=...

fetch() it

Feed response into the exact same renderer pipeline you already have.

Also add:

A simple /api/symbols endpoint (or hardcode a list for now)

Optional /api/meta?symbol=... endpoint if your UI uses dataset bounds (or just return dataset_start/end in every window response)

7) The 30-second question (since you used it before)

Because your base is 1-minute:

You cannot honestly render 30-second candles from 1-minute OHLCV.

Best alternatives:

Remove 30s from presets entirely in ntree for this mode.

If you really want “more granularity,” you’d need a different feed that provides sub-minute trades/quotes (not Alpaca-free).

So: make SNAP_PRESETS start at 60s, and keep your UI honest.

8) Minimal “MVP wiring” checklist

If you want the shortest path:

Create bars_1m table + PK

Write GET /api/bars/window

Hardcode symbol list in the UI temporarily

Write a one-off “backfill SPY last 30 days” script into SQLite

Confirm:

UI can load a window

pan/zoom triggers new window fetches

no full-history bootstrap

Add the incremental updater loop later