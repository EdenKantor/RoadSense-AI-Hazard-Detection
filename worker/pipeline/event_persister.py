"""
Event persister — writes consolidated PotholeEvent documents to MongoDB.

Each cluster emitted by the DBSCAN consolidation stage becomes one
PotholeEvent document. Uses synchronous pymongo (RQ workers are
synchronous). Stores GeoJSON coordinates, detection metadata, and
preview asset paths.

Cross-upload dedup — merge-with-reopen
======================================
Whenever a new cluster lands within ``eps_meters`` of an existing event
(checked via a $nearSphere geo-query), the new cluster is MERGED into
that existing event rather than being inserted as a duplicate.

Lifecycle status decision matrix for the existing event:
    - Reported / UnderReview / Scheduled  -> MERGE in place.
    - Rejected                            -> MERGE in place (status preserved).
                                             A rejected event still grows its
                                             counters / frame refs; no
                                             lifecycle change.
    - Resolved                            -> REOPEN: set
                                             ``lifecycle_status`` back to
                                             ``Reported``, clear
                                             ``resolved_at``/``resolved_by``,
                                             append a row to
                                             ``event_status_history``, then
                                             MERGE.

Atomic ordering for merge (3-phase MongoDB update)
==================================================
    Phase 0 — seed ``_confidence_sum`` on legacy docs that pre-date the
              cumulative-confidence field (idempotent: only writes when
              ``$exists: false``).
    Phase 1 — atomic operator update: ``$inc`` detection_count and
              ``_confidence_sum``, ``$max`` max_bbox_area, ``$addToSet``
              contributing_uploads, ``$push`` frame_references and
              annotated_paths, ``$set`` last_seen_at / updated_at, plus
              the reopen mutations when applicable.
    Phase 2 — aggregation pipeline update: derive
              ``avg_confidence = _confidence_sum / detection_count``
              from the post-Phase-1 doc state, and ``$set`` severity /
              severity_score from the Python heuristic.

Observability
=============
Emits fine-grained Pub/Sub events for the dev dashboard:
    - ``event_created``  — a brand-new event was inserted.
    - ``event_merged``   — an existing event was enriched in place.
    - ``event_reopened`` — a Resolved event was re-opened then enriched.

All emission is best-effort; failures are swallowed.
"""
import uuid
import sys
import os
import json
import urllib.request
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from typing import List, Dict, Any
from datetime import datetime, timezone

from pipeline.severity_heuristic import compute_severity

# Best-effort import — observability never breaks the pipeline
try:
    from observability import publish_event as _publish_event  # type: ignore
except Exception:  # noqa: BLE001
    def _publish_event(*_args, **_kwargs):
        return None

_city_cache = {}


