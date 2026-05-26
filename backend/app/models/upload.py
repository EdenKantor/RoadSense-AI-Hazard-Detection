"""
Upload MongoDB document shape and processing status enumeration.

MongoDB collection: uploads
"""
from enum import Enum


class UploadStatus(str, Enum):
    """Lifecycle state of a Citizen upload as it moves through the pipeline.

    Queued: persisted on disk and enqueued in RQ but not yet picked up.
    Processing: an RQ worker is currently running the YOLO/GPX pipeline.
    Done: pipeline completed and any detected events were inserted.
    Failed: pipeline raised, queue was unreachable, or input was invalid.
    """

    Queued = "Queued"
    Processing = "Processing"
    Done = "Done"
    Failed = "Failed"


UPLOAD_DOCUMENT = {
    "_id": str,               # UUID string
    "uploader_id": str,       # user._id of the citizen who submitted
    "mp4_path": str,          # Relative path under uploads/
    "gpx_path": str,          # Relative path under uploads/
    "status": UploadStatus,
    "error_message": str,     # Populated on failure, else None
    "created_at": str,        # ISO-8601 UTC — time of upload
    "updated_at": str,        # ISO-8601 UTC — last status change
    "job_id": str,            # RQ job id, set on enqueue
}


def new_upload_doc(
    upload_id: str,
    uploader_id: str,
    mp4_path: str,
    gpx_path: str,
) -> dict:
    """Return a ready-to-insert upload document dict.

    The status starts as Queued; ``error_message`` and ``job_id`` are filled
    in later by the upload service once the RQ job is enqueued (or if the
    enqueue fails).

    Args:
        upload_id: UUID string used as the document _id.
        uploader_id: user._id of the Citizen submitting this upload.
        mp4_path: Relative path to the saved MP4 file under uploads/.
        gpx_path: Relative path to the saved GPX file under uploads/.

    Returns:
        A dict shaped according to ``UPLOAD_DOCUMENT`` ready for insert_one.
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    return {
        "_id": upload_id,
        "uploader_id": uploader_id,
        "mp4_path": mp4_path,
        "gpx_path": gpx_path,
        "status": UploadStatus.Queued.value,
        "error_message": None,
        "created_at": now,
        "updated_at": now,
        "job_id": None,
        "comments": [],
    }
