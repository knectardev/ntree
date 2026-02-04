"""
Unified Server Entry Point
==========================
Combines the ntree Flask dashboard with the Market Inventions FastAPI engine.

Usage:
    cd c:\local_dev\ntree
    uvicorn run_unified:app --port 8001 --reload

Routes:
    /                       -> Flask (ntree dashboard)
    /market_inventions/     -> FastAPI (Market Inventions music engine)
"""
import sys
import os

# 1. Add current directory to path so we can find app.py and market_inventions_port
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 2. Import the FastAPI app first (it will be the primary server)
from market_inventions_port.main import app as fastapi_app

# 3. Import the Flask app
from app import app as flask_app

# 4. Mount Flask into FastAPI using WSGIMiddleware
# This allows Flask to handle all routes not captured by FastAPI
from fastapi.middleware.wsgi import WSGIMiddleware
fastapi_app.mount("/", WSGIMiddleware(flask_app))

# 5. Export the unified app for uvicorn
app = fastapi_app
