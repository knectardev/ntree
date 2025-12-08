#!/usr/bin/env python
"""
Hello World style confirmation script for predictive analytics packages.
Verifies that numpy, scipy, statsmodels, and pandas are installed and working.
"""

def check_packages():
    """Check if all required analytics packages are installed."""
    packages = {
        'numpy': 'NumPy',
        'scipy': 'SciPy',
        'statsmodels': 'Statsmodels',
        'pandas': 'Pandas'
    }
    
    print("=" * 60)
    print("Predictive Analytics Packages - Installation Check")
    print("=" * 60)
    print()
    
    all_installed = True
    
    for module_name, display_name in packages.items():
        try:
            mod = __import__(module_name)
            version = getattr(mod, '__version__', 'unknown')
            print(f"✓ {display_name:15} - INSTALLED (v{version})")
        except ImportError as e:
            print(f"✗ {display_name:15} - NOT INSTALLED")
            all_installed = False
    
    print()
    print("=" * 60)
    
    if all_installed:
        print("🎉 SUCCESS: All predictive analytics packages are ready!")
        print()
        print("You can now use:")
        print("  - pandas: time series + feature engineering")
        print("  - numpy: numeric operations")
        print("  - scipy: statistical functions")
        print("  - statsmodels: regressions with diagnostics")
        print("=" * 60)
        return True
    else:
        print("⚠️  WARNING: Some packages are missing.")
        print("   Run: pip install numpy scipy statsmodels")
        print("=" * 60)
        return False

if __name__ == "__main__":
    check_packages()
