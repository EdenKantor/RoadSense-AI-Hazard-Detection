"""
AuthorityProfile MongoDB document shape.

Tracks the approval/verification lifecycle for Authority account registrations.

MongoDB collection: authority_profiles
"""
from enum import Enum


class ApprovalStatus(str, Enum):
    """Admin verification state of an Authority registration.

    The corresponding user account remains inactive (cannot log in) while the
    profile is Pending or Rejected; transitioning to Approved flips the user's
    is_active flag in the auth flow.
    """

    Pending = "Pending"
    Approved = "Approved"
    Rejected = "Rejected"


AUTHORITY_PROFILE_DOCUMENT = {
    "_id": str,               # Same as user._id
    "user_id": str,
    "organisation": str,      # Name of the authority body
    "jurisdiction_area": str, # Text description of area of responsibility
    "approval_status": ApprovalStatus,
    "reviewed_by": str,       # Admin user_id who actioned this, or None
    "review_note": str,       # Optional admin note
    "submitted_at": str,      # ISO-8601 UTC
    "reviewed_at": str,       # ISO-8601 UTC or None
    # Self-service profile fields the Authority user can edit on their
    # profile page. The canonical zone for routing comes from teams.zone_id
    # (see zones router); this `zone` field is a personal preference label
    # so a user without a team membership can still record their region.
    "department": str,        # e.g. "Public Works Department" — user-editable
    "designation": str,       # e.g. "Field Officer" — user-editable
    "zone": str,              # Optional zone preference label
}


def new_authority_profile_doc(
    user_id: str,
    organisation: str,
    jurisdiction_area: str,
    department: str = "",
    designation: str = "",
    zone: str = "",
) -> dict:
    """Return a ready-to-insert authority profile document dict.

    The profile starts in Pending state with no reviewer; an Admin later
    flips approval_status (and the linked user.is_active flag) on review.
    Self-service fields (department, designation, zone) default to empty
    strings and can be edited later via PATCH /api/authority/profile.

    Args:
        user_id: The user._id of the Authority registrant; reused as profile _id.
        organisation: Name of the authority body the user represents.
        jurisdiction_area: Free-text description of the area of responsibility.
        department: Optional self-declared department.
        designation: Optional self-declared designation/title.
        zone: Optional zone preference label (canonical zone comes from teams).

    Returns:
        A dict shaped according to ``AUTHORITY_PROFILE_DOCUMENT`` ready for insert_one.
    """
    from datetime import datetime, timezone
    return {
        "_id": user_id,
        "user_id": user_id,
        "organisation": organisation,
        "jurisdiction_area": jurisdiction_area,
        "approval_status": ApprovalStatus.Pending.value,
        "reviewed_by": None,
        "review_note": None,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_at": None,
        "department": department,
        "designation": designation,
        "zone": zone,
    }
