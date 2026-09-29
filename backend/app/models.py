"""SQLAlchemy ORM models - normalized schema with FKs, unique constraints, indexes."""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class QuestionType(str, enum.Enum):
    OBJECTIVE = "OBJECTIVE"
    SUBJECTIVE = "SUBJECTIVE"


class AssessmentStatus(str, enum.Enum):
    GENERATED = "GENERATED"
    IN_PROGRESS = "IN_PROGRESS"
    SUBMITTED = "SUBMITTED"


class EvaluationStatus(str, enum.Enum):
    NOT_APPLICABLE = "NOT_APPLICABLE"
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"


class ResumeStatus(str, enum.Enum):
    """Admin-side review state of a resume."""

    NEW = "NEW"
    REVIEWED = "REVIEWED"
    SHORTLISTED = "SHORTLISTED"


class UploadedByType(str, enum.Enum):
    ADMIN = "ADMIN"
    CANDIDATE = "CANDIDATE"


class InterestResponse(str, enum.Enum):
    """Whether the candidate wants to proceed with the role."""

    PENDING = "PENDING"
    INTERESTED = "INTERESTED"
    NOT_INTERESTED = "NOT_INTERESTED"


TS = DateTime(timezone=True)


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow, onupdate=utcnow)


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow, onupdate=utcnow)

    papers: Mapped[list[QuestionPaper]] = relationship(back_populates="role")


