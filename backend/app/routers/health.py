"""Health check endpoint."""
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    """Return a static OK payload used for liveness/readiness checks."""
    return {"status": "ok"}
