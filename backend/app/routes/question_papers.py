"""Admin question-paper management (versioned)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..dependencies import get_current_admin
from ..models import AdminUser, Question, QuestionOption, QuestionPaper, QuestionType, Role
from ..schemas import PaperCreate, PaperDetailOut, PaperSummaryOut, QuestionCreate

router = APIRouter(prefix="/api/admin", tags=["question-papers"])


def _summary(db: Session, paper: QuestionPaper) -> dict:
    count, total = db.execute(
        select(func.count(Question.id), func.coalesce(func.sum(Question.marks), 0)).where(
            Question.question_paper_id == paper.id
        )
    ).one()
    return {
        "id": paper.id,
        "role_id": paper.role_id,
        "role_name": paper.role.role_name,
        "paper_title": paper.paper_title,
        "version": paper.version,
        "is_active": paper.is_active,
        "created_at": paper.created_at,
        "question_count": int(count or 0),
        "total_marks": int(total or 0),
    }


@router.get("/question-papers", response_model=list[PaperSummaryOut])
def list_papers(
    db: Session = Depends(get_db), _: AdminUser = Depends(get_current_admin)
) -> list[dict]:
    papers = db.scalars(
        select(QuestionPaper)
        .options(selectinload(QuestionPaper.role))
        .order_by(QuestionPaper.role_id, QuestionPaper.version.desc())
    ).all()
    return [_summary(db, p) for p in papers]


@router.get("/question-papers/{paper_id}", response_model=PaperDetailOut)
def get_paper(
    paper_id: int, db: Session = Depends(get_db), _: AdminUser = Depends(get_current_admin)
) -> dict:
    paper = db.scalar(
        select(QuestionPaper)
        .options(
            selectinload(QuestionPaper.role),
            selectinload(QuestionPaper.questions).selectinload(Question.options),
        )
        .where(QuestionPaper.id == paper_id)
    )
    if paper is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question paper not found.")
    data = _summary(db, paper)
    data["questions"] = paper.questions
    return data


@router.post("/question-papers", response_model=PaperSummaryOut, status_code=status.HTTP_201_CREATED)
def create_paper(
    payload: PaperCreate, db: Session = Depends(get_db), _: AdminUser = Depends(get_current_admin)
) -> dict:
    role = db.get(Role, payload.role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown role.")

    next_version = int(
        db.scalar(
            select(func.coalesce(func.max(QuestionPaper.version), 0)).where(
                QuestionPaper.role_id == role.id
            )
        )
        or 0
    ) + 1

    if payload.activate:
        # Deactivate older versions; existing assessments keep their pinned paper id.
        for old in db.scalars(
            select(QuestionPaper).where(QuestionPaper.role_id == role.id)
        ).all():
            old.is_active = False

    paper = QuestionPaper(
        role_id=role.id,
        paper_title=payload.paper_title,
        version=next_version,
        is_active=payload.activate,
    )
    db.add(paper)
    db.commit()
    db.refresh(paper)
    return _summary(db, paper)


@router.post("/questions", status_code=status.HTTP_201_CREATED)
def create_question(
    payload: QuestionCreate, db: Session = Depends(get_db), _: AdminUser = Depends(get_current_admin)
) -> dict:
    paper = db.get(QuestionPaper, payload.question_paper_id)
    if paper is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown question paper.")

    clash = db.scalar(
        select(Question.id).where(
            Question.question_paper_id == paper.id,
            Question.question_order == payload.question_order,
        )
    )
    if clash:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Question order {payload.question_order} is already used in this paper.",
        )

    question = Question(
        question_paper_id=paper.id,
        question_text=payload.question_text,
        question_type=payload.question_type,
        marks=payload.marks,
        question_order=payload.question_order,
        is_required=payload.is_required,
        instructions=payload.instructions,
        evaluation_criteria=payload.evaluation_criteria,
    )
    db.add(question)
    db.flush()

    if payload.question_type == QuestionType.OBJECTIVE:
        for opt in payload.options:
            db.add(
                QuestionOption(
                    question_id=question.id,
                    option_text=opt.option_text,
                    option_order=opt.option_order,
                    is_correct=opt.is_correct,
                )
            )
    db.commit()
    return {"id": question.id, "message": "Question created."}
