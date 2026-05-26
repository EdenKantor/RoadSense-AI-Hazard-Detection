"""
Dev-only observability dashboard backend.

This router is mounted at ``/api/dev/observability`` ONLY when
``settings.dev_mode`` is True. When DEV_MODE is False the router is not
mounted at all — any request to it returns 404.

Three async background tasks make this work, started by ``start_background_tasks``
on FastAPI app startup and cancelled by ``stop_background_tasks`` on shutdown:

1. **Redis Pub/Sub subscriber** — listens on channel ``roadsense:pipeline``
   and pushes received events into ``_event_bus`` (an asyncio.Queue).
2. **Aggregator** — polls RQ + MongoDB every 1 second and produces three
   snapshot events (queue, workers, mongo). Pushes them into ``_event_bus``.
3. **SSE endpoint** ``GET /stream`` — drains ``_event_bus`` and yields events
   to the browser using ``sse-starlette``. Heartbeats every 15 s.

Failures in any background task are logged at WARNING and the task self-restarts
after a short backoff. Observability tasks never crash the app.
"""
from __future__ import annotations

# ── Windows multiprocessing fork→spawn patch (must run before any `rq` import) ─
# RQ 2.x's scheduler module does ``get_context('fork').Process`` at import time
# which crashes on Windows. We register the spawn context under the name "fork"
# so that import succeeds. Only the worker's queue_setup.py applies this in the
# worker process; the backend needs its own copy here because the aggregator
# imports rq.Queue / rq.Worker / rq.registry from a worker thread.
import multiprocessing
import multiprocessing.context
import sys as _sys
if _sys.platform == "win32" and "fork" not in multiprocessing.context._concrete_contexts:
    _ctx = multiprocessing.get_context("spawn")
    multiprocessing.context._concrete_contexts["fork"] = _ctx
# ────────────────────────────────────────────────────────────────────────────────

import asyncio
import json
import logging
from collections import deque
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from app.config import settings
from app.database import get_db

logger = logging.getLogger("roadsense.dev_observability")

router = APIRouter()

# ───────────────────────────── module state ─────────────────────────────────
# These are intentionally module-level globals because the SSE endpoint, the
# Pub/Sub subscriber, and the aggregator all share them within one app process.

# Bounded async event bus. Each item is a tuple of (event_name, payload_dict).
_event_bus: "asyncio.Queue[tuple[str, Dict[str, Any]]]" = asyncio.Queue(maxsize=1000)

# Tracks the *latest* stage per worker so we can fill `current_upload_id` /
# `current_stage_id` on the worker_snapshot. Updated by the pubsub subscriber.
# { worker_id: {"upload_id": str, "stage_id": str} }
_worker_state: Dict[str, Dict[str, Any]] = {}

# Background tasks (set by start_background_tasks)
_subscriber_task: Optional[asyncio.Task] = None
_aggregator_task: Optional[asyncio.Task] = None
_shutdown_event: Optional[asyncio.Event] = None

CHANNEL = "roadsense:pipeline"


# ────────────────────────────── helpers ─────────────────────────────────────
def _now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string with a trailing ``Z``."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _put_event_nowait(name: str, payload: Dict[str, Any]) -> None:
    """Push to _event_bus without blocking. Drop oldest on overflow."""
    try:
        _event_bus.put_nowait((name, payload))
    except asyncio.QueueFull:
        try:
            _event_bus.get_nowait()  # drop oldest
            _event_bus.put_nowait((name, payload))
        except Exception:  # noqa: BLE001
            pass


