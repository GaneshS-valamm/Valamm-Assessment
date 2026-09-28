export type AssessmentStatus = 'GENERATED' | 'IN_PROGRESS' | 'SUBMITTED';
export type EvaluationStatus = 'NOT_APPLICABLE' | 'PENDING' | 'COMPLETED';
export type QuestionType = 'OBJECTIVE' | 'SUBJECTIVE';
export type ResumeStatus = 'NEW' | 'REVIEWED' | 'SHORTLISTED';
export type UploadedByType = 'ADMIN' | 'CANDIDATE';
export type InterestResponse = 'PENDING' | 'INTERESTED' | 'NOT_INTERESTED';

export interface Role {
  id: number;
  role_name: string;
  description: string | null;
  is_active: boolean;
}

export interface DashboardStats {
  total_generated: number;
  in_progress: number;
  submitted: number;
  pending: number;
  pending_evaluation: number;
  new_resumes: number;
}

export interface AssessmentRow {
  id: number;
  candidate_name: string;
  candidate_email: string;
  role_id: number;
  role_name: string;
  applied_role_name: string;
  test_role_id: number | null;
  test_role_name: string | null;
  interviewer_1: string | null;
  interviewer_2: string | null;
  question_paper_version: number;
  status: AssessmentStatus;
  duration_minutes: number | null;
  created_at: string;
  started_at: string | null;
  submitted_at: string | null;
  objective_score: number | null;
  objective_max: number;
  subjective_score: number | null;
  subjective_max: number;
  final_score: number | null;
  evaluation_status: EvaluationStatus;
  assessment_url: string | null;
  interest_response: InterestResponse;
  interest_responded_at: string | null;
  resume_confirmed_at: string | null;
  expires_at: string | null;
  answered_count: number;
  question_count: number;
}

export interface AssessmentList {
  items: AssessmentRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface GeneratedAssessment {
  id: number;
  interviewer_1: string | null;
  interviewer_2: string | null;
  candidate_name: string;
  candidate_email: string;
  role_id: number;
  role_name: string;
  question_paper_id: number;
  question_paper_version: number;
  status: AssessmentStatus;
  duration_minutes: number | null;
  created_at: string;
  assessment_url: string;
  question_count: number;
}

export interface PaperSummary {
  id: number;
  role_id: number;
  role_name: string;
  paper_title: string;
  version: number;
  is_active: boolean;
  created_at: string;
  question_count: number;
  total_marks: number;
}

export interface AdminOption {
  id: number;
  option_text: string;
  option_order: number;
  is_correct: boolean;
}

export interface AdminQuestion {
  id: number;
  question_text: string;
  question_type: QuestionType;
  marks: number;
  question_order: number;
  is_required: boolean;
  instructions: string | null;
  evaluation_criteria: string | null;
  options: AdminOption[];
}

export interface PaperDetail extends PaperSummary {
  questions: AdminQuestion[];
}

/* ----------------------------- candidate ----------------------------- */

export interface CandidateOption {
  id: number;
  option_text: string;
  option_order: number;
}

export interface CandidateQuestion {
  id: number;
  question_text: string;
  question_type: QuestionType;
  marks: number;
  question_order: number;
  is_required: boolean;
  instructions: string | null;
  options: CandidateOption[];
  selected_option_id: number | null;
  subjective_answer: string | null;
}

export interface CandidateResume {
  id: number;
  original_filename: string;
  content_type: string;
  file_size: number;
  version: number;
  is_locked: boolean;
  uploaded_at: string;
  uploaded_by_type: UploadedByType;
}

export interface CandidateAssessment {
  candidate_name: string;
  candidate_email: string;
  role_name: string;
  status: AssessmentStatus;
  duration_minutes: number | null;
  question_count: number;
  started_at: string | null;
  submitted_at: string | null;
  instructions: string[];
  resume_required: boolean;
  resume: CandidateResume | null;
  max_resume_mb: number;
  resume_confirmed_at: string | null;
  interest_response: InterestResponse;
  interest_responded_at: string | null;
  expires_at: string | null;
  seconds_remaining: number | null;
  other_roles: Role[];
}

export interface CandidateQuestions {
  candidate_name: string;
  role_name: string;
  status: AssessmentStatus;
  duration_minutes: number | null;
  started_at: string | null;
  expires_at: string | null;
  seconds_remaining: number | null;
  questions: CandidateQuestion[];
}

export interface SubmitResult {
  status: AssessmentStatus;
  submitted_at: string;
  message: string;
  answered_count: number;
  total_questions: number;
  auto_submitted: boolean;
}

/* ------------------------------ results ------------------------------ */

export interface ResultOption {
  id: number;
  option_text: string;
  option_order: number;
  is_correct: boolean;
  is_selected: boolean;
}

export interface ResultQuestion {
  question_id: number;
  question_order: number;
  question_type: QuestionType;
  question_text: string;
  instructions: string | null;
  max_marks: number;
  evaluation_criteria: string | null;
  options: ResultOption[];
  selected_option_id: number | null;
  correct_option_id: number | null;
  is_correct: boolean | null;
  marks_obtained: number | null;
  subjective_answer: string | null;
  awarded_marks: number | null;
  evaluator_feedback: string | null;
  evaluated_at: string | null;
  evaluation_status: string;
}

export interface AssessmentResult {
  assessment_id: number;
  applied_role_name: string | null;
  test_role_name: string | null;
  interviewer_1: string | null;
  interviewer_2: string | null;
  duration_minutes: number | null;
  auto_submitted: boolean;
  answered_count: number;
  candidate_name: string;
  candidate_email: string;
  role_name: string;
  status: AssessmentStatus;
  question_paper_title: string;
  question_paper_version: number;
  created_at: string;
  started_at: string | null;
  submitted_at: string | null;
  objective_score: number;
  objective_max: number;
  subjective_awarded: number;
  subjective_max: number;
  subjective_evaluated_count: number;
  subjective_total_count: number;
  final_score: number | null;
  percentage: number | null;
  evaluation_status: EvaluationStatus;
  questions: ResultQuestion[];
}

/* ------------------------------ resumes ------------------------------ */

export interface ResumeRow {
  id: number;
  assessment_id: number;
  candidate_name: string;
  candidate_email: string;
  role_id: number;
  role_name: string;
  original_filename: string;
  content_type: string;
  file_size: number;
  version: number;
  is_current: boolean;
  is_locked: boolean;
  resume_status: ResumeStatus;
  uploaded_at: string;
  reviewed_at: string | null;
  uploaded_by_type: UploadedByType;
  assessment_status: AssessmentStatus;
  assessment_submitted_at: string | null;
  candidate_confirmed_at: string | null;
  interest_response: InterestResponse;
  interest_responded_at: string | null;
  storage_backend: string;
}

export interface ResumeList {
  items: ResumeRow[];
  total: number;
  page: number;
  page_size: number;
  new_count: number;
}

export interface ResumeDetail extends ResumeRow {
  assessment_created_at: string;
  assessment_started_at: string | null;
  question_paper_version: number;
  assessment_url: string | null;
  objective_score: number | null;
  evaluation_status: EvaluationStatus;
  history: CandidateResume[];
}

export interface ResumePreview {
  resume_id: number;
  original_filename: string;
  content_type: string;
  file_size: number;
  kind: 'pdf' | 'text' | 'unsupported';
  text: string | null;
}
