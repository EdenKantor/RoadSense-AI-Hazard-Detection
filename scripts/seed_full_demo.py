"""
End-to-end demo-data seed.

Phases:
    1. Preconditions     — backend up, admin can log in, RQ workers active,
                           trip data present (only for non-skipped cities),
                           Mongo reachable.
    2. Reverse-geo check — sanity check that each non-skipped city's GPX
                           midpoint maps to the expected name.
    3. Zones             — POST /api/admin/zones ×7.
    4. Officials + teams — register + approve 14 authority users; create 7
                           teams, add 2 members each, promote first as leader.
    5. Citizens          — register 7 citizens.
    6. Uploads           — POST mp4+gpx multipart for each non-skipped city
                           (4 uploads after SKIP_UPLOAD_ZONES is applied),
                           poll each to Done.
    7. Lifecycle         — flip events through Reported/UnderReview/Scheduled/
                           Resolved in a 30/25/25/20% distribution, using
                           each event's actual zone from Mongo.
    8. Comments          — hybrid citizen+authority threads per upload.
    9. Support tickets   — 11 ticket specs; tickets whose related upload was
                           skipped are skipped pre-attempt (≈8 created).
   10. Sanity checks + write scripts/_demo_credentials.txt.

Idempotency: each prior run wrote ``_demo_seed: True`` markers; the upstream
``reset_db.py`` wipes everything, so this script assumes a clean slate (1
admin, 0 of everything else). Running it on a populated DB will fail at
phase 4 because of unique-email collisions — run ``reset_db.py --yes`` first.
"""
from __future__ import annotations

import random
import sys
import time
import urllib.error
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Path bootstrap — match create_admin.py / seed_demo_tickets.py
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))
sys.path.insert(0, str(HERE))  # for _demo_helpers / _demo_data imports

from pymongo import MongoClient  # noqa: E402
import redis  # noqa: E402
from app.config import settings as backend_settings  # noqa: E402

from _demo_helpers import (  # noqa: E402
    api_get, api_patch, api_post, api_post_multipart, load_backend_env,
    login, parse_gpx_middle_point, poll_until_done,
    reverse_geo_with_fallback, tag_demo_seed,
)

# Resolve runtime URLs from backend/.env (pydantic-settings's Settings
# class only reads .env relative to cwd, which breaks when the script
# runs from project-root — that defaulted REDIS_URL to :6379 even though
# the platform actually runs Redis on :6380).
_env = load_backend_env(PROJECT_ROOT / "backend")
REDIS_URL = _env.get("REDIS_URL")    or backend_settings.redis_url
MONGO_URL = _env.get("MONGODB_URL")  or backend_settings.mongodb_url
DB_NAME   = _env.get("MONGODB_DB_NAME") or backend_settings.mongodb_db_name
from _demo_data import (  # noqa: E402
    ADMIN_EMAIL, ADMIN_PASSWORD, AUTHORITY_PASSWORD, CITIZEN_PASSWORD,
    CITIZENS, LIFECYCLE_DISTRIBUTION, NOTES_REPORTED_TO_UNDERREVIEW,
    NOTES_SCHEDULED_TO_RESOLVED, NOTES_UNDERREVIEW_TO_SCHEDULED,
    OFFICIALS, SKIP_UPLOAD_ZONES, TICKETS, TRIP_ROOT, ZONES,
    AUTHORITY_REPLIES, CITIZEN_COMMENTS,
    team_name_for,
)


UPLOAD_POLL_TIMEOUT_SEC = 300  # 5-minute ceiling per upload pipeline
RANDOM_SEED = 42                # deterministic lifecycle / comment selection


# Phase-scoped warning tracker. Set CURRENT_PHASE at top of each phase
# function; _warn() then attributes the warning to that phase. main()
# prints a final summary line listing any phases that emitted warnings.
CURRENT_PHASE: str = "0"
WARNINGS: list[tuple[str, str]] = []


def _step(msg: str) -> None: print(f"\n[seed] === {msg} ===")
def _ok(msg: str) -> None:   print(f"[seed] OK   {msg}")
def _info(msg: str) -> None: print(f"[seed]      {msg}")
def _warn(msg: str) -> None:
    print(f"[seed] WARN {msg}")
    WARNINGS.append((CURRENT_PHASE, msg))
def _fail(msg: str) -> None: print(f"[seed] FAIL {msg}")
def _phase_done(n: int, summary: str) -> None:
    print(f"[seed] >>>> Phase {n}/10 complete: {summary}")


