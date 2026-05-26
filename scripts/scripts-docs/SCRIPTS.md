# Scripts Reference — `setup.ps1` / `start.ps1` / `stop.ps1` and Python helpers

Single-page reference for the three PowerShell scripts that drive the
RoadSenseAI demo on Windows, plus the Python helper scripts in the same
folder. All scripts live in `scripts/` and are designed to be re-runnable
without leaving the system in a half-state.

---

## At a glance

| Script | Purpose | When to run | Required prereqs |
|--------|---------|-------------|------------------|
| `scripts/setup.ps1` | One-time installation: Python venvs, npm install, `.env` files, Docker image pre-pull | Once after cloning the repo. Re-run after pulling new requirements or with `-Force` to rebuild venvs. | Docker Desktop running. (Will offer to install Python 3.12 / Node.js LTS via winget if missing.) |
| `scripts/start.ps1` | Daily launcher: `docker compose up`, spawns 3 separate console windows (Backend, Workers, Frontend), opens 2 browser tabs | Every time you want the demo running. Re-run any time to restart cleanly. | `setup.ps1` has been run successfully. Docker Desktop running. |
| `scripts/stop.ps1` | Clean shutdown: kills tracked PIDs, `docker compose down`, optionally wipes volumes | When you're done for the session. | None — safe to run when nothing is up. |
| `scripts/create_admin.py` | Insert the default Admin user (`admin@roadsenseai.local` / `admin123456`). | After a fresh DB (or `stop.ps1 -RemoveVolumes`). | `start.ps1` running so MongoDB is up. |
| `scripts/create_indexes.py` | Create 21 MongoDB indexes across 9 collections (idempotent). | Automatically by `reset_db.py`; manually after schema additions. | MongoDB up. |
| `scripts/reset_db.py` | Wipe the demo DB back to factory-fresh: drops 9 collections, clears Redis RQ keys, purges `uploads/` + `output/` (preserves `uploads/avatars/`), re-runs `create_indexes.py` + `create_admin.py`. | Before each fresh demo seed. | MongoDB + Redis up. Use `--yes` to skip the WIPE prompt. |
| `scripts/seed_full_demo.py` | Populate the demo dataset: 7 zones, 7 citizens, 14 officials, ≈18 events from 4 real video uploads, 11 ticket specs (≈8 created). 10-phase script; ≈7 min runtime. | After `reset_db.py`; whenever you need the demo dataset back. | Full stack up (`start.ps1`); `Tests/<City>/` populated with `*.mp4` + `*.gpx`. Honors `DEMO_TRIPS_DIR` env var to override the data root. |

---

## First-time use

```powershell
# 1. Clone or unpack the project, then open PowerShell in the project root.
# 2. Make sure Docker Desktop is running (whale icon in the system tray).

# 3. One-time installation. Will prompt to install Python / Node via winget if missing.
.\scripts\setup.ps1

# 4. Launch the demo.
.\scripts\start.ps1
```

That's it. The browser opens automatically at <http://localhost:5173/> and
<http://localhost:5173/dev/pipeline-monitor>. Three separate PowerShell
windows appear — one each for Backend, Workers, and Frontend (Vite). Each
window streams its service's logs live.

Docker container logs (Redis, MongoDB) are deliberately **not** shown in
their own window — MongoDB's connection chatter floods it and makes the
window unreadable. Tail them on demand from any shell:

```powershell
docker compose logs -f mongodb
docker compose logs -f redis
docker compose logs -f          # both, interleaved
```

---

## Daily use

```powershell
# Start
.\scripts\start.ps1

# Stop
.\scripts\stop.ps1

# Restart (no need to stop first - start.ps1 cleans up the previous run automatically)
.\scripts\start.ps1
```

### Useful flags

```powershell
# Run with 5 worker processes instead of 3
.\scripts\start.ps1 -WorkerCount 5

# Skip the browser auto-open
.\scripts\start.ps1 -NoBrowser

# Stop and ALSO wipe Redis + MongoDB volumes (data loss!)
.\scripts\stop.ps1 -RemoveVolumes

# Force-rebuild venvs and node_modules (use after major dependency changes)
.\scripts\setup.ps1 -Force
```

---

## What `start.ps1` actually launches

Three separate console windows, in order:

