"""
Pipeline job entry point — the 8-stage upload orchestrator.

This is the function registered with RQ (or called directly on Windows).
The backend enqueues/dispatches: ``process_upload(upload_id)``.

Lifecycle:
    Queued -> Processing -> Done | Failed

All heavy processing is owned by this worker. The upload HTTP endpoint
never calls any of these functions.

Pipeline stages (each runs sequentially, all in-process):
    1. GPX parse              — read track points from the .gpx file.
    2. Frame sample            — extract frames from the .mp4 at a fixed cadence.
    3. YOLO inference          — run YOLOv8 on every frame, pothole class only.
    4. Confidence filter       — drop detections below the configured threshold.
    5. Timestamp align         — match each detection to the nearest GPX point.
    6. DBSCAN consolidation    — cluster nearby detections into single events.
    7. Severity heuristic      — score each cluster (Low / Medium / High).
    8. Persist + dedup         — write events to MongoDB, merging on proximity.

Observability:
    Every stage boundary emits a tiny JSON event on the Redis pub/sub channel
    ``roadsense:pipeline``. Emission is best-effort — failures are swallowed
    with a warning log and never break the pipeline.
"""
import sys
import os
import time
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from datetime import datetime, timezone

import pymongo

from config import settings
from pipeline.gpx_parser import parse_gpx
from pipeline.frame_sampler import sample_frames
from pipeline.yolo_inference import run_yolo_inference
from pipeline.timestamp_align import align_detections_to_gpx
from pipeline.dbscan_consolidation import consolidate_detections
from pipeline.severity_heuristic import compute_severity
from pipeline.event_persister import persist_events

# Best-effort observability import — never breaks the pipeline
try:
    from observability import publish_event as _publish_event  # type: ignore
except Exception:  # noqa: BLE001
    def _publish_event(*_args, **_kwargs):
        return None


# Canonical stage descriptors used by the observability dashboard.
# Order MUST match the eight pipeline steps below.
_PIPELINE_STAGES = [
    ("gpx_parse",            "GPX parse"),
    ("frame_sample",         "Frame sample"),
    ("yolo_inference",       "YOLO inference"),
    ("confidence_filter",    "Confidence filter"),
    ("timestamp_align",      "Timestamp align"),
    ("dbscan_consolidation", "DBSCAN consolidation"),
    ("severity_heuristic",   "Severity heuristic"),
    ("persist_dedup",        "Persist + Dedup"),
]


def _stage_index(stage_id: str) -> int:
    """1-based index for a stage_id, used in observability events."""
    for i, (sid, _label) in enumerate(_PIPELINE_STAGES, start=1):
        if sid == stage_id:
            return i
    return 0


def _stage_label(stage_id: str) -> str:
    """Human-readable label for a stage_id, used in observability events."""
    for sid, label in _PIPELINE_STAGES:
        if sid == stage_id:
            return label
    return stage_id


def _emit_stage_start(upload_id: str, stage_id: str) -> float:
    """Emit `stage_start` and return the start time (seconds, monotonic)."""
    started = time.monotonic()
    _publish_event("stage_start", {
        "upload_id": upload_id,
        "stage_id": stage_id,
        "stage_index": _stage_index(stage_id),
        "stage_label": _stage_label(stage_id),
    })
    return started


def _emit_stage_complete(upload_id: str, stage_id: str, started: float, metrics: dict | None = None) -> None:
    """Emit ``stage_complete`` with the elapsed duration since ``started``."""
    duration_ms = max(0, int((time.monotonic() - started) * 1000))
    _publish_event("stage_complete", {
        "upload_id": upload_id,
        "stage_id": stage_id,
        "stage_index": _stage_index(stage_id),
        "stage_label": _stage_label(stage_id),
        "duration_ms": duration_ms,
        "metrics": metrics or {},
    })


def _get_db():
    """Open a fresh pymongo client and return the configured database handle."""
    client = pymongo.MongoClient(settings.mongodb_url)
    return client[settings.mongodb_db_name]