# ---------------------------------------------------------------------------
# Phase 1 — Preconditions
# ---------------------------------------------------------------------------
def phase_1_preconditions() -> tuple[MongoClient, str]:
    global CURRENT_PHASE
    CURRENT_PHASE = "1"
    _step("Phase 1: Preconditions")

    # 1a. Backend reachable. We expect a 401 (no token) — that proves the
    # server is alive. Anything else (connection refused, network error,
    # 5xx) is a hard abort.
    try:
        api_get("/auth/me")
    except RuntimeError as exc:
        msg = str(exc)
        if "401" in msg:
            pass  # expected
        else:
            raise SystemExit(
                "[seed] Backend not running. Run scripts/start.ps1 first.\n"
                f"[seed]   Detail: {msg}")
    _ok("Backend is up (GET /api/auth/me -> 401 as expected).")

    # 1b. Admin login
    try:
        admin_tok = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    except RuntimeError as exc:
        raise SystemExit(
            f"[seed] Admin login failed: {exc}\n"
            f"[seed] Did you run scripts/reset_db.py first?")
    _ok(f"Admin logged in ({ADMIN_EMAIL}).")

    # 1c. RQ workers active. Without at least one worker, Phase 6 hangs for
    # 5 minutes per upload. Check the registry set RQ maintains.
    try:
        r = redis.Redis.from_url(REDIS_URL,
                                  socket_connect_timeout=2)
        r.ping()
    except Exception as exc:
        raise SystemExit(
            f"[seed] Cannot reach Redis at {REDIS_URL}: {exc}\n"
            f"[seed] Run scripts/start.ps1 first.")
    workers = r.smembers("rq:workers")
    workers = sorted(w.decode() if isinstance(w, bytes) else str(w) for w in workers)
    if not workers:
        raise SystemExit(
            "[seed] No RQ workers active. Run scripts/start.ps1 first.")
    _ok(f"RQ workers active: {workers}")

    # 1d. Trip data
    if not TRIP_ROOT.exists():
        raise SystemExit(
            f"[seed] Trip-data root does not exist: {TRIP_ROOT}\n"
            f"[seed] Tests/<City>/ is missing or empty. Copy the MP4+GPX "
            f"files there before running seed_full_demo.py.")
    for zone in ZONES:
        # Cities in SKIP_UPLOAD_ZONES don't get uploaded (see PLAN §A2.10),
        # so their Tests/<City>/ directory is optional — skip the check.
        if zone.trip_dir in SKIP_UPLOAD_ZONES:
            continue
        zone_dir = TRIP_ROOT / zone.trip_dir
        if not zone_dir.is_dir():
            raise SystemExit(
                f"[seed] Tests/{zone.trip_dir}/ is missing or empty. Copy the "
                f"MP4+GPX files there before running seed_full_demo.py.\n"
                f"[seed]   (expected at: {zone_dir})")
        mp4s = list(zone_dir.glob("*.mp4"))
        gpxs = list(zone_dir.glob("*.gpx"))
        if len(mp4s) != 1 or len(gpxs) != 1:
            raise SystemExit(
                f"[seed] Tests/{zone.trip_dir}/ must contain exactly 1 mp4 "
                f"and 1 gpx (found {len(mp4s)} mp4 / {len(gpxs)} gpx).\n"
                f"[seed]   (path: {zone_dir})")
    _ok(f"Trip data present for all {len(ZONES)} zones.")

    # 1e. Mongo connection
    try:
        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
    except Exception as exc:
        raise SystemExit(f"[seed] Cannot reach MongoDB: {exc}")
    _ok("Mongo connection verified.")

    _phase_done(1, f"backend+redis+mongo up, admin authed, "
                   f"{len(workers)} workers, trip data present")
    return client, admin_tok


