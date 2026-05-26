"""
Admin router — authority account approval, upload management, processing review,
               dashboard stats, and user management.

GET  /api/admin/stats                                → aggregate dashboard counts
GET  /api/admin/users                                → list all users (filterable)
GET  /api/admin/pending-authorities                  → list pending authority registrations
POST /api/admin/approve/{user_id}                    → approve or reject an authority account
GET  /api/admin/uploads                              → list all uploads (admin)
GET  /api/admin/uploads/{upload_id}/processing-review → processing review detail
"""
from typing import List, Optional
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_db
from app.auth.rbac import require_role
from app.repositories import authority_repo, user_repo, event_repo
from app.models.authority_profile import ApprovalStatus
from app.schemas.authority_profile import AuthorityProfileResponse, AdminReviewRequest

router = APIRouter()


@router.get("/stats")
async def admin_stats(
    activity_days: int = Query(7, description="Number of days for activity chart (7 or 30)"),
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """
    Aggregate dashboard statistics for the admin dashboard.
    Returns counts from users, uploads, pothole_events, authority_profiles.
    """
    # User counts by role
    total_citizens = await db["users"].count_documents({"role": "Citizen"})
    total_authorities = await db["users"].count_documents({"role": {"$in": ["Authority", "Official"]}, "is_active": True})
    pending_authorities = await db["authority_profiles"].count_documents({"approval_status": "Pending"})

    # Upload counts by status
    total_uploads = await db["uploads"].count_documents({})
    uploads_done = await db["uploads"].count_documents({"status": "Done"})
    uploads_failed = await db["uploads"].count_documents({"status": "Failed"})
    uploads_processing = await db["uploads"].count_documents({"status": {"$in": ["Queued", "Processing"]}})

    # Pothole event counts by lifecycle
    total_events = await db["pothole_events"].count_documents({})
    events_reported = await db["pothole_events"].count_documents({"lifecycle_status": "Reported"})
    events_under_review = await db["pothole_events"].count_documents({"lifecycle_status": "UnderReview"})
    events_scheduled = await db["pothole_events"].count_documents({"lifecycle_status": "Scheduled"})
    events_resolved = await db["pothole_events"].count_documents({"lifecycle_status": "Resolved"})

    # Weekly growth: count documents created in the last 7 days vs previous 7 days
    now = datetime.now(timezone.utc)
    one_week_ago = (now - timedelta(days=7)).isoformat()
    two_weeks_ago = (now - timedelta(days=14)).isoformat()

    users_this_week = await db["users"].count_documents({"created_at": {"$gte": one_week_ago}})
    users_last_week = await db["users"].count_documents({"created_at": {"$gte": two_weeks_ago, "$lt": one_week_ago}})

    authorities_this_week = await db["users"].count_documents({"role": {"$in": ["Authority", "Official"]}, "is_active": True, "created_at": {"$gte": one_week_ago}})
    authorities_last_week = await db["users"].count_documents({"role": {"$in": ["Authority", "Official"]}, "is_active": True, "created_at": {"$gte": two_weeks_ago, "$lt": one_week_ago}})

    pending_this_week = await db["authority_profiles"].count_documents({"approval_status": "Pending", "submitted_at": {"$gte": one_week_ago}})
    pending_last_week = await db["authority_profiles"].count_documents({"approval_status": "Pending", "submitted_at": {"$gte": two_weeks_ago, "$lt": one_week_ago}})

    events_this_month = await db["pothole_events"].count_documents({"created_at": {"$gte": (now - timedelta(days=30)).isoformat()}})
    events_last_month = await db["pothole_events"].count_documents({"created_at": {"$gte": (now - timedelta(days=60)).isoformat(), "$lt": (now - timedelta(days=30)).isoformat()}})

    # Daily activity for the selected range
    days = min(max(activity_days, 7), 30)
    daily_activity = []
    if days == 7:
        # Start from the most recent Sunday
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        days_since_sunday = (today.weekday() + 1) % 7  # weekday(): Mon=0, Sun=6
        sunday = today - timedelta(days=days_since_sunday)
        for i in range(7):
            day_start = sunday + timedelta(days=i)
            day_end = day_start + timedelta(days=1)
            count = await db["pothole_events"].count_documents({
                "created_at": {"$gte": day_start.isoformat(), "$lt": day_end.isoformat()}
            })
            daily_activity.append({
                "day": day_start.strftime("%a"),
                "date": day_start.strftime("%Y-%m-%d"),
                "count": count,
            })
    else:
        # Last month: start from the Sunday 4 weeks ago
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        days_since_sunday = (today.weekday() + 1) % 7
        this_sunday = today - timedelta(days=days_since_sunday)
        start_sunday = this_sunday - timedelta(weeks=3)  # 4 full weeks
        total_days = (this_sunday - start_sunday).days + 7  # include this week
        for i in range(total_days):
            day_start = start_sunday + timedelta(days=i)
            if day_start > today:
                break
            day_end = day_start + timedelta(days=1)
            count = await db["pothole_events"].count_documents({
                "created_at": {"$gte": day_start.isoformat(), "$lt": day_end.isoformat()}
            })
            daily_activity.append({
                "day": day_start.strftime("%a"),
                "date": day_start.strftime("%Y-%m-%d"),
                "count": count,
            })

    # Recent reports (latest 4 events with zone info)
    recent_events_cursor = db["pothole_events"].find({}).sort("created_at", -1).limit(4)
    recent_reports = []
    async for ev in recent_events_cursor:
        uploader = await db["users"].find_one({"_id": ev.get("uploader_id")})
        recent_reports.append({
            "id": ev["_id"],
            "upload_id": ev.get("upload_id", ""),
            "citizen": (uploader.get("full_name") or uploader.get("email", "unknown")) if uploader else "unknown",
            "citizen_email": uploader.get("email", "") if uploader else "",
            "zone": ev.get("zone") or "—",
            "status": ev.get("lifecycle_status", "Reported"),
            "date": ev.get("created_at", ""),
            "severity": ev.get("severity", "Medium"),
        })

    return {
        "users": {
            "citizens": total_citizens,
            "active_officials": total_authorities,
            "pending_officials": pending_authorities,
        },
        "uploads": {
            "total": total_uploads,
            "done": uploads_done,
            "failed": uploads_failed,
            "processing": uploads_processing,
        },
        "events": {
            "total": total_events,
            "reported": events_reported,
            "under_review": events_under_review,
            "scheduled": events_scheduled,
            "resolved": events_resolved,
        },
        "growth": {
            "users_this_week": users_this_week,
            "users_last_week": users_last_week,
            "authorities_this_week": authorities_this_week,
            "authorities_last_week": authorities_last_week,
            "pending_this_week": pending_this_week,
            "pending_last_week": pending_last_week,
            "events_this_month": events_this_month,
            "events_last_month": events_last_month,
        },
        "daily_activity": daily_activity,
        "recent_reports": recent_reports,
    }


@router.get("/users")
async def list_users(
    role: Optional[str] = Query(None, description="Filter by role: Citizen, Authority, Admin"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """
    List all users with optional role and active-status filters.
    Returns user info without password hashes.
    """
    query = {}
    if role:
        if role in {"Authority", "Official"}:
            query["role"] = {"$in": ["Authority", "Official"]}
        else:
            query["role"] = role
    if is_active is not None:
        query["is_active"] = is_active

    cursor = db["users"].find(query, {"hashed_password": 0}).sort("created_at", -1).limit(200)
    docs = await cursor.to_list(length=200)

    result = []
    for d in docs:
        user_data = {
            "user_id": d["_id"],
            "email": d.get("email"),
            "full_name": d.get("full_name"),
            "role": "Authority" if d.get("role") == "Official" else d.get("role"),
            "is_active": d.get("is_active", True),
            "created_at": d.get("created_at"),
        }
        # For authority users, attach profile info if available
        if d.get("role") in {"Authority", "Official"}:
            profile = await authority_repo.find_profile_by_user(db, d["_id"])
            if profile:
                user_data["organisation"] = profile.get("organisation")
                user_data["jurisdiction_area"] = profile.get("jurisdiction_area")
                user_data["approval_status"] = profile.get("approval_status")
        result.append(user_data)

    return result


@router.get("/pending-authorities", response_model=List[AuthorityProfileResponse])
async def list_pending_authorities(
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """
    Return all authority account registrations awaiting admin review.
    Used by the Admin Approval page.
    """
    docs = await authority_repo.list_pending_profiles(db)
    result = []
    for d in docs:
        user_doc = await db["users"].find_one({"_id": d["user_id"]})
        result.append(AuthorityProfileResponse(
            user_id=d["user_id"],
            organisation=d["organisation"],
            jurisdiction_area=d["jurisdiction_area"],
            approval_status=d["approval_status"],
            reviewed_by=d.get("reviewed_by"),
            review_note=d.get("review_note"),
            submitted_at=d["submitted_at"],
            reviewed_at=d.get("reviewed_at"),
            full_name=user_doc.get("full_name") if user_doc else None,
            email=user_doc.get("email") if user_doc else None,
        ))
    return result


@router.post("/approve/{user_id}", response_model=AuthorityProfileResponse)
async def approve_authority(
    user_id: str,
    payload: AdminReviewRequest,
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """
    Approve or reject an authority account.
    - Sets AuthorityProfile.approval_status to Approved | Rejected.
    - If Approved, sets User.is_active = True so the account can log in.
    """
    profile = await authority_repo.find_profile_by_user(db, user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Authority profile not found.")

    now = datetime.now(timezone.utc).isoformat()
    await authority_repo.update_profile_approval(
        db,
        user_id=user_id,
        new_status=payload.approval_status,
        reviewed_by=current_user["_id"],
        review_note=payload.review_note,
        reviewed_at=now,
    )

    # Activate the user account if approved
    is_active = payload.approval_status == ApprovalStatus.Approved
    await user_repo.set_user_active(db, user_id, is_active)

    updated = await authority_repo.find_profile_by_user(db, user_id)
    return AuthorityProfileResponse(
        user_id=updated["user_id"],
        organisation=updated["organisation"],
        jurisdiction_area=updated["jurisdiction_area"],
        approval_status=updated["approval_status"],
        reviewed_by=updated.get("reviewed_by"),
        review_note=updated.get("review_note"),
        submitted_at=updated["submitted_at"],
        reviewed_at=updated.get("reviewed_at"),
    )


@router.post("/users/{user_id}/suspend")
async def suspend_user(
    user_id: str,
    payload: dict,
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """Suspend a user account with a reason."""
    user = await db["users"].find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.get("role") == "Admin":
        raise HTTPException(status_code=400, detail="Cannot suspend an admin account.")

    reason = payload.get("reason", "Suspended by administrator")
    await db["users"].update_one(
        {"_id": user_id},
        {"$set": {"is_active": False, "suspend_reason": reason}},
    )
    return {"status": "suspended", "user_id": user_id, "reason": reason}


@router.post("/users/{user_id}/reactivate")
async def reactivate_user(
    user_id: str,
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """Reactivate a suspended user account."""
    user = await db["users"].find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    await db["users"].update_one(
        {"_id": user_id},
        {"$set": {"is_active": True}, "$unset": {"suspend_reason": ""}},
    )
    return {"status": "active", "user_id": user_id}


@router.get("/uploads")
async def list_uploads(
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """List all uploads for admin review."""
    cursor = db["uploads"].find().sort("created_at", -1).limit(100)
    docs = await cursor.to_list(length=100)
    result = []
    for d in docs:
        uploader = await db["users"].find_one({"_id": d.get("uploader_id")})
        # Get highest severity from events linked to this upload.
        # We short-circuit on the first "High" since it dominates; "Medium"
        # only upgrades from the default "Low" and does not break the loop.
        events = await db["pothole_events"].find(
            {"upload_id": d["_id"]},
            {"severity": 1}
        ).to_list(length=500)
        severity = "Low"
        for ev in events:
            s = ev.get("severity", "Low")
            if s == "High":
                severity = "High"
                break
            if s == "Medium":
                severity = "Medium"
        result.append({
            "upload_id": d["_id"],
            "uploader_id": d.get("uploader_id"),
            "uploader_name": (uploader.get("full_name") or uploader.get("email", "Unknown")) if uploader else "Unknown",
            "uploader_email": uploader.get("email", "") if uploader else "",
            "status": d.get("status", "Unknown"),
            "created_at": d.get("created_at"),
            "mp4_path": d.get("mp4_path"),
            "gpx_path": d.get("gpx_path"),
            "processing_stats": d.get("processing_stats"),
            "severity": severity if d.get("status") != "Failed" else "N/A",
        })
    return result


@router.get("/uploads/{upload_id}/processing-review")
async def processing_review(
    upload_id: str,
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """
    Return processing review detail for a specific upload.
    Includes: upload metadata, processing stats, pothole events, annotated preview paths.
    """
    upload = await db["uploads"].find_one({"_id": upload_id})
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found.")

    # Get pothole events for this upload
    events = await event_repo.list_events_by_upload(db, upload_id)

    # Build annotated preview URLs
    stats = upload.get("processing_stats", {})
    annotated_frames = stats.get("annotated_frames", [])
    preview_urls = [
        f"/static/output/{upload_id}/{fname}"
        for fname in annotated_frames
    ]

    # Resolve uploader name
    uploader_id = upload.get("uploader_id")
    uploader_name = None
    if uploader_id:
        uploader_doc = await db["users"].find_one({"_id": uploader_id}, {"full_name": 1})
        uploader_name = uploader_doc.get("full_name") if uploader_doc else None

    return {
        "upload_id": upload_id,
        "status": upload.get("status", "Unknown"),
        "created_at": upload.get("created_at"),
        "uploader_id": uploader_id,
        "uploader_name": uploader_name,
        "mp4_path": upload.get("mp4_path"),
        "gpx_path": upload.get("gpx_path"),
        "error_message": upload.get("error_message"),
        "processing_stats": stats,
        "preview_urls": preview_urls,
        "events": [
            {
                "event_id": e["_id"],
                "location": e["location"],
                "severity": e["severity"],
                "lifecycle_status": e["lifecycle_status"],
                "detection_count": e["detection_count"],
                "avg_confidence": e["avg_confidence"],
                "detected_at": e.get("detected_at"),
                "frame_thumbnail_path": e.get("frame_thumbnail_path"),
            }
            for e in events
        ],
    }

