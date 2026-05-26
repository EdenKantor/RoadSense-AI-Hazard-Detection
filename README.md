# RoadSenseAI

> [!IMPORTANT]
> **Phase B Project Book** is in the [`Docs/`](Docs/) folder, alongside the Phase A book and presentation. **Examiners — please start there.**

**Project Code:** 26-1-D-9 &nbsp;·&nbsp; **Authors:** Eden Kantor & Noa Sivan &nbsp;·&nbsp; **Advisor:** Mr. Gur Arye Yehuda
**Braude College — Software Engineering**

> AI-powered pothole detection from dashcam video — citizens upload, authorities triage, admins oversee.

RoadSenseAI is a SaaS platform for citizen-sourced road-hazard reporting. A YOLOv8-based ML pipeline turns raw dashcam footage (MP4 + GPX track) into geo-located pothole events, scores their severity, and publishes them to a public map. Field officers triage events through a lifecycle workflow; admins manage zones, teams, and authority approvals.

**What's in the repo:**
- A FastAPI backend with JWT-based RBAC and a MongoDB store.
- A separate RQ worker that runs the 8-stage detection pipeline.
- A React + Vite + Leaflet frontend with three role-specific portals.
- A dev-only observability dashboard with live SSE streaming from the worker.
- Docker Compose for Redis + MongoDB infrastructure.

**Status:** MVP / work-in-progress. Runs end-to-end on a Windows developer machine. No cloud deployment, CI/CD, or production hardening yet.

---

## Getting the Code (Git LFS required)

