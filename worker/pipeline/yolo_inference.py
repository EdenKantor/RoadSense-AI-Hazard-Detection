"""
YOLOv8 inference — real implementation.

Loads a YOLOv8 model once per worker process, runs inference on the
sampled frames, and returns detections filtered to ONLY the pothole
class. Also saves annotated preview frames (with bounding boxes drawn)
for admin review when an output directory is supplied.

Model: YOLOv8_Small_2nd_Model.pt (from collabdoor/road-anomaly-detection)
Classes: {0: 'Longitudinal Crack', 1: 'Transverse Crack',
          2: 'Alligator Crack', 3: 'Potholes'}

Pothole class is detected dynamically by name matching against
``POTHOLE_KEYWORDS`` — NOT hardcoded by class id — so a re-trained model
with a different class ordering still works without code changes.

Each detection records the actual frame width/height so the downstream
severity heuristic can calibrate against the real frame area instead of
a fixed 640x640 reference.
"""
from typing import List, Dict, Any, Optional
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from config import settings

# Module-level model cache — loaded once per worker process
_model = None
_pothole_class_ids: List[int] = []

POTHOLE_KEYWORDS = {"pothole", "potholes"}


def _load_model():
    """
    Lazy-load the YOLOv8 model and cache it in module state.

    The weights file is read once on the first call; every subsequent
    call inside the same worker process returns the cached model. Also
    populates ``_pothole_class_ids`` by matching ``model.names`` against
    ``POTHOLE_KEYWORDS`` so a re-trained model with reordered classes
    still works.

    Returns:
        The loaded ultralytics ``YOLO`` instance, or ``None`` if the
        weights file is missing or the import/load failed (errors are
        logged, never raised — the caller treats ``None`` as "skip
        inference for this run").
    """
    global _model, _pothole_class_ids
    if _model is not None:
        return _model

    weights_path = settings.yolo_weights_path
    if not os.path.isfile(weights_path):
        print(f"[yolo_inference] ERROR: weights not found at {weights_path}")
        return None

    try:
        from ultralytics import YOLO
        _model = YOLO(weights_path)
        print(f"[yolo_inference] Model loaded from {weights_path}")
        print(f"[yolo_inference] Class names: {_model.names}")

        # Dynamically detect pothole class IDs
        _pothole_class_ids = [
            cls_id for cls_id, name in _model.names.items()
            if name.lower().strip() in POTHOLE_KEYWORDS
        ]
        print(f"[yolo_inference] Pothole class IDs: {_pothole_class_ids}")

        if not _pothole_class_ids:
            print("[yolo_inference] WARNING: No pothole class found in model!")
    except Exception as exc:
        print(f"[yolo_inference] Failed to load model: {exc}")
        _model = None

    return _model


def run_yolo_inference(
    frames: List[Dict[str, Any]],
    output_dir: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Run YOLOv8 inference on each sampled frame, filtering to pothole-only.

    Args:
        frames: List of dicts from frame_sampler, each containing
                {"frame_index": int, "timestamp_sec": float, "image": np.ndarray}
        output_dir: If provided, save annotated frames here with bounding boxes.

    Returns:
        List of detection dicts (pothole only):
            {
              "frame_index": int,
              "timestamp_sec": float,
              "confidence": float,
              "bbox": [x1, y1, x2, y2],
              "class_name": str,
              "annotated_path": str | None,
            }
    """
    import cv2

    model = _load_model()
    if model is None:
        print("[yolo_inference] Model not loaded — cannot run inference.")
        return []

    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    detections = []
    frames_with_detections = set()

    for frame in frames:
        # Capture actual frame dimensions so the downstream severity
        # heuristic can normalise bbox area against the real frame size
        # (typically 1280x720 or 1920x1080) instead of falling back to
        # the hardcoded 640x640 calibration constant.
        img = frame["image"]
        frame_h, frame_w = (img.shape[0], img.shape[1]) if hasattr(img, "shape") else (None, None)

        try:
            results = model.predict(
                source=frame["image"],
                conf=settings.yolo_confidence_threshold,
                iou=settings.yolo_nms_iou_threshold,  # Slightly higher than ultralytics default 0.45 to merge split bboxes
                verbose=False,
            )
            frame_detections = []
            for result in results:
                for box in result.boxes:
                    cls_id = int(box.cls[0])
                    if cls_id not in _pothole_class_ids:
                        continue  # Skip non-pothole detections

                    det = {
                        "frame_index": frame["frame_index"],
                        "timestamp_sec": frame["timestamp_sec"],
                        "confidence": float(box.conf[0]),
                        "bbox": [round(x, 1) for x in box.xyxy[0].tolist()],
                        "class_name": model.names[cls_id],
                        "annotated_path": None,
                        # Real frame dims travel with each detection so the
                        # severity heuristic can calibrate dynamically.
                        "frame_width": int(frame_w) if frame_w else None,
                        "frame_height": int(frame_h) if frame_h else None,
                    }
                    frame_detections.append(det)

            if frame_detections and output_dir:
                # Draw bounding boxes on the frame and save
                annotated = frame["image"].copy()
                for det in frame_detections:
                    x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
                    conf = det["confidence"]
                    cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 2)
                    label = f"Pothole {conf:.0%}"
                    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)
                    cv2.rectangle(annotated, (x1, y1 - th - 8), (x1 + tw + 4, y1), (0, 0, 255), -1)
                    cv2.putText(annotated, label, (x1 + 2, y1 - 4),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)

                fname = f"frame_{frame['frame_index']:06d}.jpg"
                fpath = os.path.join(output_dir, fname)
                cv2.imwrite(fpath, annotated)

                # Store a relative path ("<upload_id>/<filename>" with forward
                # slashes) so the DB stays portable across machines. The on-disk
                # write above still uses the absolute path, but only the
                # relative form is persisted into pothole_events.
                rel_path = f"{os.path.basename(output_dir)}/{fname}"
                for det in frame_detections:
                    det["annotated_path"] = rel_path

                frames_with_detections.add(frame["frame_index"])

            detections.extend(frame_detections)

        except Exception as exc:
            print(f"[yolo_inference] Frame {frame['frame_index']} error: {exc}")

    print(
        f"[yolo_inference] {len(detections)} pothole detections across "
        f"{len(frames_with_detections)} frames (from {len(frames)} sampled)"
    )
    return detections
