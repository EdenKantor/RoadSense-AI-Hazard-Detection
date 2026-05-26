"""
Notifications router.

GET    /api/notifications/reads                   → list the current user's read notification_keys
POST   /api/notifications/reads                   → mark one or more notification_keys as read
DELETE /api/notifications/reads/{notification_key} → mark a single notification_key as unread

The notification list itself is NOT stored on the server — pages compute it on
the fly. Only read-state lives here, keyed by a page-defined opaque string.
The user_id is always derived from the JWT (``get_current_user``) and never
trusted from the request body.
"""
from typing import List

from fastapi import APIRouter, Body, Depends, HTTPException

from app.database import get_db
from app.dependencies import get_current_user
from app.repositories import notification_read_repo

router = APIRouter()


@router.get("/reads")
async def get_read_keys(
    current_user=Depends(get_current_user),
    db=Depends(get_db),
) -> dict:
    """Return the set of notification keys the current user has marked as read.

    Returns:
        ``{"read_keys": [...]}`` — strings as written by the per-page logic.
    """
    keys = await notification_read_repo.list_read_keys_for_user(
        db, current_user["_id"]
    )
    return {"read_keys": keys}


@router.post("/reads")
async def post_read_keys(
    payload: dict = Body(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
) -> dict:
    """Mark one or more notification keys as read.

    Args:
        payload: Body with ``{"notification_keys": ["up-abc", "tk-xyz", ...]}``.

    Returns:
        ``{"inserted": <int>, "requested": <int>}``. ``inserted`` may be less
        than ``requested`` if some keys were already marked read; the
        (user_id, notification_key) unique index makes the call idempotent.

    Raises:
        HTTPException: 400 if ``notification_keys`` is missing or not a list.
    """
    keys = payload.get("notification_keys")
    if not isinstance(keys, list):
        raise HTTPException(
            status_code=400,
            detail="`notification_keys` must be a list of strings.",
        )
    cleaned: List[str] = [str(k) for k in keys if isinstance(k, str) and k]

    inserted = await notification_read_repo.mark_multiple_as_read(
        db,
        user_id=current_user["_id"],
        user_role=current_user.get("role", "Citizen"),
        notification_keys=cleaned,
    )
    return {"inserted": inserted, "requested": len(cleaned)}


@router.delete("/reads/{notification_key:path}")
async def delete_read_key(
    notification_key: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
) -> dict:
    """Mark a single notification key as unread by deleting its row.

    Uses the ``:path`` converter on the key so colon-bearing identifiers
    like ``"tk-<id>-reply-3"`` survive URL routing without needing the
    client to escape the colons.

    Args:
        notification_key: The page-defined identifier to clear.

    Returns:
        ``{"deleted": 0 | 1}``.
    """
    deleted = await notification_read_repo.delete_read_key(
        db, current_user["_id"], notification_key
    )
    return {"deleted": deleted}
