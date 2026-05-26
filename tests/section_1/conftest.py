"""
Shared sys.path setup for Section 1 unit tests.

Mirrors tests/section_3/conftest.py: prepends `worker/` to sys.path so that
`from config import settings` and `from pipeline.severity_heuristic import ...`
resolve the same way the running worker would.
"""
from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
WORKER_DIR = PROJECT_ROOT / "worker"
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))
