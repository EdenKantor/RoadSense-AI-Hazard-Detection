"""
EventStatusHistory MongoDB document shape.

Audit log: every time an Authority (or Admin) changes a PotholeEvent's
lifecycle_status, one record is appended to this collection.

MongoDB collection: event_status_history
"""

EVENT_STATUS_HISTORY_DOCUMENT = {
    "_id": str,               # UUID string
    "event_id": str,          # Reference to pothole_events._id
    "changed_by": str,        # user._id of the Authority/Admin who made the change
    "changed_by_role": str,   # Role of the actor at time of change
    "previous_status": str,   # LifecycleStatus value before change
    "new_status": str,        # LifecycleStatus value after change
    "note": str,              # Optional free-text note from the actor
    "changed_at": str,        # ISO-8601 UTC
}


def new_event_status_history_doc(
    history_id: str,
    event_id: str,
    changed_by: str,
    changed_by_role: str,
    previous_status: str,
    new_status: str,
    note: str | None = None,
) -> dict:
    """Return a ready-to-insert EventStatusHistory document.

    Args:
        history_id: UUID string used as the document _id.
        event_id: pothole_events._id whose lifecycle changed.
        changed_by: user._id of the actor who made the change.
        changed_by_role: Role of the actor at the time of change (Authority / Admin).
        previous_status: LifecycleStatus value before the change.
        new_status: LifecycleStatus value after the change.
        note: Optional free-text note captured from the actor.

    Returns:
        A dict shaped according to ``EVENT_STATUS_HISTORY_DOCUMENT`` ready for insert_one.
    """
    from datetime import datetime, timezone
    return {
        "_id": history_id,
        "event_id": event_id,
        "changed_by": changed_by,
        "changed_by_role": changed_by_role,
        "previous_status": previous_status,
        "new_status": new_status,
        "note": note,
        "changed_at": datetime.now(timezone.utc).isoformat(),
    }
