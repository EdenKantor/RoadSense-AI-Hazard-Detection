"""
Section 3 — verify DBSCAN consolidation + dedup logic.

PURE-VERIFICATION TESTS. Do NOT modify production code.

Tests are split into two classes:
  - TestDBSCAN: exercises pipeline.dbscan_consolidation.consolidate_detections
    with synthetic detections. No external dependencies.
  - TestDedup: exercises pipeline.event_persister.persist_events against a
    real MongoDB ($nearSphere is server-side, can't be unit-mocked). Uses a
    SEPARATE test DB (`roadsenseai_test_section3`). Requires the existing
    Docker MongoDB to be reachable at mongodb://localhost:27017.

Coordinate notes:
  - Base location: ~32.85N, 35.08E (Kiryat Motzkin-ish — same locale the
    project demos run in).
  - 1 m of latitude shift  ≈ 1 / 111_320  ≈ 8.984e-6 degrees.
  - Longitude is intentionally not used for shifts (depends on cos(lat)) —
    everything is shifted along the meridian.
"""
from __future__ import annotations

import threading
import time
from typing import List, Dict, Any

import pytest

from pipeline.dbscan_consolidation import consolidate_detections
from pipeline.severity_heuristic import compute_severity
from pipeline.event_persister import persist_events


BASE_LAT = 32.85
BASE_LON = 35.08
DEG_PER_METER_LAT = 1.0 / 111_320  # ~8.984e-6


def _shift_north(lat: float, meters: float) -> float:
    return lat + meters * DEG_PER_METER_LAT


def _det(lat: float, lon: float, conf: float = 0.7, bbox=(100, 100, 220, 220), **extra) -> Dict[str, Any]:
    """Make an aligned-detection dict in the shape the pipeline produces."""
    return {
        "lat": lat,
        "lon": lon,
        "confidence": conf,
        "bbox": list(bbox),
        "frame_index": extra.get("frame_index", 0),
        "timestamp_sec": extra.get("timestamp_sec", 0.0),
        "annotated_path": extra.get("annotated_path"),
    }


def _event(lat: float, lon: float, conf: float = 0.7) -> Dict[str, Any]:
    """Make a clustered+severity-scored event dict in the shape persist_events expects."""
    cluster = {
        "lat": lat,
        "lon": lon,
        "detection_count": 1,
        "avg_confidence": conf,
        "max_bbox_area": 14_400.0,
        "detections": [_det(lat, lon, conf=conf)],
    }
    return compute_severity(cluster)


