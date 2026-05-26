"""Pydantic schemas for Upload request/response validation."""
from typing import Optional, List
from pydantic import BaseModel
from app.models.upload import UploadStatus


class CommentItem(BaseModel):
    """A single authority/admin comment attached to an upload."""

    id: str = ""
    text: str
    author: str
    author_id: str
    created_at: str


class UploadResponse(BaseModel):
    """Response returned immediately after an upload is accepted and queued."""

    upload_id: str
    status: UploadStatus
    created_at: str
    message: str = "Upload received and queued for processing."


class UploadStatusResponse(BaseModel):
    """Lightweight status payload for polling an upload's processing progress."""

    upload_id: str
    status: UploadStatus
    error_message: Optional[str] = None
    updated_at: str


class UploadHistoryItem(BaseModel):
    """Detailed upload record shown in user/authority history listings."""

    upload_id: str
    status: UploadStatus
    created_at: str
    updated_at: str
    mp4_path: str
    gpx_path: str
    event_count: int = 0
    notes: Optional[str] = None
    hidden: bool = False
    seen: bool = False
    assigned_to_name: Optional[str] = None
    comments: List[CommentItem] = []
    original_video_filename: Optional[str] = None
