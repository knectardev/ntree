@echo off
setlocal
set VENV=.venv_new

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

echo Upgrading pip...
python -m pip install --upgrade pip
echo Installing requirements (including pandas-ta)...
python -m pip install -r requirements.txt

echo ------------------------------------------------------------
echo Launching app...
echo ------------------------------------------------------------
python app.py

endlocal
pause
