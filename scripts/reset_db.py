"""
Reset the RoadSenseAI database back to factory-fresh.

Phases (all idempotent):
    1. Confirmation gate         — prompts unless ``--yes`` is passed.
    2. Drop every Mongo collection.
    3. Clear stale Redis RQ keys (worker registrations, queue, failed jobs).
    4. Purge uploads/ and output/ subdirs (but keep uploads/avatars/).
    5. Recreate indexes           — subprocess to scripts/create_indexes.py.
    6. Recreate admin user        — subprocess to scripts/create_admin.py.
    7. Print summary.

Usage (from project root, after scripts/start.ps1 is running):
    .\\backend\\venv\\Scripts\\python.exe scripts\\reset_db.py            # interactive
    .\\backend\\venv\\Scripts\\python.exe scripts\\reset_db.py --yes      # no prompt
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Pull config from the backend so paths / URIs match the running platform.
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(HERE))  # for _demo_helpers import

from app.config import settings as backend_settings  # noqa: E402
from _demo_helpers import load_backend_env  # noqa: E402

from pymongo import MongoClient  # noqa: E402
import redis  # noqa: E402

# Resolve runtime URLs from backend/.env, with the pydantic Settings
# defaults as a defence-in-depth fallback. Defends against the case where
# the backend's .env has been re-pointed at a different Mongo / Redis
# than the class defaults assume (today: Redis is on :6380 in .env but
# :6379 in the default).
_env = load_backend_env(BACKEND_DIR)
REDIS_URL = _env.get("REDIS_URL")    or backend_settings.redis_url
MONGO_URL = _env.get("MONGODB_URL")  or backend_settings.mongodb_url
DB_NAME   = _env.get("MONGODB_DB_NAME") or backend_settings.mongodb_db_name


# Filesystem locations (resolved relative to PROJECT_ROOT — settings has
# relative paths like "../uploads" because the backend runs from
# `backend/`, so we re-anchor here).
UPLOADS_DIR = PROJECT_ROOT / "uploads"
OUTPUT_DIR = PROJECT_ROOT / "output"
AVATARS_SUBDIR = "avatars"  # preserved across resets


def _ok(msg: str) -> None:  print(f"[reset] OK   {msg}")
def _info(msg: str) -> None: print(f"[reset]      {msg}")
def _warn(msg: str) -> None: print(f"[reset] WARN {msg}")
def _step(msg: str) -> None: print(f"\n[reset] === {msg} ===")


# ---------------------------------------------------------------------------
# Phase 1 — confirmation gate
# ---------------------------------------------------------------------------
def confirm(auto_yes: bool) -> bool:
    if auto_yes:
        return True
    print("[reset] About to wipe the entire RoadSenseAI database and all uploads.")
    print(f"[reset]   Mongo URL: {MONGO_URL}")
    print(f"[reset]   DB name:   {DB_NAME}")
    print(f"[reset]   Uploads:   {UPLOADS_DIR} (avatars/ preserved)")
    print(f"[reset]   Output:    {OUTPUT_DIR}")
    answer = input("[reset] Type WIPE to confirm: ").strip()
    return answer == "WIPE"


# ---------------------------------------------------------------------------
# Phase 2 — drop Mongo collections
# ---------------------------------------------------------------------------
def drop_collections(db) -> tuple[int, list[str]]:
    """Return (count, names) of dropped collections."""
    names = sorted(n for n in db.list_collection_names() if not n.startswith("system."))
    for name in names:
        db.drop_collection(name)
        _info(f"  dropped {name}")
    return (len(names), names)


# ---------------------------------------------------------------------------
# Phase 3 — clear Redis RQ keys
# ---------------------------------------------------------------------------
def clear_redis_rq() -> dict[str, int]:
    """Best-effort cleanup of RQ artifacts. Never raises."""
    result = {"workers_deleted": 0, "queue_keys_deleted": 0}
    try:
        r = redis.Redis.from_url(REDIS_URL, socket_connect_timeout=2)
        r.ping()
    except Exception as exc:
        _warn(f"  Redis unreachable ({exc}); skipping RQ key cleanup")
        return result

    try:
        for n in (1, 2, 3):
            result["workers_deleted"] += int(r.delete(f"rq:worker:worker-{n}"))
        r.srem("rq:workers", "worker-1", "worker-2", "worker-3")

        # Best-effort: drop the queue itself and any failed-job registry.
        for key in ("rq:queue:roadsense", "rq:failed:roadsense", "rq:queue:default"):
            result["queue_keys_deleted"] += int(r.delete(key))
        _info(f"  Redis: {result['workers_deleted']} worker keys, "
              f"{result['queue_keys_deleted']} queue keys cleared")
    except Exception as exc:
        _warn(f"  Redis cleanup partial: {exc}")
    return result


# ---------------------------------------------------------------------------
# Phase 4 — purge filesystem
# ---------------------------------------------------------------------------
def purge_dir(root: Path, preserve_subdir: str | None = None) -> int:
    """Remove every immediate child of ``root`` except ``preserve_subdir``.

    Returns the number of items removed. Missing root → 0.
    """
    if not root.exists():
        return 0
    removed = 0
    for child in root.iterdir():
        if preserve_subdir and child.name == preserve_subdir:
            _info(f"  preserved {child}")
            continue
        try:
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink(missing_ok=True)
            removed += 1
        except Exception as exc:
            _warn(f"  could not remove {child}: {exc}")
    return removed


# ---------------------------------------------------------------------------
# Phase 5/6 — invoke sibling scripts
# ---------------------------------------------------------------------------
def run_subscript(name: str) -> int:
    """Run scripts/<name> with the current Python interpreter. Returns exit code."""
    script_path = HERE / name
    if not script_path.exists():
        _warn(f"  {name} not found at {script_path}; skipping")
        return 1
    # Use cwd=PROJECT_ROOT so the sibling script's relative paths
    # (e.g., create_admin's import-from-backend) resolve identically.
    proc = subprocess.run(
        [sys.executable, str(script_path)],
        cwd=str(PROJECT_ROOT),
    )
    return proc.returncode


# ---------------------------------------------------------------------------
# Phase 7 — summary
# ---------------------------------------------------------------------------
def print_summary(db) -> None:
    _step("Summary")
    collections = sorted(n for n in db.list_collection_names() if not n.startswith("system."))
    if not collections:
        _info("  No collections present.")
    else:
        for name in collections:
            count = db[name].estimated_document_count()
            _info(f"  {name:30s} {count:>5d} docs")
    _info("")
    _info(f"  uploads/  subdirs: {_count_subdirs(UPLOADS_DIR)} "
          f"(avatars/: {'present' if (UPLOADS_DIR / AVATARS_SUBDIR).exists() else 'absent'})")
    _info(f"  output/   subdirs: {_count_subdirs(OUTPUT_DIR)}")


def _count_subdirs(root: Path) -> int:
    if not root.exists():
        return 0
    return sum(1 for child in root.iterdir() if child.is_dir())


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description="Wipe the RoadSenseAI database.")
    parser.add_argument("--yes", action="store_true",
                        help="Skip the WIPE confirmation prompt (for CI / scripted use).")
    args = parser.parse_args()

    if not confirm(args.yes):
        print("[reset] Aborted (confirmation not given).")
        return 1

    _step("Phase 2: Drop Mongo collections")
    try:
        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
    except Exception as exc:
        print(f"[reset] ERROR: cannot reach MongoDB at {MONGO_URL}: {exc}")
        print("[reset] Is scripts/start.ps1 running? (docker compose must be up.)")
        return 1
    db = client[DB_NAME]
    dropped_count, _names = drop_collections(db)
    _ok(f"Dropped {dropped_count} collection(s).")

    _step("Phase 3: Clear Redis RQ keys")
    clear_redis_rq()
    _ok("Redis cleanup attempted.")

    _step("Phase 4: Purge uploads/ + output/")
    removed_uploads = purge_dir(UPLOADS_DIR, preserve_subdir=AVATARS_SUBDIR)
    removed_output = purge_dir(OUTPUT_DIR, preserve_subdir=None)
    _ok(f"Removed {removed_uploads} item(s) from uploads/, "
        f"{removed_output} from output/.")

    _step("Phase 5: Recreate indexes")
    rc = run_subscript("create_indexes.py")
    if rc != 0:
        _warn(f"create_indexes.py exited {rc} — continuing")
    else:
        _ok("Indexes recreated.")

    _step("Phase 6: Recreate admin user")
    rc = run_subscript("create_admin.py")
    if rc != 0:
        _warn(f"create_admin.py exited {rc} — continuing")
    else:
        _ok("Admin user ready.")

    print_summary(db)

    print("\n[reset] === RESET COMPLETE ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