# =============================================================================
# Phase A — DBSCAN consolidation
# =============================================================================
class TestDBSCAN:
    """Verify pipeline.dbscan_consolidation.consolidate_detections."""

    def test_empty_input(self):
        assert consolidate_detections([]) == []

    def test_single_detection(self):
        clusters = consolidate_detections([_det(BASE_LAT, BASE_LON, conf=0.9)])
        assert len(clusters) == 1
        c = clusters[0]
        assert c["detection_count"] == 1
        assert c["avg_confidence"] == pytest.approx(0.9)
        assert c["lat"] == pytest.approx(BASE_LAT)
        assert c["lon"] == pytest.approx(BASE_LON)
        # bbox area = 120 * 120
        assert c["max_bbox_area"] == pytest.approx(14_400.0)

    def test_two_close_detections_1m(self):
        d1 = _det(BASE_LAT, BASE_LON, conf=0.6)
        d2 = _det(_shift_north(BASE_LAT, 1.0), BASE_LON, conf=0.8)
        clusters = consolidate_detections([d1, d2])
        assert len(clusters) == 1
        c = clusters[0]
        assert c["detection_count"] == 2
        assert c["avg_confidence"] == pytest.approx(0.7)
        # Mean lat is between the two
        expected_lat = (BASE_LAT + _shift_north(BASE_LAT, 1.0)) / 2
        assert c["lat"] == pytest.approx(expected_lat, abs=1e-9)

    def test_near_threshold_4_5m(self):
        d1 = _det(BASE_LAT, BASE_LON)
        d2 = _det(_shift_north(BASE_LAT, 4.5), BASE_LON)
        clusters = consolidate_detections([d1, d2])
        assert len(clusters) == 1, "4.5 m gap is inside eps=5 m -> single cluster"

    def test_beyond_threshold_5_5m(self):
        d1 = _det(BASE_LAT, BASE_LON)
        d2 = _det(_shift_north(BASE_LAT, 5.5), BASE_LON)
        clusters = consolidate_detections([d1, d2])
        assert len(clusters) == 2, "5.5 m gap is outside eps=5 m -> two clusters"

    def test_three_in_line_4m_transitive(self):
        # Each pair is 4 m apart, so DBSCAN should connect them via density.
        d1 = _det(BASE_LAT, BASE_LON)
        d2 = _det(_shift_north(BASE_LAT, 4.0), BASE_LON)
        d3 = _det(_shift_north(BASE_LAT, 8.0), BASE_LON)  # 8m from d1, but 4m from d2
        clusters = consolidate_detections([d1, d2, d3])
        assert len(clusters) == 1, "DBSCAN should chain via the middle point"
        assert clusters[0]["detection_count"] == 3

    def test_varying_confidence(self):
        # Same point, three confidences: avg should be (0.5 + 0.7 + 0.9) / 3
        confs = [0.5, 0.7, 0.9]
        dets = [_det(BASE_LAT, BASE_LON, conf=c) for c in confs]
        clusters = consolidate_detections(dets)
        assert len(clusters) == 1
        assert clusters[0]["avg_confidence"] == pytest.approx(sum(confs) / 3)
        assert clusters[0]["detection_count"] == 3

    def test_realistic_batch_5_clusters_of_4(self):
        # 5 well-separated potholes (50 m apart), 4 detections each within 1 m.
        dets = []
        for i in range(5):
            base = _shift_north(BASE_LAT, i * 50.0)
            for j in range(4):
                dets.append(_det(_shift_north(base, j * 0.3), BASE_LON, conf=0.7 + 0.05 * j))
        clusters = consolidate_detections(dets)
        assert len(clusters) == 5
        for c in clusters:
            assert c["detection_count"] == 4

    def test_identical_lat_lon_zero_distance(self):
        # 5 detections at exactly the same point
        dets = [_det(BASE_LAT, BASE_LON, conf=0.6 + 0.05 * i) for i in range(5)]
        clusters = consolidate_detections(dets)
        assert len(clusters) == 1
        assert clusters[0]["detection_count"] == 5

    def test_max_bbox_area_picks_largest(self):
        # Cluster with two detections of different bbox sizes -> should report max.
        d1 = _det(BASE_LAT, BASE_LON, bbox=(100, 100, 200, 200))     # 100x100 = 10_000
        d2 = _det(_shift_north(BASE_LAT, 1.0), BASE_LON, bbox=(0, 0, 300, 200))  # 300x200 = 60_000
        clusters = consolidate_detections([d1, d2])
        assert len(clusters) == 1
        assert clusters[0]["max_bbox_area"] == pytest.approx(60_000.0)


