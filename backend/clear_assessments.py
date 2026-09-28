r"""Maintenance helper: remove candidate assessment data, keeping roles/papers/admin intact.

Used to clear out test records. Roles, question papers, questions and the admin user are
left untouched. Resume rows are removed too, and their files are deleted from the
configured storage backend.

    .\.venv\Scripts\python.exe clear_assessments.py          # show what would be deleted
    .\.venv\Scripts\python.exe clear_assessments.py --yes     # actually delete
"""
from __future__ import annotations

import pathlib
import sys

from sqlalchemy import delete, func, select

from app.config import settings
from app.database import SessionLocal, init_db
from app.models import Assessment, AssessmentAnswer, AssessmentEvaluation, CandidateResume


def main() -> None:
    init_db()
    confirmed = "--yes" in sys.argv
    with SessionLocal() as db:
        counts = {
            "assessments": db.scalar(select(func.count(Assessment.id))),
            "answers": db.scalar(select(func.count(AssessmentAnswer.id))),
            "evaluations": db.scalar(select(func.count(AssessmentEvaluation.id))),
            "resumes": db.scalar(select(func.count(CandidateResume.id))),
        }
        print("current rows:", counts)
        if not confirmed:
            print("dry run - re-run with --yes to delete these rows")
            return
        # Remove stored resume files before dropping the rows that reference them.
        removed_files = 0
        for key in db.scalars(select(CandidateResume.storage_key)).all():
            path = pathlib.Path(settings.resume_storage_path) / key
            if path.is_file():
                path.unlink()
                removed_files += 1

        db.execute(delete(CandidateResume))
        db.execute(delete(AssessmentEvaluation))
        db.execute(delete(AssessmentAnswer))
        db.execute(delete(Assessment))
        db.commit()
        print(f"deleted. assessments now: {db.scalar(select(func.count(Assessment.id)))}, "
              f"resume files removed: {removed_files}")


if __name__ == "__main__":
    main()
