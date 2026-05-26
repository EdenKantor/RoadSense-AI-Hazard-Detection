"""Pydantic schemas for User request/response validation."""
from typing import Optional
from pydantic import BaseModel, EmailStr, field_validator
from app.models.user import UserRole


class UserRegisterRequest(BaseModel):
    """Request body for new user registration (Citizen or Authority)."""

    email: EmailStr
    password: str
    full_name: str
    role: UserRole = UserRole.Citizen
    organisation: Optional[str] = None
    jurisdiction_area: Optional[str] = None
    employee_id: Optional[str] = None
    phone_number: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        """Enforce the minimum password length policy."""
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long.")
        return v


class UserResponse(BaseModel):
    """Public user representation returned by auth endpoints."""

    id: str
    email: str
    full_name: str
    role: UserRole
    is_active: bool
    avatar_path: Optional[str] = None
    employee_id: Optional[str] = None
    phone_number: Optional[str] = None

    model_config = {"from_attributes": True}


class UserUpdateRequest(BaseModel):
    """Self-service profile updates. Only these fields can be changed via PATCH /auth/me."""
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    employee_id: Optional[str] = None


class TokenResponse(BaseModel):
    """OAuth2-style bearer token payload returned on login."""

    access_token: str
    token_type: str = "bearer"