# =============================================================================
# Phase B — Dedup ($nearSphere) — needs MongoDB
# =============================================================================
class TestDedup:
    """Verify pipeline.event_persister.persist_events against MongoDB."""

    def test_first_insert(self, test_db, mock_geocode):
        events = [_event(BASE_LAT, BASE_LON)]
        ids, dups = persist_events(test_db, "upload-A", "user-A", events, eps_meters=5.0)
        assert len(ids) == 1
        assert dups == 0
        assert test_db["pothole_events"].count_documents({}) == 1

    def test_exact_duplicate_within_5m(self, test_db, mock_geocode):
        # Section 3: 2nd is MERGED, not skipped. Still 1 doc, but now reflects both uploads.
        persist_events(test_db, "upload-A", "user-A", [_event(BASE_LAT, BASE_LON)])
        ids, dups = persist_events(test_db, "upload-B", "user-B", [_event(BASE_LAT, BASE_LON)])
        assert len(ids) == 0
        assert dups == 1, "the 'duplicates_suppressed' counter is now 'merged-or-reopened'"
        assert test_db["pothole_events"].count_documents({}) == 1
        doc = test_db["pothole_events"].find_one({})
        assert doc["detection_count"] == 2, "old=1 + new=1"
        assert sorted(doc["contributing_uploads"]) == ["upload-A", "upload-B"]

    def test_far_apart_10m(self, test_db, mock_geocode):
        persist_events(test_db, "upload-A", "user-A", [_event(BASE_LAT, BASE_LON)])
        far_lat = _shift_north(BASE_LAT, 10.0)
        ids, dups = persist_events(test_db, "upload-B", "user-B", [_event(far_lat, BASE_LON)])
        assert len(ids) == 1
        assert dups == 0
        assert test_db["pothole_events"].count_documents({}) == 2

    def test_just_inside_threshold_4_5m(self, test_db, mock_geocode):
        # Section 3: still 1 doc, but now via MERGE not skip.
        persist_events(test_db, "upload-A", "user-A", [_event(BASE_LAT, BASE_LON)])
        near_lat = _shift_north(BASE_LAT, 4.5)
        ids, dups = persist_events(test_db, "upload-B", "user-B", [_event(near_lat, BASE_LON)])
        assert dups == 1, "4.5m must be inside the 5m $maxDistance -> merged"
        assert test_db["pothole_events"].count_documents({}) == 1
        doc = test_db["pothole_events"].find_one({})
        assert doc["detection_count"] == 2
        assert "upload-B" in doc["contributing_uploads"]

    def test_just_outside_threshold_5_5m(self, test_db, mock_geocode):
        persist_events(test_db, "upload-A", "user-A", [_event(BASE_LAT, BASE_LON)])
        far_lat = _shift_north(BASE_LAT, 5.5)
        ids, dups = persist_events(test_db, "upload-B", "user-B", [_event(far_lat, BASE_LON)])
        assert dups == 0, "5.5m must be outside the 5m $maxDistance"
        assert test_db["pothole_events"].count_documents({}) == 2

    def test_different_uploads_same_location_cross_upload_dedup(self, test_db, mock_geocode):
        # Section 3 update: Was "B's data lost". Now: B is MERGED into A's event.
        # Doc keeps A's _id and uploader_id (the original uploader stays the
        # canonical owner) but contributing_uploads tracks all reporters.
        persist_events(test_db, "upload-A", "user-A", [_event(BASE_LAT, BASE_LON, conf=0.8)])
        ids, dups = persist_events(
            test_db, "upload-B", "user-B",
            [_event(BASE_LAT, BASE_LON, conf=0.95)],  # B has HIGHER confidence
        )
        assert dups == 1
        assert len(ids) == 0
        docs = list(test_db["pothole_events"].find())
        assert len(docs) == 1
        # Original ownership preserved
        assert docs[0]["upload_id"] == "upload-A"
        assert docs[0]["uploader_id"] == "user-A"
        # But B's signal is now captured: weighted avg = (1*0.8 + 1*0.95) / 2 = 0.875
        assert docs[0]["avg_confidence"] == pytest.approx(0.875, abs=1e-4)
        assert docs[0]["detection_count"] == 2
        assert sorted(docs[0]["contributing_uploads"]) == ["upload-A", "upload-B"]

    def test_same_upload_different_locations(self, test_db, mock_geocode):
        # One upload with 3 distinct potholes 100 m apart -> all 3 inserted.
        events = [
            _event(_shift_north(BASE_LAT, i * 100.0), BASE_LON)
            for i in range(3)
        ]
        ids, dups = persist_events(test_db, "upload-A", "user-A", events)
        assert len(ids) == 3
        assert dups == 0
        assert test_db["pothole_events"].count_documents({}) == 3

    def test_intra_upload_duplicates_suppressed(self, test_db, mock_geocode):
        # Section 3: same-upload merge. Same upload_id appears once via $addToSet.
        events = [
            _event(BASE_LAT, BASE_LON),
            _event(_shift_north(BASE_LAT, 2.0), BASE_LON),
        ]
        ids, dups = persist_events(test_db, "upload-A", "user-A", events)
        assert len(ids) == 1
        assert dups == 1
        assert test_db["pothole_events"].count_documents({}) == 1
        doc = test_db["pothole_events"].find_one({})
        assert doc["detection_count"] == 2
        # $addToSet: same upload_id present only once, not twice.
        assert doc["contributing_uploads"] == ["upload-A"]

    def test_concurrent_inserts_same_location(self, test_db, mock_geocode):
        """
        First-insert race: two pipeline runs hit the same lat/lon at the same
        instant when NO existing event is in the DB. Both find_one's return
        None, both proceed to insert. Section 3 merge logic doesn't help here
        — the race is BEFORE either side becomes "existing". For the
        merge-side race, see test_concurrent_merges_atomic in TestMerge.

        Result non-deterministic. Sanity bound: 1 ≤ count ≤ 2.
        """
        barrier = threading.Barrier(2)
        outcomes: List[Dict[str, Any]] = []

        def runner(uid: str):
            barrier.wait()
            ids, dups = persist_events(
                test_db, f"upload-{uid}", f"user-{uid}",
                [_event(BASE_LAT, BASE_LON)],
            )
            outcomes.append({"uid": uid, "ids": ids, "dups": dups})

        threads = [threading.Thread(target=runner, args=(c,)) for c in ("A", "B")]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        final_count = test_db["pothole_events"].count_documents({})
        # Sanity bound: never more than 2 (we only sent 2 events).
        assert 1 <= final_count <= 2
        # Print observed behavior for the report. Captured in stdout — pytest -s
        # surfaces it; otherwise visible on test failure / via captured output.
        print(
            f"\n[concurrent] outcomes={outcomes}, final_doc_count={final_count}. "
            f"{'RACE OBSERVED' if final_count == 2 else 'No race — dedup held.'}"
        )


