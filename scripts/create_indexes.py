"""
Create MongoDB indexes for production-quality query performance.

This script is idempotent - it can be run multiple times safely.
Run after fresh DB setup or when adding new indexes.

Usage:
    cd <project_root>
    .\backend\venv\Scripts\python.exe scripts\create_indexes.py
"""

import asyncio
import os
import sys
from motor.motor_asyncio import AsyncIOMotorClient

# Ensure backend is in path so we can import settings
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.config import settings


async def create_indexes():
    client = AsyncIOMotorClient(settings.mongodb_url)
    db = client[settings.mongodb_db_name]

    indexes_to_create = [
        # users
        ("users", [("email", 1)], {"unique": True, "name": "email_unique"}),
        ("users", [("role", 1), ("is_active", 1)], {"name": "role_active"}),

        # uploads
        ("uploads", [("uploader_id", 1)], {"name": "uploader_lookup"}),
        ("uploads", [("status", 1)], {"name": "status_filter"}),
        ("uploads", [("created_at", -1)], {"name": "created_recent"}),

        # pothole_events
        ("pothole_events", [("upload_id", 1)], {"name": "upload_lookup"}),
        ("pothole_events", [("zone", 1)], {"name": "zone_filter"}),
        ("pothole_events", [("lifecycle_status", 1)], {"name": "status_filter"}),
        ("pothole_events", [("assigned_to", 1)], {"name": "assignee_filter"}),
        # Note: location 2dsphere is created by event_persister.py at runtime

        # event_status_history
        ("event_status_history", [("event_id", 1)], {"name": "event_lookup"}),
        ("event_status_history", [("changed_at", -1)], {"name": "history_recent"}),

        # authority_profiles
        ("authority_profiles", [("user_id", 1)], {"name": "user_lookup"}),
        ("authority_profiles", [("approval_status", 1)], {"name": "approval_filter"}),

        # support_tickets
        ("support_tickets", [("created_by_user_id", 1)], {"name": "author_lookup"}),
        ("support_tickets", [("target_team_type", 1), ("assigned_official_user_id", 1)], {"name": "official_routing"}),
        ("support_tickets", [("target_team_type", 1), ("assigned_admin_user_id", 1)], {"name": "admin_routing"}),

        # teams
        ("teams", [("member_ids", 1)], {"name": "member_lookup"}),
        ("teams", [("zone_id", 1)], {"name": "zone_lookup"}),

        # zones
        ("zones", [("name", 1)], {"unique": True, "name": "name_unique"}),

        # notifications_read
        ("notifications_read", [("user_id", 1)], {"name": "user_lookup"}),
        ("notifications_read", [("user_id", 1), ("notification_key", 1)], {"unique": True, "name": "user_key_unique"}),
    ]

    created = 0
    skipped = 0
    for collection_name, keys, options in indexes_to_create:
        try:
            await db[collection_name].create_index(keys, **options)
            print(f"  [+] {collection_name}.{options.get('name', keys)}")
            created += 1
        except Exception as e:
            print(f"  [skip] {collection_name}.{options.get('name', keys)}: {e}")
            skipped += 1

    print(f"\nIndexes created/verified: {created}, skipped: {skipped}")

    # Show final index state
    for collection_name in set(t[0] for t in indexes_to_create):
        indexes = await db[collection_name].list_indexes().to_list(length=None)
        print(f"\n{collection_name}: {len(indexes)} indexes")
        for idx in indexes:
            print(f"  {idx.get('name')}: {idx.get('key')}")

    client.close()


if __name__ == "__main__":
    asyncio.run(create_indexes())
