"""
RoadSenseAI — Backend Entrypoint
FastAPI application with CORS, router mounting, and startup lifecycle.
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import connect_db, close_db
from app.routers import auth, uploads, events, authority, admin, health, geocode, zones, support, notifications
# Dev-only observability router is imported only when DEV_MODE is true (see below).

app = FastAPI(
    title="RoadSenseAI API",
    description="Pothole detection and reporting platform — MVP skeleton",
    version="0.1.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Database lifecycle ────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup() -> None:
    """Open the MongoDB connection and launch dev-only observability tasks."""
    await connect_db()
    # Dev-only observability background tasks (subscriber + aggregator)
    if settings.dev_mode:
        from app.routers import dev_observability
        dev_observability.start_background_tasks()


@app.on_event("shutdown")
async def shutdown() -> None:
    """Stop dev observability tasks (if running) and close the MongoDB client."""
    if settings.dev_mode:
        from app.routers import dev_observability
        await dev_observability.stop_background_tasks()
    await close_db()


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(health.router, tags=["System"])
app.include_router(auth.router,      prefix="/api/auth",      tags=["Auth"])
app.include_router(uploads.router,   prefix="/api/uploads",   tags=["Uploads"])
app.include_router(events.router,    prefix="/api/events",    tags=["Events"])
app.include_router(authority.router, prefix="/api/authority", tags=["Authority"])
app.include_router(admin.router,     prefix="/api/admin",     tags=["Admin"])
app.include_router(zones.router,    prefix="/api/admin",     tags=["Zones & Teams"])
app.include_router(geocode.router,  prefix="/api/geocode",  tags=["Geocode"])
app.include_router(support.router,  prefix="/api/support",  tags=["Support"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notifications"])

# ── Dev-only observability dashboard ──────────────────────────────────────────
# Mounted ONLY when DEV_MODE=true. When DEV_MODE=false the router does not
# exist on the app at all; any request to /api/dev/observability/* returns 404.
if settings.dev_mode:
    from app.routers import dev_observability
    app.include_router(dev_observability.router, prefix="/api/dev", tags=["Dev"])

# ── Static files (annotated previews, uploads) ────────────────────────────────
_base = os.path.dirname(os.path.abspath(__file__))
_output_dir = os.path.join(_base, "..", "output")
_uploads_dir = os.path.join(_base, "..", "uploads")
_avatars_dir = os.path.join(_uploads_dir, "avatars")
os.makedirs(_output_dir, exist_ok=True)
os.makedirs(_uploads_dir, exist_ok=True)
os.makedirs(_avatars_dir, exist_ok=True)
app.mount("/static/avatars", StaticFiles(directory=_avatars_dir), name="avatars")
app.mount("/static/output", StaticFiles(directory=_output_dir), name="output")
app.mount("/static/uploads", StaticFiles(directory=_uploads_dir), name="uploads")
