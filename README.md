# Stock Ticker Dashboard

A Python-based web application for displaying real-time stock ticker data for SPY and QQQ using the Alpaca API.

## Features

- SQLite database for storing stock data
- Data ingestion script that fetches 1-minute and 5-minute interval data for SPY and QQQ (last 3 days)
- Web dashboard with a grid view showing latest prices and timestamps
- Interactive detail view with customizable charts for 1-minute and 5-minute intervals
- Clickable rows to navigate to detailed ticker views

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Initialize the database:
```bash
python database.py
```

3. Ingest stock data from Alpaca API:
```bash
python ingest_data.py
```

4. Start the web application:
```bash
python app.py
```

5. Open your browser and navigate to:
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

## Usage

1. **Data Ingestion**: Run `ingest_data.py` to fetch the latest 3 days of stock data for SPY and QQQ at 1-minute and 5-minute intervals.

2. **View Dashboard**: Access the main page to see a grid of all tickers with their latest prices and timestamps.

3. **View Details**: Click on any ticker row to see a detailed chart view. Use the links at the top to switch between 1-minute and 5-minute interval views.

## API Endpoints

- `GET /` - Main dashboard page
- `GET /ticker/<ticker>` - Detail view for a specific ticker
- `GET /api/ticker/<ticker>/<interval>` - JSON API endpoint for chart data

## Notes

- The Alpaca API credentials are configured in `ingest_data.py`
- Data is stored in SQLite database `stock_data.db`
- The application uses Chart.js for interactive chart visualization
- The web interface is responsive and modern with a gradient design

