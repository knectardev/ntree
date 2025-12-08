@echo off
setlocal

echo ============================================================
echo  FIX AND RUN SCRIPT
echo ============================================================

REM Set absolute paths
set VENV_PYTHON=%~dp0.venv\Scripts\python.exe
set VENV_PIP=%~dp0.venv\Scripts\pip.exe

echo Checking paths...
if exist "%VENV_PYTHON%" (
    echo Found venv python at: %VENV_PYTHON%
) else (
    echo ERROR: Virtual environment not found at %VENV_PYTHON%
    echo Please run: python -m venv .venv
    pause
    exit /b 1
)

echo.
echo Installing requirements using venv pip...
"%VENV_PIP%" install -r requirements.txt
if %errorlevel% neq 0 (
    echo Warning: Pip install returned error code %errorlevel%
)

echo.
echo Verifying Flask installation...
"%VENV_PYTHON%" -c "import flask; print(f'Flask is installed: {flask.__version__}')"

echo.
echo Starting App...
"%VENV_PYTHON%" app.py

pause
