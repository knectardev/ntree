@echo off
setlocal
set VENV=.venv

echo ------------------------------------------------------------
echo Starting Stock Ticker Dashboard
echo Using environment: %VENV%
echo ------------------------------------------------------------

if not exist "%VENV%\Scripts\python.exe" (
    echo Virtual env not found. Creating at %VENV% ...
    py -3 -m venv "%VENV%" || python -m venv "%VENV%"
    if errorlevel 1 (
        echo Failed to create virtual environment. Make sure Python 3 is installed and in PATH.
        pause
        exit /b 1
    )
)

call "%VENV%\Scripts\activate.bat"
if errorlevel 1 (
    echo Failed to activate virtual environment.
    pause
    exit /b 1
)

echo Upgrading pip, setuptools, and wheel...
python -m pip install --upgrade pip setuptools wheel
echo.
echo Installing core dependencies first...
python -m pip install flask python-dotenv
python -m pip install pandas pytz
echo.
echo Installing aiohttp dependencies (may take a moment)...
python -m pip install --only-binary :all: aiohttp multidict yarl frozenlist 2>nul || python -m pip install aiohttp multidict yarl frozenlist
echo.
echo Installing alpaca-trade-api...
python -m pip install alpaca-trade-api
echo.
echo Installing remaining requirements...
python -m pip install -r requirements.txt
echo.
echo Verifying critical packages...
python -c "import flask; import alpaca_trade_api; import pandas; import dotenv; print('✓ All critical packages installed successfully!')" || echo "⚠ Warning: Some packages may not have installed correctly"

echo ------------------------------------------------------------
echo Launching app...
echo ------------------------------------------------------------
python app.py

endlocal
pause
