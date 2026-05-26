"""
AuthorityProfile data-access layer.
"""
from typing import List, Optional
from app.models.authority_profile import ApprovalStatus


async def insert_authority_profile(db, profile_doc: dict) -> None:
    """Insert an authority profile document."""
    await db["authority_profiles"].insert_one(profile_doc)


async def find_profile_by_user(db, user_id: str) -> Optional[dict]:
    """Look up an authority profile by its linked user_id. Returns None if not found."""
    return await db["authority_profiles"].find_one({"user_id": user_id})


async def list_pending_profiles(db) -> List[dict]:
    """Return all authority profiles awaiting admin review."""
    cursor = db["authority_profiles"].find(
        {"approval_status": ApprovalStatus.Pending.value}
    )
    return await cursor.to_list(length=100)


async def update_profile_approval(
    db,
    user_id: str,
    new_status: ApprovalStatus,
    reviewed_by: str,
    review_note: Optional[str],
    reviewed_at: str,
) -> None:
    """Persist an Admin's approval/rejection decision on an authority profile.

    Args:
        db: Motor database handle.
        user_id: The authority profile's linked user_id.
        new_status: Approved or Rejected (from ApprovalStatus).
        reviewed_by: Admin user._id who made the decision.
        review_note: Optional free-text justification.
        reviewed_at: ISO-8601 UTC timestamp of the decision.
    """
    await db["authority_profiles"].update_one(
        {"user_id": user_id},
        {
            "$set": {
                "approval_status": new_status.value,
                "reviewed_by": reviewed_by,
                "review_note": review_note,
                "reviewed_at": reviewed_at,
            }
        },
    )
