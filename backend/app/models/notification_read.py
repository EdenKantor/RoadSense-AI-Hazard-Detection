"""
NotificationRead MongoDB document shape.

Tracks per-user "I have read this notification" state. The notification list
itself is not stored; pages compute notification rows on the fly from uploads,
events, tickets, and approvals, then key into this collection by a string
``notification_key`` to determine the unread badge.

A composite unique index on ``(user_id, notification_key)`` enforces
idempotency — marking the same notification read twice is a no-op.

MongoDB collection: notifications_read
"""
import uuid
from datetime import datetime, timezone


NOTIFICATION_READ_DOCUMENT = {
    "_id": str,                # UUID
    "user_id": str,            # references users._id
    "user_role": str,          # Citizen / Authority / Admin (snapshot at write time)
    "notification_key": str,   # opaque page-defined identifier (e.g. "up-<id>", "tk-<id>-reply-3")
    "read_at": str,            # ISO-8601 UTC, when the user marked it read
    "created_at": str,         # ISO-8601 UTC, same as read_at on insert
}


def new_notification_read_doc(
    user_id: str,
    user_role: str,
    notification_key: str,
) -> dict:
    """Return a ready-to-insert notification_read document.

    Args:
        user_id: References ``users._id`` of the actor marking-as-read.
        user_role: Snapshot of the actor's role at time of write
            (Citizen / Authority / Admin). Useful for analytics; the API
            does not enforce this matches the JWT role.
        notification_key: Opaque string the page uses to identify the
            notification (e.g. ``"up-<upload_id>"``). The (user_id,
            notification_key) pair has a unique index to keep marks idempotent.

    Returns:
        Dict shaped according to ``NOTIFICATION_READ_DOCUMENT`` ready for insert_one.
    """
    now = datetime.now(timezone.utc).isoformat()
    return {
        "_id": str(uuid.uuid4()),
        "user_id": user_id,
        "user_role": user_role,
        "notification_key": notification_key,
        "read_at": now,
        "created_at": now,
    }
