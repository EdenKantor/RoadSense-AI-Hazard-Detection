"""
Auth service — login verification and user registration.
Password hashing via bcrypt directly.
"""
import uuid
from typing import Optional

import bcrypt

from app.models.user import UserRole, new_user_doc
from app.models.authority_profile import new_authority_profile_doc
from app.repositories import user_repo, authority_repo


def hash_password(plain: str) -> str:
    """Hash a plaintext password with bcrypt and return the encoded string."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if the plaintext password matches the bcrypt hash."""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


async def register_user(
    db,
    email: str,
    password: str,
    full_name: str,
    role: UserRole,
    organisation: Optional[str] = None,
    jurisdiction_area: Optional[str] = None,
    employee_id: Optional[str] = None,
    phone_number: Optional[str] = None,
) -> dict:
    """Create a new user. If Authority, also create a pending AuthorityProfile.

    Email is normalised to lowercase before insert to keep lookups consistent.
    Authority registrations additionally persist optional employee_id and
    phone_number on the user document.

    Args:
        db: Motor database handle.
        email: Plaintext email; will be lowercased before storage.
        password: Plaintext password; hashed via bcrypt before storage.
        full_name: Display name.
        role: UserRole.Citizen / Authority / Admin.
        organisation: Authority-only: organisation name (used on AuthorityProfile).
        jurisdiction_area: Authority-only: jurisdiction description.
        employee_id: Authority-only: optional employee identifier.
        phone_number: Authority-only: optional phone number.

    Returns:
        The inserted user document.

    Raises:
        ValueError: If an account with the same email already exists.
    """
    email = email.lower()
    existing = await user_repo.find_user_by_email(db, email)
    if existing:
        raise ValueError("Email already registered.")

    user_id = str(uuid.uuid4())
    hashed = hash_password(password)
    doc = new_user_doc(user_id, email, hashed, full_name, role)

    # Store Official-specific fields on the user doc
    if role == UserRole.Authority:
        if employee_id:
            doc["employee_id"] = employee_id
        if phone_number:
            doc["phone_number"] = phone_number

    await user_repo.insert_user(db, doc)

    if role == UserRole.Authority:
        profile_doc = new_authority_profile_doc(
            user_id=user_id,
            organisation=organisation or "",
            jurisdiction_area=jurisdiction_area or "",
        )
        await authority_repo.insert_authority_profile(db, profile_doc)

    return doc


async def authenticate_user(db, email: str, password: str) -> Optional[dict]:
    """Return the user doc if credentials are valid, else None.

    Args:
        db: Motor database handle.
        email: Plaintext email (case-insensitive lookup).
        password: Plaintext password to verify against the stored bcrypt hash.

    Returns:
        The user document on success, or None if the user does not exist
        or the password does not match.

    Raises:
        ValueError: If the account is inactive (pending Admin approval or
            suspended). The message describes the reason so the UI can show
            it to the user.
    """
    user = await user_repo.find_user_by_email(db, email)
    if not user:
        return None
    # Account-status checks run BEFORE password verification: a pending or
    # suspended user typing the wrong password should still see the
    # status-specific message ("Account is pending admin approval.") rather
    # than a misleading "Incorrect email or password". Acceptable info leak
    # for an internal admin-approval workflow.
    if not user.get("is_active", True):
        reason = user.get("suspend_reason")
        if reason:
            raise ValueError(f"Your account has been suspended: {reason}. Please contact administration.")
        raise ValueError("Account is pending admin approval.")
    if not verify_password(password, user["hashed_password"]):
        return None
    return user
