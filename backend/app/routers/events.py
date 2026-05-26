"""
Events router — public map data with viewport/bounds and filter support.

GET /api/events/    → public pothole events
                      Query params:
                        min_lat, max_lat, min_lon, max_lon  (viewport/bounds filter)
                        severity                             (Low | Medium | High)
                        lifecycle_status                     (Reported | UnderReview | ...)
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from app.database import get_db
from app.services.event_service import get_events
from app.schemas.pothole_event import PotholeEventResponse, GeoJSONPoint

router = APIRouter()


@router.get("/", response_model=List[PotholeEventResponse])
async def list_events(
    min_lat: Optional[float] = Query(None, description="SW corner latitude"),
    max_lat: Optional[float] = Query(None, description="NE corner latitude"),
    min_lon: Optional[float] = Query(None, description="SW corner longitude"),
    max_lon: Optional[float] = Query(None, description="NE corner longitude"),
    severity: Optional[str] = Query(None, description="Low | Medium | High"),
    lifecycle_status: Optional[str] = Query(
        None, description="Reported | UnderReview | Scheduled | Resolved | Rejected"
    ),
    db=Depends(get_db),
) -> List[PotholeEventResponse]:
    """
    Public / shared map events endpoint.
    No authentication required — any visitor can query the map.

    Viewport filter: pass all four bounds params together to restrict to a map bbox.
    Severity filter: pass severity= to show only that severity level.
    Status filter: pass lifecycle_status= to filter by repair lifecycle.
    """
    docs = await get_events(
        db,
        min_lat=min_lat,
        max_lat=max_lat,
        min_lon=min_lon,
        max_lon=max_lon,
        severity=severity,
        lifecycle_status=lifecycle_status,
    )
    return [
        PotholeEventResponse(
            event_id=d["_id"],
            upload_id=d["upload_id"],
            location=GeoJSONPoint(coordinates=d["location"]["coordinates"]),
            severity=d["severity"],
            lifecycle_status=d["lifecycle_status"],
            detection_count=d["detection_count"],
            avg_confidence=d["avg_confidence"],
            detected_at=d["detected_at"],
            created_at=d["created_at"],
            frame_thumbnail_path=d.get("frame_thumbnail_path"),
        )
        for d in docs
    ]
