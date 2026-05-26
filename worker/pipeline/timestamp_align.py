"""
Timestamp alignment.

Maps each frame detection to a geographic coordinate by linearly
interpolating between the two nearest GPX track points by timestamp.
The GPX recording is assumed to start at the same instant as the video,
so the first GPX sample acts as the zero reference for the video clock.

Returns placeholder (0, 0) coordinates when GPX samples are unavailable,
allowing downstream stages to run in skeleton mode.
"""
from typing import List, Dict, Any
from datetime import datetime, timezone, timedelta


def _interpolate_coord(
    t: float,
    samples: List[Dict[str, Any]],
) -> Dict[str, float]:
    """
    Linearly interpolate (lat, lon) for a given video timestamp in seconds,
    assuming GPX recording started at the same moment as the video.

    Args:
        t: Seconds since start of video.
        samples: Sorted list of GPX samples from gpx_parser.

    Returns:
        {"lat": float, "lon": float}
    """
    if not samples:
        return {"lat": 0.0, "lon": 0.0}

    # Use the first GPX point as the zero reference
    t0 = samples[0]["timestamp"]
    target_dt = t0 + timedelta(seconds=t)

    # Find surrounding samples by timestamp
    prev = samples[0]
    for sample in samples[1:]:
        if sample["timestamp"] >= target_dt:
            next_s = sample
            # Linear interpolation factor
            span = (next_s["timestamp"] - prev["timestamp"]).total_seconds()
            if span < 1e-9:
                return {"lat": prev["lat"], "lon": prev["lon"]}
            alpha = (target_dt - prev["timestamp"]).total_seconds() / span
            lat = prev["lat"] + alpha * (next_s["lat"] - prev["lat"])
            lon = prev["lon"] + alpha * (next_s["lon"] - prev["lon"])
            return {"lat": lat, "lon": lon}
        prev = sample

    # Beyond end of GPX track — use last known point
    return {"lat": samples[-1]["lat"], "lon": samples[-1]["lon"]}


def align_detections_to_gpx(
    detections: List[Dict[str, Any]],
    gpx_samples: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Attach an interpolated geographic coordinate to each detection.

    Args:
        detections: List of detection dicts each containing a
            ``timestamp_sec`` (seconds since video start).
        gpx_samples: Sorted list of GPX samples from ``gpx_parser.parse_gpx``.

    Returns:
        List of detection dicts enriched with ``lat`` and ``lon`` keys.
    """
    aligned = []
    for det in detections:
        coord = _interpolate_coord(det["timestamp_sec"], gpx_samples)
        aligned.append({**det, **coord})
    return aligned
