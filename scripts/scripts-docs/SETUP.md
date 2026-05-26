# RoadSenseAI — Setup Guide

This guide walks through the full setup from a clean Windows machine to a running observability dashboard.

> **Time required:** 10–15 minutes for first-run setup; 30 seconds on subsequent runs.

---

## 1. Prerequisites

| Tool | Required version | Download |
|------|------------------|----------|
| **Docker Desktop** | latest | <https://www.docker.com/products/docker-desktop/> |
| **Python** | 3.11 or 3.12 | <https://www.python.org/downloads/> |
| **Node.js** | 18 LTS or newer | <https://nodejs.org/en/download/> |
| **Web browser** | any modern browser | — |

> Docker Desktop must be **running** before you start. On Windows it shows a whale icon in the system tray when it's up.

You also need the **YOLO weights file** at `weights/model.pt` (~85 MB). It is shipped inside the project folder you received. See [`weights/README.md`](../../weights/README.md).

### Verify the weights file

```powershell
Get-Item weights\model.pt | Select-Object Length
# Expected: ~89,569,358 bytes (~85.4 MB)
```

If the file is missing or much smaller, contact the project owner for a fresh copy.

---

## 2. First-run setup (one-time)

Open PowerShell **in the project root** (the folder containing `docker-compose.yml` and `README.md`) and run the installer first, then the launcher:

```powershell
# 1. One-time installer. Creates venvs, runs pip + npm install, copies .env
#    templates, pre-pulls Docker images. Offers to install Python 3.12 / Node
#    LTS via winget if either is missing.
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1

# 2. Launch the demo.
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

`setup.ps1` is idempotent — re-running it is safe and finishes in seconds when everything is already installed. Use `setup.ps1 -Force` to rebuild venvs and `node_modules` from scratch.

What `start.ps1` does on every launch:

1. Sanity-checks setup: Docker engine, both venvs, `frontend/node_modules`, `weights/model.pt` ≥ 50 MB, `npm` on PATH. Exits with a clear `Run .\scripts\setup.ps1 first` message if anything is missing.
2. Cleans up any previous run: stops tracked PIDs from `output/dev/demo-state.json`, sweeps orphan venv/node processes, runs `docker compose down --remove-orphans`.
3. Verifies ports 6380, 27017, 8000, and 5173 are free.
4. Starts Redis + MongoDB via `docker compose up -d` and waits up to 30 s for both healthchecks.
5. Clears any stale RQ worker registration keys in Redis (`rq:worker:worker-1/2/3` and `rq:workers` set membership).
6. Spawns **3 separate PowerShell windows**:
   - **Backend** — FastAPI / uvicorn with `DEV_MODE=true`.
   - **Workers** — supervisor spawning 3 named workers (`worker-1`, `worker-2`, `worker-3`).
   - **Frontend** — Vite dev server (`npm run dev`).
7. Opens 2 browser tabs: <http://localhost:5173/> and <http://localhost:5173/dev/pipeline-monitor>.

---

## 3. Daily use

### Start everything
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

### Stop everything
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop.ps1
```
- Stops the backend, workers, and frontend processes (and any orphan venv / `node_modules` processes still listening on ports 5173 / 8000).
- Runs `docker compose down` (containers stop, **named volumes are preserved** so MongoDB data survives).
- To wipe the volumes too (start fresh DB), add the `-RemoveVolumes` switch.

### What's running where

| Service | URL / port | Notes |
|---------|-----------|-------|
| Frontend (React / Vite) | <http://localhost:5173> | the SaaS app |
| Backend (FastAPI) | <http://localhost:8000> | API; `/docs` for Swagger |
| Dev observability dashboard | <http://localhost:5173/dev/pipeline-monitor> | gated by `DEV_MODE=true` |
| Redis (Docker container `roadsense-redis`) | localhost:6380 | RQ queue + pub/sub channel `roadsense:pipeline` |
| MongoDB (Docker container `roadsense-mongodb`) | localhost:27017 | database `roadsenseai` |

### Custom worker count

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1 -WorkerCount 5
```

### Skip browser auto-open

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1 -NoBrowser
```

### Wiping and re-seeding the demo dataset

The demo dataset (users, zones, teams, uploads, events, tickets) lives in MongoDB. Reset and repopulate between sessions with:

```powershell
# Wipe — drops every collection, clears Redis RQ keys, purges uploads/ +
# output/ (preserves uploads/avatars/), recreates 21 indexes + the admin user.
.\backend\venv\Scripts\python.exe scripts\reset_db.py --yes

# Seed — populates 7 zones, 7 citizens, 14 officials, ~18 events from
# 4 real video uploads through the YOLO pipeline, and ~8 support tickets.
# Reads from <project>/Tests/<City>/{*.mp4,*.gpx}. Takes ~7 minutes.
.\backend\venv\Scripts\python.exe scripts\seed_full_demo.py
```

