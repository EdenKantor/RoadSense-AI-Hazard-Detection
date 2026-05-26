"""
Support ticket router.

POST /api/support/tickets               → create a new support ticket
GET  /api/support/tickets/mine          → list tickets created by the current user
GET  /api/support/tickets               → list tickets visible to the current user (role-aware)
GET  /api/support/tickets/{id}          → fetch a single ticket if visible
PATCH /api/support/tickets/{id}/status  → update ticket status (assigned handler only)
POST /api/support/tickets/{id}/responses → append a response to a ticket

Visibility model (strict, no cross-flow):

  Citizen   → only tickets they created
  Admin     → only tickets where target_team_type == Admin
  Official  → only tickets where target_team_type == Official
              AND assigned_official_user_id == current user id

Routing logic for Official-targeted tickets:
- A ticket targeted at "Official" with a related_report_id is routed to the
  team leader of the team that handles the report's zone.
- If no team leader can be resolved, ticket creation is BLOCKED with HTTP 400
  and a clear error message. Admin will NOT see or route Official tickets.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from app.database import get_db
from app.dependencies import get_current_user
from app.models.support_ticket import (
    TargetTeamType,
    TicketStatus,
    new_support_ticket_doc,
)

router = APIRouter()


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

async def _resolve_official_handler(db, related_report_id: Optional[str]):
    """
    Given a related report id, find the appropriate Official handler.

    Returns (assigned_official_user_id, related_zone, error_message).
    On success: (user_id, zone_name, None)
    On failure: (None, None, "human-readable reason")
    """
    if not related_report_id:
        return None, None, "A related report is required to route an Official ticket."

    upload = await db["uploads"].find_one({"_id": related_report_id})
    if not upload:
        return None, None, "Related report not found."

    # Try to derive a zone from any event linked to this upload
    event = await db["pothole_events"].find_one({"upload_id": related_report_id, "zone": {"$exists": True, "$ne": None}})
    if not event or not event.get("zone"):
        return None, None, "No responsible authority could be identified for this report (no zone)."

    zone_name = event.get("zone")

    zone_doc = await db["zones"].find_one({"name": zone_name})
    if not zone_doc:
        return None, zone_name, f"No responsible authority could be identified for zone '{zone_name}'."

    team = await db["teams"].find_one({"zone_id": zone_doc["_id"]})
    if not team:
        return None, zone_name, f"No team is assigned to zone '{zone_name}'."

    leader_id = team.get("leader_id")
    if not leader_id:
        return None, zone_name, f"The team for zone '{zone_name}' has no team leader assigned."

    return leader_id, zone_name, None


def _serialize_ticket(doc: dict) -> dict:
    """Project a raw ticket Mongo document into the API-facing response shape."""
    return {
        "ticket_id": doc["_id"],
        "created_by_user_id": doc.get("created_by_user_id"),
        "created_by_user_role": doc.get("created_by_user_role"),
        "target_team_type": doc.get("target_team_type"),
        "subject": doc.get("subject"),
        "message": doc.get("message"),
        "related_report_id": doc.get("related_report_id"),
        "related_zone": doc.get("related_zone"),
        "status": doc.get("status"),
        "assigned_official_user_id": doc.get("assigned_official_user_id"),
        "assigned_admin_user_id": doc.get("assigned_admin_user_id"),
        "responses": doc.get("responses", []),
        "status_history": doc.get("status_history", []),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        "last_response_at": doc.get("last_response_at"),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/tickets")
async def create_ticket(
    payload: dict = Body(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Create a new support ticket."""
    target = payload.get("target_team_type")
    subject = (payload.get("subject") or "").strip()
    message = (payload.get("message") or "").strip()
    related_report_id = payload.get("related_report_id") or None

    if target not in (TargetTeamType.Official.value, TargetTeamType.Admin.value):
        raise HTTPException(status_code=400, detail="Invalid target_team_type.")
    if not subject:
        raise HTTPException(status_code=400, detail="Subject is required.")
    if not message:
        raise HTTPException(status_code=400, detail="Message is required.")

    assigned_official = None
    assigned_admin = None
    related_zone = None

    if target == TargetTeamType.Official.value:
        # Strict routing: must resolve to a valid team leader, otherwise BLOCK creation.
        leader_id, zone_name, error = await _resolve_official_handler(db, related_report_id)
        if error:
            raise HTTPException(status_code=400, detail=error)
        assigned_official = leader_id
        related_zone = zone_name
    # For Admin Support: leave unassigned; any admin can pick it up

    ticket_id = str(uuid.uuid4())
    doc = new_support_ticket_doc(
        ticket_id=ticket_id,
        created_by_user_id=current_user["_id"],
        created_by_user_role=current_user.get("role", "Citizen"),
        target_team_type=target,
        subject=subject,
        message=message,
        related_report_id=related_report_id,
        related_zone=related_zone,
        assigned_official_user_id=assigned_official,
        assigned_admin_user_id=assigned_admin,
    )
    await db["support_tickets"].insert_one(doc)
    return _serialize_ticket(doc)


