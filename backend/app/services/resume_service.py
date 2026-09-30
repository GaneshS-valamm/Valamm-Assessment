"""Resume validation, versioned upload, and admin queries."""
from __future__ import annotations

import io
import zipfile

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..models import (
    Assessment,
    AssessmentStatus,
    CandidateResume,
    ResumeStatus,
    UploadedByType,
    utcnow,
)
from .storage_service import build_storage_key, get_storage, safe_display_name

PDF_CONTENT_TYPES = {"application/pdf", "application/x-pdf"}
DOCX_CONTENT_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",  # some browsers send this for .docx
}
ALLOWED_EXTENSIONS = {"pdf", "docx"}


def _extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def validate_upload(filename: str, content_type: str | None, data: bytes) -> tuple[str, str]:
    """Validate type, size and actual file contents.

    Returns (extension, normalised content type). Extension alone is never trusted -
    the file's own signature has to agree with it.
    """
    display_name = safe_display_name(filename)
    ext = _extension(display_name)

    if ext not in ALLOWED_EXTENSIONS:
        raise _bad_request("Only PDF and DOCX resumes are accepted.")

    if not data:
        raise _bad_request("The uploaded file is empty.")

    if len(data) > settings.max_resume_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Resume is {len(data) / 1024 / 1024:.1f} MB. "
                f"The maximum allowed size is {settings.MAX_RESUME_SIZE_MB} MB."
            ),
        )

    declared = (content_type or "").split(";")[0].strip().lower()

    if ext == "pdf":
        if not data.startswith(b"%PDF-"):
            raise _bad_request("This file is not a valid PDF. Please upload the original PDF file.")
        if declared and declared not in PDF_CONTENT_TYPES and declared != "application/octet-stream":
            raise _bad_request("Declared file type does not match a PDF document.")
        return "pdf", "application/pdf"

    # DOCX is a zip container; require the Word document part to be present.
    if not data.startswith(b"PK\x03\x04"):
        raise _bad_request(
            "This file is not a valid DOCX. Older .doc files are not supported - "
            "please save it as PDF or DOCX."
        )
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = zf.namelist()
            if "word/document.xml" not in names:
                raise _bad_request("This DOCX file does not contain a readable Word document.")
            if zf.testzip() is not None:
                raise _bad_request("This DOCX file appears to be corrupted.")
    except zipfile.BadZipFile:
        raise _bad_request("This DOCX file appears to be corrupted.") from None

    if declared and declared not in DOCX_CONTENT_TYPES:
        raise _bad_request("Declared file type does not match a DOCX document.")
    return "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def current_resume(db: Session, assessment_id: int) -> CandidateResume | None:
    return db.scalar(
        select(CandidateResume)
        .where(
            CandidateResume.assessment_id == assessment_id,
            CandidateResume.is_current.is_(True),
        )
        .order_by(CandidateResume.version.desc())
    )


def upload_resume(
    db: Session,
    assessment: Assessment,
    *,
    filename: str,
    content_type: str | None,
    data: bytes,
    uploaded_by: UploadedByType = UploadedByType.CANDIDATE,
    admin_id: int | None = None,
) -> CandidateResume:
    """Store a new resume version for this assessment only.

    The admin seeds the first version when creating the assessment; the candidate may
    then replace it with a corrected copy. Every version is kept.
    """
    if assessment.status == AssessmentStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Your answers have already been sent, so the resume on file can no longer be replaced.",
        )

    ext, normalised_type = validate_upload(filename, content_type, data)
    display_name = safe_display_name(filename, fallback=f"resume.{ext}")

    previous = current_resume(db, assessment.id)
    if previous is not None and previous.is_locked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This resume is locked and cannot be replaced.",
        )

    next_version = int(
        db.scalar(
            select(func.coalesce(func.max(CandidateResume.version), 0)).where(
                CandidateResume.assessment_id == assessment.id
            )
        )
        or 0
    ) + 1

    storage = get_storage()
    key = build_storage_key(assessment.id, next_version, ext)
    storage.save(key, data)  # write the file before the row, so no row points at nothing

    try:
        # Supersede the previous version - the old row and file are kept as history.
        if previous is not None:
            previous.is_current = False

        resume = CandidateResume(
            assessment_id=assessment.id,
            candidate_name=assessment.candidate_name,
            candidate_email=assessment.candidate_email,
            role_id=assessment.role_id,
            original_filename=display_name,
            storage_key=key,
            storage_backend=storage.name,
            content_type=normalised_type,
            file_size=len(data),
            version=next_version,
            is_current=True,
            is_locked=False,
            resume_status=ResumeStatus.NEW,
            uploaded_by_type=uploaded_by,
            uploaded_by_admin_id=admin_id if uploaded_by == UploadedByType.ADMIN else None,
            uploaded_at=utcnow(),
        )
        db.add(resume)
        # A candidate replacing the resume counts as having reviewed it.
        if uploaded_by == UploadedByType.CANDIDATE:
            assessment.resume_confirmed_at = utcnow()
        db.commit()
        db.refresh(resume)
        return resume
    except Exception:
        db.rollback()
        raise


