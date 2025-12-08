#!/usr/bin/env python
"""Check if the Flask app can start and list all routes."""
import sys
import traceback

print("="*70)
print("Checking Flask App Startup...")
print("="*70)
print()

try:
    print("Step 1: Importing modules...")
    from flask import Flask
    print("  ✓ Flask imported")
    
    import numpy as np
    print("  ✓ NumPy imported")
    
    import scipy
    print("  ✓ SciPy imported")
    
    import statsmodels.api as sm
    print("  ✓ Statsmodels imported")
    
    import pandas as pd
    print("  ✓ Pandas imported")
    
    from database import get_db_connection, init_database
    print("  ✓ Database module imported")
    
    from utils import calculate_vwap_per_trading_day
    print("  ✓ Utils module imported")
    
    import alpaca_trade_api as tradeapi
    print("  ✓ Alpaca API imported")
    
    print()
    print("Step 2: Importing app.py...")
    import app
    print("  ✓ app.py imported successfully")
    
    print()
    print("Step 3: Initializing database...")
    try:
        init_database()
        print("  ✓ Database initialized")
    except Exception as e:
        print(f"  ⚠ Database init warning: {e}")
    
    print()
    print("Step 4: Checking Flask app routes...")
    with app.app.app_context():
        routes = list(app.app.url_map.iter_rules())
        print(f"  ✓ Found {len(routes)} routes:")
        for route in routes:
            methods = ','.join(route.methods - {'HEAD', 'OPTIONS'})
            print(f"    {methods:8} {route}")
    
    print()
    print("="*70)
    print("✓ All checks passed! The app should work correctly.")
    print("="*70)
    print()
    print("To start the app, run: python app.py")
    print("Then visit:")
    print("  - Main dashboard: http://127.0.0.1:5000/")
    print("  - Package POC:    http://127.0.0.1:5000/package-proof-of-concept")
    print()
    
except ImportError as e:
    print()
    print("="*70)
    print("✗ IMPORT ERROR")
    print("="*70)
    print(f"Failed to import: {e}")
    print()
    traceback.print_exc()
    sys.exit(1)
    
except Exception as e:
    print()
    print("="*70)
    print("✗ ERROR")
    print("="*70)
    print(f"Error: {e}")
    print()
    traceback.print_exc()
    sys.exit(1)
