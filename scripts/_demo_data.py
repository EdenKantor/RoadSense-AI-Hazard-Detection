"""
Constant tables for the demo-seed script.

Pulled out of ``seed_full_demo.py`` so the main script reads as a phase walk
rather than a wall of literals. All emails / names / templates are
demo-grade fictions — do not use the email addresses for real correspondence.
"""
from __future__ import annotations

from pathlib import Path
from typing import NamedTuple


# ---------------------------------------------------------------------------
# Trip data location
#
# Default: <project_root>/Tests/, so demo videos can live alongside the
# code and be checked into git (or .gitignored at the user's choice).
# Override at runtime by setting the DEMO_TRIPS_DIR environment variable
# to an absolute path pointing at the parent of the city subdirs.
# ---------------------------------------------------------------------------
import os
_HERE = Path(__file__).resolve().parent
_PROJECT_ROOT = _HERE.parent
TRIP_ROOT = Path(os.environ.get("DEMO_TRIPS_DIR") or (_PROJECT_ROOT / "Tests"))


# ---------------------------------------------------------------------------
# Universal passwords
# ---------------------------------------------------------------------------
CITIZEN_PASSWORD = "RoadSense123!"
AUTHORITY_PASSWORD = "RoadSense123!"
ADMIN_EMAIL = "admin@roadsenseai.local"
ADMIN_PASSWORD = "admin123456"


# ---------------------------------------------------------------------------
# Zones
# ---------------------------------------------------------------------------
class ZoneRow(NamedTuple):
    name: str
    description: str
    trip_dir: str  # subdir of TRIP_ROOT


ZONES: list[ZoneRow] = [
    ZoneRow("Haifa",         "Northern coastal city; mixed urban / port roads.",   "Haifa"),
    # Display name uses U+2019 (RIGHT SINGLE QUOTATION MARK) to match the
    # exact string BigDataCloud's reverse-geocoder returns for this city.
    # The worker's event_persister will then route events to this zone
    # instead of auto-creating a duplicate. trip_dir stays ASCII so the
    # filesystem path Tests/Karmiel/ doesn't need renaming.
    ZoneRow("Karmi’el",      "Galilean hill town; winding residential streets.",  "Karmiel"),
    ZoneRow("Nesher",        "Suburban hillside south-east of Haifa.",            "Nesher"),
    ZoneRow("Qiryat ATA",    "Industrial outskirts north of Haifa.",              "Qiryat ATA"),
    ZoneRow("Qiryat Motqin", "Suburb west of Haifa Bay.",                         "Qiryat Motqin"),
    ZoneRow("Tel Aviv",      "Dense urban core with high traffic volume.",        "Tel Aviv"),
    ZoneRow("Jerusalem",     "Mountainous capital city; mixed urban / historic streets.", "Jerusalem"),
]


# Cities whose dashcam clips consistently produce zero YOLO detections
# (portrait orientation incompatible with landscape-trained model — see
# PLAN.md §A2.6 diagnostic). Citizens of these cities are still created
# and registered, but no MP4+GPX upload is attempted for them. Phase 9
# tickets that reference a skipped upload are also skipped (per A2.10).
SKIP_UPLOAD_ZONES: set[str] = {"Nesher", "Qiryat ATA", "Qiryat Motqin"}


# ---------------------------------------------------------------------------
# Citizens
# ---------------------------------------------------------------------------
class CitizenRow(NamedTuple):
    email: str
    full_name: str


CITIZENS: list[CitizenRow] = [
    CitizenRow("liron.k@demo.roadsense.io",  "Liron Kahalon"),
    CitizenRow("yael.s@demo.roadsense.io",   "Yael Shapira"),
    CitizenRow("omer.l@demo.roadsense.io",   "Omer Levi"),
    CitizenRow("noa.a@demo.roadsense.io",    "Noa Avraham"),
    CitizenRow("tomer.b@demo.roadsense.io",  "Tomer Ben-David"),
    CitizenRow("shira.k@demo.roadsense.io",  "Shira Klein"),
    CitizenRow("idan.f@demo.roadsense.io",   "Idan Friedman"),
]


# ---------------------------------------------------------------------------
# Authorities (2 per zone — first listed is the team leader)
# ---------------------------------------------------------------------------
class OfficialRow(NamedTuple):
    email: str
    full_name: str
    zone_name: str
    organisation: str
    is_leader: bool


