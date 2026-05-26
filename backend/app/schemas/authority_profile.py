"""Pydantic schemas for AuthorityProfile."""
from typing import Optional
from pydantic import BaseModel
from app.models.authority_profile import ApprovalStatus


class AuthorityProfileResponse(BaseModel):
    """Authority profile payload including approval state and reviewer metadata."""

    user_id: str
    organisation: str
    jurisdiction_area: str
    approval_status: ApprovalStatus
    reviewed_by: Optional[str] = None
    review_note: Optional[str] = None
    submitted_at: str
    reviewed_at: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None


class AdminReviewRequest(BaseModel):
    """Admin decision body for approving or rejecting an Authority application."""

    approval_status: ApprovalStatus  # Approved | Rejected
    review_note: Optional[str] = None