| Window | What it runs | How it's spawned |
|--------|--------------|------------------|
| **Backend** | `python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000` (with `DEV_MODE=true` and Redis/Mongo URLs in env) | `powershell.exe -NoExit -Command "..."` |
| **Workers** | `python worker_supervisor.py` (with `WORKER_COUNT=N` and `ENABLE_OBSERVABILITY=true`) | `powershell.exe -NoExit -Command "..."` |
| **Frontend** | `npm run dev` | `Start-Process -FilePath <full-path-to-npm.cmd>` directly |

The frontend deliberately does **not** go through `powershell -Command "npm run dev"`. That pattern causes npm to exit early on Windows, which kills the Vite dev server. Calling `npm.cmd` directly with `Start-Process` is the only reliable launch method.

Docker container logs are intentionally not mirrored into a fourth window — see "First-time use" above for the on-demand `docker compose logs -f` commands.

Before spawning the windows, `start.ps1` clears any stale RQ worker
registration keys in Redis (`rq:worker:worker-1/2/3`, plus `rq:workers`
set membership). This is a defensive net for the case where a previous
session ended without `stop.ps1` running cleanly — RQ refuses to start a
worker whose name is already registered, so without this cleanup the
**Workers** window would crash with `ValueError: There exists an active
worker named 'worker-N'`. `stop.ps1` performs the same cleanup
immediately before `docker compose down`.

---

## Common errors and fixes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Setup not complete. The following are missing or invalid: ...` | First run, or someone deleted `backend/venv` / `worker/venv` / `frontend/node_modules` / `weights/model.pt` | Run `.\scripts\setup.ps1`. The error message names exactly which prereq is missing. |
| `Docker engine is not running` | Docker Desktop isn't started | Open Docker Desktop, wait for the whale icon to be steady, re-run. |
| `Port 6380 is in use by process redis-server (PID …)` after cleanup | A non-Docker process is holding the port (a native MongoDB/Redis Windows service) | Use the printed `Get-Process -Id <pid>` to identify it; `Stop-Process -Id <pid>` if safe; on a Windows MongoDB service: `Stop-Service MongoDB` (Admin required). |
| `Infrastructure did not become healthy in 30s` | Docker Desktop is slow, or the compose file is broken | Run `docker compose logs` in the project root to see container errors. |
| Dashboard shows "Reconnecting…" forever | Backend isn't running, `DEV_MODE` isn't set, or Redis is unreachable | Look at the **Backend** window. `start.ps1` always sets `DEV_MODE=true` — if you launched the backend manually instead, that's the issue. |
| Dashboard shows "Dev mode disabled" | Backend was started without `DEV_MODE=true` | Use `start.ps1` instead of running uvicorn manually. It always sets `DEV_MODE=true`. |
| Frontend window closes immediately | Most likely a missing `frontend/node_modules` (sanity check should catch this); otherwise an npm error | Run `.\scripts\setup.ps1 -Force` to reinstall, then `start.ps1` again. |
| `winget install` fails inside `setup.ps1` | winget is missing on this Windows version, or the package source is unreachable | Install Python 3.12 / Node.js LTS manually from the URLs in the error message, then re-run `setup.ps1`. |
| `npm install` fails with EACCES / antivirus blocking | Antivirus scanning `node_modules/.bin` while npm writes it | Whitelist the project folder in your antivirus. Re-run `setup.ps1 -Force`. |
| `weights/model.pt is only 0 MB` | The weights file wasn't included or is corrupted | See `weights/README.md`. Request a fresh `model.pt` (~85 MB) from the project owner. |

---

## Creating an Admin user

Use this when MongoDB is freshly created (or after `stop.ps1 -RemoveVolumes`)
and there's no Admin to log in as. The frontend does not allow self-registration
as Admin — Admin accounts are created internally only.

```powershell
# From project root, with start.ps1 running so MongoDB is up:
.\backend\venv\Scripts\python.exe scripts\create_admin.py
```

The script connects to MongoDB using `backend/.env` (or default
`mongodb://localhost:27017` / `roadsenseai`), then inserts a user with:

| Field | Value |
|-------|-------|
| email | `admin@roadsenseai.local` |
| password | `admin123456` |
| role | `Admin` |
| full_name | `Default Admin` |
| is_active | `true` |

It is **idempotent** — re-running it after the admin already exists just
prints "Admin already exists" and exits cleanly.

> **Security note:** these are dev/demo credentials only. In production,
> log in once with this account, then change the password and/or replace it
> with a properly-generated Admin via the admin UI. Do not deploy a public
> instance with `admin123456` in place.

---

## State file (`output/dev/demo-state.json`)

`start.ps1` writes a small JSON file so `stop.ps1` knows what to terminate:

