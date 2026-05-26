"""
Zones & Teams router — zone CRUD, team CRUD, team membership management.
"""
import uuid
from typing import List, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_db
from app.auth.rbac import require_role

router = APIRouter()


# ── Zone CRUD ──────────────────────────────────────────────────────────────

@router.get("/zones")
async def list_zones(
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """List all zones."""
    cursor = db["zones"].find().sort("name", 1)
    zones = await cursor.to_list(length=100)
    # Enrich with event counts and team count
    result = []
    for z in zones:
        zname = z["name"]
        total = await db["pothole_events"].count_documents({"zone": zname})
        pending = await db["pothole_events"].count_documents({"zone": zname, "lifecycle_status": "Reported"})
        in_progress = await db["pothole_events"].count_documents({"zone": zname, "lifecycle_status": {"$in": ["UnderReview", "Scheduled"]}})
        resolved = await db["pothole_events"].count_documents({"zone": zname, "lifecycle_status": {"$in": ["Resolved", "Closed"]}})
        team_count = await db["teams"].count_documents({"zone_id": z["_id"]})
        # Count team members
        team_members = 0
        async for t in db["teams"].find({"zone_id": z["_id"]}):
            team_members += len(t.get("member_ids", []))
        # Unassigned events count
        unassigned = await db["pothole_events"].count_documents({"zone": zname, "assigned_to": {"$exists": False}})
        unassigned += await db["pothole_events"].count_documents({"zone": zname, "assigned_to": None})

        # Last event date
        last_evt = await db["pothole_events"].find_one({"zone": zname}, sort=[("created_at", -1)])
        last_event_date = last_evt.get("created_at") if last_evt else None

        # Highest open severity
        high_open = await db["pothole_events"].count_documents({"zone": zname, "severity": "High", "lifecycle_status": {"$nin": ["Resolved", "Closed"]}})
        med_open = await db["pothole_events"].count_documents({"zone": zname, "severity": "Medium", "lifecycle_status": {"$nin": ["Resolved", "Closed"]}})
        highest_sev = "High" if high_open > 0 else ("Medium" if med_open > 0 else "Low")

        # Team info
        team_name = None
        leader_name = None
        team_doc = await db["teams"].find_one({"zone_id": z["_id"]})
        if team_doc:
            team_name = team_doc.get("name")
            if team_doc.get("leader_id"):
                leader_doc = await db["users"].find_one({"_id": team_doc["leader_id"]}, {"full_name": 1})
                leader_name = leader_doc.get("full_name") if leader_doc else None

        result.append({
            "zone_id": z["_id"],
            "name": z["name"],
            "description": z.get("description", ""),
            "created_at": z.get("created_at"),
            "event_count": total,
            "pending": pending,
            "in_progress": in_progress,
            "resolved": resolved,
            "team_count": team_count,
            "team_members": team_members,
            "unassigned": unassigned,
            "last_event_date": last_event_date,
            "highest_severity": highest_sev,
            "team_name": team_name,
            "leader_name": leader_name,
        })
    return result


@router.post("/zones")
async def create_zone(
    payload: dict,
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """Create a new zone."""
    name = payload.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Zone name is required.")

    existing = await db["zones"].find_one({"name": name})
    if existing:
        raise HTTPException(status_code=409, detail="Zone with this name already exists.")

    doc = {
        "_id": str(uuid.uuid4()),
        "name": name,
        "description": payload.get("description", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db["zones"].insert_one(doc)
    return {"zone_id": doc["_id"], "name": doc["name"], "description": doc["description"]}


@router.patch("/zones/{zone_id}")
async def update_zone(
    zone_id: str,
    payload: dict,
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """
    Update a zone's description. Renaming is intentionally disallowed: zone
    names are the linkage to pothole_events.zone strings, and renaming would
    orphan all existing events for the zone. Add a migration if rename is
    ever needed.
    """
    zone = await db["zones"].find_one({"_id": zone_id})
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found.")

    description = payload.get("description")
    if description is None:
        raise HTTPException(status_code=400, detail="description is required.")

    await db["zones"].update_one(
        {"_id": zone_id},
        {"$set": {"description": str(description).strip()}},
    )
    return {"status": "updated", "zone_id": zone_id}


@router.delete("/zones/{zone_id}")
async def delete_zone(
    zone_id: str,
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """Delete a zone. Also removes associated teams."""
    result = await db["zones"].delete_one({"_id": zone_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Zone not found.")
    # Clean up teams in this zone
    await db["teams"].delete_many({"zone_id": zone_id})
    return {"status": "deleted"}


# ── Team CRUD ──────────────────────────────────────────────────────────────

@router.get("/teams")
async def list_teams(
    current_user=Depends(require_role("Admin", "Authority")),
    db=Depends(get_db),
):
    """List all teams with member details."""
    cursor = db["teams"].find().sort("name", 1)
    teams = await cursor.to_list(length=100)
    result = []
    for t in teams:
        # Resolve zone name
        zone = await db["zones"].find_one({"_id": t["zone_id"]})
        zone_name = zone["name"] if zone else "Unknown"

        # Resolve member names
        member_ids = t.get("member_ids", [])
        members = []
        if member_ids:
            member_cursor = db["users"].find(
                {"_id": {"$in": member_ids}},
                {"full_name": 1, "email": 1, "phone_number": 1, "employee_id": 1, "is_active": 1}
            )
            async for m in member_cursor:
                members.append({
                    "user_id": m["_id"],
                    "full_name": m.get("full_name", "Unknown"),
                    "email": m.get("email", ""),
                    "phone_number": m.get("phone_number", ""),
                    "employee_id": m.get("employee_id", ""),
                    "is_leader": m["_id"] == t.get("leader_id"),
                    "is_active": m.get("is_active", True),
                })

        result.append({
            "team_id": t["_id"],
            "name": t["name"],
            "zone_id": t["zone_id"],
            "zone_name": zone_name,
            "leader_id": t.get("leader_id"),
            "member_ids": member_ids,
            "members": members,
            "created_at": t.get("created_at"),
        })
    return result


@router.post("/teams")
async def create_team(
    payload: dict,
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """Create a new team."""
    name = payload.get("name", "").strip()
    zone_id = payload.get("zone_id", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Team name is required.")
    if not zone_id:
        raise HTTPException(status_code=400, detail="Zone ID is required.")

    zone = await db["zones"].find_one({"_id": zone_id})
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found.")

    doc = {
        "_id": str(uuid.uuid4()),
        "name": name,
        "zone_id": zone_id,
        "leader_id": None,
        "member_ids": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db["teams"].insert_one(doc)
    return {"team_id": doc["_id"], "name": doc["name"], "zone_id": doc["zone_id"]}


@router.delete("/teams/{team_id}")
async def delete_team(
    team_id: str,
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """Delete a team."""
    result = await db["teams"].delete_one({"_id": team_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Team not found.")
    return {"status": "deleted"}


# ── Team Membership ────────────────────────────────────────────────────────

@router.post("/teams/{team_id}/members")
async def add_team_member(
    team_id: str,
    payload: dict,
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """Add an official to a team. Only Admin can do this."""
    user_id = payload.get("user_id", "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required.")

    team = await db["teams"].find_one({"_id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")

    user = await db["users"].find_one({"_id": user_id})
    if not user or user.get("role") not in ("Authority", "Official"):
        raise HTTPException(status_code=400, detail="User is not an official.")

    if user_id in team.get("member_ids", []):
        raise HTTPException(status_code=409, detail="User is already a member of this team.")

    # Remove from any other team first
    await db["teams"].update_many(
        {"member_ids": user_id},
        {"$pull": {"member_ids": user_id}},
    )
    # Also unset leader if they were leader elsewhere
    await db["teams"].update_many(
        {"leader_id": user_id},
        {"$set": {"leader_id": None}},
    )

    await db["teams"].update_one(
        {"_id": team_id},
        {"$addToSet": {"member_ids": user_id}},
    )
    return {"status": "added"}


@router.delete("/teams/{team_id}/members/{user_id}")
async def remove_team_member(
    team_id: str,
    user_id: str,
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """Remove an official from a team."""
    team = await db["teams"].find_one({"_id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")

    await db["teams"].update_one(
        {"_id": team_id},
        {"$pull": {"member_ids": user_id}},
    )
    # If they were the leader, unset
    if team.get("leader_id") == user_id:
        await db["teams"].update_one(
            {"_id": team_id},
            {"$set": {"leader_id": None}},
        )
    return {"status": "removed"}


@router.post("/teams/{team_id}/leader")
async def set_team_leader(
    team_id: str,
    payload: dict,
    current_user=Depends(require_role("Admin")),
    db=Depends(get_db),
):
    """Set the team leader. Only Admin can do this. User must be a member of the team."""
    user_id = payload.get("user_id", "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required.")

    team = await db["teams"].find_one({"_id": team_id})
    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")

    if user_id not in team.get("member_ids", []):
        raise HTTPException(status_code=400, detail="User must be a member of the team to become leader.")

    await db["teams"].update_one(
        {"_id": team_id},
        {"$set": {"leader_id": user_id}},
    )
    return {"status": "leader_set"}
