"""Pydantic request/response models. Candidate-facing schemas exclude answer keys."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, PlainSerializer, field_validator

from .models import (
    AssessmentStatus,
    EvaluationStatus,
    InterestResponse,
    QuestionType,
    ResumeStatus,
    UploadedByType,
)

ORM = ConfigDict(from_attributes=True)


def _utc_iso(value: datetime) -> str:
    """Always emit an explicit UTC offset.

    Timestamps are stored in UTC, but SQLite hands them back naive - without this the
    browser would read them as local time and display the wrong moment.
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


UtcDT = Annotated[datetime, PlainSerializer(_utc_iso, return_type=str)]


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
class LoginRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: str


class AdminMe(BaseModel):
    model_config = ORM
    id: int
    user_id: str
    is_active: bool


# --------------------------------------------------------------------------- #
# Roles
# --------------------------------------------------------------------------- #
class RoleOut(BaseModel):
    model_config = ORM
    id: int
    role_name: str
    description: str | None = None
    is_active: bool


# --------------------------------------------------------------------------- #
# Question papers (admin side - includes the answer key)
# --------------------------------------------------------------------------- #
class OptionAdminOut(BaseModel):
    model_config = ORM
    id: int
    option_text: str
    option_order: int
    is_correct: bool


class QuestionAdminOut(BaseModel):
    model_config = ORM
    id: int
    question_text: str
    question_type: QuestionType
    marks: int
    question_order: int
    is_required: bool
    instructions: str | None = None
    evaluation_criteria: str | None = None
    options: list[OptionAdminOut] = []


class PaperSummaryOut(BaseModel):
    model_config = ORM
    id: int
    role_id: int
    role_name: str
    paper_title: str
    version: int
    is_active: bool
    created_at: UtcDT
    question_count: int
    total_marks: int


class PaperDetailOut(PaperSummaryOut):
    questions: list[QuestionAdminOut] = []


class PaperCreate(BaseModel):
    role_id: int
    paper_title: str = Field(min_length=3, max_length=255)
    activate: bool = True


class OptionCreate(BaseModel):
    option_text: str = Field(min_length=1)
    option_order: int = Field(ge=1)
    is_correct: bool = False


class QuestionCreate(BaseModel):
    question_paper_id: int
    question_text: str = Field(min_length=5)
    question_type: QuestionType
    marks: int = Field(ge=1, le=100)
    question_order: int = Field(ge=1)
    is_required: bool = True
    instructions: str | None = None
    evaluation_criteria: str | None = None
    options: list[OptionCreate] = []

    @field_validator("options")
    @classmethod
    def _check_options(cls, v, info):
        qtype = info.data.get("question_type")
        if qtype == QuestionType.OBJECTIVE:
            if len(v) < 2:
                raise ValueError("objective questions need at least 2 options")
            if sum(1 for o in v if o.is_correct) != 1:
                raise ValueError("objective questions need exactly one correct option")
        return v


