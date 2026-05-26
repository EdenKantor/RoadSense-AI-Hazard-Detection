"""
Uploads router.

POST /api/uploads/              → create upload (MP4 + GPX), returns immediately
GET  /api/uploads/{id}/status   → poll upload processing status
GET  /api/uploads/mine          → citizen upload history
PATCH /api/uploads/{id}/notes   → update notes on an upload
PATCH /api/uploads/{id}/hide    → hide a resolved upload
PATCH /api/uploads/{id}/seen    → mark upload as seen
"""
from typing import List

from fastapi import APIRouter, Body, Depends, HTTPException, UploadFile, File, status

from app.database import get_db
from app.dependencies import get_current_user
from app.auth.rbac import require_role
from app.services import upload_service
from app.services.gpx_validator import validate_gpx_upload
from app.repositories import upload_repo, event_repo
from app.schemas.upload import UploadResponse, UploadStatusResponse, UploadHistoryItem

router = APIRouter()


async def _resolve_assigned_name(db, event_ids):
    """Resolve the display name of the technician(s) assigned to a set of events.

    Args:
        db: Mongo database handle.
        event_ids: list of pothole_event ``_id`` values to look up.

    Returns:
        ``"Tech: <full_name>"`` if all events share one assignee,
        ``"Multiple technicians"`` if more than one distinct assignee,
        or ``None`` when nothing is assigned.
    """
    if not event_ids:
        return None
    cursor = db["pothole_events"].find(
        {"_id": {"$in": event_ids}, "assigned_to": {"$exists": True, "$ne": None}},
        {"assigned_to": 1}
    )
    events = await cursor.to_list(length=500)
    assignee_ids = list({e["assigned_to"] for e in events if e.get("assigned_to")})
    if not assignee_ids:
        return None
    if len(assignee_ids) == 1:
        user = await db["users"].find_one({"_id": assignee_ids[0]}, {"full_name": 1})
        return f"Tech: {user.get('full_name', 'Unknown')}" if user else None
    return "Multiple technicians"


@router.post("/", response_model=UploadResponse, status_code=201)
async def create_upload(
    mp4_file: UploadFile = File(..., description="Dashcam video in MP4 format"),
    gpx_file: UploadFile = File(..., description="GPS track in GPX format"),
    current_user=Depends(require_role("Citizen")),
    db=Depends(get_db),
):
    """
    Accept MP4 + GPX, persist to filesystem, store metadata, enqueue job.
    Returns immediately — processing happens asynchronously in the worker.

    The GPX file is validated server-side before persistence; malformed GPX
    (bad XML, no trackpoints, no parseable timestamps, etc.) is rejected
    with HTTP 400 here so it never reaches the worker pipeline (which would
    otherwise emit phantom events at coordinates (0, 0) due to its loose
    fail-soft parser).
    """
    # Validate the GPX file before any persistence or queue dispatch.
    # validate_gpx_upload raises HTTPException(400) on the first failed rule.
    # We read the bytes once and rewind so the existing upload_service can
    # still re-read the UploadFile via shutil.copyfileobj.
    gpx_bytes = await gpx_file.read()
    validate_gpx_upload(gpx_file, gpx_bytes)
    await gpx_file.seek(0)

    doc = await upload_service.create_upload(
        db,
        uploader_id=current_user["_id"],
        mp4_file=mp4_file,
        gpx_file=gpx_file,
    )
    return UploadResponse(
        upload_id=doc["_id"],
        status=doc["status"],
        created_at=doc["created_at"],
    )