# ────────────────────────────── pub/sub subscriber ─────────────────────────
async def _subscriber_loop(shutdown: asyncio.Event) -> None:
    """Subscribe to roadsense:pipeline and forward events to the bus.

    Uses redis.asyncio so we don't block the event loop. Auto-reconnects on
    error with a short backoff. Never raises out of the task.
    """
    import redis.asyncio as aioredis
    backoff = 1.0
    while not shutdown.is_set():
        try:
            client = aioredis.from_url(settings.redis_url)
            pubsub = client.pubsub()
            await pubsub.subscribe(CHANNEL)
            logger.info("[dev_observability] subscribed to channel %s", CHANNEL)
            backoff = 1.0  # reset on success
            async for msg in pubsub.listen():
                if shutdown.is_set():
                    break
                if msg.get("type") != "message":
                    continue
                try:
                    raw = msg.get("data")
                    if isinstance(raw, (bytes, bytearray)):
                        raw = raw.decode("utf-8", errors="replace")
                    payload = json.loads(raw)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[dev_observability] bad pubsub payload: %s", exc)
                    continue

                # Track per-worker current stage for the workers panel
                worker_id = payload.get("worker_id")
                evt_type = payload.get("event_type")
                if worker_id:
                    state = _worker_state.setdefault(worker_id, {})
                    if evt_type == "stage_start":
                        state["upload_id"] = payload.get("upload_id")
                        state["stage_id"] = payload.get("stage_id")
                    elif evt_type in ("job_complete", "job_failed"):
                        state["upload_id"] = None
                        state["stage_id"] = None

                # Route Mongo activity to mongo_event, everything else to pipeline_progress.
                # event_merged and event_reopened are the modern pub/sub events emitted by
                # the worker; dedup_hit is preserved as a legacy alias so older clients that
                # filter on it keep working.
                if evt_type in ("event_created", "dedup_hit", "event_merged", "event_reopened"):
                    _put_event_nowait("mongo_event", {"source": "pubsub", "inner": payload})
                else:
                    _put_event_nowait("pipeline_progress", {"source": "pubsub", "inner": payload})

        except asyncio.CancelledError:
            break
        except Exception as exc:  # noqa: BLE001
            logger.warning("[dev_observability] subscriber error (%s); retrying in %.1fs", exc, backoff)
            try:
                await asyncio.wait_for(shutdown.wait(), timeout=backoff)
            except asyncio.TimeoutError:
                pass
            backoff = min(backoff * 2, 30.0)


# ────────────────────────────── aggregator (1-s poll) ──────────────────────
async def _aggregator_loop(shutdown: asyncio.Event) -> None:
    """Every 1 second, emit queue_snapshot + worker_snapshot + mongo_snapshot."""
    import redis as sync_redis
    from rq import Worker, Queue
    from rq.registry import StartedJobRegistry, FinishedJobRegistry, FailedJobRegistry

    # Track recent events emitted in the current SSE session for dedup_hit count
    while not shutdown.is_set():
        try:
            # Run blocking RQ + Mongo work in a thread pool slot
            payloads = await asyncio.to_thread(_compute_snapshots,
                                               sync_redis, Worker, Queue,
                                               StartedJobRegistry, FinishedJobRegistry, FailedJobRegistry)
            for evt_name, evt_payload in payloads:
                _put_event_nowait(evt_name, evt_payload)
        except asyncio.CancelledError:
            break
        except Exception as exc:  # noqa: BLE001
            logger.warning("[dev_observability] aggregator error: %s", exc)

        try:
            await asyncio.wait_for(shutdown.wait(), timeout=1.0)
        except asyncio.TimeoutError:
            pass


