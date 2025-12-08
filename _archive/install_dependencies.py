#!/usr/bin/env python
"""Install all dependencies for the project."""
import subprocess
import sys

def install_packages():
    """Install packages from requirements.txt."""
    print("=" * 60)
    print("Installing dependencies...")
    print("=" * 60)
    print(f"Python executable: {sys.executable}")
    print(f"Python version: {sys.version}")
    print()
    
    packages = [
        'flask==3.0.0',
        'alpaca-trade-api==3.1.1',
        'pandas==2.1.3',
        'pytz==2024.1',
        'numpy>=1.24.0',
        'scipy>=1.10.0',
        'statsmodels>=0.14.0'
    ]
    
    for package in packages:
        print(f"Installing {package}...")
        try:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', package])
            print(f"✓ {package} installed successfully")
        except subprocess.CalledProcessError as e:
            print(f"✗ Failed to install {package}: {e}")
        print()
    
    print("=" * 60)
    print("Verifying installations...")
    print("=" * 60)
    
    test_packages = ['flask', 'alpaca_trade_api', 'pandas', 'numpy', 'scipy', 'statsmodels']
    for pkg in test_packages:
        try:
            mod = __import__(pkg)
            version = getattr(mod, '__version__', 'unknown')
            print(f"✓ {pkg:20} - installed (version {version})")
        except ImportError:
            print(f"✗ {pkg:20} - NOT INSTALLED")
    
    print("=" * 60)

if __name__ == "__main__":
    install_packages()
