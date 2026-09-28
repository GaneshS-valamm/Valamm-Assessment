"""Assessment token creation and resolution."""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Assessment
from ..security import generate_assessment_token, hash_assessment_token


def new_token_pair() -> tuple[str, str]:
    raw = generate_assessment_token()
    return raw, hash_assessment_token(raw)


def build_assessment_url(raw_token: str) -> str:
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}/assessment/{raw_token}"


def resolve_assessment(db: Session, raw_token: str) -> Assessment:
    """Look the assessment up purely from the token - never from client-supplied ids."""
    if not raw_token or len(raw_token) < 20:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This link is not valid.")
    token_hash = hash_assessment_token(raw_token)
    assessment = db.scalar(select(Assessment).where(Assessment.unique_token_hash == token_hash))
    if assessment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This link is invalid or has expired.",
        )
    return assessment
