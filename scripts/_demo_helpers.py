"""
Shared helpers for the demo-seed scripts.

Stdlib-only HTTP client (urllib) plus a handful of small utilities used by
``seed_full_demo.py``. No third-party dependencies beyond what the backend
already imports.

Public API:
    load_backend_env(backend_dir)                          -> dict[str, str]
    bearer_headers(token)                                  -> dict[str, str]
    api_get(path, token=None)                              -> Any
    api_post(path, payload, token=None)                    -> Any
    api_patch(path, payload, token)                        -> Any
    api_post_multipart(path, fields, files, token)         -> Any
    login(email, password)                                 -> JWT (str)
    poll_until_done(upload_id, token, timeout_sec=300,
                    poll_every=2.0, report_every=10.0,
                    label="")                              -> (status, error_message, elapsed_seconds)
    reverse_geo_with_fallback(lat, lon)                    -> str | None
    parse_gpx_middle_point(gpx_path)                       -> (lat, lon)
    tag_demo_seed(db, collection, doc_id)                  -> None
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
import urllib.error
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Endpoint base — overridable for tests but a constant in normal runs.
# ---------------------------------------------------------------------------
API_BASE = "http://localhost:8000/api"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_UA = "RoadSenseAI-DemoSeed/1.0"


# ---------------------------------------------------------------------------
# Backend .env loader
# ---------------------------------------------------------------------------
def load_backend_env(backend_dir: Path) -> dict[str, str]:
    """Parse ``backend/.env`` into a flat dict. Returns ``{}`` if the file is
    missing — callers must fall back to their own defaults.

    Stdlib-only mirror of ``scripts/create_admin.py:parse_env_file`` so the
    demo scripts pick up the **same** REDIS_URL / MONGODB_URL values the
    running backend uses, regardless of which directory the script is
    invoked from. The backend uses ``pydantic-settings`` which only reads
    ``.env`` from the current working directory; that breaks when scripts
    run from project-root, so we read the file ourselves.

    Handles: missing file (returns ``{}``), blank lines, comment lines
    starting with ``#``, lines without ``=`` (skipped), surrounding single
    or double quotes (stripped). No exceptions raised on malformed lines.
    """
    out: dict[str, str] = {}
    env_file = backend_dir / ".env"
    if not env_file.exists():
        return out
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


# ---------------------------------------------------------------------------
# HTTP plumbing
# ---------------------------------------------------------------------------
def bearer_headers(token: str | None) -> dict[str, str]:
    if token is None:
        return {}
    return {"Authorization": f"Bearer {token}"}


def _request(method: str, path: str, *, headers: dict[str, str] | None = None,
             data: bytes | None = None, timeout: float = 30.0) -> Any:
    """Low-level wrapper. Returns parsed JSON, or text if not JSON."""
    url = f"{API_BASE}{path}" if path.startswith("/") else path
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} -> {exc.code}: {body}") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{method} {path} -> network error: {exc.reason}") from None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw.decode("utf-8", errors="replace")


def api_get(path: str, token: str | None = None) -> Any:
    return _request("GET", path, headers=bearer_headers(token))


def api_post(path: str, payload: dict | None, token: str | None = None) -> Any:
    headers = bearer_headers(token)
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    return _request("POST", path, headers=headers, data=data)


def api_patch(path: str, payload: dict, token: str) -> Any:
    headers = bearer_headers(token)
    headers["Content-Type"] = "application/json"
    return _request("PATCH", path, headers=headers, data=json.dumps(payload).encode("utf-8"))


def login(email: str, password: str) -> str:
    """OAuth2 password flow against ``POST /api/auth/login``. Returns JWT."""
    body = urllib.parse.urlencode({"username": email, "password": password}).encode("utf-8")
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    res = _request("POST", "/auth/login", headers=headers, data=body)
    if not isinstance(res, dict) or "access_token" not in res:
        raise RuntimeError(f"login({email}) returned unexpected: {res!r}")
    return res["access_token"]


# ---------------------------------------------------------------------------
# Multipart upload
# ---------------------------------------------------------------------------
def api_post_multipart(path: str, fields: dict[str, str], files: dict[str, Path],
                       token: str) -> Any:
    """Hand-rolled multipart/form-data POST.

    ``files`` maps form-field-name -> filesystem Path; the binary content is
    read and inlined with a generated boundary so the backend's UploadFile
    handler accepts it. We avoid ``requests`` (not in backend venv) and stay
    on stdlib urllib.
    """
    boundary = f"----RoadSenseDemoSeed{uuid.uuid4().hex}"
    body_parts: list[bytes] = []
    for name, value in fields.items():
        body_parts.append(f"--{boundary}\r\n".encode("utf-8"))
        body_parts.append(
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        body_parts.append(value.encode("utf-8"))
        body_parts.append(b"\r\n")
    for name, file_path in files.items():
        filename = file_path.name
        content_type = _content_type_for(filename)
        body_parts.append(f"--{boundary}\r\n".encode("utf-8"))
        body_parts.append(
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        body_parts.append(file_path.read_bytes())
        body_parts.append(b"\r\n")
    body_parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(body_parts)

    headers = bearer_headers(token)
    headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    headers["Content-Length"] = str(len(body))
    # Uploads can be big and the server has to finish writing to disk before
    # responding; bump the urllib timeout accordingly.
    return _request("POST", path, headers=headers, data=body, timeout=120.0)


def _content_type_for(filename: str) -> str:
    lower = filename.lower()
    if lower.endswith(".mp4"):
        return "video/mp4"
    if lower.endswith(".gpx"):
        return "application/gpx+xml"
    return "application/octet-stream"


# ---------------------------------------------------------------------------
# Polling
# ---------------------------------------------------------------------------
def poll_until_done(upload_id: str, token: str, timeout_sec: int = 300,
                    poll_every: float = 2.0, report_every: float = 10.0,
                    label: str = "") -> tuple[str, str | None, int]:
    """Block until ``upload_id`` reaches Done or Failed (or timeout).

    Polls every ``poll_every`` seconds but only emits a status line every
    ``report_every`` seconds OR on every status transition (whichever comes
    first). The ``label`` is the line prefix (e.g. ``"Upload 1/6 (Haifa)"``);
    if empty, falls back to the upload-id prefix.

    Returns ``(final_status, error_message, elapsed_seconds)``.
    ``error_message`` is ``None`` on Done. Raises RuntimeError on timeout.
    """
    deadline = time.monotonic() + timeout_sec
    start = time.monotonic()
    last_status = ""
    last_report_at = -report_every  # forces a print on the very first poll
    prefix = label if label else f"    [poll] {upload_id[:8]}"

    while time.monotonic() < deadline:
        res = api_get(f"/uploads/{upload_id}/status", token=token)
        if not isinstance(res, dict):
            raise RuntimeError(f"status poll returned non-dict for {upload_id}: {res!r}")
        status = res.get("status", "")
        elapsed = int(time.monotonic() - start)
        if status != last_status or (elapsed - last_report_at >= report_every):
            print(f"  {prefix}: status={status}, elapsed={elapsed}s")
            last_status = status
            last_report_at = elapsed
        if status == "Done":
            return ("Done", None, elapsed)
        if status == "Failed":
            return ("Failed", res.get("error_message"), elapsed)
        time.sleep(poll_every)
    raise RuntimeError(
        f"Upload {upload_id} did not reach Done/Failed within {timeout_sec}s "
        f"(last status: {last_status!r}). Is the worker running?")


# ---------------------------------------------------------------------------
# Reverse-geocode (BigDataCloud via backend → Nominatim fallback)
# ---------------------------------------------------------------------------
def reverse_geo_with_fallback(lat: float, lon: float) -> str | None:
    """Resolve a coordinate to a city name. Tries backend first, then Nominatim."""
    # Primary: backend's /api/geocode/city
    try:
        res = api_get(f"/geocode/city?lat={lat}&lon={lon}")
        if isinstance(res, dict) and res.get("city"):
            return res["city"]
    except Exception as exc:
        print(f"    [reverse-geo] backend lookup failed: {exc}")

    # Fallback: direct Nominatim
    try:
        qs = urllib.parse.urlencode({
            "lat": lat, "lon": lon,
            "format": "json", "zoom": "10",
            "accept-language": "en",
        })
        url = f"{NOMINATIM_URL}?{qs}"
        req = urllib.request.Request(url, headers={"User-Agent": NOMINATIM_UA})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        addr = data.get("address", {}) if isinstance(data, dict) else {}
        for key in ("city", "town", "village", "municipality", "suburb"):
            if addr.get(key):
                return addr[key]
    except Exception as exc:
        print(f"    [reverse-geo] Nominatim fallback failed: {exc}")
    return None


# ---------------------------------------------------------------------------
# GPX helpers
# ---------------------------------------------------------------------------
def parse_gpx_middle_point(gpx_path: Path) -> tuple[float, float]:
    """Return ``(lat, lon)`` of the middle trkpt in the GPX file.

    Used purely for reverse-geo sanity checking (we don't care about the
    pipeline's GPS handling here; we just need a representative coordinate
    inside the city's bounding box).
    """
    tree = ET.fromstring(gpx_path.read_text(encoding="utf-8"))
    trkpts = [el for el in tree.iter() if _local_name(el.tag) == "trkpt"]
    if not trkpts:
        raise RuntimeError(f"GPX file has no trkpt: {gpx_path}")
    mid = trkpts[len(trkpts) // 2]
    return float(mid.attrib["lat"]), float(mid.attrib["lon"])


def _local_name(tag: str) -> str:
    """Strip ``{xmlns}`` prefix from an Element tag."""
    return tag.split("}", 1)[-1] if "}" in tag else tag


# ---------------------------------------------------------------------------
# Mongo helpers
# ---------------------------------------------------------------------------
def tag_demo_seed(db, collection: str, doc_id: str) -> None:
    """Mark a document as demo-seeded so future cleanup can find it.

    The public APIs don't expose ``_demo_seed`` so we set it directly on the
    DB after the API has created the document.
    """
    db[collection].update_one({"_id": doc_id}, {"$set": {"_demo_seed": True}})