class QuestionPaper(Base):
    __tablename__ = "question_papers"
    __table_args__ = (
        UniqueConstraint("role_id", "version", name="uq_paper_role_version"),
        Index("ix_paper_role_active", "role_id", "is_active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False)
    paper_title: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow)

    role: Mapped[Role] = relationship(back_populates="papers")
    questions: Mapped[list[Question]] = relationship(
        back_populates="paper",
        order_by="Question.question_order",
        cascade="all, delete-orphan",
    )


class Question(Base):
    __tablename__ = "questions"
    __table_args__ = (Index("ix_question_paper_order", "question_paper_id", "question_order"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_paper_id: Mapped[int] = mapped_column(
        ForeignKey("question_papers.id", ondelete="CASCADE"), nullable=False
    )
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[QuestionType] = mapped_column(
        Enum(QuestionType, native_enum=False, length=20), nullable=False
    )
    marks: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    question_order: Mapped[int] = mapped_column(Integer, nullable=False)
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    instructions: Mapped[str | None] = mapped_column(Text)
    evaluation_criteria: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow)

    paper: Mapped[QuestionPaper] = relationship(back_populates="questions")
    options: Mapped[list[QuestionOption]] = relationship(
        back_populates="question",
        order_by="QuestionOption.option_order",
        cascade="all, delete-orphan",
    )


class QuestionOption(Base):
    __tablename__ = "question_options"
    __table_args__ = (UniqueConstraint("question_id", "option_order", name="uq_option_question_order"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), nullable=False)
    option_text: Mapped[str] = mapped_column(Text, nullable=False)
    option_order: Mapped[int] = mapped_column(Integer, nullable=False)
    # Answer key - never serialised into candidate-facing responses.
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    question: Mapped[Question] = relationship(back_populates="options")


class Assessment(Base):
    __tablename__ = "assessments"
    __table_args__ = (
        Index("ix_assessment_role", "role_id"),
        Index("ix_assessment_status", "status"),
        Index("ix_assessment_email", "candidate_email"),
        Index("ix_assessment_created", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    candidate_name: Mapped[str] = mapped_column(String(255), nullable=False)
    candidate_email: Mapped[str] = mapped_column(String(255), nullable=False)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False)
    question_paper_id: Mapped[int] = mapped_column(
        ForeignKey("question_papers.id", ondelete="RESTRICT"), nullable=False
    )
    question_paper_version: Mapped[int] = mapped_column(Integer, nullable=False)
    unique_token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    # Encrypted at rest with JWT_SECRET so the admin console can re-display the link.
    # The raw token is never stored, and lookups always go through unique_token_hash.
    token_cipher: Mapped[str | None] = mapped_column(Text)
    status: Mapped[AssessmentStatus] = mapped_column(
        Enum(AssessmentStatus, native_enum=False, length=20),
        nullable=False,
        default=AssessmentStatus.GENERATED,
    )
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(TS)
    submitted_at: Mapped[datetime | None] = mapped_column(TS)
    objective_score: Mapped[float | None] = mapped_column(Float)
    subjective_score: Mapped[float | None] = mapped_column(Float)
    final_score: Mapped[float | None] = mapped_column(Float)
    evaluation_status: Mapped[EvaluationStatus] = mapped_column(
        Enum(EvaluationStatus, native_enum=False, length=20),
        nullable=False,
        default=EvaluationStatus.PENDING,
    )
    # The role the candidate actually answers questions for. Starts equal to role_id
    # (the applied role) and changes only if the candidate picks a different role.
    # role_id is never overwritten, so the applied role is always recoverable.
    test_role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id", ondelete="RESTRICT"))
    # Extra minutes granted by the admin on top of duration_minutes. Lets a candidate
    # whose time ran out reopen the same link and finish, without losing any answer.
    extra_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    extra_time_granted_at: Mapped[datetime | None] = mapped_column(TS)
    # True only when the timer closed the paper. A paper the candidate submitted has this
    # False and can never be reopened; a timer-closed one can be, by granting extra time.
    auto_closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    # Interviewers assigned by the admin; editable at any time, never candidate-visible.
    interviewer_1: Mapped[str | None] = mapped_column(String(255))
    interviewer_2: Mapped[str | None] = mapped_column(String(255))
    # Candidate reviewed the resume on file (confirmed it, or uploaded a replacement).
    resume_confirmed_at: Mapped[datetime | None] = mapped_column(TS)
    # Candidate's declared interest in the role - the paper is released only on INTERESTED.
    interest_response: Mapped[InterestResponse] = mapped_column(
        Enum(InterestResponse, native_enum=False, length=20),
        nullable=False,
        default=InterestResponse.PENDING,
        server_default="PENDING",
    )
    interest_responded_at: Mapped[datetime | None] = mapped_column(TS)
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow, onupdate=utcnow)

    role: Mapped[Role] = relationship(foreign_keys=[role_id])
    test_role: Mapped[Role | None] = relationship(foreign_keys=[test_role_id])
    paper: Mapped[QuestionPaper] = relationship()
    answers: Mapped[list[AssessmentAnswer]] = relationship(
        back_populates="assessment", cascade="all, delete-orphan"
    )
    evaluations: Mapped[list[AssessmentEvaluation]] = relationship(
        back_populates="assessment", cascade="all, delete-orphan"
    )
    resumes: Mapped[list[CandidateResume]] = relationship(
        back_populates="assessment",
        order_by="CandidateResume.version.desc()",
        # Deleting an assessment must delete its resume rows, not orphan them by
        # nulling the foreign key (which the column forbids anyway).
        cascade="all, delete-orphan",
    )


class AssessmentAnswer(Base):
    __tablename__ = "assessment_answers"
    __table_args__ = (
        UniqueConstraint("assessment_id", "question_id", name="uq_answer_assessment_question"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assessment_id: Mapped[int] = mapped_column(
        ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False
    )
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False)
    selected_option_id: Mapped[int | None] = mapped_column(
        ForeignKey("question_options.id", ondelete="RESTRICT")
    )
    subjective_answer: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow, onupdate=utcnow)

    assessment: Mapped[Assessment] = relationship(back_populates="answers")
    question: Mapped[Question] = relationship()
    selected_option: Mapped[QuestionOption | None] = relationship()


class AssessmentEvaluation(Base):
    __tablename__ = "assessment_evaluations"
    __table_args__ = (
        UniqueConstraint("assessment_id", "question_id", name="uq_eval_assessment_question"),
        CheckConstraint("awarded_marks >= 0", name="ck_eval_marks_non_negative"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assessment_id: Mapped[int] = mapped_column(
        ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False
    )
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="RESTRICT"), nullable=False)
    awarded_marks: Mapped[float] = mapped_column(Float, nullable=False)
    maximum_marks: Mapped[float] = mapped_column(Float, nullable=False)
    evaluator_feedback: Mapped[str | None] = mapped_column(Text)
    evaluated_by: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id", ondelete="SET NULL"))
    evaluated_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow, onupdate=utcnow)

    assessment: Mapped[Assessment] = relationship(back_populates="evaluations")
    question: Mapped[Question] = relationship()


class CandidateResume(Base):
    """One row per uploaded resume file.

    Replacing a resume inserts a new row with an incremented version and flips the
    previous row's is_current flag - earlier versions are never deleted or overwritten.
    Only metadata and a storage key live here; the binary stays in the storage backend.
    """

    __tablename__ = "candidate_resumes"
    __table_args__ = (
        UniqueConstraint("assessment_id", "version", name="uq_resume_assessment_version"),
        UniqueConstraint("storage_key", name="uq_resume_storage_key"),
        Index("ix_resume_assessment_current", "assessment_id", "is_current"),
        Index("ix_resume_status", "resume_status"),
        Index("ix_resume_uploaded", "uploaded_at"),
        Index("ix_resume_email", "candidate_email"),
        CheckConstraint("file_size > 0", name="ck_resume_size_positive"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assessment_id: Mapped[int] = mapped_column(
        ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False
    )
    candidate_name: Mapped[str] = mapped_column(String(255), nullable=False)
    candidate_email: Mapped[str] = mapped_column(String(255), nullable=False)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False)

    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    # Opaque, server-generated reference resolved by the configured storage backend.
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    storage_backend: Mapped[str] = mapped_column(String(32), nullable=False, default="local")
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)

    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Set when the owning assessment is submitted - a locked resume can never be replaced.
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    resume_status: Mapped[ResumeStatus] = mapped_column(
        Enum(ResumeStatus, native_enum=False, length=20), nullable=False, default=ResumeStatus.NEW
    )
    # Who put this version on file: the admin who created the assessment, or the candidate.
    uploaded_by_type: Mapped[UploadedByType] = mapped_column(
        Enum(UploadedByType, native_enum=False, length=20),
        nullable=False,
        default=UploadedByType.CANDIDATE,
        server_default="CANDIDATE",
    )
    uploaded_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("admin_users.id", ondelete="SET NULL")
    )
    uploaded_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(TS)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, default=utcnow, onupdate=utcnow)

    assessment: Mapped[Assessment] = relationship(back_populates="resumes")
    role: Mapped[Role] = relationship()
