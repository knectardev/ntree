# Stock Ticker Dashboard - Requirements

## Overview
A Python-based web application for displaying real-time stock ticker data for SPY and QQQ using the Alpaca API. The application provides a dashboard interface with interactive charts, technical indicators, trading strategy signals, backtesting capabilities, and incremental data updates.

## Core Functionality

### 1. Data Storage
- **Database**: SQLite database (`stock_data.db`)
- **Schema**: 
  - Stores OHLC (Open, High, Low, Close) price data
  - Volume information
  - Technical indicators: EMA 9, EMA 21, EMA 50, VWAP (both Alpaca-imported and pandas_ta calculated)
  - MACD and MACD Signal (pandas_ta calculated)
  - Supports multiple intervals (1-minute and 5-minute)
  - Unique constraint on (ticker, timestamp, interval)
  - Indexed for efficient queries on (ticker, interval, timestamp)

### 2. Data Ingestion
- **Initial Data Load**: 
  - Fetches last 5 days of historical data for SPY and QQQ
  - Supports 1-minute and 5-minute intervals
  - Uses Alpaca API IEX feed (free tier compatible)
  - Calculates technical indicators during ingestion:
    - EMA 9, EMA 21, EMA 50 (both pandas ewm() and pandas_ta)
    - VWAP (anchored per trading day, resets at market open)
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
  - "Package POC" button to verify analytics packages installation
  - Clickable rows to navigate to detailed ticker views
  - Responsive design with modern gradient UI

### 4. Detail View
- **Ticker Detail Page (`/ticker/<ticker>`)**:
  - Interactive candlestick charts using Chart.js
  - Interval selector (1-minute and 5-minute views)
  - Toggleable technical indicators:
    - **Alpaca imported indicators**: EMA 9, EMA 21, EMA 50, VWAP
    - **Pandas calculated indicators**: EMA 9, EMA 21, EMA 50, VWAP, MACD + Signal
  - MACD sub-chart display
  - Market hours visualization (regular, pre-market, after-hours, closed)
  - VWAP anchor points marked with green dots at market opens
  - Strategy signal markers on chart
  - Chart features:
    - Zoom functionality (mouse wheel or Shift+Drag)
    - Pan functionality (click and drag)
    - Double-click to reset zoom
    - Crosshair with price and time display
    - Initial view shows last 1 day of data
    - Custom tooltips showing OHLC values and strategy entry details
    - Date labels below time axis
  - Strategy backtesting interface:
    - Strategy selector dropdown
    - Run backtest button
    - Display of backtest results (trades, win rate, avg return, median return)
  - Back navigation to dashboard

### 5. Trading Strategies
- **EMA + VWAP Pullback (v1.3)**:
  - Trend filter: EMA21 > VWAP and EMA21 slope > 0
  - Pullback: at least 2 of last 3 bars closed below EMA9
  - Entry: close crosses up through EMA9
  - Throttle: at most one entry every 20 bars
  - Session: Regular Trading Hours (RTH) only
- **VWAP Cross-over (v1)**:
  - Intersection: VWAP crosses down from above both EMA9 and EMA21
  - Follow-through: EMA9, EMA21, and VWAP slopes positive for at least 8 bars
  - Entry at next bar open
  - Session: RTH only
- **VWAP / EMA Crossover (v1)**:
  - Marks every intersection between VWAP and EMA21
  - Session: All sessions (including off-hours)
  - Direction indicators (bullish/bearish)

### 6. Backtesting
- Simple backtest engine:
  - Enter at next bar open
  - Exit at same-bar close (toy implementation)
  - Configurable fee basis points
  - Metrics: number of trades, win rate, average return, median return

### 7. API Endpoints
- **GET `/`**: Main dashboard page
- **GET `/ticker/<ticker>`**: Detail view for a specific ticker
  - Query parameter: `interval` (1Min or 5Min, default: 1Min)
- **GET `/api/ticker/<ticker>/<interval>`**: JSON API endpoint for chart data
  - Returns: labels (timestamps), prices, OHLC data, technical indicators, market hours info, strategy signals
- **POST `/api/fetch-latest`**: Fetches latest data from Alpaca API
  - Returns: success status, records added, last timestamp
- **POST `/api/strategy/<name>/backtest`**: Run backtest for a strategy
  - Request body: `{ticker, interval, fee_bp}`
  - Returns: strategy name, ticker, interval, metrics, number of bars, generated timestamp
- **GET `/package-proof-of-concept`**: Package verification page
  - Demonstrates numpy, scipy, statsmodels, pandas functionality
  - Shows package versions and sample calculations

## Technical Requirements

### Python Dependencies
- **Flask 3.0.0** (web framework)
- **alpaca-trade-api 3.1.1** (Alpaca API client)
- **pandas >= 2.2.3** (data processing and analysis)
- **pytz 2024.1** (timezone handling)
- **numpy >= 1.24.0** (numerical computing, optional for analytics)
- **scipy >= 1.10.0** (scientific computing, optional for analytics)
- **statsmodels >= 0.14.0** (statistical modeling, optional for analytics)
- **pandas-ta 0.4.71b0** (technical analysis indicators)
- **SQLite3** (database, built-in Python module)

