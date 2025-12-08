#!/usr/bin/env python
"""Test script to verify .env file loading"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Get the directory where this script is located
script_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(script_dir, '.env')

print("=" * 70)
print("Testing .env file loading")
print("=" * 70)
print(f"Script directory: {script_dir}")
print(f".env file path: {env_path}")
print(f".env file exists: {os.path.exists(env_path)}")
print()

if os.path.exists(env_path):
    print("File contents:")
    with open(env_path, 'r') as f:
        for line in f:
            if line.strip() and not line.strip().startswith('#'):
                # Mask the secret
                if 'SECRET' in line:
                    parts = line.split('=')
                    if len(parts) == 2:
                        print(f"  {parts[0]}=***{parts[1][-4:]}")
                else:
                    print(f"  {line.strip()}")
    print()

print("Loading .env file...")
load_dotenv(dotenv_path=env_path, override=True)
print()

api_key = os.getenv('ALPACA_API_KEY')
api_secret = os.getenv('ALPACA_API_SECRET')
base_url = os.getenv('ALPACA_BASE_URL', 'https://paper-api.alpaca.markets/v2')

print("Environment variables after loading:")
print(f"  ALPACA_API_KEY: {'SET (' + api_key[:10] + '...)' if api_key else 'NOT SET'}")
print(f"  ALPACA_API_SECRET: {'SET (***' + api_secret[-4:] + ')' if api_secret else 'NOT SET'}")
print(f"  ALPACA_BASE_URL: {base_url}")
print()

if api_key and api_secret:
    print("✓ SUCCESS: All API credentials are loaded!")
else:
    print("✗ ERROR: API credentials are missing!")
    print()
    print("Please ensure the .env file contains:")
    print("  ALPACA_API_KEY=your_key_here")
    print("  ALPACA_API_SECRET=your_secret_here")
    print("  ALPACA_BASE_URL=https://paper-api.alpaca.markets/v2")

print("=" * 70)