@router.get("/mine", response_model=List[UploadHistoryItem])
async def my_uploads(
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Return all uploads submitted by the current citizen, newest first."""
    docs = await upload_repo.list_uploads_by_uploader(db, current_user["_id"])
    result = []
    for d in docs:
        if d.get("hidden", False):
            continue
        assigned_name = await _resolve_assigned_name(db, d.get("event_ids", []))
        result.append(
            UploadHistoryItem(
                upload_id=d["_id"],
                status=d["status"],
                created_at=d["created_at"],
                updated_at=d["updated_at"],
                mp4_path=d["mp4_path"],
                gpx_path=d["gpx_path"],
                event_count=len(d.get("event_ids", [])),
                notes=d.get("notes"),
                hidden=d.get("hidden", False),
                seen=d.get("seen", False),
                assigned_to_name=assigned_name,
                comments=d.get("comments", []),
                original_video_filename=d.get("original_video_filename"),
            )
        )
    return result


@router.get("/{upload_id}/status", response_model=UploadStatusResponse)
async def get_upload_status(
    upload_id: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Poll the processing status of a specific upload.
    Used by the frontend for status tracking (Queued → Processing → Done/Failed).
    """
    doc = await upload_repo.find_upload_by_id(db, upload_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Upload not found.")

    # Citizen can only see their own uploads
    if doc["uploader_id"] != current_user["_id"] and current_user["role"] not in (
        "Authority",
        "Admin",
    ):
        raise HTTPException(status_code=403, detail="Not authorized.")

    return UploadStatusResponse(
        upload_id=doc["_id"],
        status=doc["status"],
        error_message=doc.get("error_message"),
        updated_at=doc["updated_at"],
    )


@router.get("/{upload_id}/detail")
async def get_upload_detail(
    upload_id: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """
    Enriched upload detail for the Upload Tracker page.
    Returns upload info, associated events summary, and status timeline.
    """
    doc = await upload_repo.find_upload_by_id(db, upload_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Upload not found.")

    # Access check: owner or Authority/Admin
    if doc["uploader_id"] != current_user["_id"] and current_user["role"] not in (
        "Authority", "Admin",
    ):
        raise HTTPException(status_code=403, detail="Not authorized.")

    # Fetch associated pothole events
    events = await event_repo.list_events_by_upload(db, upload_id)

    # Build events summary
    events_summary = []
    for e in events:
        events_summary.append({
            "event_id": e["_id"],
            "severity": e.get("severity"),
            "lifecycle_status": e.get("lifecycle_status"),
            "detection_count": e.get("detection_count", 0),
            "avg_confidence": e.get("avg_confidence", 0),
            "location": e.get("location"),
            "detected_at": e.get("detected_at"),
            "frame_thumbnail_path": e.get("frame_thumbnail_path"),
            "annotated_paths": e.get("annotated_paths", []),
        })

    # Pick a representative thumbnail (first event with annotated_paths or thumbnail)
    # Paths in DB may be absolute — convert to relative URL for /static/output/
    import os as _os
    _output_base = _os.path.abspath(_os.path.join(_os.path.dirname(__file__), "..", "..", "..", "output"))

    def _to_static_url(stored_path: str) -> str:
        """Convert a stored frame path into a browser-servable static URL.

        Current writes persist the relative form ``<upload_id>/<filename>``
        (forward slashes). Pre-fix legacy rows hold Windows-absolute paths
        like ``C:\\\\...\\\\output\\\\<upload_id>\\\\frame.jpg``; if such a
        row is encountered, the on-disk prefix is stripped down to the same
        relative form before prepending ``/static/output/``. Returns
        ``None`` for empty input.
        """
        if not stored_path:
            return None
        norm = stored_path.replace("\\", "/")
        base = _output_base.replace("\\", "/")
        if norm.startswith(base):
            norm = norm[len(base):].lstrip("/")
        return f"/static/output/{norm}"

    representative_image = None
    for e in events:
        paths = e.get("annotated_paths", [])
        if paths:
            representative_image = _to_static_url(paths[0])
            break
        if e.get("frame_thumbnail_path"):
            representative_image = _to_static_url(e["frame_thumbnail_path"])
            break

    # Build status timeline from status_history
    status_history = doc.get("status_history", [])
    existing_statuses = {h["status"] for h in status_history}

    # Backfill missing entries for uploads processed before history tracking was added
    if doc["status"] in ("Processing", "Done", "Failed") and "Processing" not in existing_statuses:
        status_history.append({"status": "Processing", "timestamp": doc.get("updated_at", doc["created_at"])})
    if doc["status"] == "Done" and "Done" not in existing_statuses:
        status_history.append({"status": "Done", "timestamp": doc["updated_at"]})
    if doc["status"] == "Failed" and "Failed" not in existing_statuses:
        status_history.append({"status": "Failed", "timestamp": doc["updated_at"], "error_message": doc.get("error_message")})
    if not status_history:
        status_history = [{"status": "Queued", "timestamp": doc["created_at"]}]

    # Compute aggregate stats
    total_detections = sum(e.get("detection_count", 0) for e in events)
    avg_confidence = (
        sum(e.get("avg_confidence", 0) for e in events) / len(events)
        if events else 0
    )
    # Primary severity (most frequent)
    severity_counts = {}
    for e in events:
        s = e.get("severity", "Unknown")
        severity_counts[s] = severity_counts.get(s, 0) + 1
    primary_severity = max(severity_counts, key=severity_counts.get) if severity_counts else None

    # Primary location (first event)
    primary_location = events[0].get("location") if events else None

    # Duplicate suppression info from processing stats
    processing_stats = doc.get("processing_stats", {})
    duplicates_suppressed = processing_stats.get("duplicates_suppressed", 0)

    return {
        "upload_id": doc["_id"],
        "status": doc["status"],
        "error_message": doc.get("error_message"),
        "created_at": doc["created_at"],
        "updated_at": doc["updated_at"],
        "original_video_filename": doc.get("original_video_filename"),
        "event_count": len(events),
        "total_detections": total_detections,
        "avg_confidence": round(avg_confidence, 2),
        "primary_severity": primary_severity,
        "primary_location": primary_location,
        "representative_image": representative_image,
        "status_history": status_history,
        "events": events_summary,
        "duplicates_suppressed": duplicates_suppressed,
    }


@router.patch("/{upload_id}/notes")
async def update_upload_notes(
    upload_id: str,
    payload: dict = Body(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Citizen adds/edits notes on their upload."""
    doc = await upload_repo.find_upload_by_id(db, upload_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Upload not found.")
    if doc["uploader_id"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized.")
    await db["uploads"].update_one(
        {"_id": upload_id},
        {"$set": {"notes": payload.get("notes", "")}}
    )
    return {"status": "updated"}


@router.post("/{upload_id}/comments")
async def add_comment(
    upload_id: str,
    payload: dict = Body(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Add a comment to an upload."""
    import uuid
    from datetime import datetime, timezone
    doc = await upload_repo.find_upload_by_id(db, upload_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Upload not found.")
    # Allow uploader, Authority, and Admin to comment
    is_owner = doc["uploader_id"] == current_user["_id"]
    is_authority = current_user.get("role") in ("Authority", "Official", "Admin")
    if not (is_owner or is_authority):
        raise HTTPException(status_code=403, detail="Not authorized.")
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment text is required.")
    comment = {
        "id": str(uuid.uuid4())[:8],
        "text": text,
        "author": current_user.get("full_name", current_user.get("email", "Unknown")),
        "author_id": current_user["_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    # Ensure comments array exists for older uploads, then push
    await db["uploads"].update_one(
        {"_id": upload_id, "comments": {"$exists": False}},
        {"$set": {"comments": []}}
    )
    await db["uploads"].update_one(
        {"_id": upload_id},
        {"$push": {"comments": comment}}
    )
    return {"status": "added", "comment": comment}


@router.get("/{upload_id}/comments")
async def get_comments(
    upload_id: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Get all comments for an upload."""
    doc = await upload_repo.find_upload_by_id(db, upload_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Upload not found.")
    return doc.get("comments", [])


@router.patch("/{upload_id}/comments/{comment_id}")
async def edit_comment(
    upload_id: str,
    comment_id: str,
    payload: dict = Body(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Edit a comment on an upload."""
    doc = await upload_repo.find_upload_by_id(db, upload_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Upload not found.")
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment text is required.")
    comments = doc.get("comments", [])
    found = False
    for c in comments:
        if c.get("id") == comment_id and c.get("author_id") == current_user["_id"]:
            c["text"] = text
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Comment not found.")
    await db["uploads"].update_one(
        {"_id": upload_id},
        {"$set": {"comments": comments}}
    )
    return {"status": "updated"}


@router.delete("/{upload_id}/comments/{comment_id}")
async def delete_comment(
    upload_id: str,
    comment_id: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Delete a comment from an upload."""
    doc = await upload_repo.find_upload_by_id(db, upload_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Upload not found.")
    comments = doc.get("comments", [])
    new_comments = [c for c in comments if not (c.get("id") == comment_id and c.get("author_id") == current_user["_id"])]
    if len(new_comments) == len(comments):
        raise HTTPException(status_code=404, detail="Comment not found.")
    await db["uploads"].update_one(
        {"_id": upload_id},
        {"$set": {"comments": new_comments}}
    )
    return {"status": "deleted"}


@router.patch("/{upload_id}/hide")
async def hide_upload(
    upload_id: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Citizen hides a resolved upload from their My Reports list. Not a real delete."""
    doc = await upload_repo.find_upload_by_id(db, upload_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Upload not found.")
    if doc["uploader_id"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized.")
    if doc["status"] != "Done":
        raise HTTPException(status_code=400, detail="Only resolved reports can be hidden.")
    await db["uploads"].update_one(
        {"_id": upload_id},
        {"$set": {"hidden": True}}
    )
    return {"status": "hidden"}


@router.patch("/{upload_id}/seen")
async def mark_upload_seen(
    upload_id: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Citizen marks upload as seen."""
    doc = await upload_repo.find_upload_by_id(db, upload_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Upload not found.")
    if doc["uploader_id"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized.")
    await db["uploads"].update_one(
        {"_id": upload_id},
        {"$set": {"seen": True}}
    )
    return {"status": "seen"}