OFFICIALS: list[OfficialRow] = [
    # Haifa
    OfficialRow("avi.cohen@haifa.muni.il",        "Avi Cohen",      "Haifa",         "Haifa Municipality",         True),
    OfficialRow("liat.mizrahi@haifa.muni.il",     "Liat Mizrahi",   "Haifa",         "Haifa Municipality",         False),
    # Karmi’el (U+2019 — matches BigDataCloud's reverse-geo output; see PLAN §A2.5)
    OfficialRow("daniel.peretz@karmiel.muni.il",  "Daniel Peretz",  "Karmi’el",      "Karmi’el Municipality",      True),
    OfficialRow("rina.azoulay@karmiel.muni.il",   "Rina Azoulay",   "Karmi’el",      "Karmi’el Municipality",      False),
    # Nesher
    OfficialRow("gilad.shimoni@nesher.muni.il",   "Gilad Shimoni",  "Nesher",        "Nesher Municipality",        True),
    OfficialRow("michal.barzilai@nesher.muni.il", "Michal Barzilai","Nesher",        "Nesher Municipality",        False),
    # Qiryat ATA
    OfficialRow("yossi.dahan@qiryat-ata.muni.il", "Yossi Dahan",    "Qiryat ATA",    "Qiryat ATA Municipality",    True),
    OfficialRow("efrat.malka@qiryat-ata.muni.il", "Efrat Malka",    "Qiryat ATA",    "Qiryat ATA Municipality",    False),
    # Qiryat Motqin
    OfficialRow("eitan.naor@qiryat-motqin.muni.il","Eitan Naor",    "Qiryat Motqin", "Qiryat Motqin Municipality", True),
    OfficialRow("sigal.weiss@qiryat-motqin.muni.il","Sigal Weiss",  "Qiryat Motqin", "Qiryat Motqin Municipality", False),
    # Tel Aviv
    OfficialRow("roi.alon@tel-aviv.muni.il",      "Roi Alon",       "Tel Aviv",      "Tel Aviv Municipality",      True),
    OfficialRow("maya.rubin@tel-aviv.muni.il",    "Maya Rubin",     "Tel Aviv",      "Tel Aviv Municipality",      False),
    # Jerusalem
    OfficialRow("itai.rosen@jerusalem.muni.il",   "Itai Rosen",     "Jerusalem",     "Jerusalem Municipality",     True),
    OfficialRow("tal.aviram@jerusalem.muni.il",   "Tal Aviram",     "Jerusalem",     "Jerusalem Municipality",     False),
]


def team_name_for(zone_name: str) -> str:
    return f"{zone_name} Maintenance"


# ---------------------------------------------------------------------------
# Conversational comment templates (used by phase 8)
# ---------------------------------------------------------------------------
CITIZEN_COMMENTS: list[str] = [
    "Saw this on my morning commute — quite a jolt for cyclists too.",
    "This has been here for weeks; thanks for taking it seriously.",
    "Concerning how deep it looks. Hope it can be fixed soon.",
    "Reporting this on behalf of my neighbours, several have complained.",
    "Glad there's now a way to flag these. Will keep submitting as I find them.",
    "Please prioritise — school bus uses this road every morning.",
]

AUTHORITY_REPLIES: list[str] = [
    "Acknowledged. Forwarding to the zone repair crew this week.",
    "Crew dispatched. Expected resolution within 5 working days.",
    "Thanks for the report. Severity assessed as medium; scheduling Tuesday.",
    "Marked for next maintenance window. Will update once patched.",
    "Verified on site. Repair authorised.",
    "Closed — patch completed and inspected on Friday.",
]


# ---------------------------------------------------------------------------
# Lifecycle transition notes (used by phase 7)
# ---------------------------------------------------------------------------
NOTES_REPORTED_TO_UNDERREVIEW: list[str] = [
    "Triaged by zone team.",
    "Severity confirmed at intake.",
    "Logged into weekly repair queue.",
    "Cross-checked against existing reports.",
]

NOTES_UNDERREVIEW_TO_SCHEDULED: list[str] = [
    "Repair window 14-16 May.",
    "Added to next sprint backlog.",
    "Crew assigned; pending materials.",
    "Slotted into Friday's road-works schedule.",
]

