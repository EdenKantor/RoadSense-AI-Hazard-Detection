"""Worker settings loaded from environment / .env file.

Defines the :class:`WorkerSettings` Pydantic model that centralizes every
runtime knob used by the pipeline: Redis/Mongo connection strings, YOLO
inference thresholds, DBSCAN clustering parameters, severity-classification
ratios, and observability toggles. A module-level :data:`settings` instance
is constructed at import time so consumers can simply ``from config import
settings``.
"""
from pydantic_settings import BaseSettings


class WorkerSettings(BaseSettings):
    """Pydantic settings model for the worker process.

    Values are loaded from environment variables (or a local ``.env`` file)
    and fall back to the defaults defined here. Unknown variables in the
    environment are ignored so the same ``.env`` can be shared with other
    services.
    """

    redis_url: str = "redis://localhost:6379"
    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "roadsenseai"
    yolo_weights_path: str = "../weights/model.pt"
    # Sample twice per second to double detection coverage; doubles runtime cost
    # versus a 1 Hz sample rate.
    frame_sample_interval_seconds: float = 0.5
    dbscan_eps_meters: float = 5.0
    dbscan_min_samples: int = 1
    # Low confidence floor (0.20) catches partial pothole detections that YOLO
    # scores in the 0.20-0.25 range; downstream DBSCAN clustering and the
    # cross-upload merge-with-reopen logic absorb the resulting false positives.
    yolo_confidence_threshold: float = 0.20
    # Slightly higher than the ultralytics default 0.45 to merge split bboxes of
    # the same pothole more aggressively.
    yolo_nms_iou_threshold: float = 0.5
    output_dir: str = "../output"

    # ── Severity classification (FHWA-inspired) ───────────────────────────
    # Stage 1: confidence floor — below this, severity is always Low.
    severity_confidence_floor: float = 0.4
    # Stage 2: size-based thresholds (max_bbox_area / severity_frame_area).
    # severity_frame_area is a CALIBRATION constant. YOLO returns bboxes in
    # original image coordinates; we divide by 640*640 as a reference frame.
    # Re-tune severity_low_ratio / severity_medium_ratio if the model is
    # retrained at a different resolution.
    severity_frame_area: int = 640 * 640        # 409,600 px²
    severity_low_ratio: float = 0.05            # FHWA: < 30 cm ≈ < 5 % of 640²
    severity_medium_ratio: float = 0.15         # FHWA: 30-90 cm ≈ 5-15 % of 640²
    # (anything ≥ severity_medium_ratio is High)
    # Stage 3: multi-detection boost — bumps severity up one level.
    severity_multi_detection_boost: int = 3

    # Number of SimpleWorker subprocesses the supervisor spawns. Each gets a
    # distinct name (worker-1, worker-2, ...). Set to 1 for single-worker mode.
    worker_count: int = 3

    # When True (default), the worker publishes pipeline-progress events to
    # the Redis pub/sub channel "roadsense:pipeline" at every stage boundary.
    # Failures are swallowed with a warning — the pipeline never breaks because
    # observability failed. Set to False to disable emission entirely.
    enable_observability: bool = True

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = WorkerSettings()
