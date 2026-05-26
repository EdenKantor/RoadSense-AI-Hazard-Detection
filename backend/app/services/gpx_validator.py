"""
GPX upload validator.

Server-side validation that runs at the API boundary before any persistence
or queue dispatch. Raises ``HTTPException(400)`` on the first failed rule so
a malformed GPX never reaches the worker pipeline (which would otherwise
emit events at coordinates ``(0, 0)`` due to its loose, fail-soft parser).

Rules (run in order, fail fast):
    1. content_type in an XML/octet-stream allowlist
    2. filename ends with ``.gpx``
    3. non-empty body
    4. body ≤ 5 MB
    5. body parses as XML
    6. at least one ``<trkpt>`` element exists (namespace-agnostic)
    7. every ``<trkpt>`` has ``lat`` ∈ [-90, 90] and ``lon`` ∈ [-180, 180]
    8. at least one ``<trkpt>`` has a ``<time>`` child whose text is
       ISO-8601 parseable

The worker's ``worker/pipeline/gpx_parser.py`` remains the downstream
safety net for anything that slips through (currently nothing should, but
the loose-parsing fallback is kept on purpose).
"""
from __future__ import annotations

import os
from datetime import datetime
from xml.etree import ElementTree as ET

from fastapi import HTTPException, UploadFile


_ALLOWED_CONTENT_TYPES = {
    "application/gpx+xml",
    "application/xml",
    "text/xml",
    "text/plain",
    "application/octet-stream",
}

_MAX_GPX_BYTES = 5 * 1024 * 1024  # 5 MB


def _local_name(tag: str) -> str:
    """Strip the ``{namespace}`` prefix from an ElementTree tag, if present."""
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def validate_gpx_upload(file: UploadFile, content: bytes) -> None:
    """Validate a GPX upload; raise ``HTTPException(400)`` on the first failure.

    Args:
        file: FastAPI ``UploadFile`` (or any duck-type with ``content_type``
            and ``filename`` attributes — tests pass a ``SimpleNamespace``).
        content: The full body bytes of the GPX file (already read by the
            router so the validator does not need to re-seek the file).

    Raises:
        HTTPException: status 400 with a descriptive ``detail`` for any
            failed rule. The router lets FastAPI serialise this as
            ``{"detail": "..."}``.
    """
    # Rule 1 — content type allowlist (case-insensitive).
    actual_ct = (file.content_type or "").lower()
    if actual_ct not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type for GPX file: {file.content_type}",
        )

    # Rule 2 — filename ends with .gpx (case-insensitive, basename-stripped).
    base = os.path.basename(file.filename or "").lower()
    if not base.endswith(".gpx"):
        raise HTTPException(
            status_code=400,
            detail="GPX filename must end with .gpx",
        )

    # Rule 3 — non-empty body.
    if len(content) == 0:
        raise HTTPException(
            status_code=400,
            detail="GPX file is empty",
        )

    # Rule 4 — size cap. Defence-in-depth against the frontend 5 MB picker
    # check; a client bypassing the JS limit still hits this server-side guard.
    if len(content) > _MAX_GPX_BYTES:
        raise HTTPException(
            status_code=400,
            detail="GPX file exceeds maximum size of 5 MB",
        )

    # Rule 5 — XML well-formedness.
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"GPX file is not valid XML: {exc}",
        )

    # Rule 6 — at least one <trkpt> exists, namespace-agnostic. GPX uses
    # xmlns="http://www.topografix.com/GPX/1/1" (or 1/0); ElementTree
    # prefixes tag names with the namespace, so we strip and compare local
    # name. ``root.iter()`` walks all descendants, not just direct children.
    trkpts = [elem for elem in root.iter() if _local_name(elem.tag) == "trkpt"]
    if not trkpts:
        raise HTTPException(
            status_code=400,
            detail="GPX file contains no trackpoints",
        )

    # Rule 7 — every trkpt has valid lat + lon, fail at the first offender.
    for i, trkpt in enumerate(trkpts):
        lat_raw = trkpt.attrib.get("lat")
        lon_raw = trkpt.attrib.get("lon")
        # latitude
        try:
            lat = float(lat_raw) if lat_raw is not None else None
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail=f"GPX trackpoint at index {i} has invalid latitude: {lat_raw}",
            )
        if lat is None or not (-90.0 <= lat <= 90.0):
            raise HTTPException(
                status_code=400,
                detail=f"GPX trackpoint at index {i} has invalid latitude: {lat_raw}",
            )
        # longitude
        try:
            lon = float(lon_raw) if lon_raw is not None else None
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail=f"GPX trackpoint at index {i} has invalid longitude: {lon_raw}",
            )
        if lon is None or not (-180.0 <= lon <= 180.0):
            raise HTTPException(
                status_code=400,
                detail=f"GPX trackpoint at index {i} has invalid longitude: {lon_raw}",
            )

    # Rule 8 — at least one <trkpt> has a parseable <time> child. Closes the
    # gap where a GPX with valid lat/lon but no <time> elements would
    # silently produce events at (0, 0) in the worker (timestamp_align falls
    # back to that fixed coordinate when the GPX sample list is empty).
    has_valid_time = False
    for trkpt in trkpts:
        for child in trkpt:
            if _local_name(child.tag) != "time":
                continue
            text = (child.text or "").strip()
            if not text:
                continue
            try:
                # datetime.fromisoformat understands offset-tagged strings
                # but not the trailing "Z" shorthand pre-3.11 — normalise it.
                datetime.fromisoformat(text.replace("Z", "+00:00"))
                has_valid_time = True
                break
            except (TypeError, ValueError):
                continue
        if has_valid_time:
            break

    if not has_valid_time:
        raise HTTPException(
            status_code=400,
            detail="GPX file contains no trackpoints with valid timestamps",
        )
