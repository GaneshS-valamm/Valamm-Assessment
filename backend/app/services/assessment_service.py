"""Assessment lifecycle: generation, answer autosave, submission, results assembly."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..models import (
    Assessment,
    AssessmentAnswer,
    AssessmentEvaluation,
    AssessmentStatus,
    CandidateResume,
    EvaluationStatus,
    InterestResponse,
    Question,
    QuestionOption,
    QuestionPaper,
    QuestionType,
    Role,
    utcnow,
)
from pathlib import Path

from . import resume_service, scoring_service
from .storage_service import LocalDiskStorage, StorageError, get_storage
from ..security import decrypt_token, encrypt_token
from .token_service import build_assessment_url, new_token_pair

CANDIDATE_INSTRUCTIONS = [
    "This is not a test and there are no right or wrong answers - we simply want to understand how you think and how you approach your work.",
    "Please write your answers yourself, in your own words. Do not use AI tools to generate them - a genuine, plain answer tells us far more than a polished one.",
    "Answer in plain, simple language and avoid jargon. Back up an answer with a real example wherever you can.",
    "Review the resume our recruitment team has on file for you, and replace it if it is out of date.",
    "Let us know whether you would like to go ahead with this role.",
    "Your answers are saved automatically as you type - you can safely refresh or reopen the link.",
    "Use Previous / Next or the question panel to move between questions.",
    "Please keep an eye on the clock. When it runs out your answers are sent to us as they are.",
]


def active_paper_for_role(db: Session, role_id: int) -> QuestionPaper:
    paper = db.scalar(
        select(QuestionPaper)
        .where(QuestionPaper.role_id == role_id, QuestionPaper.is_active.is_(True))
        .order_by(QuestionPaper.version.desc())
    )
    if paper is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No active question paper exists for the selected role.",
        )
    return paper


def question_count(db: Session, question_paper_id: int) -> int:
    return int(
        db.scalar(
            select(func.count(Question.id)).where(Question.question_paper_id == question_paper_id)
        )
        or 0
    )


def create_assessment(
    db: Session,
    *,
    candidate_name: str,
    candidate_email: str,
    role_id: int,
    duration_minutes: int | None,
    interviewer_1: str | None = None,
    interviewer_2: str | None = None,
) -> tuple[Assessment, str]:
    role = db.get(Role, role_id)
    if role is None or not role.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown or inactive role.")

    paper = active_paper_for_role(db, role_id)
    if question_count(db, paper.id) == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The active question paper for this role has no questions.",
        )

    raw_token, token_hash = new_token_pair()
    assessment = Assessment(
        candidate_name=candidate_name,
        candidate_email=candidate_email.strip().lower(),
        role_id=role.id,
        test_role_id=role.id,  # starts equal to the applied role
        question_paper_id=paper.id,
        question_paper_version=paper.version,
        unique_token_hash=token_hash,
        token_cipher=encrypt_token(raw_token),
        status=AssessmentStatus.GENERATED,
        duration_minutes=duration_minutes or settings.DEFAULT_DURATION_MINUTES,
        evaluation_status=EvaluationStatus.PENDING,
        interviewer_1=(interviewer_1 or "").strip() or None,
        interviewer_2=(interviewer_2 or "").strip() or None,
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)
    return assessment, raw_token


def expires_at(assessment: Assessment) -> datetime | None:
    """When the candidate's time runs out, or None if the paper is untimed."""
    if not assessment.duration_minutes or assessment.started_at is None:
        return None
    started = assessment.started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return started + timedelta(minutes=assessment.duration_minutes)


def seconds_remaining(assessment: Assessment) -> int | None:
    deadline = expires_at(assessment)
    if deadline is None:
        return None
    return max(0, int((deadline - utcnow()).total_seconds()))


def is_expired(assessment: Assessment) -> bool:
    if assessment.status == AssessmentStatus.SUBMITTED:
        return False
    deadline = expires_at(assessment)
    return deadline is not None and utcnow() >= deadline