# ---------------------------------------------------------------------------
# Phase 2 — Reverse-geo sanity check
# ---------------------------------------------------------------------------
def phase_2_reverse_geo() -> None:
    global CURRENT_PHASE
    CURRENT_PHASE = "2"
    _step("Phase 2: Reverse-geo sanity check")
    matched = 0
    for zone in ZONES:
        # Skipped cities don't have a Tests/<City>/ directory (see §A2.10),
        # so we can't reverse-geo-check them. Their zone names are
        # informational-only anyway.
        if zone.trip_dir in SKIP_UPLOAD_ZONES:
            continue
        gpx = next((TRIP_ROOT / zone.trip_dir).glob("*.gpx"))
        try:
            lat, lon = parse_gpx_middle_point(gpx)
        except Exception as exc:
            _warn(f"  {zone.name}: could not read GPX ({exc}); skipping")
            continue
        resolved = reverse_geo_with_fallback(lat, lon)
        is_match = resolved and zone.name.lower().split()[0] in resolved.lower()
        if is_match:
            matched += 1
        match_tag = "MATCH" if is_match else "differs"
        _info(f"  {zone.name:14s} mid=({lat:.4f},{lon:.4f}) -> {resolved!r} [{match_tag}]")
    _ok("Reverse-geo check complete (informational only).")
    _phase_done(2, f"reverse-geo verified ({matched}/{len(ZONES)} match expected city)")


# ---------------------------------------------------------------------------
# Phase 3 — Create zones
# ---------------------------------------------------------------------------
def phase_3_zones(admin_tok: str, db) -> dict[str, str]:
    """Returns {zone_name: zone_id}."""
    global CURRENT_PHASE
    CURRENT_PHASE = "3"
    _step("Phase 3: Create zones")
    zone_ids: dict[str, str] = {}
    for zone in ZONES:
        res = api_post("/admin/zones",
                       {"name": zone.name, "description": zone.description},
                       token=admin_tok)
        zid = res.get("zone_id") or res.get("_id") or res.get("id")
        if not zid:
            raise SystemExit(f"[seed] Zone create returned no id: {res!r}")
        zone_ids[zone.name] = zid
        tag_demo_seed(db, "zones", zid)
        _info(f"  +zone {zone.name:14s} {zid}")
    _ok(f"Created {len(zone_ids)} zones.")
    _phase_done(3, f"{len(zone_ids)} zones created")
    return zone_ids


# ---------------------------------------------------------------------------
# Phase 4 — Officials + teams
# ---------------------------------------------------------------------------
def phase_4_officials_and_teams(admin_tok: str, zone_ids: dict[str, str],
                                db) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    """Register + approve all 12 officials; create 6 teams + populate.

    Returns:
        official_ids: {email: user_id}
        official_tokens: {email: JWT}
        team_leader_email_by_zone: {zone_name: leader_email}
    """
    global CURRENT_PHASE
    CURRENT_PHASE = "4"
    _step("Phase 4: Officials + teams")

    official_ids: dict[str, str] = {}
    official_tokens: dict[str, str] = {}
    team_leader_email_by_zone: dict[str, str] = {}

    for off in OFFICIALS:
        # Register
        try:
            res = api_post("/auth/register", {
                "email": off.email,
                "password": AUTHORITY_PASSWORD,
                "full_name": off.full_name,
                "role": "Authority",
                "organisation": off.organisation,
                "jurisdiction_area": off.zone_name,
            })
        except RuntimeError as exc:
            raise SystemExit(f"[seed] Register failed for {off.email}: {exc}")
        uid = res.get("id") or res.get("user_id") or res.get("_id")
        if not uid:
            raise SystemExit(f"[seed] Authority register returned no id: {res!r}")
        official_ids[off.email] = uid
        tag_demo_seed(db, "users", uid)
        tag_demo_seed(db, "authority_profiles", uid)

        # Approve
        try:
            api_post(f"/admin/approve/{uid}",
                     {"approval_status": "Approved",
                      "review_note": "Demo-seed auto-approval"},
                     token=admin_tok)
        except RuntimeError as exc:
            raise SystemExit(f"[seed] Approval failed for {off.email}: {exc}")

        # Log in (sanity check that approval succeeded + cache token)
        official_tokens[off.email] = login(off.email, AUTHORITY_PASSWORD)

        if off.is_leader:
            team_leader_email_by_zone[off.zone_name] = off.email
        _info(f"  +official {off.email:35s} {'(leader)' if off.is_leader else '        '}  {off.zone_name}")

    # Create teams
    team_ids_by_zone: dict[str, str] = {}
    for zone in ZONES:
        team_name = team_name_for(zone.name)
        res = api_post("/admin/teams",
                       {"name": team_name, "zone_id": zone_ids[zone.name]},
                       token=admin_tok)
        tid = res.get("team_id") or res.get("_id") or res.get("id")
        if not tid:
            raise SystemExit(f"[seed] Team create returned no id: {res!r}")
        team_ids_by_zone[zone.name] = tid
        tag_demo_seed(db, "teams", tid)
        _info(f"  +team    {team_name:30s} {tid}  zone={zone.name}")

        # Add 2 members
        for off in OFFICIALS:
            if off.zone_name != zone.name:
                continue
            api_post(f"/admin/teams/{tid}/members",
                     {"user_id": official_ids[off.email]},
                     token=admin_tok)

        # Promote leader
        leader_email = team_leader_email_by_zone[zone.name]
        api_post(f"/admin/teams/{tid}/leader",
                 {"user_id": official_ids[leader_email]},
                 token=admin_tok)

    _ok(f"Created {len(official_ids)} officials, "
        f"{len(team_ids_by_zone)} teams, "
        f"{len(team_leader_email_by_zone)} leaders.")
    _phase_done(4, f"{len(official_ids)} officials + {len(team_ids_by_zone)} teams "
                   f"({len(team_leader_email_by_zone)} leaders)")
    return official_ids, official_tokens, team_leader_email_by_zone


