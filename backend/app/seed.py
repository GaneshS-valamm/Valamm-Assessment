"""Idempotent database initialisation + seed.

Run directly:  python -m app.seed
Also invoked automatically on API startup.
"""
from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session

from .config import BACKEND_DIR, settings
from .database import SessionLocal, engine, init_db
from .models import (
    AdminUser,
    Question,
    QuestionOption,
    QuestionPaper,
    QuestionType,
    Role,
)
from .security import hash_password

QUESTION_BANK_DIR = BACKEND_DIR / "question_bank"

# Option labels are seeded in file order; correct_option_order points at one of them.
OPTION_LABELS = ["A", "B", "C", "D"]


# Columns added after the first release. create_all() only creates missing *tables*,
# so existing installations need these applied explicitly. Idempotent and safe to re-run.
ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "assessments": {
        "resume_confirmed_at": "{ts} NULL",
        "interest_response": "VARCHAR(20) NOT NULL DEFAULT 'PENDING'",
        "interest_responded_at": "{ts} NULL",
    },
    "candidate_resumes": {
        "uploaded_by_type": "VARCHAR(20) NOT NULL DEFAULT 'CANDIDATE'",
        "uploaded_by_admin_id": "INTEGER NULL",
    },
}


def migrate_columns() -> None:
    """Add any missing columns to tables that already exist."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    ts_type = "TIMESTAMP WITH TIME ZONE" if not settings.is_sqlite else "DATETIME"

    with engine.begin() as conn:
        for table, columns in ADDED_COLUMNS.items():
            if table not in existing_tables:
                continue  # create_all() will build it with every column
            present = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name in present:
                    continue
                conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl.format(ts=ts_type)}")
                )
                print(f"[migrate] {table}.{name} added")


def load_bank() -> list[dict]:
    papers = []
    for path in sorted(QUESTION_BANK_DIR.glob("*.json")):
        papers.append(json.loads(path.read_text(encoding="utf-8")))
    if not papers:
        raise RuntimeError(f"No question papers found in {QUESTION_BANK_DIR}")
    return papers


def seed_admin(db: Session) -> None:
    user_id = settings.ADMIN_USER_ID.strip()
    admin = db.scalar(select(AdminUser).where(AdminUser.user_id == user_id))

    password_hash = settings.ADMIN_PASSWORD_HASH.strip()
    if not password_hash:
        plain = settings.ADMIN_PASSWORD.strip() or "Admin@12345"
        password_hash = hash_password(plain)
        print(
            f"[seed] ADMIN_PASSWORD_HASH not set - generated a hash for "
            f"{'ADMIN_PASSWORD' if settings.ADMIN_PASSWORD.strip() else 'the default dev password Admin@12345'}."
        )

    if admin is None:
        db.add(AdminUser(user_id=user_id, password_hash=password_hash, is_active=True))
        print(f"[seed] created admin user '{user_id}'")
    else:
        # Keep the stored hash in sync with .env so rotating the secret works.
        admin.password_hash = password_hash
        admin.is_active = True
    db.commit()


def seed_roles_and_papers(db: Session) -> None:
    for spec in load_bank():
        role = db.scalar(select(Role).where(Role.role_name == spec["role_name"]))
        if role is None:
            role = Role(
                role_name=spec["role_name"],
                description=spec.get("role_description"),
                is_active=True,
            )
            db.add(role)
            db.flush()
            print(f"[seed] created role: {role.role_name}")

        existing = db.scalar(
            select(QuestionPaper).where(
                QuestionPaper.role_id == role.id, QuestionPaper.version == 1
            )
        )
        if existing is not None:
            continue  # never rewrite a paper an assessment may already point at

        paper = QuestionPaper(
            role_id=role.id, paper_title=spec["paper_title"], version=1, is_active=True
        )
        db.add(paper)
        db.flush()

        for q in spec["questions"]:
            qtype = QuestionType(q["question_type"])
            question = Question(
                question_paper_id=paper.id,
                question_text=q["question_text"],
                question_type=qtype,
                marks=int(q["marks"]),
                question_order=int(q["question_order"]),
                is_required=bool(q.get("is_required", True)),
                instructions=q.get("instructions"),
                evaluation_criteria=q.get("evaluation_criteria"),
            )
            db.add(question)
            db.flush()

            if qtype == QuestionType.OBJECTIVE:
                correct = int(q["correct_option_order"])
                for idx, option_text in enumerate(q["options"], start=1):
                    db.add(
                        QuestionOption(
                            question_id=question.id,
                            option_text=option_text,
                            option_order=idx,
                            is_correct=(idx == correct),
                        )
                    )
        db.commit()
        print(f"[seed] seeded paper v1 for {role.role_name} ({len(spec['questions'])} questions)")


def validate(db: Session) -> None:
    """Fail loudly if any objective question lacks a single correct option."""
    bad = db.execute(
        select(Question.id, func.count(QuestionOption.id))
        .join(QuestionOption, QuestionOption.question_id == Question.id)
        .where(Question.question_type == QuestionType.OBJECTIVE, QuestionOption.is_correct.is_(True))
        .group_by(Question.id)
        .having(func.count(QuestionOption.id) != 1)
    ).all()
    if bad:
        raise RuntimeError(f"Objective questions with an invalid answer key: {bad}")


def run() -> None:
    init_db()
    migrate_columns()
    with SessionLocal() as db:
        seed_admin(db)
        seed_roles_and_papers(db)
        validate(db)
        roles = db.scalar(select(func.count(Role.id)))
        questions = db.scalar(select(func.count(Question.id)))
        print(f"[seed] ready: {roles} roles, {questions} questions")
        print(f"[seed] database: {settings.sqlalchemy_url.split('@')[-1]}")


if __name__ == "__main__":
    run()
