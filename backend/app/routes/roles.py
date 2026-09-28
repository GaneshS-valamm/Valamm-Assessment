"""Roles - read from the database, never hardcoded in the frontend."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Role
from ..schemas import RoleOut

router = APIRouter(prefix="/api/roles", tags=["roles"])


@router.get("", response_model=list[RoleOut])
def list_roles(db: Session = Depends(get_db)) -> list[Role]:
    return list(
        db.scalars(select(Role).where(Role.is_active.is_(True)).order_by(Role.id)).all()
    )
