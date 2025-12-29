# ntree (local Flask app)

`ntree` is a **local Flask web app** for viewing real OHLCV bars stored in SQLite, browsing synthetic datasets (bars + L2-derived features), rendering interactive charts, and running simple strategy backtests.

## Features

- SQLite database for storing market data (`stock_data.db`)
- Alpaca ingestion
  - Initial backfill via `ingest_data.py`
  - Incremental refresh + optional per-ticker range fetch from the dashboard (`POST /api/fetch-latest`)
- Dashboard
  - Real symbols table (click-through to band view)
  - Synthetic datasets table (click-through to synthetic detail view)
- Interactive chart pages (Chart.js candlesticks + zoom)
- Backtest utilities
  - Strategy signals rendered in the UI
  - Simple risk/reward backtest engine with explicit execution assumptions
  - Saved backtest configs + saved backtests APIs/pages

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Configure Alpaca API credentials (**current implementation**):
   - Alpaca credentials are currently **hard-coded** in:
     - `app.py` (used by `POST /api/fetch-latest`)
     - `ingest_data.py` (used by the initial ingest script)
   - Before running ingestion or using “Fetch Latest Data”, replace the `API_KEY` / `API_SECRET` values in those files with your own.
   - Note: `python-dotenv` exists in `requirements.txt` and `test_env.py` can load a `.env`, but the main Flask app does **not** call `load_dotenv()` today (and there is no `.env.example` committed).

3. Initialize the database:
```bash
python database.py
```

4. Ingest stock data from Alpaca API:
```bash
python ingest_data.py
```

5. Start the web application:
```bash
python app.py
```

6. Open your browser and navigate to:
```
http://localhost:5000
```

## Project Structure

- `database.py` - SQLite database initialization and connection management
- `ingest_data.py` - Script to fetch and store stock data from Alpaca API
- `app.py` - Flask web application with routes and API endpoints
- `templates/index.html` - Main dashboard page with ticker grid
- `templates/detail.html` - Detail view page with interactive charts
- `stock_data.db` - SQLite database file (created automatically)

### Database path override

By default the DB is stored at `stock_data.db` in the repo directory. You can override the location via:

```bash
setx NTREE_DB_PATH "C:\path\to\your\stock_data.db"
```

## Usage

1. **Data Ingestion**: Run `ingest_data.py` to fetch the latest ~5 days of stock data for SPY and QQQ at 1-minute and 5-minute intervals.

2. **View Dashboard**: Access the main page to see the real tickers list and synthetic datasets list. Use:
   - **Fetch Latest Data** for an incremental update
   - **Add + Fetch Range** to add/backfill a specific ticker over a date range

3. **View Details**:
   - Real symbol band view: click a ticker row on the dashboard → `/ticker/<TICKER>?band` (iframe demo uses `/window`)
   - Synthetic detail view: click a dataset row → `/synthetic/<SYMBOL>?scenario=<...>&timeframe=<...>`

## API Endpoints

- `GET /` - Main dashboard page
- `GET /ticker/<ticker>` - Detail view for a specific ticker
- `GET /api/ticker/<ticker>/<interval>` - JSON API endpoint for chart data
- `GET /window` - Bandchart-style window endpoint (aggregates 1Min bars to `bar_s`)
- `POST /api/fetch-latest` - Alpaca refresh/backfill into `stock_data`
- `GET /api/synthetic_datasets` - List synthetic dataset groups
- `GET /api/synthetic_bars` - Fetch synthetic OHLCV bars
- `GET /api/synthetic_l2` - Fetch synthetic L2 series aligned to bars
- `GET /backtest-config` - Backtest config UI
- `GET /api/backtest-configs` / `POST /api/backtest-configs` / `DELETE /api/backtest-configs/<id>`
- `GET /api/backtests` / `POST /api/backtests` / `GET /api/backtests/<id>` / `POST /api/backtests/<id>/run` / `DELETE /api/backtests/<id>`
- Replay (practice-field):
  - `POST /replay/start`
  - `POST /replay/step`
  - `POST /replay/order/place`
  - `POST /replay/flatten`
  - `POST /replay/end`

## Notes

- Credentials: currently hard-coded in `app.py` and `ingest_data.py` (see Setup).
- Data is stored in SQLite database `stock_data.db` (or `NTREE_DB_PATH` override).
- The application uses Chart.js (candlesticks + zoom) for interactive visualization.
- Replay (practice-field) uses an **opt-in delta protocol** for smooth playback (tiny `/replay/step` payloads). See `requirements.md` → **Replay (practice-field) API** for the exact contract and regression guardrails.

