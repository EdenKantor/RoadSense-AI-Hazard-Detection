"""
Event service — geospatial event queries and lifecycle management.
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from app.repositories import event_repo
from app.models.event_status_history import new_event_status_history_doc


async def get_events(
    db,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    severity: Optional[str] = None,
    lifecycle_status: Optional[str] = None,
) -> List[dict]:
    """Query pothole events for the public map.

    All filters are optional and combined with AND. Bounds are only applied
    when all four lat/lon corners are provided.

    Args:
        db: Motor database handle.
        min_lat: Southern bound (decimal degrees).
        max_lat: Northern bound (decimal degrees).
        min_lon: Western bound (decimal degrees).
        max_lon: Eastern bound (decimal degrees).
        severity: Optional Severity value to filter on.
        lifecycle_status: Optional LifecycleStatus value to filter on.

    Returns:
        List of pothole event documents (capped by the repository layer).
    """
    return await event_repo.query_events(
        db,
        min_lat=min_lat,
        max_lat=max_lat,
        min_lon=min_lon,
        max_lon=max_lon,
        severity=severity,
        lifecycle_status=lifecycle_status,
    )


async def update_lifecycle(
    db,
    event_id: str,
    new_status: str,
    changed_by: str,
    changed_by_role: str,
    note: Optional[str] = None,
) -> Optional[dict]:
    """Update an event's lifecycle status and append an audit history record.

    Args:
        db: Motor database handle.
        event_id: pothole_events._id to update.
        new_status: Target LifecycleStatus value.
        changed_by: user._id of the actor performing the change.
        changed_by_role: Role of the actor at the time of the change.
        note: Optional free-text note recorded on the audit entry.

    Returns:
        The updated event document, or None if no event exists for ``event_id``.
    """
    event = await event_repo.find_event_by_id(db, event_id)
    if not event:
        return None

    previous_status = event["lifecycle_status"]
    updated = await event_repo.update_event_lifecycle(db, event_id, new_status)

    # Append audit record
    history_doc = new_event_status_history_doc(
        history_id=str(uuid.uuid4()),
        event_id=event_id,
        changed_by=changed_by,
        changed_by_role=changed_by_role,
        previous_status=previous_status,
        new_status=new_status,
        note=note,
    )
    await event_repo.insert_event_status_history(db, history_doc)

    return updated
