"""Resume upload (candidate, token-scoped) and resume management (admin, authenticated)."""
from __future__ import annotations

import urllib.parse

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..dependencies import get_current_admin
from ..models import AdminUser, Assessment, AssessmentStatus, ResumeStatus, UploadedByType
from ..schemas import (
    MessageOut,
    ResumeDetailOut,
    ResumeListOut,
    ResumeOut,
    ResumeRowOut,
    ResumeStatusUpdate,
)
from ..security import rate_limit_exceeded
from ..services import assessment_service, resume_service
from ..services.storage_service import StorageError, get_storage
from ..services.token_service import resolve_assessment

candidate_router = APIRouter(prefix="/api/assessments", tags=["candidate-resume"])
admin_router = APIRouter(prefix="/api/admin/resumes", tags=["admin-resumes"])
# Admin-side upload lives under /api/admin/assessments/... so it sits with the assessment.
admin_upload_router = APIRouter(prefix="/api/admin", tags=["admin-resumes"])


def _guard_candidate(request: Request, token: str) -> None:
    client = request.client.host if request.client else "unknown"
    if rate_limit_exceeded(f"resume:{client}:{token[:12]}", limit=60, window_seconds=300):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please wait a few minutes and try again.",
        )


# --------------------------------------------------------------------------- #
# Candidate: upload / replace own resume
# --------------------------------------------------------------------------- #
@candidate_router.post("/{token}/resume", response_model=ResumeOut, status_code=status.HTTP_201_CREATED)
async def upload_resume(
    token: str,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ResumeOut:
    _guard_candidate(request, token)

    # The assessment is resolved from the token alone - a candidate can only ever
    # attach a resume to their own assessment.
    assessment = resolve_assessment(db, token)

    # Read with a hard ceiling so an oversized body is rejected without buffering it all.
    limit = settings.max_resume_bytes
    data = await file.read(limit + 1)
    await file.close()
    if len(data) > limit:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Resume exceeds the {settings.MAX_RESUME_SIZE_MB} MB limit.",
        )

    try:
        resume = resume_service.upload_resume(
            db,
            assessment,
            filename=file.filename or "resume",
            content_type=file.content_type,
            data=data,
        )
    except StorageError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Resume storage is unavailable. Please try again in a moment.",
        ) from None

    return ResumeOut(
        id=resume.id,
        original_filename=resume.original_filename,
        content_type=resume.content_type,
        file_size=resume.file_size,
        version=resume.version,
        is_locked=resume.is_locked,
        uploaded_at=resume.uploaded_at,
        uploaded_by_type=resume.uploaded_by_type,
    )


@candidate_router.get("/{token}/resume/download")
def download_own_resume(
    token: str,
    request: Request,
    disposition: str = Query(default="inline", pattern="^(attachment|inline)$"),
    db: Session = Depends(get_db),
) -> Response:
    """Let the candidate read back the resume on file for their own assessment."""
    _guard_candidate(request, token)
    assessment = resolve_assessment(db, token)
    resume = resume_service.current_resume(db, assessment.id)
    if resume is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No resume is on file for you yet."
        )
    try:
        data = get_storage().load(resume.storage_key)
    except StorageError:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="The stored file is no longer available. Please upload your resume again.",
        ) from None

    quoted = urllib.parse.quote(resume.original_filename)
    return Response(
        content=data,
        media_type=resume.content_type,
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quoted}",
            "Content-Length": str(len(data)),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@candidate_router.post("/{token}/resume/confirm", response_model=MessageOut)
def confirm_own_resume(
    token: str, request: Request, db: Session = Depends(get_db)
) -> MessageOut:
    """Candidate reviewed the resume on file and is happy with it as-is."""
    _guard_candidate(request, token)
    assessment = resolve_assessment(db, token)
    assessment_service.confirm_resume(db, assessment)
    return MessageOut(message="Thank you for confirming your resume.")


