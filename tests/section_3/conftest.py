"""
Shared pytest fixtures for Section 3 verification tests.

These tests exercise the production worker pipeline modules directly with
synthetic input. No real video processing, no live pipeline, no production DB.

The MongoDB-touching tests run against a SEPARATE database
(`roadsenseai_test_section3`) so production data is never touched. The DB is
dropped at the start of each MongoDB test so each test is hermetic.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# ── sys.path setup ──────────────────────────────────────────────────────────
# The worker package isn't installed; add its parent to sys.path so that
# `from pipeline.dbscan_consolidation import ...` works the same way the
# worker process imports them at runtime (worker_main.py does the same trick).
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
WORKER_DIR = PROJECT_ROOT / "worker"
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))


# ── MongoDB fixtures ────────────────────────────────────────────────────────
TEST_DB_NAME = "roadsenseai_test_section3"
TEST_MONGO_URL = os.environ.get("TEST_MONGODB_URL", "mongodb://localhost:27017")


def _can_reach_mongo(url: str) -> bool:
    try:
        import pymongo
        client = pymongo.MongoClient(url, serverSelectionTimeoutMS=1500)
        client.admin.command("ping")
        client.close()
        return True
    except Exception:
        return False


@pytest.fixture(scope="session")
def mongo_available() -> bool:
    return _can_reach_mongo(TEST_MONGO_URL)


@pytest.fixture
def test_db(mongo_available):
    """Per-test MongoDB database, dropped before and after each test."""
    if not mongo_available:
        pytest.skip(f"MongoDB unreachable at {TEST_MONGO_URL}")
    import pymongo
    client = pymongo.MongoClient(TEST_MONGO_URL, serverSelectionTimeoutMS=1500)
    client.drop_database(TEST_DB_NAME)
    db = client[TEST_DB_NAME]
    try:
        yield db
    finally:
        client.drop_database(TEST_DB_NAME)
        client.close()


@pytest.fixture
def mock_geocode(monkeypatch):
    """
    Replace _get_city in the event_persister module with a deterministic stub
    so tests don't depend on BigDataCloud's external API. Real geocoding is
    not in scope of Section 3 verification.
    """
    import pipeline.event_persister as ep
    monkeypatch.setattr(ep, "_get_city", lambda lat, lon: "TestZone")
