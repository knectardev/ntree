@echo off
setlocal

echo ============================================================
echo  NUCLEAR FIX SCRIPT (RELAXED VERSIONS)
echo ============================================================

REM Define new venv name
set NEW_VENV=.venv_new

echo.
echo 1. Creating fresh virtual environment (%NEW_VENV%)...
if exist "%NEW_VENV%" (
    echo Removing old %NEW_VENV%...
    rmdir /s /q "%NEW_VENV%"
)
python -m venv %NEW_VENV%

REM Define paths for the new venv
set VENV_PYTHON=%~dp0%NEW_VENV%\Scripts\python.exe
set VENV_PIP=%~dp0%NEW_VENV%\Scripts\pip.exe

if not exist "%VENV_PYTHON%" (
    echo CRITICAL ERROR: Failed to create virtual environment.
    pause
    exit /b 1
)

echo.
echo 2. Upgrading pip...
"%VENV_PYTHON%" -m pip install --upgrade pip

echo.
echo 3. Installing dependencies (Latest versions)...
REM Removing strict version pins to allow finding wheels for newer Python versions
"%VENV_PIP%" install flask alpaca-trade-api pandas pytz numpy scipy statsmodels
if %errorlevel% neq 0 (
    echo ERROR: Installation failed.
    pause
    exit /b 1
)

echo.
echo 4. Verifying installation...
"%VENV_PYTHON%" -c "import flask; print(f'Flask installed: {flask.__version__}')"
"%VENV_PYTHON%" -c "import pandas; print(f'Pandas installed: {pandas.__version__}')"

echo.
echo 5. Starting App...
echo ============================================================
"%VENV_PYTHON%" app.py

pause
