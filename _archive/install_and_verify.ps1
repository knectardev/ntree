# PowerShell script to install dependencies and verify installation
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Installing Dependencies for Stock Ticker Dashboard" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Check if venv exists
if (Test-Path ".\.venv\Scripts\python.exe") {
    Write-Host "Virtual environment found at .\.venv\" -ForegroundColor Green
    $pythonPath = ".\.venv\Scripts\python.exe"
    $pipPath = ".\.venv\Scripts\pip.exe"
} else {
    Write-Host "Warning: Virtual environment not found. Using system Python." -ForegroundColor Yellow
    $pythonPath = "python"
    $pipPath = "pip"
}

Write-Host ""
Write-Host "Python path: $pythonPath" -ForegroundColor Yellow
Write-Host "Pip path: $pipPath" -ForegroundColor Yellow
Write-Host ""

# Check Python version
Write-Host "Checking Python version..." -ForegroundColor Cyan
& $pythonPath --version
Write-Host ""

# Install packages
Write-Host "Installing packages from requirements.txt..." -ForegroundColor Cyan
& $pipPath install -r requirements.txt
Write-Host ""

# Verify installations
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Verifying Package Installations" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$packages = @('flask', 'alpaca_trade_api', 'pandas', 'numpy', 'scipy', 'statsmodels')

foreach ($pkg in $packages) {
    $result = & $pythonPath -c "try:
    import $pkg
    print('OK')
except:
    print('FAIL')" 2>&1
    
    if ($result -eq "OK") {
        $version = & $pythonPath -c "import $pkg; print($pkg.__version__)" 2>&1
        Write-Host "✓ $($pkg.PadRight(20)) - INSTALLED (version $version)" -ForegroundColor Green
    } else {
        Write-Host "✗ $($pkg.PadRight(20)) - NOT INSTALLED" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Installation Complete!" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To run the app, use:" -ForegroundColor Yellow
Write-Host "  & $pythonPath app.py" -ForegroundColor White
Write-Host ""