NOTES_SCHEDULED_TO_RESOLVED: list[str] = [
    "Patched and inspected.",
    "Asphalt cured; closing.",
    "Repair completed by contractor crew.",
    "Final inspection passed.",
]


# ---------------------------------------------------------------------------
# Lifecycle distribution (sums to 1.0; Rejected intentionally omitted)
# ---------------------------------------------------------------------------
LIFECYCLE_DISTRIBUTION: list[tuple[str, float]] = [
    ("Reported",    0.30),
    ("UnderReview", 0.25),
    ("Scheduled",   0.25),
    ("Resolved",    0.20),
]


# ---------------------------------------------------------------------------
# Demo support tickets (phase 9)
#
# Each entry:
#   - citizen_index: which citizen from CITIZENS list authors the ticket
#   - target: "Official" | "Admin"
#   - related_upload_index: which upload (0-based across uploads list)
#                           or None for Admin-routed tickets
#   - subject / message: ticket body
#   - actions: list of (actor_role, kind, value):
#       actor_role: "official" (uses the related zone's team leader's token)
#                   | "admin" (uses admin token)
#                   | "citizen" (uses the ticket author's token)
#       kind: "response" or "status"
#       value: message body for response, or status string for status flip
#
# Ticket numbering in this list aligns with §6.6 of PLAN.md (1-indexed there,
# 0-indexed here).
# ---------------------------------------------------------------------------
class TicketSpec(NamedTuple):
    citizen_index: int
    target: str  # "Official" | "Admin"
    related_upload_index: int | None
    subject: str
    message: str
    actions: list[tuple[str, str, str]]


