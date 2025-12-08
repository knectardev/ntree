@echo off
setlocal
set VENV=.venv

echo ============================================================
echo Installing Dependencies for Stock Ticker Dashboard
echo ============================================================
echo.

if not exist "%VENV%\Scripts\python.exe" (
    echo Creating virtual environment at %VENV%...
    python -m venv "%VENV%"
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment
        pause
        exit /b 1
    )
)

call "%VENV%\Scripts\activate.bat"

echo Upgrading pip, setuptools, wheel...
python -m pip install --upgrade pip setuptools wheel
echo.

echo Installing Flask and core dependencies...
python -m pip install flask python-dotenv
echo.

echo Installing pandas and data processing libraries...
python -m pip install pandas pytz numpy
echo.

echo Installing aiohttp and dependencies (this may take a moment)...
python -m pip install --only-binary :all: aiohttp multidict yarl frozenlist 2>nul
if errorlevel 1 (
    echo Attempting to install aiohttp with build tools...
    python -m pip install aiohttp multidict yarl frozenlist
)
echo.

echo Installing alpaca-trade-api...
python -m pip install alpaca-trade-api
echo.

echo Installing remaining requirements...
python -m pip install scipy statsmodels pandas-ta
echo.

echo ============================================================
echo Verifying installation...
echo ============================================================
python -c "import flask; print('✓ Flask:', flask.__version__)"
python -c "import pandas; print('✓ pandas:', pandas.__version__)"
python -c "import alpaca_trade_api; print('✓ alpaca-trade-api: OK')"
python -c "import dotenv; print('✓ python-dotenv: OK')"
echo.

echo ============================================================
echo Installation complete!
echo ============================================================
echo.
echo You can now run: .\start.bat
echo.
pause
