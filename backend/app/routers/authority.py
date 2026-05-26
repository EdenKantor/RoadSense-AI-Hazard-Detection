"""
Authority router — actionable event list, single event detail, and lifecycle status updates.

GET   /api/authority/events                  → list pothole events for this authority
GET   /api/authority/events/{event_id}       → single event detail with status history
PATCH /api/authority/events/{id}/status      → update lifecycle status + audit log
GET   /api/authority/profile                 → fetch current user's authority_profile
PATCH /api/authority/profile                 → self-service profile update (department/designation/zone)
"""
from typing import List, Optional
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from app.database import get_db
from app.auth.rbac import require_role
from app.dependencies import get_current_user
from app.services.event_service import update_lifecycle
from app.repositories import event_repo, authority_repo
from app.schemas.pothole_event import (
    PotholeEventResponse,
    GeoJSONPoint,
    LifecycleStatusUpdateRequest,
)

router = APIRouter()


async def _check_event_access(db, current_user: dict, event_doc: dict) -> None:
    """Verify the current Authority user may access this event.

    Authorisation tiers:
      * **Admin** is always allowed.
      * **Team leader** (``team.leader_id == user._id``) is allowed when the
        event's ``zone`` matches the team's zone.
      * **Regular team member** is allowed only when ``event.assigned_to``
        equals their own user id.

    Args:
        db: Mongo database handle.
        current_user: the authenticated user document.
        event_doc: the pothole_event document being accessed.

    Raises:
        HTTPException: 403 when the user is not on a team, the event is in a
            different zone, or the event is not assigned to the member.
    """
    if current_user.get("role") == "Admin":
        return
    team = await db["teams"].find_one({"member_ids": current_user["_id"]})
    if not team:
        raise HTTPException(status_code=403, detail="You are not assigned to any team.")
    zone = await db["zones"].find_one({"_id": team["zone_id"]})
    zone_name = zone["name"] if zone else None
    is_leader = team.get("leader_id") == current_user["_id"]

    event_zone = event_doc.get("zone")
    if is_leader:
        if event_zone != zone_name:
            raise HTTPException(status_code=403, detail="This event is not in your zone.")
    else:
        if event_doc.get("assigned_to") != current_user["_id"]:
            raise HTTPException(status_code=403, detail="This event is not assigned to you.")


@router.get("/events", response_model=List[PotholeEventResponse])
async def authority_events(
    lifecycle_status: Optional[str] = Query(
        None, description="Filter by lifecycle status (e.g. Reported, UnderReview)"
    ),
    severity: Optional[str] = Query(None),
    current_user=Depends(require_role("Authority", "Admin")),
    db=Depends(get_db),
):
    """
    List actionable pothole events for the authority dashboard.
    Supports filtering by lifecycle status and severity.
    Admin sees everything; Authority users see only events in their assigned zone.
    """
    # Admin sees everything
    query = {}
    if current_user.get("role") == "Authority":
        team = await db["teams"].find_one({"member_ids": current_user["_id"]})
        if not team:
            return []
        zone = await db["zones"].find_one({"_id": team["zone_id"]})
        if not zone:
            return []

        is_leader = team.get("leader_id") == current_user["_id"]
        if is_leader:
            # Team leader sees all events in the zone
            query["zone"] = zone["name"]
        else:
            # Regular member sees only events assigned to them
            query["assigned_to"] = current_user["_id"]

    if lifecycle_status:
        query["lifecycle_status"] = lifecycle_status
    if severity:
        query["severity"] = severity

    cursor = db["pothole_events"].find(query).limit(500)
    docs = await cursor.to_list(length=500)

    return [
        PotholeEventResponse(
            event_id=d["_id"],
            upload_id=d["upload_id"],
            location=GeoJSONPoint(coordinates=d["location"]["coordinates"]),
            severity=d["severity"],
            lifecycle_status=d["lifecycle_status"],
            detection_count=d["detection_count"],
            avg_confidence=d["avg_confidence"],
            detected_at=d["detected_at"],
            created_at=d["created_at"],
            assigned_to=d.get("assigned_to"),
            zone=d.get("zone"),
        )
        for d in docs
    ]