TICKETS: list[TicketSpec] = [
    # 1 — Citizen A → Official → Haifa upload → Open
    TicketSpec(0, "Official", 0,
        "Request update on my Haifa report",
        "Hi! I uploaded a clip showing a pothole near my street in Haifa a few days ago. "
        "The status hasn't changed — could someone please take a look and let me know what's "
        "planned? Happy to provide a clearer follow-up video if useful.",
        []),
    # 2 — Citizen B → Official → Karmiel upload → InReview
    TicketSpec(1, "Official", 1,
        "Karmiel: severity seems too low",
        "The pothole I reported in Karmiel is being shown as low severity, but in person it's "
        "much deeper than that — easily 12-15 cm deep with crumbling edges. Could you re-classify?",
        [
            ("official", "response",
             "Thanks for the heads-up — we'll send a field officer this week and re-classify based "
             "on their measurements. I've moved this to UnderReview."),
            ("official", "status", "InReview"),
        ]),
    # 3 — Citizen C → Official → Nesher upload → Resolved (with citizen thanks)
    TicketSpec(2, "Official", 2,
        "Pothole on the Nesher hill road",
        "There's a deep pothole on the road climbing up from the highway in Nesher — it's been "
        "there for at least three weeks. Already uploaded the dashcam clip. Any chance this can be "
        "scheduled soon? Cars are swerving across the lane to avoid it.",
        [
            ("official", "response",
             "Hi, thanks for reporting. The crew completed the patch yesterday morning. "
             "Could you confirm if you've driven past it since?"),
            ("citizen", "response",
             "Confirmed — drove past on my way home tonight, the road is smooth again. "
             "Really appreciate the quick turnaround, thank you!"),
            ("official", "status", "Resolved"),
        ]),
    # 4 — Citizen D → Admin → Open
    TicketSpec(3, "Admin", None,
        "Cannot log in from mobile browser",
        "When I try to log in from my phone (Android, Chrome) the form refuses to submit — "
        "the 'Sign in' button does nothing. Works fine on my laptop. Could you take a look?",
        []),
    # 5 — Citizen E → Admin → InReview
    TicketSpec(4, "Admin", None,
        "Map markers disappear on dark mode toggle",
        "Whenever I switch between light and dark mode on the public map, the pothole markers "
        "vanish for a second or two before reappearing. Not a blocker but a bit jarring. "
        "Tested on Chrome 124 and Firefox 126 — same behaviour.",
        [
            ("admin", "response",
             "Thanks for the detailed reproduction — this is a Leaflet re-render quirk. "
             "We're investigating; will update once we ship a fix. Moving to InReview."),
            ("admin", "status", "InReview"),
        ]),
    # 6 — Citizen F → Admin → Closed (multi-turn)
    TicketSpec(5, "Admin", None,
        "Upload progress bar stuck at 100% but never finishes",
        "I uploaded a ~120 MB video this morning. The progress bar reached 100% but the page "
        "kept spinning for over a minute before showing the upload tracker. Is this expected for "
        "larger clips?",
        [
            ("admin", "response",
             "After the upload completes, the worker still has to run inference (typically 20-60s "
             "depending on clip length). The spinner during that window is expected. We'll add a "
             "clearer 'processing in the background' message to the UI in a future release."),
            ("citizen", "response",
             "Got it — would be great to see that message. Closing for now, thanks!"),
            ("admin", "response",
             "Thanks for the feedback! Logged it in the UI backlog."),
            ("admin", "status", "Resolved"),
            ("admin", "status", "Closed"),
        ]),
    # 7 — Citizen A → Official → Qiryat ATA upload → WaitingForResponse
    TicketSpec(0, "Official", 3,
        "Qiryat ATA: location on map is wrong",
        "The pothole I reported in Qiryat ATA appears about 60 m from where it actually is — "
        "the pin is on the wrong side of the road. Is there a way to correct that?",
        [
            ("official", "response",
             "Thanks — could you share a follow-up clip with the GPS dashcam timestamp visible? "
             "We can re-align the event using a fresh trace."),
            ("official", "status", "InReview"),
            ("official", "status", "WaitingForResponse"),
        ]),
    # 8 — Citizen B → Admin → WaitingForResponse
    TicketSpec(1, "Admin", None,
        "Email notifications never arrive",
        "I configured my email in the profile page but I'm not getting any of the email "
        "notifications I'd expect (replies, status changes). Did I miss a setting?",
        [
            ("admin", "response",
             "Email notifications aren't yet enabled in this build — only in-app notifications "
             "are wired up. Could you tell us which events you'd most like to receive by email? "
             "We'll prioritise those in the next sprint."),
            ("admin", "status", "InReview"),
            ("admin", "status", "WaitingForResponse"),
        ]),
    # 9 — Citizen C → Official → Qiryat Motqin upload → InReview (multi-turn)
    TicketSpec(2, "Official", 4,
        "Qiryat Motqin pothole reopened",
        "I reported a pothole here a few weeks ago that was marked Resolved, but it has reopened "
        "after the recent rain. Same location. Should I file a new report or can the original be "
        "reopened?",
        [
            ("official", "response",
             "Thanks for flagging — we'll reopen the original event and re-dispatch the crew. "
             "Could you confirm whether the surface failed at the patch itself or alongside it?"),
            ("citizen", "response",
             "It looks like the patch material itself sank — the crack runs around the edge "
             "where the new asphalt meets the old."),
            ("official", "status", "InReview"),
        ]),
    # 10 — Citizen D → Admin → Resolved (multi-turn)
    TicketSpec(3, "Admin", None,
        "Suggestion: filter map by date range",
        "Could the public map allow filtering events by the date they were reported? Right now I "
        "see every event ever submitted; for a weekly walk-around it would help to see only the "
        "last 14 days.",
        [
            ("admin", "response",
             "Great suggestion. We have severity + status filters but no date filter yet. "
             "We'll add it to the next milestone."),
            ("citizen", "response",
             "Awesome, thank you! Looking forward to it."),
            ("admin", "status", "Resolved"),
        ]),
    # 11 — Citizen G (Jerusalem) → Official → Jerusalem upload → InReview
    TicketSpec(6, "Official", 6,
        "Jerusalem old-city access road damaged",
        "There's a stretch of road just outside the Old City that's been deteriorating for "
        "weeks — multiple potholes close together. I uploaded a clip earlier today. Given the "
        "tourist traffic in this area, could it be prioritised for repair?",
        [
            ("official", "response",
             "Thanks Idan — the team has reviewed your clip and confirmed three distinct potholes "
             "along that segment. Coordinating with the heritage-zone permits office before "
             "scheduling the patch. Moving to InReview."),
            ("official", "status", "InReview"),
        ]),
]