def _compute_snapshots(sync_redis_module, Worker, Queue,
                       StartedJobRegistry, FinishedJobRegistry, FailedJobRegistry):
    """Synchronous snapshot computation (intended to run in a worker thread).

    Builds three independent snapshots — queue counts + pending IDs, the list
    of RQ workers with their current job/state, and recent Mongo
    pothole_events plus a dedup-suppression rollup. Each snapshot is
    isolated in its own ``try``/``except`` so a failure in one section
    (e.g. Mongo unreachable) does not prevent the others from being emitted.

    Returns:
        A list of ``(event_name, payload)`` tuples ready to push onto the
        async event bus.
    """
    out: list[tuple[str, Dict[str, Any]]] = []
    now = _now_iso()

    # ── Queue snapshot ──────────────────────────────────────────────────
    try:
        conn = sync_redis_module.from_url(settings.redis_url, socket_timeout=2.0)
        q = Queue("roadsense", connection=conn)
        started_reg = StartedJobRegistry(queue=q)
        finished_reg = FinishedJobRegistry(queue=q)
        failed_reg = FailedJobRegistry(queue=q)

        pending = q.count
        started = started_reg.count
        finished = finished_reg.count
        failed = failed_reg.count

        pending_ids = list(q.get_job_ids())[:20]

        out.append(("queue_snapshot", {
            "timestamp": now,
            "counts": {"pending": pending, "started": started, "finished": finished, "failed": failed},
            "pending_job_ids": pending_ids,
        }))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[dev_observability] queue snapshot failed: %s", exc)

    # ── Worker snapshot ────────────────────────────────────────────────
    try:
        conn = sync_redis_module.from_url(settings.redis_url, socket_timeout=2.0)
        rq_workers = Worker.all(connection=conn)
        workers_out = []
        for w in rq_workers:
            wid = w.name
            tracked = _worker_state.get(wid, {})
            workers_out.append({
                "worker_id": wid,
                "status": "busy" if w.get_state() == "busy" else "idle",
                "current_job_id": w.get_current_job_id(),
                "jobs_processed_total": int(getattr(w, "successful_job_count", 0) or 0),
                "current_upload_id": tracked.get("upload_id"),
                "current_stage_id": tracked.get("stage_id"),
            })
        # Sort by name so the dashboard ordering is stable
        workers_out.sort(key=lambda x: x["worker_id"])
        out.append(("worker_snapshot", {
            "timestamp": now,
            "workers": workers_out,
        }))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[dev_observability] worker snapshot failed: %s", exc)

    # ── Mongo snapshot ─────────────────────────────────────────────────
    try:
        import pymongo
        client = pymongo.MongoClient(settings.mongodb_url, serverSelectionTimeoutMS=2000)
        mdb = client[settings.mongodb_db_name]

        cursor = mdb["pothole_events"].find(
            {},
            {"_id": 1, "severity": 1, "zone": 1, "location": 1, "created_at": 1},
        ).sort("created_at", -1).limit(20)
        recent = []
        for doc in cursor:
            loc = doc.get("location") or {}
            coords = loc.get("coordinates") or [None, None]
            recent.append({
                "event_id": str(doc.get("_id")),
                "severity": doc.get("severity"),
                "zone": doc.get("zone"),
                "location": {"lat": coords[1], "lon": coords[0]},
                "created_at": doc.get("created_at"),
            })

        # Sum duplicates_suppressed across uploads finished in the last hour
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        dedup_total = 0
        for u in mdb["uploads"].find(
            {"status": "Done", "updated_at": {"$gte": cutoff}},
            {"processing_stats.duplicates_suppressed": 1},
        ):
            ps = u.get("processing_stats") or {}
            dedup_total += int(ps.get("duplicates_suppressed") or 0)

        out.append(("mongo_snapshot", {
            "timestamp": now,
            "recent_events": recent,
            "dedup_suppressed_last_hour": dedup_total,
        }))
        client.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[dev_observability] mongo snapshot failed: %s", exc)

    return out


# ────────────────────────────── lifecycle (called by main.py) ──────────────
def start_background_tasks() -> None:
    """Spawn subscriber + aggregator. Idempotent."""
    global _subscriber_task, _aggregator_task, _shutdown_event
    if _shutdown_event is None:
        _shutdown_event = asyncio.Event()
    if _subscriber_task is None or _subscriber_task.done():
        _subscriber_task = asyncio.create_task(_subscriber_loop(_shutdown_event), name="obs-subscriber")
    if _aggregator_task is None or _aggregator_task.done():
        _aggregator_task = asyncio.create_task(_aggregator_loop(_shutdown_event), name="obs-aggregator")
    logger.info("[dev_observability] background tasks started")


async def stop_background_tasks() -> None:
    """Signal shutdown and await both tasks. Safe to call multiple times."""
    global _subscriber_task, _aggregator_task, _shutdown_event
    if _shutdown_event is not None:
        _shutdown_event.set()
    for task in (_subscriber_task, _aggregator_task):
        if task is None:
            continue
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
    _subscriber_task = None
    _aggregator_task = None
    _shutdown_event = None
    logger.info("[dev_observability] background tasks stopped")


# ────────────────────────────── SSE endpoint ───────────────────────────────
@router.get("/observability/stream")
async def observability_stream(request: Request):
    """Server-Sent Events endpoint. Drains the event bus and emits to client.

    Heartbeats every 15 seconds keep the connection alive across proxies.
    """
    async def event_generator():
        last_heartbeat = asyncio.get_event_loop().time()
        # Send an initial heartbeat immediately so the client flips to "Connected"
        yield {"event": "heartbeat", "data": json.dumps({"timestamp": _now_iso()})}

        while True:
            if await request.is_disconnected():
                break

            # Wait for an event with a short timeout so we can also send heartbeats
            try:
                evt_name, evt_payload = await asyncio.wait_for(_event_bus.get(), timeout=1.0)
                yield {"event": evt_name, "data": json.dumps(evt_payload, default=str)}
            except asyncio.TimeoutError:
                pass

            now = asyncio.get_event_loop().time()
            if now - last_heartbeat >= 15.0:
                yield {"event": "heartbeat", "data": json.dumps({"timestamp": _now_iso()})}
                last_heartbeat = now

    return EventSourceResponse(event_generator())