def _make_event_with_count(lat: float, lon: float, count: int, conf: float, bbox_area: float = 14_400.0) -> Dict[str, Any]:
    """An event whose cluster has the requested detection_count + avg_confidence."""
    side = bbox_area ** 0.5
    dets = [{
        "lat": lat,
        "lon": lon,
        "confidence": conf,
        "bbox": [0, 0, side, side],
        "frame_index": i,
        "timestamp_sec": 0.0,
        "annotated_path": None,
    } for i in range(count)]
    cluster = {
        "lat": lat, "lon": lon,
        "detection_count": count,
        "avg_confidence": conf,
        "max_bbox_area": bbox_area,
        "detections": dets,
    }
    return compute_severity(cluster)


# =============================================================================
# Phase C — Merge logic (Section 3)
# =============================================================================
class TestMerge:
    """Verify the merge path inside persist_events."""

    def test_merge_increments_detection_count(self, test_db, mock_geocode):
        # Insert with cluster of 3 detections, merge with cluster of 5 -> count = 8
        persist_events(test_db, "upload-A", "user-A", [_make_event_with_count(BASE_LAT, BASE_LON, 3, 0.7)])
        ids, dups = persist_events(
            test_db, "upload-B", "user-B",
            [_make_event_with_count(BASE_LAT, BASE_LON, 5, 0.7)],
        )
        assert len(ids) == 0
        assert dups == 1
        doc = test_db["pothole_events"].find_one({})
        assert doc["detection_count"] == 8

    def test_merge_weighted_confidence(self, test_db, mock_geocode):
        # old=0.5/count=1, new=0.95/count=1 -> merged avg = (0.5+0.95)/2 = 0.725
        persist_events(test_db, "upload-A", "user-A", [_make_event_with_count(BASE_LAT, BASE_LON, 1, 0.5)])
        persist_events(test_db, "upload-B", "user-B", [_make_event_with_count(BASE_LAT, BASE_LON, 1, 0.95)])
        doc = test_db["pothole_events"].find_one({})
        assert doc["avg_confidence"] == pytest.approx(0.725, abs=1e-4)
        # Weighted: 3 detections at 0.5, then 1 at 0.95 -> (3*0.5 + 1*0.95) / 4 = 0.6125
        persist_events(test_db, "upload-C", "user-C", [_make_event_with_count(BASE_LAT, BASE_LON, 3, 0.5)])
        # Reset for this case
        test_db["pothole_events"].delete_many({})
        persist_events(test_db, "upload-A", "user-A", [_make_event_with_count(BASE_LAT, BASE_LON, 3, 0.5)])
        persist_events(test_db, "upload-B", "user-B", [_make_event_with_count(BASE_LAT, BASE_LON, 1, 0.95)])
        doc2 = test_db["pothole_events"].find_one({})
        assert doc2["avg_confidence"] == pytest.approx((3 * 0.5 + 1 * 0.95) / 4, abs=1e-4)

    def test_merge_max_bbox_area(self, test_db, mock_geocode):
        persist_events(test_db, "upload-A", "user-A", [_make_event_with_count(BASE_LAT, BASE_LON, 1, 0.7, bbox_area=10_000.0)])
        persist_events(test_db, "upload-B", "user-B", [_make_event_with_count(BASE_LAT, BASE_LON, 1, 0.7, bbox_area=50_000.0)])
        doc = test_db["pothole_events"].find_one({})
        assert doc["max_bbox_area"] == pytest.approx(50_000.0)

    def test_merge_severity_upgraded(self, test_db, mock_geocode):
        # Start with a low-severity event (small bbox, low conf, count=1)
        persist_events(test_db, "upload-A", "user-A", [
            _make_event_with_count(BASE_LAT, BASE_LON, 1, 0.42, bbox_area=4_000.0),
        ])
        before = test_db["pothole_events"].find_one({})
        assert before["severity"] in ("Low", "Medium"), f"unexpected starting severity {before['severity']}"
        # Merge a strong cluster: many high-conf detections, big bbox
        persist_events(test_db, "upload-B", "user-B", [
            _make_event_with_count(BASE_LAT, BASE_LON, 8, 0.95, bbox_area=60_000.0),
        ])
        after = test_db["pothole_events"].find_one({})
        # The heuristic ranks Low < Medium < High; the merge should not downgrade
        order = {"Low": 0, "Medium": 1, "High": 2}
        assert order[after["severity"]] >= order[before["severity"]]
        # And given the large new bbox + high confidence + count, expect High.
        assert after["severity"] == "High", f"expected High after merge, got {after['severity']}"

    def test_merge_three_uploads_aggregated(self, test_db, mock_geocode):
        # A (count=2, conf=0.6) -> B (count=3, conf=0.8) -> C (count=1, conf=0.9)
        persist_events(test_db, "upload-A", "user-A", [_make_event_with_count(BASE_LAT, BASE_LON, 2, 0.6)])
        persist_events(test_db, "upload-B", "user-B", [_make_event_with_count(BASE_LAT, BASE_LON, 3, 0.8)])
        persist_events(test_db, "upload-C", "user-C", [_make_event_with_count(BASE_LAT, BASE_LON, 1, 0.9)])
        doc = test_db["pothole_events"].find_one({})
        assert doc["detection_count"] == 6
        # Weighted avg: (2*0.6 + 3*0.8 + 1*0.9) / 6 = 4.5/6 = 0.75
        assert doc["avg_confidence"] == pytest.approx(0.75, abs=1e-4)
        assert sorted(doc["contributing_uploads"]) == ["upload-A", "upload-B", "upload-C"]

    def test_merge_same_upload_addtoset_dedupes(self, test_db, mock_geocode):
        # Two clusters with the SAME upload_id. $addToSet should keep contributing_uploads at length 1.
        events = [
            _make_event_with_count(BASE_LAT, BASE_LON, 1, 0.7),
            _make_event_with_count(_shift_north(BASE_LAT, 2.0), BASE_LON, 1, 0.7),
        ]
        persist_events(test_db, "upload-A", "user-A", events)
        doc = test_db["pothole_events"].find_one({})
        assert doc["contributing_uploads"] == ["upload-A"], "same upload_id, $addToSet keeps unique"

    def test_merge_legacy_doc_seeded(self, test_db, mock_geocode):
        # Manually insert a doc WITHOUT _confidence_sum to simulate pre-Section-3 data.
        legacy = {
            "_id": "legacy-1",
            "upload_id": "upload-A",
            "uploader_id": "user-A",
            "location": {"type": "Point", "coordinates": [BASE_LON, BASE_LAT]},
            "zone": "TestZone",
            "severity": "Medium",
            "severity_score": 0.5,
            "max_bbox_area": 14_400.0,
            "lifecycle_status": "Reported",
            "detection_count": 4,
            "avg_confidence": 0.7,         # cumulative sum should be seeded as 4*0.7=2.8
            "detected_at": "2026-04-01T00:00:00Z",
            "created_at": "2026-04-01T00:00:00Z",
            "updated_at": "2026-04-01T00:00:00Z",
            "frame_thumbnail_path": None,
            "frame_references": [],
            "annotated_paths": [],
        }
        test_db["pothole_events"].insert_one(legacy)
        # 2dsphere index needed for the $nearSphere lookup
        test_db["pothole_events"].create_index([("location", "2dsphere")])
        # Now merge: count=2 at conf=0.9
        persist_events(test_db, "upload-B", "user-B", [_make_event_with_count(BASE_LAT, BASE_LON, 2, 0.9)])
        doc = test_db["pothole_events"].find_one({"_id": "legacy-1"})
        assert doc is not None, "legacy doc must still be the matched event"
        assert doc["detection_count"] == 6
        # weighted: (4*0.7 + 2*0.9) / 6 = (2.8 + 1.8) / 6 = 4.6/6 ≈ 0.7667
        assert doc["avg_confidence"] == pytest.approx(4.6 / 6, abs=1e-4)
        assert doc["_confidence_sum"] == pytest.approx(4.6, abs=1e-4)