# --------------------------------------------------------------------------- #
# Admin: upload on the candidate's behalf, list / detail / download / status
# --------------------------------------------------------------------------- #
@admin_upload_router.post(
    "/assessments/{assessment_id}/resume", response_model=ResumeRowOut, status_code=status.HTTP_201_CREATED
)
async def admin_upload_resume(
    assessment_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
) -> dict:
    """Admin attaches the resume they received, so the candidate can review it."""
    assessment = db.get(Assessment, assessment_id)
    if assessment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found.")

    limit = settings.max_resume_bytes
    data = await file.read(limit + 1)
    await file.close()
    if len(data) > limit:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Resume exceeds the {settings.MAX_RESUME_SIZE_MB} MB limit.",
        )

    try:
        resume = resume_service.upload_resume(
            db,
            assessment,
            filename=file.filename or "resume",
            content_type=file.content_type,
            data=data,
            uploaded_by=UploadedByType.ADMIN,
            admin_id=admin.id,
        )
    except StorageError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Resume storage is unavailable. Please try again in a moment.",
        ) from None

    db.refresh(resume, attribute_names=["assessment", "role"])
    return resume_service.to_row(resume)


@admin_router.get("", response_model=ResumeListOut)
def list_resumes(
    search: str | None = None,
    role_id: int | None = None,
    resume_status: ResumeStatus | None = None,
    assessment_status: AssessmentStatus | None = None,
    include_history: bool = False,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
) -> ResumeListOut:
    rows, total, new_count = resume_service.list_resumes(
        db,
        search=search,
        role_id=role_id,
        resume_status=resume_status,
        assessment_status=assessment_status,
        include_history=include_history,
        page=page,
        page_size=page_size,
    )
    return ResumeListOut(
        items=[ResumeRowOut(**r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        new_count=new_count,
    )


@admin_router.get("/unreviewed-count")
def unreviewed_count(
    db: Session = Depends(get_db), _: AdminUser = Depends(get_current_admin)
) -> dict:
    """Lightweight endpoint the sidebar badge polls."""
    return {"new_count": resume_service.unreviewed_count(db)}


@admin_router.get("/{resume_id}", response_model=ResumeDetailOut)
def get_resume(
    resume_id: int, db: Session = Depends(get_db), _: AdminUser = Depends(get_current_admin)
) -> dict:
    resume = resume_service.get_resume(db, resume_id)
    assessment = resume.assessment
    data = resume_service.to_row(resume)
    data.update(
        {
            "assessment_created_at": assessment.created_at,
            "assessment_started_at": assessment.started_at,
            "question_paper_version": assessment.question_paper_version,
            "assessment_url": assessment_service.link_for(assessment),
            "objective_score": assessment.objective_score,
            "evaluation_status": assessment.evaluation_status,
            "history": [
                ResumeOut(
                    id=r.id,
                    original_filename=r.original_filename,
                    content_type=r.content_type,
                    file_size=r.file_size,
                    version=r.version,
                    is_locked=r.is_locked,
                    uploaded_at=r.uploaded_at,
                    uploaded_by_type=r.uploaded_by_type,
                )
                for r in sorted(assessment.resumes, key=lambda x: x.version, reverse=True)
            ],
        }
    )
    return data


@admin_router.get("/{resume_id}/download")
def download_resume(
    resume_id: int,
    disposition: str = Query(default="attachment", pattern="^(attachment|inline)$"),
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
) -> Response:
    """Stream the original file to an authenticated admin.

    The file never has a public URL; it is read from the storage backend and returned
    through this authenticated endpoint only.
    """
    resume = resume_service.get_resume(db, resume_id)
    try:
        data = get_storage().load(resume.storage_key)
    except StorageError:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=(
                "The stored file is no longer present in the storage backend. "
                "If this is a deployment with ephemeral disk, configure persistent object storage."
            ),
        ) from None

    # RFC 5987 encoding so non-ASCII filenames survive the header.
    quoted = urllib.parse.quote(resume.original_filename)
    return Response(
        content=data,
        media_type=resume.content_type,
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quoted}",
            "Content-Length": str(len(data)),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@admin_router.put("/{resume_id}/status", response_model=ResumeRowOut)
def update_status(
    resume_id: int,
    payload: ResumeStatusUpdate,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
) -> dict:
    resume = resume_service.get_resume(db, resume_id)
    resume = resume_service.set_status(db, resume, payload.resume_status, admin.id)
    return resume_service.to_row(resume)
