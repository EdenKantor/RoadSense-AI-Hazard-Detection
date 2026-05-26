"""
Frame sampler.

Extracts frames from an MP4 file at a configurable interval (in seconds)
using OpenCV. The sampling interval in frames is derived from the video's
reported FPS, so the temporal spacing stays roughly constant across videos
recorded at different frame rates.

Returns a list of frame dicts:
    [{"frame_index": int, "timestamp_sec": float, "image": np.ndarray}, ...]
"""
from typing import List, Dict, Any
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from config import settings


def sample_frames(mp4_path: str) -> List[Dict[str, Any]]:
    """
    Sample frames from an MP4 file every FRAME_SAMPLE_INTERVAL_SECONDS seconds.

    Args:
        mp4_path: Path to the .mp4 file.

    Returns:
        List of frame dicts. Returns empty list on failure.
    """
    try:
        import cv2
        cap = cv2.VideoCapture(mp4_path)
        if not cap.isOpened():
            print(f"[frame_sampler] Cannot open video: {mp4_path}")
            return []

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        interval_frames = max(1, int(fps * settings.frame_sample_interval_seconds))

        frames = []
        frame_index = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_index % interval_frames == 0:
                frames.append({
                    "frame_index": frame_index,
                    "timestamp_sec": frame_index / fps,
                    "image": frame,
                })
            frame_index += 1

        cap.release()
        print(f"[frame_sampler] Sampled {len(frames)} frames from {mp4_path}")
        return frames

    except Exception as exc:
        print(f"[frame_sampler] Error: {exc}")
        return []