# ---------------------------------------------------------------------------
# Phase 5 — Citizens
# ---------------------------------------------------------------------------
def phase_5_citizens(db) -> tuple[dict[str, str], dict[str, str]]:
    """Register 6 citizens. Returns ({email: user_id}, {email: JWT})."""
    global CURRENT_PHASE
    CURRENT_PHASE = "5"
    _step("Phase 5: Citizens")
    cit_ids: dict[str, str] = {}
    cit_tokens: dict[str, str] = {}
    for cit in CITIZENS:
        try:
            res = api_post("/auth/register", {
                "email": cit.email,
                "password": CITIZEN_PASSWORD,
                "full_name": cit.full_name,
                "role": "Citizen",
            })
        except RuntimeError as exc:
            raise SystemExit(f"[seed] Citizen register failed for {cit.email}: {exc}")
        uid = res.get("id") or res.get("user_id") or res.get("_id")
        if not uid:
            raise SystemExit(f"[seed] Citizen register returned no id: {res!r}")
        cit_ids[cit.email] = uid
        cit_tokens[cit.email] = login(cit.email, CITIZEN_PASSWORD)
        tag_demo_seed(db, "users", uid)
        _info(f"  +citizen {cit.email:35s} {cit.full_name}")
    _ok(f"Created {len(cit_ids)} citizens.")
    _phase_done(5, f"{len(cit_ids)} citizens registered")
    return cit_ids, cit_tokens


# ---------------------------------------------------------------------------
# Phase 6 — Real pipeline uploads
# ---------------------------------------------------------------------------
def phase_6_uploads(cit_tokens: dict[str, str], db) -> list[dict]:
    """One upload per zone, round-robin citizen. Polls each to Done/Failed.

    Returns a list of dicts (one per zone, in ZONES order) with keys:
        zone_name, uploader_email, uploader_id, upload_id, status,
        events (list of dicts from /detail).
    """
    global CURRENT_PHASE
    CURRENT_PHASE = "6"
    _step("Phase 6: Real pipeline uploads")
    results: list[dict] = []
    cit_emails = [c.email for c in CITIZENS]
    total_events = 0
    for i, zone in enumerate(ZONES):
        k = i + 1  # 1-based for user-facing progress label
        uploader_email = cit_emails[i % len(cit_emails)]

        # Skip uploads for cities known to produce 0 YOLO detections (per
        # PLAN §A2.6 diagnostic + §A2.10 decision). Keep the placeholder
        # in `results` so list indexing in Phase 9 stays stable; downstream
        # phases guard on `skipped`.
        if zone.trip_dir in SKIP_UPLOAD_ZONES:
            _info(f"  Skipping upload for {zone.name} (zero-events city)")
            results.append({
                "zone_name": zone.name,
                "uploader_email": uploader_email,
                "upload_id": None,
                "status": "Skipped",
                "events": [],
                "skipped": True,
            })
            continue

        token = cit_tokens[uploader_email]
        zone_dir = TRIP_ROOT / zone.trip_dir
        mp4 = next(zone_dir.glob("*.mp4"))
        gpx = next(zone_dir.glob("*.gpx"))
        _info(f"  Upload {k}/{len(ZONES)} ({zone.name}): "
              f"uploading {mp4.name} + {gpx.name} as {uploader_email}")

        try:
            res = api_post_multipart(
                "/uploads/",
                fields={},
                files={"mp4_file": mp4, "gpx_file": gpx},
                token=token,
            )
        except RuntimeError as exc:
            raise SystemExit(f"[seed] Upload failed for {zone.name}: {exc}")
        upload_id = res.get("upload_id")
        if not upload_id:
            raise SystemExit(f"[seed] Upload response missing upload_id: {res!r}")
        tag_demo_seed(db, "uploads", upload_id)

        label = f"Upload {k}/{len(ZONES)} ({zone.name})"
        status, error_msg, elapsed = poll_until_done(
            upload_id, token,
            timeout_sec=UPLOAD_POLL_TIMEOUT_SEC,
            poll_every=2.0,
            report_every=10.0,
            label=label,
        )
        if status != "Done":
            _fail(f"  Upload {upload_id} ended in status={status}: {error_msg}")
            raise SystemExit(f"[seed] Pipeline failed for {zone.name}: {error_msg}")

        detail = api_get(f"/uploads/{upload_id}/detail", token=token)
        events = detail.get("events", []) if isinstance(detail, dict) else []
        for ev in events:
            tag_demo_seed(db, "pothole_events", ev.get("event_id") or ev.get("_id"))
        total_events += len(events)
        _ok(f"  {label}: status=Done, elapsed={elapsed}s, events={len(events)}")

        results.append({
            "zone_name": zone.name,
            "uploader_email": uploader_email,
            "upload_id": upload_id,
            "status": status,
            "events": events,
        })
    real_count = sum(1 for r in results if not r.get("skipped"))
    skipped_count = len(results) - real_count
    skip_suffix = f" ({skipped_count} skipped)" if skipped_count else ""
    _ok(f"Completed {real_count} uploads{skip_suffix}.")
    _phase_done(6, f"{real_count} uploads through pipeline{skip_suffix}, "
                   f"{total_events} total events")
    return results


