"""Candidate endpoints - token authenticated, answer keys never serialised."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Assessment, AssessmentStatus, Question, QuestionType, Role
from ..config import settings
from ..schemas import (
    AnswerSavedOut,
    AnswerUpsert,
    CandidateAssessmentOut,
    CandidateQuestionOut,
    CandidateQuestionsOut,
    InterestRequest,
    RoleChoiceRequest,
    RoleOut,
    ResumeOut,
    SubmitOut,
)
from ..security import rate_limit_exceeded
from ..services import assessment_service, resume_service
from ..services.token_service import resolve_assessment

router = APIRouter(prefix="/api/assessments", tags=["candidate"])


def _guard(request: Request, token: str) -> None:
    client = request.client.host if request.client else "unknown"
    if rate_limit_exceeded(f"cand:{client}:{token[:12]}", limit=240, window_seconds=60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests. Please slow down."
        )


@router.get("/{token}", response_model=CandidateAssessmentOut)
def get_assessment(token: str, request: Request, db: Session = Depends(get_db)) -> CandidateAssessmentOut:
    _guard(request, token)
    assessment = resolve_assessment(db, token)
    assessment_service.close_if_expired(db, assessment)
    resume = resume_service.current_resume(db, assessment.id)
    # The candidate is shown the role they are answering for, which differs from the
    # applied role once they have switched. The applied role stays on the admin side.
    shown_role = assessment.test_role or assessment.role
    return CandidateAssessmentOut(
        candidate_name=assessment.candidate_name,
        candidate_email=assessment.candidate_email,
        role_name=shown_role.role_name,
        status=assessment.status,
        duration_minutes=assessment.duration_minutes,
        question_count=assessment_service.question_count(db, assessment.question_paper_id),
        started_at=assessment.started_at,
        submitted_at=assessment.submitted_at,
        instructions=assessment_service.CANDIDATE_INSTRUCTIONS,
        resume_required=settings.RESUME_REQUIRED_BEFORE_START,
        resume=(
            ResumeOut(
                id=resume.id,
                original_filename=resume.original_filename,
                content_type=resume.content_type,
                file_size=resume.file_size,
                version=resume.version,
                is_locked=resume.is_locked,
                uploaded_at=resume.uploaded_at,
                uploaded_by_type=resume.uploaded_by_type,
            )
            if resume
            else None
        ),
        max_resume_mb=settings.MAX_RESUME_SIZE_MB,
        resume_confirmed_at=assessment.resume_confirmed_at,
        interest_response=assessment.interest_response,
        interest_responded_at=assessment.interest_responded_at,
        expires_at=assessment_service.expires_at(assessment),
        seconds_remaining=assessment_service.seconds_remaining(assessment),
        extra_minutes=assessment.extra_minutes or 0,
        other_roles=[
            RoleOut.model_validate(r)
            for r in db.scalars(
                select(Role)
                .where(
                    Role.is_active.is_(True),
                    Role.id != (assessment.test_role_id or assessment.role_id),
                )
                .order_by(Role.id)
            ).all()
        ],
    )


@router.post("/{token}/start", response_model=CandidateAssessmentOut)
def start(token: str, request: Request, db: Session = Depends(get_db)) -> CandidateAssessmentOut:
    _guard(request, token)
    assessment = resolve_assessment(db, token)
    if assessment.status == AssessmentStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You have already sent us your answers."
        )
    assessment = assessment_service.start_assessment(db, assessment)
    return get_assessment(token, request, db)


@router.post("/{token}/interest", response_model=CandidateAssessmentOut)
def declare_interest(
    token: str,
    payload: InterestRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> CandidateAssessmentOut:
    """Candidate answers whether they want to proceed with the role."""
    _guard(request, token)
    assessment = resolve_assessment(db, token)
    assessment_service.record_interest(db, assessment, payload.interested)
    return get_assessment(token, request, db)


@router.post("/{token}/role", response_model=CandidateAssessmentOut)
def choose_role(
    token: str,
    payload: RoleChoiceRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> CandidateAssessmentOut:
    """Candidate declined the applied role and picked a different one to answer for."""
    _guard(request, token)
    assessment = resolve_assessment(db, token)
    assessment_service.require_resume_on_file(db, assessment)
    assessment_service.switch_test_role(db, assessment, payload.role_id)
    return get_assessment(token, request, db)


@router.get("/{token}/questions", response_model=CandidateQuestionsOut)
def questions(token: str, request: Request, db: Session = Depends(get_db)) -> CandidateQuestionsOut:
    _guard(request, token)
    assessment = resolve_assessment(db, token)
    if assessment_service.close_if_expired(db, assessment):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Your time has run out. Your answers have been sent to us as they were.",
        )
    if assessment.status == AssessmentStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You have already sent us your answers."
        )
    assessment_service.require_resume(db, assessment)

    # Paper is taken from the assessment record - never from a client parameter.
    rows = db.scalars(
        select(Question)
        .options(selectinload(Question.options))
        .where(Question.question_paper_id == assessment.question_paper_id)
        .order_by(Question.question_order)
    ).all()
    saved = assessment_service.answered_flags(db, assessment)

    out: list[CandidateQuestionOut] = []
    for q in rows:
        answer = saved.get(q.id)
        out.append(
            CandidateQuestionOut(
                id=q.id,
                question_text=q.question_text,
                question_type=q.question_type,
                marks=q.marks,
                question_order=q.question_order,
                is_required=q.is_required,
                instructions=q.instructions,
                options=[
                    {"id": o.id, "option_text": o.option_text, "option_order": o.option_order}
                    for o in q.options
                ]
                if q.question_type == QuestionType.OBJECTIVE
                else [],
                selected_option_id=answer.selected_option_id if answer else None,
                subjective_answer=answer.subjective_answer if answer else None,
            )
        )

    return CandidateQuestionsOut(
        candidate_name=assessment.candidate_name,
        role_name=(assessment.test_role or assessment.role).role_name,
        status=assessment.status,
        duration_minutes=assessment.duration_minutes,
        started_at=assessment.started_at,
        expires_at=assessment_service.expires_at(assessment),
        seconds_remaining=assessment_service.seconds_remaining(assessment),
        extra_minutes=assessment.extra_minutes or 0,
        questions=out,
    )


@router.put("/{token}/answers/{question_id}", response_model=AnswerSavedOut)
def save_answer(
    token: str,
    question_id: int,
    payload: AnswerUpsert,
    request: Request,
    db: Session = Depends(get_db),
) -> AnswerSavedOut:
    _guard(request, token)
    assessment = resolve_assessment(db, token)
    answer = assessment_service.save_answer(
        db,
        assessment,
        question_id,
        selected_option_id=payload.selected_option_id,
        subjective_answer=payload.subjective_answer,
    )
    return AnswerSavedOut(
        question_id=question_id,
        saved_at=answer.updated_at,
        answered=assessment_service.is_answered(answer),
    )


@router.post("/{token}/submit", response_model=SubmitOut)
def submit(token: str, request: Request, db: Session = Depends(get_db)) -> SubmitOut:
    _guard(request, token)
    assessment = resolve_assessment(db, token)

    # If the clock ran out first, close it and report that rather than erroring.
    if assessment_service.close_if_expired(db, assessment):
        answered, total = assessment_service.answer_counts(db, assessment)
        return SubmitOut(
            status=assessment.status,
            submitted_at=assessment.submitted_at,
            message=(
                "Your time has run out, so your answers have been sent to us as they were. "
                "Thank you for your time."
            ),
            answered_count=answered,
            total_questions=total,
            auto_submitted=True,
        )

    assessment, answered, total = assessment_service.submit_assessment(db, assessment)
    return SubmitOut(
        status=assessment.status,
        submitted_at=assessment.submitted_at,
        message="Thank you - your answers have been sent to our recruitment team.",
        answered_count=answered,
        total_questions=total,
    )
