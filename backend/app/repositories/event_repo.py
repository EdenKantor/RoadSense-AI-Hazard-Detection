"""
PotholeEvent data-access layer.

Key features:
  - Viewport / bounding-box query via MongoDB $geoWithin + $box
  - Severity filter
  - Lifecycle status filter
  - Authority actionable event list

NOTE: A 2dsphere index must exist on pothole_events.location for
      $geoWithin to work efficiently. Create it once with:
        db.pothole_events.create_index([("location", "2dsphere")])
"""
from typing import List, Optional


async def insert_event(db, event_doc: dict) -> str:
    """Insert a pothole event document and return its _id."""
    result = await db["pothole_events"].insert_one(event_doc)
    return str(result.inserted_id)


async def find_event_by_id(db, event_id: str) -> Optional[dict]:
    """Look up a pothole event by _id. Returns None if not found."""
    return await db["pothole_events"].find_one({"_id": event_id})


async def query_events(
    db,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    severity: Optional[str] = None,
    lifecycle_status: Optional[str] = None,
    limit: int = 500,
) -> List[dict]:
    """
    Query pothole events with optional:
      - viewport/bounds filter ($geoWithin $box: [SW, NE] corners)
      - severity filter
      - lifecycle_status filter
    """
    query: dict = {}

    # Viewport / bounds filter
    if all(v is not None for v in [min_lat, max_lat, min_lon, max_lon]):
        query["location"] = {
            "$geoWithin": {
                "$box": [
                    [min_lon, min_lat],   # SW corner [lon, lat]
                    [max_lon, max_lat],   # NE corner [lon, lat]
                ]
            }
        }

    # Severity filter
    if severity:
        query["severity"] = severity

    # Lifecycle status filter
    if lifecycle_status:
        query["lifecycle_status"] = lifecycle_status

    cursor = db["pothole_events"].find(query).limit(limit)
    return await cursor.to_list(length=limit)


async def update_event_lifecycle(
    db,
    event_id: str,
    new_status: str,
) -> Optional[dict]:
    """Update the lifecycle_status of an event. Returns the updated doc."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    result = await db["pothole_events"].find_one_and_update(
        {"_id": event_id},
        {"$set": {"lifecycle_status": new_status, "updated_at": now}},
        return_document=True,
    )
    return result


async def list_events_by_upload(db, upload_id: str) -> List[dict]:
    """Return all pothole events derived from a given upload (capped at 1000)."""
    cursor = db["pothole_events"].find({"upload_id": upload_id})
    return await cursor.to_list(length=1000)


async def insert_event_status_history(db, history_doc: dict) -> None:
    """Append one audit record to event_status_history."""
    await db["event_status_history"].insert_one(history_doc)