# ---------------------------------------------------------------------------
# Phase 7 — Lifecycle status variation
# ---------------------------------------------------------------------------
def phase_7_lifecycle(uploads: list[dict],
                      team_leader_email_by_zone: dict[str, str],
                      official_tokens: dict[str, str],
                      db) -> None:
    """Distribute events across Reported/UnderReview/Scheduled/Resolved.

    Multi-step transitions go via the zone team leader's JWT. Events whose
    actual ``zone`` (set by the worker's reverse-geo) doesn't match any of
    our created zones are left at Reported, with an explicit per-event
    warning that includes both the actual zone the worker assigned and the
    expected zone from our zones table.
    """
    global CURRENT_PHASE
    CURRENT_PHASE = "7"
    _step("Phase 7: Lifecycle status variation")

    # Flatten (event_id, actual_zone, expected_zone) across all uploads.
    # Actual zone is read from Mongo directly: the /uploads/{id}/detail API
    # response's events_summary projection doesn't include the `zone` field
    # (backend/app/routers/uploads.py:177-189), so trusting events[i].zone
    # would always yield "" and pick the wrong leader for boundary events.
    # Skipped uploads have events=[] so the inner loop naturally bypasses them.
    all_events: list[tuple[str, str, str]] = []
    for u in uploads:
        for ev in u["events"]:
            eid = ev.get("event_id") or ev.get("_id")
            if not eid:
                continue
            mongo_ev = db["pothole_events"].find_one({"_id": eid}, {"zone": 1})
            actual_zone = (mongo_ev or {}).get("zone") or ""
            expected_zone = u["zone_name"]
            all_events.append((eid, actual_zone, expected_zone))
    if not all_events:
        _warn("  No events to mutate — skipping lifecycle variation.")
        _phase_done(7, "no events produced; lifecycle variation skipped")
        return

    rng = random.Random(RANDOM_SEED)
    rng.shuffle(all_events)

    # Slice by distribution
    n = len(all_events)
    target_counts: dict[str, int] = {}
    cursor = 0
    for status, frac in LIFECYCLE_DISTRIBUTION:
        slice_n = int(round(n * frac))
        if status == LIFECYCLE_DISTRIBUTION[-1][0]:
            slice_n = n - cursor
        target_counts[status] = slice_n
        cursor += slice_n
    _info(f"  Target distribution across {n} events: " +
          ", ".join(f"{s}={c}" for s, c in target_counts.items()))

    # Apply
    cursor = 0
    transition_paths: dict[str, list[tuple[str, list[str]]]] = {
        "Reported":     [],
        "UnderReview":  [("UnderReview", NOTES_REPORTED_TO_UNDERREVIEW)],
        "Scheduled":    [
            ("UnderReview", NOTES_REPORTED_TO_UNDERREVIEW),
            ("Scheduled",   NOTES_UNDERREVIEW_TO_SCHEDULED),
        ],
        "Resolved":     [
            ("UnderReview", NOTES_REPORTED_TO_UNDERREVIEW),
            ("Scheduled",   NOTES_UNDERREVIEW_TO_SCHEDULED),
            ("Resolved",    NOTES_SCHEDULED_TO_RESOLVED),
        ],
    }
    skipped_no_team = 0

    for status, slice_n in target_counts.items():
        bucket = all_events[cursor:cursor + slice_n]
        cursor += slice_n
        if status == "Reported":
            continue
        path = transition_paths[status]
        for i, (event_id, actual_zone, expected_zone) in enumerate(bucket):
            leader_email = (team_leader_email_by_zone.get(actual_zone)
                            or team_leader_email_by_zone.get(expected_zone))
            if not leader_email:
                _warn(f"  event {event_id[:8]}: actual_zone={actual_zone!r} "
                      f"expected_zone={expected_zone!r}; no team leader found, "
                      f"leaving at Reported")
                skipped_no_team += 1
                continue
            leader_tok = official_tokens[leader_email]
            for new_status, notes in path:
                note = notes[(i + cursor) % len(notes)]
                try:
                    api_patch(f"/authority/events/{event_id}/status",
                              {"new_status": new_status, "note": note},
                              token=leader_tok)
                except RuntimeError as exc:
                    _warn(f"  PATCH {event_id[:8]} -> {new_status} failed: {exc}")
                    break

    # Final distribution from the source of truth (Mongo), restricted to
    # documents this seed run tagged.
    final = {}
    for status in ("Reported", "UnderReview", "Scheduled", "Resolved", "Rejected"):
        final[status] = db["pothole_events"].count_documents(
            {"lifecycle_status": status, "_demo_seed": True})
    total = sum(final.values())
    print(f"[seed]      Final distribution: "
          f"Reported: {final['Reported']}, "
          f"UnderReview: {final['UnderReview']}, "
          f"Scheduled: {final['Scheduled']}, "
          f"Resolved: {final['Resolved']} "
          f"(total {total} events"
          + (f"; {final['Rejected']} Rejected" if final['Rejected'] else "")
          + ")")
    _ok(f"Lifecycle distribution applied. Skipped {skipped_no_team} events.")
    _phase_done(7, f"distribution: R{final['Reported']}/U{final['UnderReview']}/"
                   f"S{final['Scheduled']}/Res{final['Resolved']}, "
                   f"{skipped_no_team} zone-mismatch skips")


