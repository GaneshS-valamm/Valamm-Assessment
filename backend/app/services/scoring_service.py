"""Objective auto-scoring and combined score roll-up.

Subjective marks are never invented: they only come from admin evaluations.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    Assessment,
    AssessmentAnswer,
    AssessmentEvaluation,
    EvaluationStatus,
    Question,
    QuestionOption,
    QuestionType,
)


def paper_totals(db: Session, question_paper_id: int) -> tuple[float, float, int]:
    """(objective_max, subjective_max, subjective_question_count)"""
    rows = db.execute(
        select(Question.question_type, Question.marks).where(
            Question.question_paper_id == question_paper_id
        )
    ).all()
    objective_max = float(sum(m for t, m in rows if t == QuestionType.OBJECTIVE))
    subjective_rows = [m for t, m in rows if t == QuestionType.SUBJECTIVE]
    return objective_max, float(sum(subjective_rows)), len(subjective_rows)


def score_objective(db: Session, assessment: Assessment) -> float:
    """Recompute the objective score from the stored answers + answer key."""
    correct_by_question: dict[int, int] = {}
    marks_by_question: dict[int, int] = {}
    rows = db.execute(
        select(Question.id, Question.marks, QuestionOption.id, QuestionOption.is_correct)
        .join(QuestionOption, QuestionOption.question_id == Question.id)
        .where(
            Question.question_paper_id == assessment.question_paper_id,
            Question.question_type == QuestionType.OBJECTIVE,
        )
    ).all()
    for qid, marks, oid, is_correct in rows:
        marks_by_question[qid] = marks
        if is_correct:
            correct_by_question[qid] = oid

    answers = db.scalars(
        select(AssessmentAnswer).where(AssessmentAnswer.assessment_id == assessment.id)
    ).all()

    total = 0.0
    for ans in answers:
        expected = correct_by_question.get(ans.question_id)
        if expected is not None and ans.selected_option_id == expected:
            total += float(marks_by_question.get(ans.question_id, 0))
    return total


def recalculate_scores(db: Session, assessment: Assessment) -> None:
    """Refresh objective/subjective/final score + evaluation status on the assessment row."""
    objective_max, subjective_max, subjective_count = paper_totals(db, assessment.question_paper_id)

    assessment.objective_score = score_objective(db, assessment)

    evaluations = db.scalars(
        select(AssessmentEvaluation).where(AssessmentEvaluation.assessment_id == assessment.id)
    ).all()
    evaluated = {e.question_id: e for e in evaluations}
    awarded = float(sum(e.awarded_marks for e in evaluations))

    if subjective_count == 0:
        assessment.subjective_score = 0.0
        assessment.evaluation_status = EvaluationStatus.NOT_APPLICABLE
        assessment.final_score = assessment.objective_score
        return

    subjective_qids = set(
        db.scalars(
            select(Question.id).where(
                Question.question_paper_id == assessment.question_paper_id,
                Question.question_type == QuestionType.SUBJECTIVE,
            )
        ).all()
    )
    fully_evaluated = subjective_qids.issubset(set(evaluated.keys()))

    assessment.subjective_score = awarded if evaluations else None
    if fully_evaluated:
        assessment.evaluation_status = EvaluationStatus.COMPLETED
        assessment.final_score = (assessment.objective_score or 0.0) + awarded
    else:
        assessment.evaluation_status = EvaluationStatus.PENDING
        # Deliberately left None: a partially evaluated paper has no final score yet.
        assessment.final_score = None
