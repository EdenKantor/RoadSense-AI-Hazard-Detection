"""
Upload service -- file persistence and pipeline job dispatch.

Architecture:
  FastAPI -> Redis -> RQ Worker -> pipeline -> MongoDB

This service DOES NOT run the pipeline itself. It only:
  1. Saves uploaded files to the local filesystem.
  2. Inserts an upload metadata document into MongoDB.
  3. Enqueues an RQ job via Redis.
  4. Returns immediately.

If Redis/RQ is unreachable:
  - Default: upload is marked as Failed with a clear error message.
  - If ENABLE_EMERGENCY_FALLBACK=true: pipeline runs in a background
    thread inside the backend (degrades responsiveness, not recommended).
"""
import os
import sys
import uuid
import shutil
import threading
import traceback

from fastapi import UploadFile

from app.config import settings
from app.models.upload import new_upload_doc, UploadStatus
from app.repositories import upload_repo


# ---------------------------------------------------------------------------
# RQ dispatch (primary path -- all platforms)
# ---------------------------------------------------------------------------
def _get_queue():
    """Return an RQ Queue connected to Redis (with Windows fork-context patch).

    RQ's scheduler imports ``multiprocessing.get_context('fork').Process`` at
    module load, which fails on Windows because the fork context does not
    exist there. Registering the spawn context under the name 'fork' before
    we import rq makes that import succeed without changing runtime behaviour
    (jobs are dispatched to the separate RQ worker process, not forked here).
    """
    import multiprocessing
    import multiprocessing.context
    if "fork" not in multiprocessing.context._concrete_contexts:
        _ctx = multiprocessing.get_context("spawn")
        multiprocessing.context._concrete_contexts["fork"] = _ctx
    from rq import Queue
    import redis
    conn = redis.from_url(settings.redis_url)
    return Queue("roadsense", connection=conn)


def _enqueue_rq_job(upload_id: str) -> str:
    """Enqueue a pipeline job via RQ. Returns the RQ job ID."""
    q = _get_queue()
    job = q.enqueue(
        "pipeline.job.process_upload",
        upload_id,
        job_timeout=3600,
    )
    return job.id


# ---------------------------------------------------------------------------
# Emergency fallback (disabled by default, gated by config flag)
# ---------------------------------------------------------------------------
def _run_pipeline_in_thread(upload_id: str) -> None:
    """Run the pipeline directly in a background thread.

    WARNING: This is an emergency fallback, gated by ENABLE_EMERGENCY_FALLBACK.
    It runs heavy YOLO inference inside the FastAPI process, which degrades
    API responsiveness and does NOT scale for concurrent uploads.
    """
    try:
        worker_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "worker")
        )
        if worker_dir not in sys.path:
            sys.path.insert(0, worker_dir)
        from pipeline.job import process_upload
        print(f"[upload_service] [EMERGENCY FALLBACK] Running pipeline in-process for {upload_id}")
        process_upload(upload_id)
        print(f"[upload_service] [EMERGENCY FALLBACK] Pipeline completed for {upload_id}")
    except Exception as exc:
        print(f"[upload_service] [EMERGENCY FALLBACK] Pipeline FAILED for {upload_id}: {exc}")
        traceback.print_exc()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
async def create_upload(
    db,
    uploader_id: str,
    mp4_file: UploadFile,
    gpx_file: UploadFile,
) -> dict:
    """Persist MP4 + GPX to disk, store metadata, and dispatch a processing job.

    The pipeline does not run in this function: this returns as soon as the
    files are saved, the metadata document is inserted, and an RQ job has
    been enqueued (or, if RQ is unreachable and the emergency fallback flag
    is enabled, a background thread is started instead).

    Args:
        db: Motor database handle.
        uploader_id: user._id of the Citizen submitting the upload.
        mp4_file: FastAPI UploadFile for the dashcam video.
        gpx_file: FastAPI UploadFile for the matching GPX track.

    Returns:
        The upload document with status / job_id reflecting dispatch outcome.
    """
    upload_id = str(uuid.uuid4())
    upload_dir = os.path.join(settings.upload_dir, upload_id)
    os.makedirs(upload_dir, exist_ok=True)

    # os.path.basename strips any directory components a hostile client may
    # have embedded in the upload filename (e.g. "../../etc/passwd"). The
    # filename is otherwise echoed back to disk via os.path.join, so this is
    # the right place to defang it.
    mp4_path = os.path.join(upload_id, os.path.basename(mp4_file.filename))
    gpx_path = os.path.join(upload_id, os.path.basename(gpx_file.filename))

    # Save files
    for file_obj, rel_path in [(mp4_file, mp4_path), (gpx_file, gpx_path)]:
        dest = os.path.join(settings.upload_dir, rel_path)
        with open(dest, "wb") as out:
            shutil.copyfileobj(file_obj.file, out)

    # Persist metadata
    doc = new_upload_doc(upload_id, uploader_id, mp4_path, gpx_path)
    doc["original_video_filename"] = mp4_file.filename
    doc["original_gpx_filename"] = gpx_file.filename
    await upload_repo.insert_upload(db, doc)

    # Dispatch pipeline job via Redis/RQ (primary path on ALL platforms)
    try:
        job_id = _enqueue_rq_job(upload_id)
        await upload_repo.update_upload_status(
            db, upload_id, UploadStatus.Queued, job_id=job_id
        )
        doc["job_id"] = job_id
        print(f"[upload_service] [RQ] Job {job_id} enqueued for upload {upload_id}")
    except Exception as exc:
        if settings.enable_emergency_fallback:
            # EMERGENCY FALLBACK: run pipeline in-process (config-gated)
            print(f"[upload_service] [WARN] RQ enqueue failed ({exc}), "
                  f"EMERGENCY FALLBACK enabled -- running in-process")
            await upload_repo.update_upload_status(
                db, upload_id, UploadStatus.Queued, job_id=upload_id
            )
            doc["job_id"] = upload_id
            t = threading.Thread(
                target=_run_pipeline_in_thread,
                args=(upload_id,),
                daemon=True,
            )
            t.start()
        else:
            # SAFE FAIL: mark upload as Failed, do NOT run pipeline in FastAPI
            error_msg = f"Queue unavailable: {exc}. Start Redis and the RQ worker."
            print(f"[upload_service] [FAIL] RQ enqueue failed for {upload_id}: {error_msg}")
            await upload_repo.update_upload_status(
                db, upload_id, UploadStatus.Failed,
                error_message=error_msg,
            )
            doc["status"] = "Failed"
            doc["error_message"] = error_msg

    return doc