# =============================================================================
# Phase D — Re-open logic (Section 3)
# =============================================================================
class TestReopen:
    """Verify the Resolved -> Reported re-open path."""

    def _resolve_event(self, db, event_id: str):
        """Mark an existing event as Resolved with metadata for the test."""
        db["pothole_events"].update_one(
            {"_id": event_id},
            {"$set": {
                "lifecycle_status": "Resolved",
                "resolved_at": "2026-01-15T12:00:00Z",
                "resolved_by": "authority-foo",
            }},
        )

    def test_reopen_resolved_to_reported(self, test_db, mock_geocode):
        ids, _ = persist_events(test_db, "upload-A", "user-A", [_event(BASE_LAT, BASE_LON)])
        assert len(ids) == 1
        eid = ids[0]
        self._resolve_event(test_db, eid)

        # New detection arrives -> should re-open + merge
        persist_events(test_db, "upload-B", "user-B", [_event(BASE_LAT, BASE_LON)])

        doc = test_db["pothole_events"].find_one({"_id": eid})
        assert doc["lifecycle_status"] == "Reported", "Resolved should re-open to Reported"
        assert "resolved_at" not in doc, "resolved_at should be unset on re-open"
        assert "resolved_by" not in doc, "resolved_by should be unset on re-open"
        assert doc["detection_count"] == 2

        history = list(test_db["event_status_history"].find({"event_id": eid}))
        assert len(history) == 1
        assert history[0]["previous_status"] == "Resolved"
        assert history[0]["new_status"] == "Reported"
        assert history[0]["changed_by"] == "system:auto-reopen"
        assert history[0]["changed_by_role"] == "System"
        assert "upload-B" in history[0]["note"]

    def test_reopen_then_merge_again(self, test_db, mock_geocode):
        # Re-open once, then a third upload merges normally (no second re-open row).
        ids, _ = persist_events(test_db, "upload-A", "user-A", [_event(BASE_LAT, BASE_LON)])
        eid = ids[0]
        self._resolve_event(test_db, eid)
        persist_events(test_db, "upload-B", "user-B", [_event(BASE_LAT, BASE_LON)])
        # After B, status is Reported again
        assert test_db["pothole_events"].find_one({"_id": eid})["lifecycle_status"] == "Reported"
        # C arrives and merges normally
        persist_events(test_db, "upload-C", "user-C", [_event(BASE_LAT, BASE_LON)])
        doc = test_db["pothole_events"].find_one({"_id": eid})
        assert doc["detection_count"] == 3
        # event_status_history should still have ONLY the one re-open entry
        history = list(test_db["event_status_history"].find({"event_id": eid}))
        assert len(history) == 1, "no re-open row should be added when status was already Reported"

    def test_reopen_clears_resolution_metadata(self, test_db, mock_geocode):
        ids, _ = persist_events(test_db, "upload-A", "user-A", [_event(BASE_LAT, BASE_LON)])
        eid = ids[0]
        self._resolve_event(test_db, eid)
        # confirm metadata exists pre-reopen
        before = test_db["pothole_events"].find_one({"_id": eid})
        assert "resolved_at" in before and "resolved_by" in before
        persist_events(test_db, "upload-B", "user-B", [_event(BASE_LAT, BASE_LON)])
        after = test_db["pothole_events"].find_one({"_id": eid})
        assert "resolved_at" not in after
        assert "resolved_by" not in after


