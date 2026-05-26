"""
Auth router — login, current user, and avatar upload.
POST /api/auth/login   → returns JWT
GET  /api/auth/me      → returns current user info
POST /api/auth/avatar  → upload profile avatar
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.security import OAuth2PasswordRequestForm

from app.database import get_db
from app.dependencies import get_current_user
from app.services import auth_service
from app.auth.jwt_handler import create_access_token
from app.schemas.user import TokenResponse, UserResponse, UserRegisterRequest, UserUpdateRequest
from app.models.user import UserRole

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db=Depends(get_db),
) -> TokenResponse:
    """Authenticate a user with email/password and issue a JWT access token.

    Args:
        form_data: OAuth2 password-grant form fields (`username`, `password`).
        db: Mongo database handle injected by FastAPI.

    Returns:
        TokenResponse containing the signed JWT.

    Raises:
        HTTPException: 403 if the account is disabled/locked, 401 on bad credentials.
    """
    try:
        user = await auth_service.authenticate_user(
            db, form_data.username, form_data.password
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    token = create_access_token({"sub": user["_id"], "role": user["role"]})
    return TokenResponse(access_token=token)


@router.post("/register", response_model=UserResponse, status_code=201)
async def register(payload: UserRegisterRequest, db=Depends(get_db)) -> UserResponse:
    """Register a new user account.

    Args:
        payload: Registration fields (email, password, role, profile metadata).
        db: Mongo database handle injected by FastAPI.

    Returns:
        UserResponse for the newly created user.

    Raises:
        HTTPException: 409 if the email is already taken or registration is otherwise rejected.
    """
    try:
        doc = await auth_service.register_user(
            db,
            email=payload.email,
            password=payload.password,
            full_name=payload.full_name,
            role=payload.role,
            organisation=payload.organisation,
            jurisdiction_area=payload.jurisdiction_area,
            employee_id=payload.employee_id,
            phone_number=payload.phone_number,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))

    return UserResponse(
        id=doc["_id"],
        email=doc["email"],
        full_name=doc["full_name"],
        role=doc["role"],
        is_active=doc["is_active"],
        employee_id=doc.get("employee_id"),
        phone_number=doc.get("phone_number"),
    )


@router.get("/me", response_model=UserResponse)
async def me(current_user=Depends(get_current_user)) -> UserResponse:
    """Return the profile of the currently authenticated user."""
    return UserResponse(
        id=current_user["_id"],
        email=current_user["email"],
        full_name=current_user["full_name"],
        role=current_user["role"],
        is_active=current_user["is_active"],
        avatar_path=current_user.get("avatar_path"),
        employee_id=current_user.get("employee_id"),
        phone_number=current_user.get("phone_number"),
    )


@router.patch("/me", response_model=UserResponse)
async def update_me(
    payload: UserUpdateRequest,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Self-service profile update for the currently logged-in user."""
    updates = {}
    if payload.full_name is not None:
        full_name = payload.full_name.strip()
        if not full_name:
            raise HTTPException(status_code=400, detail="Full name cannot be empty.")
        updates["full_name"] = full_name
    if payload.phone_number is not None:
        updates["phone_number"] = payload.phone_number.strip() or None
    if payload.employee_id is not None:
        updates["employee_id"] = payload.employee_id.strip() or None

    if updates:
        await db["users"].update_one(
            {"_id": current_user["_id"]},
            {"$set": updates},
        )

    fresh = await db["users"].find_one({"_id": current_user["_id"]})
    return UserResponse(
        id=fresh["_id"],
        email=fresh["email"],
        full_name=fresh["full_name"],
        role=fresh["role"],
        is_active=fresh["is_active"],
        avatar_path=fresh.get("avatar_path"),
        employee_id=fresh.get("employee_id"),
        phone_number=fresh.get("phone_number"),
    )


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Upload a profile avatar image."""
    import os
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(400, "Only JPG, PNG, and WEBP images are accepted.")
    if file.size and file.size > 10 * 1024 * 1024:
        raise HTTPException(400, "Image must be less than 10MB.")

    avatar_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "uploads", "avatars"))
    os.makedirs(avatar_dir, exist_ok=True)

    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "jpg"
    avatar_filename = f"{current_user['_id']}.{ext}"
    avatar_path = os.path.join(avatar_dir, avatar_filename)

    content = await file.read()
    with open(avatar_path, "wb") as f:
        f.write(content)

    avatar_url = f"/static/avatars/{avatar_filename}"
    await db["users"].update_one(
        {"_id": current_user["_id"]},
        {"$set": {"avatar_path": avatar_url}}
    )
    return {"avatar_url": avatar_url}
