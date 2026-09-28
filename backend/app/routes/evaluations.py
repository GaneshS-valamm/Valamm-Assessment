"""Admin subjective evaluation."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..dependencies import get_current_admin
from ..models import (
    AdminUser,
    Assessment,
    AssessmentEvaluation,
    AssessmentStatus,
    Question,
    QuestionType,
    utcnow,
)
from ..schemas import EvaluationUpsert, ResultOut
from ..services import assessment_service, scoring_service

router = APIRouter(prefix="/api/admin", tags=["evaluations"])


def _load(db: Session, assessment_id: int) -> Assessment:
    assessment = db.scalar(
        select(Assessment)
        .options(selectinload(Assessment.role), selectinload(Assessment.paper))
        .where(Assessment.id == assessment_id)
    )
    if assessment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found.")
    return assessment


@router.put("/assessments/{assessment_id}/evaluations/{question_id}", response_model=ResultOut)
def upsert_evaluation(
    assessment_id: int,
    question_id: int,
    payload: EvaluationUpsert,
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(get_current_admin),
) -> dict:
    assessment = _load(db, assessment_id)
    if assessment.status != AssessmentStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only submitted assessments can be evaluated.",
        )

    question = db.scalar(
        select(Question).where(
            Question.id == question_id,
            Question.question_paper_id == assessment.question_paper_id,
            Question.question_type == QuestionType.SUBJECTIVE,
        )
    )
    if question is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subjective question not found in this candidate's paper.",
        )
    try:
        evaluation = db.scalar(
            select(AssessmentEvaluation).where(
                AssessmentEvaluation.assessment_id == assessment.id,
                AssessmentEvaluation.question_id == question.id,
            )
        )
        if evaluation is None:
            evaluation = AssessmentEvaluation(assessment_id=assessment.id, question_id=question.id)
            db.add(evaluation)
        # Screening forms are not scored; marks stay at zero and the notes carry the review.
        evaluation.awarded_marks = payload.awarded_marks or 0.0
        evaluation.maximum_marks = float(question.marks)
        evaluation.evaluator_feedback = payload.evaluator_feedback
        evaluation.evaluated_by = admin.id
        evaluation.evaluated_at = utcnow()
        db.flush()
        scoring_service.recalculate_scores(db, assessment)
        db.commit()
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise

    db.refresh(assessment)
    return assessment_service.build_result(db, assessment)


@router.post("/assessments/{assessment_id}/evaluate", response_model=ResultOut)
def finalise_evaluation(
    assessment_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
) -> dict:
    """Recompute and persist scores after evaluations were saved."""
    assessment = _load(db, assessment_id)
    try:
        scoring_service.recalculate_scores(db, assessment)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(assessment)
    return assessment_service.build_result(db, assessment)