# --------------------------------------------------------------------------- #
# Assessment generation
# --------------------------------------------------------------------------- #
class AssessmentCreate(BaseModel):
    candidate_name: str = Field(min_length=2, max_length=255)
    candidate_email: EmailStr
    role_id: int
    duration_minutes: int | None = Field(default=None, ge=5, le=480)
    interviewer_1: str | None = Field(default=None, max_length=255)
    interviewer_2: str | None = Field(default=None, max_length=255)

    @field_validator("candidate_name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("candidate name is required")
        return v


class AssessmentUpdate(BaseModel):
    """Fields the admin may change after an assessment exists."""

    interviewer_1: str | None = Field(default=None, max_length=255)
    interviewer_2: str | None = Field(default=None, max_length=255)


class AssessmentCreatedOut(BaseModel):
    id: int
    candidate_name: str
    candidate_email: str
    role_id: int
    role_name: str
    interviewer_1: str | None = None
    interviewer_2: str | None = None
    question_paper_id: int
    question_paper_version: int
    status: AssessmentStatus
    duration_minutes: int | None
    created_at: UtcDT
    assessment_url: str
    question_count: int


class AssessmentRowOut(BaseModel):
    id: int
    candidate_name: str
    candidate_email: str
    role_id: int
    role_name: str
    applied_role_name: str
    test_role_id: int | None = None
    test_role_name: str | None = None
    interviewer_1: str | None = None
    interviewer_2: str | None = None
    question_paper_version: int
    status: AssessmentStatus
    duration_minutes: int | None
    created_at: UtcDT
    started_at: UtcDT | None
    submitted_at: UtcDT | None
    objective_score: float | None
    objective_max: float
    subjective_score: float | None
    subjective_max: float
    final_score: float | None
    evaluation_status: EvaluationStatus
    assessment_url: str | None = None
    interest_response: InterestResponse = InterestResponse.PENDING
    interest_responded_at: UtcDT | None = None
    resume_confirmed_at: UtcDT | None = None
    expires_at: UtcDT | None = None
    answered_count: int = 0
    question_count: int = 0


class AssessmentListOut(BaseModel):
    items: list[AssessmentRowOut]
    total: int
    page: int
    page_size: int


class DashboardStats(BaseModel):
    total_generated: int
    in_progress: int
    submitted: int
    pending: int
    pending_evaluation: int
    new_resumes: int = 0


# --------------------------------------------------------------------------- #
# Resumes
# --------------------------------------------------------------------------- #
class ResumeOut(BaseModel):
    """Candidate-facing resume metadata (no storage key, no filesystem path)."""

    id: int
    original_filename: str
    content_type: str
    file_size: int
    version: int
    is_locked: bool
    uploaded_at: UtcDT
    uploaded_by_type: UploadedByType


class ResumeRowOut(BaseModel):
    id: int
    assessment_id: int
    candidate_name: str
    candidate_email: str
    role_id: int
    role_name: str
    original_filename: str
    content_type: str
    file_size: int
    version: int
    is_current: bool
    is_locked: bool
    resume_status: ResumeStatus
    uploaded_at: UtcDT
    reviewed_at: UtcDT | None
    uploaded_by_type: UploadedByType
    assessment_status: AssessmentStatus
    assessment_submitted_at: UtcDT | None
    candidate_confirmed_at: UtcDT | None
    interest_response: InterestResponse
    interest_responded_at: UtcDT | None
    storage_backend: str


class ResumeListOut(BaseModel):
    items: list[ResumeRowOut]
    total: int
    page: int
    page_size: int
    new_count: int


class ResumeDetailOut(ResumeRowOut):
    assessment_created_at: UtcDT
    assessment_started_at: UtcDT | None
    question_paper_version: int
    assessment_url: str | None = None
    objective_score: float | None = None
    evaluation_status: EvaluationStatus
    history: list[ResumeOut] = []


class ResumeStatusUpdate(BaseModel):
    resume_status: ResumeStatus


# --------------------------------------------------------------------------- #
# Candidate-facing (no answer keys, no evaluation criteria)
# --------------------------------------------------------------------------- #
class CandidateOptionOut(BaseModel):
    id: int
    option_text: str
    option_order: int


class CandidateQuestionOut(BaseModel):
    id: int
    question_text: str
    question_type: QuestionType
    marks: int
    question_order: int
    is_required: bool
    instructions: str | None = None
    options: list[CandidateOptionOut] = []
    selected_option_id: int | None = None
    subjective_answer: str | None = None


class CandidateAssessmentOut(BaseModel):
    candidate_name: str
    candidate_email: str
    role_name: str
    status: AssessmentStatus
    duration_minutes: int | None
    question_count: int
    started_at: UtcDT | None
    submitted_at: UtcDT | None
    instructions: list[str]
    resume_required: bool
    resume: ResumeOut | None = None
    max_resume_mb: int
    resume_confirmed_at: UtcDT | None = None
    interest_response: InterestResponse = InterestResponse.PENDING
    interest_responded_at: UtcDT | None = None
    expires_at: UtcDT | None = None
    seconds_remaining: int | None = None
    # Other roles the candidate may switch to if they decline this one.
    other_roles: list[RoleOut] = []


class RoleChoiceRequest(BaseModel):
    role_id: int


class CandidateQuestionsOut(BaseModel):
    candidate_name: str
    role_name: str
    status: AssessmentStatus
    duration_minutes: int | None
    started_at: UtcDT | None
    expires_at: UtcDT | None = None
    seconds_remaining: int | None = None
    questions: list[CandidateQuestionOut]


class AnswerUpsert(BaseModel):
    selected_option_id: int | None = None
    subjective_answer: str | None = None


class AnswerSavedOut(BaseModel):
    question_id: int
    saved_at: UtcDT
    answered: bool


class SubmitOut(BaseModel):
    status: AssessmentStatus
    submitted_at: UtcDT
    message: str
    answered_count: int
    total_questions: int
    # True when the deadline closed the paper rather than the candidate submitting it.
    auto_submitted: bool = False


# --------------------------------------------------------------------------- #
# Admin results + evaluation
# --------------------------------------------------------------------------- #
class ResultOptionOut(BaseModel):
    id: int
    option_text: str
    option_order: int
    is_correct: bool
    is_selected: bool


class ResultQuestionOut(BaseModel):
    question_id: int
    question_order: int
    question_type: QuestionType
    question_text: str
    instructions: str | None
    max_marks: int
    evaluation_criteria: str | None = None
    options: list[ResultOptionOut] = []
    selected_option_id: int | None = None
    correct_option_id: int | None = None
    is_correct: bool | None = None
    marks_obtained: float | None = None
    subjective_answer: str | None = None
    awarded_marks: float | None = None
    evaluator_feedback: str | None = None
    evaluated_at: UtcDT | None = None
    evaluation_status: str


class ResultOut(BaseModel):
    assessment_id: int
    applied_role_name: str | None = None
    test_role_name: str | None = None
    interviewer_1: str | None = None
    interviewer_2: str | None = None
    duration_minutes: int | None = None
    auto_submitted: bool = False
    answered_count: int = 0
    candidate_name: str
    candidate_email: str
    role_name: str
    status: AssessmentStatus
    question_paper_title: str
    question_paper_version: int
    created_at: UtcDT
    started_at: UtcDT | None
    submitted_at: UtcDT | None
    objective_score: float
    objective_max: float
    subjective_awarded: float
    subjective_max: float
    subjective_evaluated_count: int
    subjective_total_count: int
    final_score: float | None
    percentage: float | None
    evaluation_status: EvaluationStatus
    questions: list[ResultQuestionOut]


class EvaluationUpsert(BaseModel):
    """Reviewer notes on one answer. These papers are screening forms, not scored tests,
    so marks are not collected; the field remains optional for API compatibility."""

    evaluator_feedback: str | None = None
    awarded_marks: float | None = Field(default=None, ge=0)


class MessageOut(BaseModel):
    message: str


class InterestRequest(BaseModel):
    interested: bool


class ResumePreviewOut(BaseModel):
    """Inline preview so a reviewer never has to download the file."""

    resume_id: int
    original_filename: str
    content_type: str
    file_size: int
    kind: str  # "pdf" | "text" | "unsupported"
    text: str | None = None
