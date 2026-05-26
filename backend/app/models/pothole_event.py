"""
PotholeEvent MongoDB document shape.

Stores one consolidated pothole event derived from DBSCAN consolidation
of raw frame detections. Uses GeoJSON Point for geospatial queries.

MongoDB collection: pothole_events

Recommended index (set up manually or via migration):
    db.pothole_events.create_index([("location", "2dsphere")])
"""
from enum import Enum


class Severity(str, Enum):
    """Severity bucket assigned to a consolidated pothole event.

    Currently derived from detection_count and avg_confidence in the pipeline.
    """

    Low = "Low"
    Medium = "Medium"
    High = "High"


class LifecycleStatus(str, Enum):
    """Authority-managed lifecycle state of a pothole event.

    New events default to Reported; Authority/Admin transitions are recorded
    in the event_status_history audit collection.
    """

    Reported = "Reported"       # Freshly detected — default
    UnderReview = "UnderReview" # Authority acknowledged
    Scheduled = "Scheduled"     # Repair scheduled
    Resolved = "Resolved"       # Marked as fixed
    Rejected = "Rejected"       # Marked as not a valid pothole


POTHOLE_EVENT_DOCUMENT = {
    "_id": str,                 # UUID string
    "upload_id": str,           # Reference to the originating upload
    "uploader_id": str,         # Citizen who submitted
    "location": {               # GeoJSON Point for $geoWithin / $geoNear
        "type": "Point",
        "coordinates": [float, float],  # [longitude, latitude]
    },
    "severity": Severity,
    "lifecycle_status": LifecycleStatus,
    "detection_count": int,     # Number of raw detections merged into this event
    "avg_confidence": float,    # Average YOLOv8 confidence of merged detections
    "detected_at": str,         # ISO-8601 UTC — approximate time from GPX
    "created_at": str,          # ISO-8601 UTC — time of persistence
    "updated_at": str,          # ISO-8601 UTC — last lifecycle update
    "frame_thumbnail_path": str, # Optional: path to a representative frame (stub)
}


def new_pothole_event_doc(
    event_id: str,
    upload_id: str,
    uploader_id: str,
    longitude: float,
    latitude: float,
    severity: Severity,
    detection_count: int,
    avg_confidence: float,
    detected_at: str,
) -> dict:
    """Return a ready-to-insert PotholeEvent document.

    Coordinates are stored as a GeoJSON Point ([longitude, latitude]) so that
    a 2dsphere index supports $geoWithin / $geoNear viewport queries.

    Args:
        event_id: UUID string used as the document _id.
        upload_id: Reference to the originating uploads._id.
        uploader_id: Citizen user._id who submitted the source upload.
        longitude: Longitude in decimal degrees (GeoJSON convention: lon first).
        latitude: Latitude in decimal degrees.
        severity: Bucketed severity assigned by the pipeline.
        detection_count: Number of raw frame detections merged into this event.
        avg_confidence: Mean YOLOv8 confidence across the merged detections.
        detected_at: ISO-8601 UTC timestamp approximated from the GPX track.

    Returns:
        A dict shaped according to ``POTHOLE_EVENT_DOCUMENT`` ready for insert_one.
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    return {
        "_id": event_id,
        "upload_id": upload_id,
        "uploader_id": uploader_id,
        "location": {
            "type": "Point",
            "coordinates": [longitude, latitude],
        },
        "severity": severity.value,
        "lifecycle_status": LifecycleStatus.Reported.value,
        "detection_count": detection_count,
        "avg_confidence": avg_confidence,
        "detected_at": detected_at,
        "created_at": now,
        "updated_at": now,
        "frame_thumbnail_path": None,
    }