def _update_status(db, upload_id: str, status: str, extra: dict = None) -> None:
    """
    Update an upload's ``status`` field and append a ``status_history`` row.

    If ``extra`` carries an ``error_message``, it's also recorded in the
    history entry for that transition.
    """
    now = datetime.now(timezone.utc).isoformat()
    fields = {"status": status, "updated_at": now}
    if extra:
        fields.update(extra)
    history_entry = {"status": status, "timestamp": now}
    if extra and extra.get("error_message"):
        history_entry["error_message"] = extra["error_message"]
    db["uploads"].update_one(
        {"_id": upload_id},
        {"$set": fields, "$push": {"status_history": history_entry}},
    )


def process_upload(upload_id: str) -> None:
    """
    Main pipeline job function — orchestrates the eight processing stages
    for a single upload, end-to-end.

    Resolves paths, transitions the upload from Queued -> Processing, runs
    the eight stages in order (GPX parse, frame sample, YOLO inference,
    confidence filter, timestamp align, DBSCAN consolidation, severity
    heuristic, persist + dedup), then transitions to Done. Any exception
    along the way is recorded as Failed with the message and re-raised so
    RQ can mark the job failed too.

    Emits ``job_picked``, ``stage_start``/``stage_complete`` per stage,
    and a final ``job_complete`` (or ``job_failed``) on the observability
    pub/sub channel. All emission is best-effort.
    """
    job_started_at = time.monotonic()
    current_stage_id = None  # for accurate `job_failed` reporting

    # Resolve RQ job id if available (for the dashboard's queue panel)
    try:
        from rq import get_current_job  # type: ignore
        _rq_job = get_current_job()
        _rq_job_id = _rq_job.id if _rq_job is not None else None
    except Exception:  # noqa: BLE001
        _rq_job_id = None

    # Emit "job_picked" first thing — even if Mongo or anything else fails after.
    _publish_event("job_picked", {
        "upload_id": upload_id,
        "job_id": _rq_job_id,
    })

    db = _get_db()

    # Fetch upload document
    upload = db["uploads"].find_one({"_id": upload_id})
    if not upload:
        print(f"[job] Upload {upload_id} not found -- aborting.")
        _publish_event("job_failed", {
            "upload_id": upload_id,
            "stage_id": None,
            "error_class": "LookupError",
            "error_message": "Upload document not found in MongoDB.",
        })
        return

    _update_status(db, upload_id, "Processing")

    try:
        # Use absolute path based on worker CWD
        base_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "uploads"))
        output_base = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "output"))

        mp4_abs = os.path.join(base_path, upload["mp4_path"])
        gpx_abs = os.path.join(base_path, upload["gpx_path"])

        # Create per-upload output directory for annotated previews
        upload_output_dir = os.path.join(output_base, upload_id)
        os.makedirs(upload_output_dir, exist_ok=True)

        # Parse GPX track points
        current_stage_id = "gpx_parse"
        print(f"[job] Step 1/8: Parsing GPX from {gpx_abs}")
        _t = _emit_stage_start(upload_id, current_stage_id)
        gpx_samples = parse_gpx(gpx_abs)
        print(f"[job]   => {len(gpx_samples)} GPX track points")
        _emit_stage_complete(upload_id, current_stage_id, _t, {"gpx_points": len(gpx_samples)})

        # Sample frames from MP4 at the configured cadence
        current_stage_id = "frame_sample"
        print(f"[job] Step 2/8: Sampling frames from {mp4_abs}")
        _t = _emit_stage_start(upload_id, current_stage_id)
        frames = sample_frames(mp4_abs)
        print(f"[job]   => {len(frames)} frames sampled")
        _emit_stage_complete(upload_id, current_stage_id, _t, {"frames_sampled": len(frames)})

        # Run YOLOv8 inference on every sampled frame (pothole class only)
        current_stage_id = "yolo_inference"
        print("[job] Step 3/8: Running YOLO inference (pothole-only)")
        _t = _emit_stage_start(upload_id, current_stage_id)
        raw_detections = run_yolo_inference(frames, output_dir=upload_output_dir)
        print(f"[job]   => {len(raw_detections)} raw pothole detections")
        _emit_stage_complete(upload_id, current_stage_id, _t, {"raw_detections": len(raw_detections)})

        # Drop detections below the configured confidence threshold
        current_stage_id = "confidence_filter"
        threshold = settings.yolo_confidence_threshold
        _t = _emit_stage_start(upload_id, current_stage_id)
        filtered = [d for d in raw_detections if d["confidence"] >= threshold]
        print(f"[job] Step 4/8: Confidence filter ({threshold}) => {len(filtered)} detections")
        _emit_stage_complete(upload_id, current_stage_id, _t, {
            "filtered_detections": len(filtered),
            "threshold": threshold,
        })

        # Match each detection to the nearest GPX track point (lat/lon)
        current_stage_id = "timestamp_align"
        print("[job] Step 5/8: Aligning detections to GPX coordinates")
        _t = _emit_stage_start(upload_id, current_stage_id)
        aligned = align_detections_to_gpx(filtered, gpx_samples)
        print(f"[job]   => {len(aligned)} aligned detections")
        _emit_stage_complete(upload_id, current_stage_id, _t, {"aligned_detections": len(aligned)})

        # Cluster spatially-close detections into single events via DBSCAN
        current_stage_id = "dbscan_consolidation"
        print("[job] Step 6/8: DBSCAN consolidation")
        _t = _emit_stage_start(upload_id, current_stage_id)
        clusters = consolidate_detections(
            aligned,
            eps_meters=settings.dbscan_eps_meters,
            min_samples=settings.dbscan_min_samples,
        )
        print(f"[job]   => {len(clusters)} clusters")
        _emit_stage_complete(upload_id, current_stage_id, _t, {"clusters": len(clusters)})

        # Score each cluster's severity (Low / Medium / High)
        current_stage_id = "severity_heuristic"
        print("[job] Step 7/8: Computing severity")
        _t = _emit_stage_start(upload_id, current_stage_id)
        events = [compute_severity(cluster) for cluster in clusters]
        _emit_stage_complete(upload_id, current_stage_id, _t, {})

        # Persist events to MongoDB (with cross-upload merge-on-proximity dedup)
        current_stage_id = "persist_dedup"
        print("[job] Step 8/8: Persisting events to MongoDB")
        _t = _emit_stage_start(upload_id, current_stage_id)
        event_ids, duplicates_suppressed = persist_events(
            db, upload_id, upload["uploader_id"], events,
            eps_meters=settings.dbscan_eps_meters,
        )
        _emit_stage_complete(upload_id, current_stage_id, _t, {
            "events_persisted": len(event_ids),
            "duplicates_suppressed": duplicates_suppressed,
        })

        # Collect annotated preview file list
        annotated_files = []
        if os.path.isdir(upload_output_dir):
            annotated_files = sorted([
                f for f in os.listdir(upload_output_dir)
                if f.endswith(('.jpg', '.png'))
            ])

        # Store processing stats in the upload document
        processing_stats = {
            "frames_sampled": len(frames),
            "raw_detections": len(raw_detections),
            "filtered_detections": len(filtered),
            "aligned_detections": len(aligned),
            "clusters": len(clusters),
            "events_persisted": len(event_ids),
            "duplicates_suppressed": duplicates_suppressed,
            "gpx_points": len(gpx_samples),
            "annotated_frames": annotated_files,
            "output_dir": upload_output_dir,
        }

        _update_status(db, upload_id, "Done", extra={
            "processing_stats": processing_stats,
            "event_ids": event_ids,
        })
        print(f"[job] Upload {upload_id} done -- {len(event_ids)} events persisted.")

        _publish_event("job_complete", {
            "upload_id": upload_id,
            "events_persisted": len(event_ids),
            "duplicates_suppressed": duplicates_suppressed,
            "total_duration_ms": max(0, int((time.monotonic() - job_started_at) * 1000)),
        })

    except Exception as exc:
        _update_status(db, upload_id, "Failed", extra={"error_message": str(exc)})
        print(f"[job] Upload {upload_id} FAILED: {exc}")
        # Emit job_failed BEFORE traceback printing so it's still recorded if traceback hangs
        _publish_event("job_failed", {
            "upload_id": upload_id,
            "stage_id": current_stage_id,
            "error_class": type(exc).__name__,
            "error_message": str(exc),
        })
        import traceback
        traceback.print_exc()
        raise