@router.get("/tickets/mine")
async def list_my_tickets(
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """List tickets created by the current user."""
    cursor = db["support_tickets"].find({"created_by_user_id": current_user["_id"]}).sort("created_at", -1).limit(200)
    docs = await cursor.to_list(length=200)
    return [_serialize_ticket(d) for d in docs]


@router.get("/tickets")
async def list_visible_tickets(
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """
    List tickets visible to the current user.
    Strict separation:
      Citizen  → only their own tickets
      Admin    → only Admin-target tickets
      Official → only Official-target tickets where they are the assigned handler
    """
    role = current_user.get("role", "Citizen")
    user_id = current_user["_id"]

    if role == "Admin":
        cursor = db["support_tickets"].find({
            "target_team_type": TargetTeamType.Admin.value,
        }).sort("created_at", -1).limit(500)
    elif role in ("Authority", "Official"):
        cursor = db["support_tickets"].find({
            "target_team_type": TargetTeamType.Official.value,
            "assigned_official_user_id": user_id,
        }).sort("created_at", -1).limit(500)
    else:
        # Citizen → reuse /mine semantics
        cursor = db["support_tickets"].find({"created_by_user_id": user_id}).sort("created_at", -1).limit(500)

    docs = await cursor.to_list(length=500)
    # Enrich with author info for non-citizen views
    if role in ("Admin", "Authority", "Official"):
        result = []
        for d in docs:
            author = await db["users"].find_one({"_id": d.get("created_by_user_id")})
            serialized = _serialize_ticket(d)
            serialized["author_name"] = (author.get("full_name") or author.get("email")) if author else "Unknown"
            result.append(serialized)
        return result
    return [_serialize_ticket(d) for d in docs]


@router.get("/tickets/{ticket_id}")
async def get_ticket(
    ticket_id: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Fetch a single ticket if the current user is allowed to see it.

    Args:
        ticket_id: UUID of the support ticket.
        current_user: Authenticated user document.
        db: Mongo database handle.

    Returns:
        Serialized ticket dict enriched with author name/email.

    Raises:
        HTTPException: 404 if the ticket does not exist, 403 if the user is not
            the creator, the targeted Admin, or the assigned Official handler.
    """
    doc = await db["support_tickets"].find_one({"_id": ticket_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Ticket not found.")

    role = current_user.get("role", "Citizen")
    user_id = current_user["_id"]

    # Strict visibility check — no cross-flow
    visible = False
    if doc.get("created_by_user_id") == user_id:
        visible = True
    elif role == "Admin" and doc.get("target_team_type") == TargetTeamType.Admin.value:
        visible = True
    elif role in ("Authority", "Official") and doc.get("target_team_type") == TargetTeamType.Official.value and doc.get("assigned_official_user_id") == user_id:
        visible = True

    if not visible:
        raise HTTPException(status_code=403, detail="Not authorized to view this ticket.")

    # Enrich with author info
    author = await db["users"].find_one({"_id": doc.get("created_by_user_id")})
    serialized = _serialize_ticket(doc)
    serialized["author_name"] = (author.get("full_name") or author.get("email")) if author else "Unknown"
    serialized["author_email"] = author.get("email") if author else ""
    return serialized


@router.patch("/tickets/{ticket_id}/status")
async def update_ticket_status(
    ticket_id: str,
    payload: dict = Body(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Transition a ticket to a new lifecycle status.

    Args:
        ticket_id: UUID of the ticket to update.
        payload: JSON body with `status` (one of TicketStatus) and optional `note`.
        current_user: Authenticated user document.
        db: Mongo database handle.

    Returns:
        {"status": "updated"} on success.

    Raises:
        HTTPException: 404 if missing, 403 if the caller is not the assigned
            handler for this ticket's target team, 400 on invalid status value.
    """
    doc = await db["support_tickets"].find_one({"_id": ticket_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Ticket not found.")

    role = current_user.get("role", "Citizen")
    user_id = current_user["_id"]

    # Strict handler check — no cross-flow
    is_official_handler = (
        role in ("Authority", "Official")
        and doc.get("target_team_type") == TargetTeamType.Official.value
        and doc.get("assigned_official_user_id") == user_id
    )
    is_admin_handler = (
        role == "Admin"
        and doc.get("target_team_type") == TargetTeamType.Admin.value
    )
    if not (is_official_handler or is_admin_handler):
        raise HTTPException(status_code=403, detail="Not authorized to update this ticket.")

    new_status = payload.get("status")
    if new_status not in [s.value for s in TicketStatus]:
        raise HTTPException(status_code=400, detail="Invalid status.")

    now = datetime.now(timezone.utc).isoformat()
    history_entry = {
        "from": doc.get("status"),
        "to": new_status,
        "changed_by": user_id,
        "changed_at": now,
        "note": payload.get("note"),
    }
    await db["support_tickets"].update_one(
        {"_id": ticket_id},
        {
            "$set": {"status": new_status, "updated_at": now},
            "$push": {"status_history": history_entry},
        },
    )
    return {"status": "updated"}


@router.post("/tickets/{ticket_id}/responses")
async def add_response(
    ticket_id: str,
    payload: dict = Body(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Append a free-text response to a ticket's conversation thread.

    Args:
        ticket_id: UUID of the ticket.
        payload: JSON body with required `text` field.
        current_user: Authenticated user document.
        db: Mongo database handle.

    Returns:
        {"status": "added", "response": <response dict>} on success.

    Raises:
        HTTPException: 404 if missing, 403 if the caller is neither the creator
            nor the appropriate handler, 400 if `text` is empty.
    """
    doc = await db["support_tickets"].find_one({"_id": ticket_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Ticket not found.")

    role = current_user.get("role", "Citizen")
    user_id = current_user["_id"]

    # Strict respond check — no cross-flow
    can_respond = (
        doc.get("created_by_user_id") == user_id
        or (role == "Admin" and doc.get("target_team_type") == TargetTeamType.Admin.value)
        or (
            role in ("Authority", "Official")
            and doc.get("target_team_type") == TargetTeamType.Official.value
            and doc.get("assigned_official_user_id") == user_id
        )
    )
    if not can_respond:
        raise HTTPException(status_code=403, detail="Not authorized.")

    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Response text is required.")

    now = datetime.now(timezone.utc).isoformat()
    response = {
        "author_id": user_id,
        "author_role": role,
        "author_name": current_user.get("full_name") or current_user.get("email"),
        "text": text,
        "created_at": now,
    }
    await db["support_tickets"].update_one(
        {"_id": ticket_id},
        {
            "$push": {"responses": response},
            "$set": {"updated_at": now, "last_response_at": now},
        },
    )
    return {"status": "added", "response": response}
