"""
Pothole severity classification.

Approach inspired by:
- FHWA Distress Identification Manual (FHWA-RD-03-031)
- "Pothole detection with YOLOv8" (Roboflow + FHWA classification, 2023)

FHWA defines pothole severity by diameter (cm) and depth (cm):
    Low:    diameter < 30 cm, depth < 2.5 cm
    Medium: diameter 30-90 cm, depth 2.5-5 cm
    High:   diameter > 90 cm, depth > 5 cm

Since monocular dashcam cannot measure depth, this implementation uses
bbox-area-ratio (bbox_area / SEVERITY_FRAME_AREA) as a proxy for diameter:
    diameter ~ 30 cm  → bbox_ratio ~ 5%
    diameter ~ 90 cm  → bbox_ratio ~ 15%

A confidence floor prevents low-quality detections from being classified
as severe. A multi-detection boost rewards potholes seen consistently
across frames or uploads.

Limitations:
- Bbox-area-ratio assumes a roughly downward-facing camera angle.
- No depth measurement (would require RGBD camera or LIDAR).
- SEVERITY_FRAME_AREA is a CALIBRATION constant (640x640), not the
  literal frame resolution. The bboxes coming out of YOLO are in original
  image coordinates, so the ratio computed here is "bbox in px² divided
  by 640² as a calibrated reference"; severity bands are tuned for that
  reference. Real frames at 720p / 1080p will yield slightly different
  raw ratios — adjust SEVERITY_LOW_RATIO / SEVERITY_MEDIUM_RATIO if you
  re-tune the model on a different resolution.

Implements FHWA-inspired severity classification using bbox area ratio as a
proxy for pothole diameter. The function signature is unchanged so every
caller (event_persister._merge_into_existing, job.py Stage 7) keeps working
without modification.
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from typing import Dict, Any

from config import settings


def compute_severity(cluster: Dict[str, Any]) -> Dict[str, Any]:
    """
    Classify a clustered pothole detection into Low / Medium / High severity.

    Reads from ``cluster``: avg_confidence, max_bbox_area, detection_count.
    Returns a NEW dict that is the union of ``cluster`` + ``severity`` + ``severity_score``.

    Three stages:
      1. Confidence floor — below settings.severity_confidence_floor, the cluster
         is always Low regardless of size or count. Prevents low-quality detections
         from being classified as severe.
      2. Size bucket (FHWA-inspired) — bbox_area / severity_frame_area bucketed
         against severity_low_ratio and severity_medium_ratio.
      3. Multi-detection boost — if detection_count >= severity_multi_detection_boost,
         bump severity up one level (Low → Medium, Medium → High, High stays).

    severity_score is a 0.0-1.0 number representing position within the size
    scale, with a +0.1 bonus when the multi-detection boost fires.
    """
    avg_conf = float(cluster.get("avg_confidence", 0.0) or 0.0)
    max_bbox = float(cluster.get("max_bbox_area", 0.0) or 0.0)
    det_count = int(cluster.get("detection_count", 0) or 0)

    # Stage 1 — confidence floor
    if avg_conf < settings.severity_confidence_floor:
        return {**cluster, "severity": "Low", "severity_score": round(avg_conf, 3)}

    # Stage 2 — size-based bucket
    # Prefer the cluster's actual frame_area (computed from the real video
    # resolution in dbscan_consolidation) and fall back to the config
    # calibration constant only when missing (legacy clusters, synthetic
    # test input).
    frame_area = cluster.get("frame_area") or settings.severity_frame_area
    bbox_ratio = max_bbox / frame_area if frame_area else 0.0
    if bbox_ratio < settings.severity_low_ratio:
        severity = "Low"
    elif bbox_ratio < settings.severity_medium_ratio:
        severity = "Medium"
    else:
        severity = "High"

    severity_score = (
        min(bbox_ratio / settings.severity_medium_ratio, 1.0)
        if settings.severity_medium_ratio
        else 0.0
    )

    # Stage 3 — multi-detection boost
    if det_count >= settings.severity_multi_detection_boost:
        severity = _bump_severity_up(severity)
        severity_score = min(severity_score + 0.1, 1.0)

    return {**cluster, "severity": severity, "severity_score": round(severity_score, 3)}


def _bump_severity_up(level: str) -> str:
    """Bump severity one level up (Low→Medium, Medium→High, High stays High)."""
    if level == "Low":
        return "Medium"
    if level == "Medium":
        return "High"
    return "High"