def close_if_expired(db: Session, assessment: Assessment) -> bool:
    """Auto-submit a paper whose time has run out.

    Called on every candidate request, so the deadline is enforced server-side even if
    the candidate closed the tab or tampered with the clock.
    """
    if not is_expired(assessment):
        return False
    try:
        assessment.status = AssessmentStatus.SUBMITTED
        assessment.submitted_at = expires_at(assessment) or utcnow()
        resume_service.lock_resumes(db, assessment.id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(assessment)
    return True


def require_resume(db: Session, assessment: Assessment) -> None:
    """The paper is released only after resume review and a positive interest response."""
    if assessment.interest_response == InterestResponse.NOT_INTERESTED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You have let us know you would prefer not to proceed with this role, so these questions are closed.",
        )

    if not settings.RESUME_REQUIRED_BEFORE_START:
        return

    if resume_service.current_resume(db, assessment.id) is None:
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail=(
                "No resume is on file for you yet. Please upload your resume, or contact the "
                "recruitment team."
            ),
        )

    if assessment.resume_confirmed_at is None:
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail="Please review the resume on file and either confirm it or upload a new one.",
        )

    if assessment.interest_response == InterestResponse.PENDING:
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail="Please let us know whether you would like to go ahead with this role.",
        )


def confirm_resume(db: Session, assessment: Assessment) -> Assessment:
    """Candidate reviewed the resume on file and accepted it as-is."""
    if resume_service.current_resume(db, assessment.id) is None:
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail="There is no resume on file to confirm.",
        )
    if assessment.status == AssessmentStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already sent us your answers.",
        )
    if assessment.resume_confirmed_at is None:
        assessment.resume_confirmed_at = utcnow()
        db.commit()
        db.refresh(assessment)
    return assessment


def record_interest(db: Session, assessment: Assessment, interested: bool) -> Assessment:
    """Record the candidate's yes/no on proceeding with the role."""
    if assessment.status == AssessmentStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already sent us your answers.",
        )
    # A declined assessment is final - it must not be flipped back open.
    if assessment.interest_response == InterestResponse.NOT_INTERESTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Your response has already been recorded. Thank you for your time.",
        )

    assessment.interest_response = (
        InterestResponse.INTERESTED if interested else InterestResponse.NOT_INTERESTED
    )
    assessment.interest_responded_at = utcnow()
    db.commit()
    db.refresh(assessment)
    return assessment


def require_resume_on_file(db: Session, assessment: Assessment) -> None:
    """Resume gate only - used where the interest gate must not apply yet."""
    if not settings.RESUME_REQUIRED_BEFORE_START:
        return
    if resume_service.current_resume(db, assessment.id) is None:
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail="Please upload your resume before choosing a role.",
        )
    if assessment.resume_confirmed_at is None:
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail="Please review the resume on file and either confirm it or upload a new one.",
        )


def switch_test_role(db: Session, assessment: Assessment, new_role_id: int) -> Assessment:
    """Point the assessment at a different role's paper.

    The applied role (`role_id`) is never touched - only `test_role_id` and the pinned
    question paper change. Any answers already saved belong to the previous paper's
    questions, so they are cleared; nothing else about the candidate is disturbed.
    """
    if assessment.status == AssessmentStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already sent us your answers.",
        )

    role = db.get(Role, new_role_id)
    if role is None or not role.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown role.")

    paper = active_paper_for_role(db, role.id)
    if question_count(db, paper.id) == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="There are no questions available for that role at the moment.",
        )

    try:
        if paper.id != assessment.question_paper_id:
            # Answers reference the old paper's question ids; they cannot carry over.
            db.execute(
                delete(AssessmentAnswer).where(AssessmentAnswer.assessment_id == assessment.id)
            )
            db.execute(
                delete(AssessmentEvaluation).where(
                    AssessmentEvaluation.assessment_id == assessment.id
                )
            )

        assessment.test_role_id = role.id
        assessment.question_paper_id = paper.id
        assessment.question_paper_version = paper.version
        # Choosing a role is itself a yes, and the clock restarts for the new paper.
        assessment.interest_response = InterestResponse.INTERESTED
        assessment.interest_responded_at = utcnow()
        assessment.status = AssessmentStatus.IN_PROGRESS
        assessment.started_at = utcnow()

        # Keep the resume pointing at the role actually being assessed.
        for resume in db.scalars(
            select(CandidateResume).where(CandidateResume.assessment_id == assessment.id)
        ).all():
            resume.role_id = role.id

        db.commit()
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise
    db.refresh(assessment)
    return assessment


