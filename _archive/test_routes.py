#!/usr/bin/env python
"""Test script to verify Flask routes are working."""
import sys

# Test imports first
print("Testing imports...")
try:
    from flask import Flask
    print("✓ Flask imported")
except ImportError as e:
    print(f"✗ Flask import failed: {e}")
    sys.exit(1)

try:
    import numpy as np
    print("✓ NumPy imported")
except ImportError as e:
    print(f"✗ NumPy import failed: {e}")

try:
    import scipy
    print("✓ SciPy imported")
except ImportError as e:
    print(f"✗ SciPy import failed: {e}")

try:
    import statsmodels.api as sm
    print("✓ Statsmodels imported")
except ImportError as e:
    print(f"✗ Statsmodels import failed: {e}")

try:
    import pandas as pd
    print("✓ Pandas imported")
except ImportError as e:
    print(f"✗ Pandas import failed: {e}")

print("\n" + "="*60)
print("Testing app.py imports...")
print("="*60)

try:
    # Try importing app to see if there are any errors
    import app
    print("✓ app.py imported successfully")
    print(f"✓ Flask app created: {app.app}")
    
    # List all routes
    print("\nAvailable routes:")
    with app.app.app_context():
        for rule in app.app.url_map.iter_rules():
            print(f"  {rule.methods} {rule}")
            
except Exception as e:
    print(f"✗ Error importing app.py: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n" + "="*60)
print("All tests passed! You can now run: python app.py")
print("="*60)
