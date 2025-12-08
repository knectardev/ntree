# Stock Ticker Dashboard - Requirements

## Overview
A Python-based web application for displaying real-time stock ticker data for SPY and QQQ using the Alpaca API. The application provides a dashboard interface with interactive charts, technical indicators, and incremental data updates.

## Core Functionality

### 1. Data Storage
- **Database**: SQLite database (`stock_data.db`)
- **Schema**: 
  - Stores OHLC (Open, High, Low, Close) price data
  - Volume information
  - Technical indicators: EMA 9, EMA 21, EMA 50, VWAP
  - Supports multiple intervals (1-minute and 5-minute)
  - Unique constraint on (ticker, timestamp, interval)
  - Indexed for efficient queries on (ticker, interval, timestamp)

### 2. Data Ingestion
- **Initial Data Load**: 
  - Fetches last 5 days of historical data for SPY and QQQ
  - Supports 1-minute and 5-minute intervals
  - Uses Alpaca API IEX feed (free tier compatible)
  - Calculates technical indicators during ingestion:
    - EMA 9 (Exponential Moving Average, 9-period)
    - EMA 21 (Exponential Moving Average, 21-period)
    - EMA 50 (Exponential Moving Average, 50-period)
    - VWAP (Volume Weighted Average Price)
- **Incremental Updates**:
  - Fetches data from last timestamp in database
  - Prevents duplicate data insertion
  - Can be triggered via web interface button
  - Automatically calculates technical indicators for new data

### 3. Web Dashboard
- **Main Page (`/`)**:
  - Grid view displaying all tickers (SPY, QQQ)
  - Shows latest price and timestamp for each ticker
  - Displays data range information (earliest to latest timestamp)
  - Shows total number of records in database
  - "Fetch Latest Data" button for manual incremental updates
  - Clickable rows to navigate to detailed ticker views
  - Responsive design with modern gradient UI

### 4. Detail View
- **Ticker Detail Page (`/ticker/<ticker>`)**:
  - Interactive candlestick charts using Chart.js
  - Interval selector (1-minute and 5-minute views)
  - Toggleable technical indicators:
    - EMA 9 (red dashed line)
    - EMA 21 (blue dashed line)
    - EMA 50 (yellow dashed line)
    - VWAP (teal solid line)
  - Chart features:
    - Zoom functionality (Ctrl+Scroll or Shift+Drag)
    - Pan functionality (click and drag)
    - Double-click to reset zoom
    - Initial view shows last 1 day of data
    - Custom tooltips showing OHLC values
    - Date labels below time axis
  - Back navigation to dashboard

### 5. API Endpoints
- **GET `/`**: Main dashboard page
- **GET `/ticker/<ticker>`**: Detail view for a specific ticker
  - Query parameter: `interval` (1Min or 5Min, default: 1Min)
- **GET `/api/ticker/<ticker>/<interval>`**: JSON API endpoint for chart data
  - Returns: labels (timestamps), prices, OHLC data, technical indicators
- **POST `/api/fetch-latest`**: Fetches latest data from Alpaca API
  - Returns: success status, records added, last timestamp

## Technical Requirements

### Dependencies
- Flask 3.0.0 (web framework)
- alpaca-trade-api 3.1.1 (Alpaca API client)
- pandas 2.1.3 (data processing)
- SQLite3 (database, built-in)

### Frontend Libraries
- Chart.js 4.4.0 (charting library)
- chartjs-adapter-date-fns 3.0.0 (date adapter)
- chartjs-plugin-zoom 2.0.1 (zoom/pan functionality)
- chartjs-chart-financial 0.2.1 (candlestick charts)
- Hammer.js 2.0.8 (touch gestures)

### Configuration
- Alpaca API credentials configured in `ingest_data.py` and `app.py`
- Uses Alpaca paper trading API endpoint
- IEX feed for data (free tier compatible)
- Rate limiting: 0.5 second delay between API calls

### Database Requirements
- SQLite database file: `stock_data.db`
- Automatic schema initialization on application startup
- Migration support for adding new columns
- Unique constraint prevents duplicate entries

## User Workflows

### Initial Setup
1. Install dependencies: `pip install -r requirements.txt`
2. Initialize database: `python database.py`
3. Ingest initial data: `python ingest_data.py`
4. Start web application: `python app.py`
5. Access dashboard at `http://localhost:5000`

### Daily Usage
1. View dashboard to see latest prices
2. Click on ticker row to view detailed charts
3. Switch between 1-minute and 5-minute intervals
4. Toggle technical indicators on/off
5. Use "Fetch Latest Data" button to update with new data
6. Interact with charts (zoom, pan, reset)

## Data Flow
1. **Initial Ingestion**: `ingest_data.py` → Alpaca API → Calculate Indicators → SQLite
2. **Incremental Update**: Web UI → `/api/fetch-latest` → Alpaca API → Calculate Indicators → SQLite
3. **Display**: SQLite → Flask Routes → JSON API → Chart.js → Interactive Charts

## Technical Indicators

### EMA (Exponential Moving Average)
- Calculated using pandas `ewm()` function
- Periods: 9, 21, 50
- Used for trend analysis

### VWAP (Volume Weighted Average Price)
- Calculated as cumulative: (typical_price × volume).cumsum() / volume.cumsum()
- Typical price = (high + low + close) / 3
- Used for intraday trading reference

## UI/UX Features
- Modern gradient design (purple/blue theme)
- Responsive layout
- Loading states and status messages
- Error handling with user-friendly messages
- Smooth transitions and hover effects
- Accessible color scheme and contrast

## Error Handling
- Graceful handling of missing data
- API error handling with user feedback
- Database error handling
- Timestamp parsing fallbacks
- Empty data set handling

## Performance Considerations
- Database indexing for fast queries
- Rate limiting for API calls
- Efficient data processing with pandas
- Chart rendering optimization
- Initial zoom to show recent data only

## Future Enhancement Opportunities
- Support for additional tickers
- Additional time intervals (15Min, 1Hour, 1Day)
- More technical indicators (RSI, MACD, Bollinger Bands)
- Real-time data streaming
- Historical data export
- User preferences/settings persistence
- Alert/notification system
- Portfolio tracking features

