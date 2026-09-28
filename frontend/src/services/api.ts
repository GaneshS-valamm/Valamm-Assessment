import type {
  AssessmentList,
  CandidateResume,
  ResumeDetail,
  ResumeList,
  ResumePreview,
  ResumeRow,
  ResumeStatus,
  AssessmentResult,
  AssessmentRow,
  CandidateAssessment,
  CandidateQuestions,
  DashboardStats,
  GeneratedAssessment,
  PaperDetail,
  PaperSummary,
  Role,
  SubmitResult,
} from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const TOKEN_KEY = 'ra_admin_token';

export const auth = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
  },
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Pull a human-readable message out of a FastAPI error body. */
async function errorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail) && body.detail[0]?.msg) return body.detail[0].msg;
  } catch {
    /* non-JSON error body */
  }
  return `${fallback} (${res.status})`;
}

async function request<T>(path: string, init: RequestInit = {}, withAuth = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (withAuth) {
    const t = auth.token;
    if (t) headers.set('Authorization', `Bearer ${t}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401 && withAuth) {
    auth.clear();
    if (!location.pathname.startsWith('/login')) location.assign('/login');
    throw new ApiError(401, 'Session expired. Please log in again.');
  }

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') detail = body.detail;
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) detail = body.detail[0].msg;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const authed = <T,>(path: string, init?: RequestInit) => request<T>(path, init, true);

/* ------------------------------- admin ------------------------------- */

export const adminApi = {
  login: (user_id: string, password: string) =>
    request<{ access_token: string; expires_in: number; user_id: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ user_id, password }),
    }),
  me: () => authed<{ id: number; user_id: string; is_active: boolean }>('/api/auth/me'),
  logout: () => authed<{ message: string }>('/api/auth/logout', { method: 'POST' }),

  roles: () => request<Role[]>('/api/roles'),
  stats: () => authed<DashboardStats>('/api/admin/stats'),

  papers: () => authed<PaperSummary[]>('/api/admin/question-papers'),
  paper: (id: number) => authed<PaperDetail>(`/api/admin/question-papers/${id}`),

  createAssessment: (payload: {
    candidate_name: string;
    candidate_email: string;
    role_id: number;
    duration_minutes?: number | null;
  }) =>
    authed<GeneratedAssessment>('/api/admin/assessments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  assessments: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs}` : '';
    return authed<AssessmentList>(`/api/admin/assessments${suffix}`);
  },

  assessment: (id: number) => authed<AssessmentRow>(`/api/admin/assessments/${id}`),
  results: (id: number) => authed<AssessmentResult>(`/api/admin/assessments/${id}/results`),

  resumes: (params: Record<string, string | number | boolean | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs}` : '';
    return authed<ResumeList>(`/api/admin/resumes${suffix}`);
  },

  resume: (id: number) => authed<ResumeDetail>(`/api/admin/resumes/${id}`),

  /** Inline content so the panel can open a resume without downloading it. */
  resumePreview: (id: number) => authed<ResumePreview>(`/api/admin/resumes/${id}/preview`),

  /** Admin attaches the resume they received, so the candidate can review it. */
  uploadResumeForAssessment: async (assessmentId: number, file: File): Promise<ResumeRow> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/api/admin/assessments/${assessmentId}/resume`, {
      method: 'POST',
      headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : undefined,
      body: form,
    });
    if (!res.ok) throw new ApiError(res.status, await errorDetail(res, 'Upload failed'));
    return (await res.json()) as ResumeRow;
  },

  unreviewedResumeCount: () => authed<{ new_count: number }>('/api/admin/resumes/unreviewed-count'),

  setResumeStatus: (id: number, resume_status: ResumeStatus) =>
    authed<ResumeRow>(`/api/admin/resumes/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ resume_status }),
    }),

  /**
   * Resumes are never public URLs - they come back through the authenticated
   * download endpoint and are handed to the browser as a short-lived blob URL.
   */
  resumeBlobUrl: async (id: number, disposition: 'inline' | 'attachment' = 'inline') => {
    const res = await fetch(`${API_BASE}/api/admin/resumes/${id}/download?disposition=${disposition}`, {
      headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : undefined,
    });
    if (!res.ok) {
      let detail = `Could not load the resume (${res.status})`;
      try {
        const body = await res.json();
        if (typeof body.detail === 'string') detail = body.detail;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, detail);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  /** Reviewer notes on one answer. These forms are not scored, so no marks are sent. */
  saveReviewNotes: (assessmentId: number, questionId: number, feedback: string) =>
    authed<AssessmentResult>(`/api/admin/assessments/${assessmentId}/evaluations/${questionId}`, {
      method: 'PUT',
      body: JSON.stringify({ evaluator_feedback: feedback || null }),
    }),
};

/* ----------------------------- candidate ----------------------------- */

export const candidateApi = {
  get: (token: string) => request<CandidateAssessment>(`/api/assessments/${token}`),
  start: (token: string) =>
    request<CandidateAssessment>(`/api/assessments/${token}/start`, { method: 'POST' }),
  questions: (token: string) => request<CandidateQuestions>(`/api/assessments/${token}/questions`),
  saveAnswer: (
    token: string,
    questionId: number,
    payload: { selected_option_id?: number | null; subjective_answer?: string | null },
  ) =>
    request<{ question_id: number; saved_at: string; answered: boolean }>(
      `/api/assessments/${token}/answers/${questionId}`,
      { method: 'PUT', body: JSON.stringify(payload) },
    ),
  submit: (token: string) =>
    request<SubmitResult>(`/api/assessments/${token}/submit`, { method: 'POST' }),

  uploadResume: async (token: string, file: File): Promise<CandidateResume> => {
    const form = new FormData();
    form.append('file', file);
    // No Content-Type header: the browser sets the multipart boundary itself.
    const res = await fetch(`${API_BASE}/api/assessments/${token}/resume`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) throw new ApiError(res.status, await errorDetail(res, 'Upload failed'));
    return (await res.json()) as CandidateResume;
  },

  confirmResume: (token: string) =>
    request<{ message: string }>(`/api/assessments/${token}/resume/confirm`, { method: 'POST' }),

  resumePreview: (token: string) =>
    request<ResumePreview>(`/api/assessments/${token}/resume/preview`),

  declareInterest: (token: string, interested: boolean) =>
    request<CandidateAssessment>(`/api/assessments/${token}/interest`, {
      method: 'POST',
      body: JSON.stringify({ interested }),
    }),

  /** The candidate reads back their own resume through the token-scoped endpoint. */
  resumeBlobUrl: async (token: string, disposition: 'inline' | 'attachment' = 'inline') => {
    const res = await fetch(
      `${API_BASE}/api/assessments/${token}/resume/download?disposition=${disposition}`,
    );
    if (!res.ok) throw new ApiError(res.status, await errorDetail(res, 'Could not load your resume'));
    return URL.createObjectURL(await res.blob());
  },
};

/* ------------------------------ helpers ------------------------------ */

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