# ---------------------------------------------------------------------------
# Phase 8 — Hybrid comments
# ---------------------------------------------------------------------------
def phase_8_comments(uploads: list[dict],
                     cit_tokens: dict[str, str],
                     team_leader_email_by_zone: dict[str, str],
                     official_tokens: dict[str, str]) -> None:
    """1-3 alternating citizen+authority comments per upload."""
    global CURRENT_PHASE
    CURRENT_PHASE = "8"
    _step("Phase 8: Hybrid upload comments")
    for i, u in enumerate(uploads):
        if u.get("skipped"):
            continue  # no comment thread for skipped uploads (no upload_id)
        upload_id = u["upload_id"]
        uploader_tok = cit_tokens[u["uploader_email"]]
        # Authority voice: the team leader of the upload's zone (if known).
        # If events landed in a different zone (worker reverse-geo mismatch),
        # we still attach the citizen comment, but skip the authority voice.
        ev_zone = (u["events"][0].get("zone") if u["events"] else u["zone_name"])
        leader_email = team_leader_email_by_zone.get(ev_zone) \
            or team_leader_email_by_zone.get(u["zone_name"])
        authority_tok = official_tokens.get(leader_email) if leader_email else None

        rng = random.Random(RANDOM_SEED + i)
        n_comments = rng.choice([1, 2, 2, 3])  # mode 2, range 1-3
        comments_added = 0
        for j in range(n_comments):
            if j % 2 == 0:
                text = CITIZEN_COMMENTS[(i * 2 + j) % len(CITIZEN_COMMENTS)]
                tok = uploader_tok
                voice = "citizen"
            else:
                if authority_tok is None:
                    continue  # cannot post authority voice without a known team
                text = AUTHORITY_REPLIES[(i * 2 + j) % len(AUTHORITY_REPLIES)]
                tok = authority_tok
                voice = "authority"
            try:
                api_post(f"/uploads/{upload_id}/comments", {"text": text}, token=tok)
                comments_added += 1
            except RuntimeError as exc:
                _warn(f"  comment on {upload_id[:8]} ({voice}) failed: {exc}")
        _info(f"  upload {upload_id[:8]} ({u['zone_name']:14s}) +{comments_added} comment(s)")
    _ok("Comment threads populated.")
    _phase_done(8, f"comments posted across {len(uploads)} uploads")


