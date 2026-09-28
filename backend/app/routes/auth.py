"""Admin authentication."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_admin
from ..models import AdminUser
from ..schemas import AdminMe, LoginRequest, MessageOut, TokenResponse
from ..security import create_access_token, rate_limit_exceeded, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    client = request.client.host if request.client else "unknown"
    if rate_limit_exceeded(f"login:{client}", limit=10, window_seconds=60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please wait a minute and try again.",
        )

    admin = db.scalar(select(AdminUser).where(AdminUser.user_id == payload.user_id.strip()))
    if admin is None or not admin.is_active or not verify_password(payload.password, admin.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid User ID or password."
        )

    token, expires_in = create_access_token(admin.user_id, admin.id)
    return TokenResponse(access_token=token, expires_in=expires_in, user_id=admin.user_id)


@router.post("/logout", response_model=MessageOut)
def logout(_: AdminUser = Depends(get_current_admin)) -> MessageOut:
    # Stateless JWT: the client discards the token. Endpoint exists for a clean contract.
    return MessageOut(message="Logged out successfully.")


@router.get("/me", response_model=AdminMe)
def me(admin: AdminUser = Depends(get_current_admin)) -> AdminUser:
    return admin
