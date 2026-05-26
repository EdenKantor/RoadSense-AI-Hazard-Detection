"""
JWT creation and decoding utilities.
Uses PyJWT with HS256 algorithm.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt

from app.config import settings


def create_access_token(data: Dict[str, Any]) -> str:
    """Return a signed JWT embedding `data`, expiring per settings."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Decode and verify a JWT.
    Returns the payload dict on success, None on any error.
    """
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except jwt.PyJWTError:
        return None
