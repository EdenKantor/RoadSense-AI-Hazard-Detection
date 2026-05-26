"""
User MongoDB document shape and role enumeration.

MongoDB collection: users
"""
from enum import Enum


class UserRole(str, Enum):
    """Role assigned to a user account.

    Citizen accounts can submit uploads. Authority accounts review and update
    pothole event lifecycles (and require Admin approval before activation).
    Admin accounts manage users and approve Authority registrations.
    """

    Citizen = "Citizen"
    Authority = "Authority"
    Admin = "Admin"


# Represents the structure of a document in the `users` collection.
# Motor returns plain dicts; this is kept as documentation / factory.
USER_DOCUMENT = {
    "_id": str,           # UUID string (set on insert)
    "email": str,
    "hashed_password": str,
    "full_name": str,
    "role": UserRole,     # "Citizen" | "Authority" | "Admin"
    "is_active": bool,    # False until Admin approves (Authority only)
    "created_at": str,    # ISO-8601 UTC
}


def new_user_doc(
    user_id: str,
    email: str,
    hashed_password: str,
    full_name: str,
    role: UserRole,
) -> dict:
    """Return a ready-to-insert user document dict.

    Authority accounts start with ``is_active=False`` so they cannot log in
    until an Admin has approved their AuthorityProfile; Citizens and Admins
    are active immediately.

    Args:
        user_id: UUID string used as the document _id.
        email: Email address (callers should pre-normalise to lowercase).
        hashed_password: bcrypt hash, never the plaintext.
        full_name: Display name.
        role: One of UserRole.Citizen / Authority / Admin.

    Returns:
        A dict shaped according to ``USER_DOCUMENT`` ready for insert_one.
    """
    from datetime import datetime, timezone
    return {
        "_id": user_id,
        "email": email,
        "hashed_password": hashed_password,
        "full_name": full_name,
        "role": role.value,
        "is_active": role != UserRole.Authority,  # Authority needs admin approval
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
