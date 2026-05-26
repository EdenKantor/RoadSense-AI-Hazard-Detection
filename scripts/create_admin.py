"""
Bootstrap an initial Admin user in MongoDB.

Use this when the database has been freshly created (or wiped, e.g. via
`scripts/stop.ps1 -RemoveVolumes`) and you need an Admin account to log in -
the frontend does NOT allow self-registration as Admin.

Usage (from project root, after scripts/start.ps1 is running):

    .\backend\venv\Scripts\python.exe scripts\create_admin.py

    # Then log in via the frontend with:
    #   email:    admin@roadsenseai.local
    #   password: admin123456

This script is idempotent - re-running it after the admin already exists is
safe and exits cleanly without modifying the existing user.

For development/demo only. In production, change the password immediately
after first login.
"""
from __future__ import annotations

import sys
import uuid
from pathlib import Path


# ---------------------------------------------------------------------------
# Reuse the backend's user-doc factory so the inserted document matches the
# schema the backend expects exactly. Done before third-party imports because
# bcrypt + pymongo are imported transitively below.
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.models.user import UserRole, new_user_doc  # noqa: E402

import bcrypt  # noqa: E402
from pymongo import MongoClient  # noqa: E402


ADMIN_EMAIL = "admin@roadsenseai.local"
ADMIN_PASSWORD = "admin123456"
ADMIN_FULL_NAME = "Default Admin"

DEFAULT_MONGO_URL = "mongodb://localhost:27017"
DEFAULT_DB_NAME = "roadsenseai"


def parse_env_file(path: Path) -> dict[str, str]:
    """Minimal .env parser - no python-dotenv dependency."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def resolve_mongo_settings() -> tuple[str, str]:
    """Read MONGODB_URL / MONGODB_DB_NAME from backend/.env, fall back to defaults."""
    env = parse_env_file(BACKEND_DIR / ".env")
    url = env.get("MONGODB_URL") or DEFAULT_MONGO_URL
    db_name = env.get("MONGODB_DB_NAME") or DEFAULT_DB_NAME
    return url, db_name


def hash_password(plain: str) -> str:
    """Mirror of backend.app.services.auth_service.hash_password."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def main() -> int:
    mongo_url, db_name = resolve_mongo_settings()
    print(f"[create_admin] Connecting to {mongo_url} (db={db_name})")

    client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
    try:
        client.admin.command("ping")
    except Exception as exc:  # pymongo raises ServerSelectionTimeoutError etc.
        print(f"[create_admin] ERROR: cannot reach MongoDB: {exc}")
        print("[create_admin] Is scripts/start.ps1 running? (compose must be up.)")
        return 1

    users = client[db_name]["users"]

    existing = users.find_one({"email": ADMIN_EMAIL})
    if existing is not None:
        print(
            f"[create_admin] Admin already exists "
            f"(_id={existing['_id']}, role={existing.get('role')}). Nothing to do."
        )
        return 0

    user_id = str(uuid.uuid4())
    doc = new_user_doc(
        user_id=user_id,
        email=ADMIN_EMAIL,
        hashed_password=hash_password(ADMIN_PASSWORD),
        full_name=ADMIN_FULL_NAME,
        role=UserRole.Admin,
    )

    users.insert_one(doc)

    print("[create_admin] Admin user created.")
    print(f"  _id:      {user_id}")
    print(f"  email:    {ADMIN_EMAIL}")
    print(f"  password: {ADMIN_PASSWORD}    (change after first login)")
    print(f"  role:     {doc['role']}")
    print(f"  active:   {doc['is_active']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
