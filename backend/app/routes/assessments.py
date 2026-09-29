"""Admin assessment generation, listing, detail and results."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..dependencies import get_current_admin
from ..models import AdminUser, Assessment, AssessmentStatus, EvaluationStatus, Role
from ..schemas import (
    AssessmentCreate,
    AssessmentCreatedOut,
    AssessmentListOut,
    AssessmentRowOut,
    AssessmentUpdate,
    DashboardStats,
    ExtraTimeRequest,
    MessageOut,
    ResultOut,
)
from ..services import assessment_service, resume_service
from ..services.token_service import build_assessment_url

router = APIRouter(prefix="/api/admin", tags=["admin-assessments"])


@router.get("/stats", response_model=DashboardStats)
def stats(db: Session = Depends(get_db), _: AdminUser = Depends(get_current_admin)) -> DashboardStats:
    def count(*where) -> int:
        return int(db.scalar(select(func.count(Assessment.id)).where(*where)) or 0)

    return DashboardStats(
        total_generated=count(),
        in_progress=count(Assessment.status == AssessmentStatus.IN_PROGRESS),
        submitted=count(Assessment.status == AssessmentStatus.SUBMITTED),
        pending=count(Assessment.status == AssessmentStatus.GENERATED),
        pending_evaluation=count(
            Assessment.status == AssessmentStatus.SUBMITTED,
            Assessment.evaluation_status == EvaluationStatus.PENDING,
        ),
        new_resumes=resume_service.unreviewed_count(db),
    )


@router.post("/assessments", response_model=AssessmentCreatedOut, status_code=status.HTTP_201_CREATED)
def create_assessment(
    payload: AssessmentCreate,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
) -> AssessmentCreatedOut:
    assessment, raw_token = assessment_service.create_assessment(
        db,
        candidate_name=payload.candidate_name,
        candidate_email=str(payload.candidate_email),
        role_id=payload.role_id,
        duration_minutes=payload.duration_minutes,
        interviewer_1=payload.interviewer_1,
        interviewer_2=payload.interviewer_2,
    )
    role = db.get(Role, assessment.role_id)
    return AssessmentCreatedOut(
        id=assessment.id,
        candidate_name=assessment.candidate_name,
        candidate_email=assessment.candidate_email,
        role_id=assessment.role_id,
        role_name=role.role_name if role else "",
        question_paper_id=assessment.question_paper_id,
        question_paper_version=assessment.question_paper_version,
        status=assessment.status,
        duration_minutes=assessment.duration_minutes,
        created_at=assessment.created_at,
        assessment_url=build_assessment_url(raw_token),
        question_count=assessment_service.question_count(db, assessment.question_paper_id),
        interviewer_1=assessment.interviewer_1,
        interviewer_2=assessment.interviewer_2,
    )


@router.get("/assessments", response_model=AssessmentListOut)
def list_assessments(
    search: str | None = None,
    role_id: int | None = None,
    status_filter: AssessmentStatus | None = Query(default=None, alias="status"),
    sort_by: str = Query(default="created_at", pattern="^(created_at|submitted_at)$"),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
) -> AssessmentListOut:
    stmt = select(Assessment).options(selectinload(Assessment.role))
    conditions = []
    if search:
        like = f"%{search.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(Assessment.candidate_name).like(like),
                func.lower(Assessment.candidate_email).like(like),
            )
        )
    if role_id:
        conditions.append(Assessment.role_id == role_id)
    if status_filter:
        conditions.append(Assessment.status == status_filter)
    if conditions:
        stmt = stmt.where(*conditions)

    total = int(
        db.scalar(select(func.count()).select_from(Assessment).where(*conditions) if conditions
                  else select(func.count()).select_from(Assessment))
        or 0
    )

    column = Assessment.created_at if sort_by == "created_at" else Assessment.submitted_at
    stmt = stmt.order_by(column.desc() if sort_dir == "desc" else column.asc())
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)

    rows = [assessment_service.to_row(db, a) for a in db.scalars(stmt).all()]
    return AssessmentListOut(
        items=[AssessmentRowOut(**r) for r in rows], total=total, page=page, page_size=page_size
    )


def _get_assessment(db: Session, assessment_id: int) -> Assessment:
    assessment = db.scalar(
        select(Assessment)
        .options(selectinload(Assessment.role), selectinload(Assessment.paper))
        .where(Assessment.id == assessment_id)
    )
    if assessment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found.")
    return assessment


@router.get("/assessments/{assessment_id}", response_model=AssessmentRowOut)
def get_assessment(
    assessment_id: int, db: Session = Depends(get_db), _: AdminUser = Depends(get_current_admin)
) -> AssessmentRowOut:
    return AssessmentRowOut(**assessment_service.to_row(db, _get_assessment(db, assessment_id)))


@router.patch("/assessments/{assessment_id}", response_model=AssessmentRowOut)
def update_assessment(
    assessment_id: int,
    payload: AssessmentUpdate,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
) -> AssessmentRowOut:
    """Edit the interviewer assignments. Available at any time, including after submission."""
    assessment = _get_assessment(db, assessment_id)
    try:
        assessment.interviewer_1 = (payload.interviewer_1 or "").strip() or None
        assessment.interviewer_2 = (payload.interviewer_2 or "").strip() or None
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(assessment)
    return AssessmentRowOut(**assessment_service.to_row(db, assessment))


@router.put("/assessments/{assessment_id}/extra-time", response_model=AssessmentRowOut)
def set_extra_time(
    assessment_id: int,
    payload: ExtraTimeRequest,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
) -> AssessmentRowOut:
    """Give a candidate more time. Reopens the same link if the timer had closed it."""
    assessment = _get_assessment(db, assessment_id)
    assessment_service.grant_extra_time(db, assessment, payload.extra_minutes)
    return AssessmentRowOut(**assessment_service.to_row(db, assessment))


@router.delete("/assessments/{assessment_id}", response_model=MessageOut)
def delete_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
) -> MessageOut:
    """Delete a candidate's assessment and all data hanging off it."""
    assessment = _get_assessment(db, assessment_id)
    name = assessment.candidate_name
    assessment_service.delete_assessment(db, assessment)
    return MessageOut(message=f"Deleted {name}'s record and all associated data.")


@router.get("/assessments/{assessment_id}/results", response_model=ResultOut)
def get_results(
    assessment_id: int, db: Session = Depends(get_db), _: AdminUser = Depends(get_current_admin)
) -> dict:
    return assessment_service.build_result(db, _get_assessment(db, assessment_id))