### Frontend Libraries (CDN)
- **Chart.js 4.4.0** (charting library)
- **chartjs-adapter-date-fns 3.0.0** (date adapter for Chart.js)
- **chartjs-plugin-zoom 2.0.1** (zoom/pan functionality)
- **chartjs-chart-financial 0.2.1** (candlestick charts)
- **Hammer.js 2.0.8** (touch gestures for mobile support)

### Configuration
- Alpaca API credentials configured in `ingest_data.py` and `app.py`
- Uses Alpaca paper trading API endpoint
- IEX feed for data (free tier compatible)
- Rate limiting: 0.5 second delay between API calls
- Market hours: Regular Trading Hours (9:30 AM - 4:00 PM ET)
- VWAP calculation: Anchored per trading day, resets at market open (9:30 AM ET)

### Database Requirements
- SQLite database file: `stock_data.db`
- Automatic schema initialization on application startup
- Migration support for adding new columns
- Unique constraint prevents duplicate entries
- Indexed for efficient queries on (ticker, interval, timestamp)

## User Workflows

### Initial Setup
1. Install dependencies: `pip install -r requirements.txt`
2. Initialize database: `python database.py` (or automatic on app startup)
3. Ingest initial data: `python ingest_data.py`
4. Start web application: `python app.py`
5. Access dashboard at `http://localhost:5000`
6. Verify packages: Visit `http://localhost:5000/package-proof-of-concept`

### Daily Usage
1. View dashboard to see latest prices
2. Click on ticker row to view detailed charts
3. Switch between 1-minute and 5-minute intervals
4. Toggle technical indicators on/off (Alpaca imported vs pandas calculated)
5. View MACD sub-chart
6. Select and run trading strategy backtests
7. Use "Fetch Latest Data" button to update with new data
8. Interact with charts (zoom, pan, reset, crosshair)

## Data Flow
1. **Initial Ingestion**: `ingest_data.py` → Alpaca API → Calculate Indicators → SQLite
2. **Incremental Update**: Web UI → `/api/fetch-latest` → Alpaca API → Calculate Indicators → SQLite
3. **Display**: SQLite → Flask Routes → JSON API → Chart.js → Interactive Charts
4. **Strategy Signals**: Price Data → Strategy Functions → Signal Markers on Chart
5. **Backtesting**: Price Data + Strategy Signals → Backtest Engine → Performance Metrics

## Technical Indicators

### EMA (Exponential Moving Average)
- Calculated using pandas `ewm()` function and pandas_ta library
- Periods: 9, 21, 50
- Used for trend analysis
- Stored separately for Alpaca-imported and pandas_ta-calculated versions

### VWAP (Volume Weighted Average Price)
- Calculated per trading day, anchored at market open (9:30 AM ET)
- Resets each trading day
- Typical price = (high + low + close) / 3
- Used for intraday trading reference
- Handles pre-market, regular hours, and after-hours data

### MACD (Moving Average Convergence Divergence)
- Calculated using pandas_ta library
- MACD line and Signal line
- Displayed in separate sub-chart below main price chart

## Market Hours Detection
- **Regular Trading Hours**: 9:30 AM - 4:00 PM ET
- **Pre-Market**: 4:00 AM - 9:30 AM ET
- **After-Hours**: 4:00 PM - 8:00 PM ET
- **Closed**: 8:00 PM - 4:00 AM ET
- Visual shading on charts to indicate market session type
- VWAP resets at market open (9:30 AM ET)

## UI/UX Features
- Modern gradient design (purple/blue theme)
- Responsive layout with full-width chart support
- Loading states and status messages
- Error handling with user-friendly messages
- Smooth transitions and hover effects
- Accessible color scheme and contrast
- Interactive crosshair with price/time display
- Market hours legend
- Strategy parameter and result cards
- Volume bars with color coding (green/red based on price movement)

## Error Handling
- Graceful handling of missing data
- API error handling with user feedback
- Database error handling
- Timestamp parsing fallbacks
- Empty data set handling
- Optional package imports (numpy, scipy, statsmodels) - app works without them
- Fallback indicator calculations when pandas_ta unavailable

## Performance Considerations
- Database indexing for fast queries
- Rate limiting for API calls
- Efficient data processing with pandas
- Chart rendering optimization
- Initial zoom to show recent data only
- Lazy loading of strategy signals
- On-demand indicator calculation when missing from database

## Analytics Package Support
- Optional packages (numpy, scipy, statsmodels) for advanced analytics
- Package verification page to test installations
- Graceful degradation when packages unavailable
- Future-ready for advanced statistical analysis and modeling

## Future Enhancement Opportunities
- Support for additional tickers
- Additional time intervals (15Min, 1Hour, 1Day)
- More technical indicators (RSI, Bollinger Bands, Stochastic)
- Real-time data streaming via WebSockets
- Historical data export (CSV, JSON)
- User preferences/settings persistence
- Alert/notification system
- Portfolio tracking features
- Advanced backtesting with position sizing and risk management
- Strategy optimization and parameter tuning
- Paper trading simulation
- Performance analytics and reporting