def _get_city(lat: float, lon: float) -> str:
    """
    Reverse geocode to get city name. Uses BigDataCloud free API.
    Retries once on failure. Returns "Unassigned" if geocoding fails entirely,
    which keeps the event visible to Admin but not routed to any zone team.
    """
    key = f"{lat:.4f},{lon:.4f}"
    if key in _city_cache:
        return _city_cache[key]

    import time
    for attempt in range(2):
        try:
            url = f"https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={lat}&longitude={lon}&localityLanguage=en"
            req = urllib.request.Request(url, headers={"User-Agent": "RoadSenseAI/1.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read())
            city = data.get("city") or data.get("locality") or None
            if city:
                _city_cache[key] = city
                return city
        except Exception as exc:
            print(f"[event_persister] Geocoding attempt {attempt+1} failed for ({lat},{lon}): {exc}")
            if attempt == 0:
                time.sleep(1)

    print(f"[event_persister] WARNING: Could not geocode ({lat},{lon}). Zone set to 'Unassigned'.")
    _city_cache[key] = "Unassigned"
    return "Unassigned"


def persist_events(
    db,
    upload_id: str,
    uploader_id: str,
    events: List[Dict[str, Any]],
    eps_meters: float = 5.0,
) -> tuple:
    """
    Insert PotholeEvent documents into MongoDB, skipping duplicates.

    Before inserting each event, checks if an existing event already exists
    within ``eps_meters`` using a $nearSphere query (requires a 2dsphere
    index on pothole_events.location).

    Args:
        db: pymongo Database instance.
        upload_id: The originating upload ID.
        uploader_id: Citizen who submitted the upload.
        events: List of cluster + severity dicts from compute_severity.
        eps_meters: Radius in meters for duplicate suppression (default 5.0).

    Returns:
        Tuple of (list of inserted event IDs, number of duplicates suppressed).
    """
    # Ensure 2dsphere index exists (idempotent)
    db["pothole_events"].create_index([("location", "2dsphere")])

    inserted_ids = []
    duplicates_suppressed = 0
    now = datetime.now(timezone.utc).isoformat()

    for event in events:
        # Check for existing nearby event within eps_meters
        try:
            existing = db["pothole_events"].find_one({
                "location": {
                    "$nearSphere": {
                        "$geometry": {
                            "type": "Point",
                            "coordinates": [event["lon"], event["lat"]],
                        },
                        "$maxDistance": eps_meters,
                    }
                }
            })
        except Exception as exc:
            print(f"[event_persister] Proximity check failed: {exc}")
            existing = None

        if existing:
            # Merge-with-reopen path: instead of dropping the new cluster,
            # fold its counts/frames into the matched event (and re-open it
            # if it was Resolved). The counter name `duplicates_suppressed`
            # is preserved for backward compatibility with the worker's
            # job_complete payload and the dev dashboard counters; it now
            # means "merged-or-reopened" rather than literally dropped.
            duplicates_suppressed += 1
            try:
                _merge_into_existing(
                    db=db,
                    existing=existing,
                    event=event,
                    upload_id=upload_id,
                    uploader_id=uploader_id,
                    eps_meters=eps_meters,
                    now=now,
                )
            except Exception as exc:  # noqa: BLE001
                print(
                    f"[event_persister] Merge failed for event {existing.get('_id')}: {exc}"
                )
            continue

        event_id = str(uuid.uuid4())

        # Collect unique annotated frame paths from detections in this cluster
        annotated_paths = []
        frame_refs = []
        for det in event.get("detections", []):
            frame_refs.append({
                "frame_index": det.get("frame_index"),
                "timestamp_sec": det.get("timestamp_sec"),
                "confidence": det.get("confidence"),
                "bbox": det.get("bbox"),
            })
            ap = det.get("annotated_path")
            if ap and ap not in annotated_paths:
                annotated_paths.append(ap)

        # Use first annotated frame as the representative preview
        preview_path = annotated_paths[0] if annotated_paths else None

        # Resolve city/zone for this event
        city = _get_city(event["lat"], event["lon"])

        # Auto-create the zone document if this is the first event for this
        # city. $setOnInsert leaves any admin-edited description on existing
        # zones untouched. "Unassigned" is skipped - we don't want a fake zone
        # for events whose geocode failed.
        if city and city != "Unassigned":
            try:
                db["zones"].update_one(
                    {"name": city},
                    {"$setOnInsert": {
                        "_id": str(uuid.uuid4()),
                        "name": city,
                        "description": f"{city} metropolitan area",
                        "created_at": now,
                        "auto_created": True,
                    }},
                    upsert=True,
                )
            except Exception as exc:
                print(f"[event_persister] Zone upsert for '{city}' failed: {exc}")

        doc = {
            "_id": event_id,
            "upload_id": upload_id,
            "uploader_id": uploader_id,
            "location": {
                "type": "Point",
                "coordinates": [event["lon"], event["lat"]],  # GeoJSON: [lon, lat]
            },
            "zone": city,
            "severity": event["severity"],
            "severity_score": event.get("severity_score", 0.0),
            "max_bbox_area": event.get("max_bbox_area", 0.0),
            # Persist the actual frame area so a future merge's severity
            # recomputation keeps the same calibration as this insert.
            "frame_area": event.get("frame_area"),
            "lifecycle_status": "Reported",
            "detection_count": event["detection_count"],
            "avg_confidence": round(event["avg_confidence"], 4),
            # Cumulative confidence sum kept alongside the average so a
            # concurrent merge can re-derive avg_confidence atomically
            # (avg = _confidence_sum / detection_count) without a
            # read-modify-write race.
            "_confidence_sum": event["detection_count"] * event["avg_confidence"],
            # Tracks every upload that contributed evidence to this event.
            # Seeded with the originating upload; merge appends via $addToSet.
            "contributing_uploads": [upload_id],
            "detected_at": now,
            "created_at": now,
            "updated_at": now,
            "last_seen_at": now,
            "frame_thumbnail_path": preview_path,
            "frame_references": frame_refs,
            "annotated_paths": annotated_paths,
        }

        try:
            db["pothole_events"].insert_one(doc)
            inserted_ids.append(event_id)
            _publish_event("event_created", {
                "upload_id": upload_id,
                "event_id": event_id,
                "severity": event.get("severity"),
                "zone": city,
                "location": {"lat": event["lat"], "lon": event["lon"]},
                # Enrichment for the dev dashboard: thumbnail + confidence so
                # the activity feed can render a 60x60 preview and confidence bar.
                "frame_thumbnail_path": preview_path,
                "avg_confidence": round(event["avg_confidence"], 4),
            })
        except Exception as exc:
            print(f"[event_persister] Failed to insert event {event_id}: {exc}")

    print(
        f"[event_persister] Persisted {len(inserted_ids)}/{len(events)} events "
        f"({duplicates_suppressed} duplicates suppressed)."
    )
    return inserted_ids, duplicates_suppressed


# ──────────────────────────────────────────────────────────────────────────
# Merge & re-open helpers
# ──────────────────────────────────────────────────────────────────────────

def _merge_into_existing(
    db,
    existing: Dict[str, Any],
    event: Dict[str, Any],
    upload_id: str,
    uploader_id: str,
    eps_meters: float,
    now: str,
) -> None:
    """
    Merge a new clustered event into an existing pothole_events doc.

    If the existing doc is ``Resolved``, it is re-opened first
    (``lifecycle_status`` -> ``Reported``, ``resolved_at``/``resolved_by``
    cleared, an ``event_status_history`` row appended). All other
    statuses (Reported, UnderReview, Scheduled, Rejected) are merged
    in place with no lifecycle change.

    Strategy: 3-phase MongoDB update.

        Phase 0 — seed ``_confidence_sum`` on legacy docs that pre-date
                  the field (idempotent: only runs when the field is
                  missing).
        Phase 1 — atomic operators: ``$inc`` detection_count and
                  ``_confidence_sum``, ``$max`` max_bbox_area,
                  ``$addToSet`` contributing_uploads, ``$push``
                  frame_references and annotated_paths, ``$set``
                  updated_at and last_seen_at, plus (on re-open)
                  ``$set`` lifecycle_status and ``$unset`` resolved_*.
        Phase 2 — aggregation-pipeline update: derive avg_confidence
                  from ``_confidence_sum / detection_count`` against
                  the post-Phase-1 doc state, then ``$set`` severity
                  and severity_score from the Python heuristic computed
                  on a synthetic combined cluster.

    Args:
        db: pymongo Database instance.
        existing: The matched pothole_events doc (as returned from
            ``find_one``).
        event: The new cluster + severity dict from ``compute_severity``.
        upload_id: ID of the upload contributing the new evidence.
        uploader_id: Citizen who submitted the contributing upload.
        eps_meters: Radius used for the proximity match — recorded in
            the reopen history note for traceability.
        now: ISO-8601 timestamp string used for all ``*_at`` fields and
            the history row, so a single merge has one consistent time.

    Concurrency:
        - Phase 1 is fully race-safe (every field uses an atomic
          operator); two concurrent merges produce the correct sums.
        - Phase 2 reads the post-Phase-1 doc state to compute
          avg_confidence atomically inside MongoDB. ``severity`` is the
          LAST writer's snapshot — slightly stale under concurrent
          merges — but the counters and confidence sum stay correct.

    Notes:
        Errors during the optional history insert and the Pub/Sub emit
        are logged but never raised. The caller (``persist_events``)
        also wraps this whole helper in a try/except so a single bad
        merge cannot fail the whole upload.
    """
    eid = existing["_id"]
    is_reopen = existing.get("lifecycle_status") == "Resolved"

    new_count_in = int(event.get("detection_count", 0)) or 0
    new_conf_in = float(event.get("avg_confidence", 0.0) or 0.0)
    new_max_bbox_in = float(event.get("max_bbox_area", 0.0) or 0.0)

    # Build new frame_refs / annotated_paths from the new event.
    new_frame_refs = []
    new_annotated_paths = []
    for det in event.get("detections", []):
        new_frame_refs.append({
            "frame_index": det.get("frame_index"),
            "timestamp_sec": det.get("timestamp_sec"),
            "confidence": det.get("confidence"),
            "bbox": det.get("bbox"),
        })
        ap = det.get("annotated_path")
        if ap and ap not in new_annotated_paths:
            new_annotated_paths.append(ap)

    # Compute the new severity Python-side using the existing heuristic.
    # Synthetic cluster combines the existing frame_references with the new
    # detections so compute_severity sees the full per-detection picture.
    combined_dets = list(existing.get("frame_references") or []) + [
        {"confidence": d.get("confidence"), "bbox": d.get("bbox")}
        for d in event.get("detections", [])
    ]
    old_count = int(existing.get("detection_count", 0)) or 0
    old_conf = float(existing.get("avg_confidence", 0.0) or 0.0)
    merged_count = old_count + new_count_in
    merged_avg = (
        ((old_count * old_conf) + (new_count_in * new_conf_in)) / merged_count
        if merged_count > 0 else 0.0
    )
    merged_max_bbox = max(float(existing.get("max_bbox_area", 0.0) or 0.0), new_max_bbox_in)

    # Pass frame_area through so the merge's severity recomputation uses
    # the same calibration as the original insert. Prefer the existing
    # doc's frame_area; fall back to the new event's; otherwise
    # compute_severity falls back to its config default (640x640).
    merged_frame_area = existing.get("frame_area") or event.get("frame_area")

    synthetic_cluster = {
        "lat": existing["location"]["coordinates"][1],
        "lon": existing["location"]["coordinates"][0],
        "detection_count": merged_count,
        "avg_confidence": merged_avg,
        "max_bbox_area": merged_max_bbox,
        "detections": combined_dets,
    }
    if merged_frame_area:
        synthetic_cluster["frame_area"] = merged_frame_area
    scored = compute_severity(synthetic_cluster)
    new_severity = scored.get("severity")
    new_severity_score = float(scored.get("severity_score", 0.0))

    # ── Phase 0: seed _confidence_sum on legacy docs (no-op if already present)
    db["pothole_events"].update_one(
        {"_id": eid, "_confidence_sum": {"$exists": False}},
        [{"$set": {
            "_confidence_sum": {
                "$multiply": [
                    {"$ifNull": ["$detection_count", 0]},
                    {"$ifNull": ["$avg_confidence", 0.0]},
                ]
            }
        }}],
    )

    # ── Phase 1: atomic operator update
    op_update: Dict[str, Any] = {
        "$inc": {
            "detection_count": new_count_in,
            "_confidence_sum": new_count_in * new_conf_in,
        },
        "$max": {"max_bbox_area": new_max_bbox_in},
        "$addToSet": {"contributing_uploads": upload_id},
        "$set": {"updated_at": now, "last_seen_at": now},
    }
    push: Dict[str, Any] = {}
    if new_frame_refs:
        push["frame_references"] = {"$each": new_frame_refs}
    if new_annotated_paths:
        # Filter out paths already on the existing doc to avoid trivial dups
        existing_paths = set(existing.get("annotated_paths") or [])
        fresh = [p for p in new_annotated_paths if p not in existing_paths]
        if fresh:
            push["annotated_paths"] = {"$each": fresh}
    if push:
        op_update["$push"] = push

    if is_reopen:
        op_update["$set"]["lifecycle_status"] = "Reported"
        op_update["$unset"] = {"resolved_at": "", "resolved_by": ""}

    db["pothole_events"].update_one({"_id": eid}, op_update)

    # ── Phase 2: derive avg_confidence + set severity / severity_score
    db["pothole_events"].update_one(
        {"_id": eid},
        [{"$set": {
            "avg_confidence": {
                "$cond": [
                    {"$gt": [{"$ifNull": ["$detection_count", 0]}, 0]},
                    {"$round": [
                        {"$divide": [
                            {"$ifNull": ["$_confidence_sum", 0]},
                            "$detection_count",
                        ]},
                        4,
                    ]},
                    0.0,
                ]
            },
            "severity": new_severity,
            "severity_score": round(new_severity_score, 3),
        }}],
    )

    # ── Status history row on re-open (separate collection, schema unchanged)
    if is_reopen:
        try:
            db["event_status_history"].insert_one({
                "_id": str(uuid.uuid4()),
                "event_id": eid,
                "changed_by": "system:auto-reopen",
                "changed_by_role": "System",
                "previous_status": "Resolved",
                "new_status": "Reported",
                "note": (
                    f"Auto-reopened: new detection from upload {upload_id} "
                    f"(uploader {uploader_id}) within {eps_meters}m of resolved event."
                ),
                "changed_at": now,
            })
        except Exception as exc:  # noqa: BLE001
            print(f"[event_persister] Failed to insert reopen history row: {exc}")

    # ── Pub/Sub event
    evt_type = "event_reopened" if is_reopen else "event_merged"
    payload: Dict[str, Any] = {
        "upload_id": upload_id,
        "event_id": str(eid),
        "merged_from_upload_id": upload_id,
        "location": {"lat": event["lat"], "lon": event["lon"]},
        "frame_thumbnail_path": existing.get("frame_thumbnail_path"),
        # Severity transition
        "previous_severity": existing.get("severity"),
        "severity": new_severity,
        # Confidence transition
        "previous_avg_confidence": (
            round(old_conf, 4) if existing.get("avg_confidence") is not None else None
        ),
        "avg_confidence": round(merged_avg, 4),
        # Detection count transition
        "previous_detection_count": old_count,
        "detection_count": merged_count,
        # Lifecycle status transition (Reported when re-opened, unchanged otherwise)
        "previous_status": existing.get("lifecycle_status"),
        "lifecycle_status": "Reported" if is_reopen else existing.get("lifecycle_status"),
    }
    print(
        f"[event_persister] {'Reopened' if is_reopen else 'Merged'}: "
        f"event {eid} now has detection_count={merged_count}, "
        f"avg_confidence={round(merged_avg, 4)}, severity={new_severity}"
    )
    _publish_event(evt_type, payload)
