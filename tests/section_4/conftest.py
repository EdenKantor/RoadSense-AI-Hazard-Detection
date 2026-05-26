"""
Shared sys.path setup for Section 4 backend tests.

Mirrors tests/section_1/conftest.py but prepends `backend/` instead of
`worker/` so `from app.services.gpx_validator import ...` resolves the same
way the running FastAPI app would.
"""
from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
