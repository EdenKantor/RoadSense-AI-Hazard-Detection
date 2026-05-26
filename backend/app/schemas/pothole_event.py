"""Pydantic schemas for PotholeEvent request/response validation."""
from typing import List, Optional
from pydantic import BaseModel
from app.models.pothole_event import Severity, LifecycleStatus


class GeoJSONPoint(BaseModel):
    """GeoJSON Point geometry as stored in MongoDB ([longitude, latitude] order)."""

    type: str = "Point"
    coordinates: List[float]  # [longitude, latitude]


class PotholeEventResponse(BaseModel):
    """Public representation of a detected pothole event for API responses."""

    event_id: str
    upload_id: str
    location: GeoJSONPoint
    severity: Severity
    lifecycle_status: LifecycleStatus
    detection_count: int
    avg_confidence: float
    detected_at: str
    created_at: str
    frame_thumbnail_path: Optional[str] = None
    assigned_to: Optional[str] = None
    zone: Optional[str] = None


class LifecycleStatusUpdateRequest(BaseModel):
    """Request body for an authority/admin lifecycle status transition on an event."""

    new_status: LifecycleStatus
    note: Optional[str] = None


class EventQueryParams(BaseModel):
    """Used internally to pass validated filter params to the event service."""
    min_lat: Optional[float] = None
    max_lat: Optional[float] = None
    min_lon: Optional[float] = None
    max_lon: Optional[float] = None
    severity: Optional[Severity] = None
    lifecycle_status: Optional[LifecycleStatus] = None