After `reset_db.py`, the live RQ workers' registration keys in Redis are dropped along with everything else. If the next `seed_full_demo.py` Phase 1 aborts with `No RQ workers active`, the workers haven't heartbeated back yet — restart them with `.\scripts\start.ps1`.

Full reference: see [`SCRIPTS.md`](SCRIPTS.md) "Python helper scripts" section.

---

## 4. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Docker Desktop is installed but the engine is not running` | Docker Desktop isn't started | Open Docker Desktop and wait for the whale icon in the tray to be steady, then re-run. |
| `Port 27017 is in use by process mongod (PID …)` | A native MongoDB Windows service or a previous local mongod is using port 27017 | `Stop-Service MongoDB` (run PowerShell as Administrator). On servers without Admin rights, ask the project owner. |
| `Port 6380 is in use by process redis-server (PID …)` | A native Redis Windows service or a previous Docker Compose container is using port 6380 | Run `powershell .\scripts\stop.ps1` first; if the conflict persists, run `docker compose down` to fully release the container's port. |
| `Port 8000 is in use …` / `Port 5173 is in use …` | Another backend or Vite dev-server is already running | Identify and stop it (the error message gives you the PID), then re-run. |
| `weights/model.pt is only 0 MB (expected ~85 MB)` | The weights file is missing or corrupted | See `weights/README.md`. Request a fresh copy of `model.pt` from the project owner. |
| `Python 3.10 detected; 3.11+ is required` | Old Python on PATH | Install Python 3.11 or 3.12 and either remove the older Python from PATH or use `py -3.11` explicitly. |
| The dashboard shows **"Dev mode disabled"** | The backend wasn't started with `DEV_MODE=true` (you launched uvicorn manually instead of via `start.ps1`) | Use `scripts/start.ps1`. It sets `DEV_MODE=true` automatically. Or set `DEV_MODE=true` in `backend/.env` and restart the backend. |
| The dashboard's connection badge is permanently **Reconnecting** | The backend isn't running, or `DEV_MODE` is off, or Redis isn't reachable | Check the **Backend** window for errors. Confirm `docker compose ps` shows both services as `healthy`. |
| Workers panel is empty after upload | The worker supervisor didn't start, or workers crashed | Check the **Workers** window for stack traces. Common cause: bad `worker/.env` (e.g. wrong `REDIS_URL`). |
| Pipeline Stages panel never advances past stage 3 | YOLO model weights are missing or corrupted | See "weights/model.pt is only 0 MB" row above. |
| `WARNING: ... publish_event failed` in the Workers window | Redis pub/sub is unreachable but the pipeline keeps running anyway | This is by design — observability never breaks the pipeline. Check Redis health if it persists. |
| Browser opens to a blank `/dev/pipeline-monitor` page | Vite hot-reload still warming up | Wait ~5 seconds and refresh. |
| You want to start fresh with empty Redis + MongoDB | — | Stop everything (`stop.ps1 -RemoveVolumes`), then re-run `start.ps1`. |

---

## 5. What to look for during a quick verification run

After `start.ps1` finishes:

1. **Browser auto-opens** the dashboard.
2. **Connection badge** in the top-right of the dashboard is green ("Connected").
3. **Workers panel** lists `worker-1`, `worker-2`, `worker-3` with status pills.
4. **Redis Queue panel** counters all read 0 (no pending jobs yet).
5. **MongoDB Activity panel** is empty *or* shows historical events from previous runs.
6. Visit <http://localhost:5173>, log in as a citizen test user (or register), and upload a sample MP4 + GPX file.
7. Switch back to the dashboard:
   - **Pipeline Stages panel** shows the upload's 8-step stepper filling left-to-right.
   - **Workers panel** flips one worker's pill to green ("busy") with the upload ID and current stage visible.
   - **MongoDB Activity panel** scrolls with `EVENT_CREATED` (green) rows as detections persist.

For deeper detail on the launcher and helper scripts, see [`SCRIPTS.md`](SCRIPTS.md).

---

## 6. Stopping cleanly between sessions

Always run `scripts/stop.ps1` before closing PowerShell windows or shutting down. This:

- Kills the tracked backend / worker / frontend processes.
- Brings the Docker containers down cleanly.
- **Preserves the named volumes** so your test data is still there next time.

If you forget and the next `start.ps1` complains about ports being in use, simply run `stop.ps1` first.

---

## 7. Where to look next

- [`README.md`](../../README.md) at project root — short summary + Docker quick start.
- [`SCRIPTS.md`](SCRIPTS.md) — full reference for the launcher trio plus the Python helper scripts.
- [`weights/README.md`](../../weights/README.md) — YOLO weights file details.