@router.get("/events/{event_id}")
async def authority_event_detail(
    event_id: str,
    current_user=Depends(require_role("Authority", "Admin")),
    db=Depends(get_db),
):
    """
    Return a single pothole event with its status change history.
    Used by the Official event detail / status update page.
    """
    doc = await event_repo.find_event_by_id(db, event_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found.")

    # Enforce zone/assignment access
    await _check_event_access(db, current_user, doc)

    # Resolve uploader name
    uploader_id = doc.get("uploader_id")
    uploader_name = None
    if uploader_id:
        uploader_doc = await db["users"].find_one({"_id": uploader_id}, {"full_name": 1})
        uploader_name = uploader_doc.get("full_name") if uploader_doc else None

    # Fetch status change history
    history_cursor = db["event_status_history"].find(
        {"event_id": event_id}
    ).sort("changed_at", -1)
    history = await history_cursor.to_list(length=50)

    # Resolve changed_by user names
    changer_ids = list({h.get("changed_by") for h in history if h.get("changed_by")})
    changer_names = {}
    if changer_ids:
        changer_cursor = db["users"].find({"_id": {"$in": changer_ids}}, {"full_name": 1})
        async for u in changer_cursor:
            changer_names[u["_id"]] = u.get("full_name", "Unknown")

    return {
        "event_id": doc["_id"],
        "upload_id": doc["upload_id"],
        "uploader_id": uploader_id,
        "uploader_name": uploader_name,
        "location": doc["location"],
        "severity": doc["severity"],
        "lifecycle_status": doc["lifecycle_status"],
        "detection_count": doc["detection_count"],
        "avg_confidence": doc["avg_confidence"],
        "detected_at": doc.get("detected_at"),
        "created_at": doc.get("created_at"),
        "frame_thumbnail_path": doc.get("frame_thumbnail_path"),
        "annotated_paths": doc.get("annotated_paths", []),
        "status_history": [
            {
                "history_id": h.get("_id"),
                "old_status": h.get("old_status"),
                "new_status": h.get("new_status"),
                "changed_by": h.get("changed_by"),
                "changed_by_name": changer_names.get(h.get("changed_by"), h.get("changed_by_role", "System")),
                "changed_by_role": h.get("changed_by_role"),
                "note": h.get("note"),
                "changed_at": h.get("changed_at"),
                "edited_at": h.get("edited_at"),
            }
            for h in history
        ],
    }

@router.get("/analytics")
async def authority_analytics(
    days: int = Query(30, description="Time range: 7 or 30 days"),
    current_user=Depends(require_role("Authority", "Admin")),
    db=Depends(get_db),
):
    """
    Compute analytics for Authority dashboard:
    - Trending events by status per day
    - Average time to resolve
    - Resolution time trend
    """
    # Get events visible to this authority (same logic as events list)
    query = {}
    if current_user.get("role") == "Authority":
        team = await db["teams"].find_one({"member_ids": current_user["_id"]})
        if not team:
            return {"trending": [], "avg_resolve_days": None, "resolve_trend": []}
        zone = await db["zones"].find_one({"_id": team["zone_id"]})
        if not zone:
            return {"trending": [], "avg_resolve_days": None, "resolve_trend": []}
        is_leader = team.get("leader_id") == current_user["_id"]
        if is_leader:
            query["zone"] = zone["name"]
        else:
            query["assigned_to"] = current_user["_id"]

    events = await db["pothole_events"].find(query).to_list(length=5000)

    now = datetime.now(timezone.utc)
    range_days = min(max(days, 7), 30)

    # --- Trending: daily counts by status ---
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if range_days == 7:
        days_since_sun = (today.weekday() + 1) % 7
        start = today - timedelta(days=days_since_sun)
        end = start + timedelta(days=6)  # Sun to Sat
    else:
        days_since_sun = (today.weekday() + 1) % 7
        this_sun = today - timedelta(days=days_since_sun)
        start = this_sun - timedelta(weeks=3)
        end = start + timedelta(days=27)  # 4 full weeks

    trending = []
    d = start
    while d <= end:
        key = d.isoformat()[:10]
        label = d.strftime("%a")
        day_end = d + timedelta(days=1)
        pending = 0
        in_progress = 0
        resolved = 0
        for e in events:
            ca = e.get("created_at", "")
            if ca >= key and ca < day_end.isoformat()[:10] + "T":
                s = e.get("lifecycle_status", "Reported")
                if s in ("Reported",):
                    pending += 1
                elif s in ("UnderReview", "Scheduled"):
                    in_progress += 1
                elif s in ("Resolved", "Closed"):
                    resolved += 1
        trending.append({"date": key, "day": label, "pending": pending, "in_progress": in_progress, "resolved": resolved})
        d += timedelta(days=1)

    return {
        "trending": trending,
    }


@router.get("/my-team")
async def my_team_info(
    current_user=Depends(require_role("Authority")),
    db=Depends(get_db),
):
    """Return team info for the current official including zone and leader status."""
    team = await db["teams"].find_one({"member_ids": current_user["_id"]})
    if not team:
        return {"team": None, "zone": None, "is_leader": False}

    zone = await db["zones"].find_one({"_id": team["zone_id"]})
    zone_name = zone["name"] if zone else "Unknown"
    is_leader = team.get("leader_id") == current_user["_id"]

    members = []
    for mid in team.get("member_ids", []):
        u = await db["users"].find_one({"_id": mid}, {"full_name": 1, "email": 1})
        if u:
            members.append({
                "user_id": u["_id"],
                "full_name": u.get("full_name", "Unknown"),
                "email": u.get("email", ""),
                "is_leader": mid == team.get("leader_id"),
            })

    return {
        "team": {"team_id": team["_id"], "name": team["name"], "members": members},
        "zone": zone_name,
        "is_leader": is_leader,
    }


@router.post("/events/{event_id}/assign")
async def assign_event_to_member(
    event_id: str,
    payload: dict,
    current_user=Depends(require_role("Authority")),
    db=Depends(get_db),
):
    """Team leader assigns/reassigns an event to a team member, or unassigns it."""
    team = await db["teams"].find_one({"member_ids": current_user["_id"]})
    if not team or team.get("leader_id") != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Only team leaders can assign events.")

    event = await event_repo.find_event_by_id(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")

    # Verify event is in leader's zone
    zone = await db["zones"].find_one({"_id": team["zone_id"]})
    if not zone or event.get("zone") != zone["name"]:
        raise HTTPException(status_code=403, detail="This event is not in your zone.")

    assignee_id = payload.get("user_id", "").strip()

    # Empty user_id means unassign
    if not assignee_id:
        await db["pothole_events"].update_one(
            {"_id": event_id},
            {"$unset": {"assigned_to": ""}},
        )
        return {"status": "unassigned", "event_id": event_id}

    # Verify assignee is a member of this team
    if assignee_id not in team.get("member_ids", []):
        raise HTTPException(status_code=400, detail="User is not a member of your team.")

    await db["pothole_events"].update_one(
        {"_id": event_id},
        {"$set": {"assigned_to": assignee_id}},
    )
    return {"status": "assigned", "event_id": event_id, "assigned_to": assignee_id}


@router.patch("/events/history/{history_id}/note")
async def update_history_note(
    history_id: str,
    payload: dict,
    current_user=Depends(require_role("Authority", "Admin")),
    db=Depends(get_db),
):
    """Update the note of a status history entry."""
    entry = await db["event_status_history"].find_one({"_id": history_id})
    if not entry:
        raise HTTPException(status_code=404, detail="History entry not found.")
    now = datetime.now(timezone.utc).isoformat()
    await db["event_status_history"].update_one(
        {"_id": history_id},
        {"$set": {"note": payload.get("note", ""), "edited_at": now}},
    )
    return {"status": "updated"}


@router.delete("/events/history/{history_id}")
async def delete_history_entry(
    history_id: str,
    current_user=Depends(require_role("Authority", "Admin")),
    db=Depends(get_db),
):
    """Delete a status history entry."""
    result = await db["event_status_history"].delete_one({"_id": history_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="History entry not found.")
    return {"status": "deleted"}


@router.patch("/events/{event_id}/status", response_model=PotholeEventResponse)
async def update_event_status(
    event_id: str,
    payload: LifecycleStatusUpdateRequest,
    current_user=Depends(require_role("Authority", "Admin")),
    db=Depends(get_db),
):
    """
    Update the lifecycle status of a pothole event.
    Appends an EventStatusHistory audit record.
    """
    # Enforce zone/assignment access
    event = await event_repo.find_event_by_id(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    await _check_event_access(db, current_user, event)

    updated = await update_lifecycle(
        db,
        event_id=event_id,
        new_status=payload.new_status.value,
        changed_by=current_user["_id"],
        changed_by_role=current_user["role"],
        note=payload.note,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Event not found.")

    return PotholeEventResponse(
        event_id=updated["_id"],
        upload_id=updated["upload_id"],
        location=GeoJSONPoint(coordinates=updated["location"]["coordinates"]),
        severity=updated["severity"],
        lifecycle_status=updated["lifecycle_status"],
        detection_count=updated["detection_count"],
        avg_confidence=updated["avg_confidence"],
        detected_at=updated["detected_at"],
        created_at=updated["created_at"],
    )


# ── Self-service authority profile (department / designation / zone) ──────────


def _serialize_authority_profile(profile: dict) -> dict:
    """Project a stored authority_profile doc to the API response shape."""
    return {
        "user_id": profile.get("user_id"),
        "organisation": profile.get("organisation", ""),
        "jurisdiction_area": profile.get("jurisdiction_area", ""),
        "approval_status": profile.get("approval_status"),
        "department": profile.get("department", ""),
        "designation": profile.get("designation", ""),
        "zone": profile.get("zone", ""),
        "submitted_at": profile.get("submitted_at"),
        "reviewed_at": profile.get("reviewed_at"),
    }


@router.get("/profile")
async def get_my_authority_profile(
    current_user=Depends(get_current_user),
    db=Depends(get_db),
) -> dict:
    """Return the authority_profile document linked to the current user.

    Citizens and Admins have no authority_profile; the endpoint returns 404
    in that case so the frontend can decide whether to surface the editor.

    Returns:
        Serialized profile dict (organisation, jurisdiction_area, approval_status,
        department, designation, zone, submitted_at, reviewed_at).

    Raises:
        HTTPException: 404 if the current user has no linked authority_profile.
    """
    profile = await authority_repo.find_profile_by_user(db, current_user["_id"])
    if not profile:
        raise HTTPException(status_code=404, detail="Authority profile not found.")
    return _serialize_authority_profile(profile)


@router.patch("/profile")
async def update_my_authority_profile(
    payload: dict = Body(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
) -> dict:
    """Self-service patch for the current user's authority profile.

    Only the user-editable fields (``department``, ``designation``, ``zone``)
    are accepted; admin-controlled fields (approval_status, organisation,
    jurisdiction_area) are ignored. Empty strings are stored as-is so the
    user can clear a previously-set value.

    Args:
        payload: Body with any subset of ``{department, designation, zone}``.

    Returns:
        The updated profile dict (same shape as GET /profile).

    Raises:
        HTTPException: 404 if the current user has no linked authority_profile.
    """
    profile = await authority_repo.find_profile_by_user(db, current_user["_id"])
    if not profile:
        raise HTTPException(status_code=404, detail="Authority profile not found.")

    updates = {}
    for field in ("department", "designation", "zone"):
        if field in payload and isinstance(payload[field], str):
            updates[field] = payload[field].strip()

    if updates:
        await db["authority_profiles"].update_one(
            {"user_id": current_user["_id"]},
            {"$set": updates},
        )

    fresh = await authority_repo.find_profile_by_user(db, current_user["_id"])
    return _serialize_authority_profile(fresh)