def delete_assessment(db: Session, assessment: Assessment) -> None:
    """Remove a candidate's assessment and everything hanging off it.

    Answers and evaluations cascade from the assessment row; resume rows cascade too, so
    their stored files are removed first to avoid orphaning them in the storage backend.
    """
    keys = list(
        db.scalars(
            select(CandidateResume.storage_key).where(
                CandidateResume.assessment_id == assessment.id
            )
        ).all()
    )
    try:
        db.delete(assessment)
        db.commit()
    except Exception:
        db.rollback()
        raise

    storage = get_storage()
    for key in keys:
        try:
            if isinstance(storage, LocalDiskStorage) and storage.exists(key):
                (Path(storage.root) / key).unlink(missing_ok=True)
        except (StorageError, OSError):
            # The row is already gone; a leftover file is not worth failing the request.
            pass


def start_assessment(db: Session, assessment: Assessment) -> Assessment:
    if assessment.status == AssessmentStatus.SUBMITTED:
        return assessment
    require_resume(db, assessment)
    if assessment.started_at is None:
        assessment.started_at = utcnow()
    assessment.status = AssessmentStatus.IN_PROGRESS
    db.commit()
    db.refresh(assessment)
    return assessment


def _question_for_assessment(db: Session, assessment: Assessment, question_id: int) -> Question:
    """Guarantees the question belongs to *this* assessment's paper."""
    question = db.scalar(
        select(Question).where(
            Question.id == question_id,
            Question.question_paper_id == assessment.question_paper_id,
        )
    )
    if question is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This question is not part of your questionnaire.",
        )
    return question


def save_answer(
    db: Session,
    assessment: Assessment,
    question_id: int,
    *,
    selected_option_id: int | None,
    subjective_answer: str | None,
) -> AssessmentAnswer:
    if close_if_expired(db, assessment):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Your time has run out. Your answers have been sent to us as they were.",
        )
    if assessment.status == AssessmentStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already sent us your answers, so they can no longer be changed.",
        )

    question = _question_for_assessment(db, assessment, question_id)

    if question.question_type == QuestionType.OBJECTIVE:
        subjective_answer = None
        if selected_option_id is not None:
            valid = db.scalar(
                select(QuestionOption.id).where(
                    QuestionOption.id == selected_option_id,
                    QuestionOption.question_id == question.id,
                )
            )
            if valid is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Selected option does not belong to this question.",
                )
    else:
        selected_option_id = None

    if assessment.started_at is None:
        assessment.started_at = utcnow()
    if assessment.status == AssessmentStatus.GENERATED:
        assessment.status = AssessmentStatus.IN_PROGRESS

    answer = db.scalar(
        select(AssessmentAnswer).where(
            AssessmentAnswer.assessment_id == assessment.id,
            AssessmentAnswer.question_id == question.id,
        )
    )
    if answer is None:
        answer = AssessmentAnswer(assessment_id=assessment.id, question_id=question.id)
        db.add(answer)

    answer.selected_option_id = selected_option_id
    answer.subjective_answer = subjective_answer
    answer.updated_at = utcnow()
    db.commit()
    db.refresh(answer)
    return answer


def answered_flags(db: Session, assessment: Assessment) -> dict[int, AssessmentAnswer]:
    rows = db.scalars(
        select(AssessmentAnswer).where(AssessmentAnswer.assessment_id == assessment.id)
    ).all()
    return {r.question_id: r for r in rows}


def is_answered(answer: AssessmentAnswer | None) -> bool:
    if answer is None:
        return False
    if answer.selected_option_id is not None:
        return True
    return bool(answer.subjective_answer and answer.subjective_answer.strip())


