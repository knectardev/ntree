#!/usr/bin/env python
"""Test if the Flask app can start without errors."""
import sys
import traceback

print("="*70)
print("Testing Flask App Startup...")
print("="*70)
print()

try:
    print("Step 1: Testing imports...")
    from flask import Flask
    print("  ✓ Flask")
    
    from database import get_db_connection, init_database
    print("  ✓ database module")
    
    import pandas as pd
    print("  ✓ pandas")
    
    try:
        import numpy as np
        print("  ✓ numpy (optional)")
    except:
        print("  ⚠ numpy not installed (optional)")
    
    try:
        import scipy
        print("  ✓ scipy (optional)")
    except:
        print("  ⚠ scipy not installed (optional)")
    
    try:
        import statsmodels.api as sm
        print("  ✓ statsmodels (optional)")
    except:
        print("  ⚠ statsmodels not installed (optional)")
    
    from utils import calculate_vwap_per_trading_day
    print("  ✓ utils module")
    
    import alpaca_trade_api as tradeapi
    print("  ✓ alpaca_trade_api")
    
    print()
    print("Step 2: Importing app.py...")
    import app
    print("  ✓ app.py imported")
    
    print()
    print("Step 3: Testing database initialization...")
    try:
        init_database()
        print("  ✓ Database initialized")
    except Exception as e:
        print(f"  ⚠ Database init warning: {e}")
    
    print()
    print("Step 4: Checking Flask app object...")
    print(f"  ✓ Flask app created: {app.app}")
    print(f"  ✓ Debug mode: {app.app.debug}")
    
    print()
    print("Step 5: Testing routes...")
    with app.app.app_context():
        routes = list(app.app.url_map.iter_rules())
        print(f"  ✓ Found {len(routes)} routes:")
        for route in routes[:10]:  # Show first 10
            methods = ','.join([m for m in route.methods if m not in ['HEAD', 'OPTIONS']])
            print(f"    {methods:15} {route}")
    
    print()
    print("="*70)
    print("✓ ALL TESTS PASSED - App should start successfully!")
    print("="*70)
    print()
    print("To start the server, run: python app.py")
    print()
    
except Exception as e:
    print()
    print("="*70)
    print("✗ ERROR - App cannot start!")
    print("="*70)
    print(f"Error: {e}")
    print()
    print("Full traceback:")
    traceback.print_exc()
    sys.exit(1)
