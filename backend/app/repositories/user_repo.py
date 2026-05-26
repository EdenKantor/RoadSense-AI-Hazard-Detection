"""
User data-access layer — raw Motor queries against the `users` collection.
"""
from typing import Optional


async def find_user_by_email(db, email: str) -> Optional[dict]:
    """Look up a user by email (case-insensitive). Returns None if not found."""
    # Emails are stored lowercase (Pydantic EmailStr lowercases the domain;
    # we lowercase the local part too on insert) so callers passing raw
    # form input still match. Without this, "User@Foo.com" at login fails
    # against "user@foo.com" stored at registration.
    return await db["users"].find_one({"email": email.lower()})


async def find_user_by_id(db, user_id: str) -> Optional[dict]:
    """Look up a user by _id. Returns None if not found."""
    return await db["users"].find_one({"_id": user_id})


async def insert_user(db, user_doc: dict) -> str:
    """Insert a user document and return its _id."""
    result = await db["users"].insert_one(user_doc)
    return str(result.inserted_id)


async def set_user_active(db, user_id: str, is_active: bool) -> None:
    """Flip the is_active flag (used when Admin approves an Authority account)."""
    await db["users"].update_one(
        {"_id": user_id},
        {"$set": {"is_active": is_active}},
    )
