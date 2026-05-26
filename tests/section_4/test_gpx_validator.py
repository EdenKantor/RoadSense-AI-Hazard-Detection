"""
Section 4 unit tests — backend GPX upload validator.

Pure-Python tests that exercise validate_gpx_upload directly via synthetic
SimpleNamespace fakes for UploadFile and one real fixture file on disk.

Run with the BACKEND venv (which has fastapi installed):
    backend/venv/Scripts/pytest.exe tests/section_4/ -v
"""
from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.gpx_validator import validate_gpx_upload


FIXTURES = Path(__file__).parent / "fixtures"


def _fake(content_type: str = "application/gpx+xml", filename: str = "track.gpx") -> SimpleNamespace:
    """Build an UploadFile-like object with just content_type + filename.

    The validator only reads these two attributes, so duck-typing via
    ``SimpleNamespace`` is sufficient — no real ``UploadFile`` needed.
    """
    return SimpleNamespace(content_type=content_type, filename=filename)


# ── Synthetic GPX byte payloads used across multiple tests ──────────────


def _minimal_gpx() -> bytes:
    """One well-formed trkpt, no namespace."""
    return (
        b"<gpx version=\"1.1\">"
        b"<trk><trkseg>"
        b"<trkpt lat=\"32.7\" lon=\"35.0\"><time>2026-05-01T12:00:00Z</time></trkpt>"
        b"</trkseg></trk>"
        b"</gpx>"
    )


def _namespaced_gpx() -> bytes:
    """Same content as _minimal_gpx but with the topografix namespace."""
    return (
        b"<gpx version=\"1.1\" xmlns=\"http://www.topografix.com/GPX/1/1\">"
        b"<trk><trkseg>"
        b"<trkpt lat=\"32.7\" lon=\"35.0\"><time>2026-05-01T12:00:00Z</time></trkpt>"
        b"</trkseg></trk>"
        b"</gpx>"
    )


# ── 14 test cases (one per row of the spec table) ──────────────────────


def test_01_minimal_valid_gpx():
    """#1 — minimal valid GPX with one well-formed <trkpt> passes."""
    validate_gpx_upload(_fake(), _minimal_gpx())


def test_02_namespaced_valid_gpx():
    """#2 — GPX with topografix xmlns and one <trkpt>+<time> passes."""
    validate_gpx_upload(_fake(), _namespaced_gpx())


def test_03_wrong_content_type():
    """#3 — content_type=image/jpeg rejected at rule 1."""
    with pytest.raises(HTTPException) as exc:
        validate_gpx_upload(_fake(content_type="image/jpeg"), _minimal_gpx())
    assert exc.value.status_code == 400
    assert "Unsupported content type" in exc.value.detail


def test_04_wrong_extension():
    """#4 — filename without .gpx extension rejected at rule 2."""
    with pytest.raises(HTTPException) as exc:
        validate_gpx_upload(_fake(filename="track.txt"), _minimal_gpx())
    assert exc.value.status_code == 400
    assert "must end with .gpx" in exc.value.detail


def test_05_empty_body():
    """#5 — zero-byte body rejected at rule 3."""
    with pytest.raises(HTTPException) as exc:
        validate_gpx_upload(_fake(), b"")
    assert exc.value.status_code == 400
    assert "is empty" in exc.value.detail


def test_06_oversize_body():
    """#6 — 6 MB body rejected at rule 4 (before XML parse runs)."""
    payload = b"<gpx>" + b"x" * (6 * 1024 * 1024) + b"</gpx>"
    with pytest.raises(HTTPException) as exc:
        validate_gpx_upload(_fake(), payload)
    assert exc.value.status_code == 400
    assert "5 MB" in exc.value.detail


def test_07_non_xml_body():
    """#7 — non-XML bytes rejected at rule 5 (the parse step)."""
    with pytest.raises(HTTPException) as exc:
        validate_gpx_upload(_fake(), b"hello world")
    assert exc.value.status_code == 400
    assert "not valid XML" in exc.value.detail


def test_08_no_trackpoints():
    """#8 — valid XML root but zero <trkpt> rejected at rule 6."""
    with pytest.raises(HTTPException) as exc:
        validate_gpx_upload(_fake(), b"<gpx></gpx>")
    assert exc.value.status_code == 400
    assert "no trackpoints" in exc.value.detail


def test_09_lat_out_of_range():
    """#9 — lat=100 (> 90) rejected at rule 7, index 0, latitude."""
    payload = (
        b"<gpx><trk><trkseg>"
        b"<trkpt lat=\"100\" lon=\"35\"><time>2026-05-01T12:00:00Z</time></trkpt>"
        b"</trkseg></trk></gpx>"
    )
    with pytest.raises(HTTPException) as exc:
        validate_gpx_upload(_fake(), payload)
    assert exc.value.status_code == 400
    assert "index 0" in exc.value.detail
    assert "latitude" in exc.value.detail


def test_10_lon_out_of_range_at_index_1():
    """#10 — first trkpt valid, second has lon=200 (> 180); rule 7 reports index 1."""
    payload = (
        b"<gpx><trk><trkseg>"
        b"<trkpt lat=\"32.7\" lon=\"35\"><time>2026-05-01T12:00:00Z</time></trkpt>"
        b"<trkpt lat=\"32.8\" lon=\"200\"><time>2026-05-01T12:00:01Z</time></trkpt>"
        b"</trkseg></trk></gpx>"
    )
    with pytest.raises(HTTPException) as exc:
        validate_gpx_upload(_fake(), payload)
    assert exc.value.status_code == 400
    assert "index 1" in exc.value.detail
    assert "longitude" in exc.value.detail


def test_11_lat_not_a_number():
    """#11 — lat='abc' rejected at rule 7, index 0, latitude."""
    payload = (
        b"<gpx><trk><trkseg>"
        b"<trkpt lat=\"abc\" lon=\"35\"><time>2026-05-01T12:00:00Z</time></trkpt>"
        b"</trkseg></trk></gpx>"
    )
    with pytest.raises(HTTPException) as exc:
        validate_gpx_upload(_fake(), payload)
    assert exc.value.status_code == 400
    assert "index 0" in exc.value.detail
    assert "latitude" in exc.value.detail


def test_12_octet_stream_content_type():
    """#12 — application/octet-stream is accepted (browsers send it for .gpx)."""
    validate_gpx_upload(
        _fake(content_type="application/octet-stream"),
        _minimal_gpx(),
    )


def test_13_real_world_fixture():
    """#13 — 44-trkpt nesher_demo.gpx fixture passes (all valid + all have <time>)."""
    payload = (FIXTURES / "nesher_demo.gpx").read_bytes()
    validate_gpx_upload(_fake(filename="nesher_demo.gpx"), payload)


def test_14_fixture_with_time_stripped():
    """#14 — same fixture with every <time>...</time> removed → 400 no-timestamps."""
    payload_text = (FIXTURES / "nesher_demo.gpx").read_text(encoding="utf-8")
    stripped = re.sub(r"<time>[^<]*</time>", "", payload_text).encode("utf-8")
    with pytest.raises(HTTPException) as exc:
        validate_gpx_upload(_fake(filename="nesher_demo.gpx"), stripped)
    assert exc.value.status_code == 400
    assert "no trackpoints with valid timestamps" in exc.value.detail
