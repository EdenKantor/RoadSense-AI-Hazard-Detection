"""NotificationRead data-access layer."""
from typing import List

from app.models.notification_read import new_notification_read_doc


async def list_read_keys_for_user(db, user_id: str) -> List[str]:
    """Return the list of notification keys the user has marked as read.

    Args:
        db: Motor database handle.
        user_id: ``users._id`` of the current user.

    Returns:
        List of ``notification_key`` strings (unordered).
    """
    cursor = db["notifications_read"].find(
        {"user_id": user_id},
        {"notification_key": 1, "_id": 0},
    )
    docs = await cursor.to_list(length=10000)
    return [d["notification_key"] for d in docs if d.get("notification_key")]


async def mark_as_read(
    db,
    user_id: str,
    user_role: str,
    notification_key: str,
) -> dict:
    """Idempotently mark a single notification as read.

    Uses an upsert-style insert guarded by the (user_id, notification_key)
    unique index. If the row already exists, the duplicate-key error is
    swallowed and the existing document is returned.

    Args:
        db: Motor database handle.
        user_id: Actor's ``users._id``.
        user_role: Actor's role snapshot.
        notification_key: Opaque page-defined identifier.

    Returns:
        The freshly-inserted (or pre-existing) document.
    """
    doc = new_notification_read_doc(user_id, user_role, notification_key)
    try:
        await db["notifications_read"].insert_one(doc)
        return doc
    except Exception:
        # Duplicate-key on (user_id, notification_key) — fetch and return existing.
        existing = await db["notifications_read"].find_one(
            {"user_id": user_id, "notification_key": notification_key}
        )
        return existing or doc


async def mark_multiple_as_read(
    db,
    user_id: str,
    user_role: str,
    notification_keys: List[str],
) -> int:
    """Mark several notifications as read in a single call.

    Inserts via ``insert_many`` with ``ordered=False`` so existing keys do
    not abort the batch. Returns the number of newly-inserted rows.

    Args:
        db: Motor database handle.
        user_id: Actor's ``users._id``.
        user_role: Actor's role snapshot.
        notification_keys: List of opaque page-defined identifiers.

    Returns:
        Number of newly-inserted rows (excludes duplicates the unique index rejected).
    """
    if not notification_keys:
        return 0

    docs = [
        new_notification_read_doc(user_id, user_role, key)
        for key in notification_keys
        if key
    ]
    if not docs:
        return 0

    try:
        result = await db["notifications_read"].insert_many(docs, ordered=False)
        return len(result.inserted_ids)
    except Exception as exc:
        # Pymongo raises BulkWriteError on partial failure; the docs that
        # WERE inserted still landed. Best-effort recovery: count current
        # rows for the supplied keys and infer.
        from pymongo.errors import BulkWriteError
        if isinstance(exc, BulkWriteError):
            inserted = exc.details.get("nInserted", 0) if hasattr(exc, "details") else 0
            return int(inserted)
        return 0


async def delete_read_key(
    db,
    user_id: str,
    notification_key: str,
) -> int:
    """Mark a single notification unread by deleting its read row.

    Args:
        db: Motor database handle.
        user_id: Actor's ``users._id``.
        notification_key: The key to clear.

    Returns:
        Number of rows deleted (0 or 1).
    """
    result = await db["notifications_read"].delete_one(
        {"user_id": user_id, "notification_key": notification_key}
    )
    return int(result.deleted_count or 0)


async def delete_read_keys_for_user(db, user_id: str) -> int:
    """Delete all read-state rows for a user (testing / cleanup).

    Returns:
        Number of rows deleted.
    """
    result = await db["notifications_read"].delete_many({"user_id": user_id})
    return int(result.deleted_count or 0)
