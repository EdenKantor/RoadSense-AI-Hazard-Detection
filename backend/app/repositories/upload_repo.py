"""
Upload data-access layer.
"""
from typing import List, Optional
from app.models.upload import UploadStatus


async def insert_upload(db, upload_doc: dict) -> str:
    """Insert an upload document and return its _id."""
    result = await db["uploads"].insert_one(upload_doc)
    return str(result.inserted_id)


async def find_upload_by_id(db, upload_id: str) -> Optional[dict]:
    """Look up an upload by _id. Returns None if not found."""
    return await db["uploads"].find_one({"_id": upload_id})


async def list_uploads_by_uploader(db, uploader_id: str) -> List[dict]:
    """Return all uploads submitted by a specific citizen, newest first."""
    cursor = db["uploads"].find(
        {"uploader_id": uploader_id}
    ).sort("created_at", -1)
    return await cursor.to_list(length=200)


async def update_upload_status(
    db,
    upload_id: str,
    status: UploadStatus,
    error_message: Optional[str] = None,
    job_id: Optional[str] = None,
) -> None:
    """Update upload status and append a status_history entry.

    Args:
        db: Motor database handle.
        upload_id: uploads._id of the document to update.
        status: New UploadStatus value.
        error_message: Optional error message; only set when transitioning to Failed.
        job_id: Optional RQ job id; usually set on first transition to Queued.
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    fields = {
        "status": status.value,
        "updated_at": now,
    }
    if error_message is not None:
        fields["error_message"] = error_message
    if job_id is not None:
        fields["job_id"] = job_id

    # Append to status_history for Activity Log
    history_entry = {"status": status.value, "timestamp": now}
    if error_message:
        history_entry["error_message"] = error_message

    await db["uploads"].update_one(
        {"_id": upload_id},
        {"$set": fields, "$push": {"status_history": history_entry}},
    )