# ---------------------------------------------------------------------------
# Phase 9 — Support tickets
# ---------------------------------------------------------------------------
def phase_9_tickets(uploads: list[dict],
                    cit_tokens: dict[str, str],
                    team_leader_email_by_zone: dict[str, str],
                    official_tokens: dict[str, str],
                    admin_tok: str, db) -> int:
    """Create the 10 demo tickets. Returns count successfully created."""
    global CURRENT_PHASE
    CURRENT_PHASE = "9"
    _step("Phase 9: Support tickets")
    created = 0
    for i, spec in enumerate(TICKETS, start=1):
        citizen = CITIZENS[spec.citizen_index]
        cit_tok = cit_tokens[citizen.email]

        payload: dict = {
            "target_team_type": spec.target,
            "subject": spec.subject,
            "message": spec.message,
        }
        related_upload = None
        if spec.related_upload_index is not None:
            if spec.related_upload_index >= len(uploads):
                _warn(f"  ticket #{i}: related_upload_index out of range; skipping")
                continue
            related_upload = uploads[spec.related_upload_index]
            if related_upload.get("skipped"):
                _info(f"  Skipping ticket #{i} — related upload for "
                      f"{related_upload['zone_name']} was skipped")
                continue
            payload["related_report_id"] = related_upload["upload_id"]

        try:
            res = api_post("/support/tickets", payload, token=cit_tok)
        except RuntimeError as exc:
            _warn(f"  ticket #{i} {spec.subject!r} create failed: {exc}")
            continue
        tid = res.get("ticket_id") or res.get("_id") or res.get("id")
        if not tid:
            _warn(f"  ticket #{i} created but no id in response: {res!r}")
            continue
        tag_demo_seed(db, "support_tickets", tid)
        created += 1
        _info(f"  +ticket #{i:2d}  {spec.target:8s}  {tid[:8]}  {spec.subject!r}")

        # Resolve handler token for "official" actions. The backend already
        # routed the ticket when it accepted the POST above — read that
        # decision back from /support/tickets/{tid}.assigned_official_user_id
        # (the canonical answer) and convert user_id → email → cached JWT
        # via Mongo. Avoids the broken events[i].get("zone") fallback chain
        # (that field isn't projected by /uploads/{id}/detail; see PLAN §A2.4).
        official_tok_for_ticket = None
        if spec.target == "Official" and related_upload is not None:
            try:
                t = api_get(f"/support/tickets/{tid}", token=admin_tok)
                assigned_uid = t.get("assigned_official_user_id") if isinstance(t, dict) else None
                if assigned_uid:
                    user_doc = db["users"].find_one({"_id": assigned_uid}, {"email": 1})
                    if user_doc and user_doc.get("email"):
                        official_tok_for_ticket = official_tokens.get(user_doc["email"])
            except RuntimeError:
                pass

        # Apply actions
        for actor, kind, value in spec.actions:
            if actor == "admin":
                tok = admin_tok
            elif actor == "official":
                tok = official_tok_for_ticket
                if tok is None:
                    _warn(f"    skipping official action on #{i} — no resolved handler")
                    continue
            elif actor == "citizen":
                tok = cit_tok
            else:
                _warn(f"    unknown actor {actor!r} on #{i}; skipping")
                continue
            try:
                if kind == "response":
                    api_post(f"/support/tickets/{tid}/responses", {"text": value}, token=tok)
                elif kind == "status":
                    api_patch(f"/support/tickets/{tid}/status", {"status": value}, tok)
            except RuntimeError as exc:
                _warn(f"    action {kind}/{actor} on #{i} failed: {exc}")
            time.sleep(0.05)

    _ok(f"Created {created}/{len(TICKETS)} tickets.")
    _phase_done(9, f"{created}/{len(TICKETS)} support tickets")
    return created