def answer_counts(db: Session, assessment: Assessment) -> tuple[int, int]:
    """(answered, total) for this assessment's paper."""
    questions = db.scalars(
        select(Question).where(Question.question_paper_id == assessment.question_paper_id)
    ).all()
    answers = answered_flags(db, assessment)
    return sum(1 for q in questions if is_answered(answers.get(q.id))), len(questions)


def submit_assessment(db: Session, assessment: Assessment) -> tuple[Assessment, int, int]:
    # Idempotent: a repeat submit returns the original submission rather than duplicating it.
    if assessment.status == AssessmentStatus.SUBMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already sent us your answers.",
        )

    questions = db.scalars(
        select(Question).where(Question.question_paper_id == assessment.question_paper_id)
    ).all()
    answers = answered_flags(db, assessment)
    answered_count = sum(1 for q in questions if is_answered(answers.get(q.id)))

    try:
        assessment.status = AssessmentStatus.SUBMITTED
        assessment.submitted_at = utcnow()
        if assessment.started_at is None:
            assessment.started_at = assessment.submitted_at
        scoring_service.recalculate_scores(db, assessment)
        # Freeze the resume that was current at submission time.
        resume_service.lock_resumes(db, assessment.id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(assessment)
    return assessment, answered_count, len(questions)


# --------------------------------------------------------------------------- #
# Results assembly (admin)
# --------------------------------------------------------------------------- #


def build_result(db: Session, assessment: Assessment) -> dict:
    questions = db.scalars(
        select(Question)
        .options(selectinload(Question.options))
        .where(Question.question_paper_id == assessment.question_paper_id)
        .order_by(Question.question_order)
    ).all()
    answers = answered_flags(db, assessment)
    evaluations = {
        e.question_id: e
        for e in db.scalars(
            select(AssessmentEvaluation).where(AssessmentEvaluation.assessment_id == assessment.id)
        ).all()
    }

    objective_score = 0.0
    objective_max = 0.0
    subjective_max = 0.0
    subjective_awarded = 0.0
    subjective_total = 0
    subjective_evaluated = 0
    out_questions: list[dict] = []

    for q in questions:
        answer = answers.get(q.id)
        if q.question_type == QuestionType.OBJECTIVE:
            objective_max += q.marks
            correct = next((o for o in q.options if o.is_correct), None)
            selected_id = answer.selected_option_id if answer else None
            is_correct = None
            marks_obtained: float | None = None
            if selected_id is not None:
                is_correct = correct is not None and selected_id == correct.id
                marks_obtained = float(q.marks) if is_correct else 0.0
                if is_correct:
                    objective_score += q.marks
            elif assessment.status == AssessmentStatus.SUBMITTED:
                is_correct = False
                marks_obtained = 0.0
            out_questions.append(
                {
                    "question_id": q.id,
                    "question_order": q.question_order,
                    "question_type": q.question_type,
                    "question_text": q.question_text,
                    "instructions": q.instructions,
                    "max_marks": q.marks,
                    "evaluation_criteria": q.evaluation_criteria,
                    "options": [
                        {
                            "id": o.id,
                            "option_text": o.option_text,
                            "option_order": o.option_order,
                            "is_correct": o.is_correct,
                            "is_selected": o.id == selected_id,
                        }
                        for o in q.options
                    ],
                    "selected_option_id": selected_id,
                    "correct_option_id": correct.id if correct else None,
                    "is_correct": is_correct,
                    "marks_obtained": marks_obtained,
                    "subjective_answer": None,
                    "awarded_marks": None,
                    "evaluator_feedback": None,
                    "evaluated_at": None,
                    "evaluation_status": "AUTO_SCORED",
                }
            )
        else:
            subjective_max += q.marks
            subjective_total += 1
            ev = evaluations.get(q.id)
            if ev is not None:
                subjective_evaluated += 1
                subjective_awarded += ev.awarded_marks
            out_questions.append(
                {
                    "question_id": q.id,
                    "question_order": q.question_order,
                    "question_type": q.question_type,
                    "question_text": q.question_text,
                    "instructions": q.instructions,
                    "max_marks": q.marks,
                    "evaluation_criteria": q.evaluation_criteria,
                    "options": [],
                    "selected_option_id": None,
                    "correct_option_id": None,
                    "is_correct": None,
                    "marks_obtained": None,
                    "subjective_answer": answer.subjective_answer if answer else None,
                    "awarded_marks": ev.awarded_marks if ev else None,
                    "evaluator_feedback": ev.evaluator_feedback if ev else None,
                    "evaluated_at": ev.evaluated_at if ev else None,
                    "evaluation_status": "EVALUATED" if ev else "PENDING_EVALUATION",
                }
            )

    fully_evaluated = subjective_total == 0 or subjective_evaluated == subjective_total
    total_max = objective_max + subjective_max
    final_score = objective_score + subjective_awarded if fully_evaluated else None
    percentage = round(final_score / total_max * 100, 2) if (final_score is not None and total_max) else None

    if subjective_total == 0:
        eval_status = EvaluationStatus.NOT_APPLICABLE
    else:
        eval_status = EvaluationStatus.COMPLETED if fully_evaluated else EvaluationStatus.PENDING

    answered, _total = answer_counts(db, assessment)
    # SQLite hands timestamps back naive, so normalise before comparing with the deadline.
    deadline = expires_at(assessment)
    submitted = utc(assessment.submitted_at)
    return {
        "assessment_id": assessment.id,
        "duration_minutes": assessment.duration_minutes,
        "answered_count": answered,
        "auto_submitted": bool(deadline and submitted and submitted >= deadline),
        "candidate_name": assessment.candidate_name,
        "candidate_email": assessment.candidate_email,
        "role_name": assessment.role.role_name,
        "applied_role_name": assessment.role.role_name,
        "test_role_name": (assessment.test_role.role_name if assessment.test_role else None),
        "interviewer_1": assessment.interviewer_1,
        "interviewer_2": assessment.interviewer_2,
        "status": assessment.status,
        "question_paper_title": assessment.paper.paper_title,
        "question_paper_version": assessment.question_paper_version,
        "created_at": assessment.created_at,
        "started_at": assessment.started_at,
        "submitted_at": assessment.submitted_at,
        "objective_score": objective_score,
        "objective_max": objective_max,
        "subjective_awarded": subjective_awarded,
        "subjective_max": subjective_max,
        "subjective_evaluated_count": subjective_evaluated,
        "subjective_total_count": subjective_total,
        "final_score": final_score,
        "percentage": percentage,
        "evaluation_status": eval_status,
        "questions": out_questions,
    }


def to_row(db: Session, assessment: Assessment) -> dict:
    objective_max, subjective_max, _ = scoring_service.paper_totals(db, assessment.question_paper_id)
    answered, total = answer_counts(db, assessment)
    return {
        "id": assessment.id,
        "candidate_name": assessment.candidate_name,
        "candidate_email": assessment.candidate_email,
        "role_id": assessment.role_id,
        "role_name": assessment.role.role_name,
        "applied_role_name": assessment.role.role_name,
        "test_role_id": assessment.test_role_id,
        "test_role_name": (
            assessment.test_role.role_name if assessment.test_role else None
        ),
        "interviewer_1": assessment.interviewer_1,
        "interviewer_2": assessment.interviewer_2,
        "question_paper_version": assessment.question_paper_version,
        "status": assessment.status,
        "duration_minutes": assessment.duration_minutes,
        "created_at": assessment.created_at,
        "started_at": assessment.started_at,
        "submitted_at": assessment.submitted_at,
        "objective_score": assessment.objective_score,
        "objective_max": objective_max,
        "subjective_score": assessment.subjective_score,
        "subjective_max": subjective_max,
        "final_score": assessment.final_score,
        "evaluation_status": assessment.evaluation_status,
        "assessment_url": link_for(assessment),
        "interest_response": assessment.interest_response,
        "interest_responded_at": assessment.interest_responded_at,
        "resume_confirmed_at": assessment.resume_confirmed_at,
        "expires_at": expires_at(assessment),
        "answered_count": answered,
        "question_count": total,
    }


def link_for(assessment: Assessment) -> str | None:
    raw = decrypt_token(assessment.token_cipher)
    return build_assessment_url(raw) if raw else None


def utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
