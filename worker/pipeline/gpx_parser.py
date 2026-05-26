"""
GPX parser.

Parses a .gpx file with the ``gpxpy`` library and returns a chronologically
sorted list of track points as dicts:
    [{"lat": float, "lon": float, "timestamp": datetime}, ...]

Track points without a timestamp are skipped because downstream timestamp
alignment requires a temporal reference for every sample. Returns an empty
list if parsing fails so the pipeline can degrade gracefully.
"""
from typing import List, Dict, Any
from datetime import datetime


def parse_gpx(gpx_path: str) -> List[Dict[str, Any]]:
    """
    Parse a GPX file and return a sorted list of track point samples.

    Args:
        gpx_path: Absolute or relative path to the .gpx file.

    Returns:
        List of dicts with keys: lat, lon, timestamp (datetime UTC).
        Returns an empty list if the file cannot be parsed.
    """
    try:
        import gpxpy
        with open(gpx_path, "r", encoding="utf-8") as f:
            gpx = gpxpy.parse(f)

        samples = []
        for track in gpx.tracks:
            for segment in track.segments:
                for point in segment.points:
                    if point.time is None:
                        continue
                    samples.append({
                        "lat": point.latitude,
                        "lon": point.longitude,
                        "timestamp": point.time,
                    })

        samples.sort(key=lambda p: p["timestamp"])
        return samples

    except Exception as exc:
        print(f"[gpx_parser] Failed to parse {gpx_path}: {exc}")
        return []