# ---------------------------------------------------------------------------
# Phase 10 — sanity checks + credentials file
# ---------------------------------------------------------------------------
def phase_10_sanity(admin_tok: str, db) -> None:
    global CURRENT_PHASE
    CURRENT_PHASE = "10"
    _step("Phase 10: Sanity checks")
    try:
        stats = api_get("/admin/stats", token=admin_tok)
    except RuntimeError as exc:
        _warn(f"  GET /admin/stats failed: {exc}")
        stats = {}

    users = stats.get("users", {}) if isinstance(stats, dict) else {}
    uploads_stat = stats.get("uploads", {}) if isinstance(stats, dict) else {}
    events_stat = stats.get("events", {}) if isinstance(stats, dict) else {}
    _info(f"  /admin/stats users:   {users}")
    _info(f"  /admin/stats uploads: {uploads_stat}")
    _info(f"  /admin/stats events:  {events_stat}")

    # Defence-in-depth: confirm no (0,0) events lurking
    bad = db["pothole_events"].count_documents({"location.coordinates": [0, 0]})
    if bad:
        _warn(f"  Found {bad} events at (0,0) — investigate!")
    else:
        _ok("  No (0,0) phantom events.")

    # Ticket distribution
    by_target_status = list(db["support_tickets"].aggregate([
        {"$group": {"_id": {"t": "$target_team_type", "s": "$status"},
                    "n": {"$sum": 1}}},
        {"$sort": {"_id.t": 1, "_id.s": 1}},
    ]))
    _info(f"  support_tickets by (target, status): "
          + ", ".join(f"{r['_id']['t']}/{r['_id']['s']}={r['n']}" for r in by_target_status))

    _phase_done(10, "sanity checks complete")


def write_credentials_file() -> Path:
    out = HERE / "_demo_credentials.txt"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
    lines = [
        f"# RoadSenseAI demo credentials — generated {now}",
        f"# Source: scripts/seed_full_demo.py",
        "",
        "ADMIN",
        f"  {ADMIN_EMAIL:38s} / {ADMIN_PASSWORD}",
        "",
        f"CITIZENS (password: {CITIZEN_PASSWORD})",
    ]
    for c in CITIZENS:
        lines.append(f"  {c.email:38s} / {CITIZEN_PASSWORD:13s} {c.full_name}")
    lines.append("")
    lines.append(f"AUTHORITIES (password: {AUTHORITY_PASSWORD})  *=team leader")
    for o in OFFICIALS:
        marker = "*" if o.is_leader else " "
        lines.append(f" {marker}{o.email:38s} / {AUTHORITY_PASSWORD:13s} "
                     f"{o.full_name:20s}  team={team_name_for(o.zone_name)}")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------
def main() -> int:
    print("[seed] === RoadSenseAI Full Demo Seed ===")
    t0 = time.monotonic()

    client, admin_tok = phase_1_preconditions()
    db = client[DB_NAME]

    phase_2_reverse_geo()

    zone_ids = phase_3_zones(admin_tok, db)
    official_ids, official_tokens, team_leader_email_by_zone = \
        phase_4_officials_and_teams(admin_tok, zone_ids, db)
    cit_ids, cit_tokens = phase_5_citizens(db)
    uploads = phase_6_uploads(cit_tokens, db)
    phase_7_lifecycle(uploads, team_leader_email_by_zone, official_tokens, db)
    phase_8_comments(uploads, cit_tokens, team_leader_email_by_zone, official_tokens)
    n_tickets = phase_9_tickets(uploads, cit_tokens,
                                team_leader_email_by_zone, official_tokens,
                                admin_tok, db)
    phase_10_sanity(admin_tok, db)

    creds_file = write_credentials_file()
    elapsed = time.monotonic() - t0
    print()
    print("[seed] === SEED COMPLETE ===")
    print(f"[seed] Took {elapsed:.1f}s. Credentials written to {creds_file}")
    print(f"[seed] Summary: 1 admin + {len(CITIZENS)} citizens + "
          f"{len(OFFICIALS)} officials, {len(ZONES)} zones / teams, "
          f"{len(uploads)} uploads, {n_tickets} tickets.")

    # Phases that emitted warnings
    phases_with_warnings = sorted({p for p, _ in WARNINGS}, key=lambda s: int(s))
    if phases_with_warnings:
        print(f"[seed] Phases with warnings: {phases_with_warnings} "
              f"({len(WARNINGS)} warning(s) total)")
    else:
        print("[seed] Phases with warnings: none")
    return 0


if __name__ == "__main__":
    sys.exit(main())