def lock_resumes(db: Session, assessment_id: int) -> None:
    """Called inside the submission transaction: freeze the resume that was submitted."""
    for resume in db.scalars(
        select(CandidateResume).where(CandidateResume.assessment_id == assessment_id)
    ).all():
        resume.is_locked = True


def to_row(resume: CandidateResume) -> dict:
    assessment = resume.assessment
    return {
        "id": resume.id,
        "assessment_id": resume.assessment_id,
        "candidate_name": resume.candidate_name,
        "candidate_email": resume.candidate_email,
        "role_id": resume.role_id,
        "role_name": resume.role.role_name,
        "original_filename": resume.original_filename,
        "content_type": resume.content_type,
        "file_size": resume.file_size,
        "version": resume.version,
        "is_current": resume.is_current,
        "is_locked": resume.is_locked,
        "resume_status": resume.resume_status,
        "uploaded_at": resume.uploaded_at,
        "reviewed_at": resume.reviewed_at,
        "uploaded_by_type": resume.uploaded_by_type,
        # Whether the bytes are still in the storage backend. False means the row survived
        # but the file did not - the admin needs to upload a replacement.
        "file_available": get_storage().exists(resume.storage_key),
        "assessment_status": assessment.status,
        "assessment_submitted_at": assessment.submitted_at,
        "candidate_confirmed_at": assessment.resume_confirmed_at,
        "interest_response": assessment.interest_response,
        "interest_responded_at": assessment.interest_responded_at,
        "storage_backend": resume.storage_backend,
    }


def list_resumes(
    db: Session,
    *,
    search: str | None,
    role_id: int | None,
    resume_status: ResumeStatus | None,
    assessment_status: AssessmentStatus | None,
    include_history: bool,
    page: int,
    page_size: int,
) -> tuple[list[dict], int, int]:
    conditions = []
    if not include_history:
        conditions.append(CandidateResume.is_current.is_(True))
    if search:
        like = f"%{search.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(CandidateResume.candidate_name).like(like),
                func.lower(CandidateResume.candidate_email).like(like),
                func.lower(CandidateResume.original_filename).like(like),
            )
        )
    if role_id:
        conditions.append(CandidateResume.role_id == role_id)
    if resume_status:
        conditions.append(CandidateResume.resume_status == resume_status)

    stmt = (
        select(CandidateResume)
        .join(Assessment, Assessment.id == CandidateResume.assessment_id)
        .options(selectinload(CandidateResume.role), selectinload(CandidateResume.assessment))
    )
    if assessment_status:
        conditions.append(Assessment.status == assessment_status)
    if conditions:
        stmt = stmt.where(*conditions)

    count_stmt = select(func.count()).select_from(CandidateResume).join(
        Assessment, Assessment.id == CandidateResume.assessment_id
    )
    if conditions:
        count_stmt = count_stmt.where(*conditions)
    total = int(db.scalar(count_stmt) or 0)

    # Latest uploads first.
    stmt = stmt.order_by(CandidateResume.uploaded_at.desc(), CandidateResume.id.desc())
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)

    rows = [to_row(r) for r in db.scalars(stmt).all()]
    new_count = unreviewed_count(db)
    return rows, total, new_count


def unreviewed_count(db: Session) -> int:
    """Drives the sidebar notification badge."""
    return int(
        db.scalar(
            select(func.count(CandidateResume.id)).where(
                CandidateResume.is_current.is_(True),
                CandidateResume.resume_status == ResumeStatus.NEW,
            )
        )
        or 0
    )


def get_resume(db: Session, resume_id: int) -> CandidateResume:
    resume = db.scalar(
        select(CandidateResume)
        .options(selectinload(CandidateResume.role), selectinload(CandidateResume.assessment))
        .where(CandidateResume.id == resume_id)
    )
    if resume is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found.")
    return resume


def set_status(
    db: Session, resume: CandidateResume, new_status: ResumeStatus, admin_id: int
) -> CandidateResume:
    try:
        resume.resume_status = new_status
        if new_status == ResumeStatus.NEW:
            resume.reviewed_at = None
            resume.reviewed_by = None
        else:
            resume.reviewed_at = utcnow()
            resume.reviewed_by = admin_id
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(resume)
    return resume