# =============================================================================
# Phase E — Race & edge cases under merge (Section 3)
# =============================================================================
class TestMergeRaceAndEdge:
    def test_concurrent_merges_atomic(self, test_db, mock_geocode):
        # Pre-insert event A. Spawn 5 threads, each merging count=2 / conf=0.6.
        persist_events(test_db, "upload-A", "user-A", [_make_event_with_count(BASE_LAT, BASE_LON, 4, 0.5)])
        eid = list(test_db["pothole_events"].find())[0]["_id"]

        barrier = threading.Barrier(5)
        def runner(uid: str):
            barrier.wait()
            persist_events(
                test_db, f"upload-{uid}", f"user-{uid}",
                [_make_event_with_count(BASE_LAT, BASE_LON, 2, 0.6)],
            )

        threads = [threading.Thread(target=runner, args=(c,)) for c in ("B", "C", "D", "E", "F")]
        for t in threads: t.start()
        for t in threads: t.join()

        doc = test_db["pothole_events"].find_one({"_id": eid})
        # detection_count: 4 (initial) + 5*2 (merges) = 14, no lost updates
        assert doc["detection_count"] == 14, f"expected 14, got {doc['detection_count']} (lost-update race)"
        # All 6 contributing uploads tracked (A + 5 merges)
        assert sorted(doc["contributing_uploads"]) == ["upload-A", "upload-B", "upload-C", "upload-D", "upload-E", "upload-F"]
        # Cumulative confidence sum = 4*0.5 + 5*2*0.6 = 2.0 + 6.0 = 8.0
        # avg_confidence = 8.0 / 14 ≈ 0.5714
        assert doc["avg_confidence"] == pytest.approx(8.0 / 14, abs=1e-3)
        # Should still be a single doc
        assert test_db["pothole_events"].count_documents({}) == 1

    def test_merge_legacy_doc_no_contributing_uploads(self, test_db, mock_geocode):
        # Manually insert a legacy doc with no contributing_uploads field.
        test_db["pothole_events"].insert_one({
            "_id": "legacy-2",
            "upload_id": "upload-A",
            "uploader_id": "user-A",
            "location": {"type": "Point", "coordinates": [BASE_LON, BASE_LAT]},
            "zone": "TestZone",
            "severity": "Medium",
            "severity_score": 0.5,
            "max_bbox_area": 14_400.0,
            "lifecycle_status": "Reported",
            "detection_count": 1,
            "avg_confidence": 0.7,
            "detected_at": "2026-04-01T00:00:00Z",
            "created_at": "2026-04-01T00:00:00Z",
            "updated_at": "2026-04-01T00:00:00Z",
            "frame_thumbnail_path": None,
            "frame_references": [],
            "annotated_paths": [],
            # No contributing_uploads
        })
        test_db["pothole_events"].create_index([("location", "2dsphere")])
        persist_events(test_db, "upload-B", "user-B", [_event(BASE_LAT, BASE_LON)])
        doc = test_db["pothole_events"].find_one({"_id": "legacy-2"})
        # $addToSet on a missing array creates it with [upload-B] only
        assert doc["contributing_uploads"] == ["upload-B"]