```json
{
  "schema_version": 3,
  "started_at": "2026-04-30T15:30:00",
  "workspace": "C:\\path\\to\\RoadSenseAI",
  "worker_count": 3,
  "ports": { "redis": 6380, "mongodb": 27017, "backend": 8000, "frontend": 5173 },
  "processes": [
    { "name": "backend",  "pid": 12346 },
    { "name": "workers",  "pid": 12347 },
    { "name": "frontend", "pid": 12348 }
  ]
}
```

You can safely delete this file — `stop.ps1` falls back to the orphan
sweep (any process whose executable lives under `backend/venv`, `worker/venv`,
or `frontend/node_modules`) plus `docker compose down`, and the next
`start.ps1` will create a fresh state file.

---

## Python helper scripts

### `create_indexes.py` — MongoDB indexes (idempotent)

```powershell
.\backend\venv\Scripts\python.exe scripts\create_indexes.py
```

Creates the 21 named indexes the platform relies on: 2 on `users`, 3 on
`uploads`, 4 on `pothole_events`, 2 on `event_status_history`, 2 on
`authority_profiles`, 3 on `support_tickets`, 2 on `teams`, 1 on `zones`,
2 on `notifications_read`. Skips any index that already exists. The
2dsphere geo index on `pothole_events.location` is created at runtime by
the worker's `event_persister`, not here.

### `reset_db.py` — wipe the demo database

```powershell
.\backend\venv\Scripts\python.exe scripts\reset_db.py            # prompts "type WIPE"
.\backend\venv\Scripts\python.exe scripts\reset_db.py --yes      # no prompt
```

Seven phases, all idempotent: (1) confirmation gate, (2) drop every
Mongo collection it finds, (3) clear stale RQ worker keys in Redis,
(4) purge every subdirectory of `uploads/` and `output/` **except**
`uploads/avatars/` (so user profile pictures survive), (5) re-run
`create_indexes.py`, (6) re-run `create_admin.py`, (7) print a summary
table of remaining doc counts per collection.

After running this, the live RQ worker processes will have had their
registration keys deleted from Redis but their Python state still
believes they're registered. They re-register on their next heartbeat
tick (usually within a minute), but if the next seed run can't see them
in `rq:workers`, restart them with `.\scripts\start.ps1`.

### `seed_full_demo.py` — populate the demo dataset

```powershell
.\backend\venv\Scripts\python.exe scripts\seed_full_demo.py
```

Reads input video clips from `<project_root>/Tests/<City>/` (one
`*.mp4` + one `*.gpx` per city). Override the data root with the
`DEMO_TRIPS_DIR` environment variable if you want to point elsewhere.

Ten phases, ≈7 minutes end-to-end:

1. Preconditions — backend reachable, admin login works, RQ workers
   registered, trip data present for the four uploading cities.
2. Reverse-geo sanity check — confirms each city's midpoint coordinate
   round-trips through `/api/geocode/city` to the expected name.
3. Create 7 zones via `POST /api/admin/zones`.
4. Register + admin-approve 14 authority officials; create 7 teams; add
   2 members per team and promote the first as leader.
5. Register 7 citizens.
6. Upload one MP4 + GPX per city, round-robin citizens. Three cities
   are listed in `SKIP_UPLOAD_ZONES` (Nesher, Qiryat ATA, Qiryat Motqin)
   because their portrait-orientation clips produce zero YOLO detections
   — they're registered as zones/teams/citizens but no upload is
   attempted.
7. Lifecycle status variation — flips events through
   Reported → UnderReview → Scheduled → Resolved in a 30/25/25/20%
   split, using the actual event-zone read from Mongo to pick the right
   team leader for each PATCH.
8. Hybrid upload-comment threads (1-3 comments per upload, alternating
   citizen + authority voices).
9. Eleven support tickets (3 are pre-skipped because their related
   upload was skipped; ≈8 succeed).
10. Sanity check via `GET /api/admin/stats` + write
    `scripts/_demo_credentials.txt` listing every account.

`scripts/_demo_credentials.txt` is gitignored. Re-run the script any
time to regenerate it.

### Internal helper modules

`scripts/_demo_data.py` holds the constant tables (zone list, citizen
list, official list with team membership, comment templates, lifecycle
transition notes, ticket specs). `scripts/_demo_helpers.py` holds the
shared HTTP / Mongo / GPX-parse / multipart-upload / polling helpers.
Both are imported by `seed_full_demo.py`; neither is meant to be run
directly.
