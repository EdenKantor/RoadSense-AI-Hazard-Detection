"""
DBSCAN consolidation — geospatially correct implementation.

Groups nearby aligned detections into single pothole event clusters
using scikit-learn DBSCAN with the Haversine great-circle distance metric.

The clustering radius is configured in **meters** (not degrees), converted
to radians internally for Haversine compatibility.

Noise points (label == -1) are each treated as their own singleton event.

NOTE: Haversine metric requires coordinates in radians as [lat, lon].
"""
from typing import List, Dict, Any
import numpy as np

# Earth's mean radius in meters (WGS-84 approximation)
EARTH_RADIUS_M = 6_371_000


def consolidate_detections(
    aligned: List[Dict[str, Any]],
    eps_meters: float = 5.0,
    min_samples: int = 1,
) -> List[Dict[str, Any]]:
    """
    Cluster geographically nearby detections into pothole events.

    Uses Haversine (great-circle) distance so the radius is accurate
    regardless of latitude.  The epsilon is specified in **meters**.

    Args:
        aligned: Output of timestamp_align — list of detection dicts with lat/lon.
        eps_meters: Clustering radius in meters.  Default 5 m for
                    same-pothole duplicate suppression.
        min_samples: Minimum cluster size for DBSCAN (default 1 — every
                     detection, including singletons, becomes an event).

    Returns:
        List of cluster summary dicts:
            {
              "lat": float,          # Mean latitude of cluster
              "lon": float,          # Mean longitude of cluster
              "detection_count": int,
              "avg_confidence": float,
              "max_bbox_area": float, # Largest bbox in cluster (pixels^2)
              "detections": list,    # Raw detections in this cluster
            }
    """
    if not aligned:
        return []

    try:
        from sklearn.cluster import DBSCAN

        # Convert degrees -> radians (Haversine expects radians)
        coords_deg = np.array([[d["lat"], d["lon"]] for d in aligned])
        coords_rad = np.radians(coords_deg)

        # Convert eps from meters to radians: radians = meters / R
        eps_rad = eps_meters / EARTH_RADIUS_M

        labels = DBSCAN(
            eps=eps_rad,
            min_samples=min_samples,
            metric="haversine",
        ).fit_predict(coords_rad)

        clusters: Dict[int, List] = {}
        for label, detection in zip(labels, aligned):
            # Treat each noise point as its own singleton cluster
            key = label if label != -1 else -(id(detection))
            clusters.setdefault(key, []).append(detection)

        summaries = []
        for dets in clusters.values():
            lats = [d["lat"] for d in dets]
            lons = [d["lon"] for d in dets]
            confs = [d["confidence"] for d in dets]

            # Compute bbox area for each detection (pixels^2)
            bbox_areas = []
            for d in dets:
                bbox = d.get("bbox")
                if bbox and len(bbox) == 4:
                    w = abs(bbox[2] - bbox[0])
                    h = abs(bbox[3] - bbox[1])
                    bbox_areas.append(w * h)

            # Aggregate the real frame area across detections so severity
            # classification can use the actual video resolution. In practice
            # every detection in one upload has the same dims, but median is
            # robust to mixed-resolution edge cases. Falls back to None when
            # detections lack dims (legacy / synthetic test input).
            frame_areas = [
                int(d["frame_width"]) * int(d["frame_height"])
                for d in dets
                if d.get("frame_width") and d.get("frame_height")
            ]
            cluster_frame_area = float(np.median(frame_areas)) if frame_areas else None

            summary = {
                "lat": sum(lats) / len(lats),
                "lon": sum(lons) / len(lons),
                "detection_count": len(dets),
                "avg_confidence": sum(confs) / len(confs),
                "max_bbox_area": max(bbox_areas) if bbox_areas else 0.0,
                "detections": dets,
            }
            if cluster_frame_area:
                summary["frame_area"] = cluster_frame_area
            summaries.append(summary)

        print(
            f"[dbscan] {len(aligned)} detections => {len(summaries)} clusters "
            f"(eps={eps_meters}m, min_samples={min_samples})"
        )
        return summaries

    except Exception as exc:
        print(f"[dbscan] Error: {exc} -- returning each detection as singleton cluster.")
        return [
            {
                "lat": d["lat"],
                "lon": d["lon"],
                "detection_count": 1,
                "avg_confidence": d["confidence"],
                "max_bbox_area": 0.0,
                "detections": [d],
            }
            for d in aligned
        ]
