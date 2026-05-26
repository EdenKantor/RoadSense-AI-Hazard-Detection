"""
Pipeline observability — Redis Pub/Sub publisher for the worker.

Worker code calls `publish_event(event_type, payload)` at stage boundaries.
The function is **best-effort**: any failure (Redis unreachable, network blip,
serialization error, anything else) is logged at WARNING level and swallowed.
The pipeline must never break because observability failed.

Channel: roadsense:pipeline
Encoding: JSON string, UTF-8

Each published payload is augmented with:
- event_type
- timestamp (ISO-8601 UTC)
- worker_id (from caller, defaults to env WORKER_NAME or "worker-unknown")

The publisher creates a single module-level Redis client lazily on first use.
This is a pub/sub-only client; it does NOT compete with the RQ-queue Redis
connection and does not need to be in the same connection pool.
"""
import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any, Optional

from config import settings

logger = logging.getLogger("roadsense.observability")

CHANNEL = "roadsense:pipeline"

_redis_client: Optional[Any] = None
_redis_lock = threading.Lock()


def _get_client():
    """Lazily build a Redis client. Module-level cache, thread-safe init.

    Returns None on any error so that publish_event can short-circuit.
    """
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    with _redis_lock:
        if _redis_client is not None:
            return _redis_client
        try:
            import redis
            _redis_client = redis.from_url(settings.redis_url, socket_timeout=2.0)
            return _redis_client
        except Exception as exc:  # noqa: BLE001 — broad on purpose, don't break pipeline
            logger.warning("[observability] Could not build Redis client: %s", exc)
            _redis_client = None
            return None


def _resolve_worker_id(explicit: Optional[str]) -> str:
    """Resolve the worker id used to tag pipeline events.

    Args:
        explicit: Worker id passed by the caller. Wins if non-empty.

    Returns:
        The explicit value, else ``WORKER_NAME`` from the environment, else
        the placeholder ``"worker-unknown"``.
    """
    if explicit:
        return explicit
    env_name = os.environ.get("WORKER_NAME")
    if env_name:
        return env_name
    return "worker-unknown"


def publish_event(event_type: str, payload: dict, *, worker_id: Optional[str] = None) -> None:
    """Publish a pipeline event. Best-effort, never raises.

    `payload` is shallow-copied; the function injects `event_type`, `timestamp`,
    and `worker_id` automatically. Caller-supplied values for those keys win.
    """
    if not settings.enable_observability:
        return

    try:
        envelope = {
            "event_type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "worker_id": _resolve_worker_id(worker_id),
        }
        envelope.update(payload or {})
        client = _get_client()
        if client is None:
            return
        client.publish(CHANNEL, json.dumps(envelope, default=str))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[observability] publish_event failed (%s): %s", event_type, exc)
