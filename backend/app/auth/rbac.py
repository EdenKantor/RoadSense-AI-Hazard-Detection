"""
Role-Based Access Control (RBAC) dependencies.
Usage in a router:
    @router.get("/...", dependencies=[Depends(require_role("Admin"))])
"""
from fastapi import Depends, HTTPException, status
from app.dependencies import get_current_user

ROLE_ALIASES = {
    "Official": "Authority",
    "official": "Authority",
    "authority": "Authority",
    "admin": "Admin",
    "citizen": "Citizen",
}


def _normalize_role(role: str) -> str:
    """Map a raw role string through ROLE_ALIASES to its canonical form."""
    return ROLE_ALIASES.get(role, role)


def require_role(*allowed_roles: str):
    """
    Factory that returns a FastAPI dependency enforcing one of `allowed_roles`.
    The role is stored in the user document as the string field `role`.
    """

    async def _check(current_user=Depends(get_current_user)):
        user_role = _normalize_role(current_user.get("role", ""))
        normalized_allowed = {_normalize_role(role) for role in allowed_roles}
        if user_role not in normalized_allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access requires role: {allowed_roles}",
            )
        return current_user

    return _check
