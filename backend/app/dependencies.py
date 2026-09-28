"""Shared FastAPI dependencies."""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from .database import get_db
from .models import AdminUser
from .security import decode_access_token

CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_admin(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AdminUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise CREDENTIALS_ERROR
    payload = decode_access_token(authorization.split(" ", 1)[1].strip())
    if not payload:
        raise CREDENTIALS_ERROR
    admin = db.get(AdminUser, payload.get("aid"))
    if admin is None or not admin.is_active or admin.user_id != payload.get("sub"):
        raise CREDENTIALS_ERROR
    return admin