This repository uses **[Git LFS](https://git-lfs.com/)** for two categories of large files that are **required** for the system to run:
- `weights/model.pt` (~86 MB) — the YOLOv8 model weights.
- `tests/<City>/*.mp4` (~38 MB across 4 files) — demo dashcam clips used by `scripts/seed_full_demo.py`.

Install Git LFS **before** cloning, otherwise these arrive as tiny pointer stubs:

```powershell
git lfs install
git clone https://github.com/EdenKantor/RoadSense-AI-Hazard-Detection.git
```

If you already cloned without LFS installed:

```powershell
git lfs install
git lfs pull
```

Verify the model downloaded fully (should be ~89,569,358 bytes, not ~130):

```powershell
(Get-Item weights\model.pt).Length
```

All other fixtures (`tests/**/*.gpx`, `tests/**/*.py`) are regular git blobs and arrive on a normal clone.

---

## Quick Start (Windows)

**Prereqs:** Docker Desktop running, Python 3.11+, Node 18+, and `weights/model.pt` present (see above).

```powershell
# 1. One-time installer — creates venvs, installs deps, copies .env templates, pre-pulls Docker images
.\scripts\setup.ps1

# 2. Daily launcher — Docker Compose + 3 service windows + browser
.\scripts\start.ps1
```

What you should see:
- Three separate PowerShell windows open: **Backend** (FastAPI / uvicorn), **Workers** (RQ supervisor with 3 named workers), **Frontend** (Vite).
- Browser opens at <http://localhost:5173/dev/pipeline-monitor> (the dev observability dashboard).
- The connection badge turns green; three workers (`worker-1`, `worker-2`, `worker-3`) appear idle.

To stop cleanly: `.\scripts\stop.ps1` (preserves Docker volumes; add `-RemoveVolumes` to wipe).

For the full walkthrough, see [scripts/scripts-docs/SETUP.md](scripts/scripts-docs/SETUP.md). For launcher and helper-script detail, see [scripts/scripts-docs/SCRIPTS.md](scripts/scripts-docs/SCRIPTS.md).

---

## Tech Stack

**Backend** — Python 3.11+, FastAPI, Uvicorn, Motor (async) + PyMongo (sync), RQ, PyJWT, bcrypt, Pydantic v2 + pydantic-settings, httpx, sse-starlette.

**Frontend** — React 18, React Router 6, Axios, Leaflet + react-leaflet + react-leaflet-cluster, Vite 5, lucide-react. (CDN: Inter font, Font Awesome 6.)

**Worker / ML** — PyTorch + torchvision (CPU or GPU auto-detected), Ultralytics YOLOv8, OpenCV (headless), scikit-learn (DBSCAN), NumPy, gpxpy; shares Motor / PyMongo / Redis / RQ with the backend.

**Infrastructure**
- **MongoDB 7** (container `roadsense-mongodb`, port 27017, db `roadsenseai`) — all persistent state.
- **Redis 7** (container `roadsense-redis`, port 6380) — RQ queue and pub/sub channel `roadsense:pipeline`.
- **Local filesystem** — `uploads/` for incoming MP4+GPX and avatars, `output/` for annotated frame JPEGs.
- **External API** — BigDataCloud reverse geocoding (no API key required) for city/zone resolution.

Exact pinned versions live in `backend/requirements.txt`, `frontend/package.json`, and `worker/requirements.lock.txt`.

---

## Architecture

```text
┌──────────────┐    POST /api/uploads/    ┌──────────────┐
│   Citizen    │ ───────────────────────► │   FastAPI    │
│   browser    │ ◄─── poll /detail ────── │   backend    │
│              │                          │   :8000      │
└──────────────┘                          └──────┬───────┘
                                                 │ enqueue
                                                 ▼
                                          ┌──────────────┐
                                          │    Redis     │
                                          │  queue +     │
                                          │  pub/sub     │
                                          │    :6380     │
                                          └──────┬───────┘
                                   ┌─────────────┴─────────────┐
                                   ▼                           ▼
                           ┌──────────────┐             ┌──────────────┐
                           │  RQ workers  │ ─ publish ─►│  SSE stream  │
                           │  (worker-1,  │  pipeline   │  (dev mode)  │
                           │   worker-2,  │  events     └──────┬───────┘
                           │   worker-3)  │                    │
                           └──────┬───────┘                    │
                                  │ insert / merge             │
                                  ▼                            ▼
                           ┌──────────────┐             ┌──────────────┐
                           │   MongoDB    │ ─ query ──► │   Browser    │
                           │    :27017    │ /api/events │   dashboard  │
                           └──────────────┘             └──────────────┘
```

**Process layout (dev):**

| Process | Port | Started by |
|---|---|---|
| MongoDB | 27017 | `docker compose up -d` |
| Redis | 6380 | `docker compose up -d` |
| Backend (FastAPI / Uvicorn) | 8000 | `start.ps1` |
| Worker supervisor | n/a | `start.ps1` — spawns N RQ child processes |
| Frontend (Vite dev server) | 5173 | `start.ps1` |

Vite proxies `/api`, `/health`, `/static` to `http://localhost:8000`, so the browser sees a single origin.

The dev observability dashboard at `/dev/pipeline-monitor` is **gated by `DEV_MODE=true`** on the backend (returns 404 when off). When on, the worker publishes `stage_start` / `stage_complete` / `event_created` / `event_merged` / `event_reopened` events to the Redis pub/sub channel `roadsense:pipeline`; the backend subscribes and forwards them to the browser via Server-Sent Events.

---

## Pipeline Deep-Dive

The worker pipeline lives in [worker/pipeline/job.py](worker/pipeline/job.py) as `process_upload(upload_id)`. It runs eight sequential stages, updating the upload's `status` and `status_history` as it goes.

| # | Stage | File | What it does |
|---|---|---|---|
| 1 | GPX parse | `gpx_parser.py` | gpxpy → `[{lat, lon, timestamp}]`, sorted by time. |
| 2 | Frame sample | `frame_sampler.py` | OpenCV `VideoCapture`; samples one frame every `frame_sample_interval_seconds` (default `0.5s` = 2 fps). |
| 3 | YOLO inference | `yolo_inference.py` | Ultralytics YOLOv8 with `conf=0.20` and NMS IoU `0.5`. Filters detections to the pothole class. Saves an annotated JPEG with the bbox drawn. |
| 4 | Confidence filter | `job.py` (inline) | Re-applies `confidence >= threshold`. Defensive — already enforced by stage 3. |
| 5 | Timestamp align | `timestamp_align.py` | Linear interpolation between surrounding GPX points. Edges clamp; no GPX → `(0.0, 0.0)` fallback. |
| 6 | DBSCAN consolidation | `dbscan_consolidation.py` | sklearn DBSCAN, `metric="haversine"`, `eps = 5 m`, `min_samples=1`. Singletons kept. Records `frame_area` from real video resolution for severity calibration. |
| 7 | Severity heuristic | `severity_heuristic.py` | FHWA-inspired 3-stage classifier (see below). |
| 8 | Persist + dedup | `event_persister.py` | 2dsphere `$nearSphere` lookup within 5 m. New event → insert. Existing match → merge atomically; if it was Resolved, reopen first. |

After stage 8 the worker writes `status: "Done"`, the `event_ids` list, and a `processing_stats` dict (frames sampled, raw/filtered/aligned detections, clusters, events persisted, duplicates suppressed, annotated frames, output dir).

### Severity classification (FHWA-inspired, 3-stage)

In [worker/pipeline/severity_heuristic.py](worker/pipeline/severity_heuristic.py). FHWA defines pothole severity by physical diameter and depth, but a monocular dashcam can't measure depth — so the implementation uses bbox-area-ratio (`bbox_area / frame_area`) as a proxy for diameter.

| Stage | Logic |
|---|---|
| 1. Confidence floor | If `avg_confidence < 0.4` → **Low** regardless of size or count. Prevents low-quality detections from scoring severe. |
| 2. Size bucket | `bbox_area / frame_area`: below `0.05` → Low; below `0.15` → Medium; otherwise → **High**. (FHWA: <30 cm ≈ <5 % of 640², 30–90 cm ≈ 5–15 %.) |
| 3. Multi-detection boost | If `detection_count >= 3` → bump up one level (Low → Medium, Medium → High). Rewards potholes seen consistently across frames. |

`frame_area` uses the **real** video resolution when available (recorded by stage 6), with `640 × 640 = 409,600` as a fallback. `severity_score` is a 0.0–1.0 number derived from the size ratio, with a `+0.1` bonus when the multi-detection boost fires. All thresholds are tunable constants in `worker/config.py`.

### Cross-upload dedup with merge + auto-reopen

In [worker/pipeline/event_persister.py](worker/pipeline/event_persister.py). Earlier versions used skip-only dedup; the current logic **merges** new evidence into the existing event, and if that event was already `Resolved`, it is **re-opened** first.

The merge is a 3-phase MongoDB update, race-safe under concurrent worker writes:
- **Phase 0** — seed `_confidence_sum` on legacy docs (idempotent).
- **Phase 1** — atomic operators: `$inc detection_count, _confidence_sum`, `$max max_bbox_area`, `$addToSet contributing_uploads`, `$push frame_references, annotated_paths`, `$set last_seen_at, updated_at`. On reopen, also set `lifecycle_status: "Reported"` and clear `resolved_at, resolved_by`.
- **Phase 2** — aggregation-pipeline update: recompute `avg_confidence` from the post-Phase-1 state, then set `severity` and `severity_score`.

Reopens append a row to `event_status_history` with `changed_by: "system:auto-reopen"` so the audit trail stays complete. The worker emits `event_merged` or `event_reopened` pub/sub events for the dashboard.

### Status lifecycles
- **Upload:** `Queued → Processing → Done | Failed`. Every transition is appended to `status_history` and shown on the citizen's Upload Tracker.
- **Pothole event:** `Reported → UnderReview → Scheduled → Resolved | Rejected`. Every transition is recorded in `event_status_history` with `changed_by`, `changed_by_role`, `note`, `changed_at`.

---

## Roles & Permissions

| Role | Access |
|---|---|
| Citizen | Upload MP4+GPX, view own uploads + reports, view public hazard map, file support tickets. |
| Authority | View and update lifecycle status of events in their assigned zone. Team leaders also manage their team and handle zone-routed support tickets. |
| Admin | Approve/reject Authority registrations, manage zones and teams, system-wide upload review, analytics, admin-queue support tickets. |
| (anonymous) | Public landing page and public hazard map only. |

**Registration flow:** citizens self-register (no gate); authority registrations require Admin approval before login; admins are created internally only via [scripts/create_admin.py](scripts/create_admin.py) (no self-service admin signup).

**RBAC:** `require_role()` is a FastAPI dependency factory in `backend/app/auth/rbac.py`. The JWT carries `sub` (user id) and `role` claims; `ROLE_ALIASES` normalize `Official` ↔ `Authority`. The frontend mirrors this with `RoleRoute` wrappers around each portal subtree.

---

## API Endpoints

The FastAPI app mounts nine routers (plus a tenth dev-only router gated by `DEV_MODE`). Full Swagger reference: run the backend and visit <http://localhost:8000/docs>.

| Mount | Purpose |
|---|---|
| `/health` | Liveness probe. |
| `/api/auth` | OAuth2 password login, register (citizen / authority), `/me`, avatar upload. |
| `/api/uploads` | Upload create, status polling, enriched detail (events + thumbnails + history), comments, hide/seen flags. |
| `/api/events` | Public viewport-bounded event list with severity and lifecycle filters. |
| `/api/authority` | Authority event list, detail with audit history, lifecycle updates, analytics, team management. |
| `/api/admin` (+ `/zones`, `/teams`) | Platform stats, users, pending approvals, all-uploads review; zone/team CRUD with leader + member management. |
| `/api/geocode/reverse` | Reverse-geocode passthrough to BigDataCloud (cached). |
| `/api/support/tickets` | Support ticket CRUD with role-aware visibility. |
| `/api/dev/observability/*` | SSE event stream + queue/worker/Mongo snapshots. **Mounted only when `DEV_MODE=true`.** |

REST JSON everywhere, except `POST /api/auth/login` which uses `application/x-www-form-urlencoded` per the OAuth2 password-flow spec. GeoJSON Points are stored `[longitude, latitude]`.

---

## Frontend Routes

Defined in [frontend/src/App.jsx](frontend/src/App.jsx). `/map` is a proxy: logged-in users get the interactive map (filters + editing), anonymous users get the read-only shared map. Legacy `/official/*` paths redirect to `/authority/*`.

- **Public:** `/`, `/about`, `/help`, `/login`, `/register`, `/register/official`, `/map`, `/dev/pipeline-monitor`
- **Citizen** (`CitizenShell`): upload, my uploads, reports, upload status, report detail, map, notifications, profile, help
- **Authority** (`AuthorityShell`, allows Authority or Admin): dashboard, events, event update, analytics, team, profile, notifications, help
- **Admin** (`AdminShell`): dashboard, users, approvals, uploads review, upload map, zones, teams, profile, notifications, help

---

## Project Structure

```
RoadSenseAI/
├── backend/                    FastAPI REST API + auth + DB layer
│   ├── main.py                 App entry; mounts routers + static dirs
│   └── app/                    config, database, auth (jwt + rbac),
│                               models, schemas, services, repositories,
│                               routers (9 + dev_observability, gated)
│
├── frontend/                   React SPA (Vite)
│   ├── vite.config.js          Proxies /api, /health, /static to :8000
│   └── src/                    App.jsx (routes), api/client.js, auth/,
│                               components/, hooks/, pages/, styles/
│
├── worker/                     ML processing pipeline (separate process)
│   ├── worker_main.py          SimpleWorker entry (Windows-friendly)
│   ├── queue_setup.py          RQ Queue factory + Windows fork→spawn patch
│   └── pipeline/               job.py (8-stage orchestrator) + the 7 stage
│                               modules (gpx, frames, yolo, align, dbscan,
│                               severity, persister)
│
├── weights/
│   ├── model.pt                ~86 MB YOLOv8s — tracked via Git LFS
│   └── README.md               source / classes / verification
│
├── scripts/                    Launcher + helper scripts
│   ├── setup.ps1               First-run installer (idempotent)
│   ├── start.ps1               Daily launcher
│   ├── stop.ps1                Clean shutdown
│   ├── create_admin.py         Bootstrap an Admin user
│   ├── create_indexes.py       Create 21 MongoDB indexes (idempotent)
│   ├── reset_db.py             Wipe demo DB back to factory-fresh
│   ├── seed_full_demo.py       Populate the demo dataset (10 phases)
│   ├── _demo_data.py           Constant tables for seed_full_demo.py
│   ├── _demo_helpers.py        HTTP / Mongo helpers for seed_full_demo.py
│   └── scripts-docs/           SCRIPTS.md, SETUP.md
│
├── tests/                      pytest suites
│   ├── section_1/              YOLO improvement unit tests (14)
│   └── section_3/              DBSCAN dedup tests (10 unit + 21 MongoDB)
│
├── Docs/                       Phase A + Phase B books, presentation
├── uploads/                    (gitignored) per-upload MP4+GPX + avatars/
├── output/                     (gitignored) annotated frame JPEGs
├── docker-compose.yml          Redis + MongoDB containers
└── .gitignore
```

---

## Development

### Tests

Run from the project root with the worker venv:

```powershell
.\worker\venv\Scripts\pytest.exe tests/ --tb=short
```

Expected: **24 passed, 21 skipped** when MongoDB is not running; **45 passed** with MongoDB up. The skipped tests are the MongoDB integration suite under `tests/section_3` and auto-skip when Mongo is unreachable.

| Suite | Coverage |
|---|---|
| `tests/section_1/` | 14 tests — YOLO confidence threshold, NMS IoU, and FHWA severity bands. |
| `tests/section_3/` | 10 DBSCAN consolidation unit tests + 21 MongoDB integration tests for the merge / reopen / atomic concurrency logic. |

There are no FastAPI router unit tests and no frontend component tests yet.

### Dev observability dashboard

When the backend runs with `DEV_MODE=true` (the default for `start.ps1`), the dashboard at <http://localhost:5173/dev/pipeline-monitor> shows live state in four panels: **Workers** (supervisor + child status), **Redis Queue** (Started / Finished / Failed counters), **Pipeline Stages** (per-upload 8-step stepper with durations), and **MongoDB Activity** (chronological `EVENT_CREATED` / `EVENT_MERGED` / `EVENT_REOPENED` / `DEDUP_HIT` feed). The worker publishes JSON envelopes to `roadsense:pipeline`; the backend fans them over SSE with 15 s heartbeats and automatic reconnection (exponential backoff capped at 30 s).

### Manual launch (without `start.ps1`)

```powershell
docker compose up -d redis mongodb                                          # infra
cd backend  && .\venv\Scripts\python.exe -m uvicorn main:app --port 8000    # backend
cd ..\worker && .\venv\Scripts\python.exe worker_main.py                     # worker
cd ..\frontend && npm run dev -- --port 5173                                 # frontend
```

### Bootstrap an admin user

After a fresh database, there's no admin to log in as. `scripts/create_admin.py` is idempotent:

```powershell
.\backend\venv\Scripts\python.exe scripts\create_admin.py
```

Default credentials (dev only): `admin@roadsenseai.local` / `admin123456`. Change in production.

### Reset & re-seed the demo dataset

```powershell
.\backend\venv\Scripts\python.exe scripts\reset_db.py --yes        # wipe (preserves uploads/avatars/)
.\backend\venv\Scripts\python.exe scripts\seed_full_demo.py        # populate; ~7 min
```

`seed_full_demo.py` writes all demo logins to `scripts/_demo_credentials.txt` (gitignored, regenerated each run). After a reset, restart the workers with `start.ps1` if the next seed reports no active workers. Full reference: [scripts/scripts-docs/SCRIPTS.md](scripts/scripts-docs/SCRIPTS.md).

---

## Configuration

Both services read `.env` files via `pydantic-settings`. Templates are committed at `backend/.env.example` and `worker/.env.example`. Key variables:

**Backend** — `MONGODB_URL`, `MONGODB_DB_NAME` (`roadsenseai`), `REDIS_URL` (dev uses port 6380), `SECRET_KEY` (⚠️ override outside dev), `ALGORITHM` (`HS256`), `ACCESS_TOKEN_EXPIRE_MINUTES` (60), `CORS_ORIGINS`, `DEV_MODE` (mounts the observability router; `start.ps1` sets it true).

**Worker** ([worker/config.py](worker/config.py)) — `YOLO_WEIGHTS_PATH` (`../weights/model.pt`), `FRAME_SAMPLE_INTERVAL_SECONDS` (`0.5` = 2 fps), `YOLO_CONFIDENCE_THRESHOLD` (`0.20`), `YOLO_NMS_IOU_THRESHOLD` (`0.5`), `DBSCAN_EPS_METERS` (`5.0`), `DBSCAN_MIN_SAMPLES` (`1`), `WORKER_COUNT` (`3`), `ENABLE_OBSERVABILITY` (`True`; failures are swallowed so the pipeline never breaks).

**Severity tuning** (constants in `worker/config.py`) — confidence floor `0.4`, size ratios `0.05` / `0.15`, multi-detection boost at `3`, frame-area fallback `409,600`.

See the `.env.example` files for the complete list and defaults.

---

## Known Issues & Notes

Honest caveats so future maintainers don't waste time:

- **`npm install` needs `--legacy-peer-deps`** — `react-leaflet-cluster@4` declares a peer dep that conflicts with the tree; benign in practice (the map renders). `setup.ps1` passes the flag automatically.
- **Windows-only dev** — PowerShell launcher trio plus `multiprocessing` fork→spawn patches. No Linux/Mac parity tested.
- **In-memory caches** — reverse-geocode results, in-flight event lists, and notification read sets live in process memory; a restart wipes them. Redis is available but not used for caching.
- **GPX-video sync** assumes the first GPX point is the video start; no clock-skew correction.
- **`SECRET_KEY` defaults to a dev placeholder** — production must generate a real key (`python -c "import secrets; print(secrets.token_urlsafe(32))"`). JWTs are trusted for 60 min with no refresh/revocation; no rate limiting, no HTTPS/reverse proxy.
- **Print-based worker logging** — no logging framework, structured logs, or metrics.
- **Tests cover the worker pipeline only** — no router or frontend tests yet.

---

## Roadmap

- Password-change and email-verification flows (UI placeholders exist).
- Production deployment: Dockerfiles, IaC, CI/CD, HTTPS/TLS.
- Live push instead of polling; per-city severity calibration.
- ML feedback loop: retrain on admin-corrected events.
- Authority bulk actions, PDF analytics export, admin audit-log viewer.

---

## References & Acknowledgements

- [scripts/scripts-docs/SETUP.md](scripts/scripts-docs/SETUP.md) — full setup walkthrough.
- [scripts/scripts-docs/SCRIPTS.md](scripts/scripts-docs/SCRIPTS.md) — launcher trio + Python helpers reference.
- [weights/README.md](weights/README.md) — YOLOv8 model details, classes, verification.

**Acknowledgements:**
- YOLOv8 weights from [`collabdoor/road-anomaly-detection`](https://github.com/collabdoor/road-anomaly-detection) (RDD2022-trained), used under the source repository's license. The model was not retrained in-house.
- [Ultralytics](https://github.com/ultralytics/ultralytics) for YOLOv8 and the inference runtime.
- [RQ (Redis Queue)](https://github.com/rq/rq) for the worker job queue.
- [FHWA Distress Identification Manual (FHWA-RD-03-031)](https://www.fhwa.dot.gov/publications/research/infrastructure/pavements/ltpp/13092/13092.pdf) — informs the severity classifier's diameter bands.
- [BigDataCloud](https://www.bigdatacloud.com/) reverse-geocoding API (free tier, no key required) for city/zone resolution.

## License

Licensed under the MIT License — see [LICENSE](LICENSE).