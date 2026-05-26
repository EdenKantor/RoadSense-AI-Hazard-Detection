"""
Section 1 unit tests — YOLO threshold, frame sampling, NMS, FHWA-inspired severity.

Pure-Python tests, no MongoDB / no Docker dependency. They exercise the
production modules directly via synthetic input.
"""
from __future__ import annotations

import pytest

from config import settings
from pipeline.severity_heuristic import compute_severity


# ────────────────────────────────────────────────────────────────────────────
# Improvement A — confidence threshold 0.4 → 0.25
# ────────────────────────────────────────────────────────────────────────────

def test_confidence_threshold_filters_low_scores():
    """The redundant filter in worker/pipeline/job.py: confidence >= threshold."""
    # Section 1.5: threshold lowered from 0.25 → 0.20 to capture partial pothole pieces.
    threshold = 0.20
    raw = [{"confidence": 0.15}, {"confidence": 0.22}, {"confidence": 0.50}]
    filtered = [d for d in raw if d["confidence"] >= threshold]
    assert len(filtered) == 2
    assert filtered[0]["confidence"] == 0.22
    assert filtered[1]["confidence"] == 0.50


def test_config_default_threshold_is_020():
    """Section 1.5: threshold lowered from 0.25 → 0.20."""
    assert settings.yolo_confidence_threshold == pytest.approx(0.20)


# ────────────────────────────────────────────────────────────────────────────
# Improvement B — frame sampling 1.0 s → 0.5 s
# ────────────────────────────────────────────────────────────────────────────

def test_config_default_frame_interval_is_05():
    assert settings.frame_sample_interval_seconds == pytest.approx(0.5)
    # frame_sampler.py math: at 30 fps, interval_frames = max(1, int(30 * 0.5)) = 15.
    interval_frames = max(1, int(30.0 * settings.frame_sample_interval_seconds))
    assert interval_frames == 15
    # Sanity check: this is half the previous-default 30 → 2x more samples per video.
    assert interval_frames * 2 == int(30.0 * 1.0)


# ────────────────────────────────────────────────────────────────────────────
# Improvement F — NMS IoU = 0.5
# ────────────────────────────────────────────────────────────────────────────

def test_config_default_nms_iou_is_05():
    assert settings.yolo_nms_iou_threshold == pytest.approx(0.5)


# ────────────────────────────────────────────────────────────────────────────
# Improvement C — FHWA-inspired severity classification
# ────────────────────────────────────────────────────────────────────────────

def test_severity_low_confidence_returns_low():
    """Stage 1 floor: low confidence forces Low even when bbox would be High."""
    cluster = {"avg_confidence": 0.3, "max_bbox_area": 80_000, "detection_count": 5}
    result = compute_severity(cluster)
    assert result["severity"] == "Low"
    # severity_score in the floor branch == round(avg_conf, 3)
    assert result["severity_score"] == pytest.approx(0.3, abs=1e-3)


@pytest.mark.parametrize("bbox_area,expected", [
    (15_000, "Low"),     # 15000/409600 = 3.66 % → < LOW_RATIO 5 %
    (40_000, "Medium"),  # 40000/409600 = 9.77 % → in [5 %, 15 %)
    (80_000, "High"),    # 80000/409600 = 19.5 % → ≥ MEDIUM_RATIO
])
def test_severity_size_classification(bbox_area, expected):
    """Stage 2: bbox_area / 640² bucketed into Low / Medium / High."""
    cluster = {"avg_confidence": 0.6, "max_bbox_area": bbox_area, "detection_count": 1}
    assert compute_severity(cluster)["severity"] == expected


def test_severity_multi_detection_boost():
    """Stage 3: detection_count >= 3 bumps Low up to Medium."""
    cluster = {"avg_confidence": 0.6, "max_bbox_area": 15_000, "detection_count": 3}
    assert compute_severity(cluster)["severity"] == "Medium"


def test_severity_multi_detection_boost_caps_at_high():
    """Stage 3: High + boost stays High (no error, no overflow)."""
    cluster = {"avg_confidence": 0.6, "max_bbox_area": 80_000, "detection_count": 10}
    assert compute_severity(cluster)["severity"] == "High"


def test_severity_uses_config_values(monkeypatch):
    """Severity bands respond to runtime config overrides (no hardcoded numbers)."""
    cluster = {"avg_confidence": 0.6, "max_bbox_area": 25_000, "detection_count": 1}
    # Default LOW_RATIO=0.05: 25000/409600 = 6.1 % → Medium (in [5 %, 15 %)).
    assert compute_severity(cluster)["severity"] == "Medium"
    # Raise LOW_RATIO to 0.10: 6.1 % is now < 10 % → Low.
    monkeypatch.setattr(settings, "severity_low_ratio", 0.10)
    assert compute_severity(cluster)["severity"] == "Low"


def test_severity_zero_values():
    """All-zero edge case: should be Low without crashing."""
    cluster = {"avg_confidence": 0.0, "max_bbox_area": 0.0, "detection_count": 0}
    result = compute_severity(cluster)
    assert result["severity"] == "Low"
    assert result["severity_score"] == 0.0


# ────────────────────────────────────────────────────────────────────────────
# Section 1.5 — dynamic frame_area calibration
# ────────────────────────────────────────────────────────────────────────────

def test_severity_uses_dynamic_frame_area():
    """Same bbox in different frame resolutions classifies differently."""
    # 80,000 px² in a 1280x720 frame = 80000/921600 = 8.7 % → Medium
    cluster_hd = {
        "avg_confidence": 0.6,
        "max_bbox_area": 80_000,
        "detection_count": 1,
        "frame_area": 1280 * 720,
    }
    assert compute_severity(cluster_hd)["severity"] == "Medium"

    # Same 80,000 bbox in a 640x640 frame = 80000/409600 = 19.5 % → High
    cluster_sd = {
        "avg_confidence": 0.6,
        "max_bbox_area": 80_000,
        "detection_count": 1,
        "frame_area": 640 * 640,
    }
    assert compute_severity(cluster_sd)["severity"] == "High"


def test_severity_falls_back_to_config():
    """Cluster without frame_area falls back to settings.severity_frame_area."""
    cluster = {
        "avg_confidence": 0.6,
        "max_bbox_area": 80_000,
        "detection_count": 1,
        # no frame_area key — should fall back to config default 640*640
    }
    result = compute_severity(cluster)
    # 80000 / 409600 = 19.5 % → High under default 640*640 calibration
    assert result["severity"] == "High"
