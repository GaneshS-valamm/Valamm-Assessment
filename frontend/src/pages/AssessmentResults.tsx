import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, formatDateTime } from '../services/api';
import type { AssessmentResult, AssessmentRow, ResultQuestion, ResumeRow } from '../types';
import { Alert, InterestBadge, Spinner, StatusBadge } from '../components/ui';

export default function AssessmentResults() {
  const { assessmentId } = useParams();
  const id = Number(assessmentId);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [row, setRow] = useState<AssessmentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resume, setResume] = useState<ResumeRow | null>(null);

  useEffect(() => {
    Promise.all([adminApi.results(id), adminApi.assessment(id)])
      .then(([res, r]) => {
        setResult(res);
        setRow(r);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load responses.'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!result) return;
    adminApi
      .resumes({ search: result.candidate_email, page_size: 50 })
      .then((list) => setResume(list.items.find((r) => r.assessment_id === id) ?? null))
      .catch(() => undefined);
  }, [id, result]);

  if (loading) return <Spinner label="Loading candidate responses…" />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!result) return null;

  const unanswered = result.questions.length - result.answered_count;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/admin/candidates" className="text-sm font-semibold text-brand-600 hover:underline">
            ← Back to candidates
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{result.candidate_name}</h1>
          <p className="text-sm text-slate-500">{result.candidate_email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={result.status} />
          {row && <InterestBadge response={row.interest_response} />}
          {result.auto_submitted && (
            <span className="badge bg-amber-100 text-amber-800">Closed by timer</span>
          )}
        </div>
      </div>

      {/* Candidate + assessment metadata */}
      <div className="card grid gap-x-8 gap-y-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
        <Meta label="Applied Role" value={result.applied_role_name || result.role_name} />
        <Meta
          label="Test Role"
          value={result.test_role_name || result.applied_role_name || result.role_name}
        />
        <Meta label="Interviewer 1" value={result.interviewer_1 || '—'} />
        <Meta label="Interviewer 2" value={result.interviewer_2 || '—'} />
        <Meta label="Assessment ID" value={`#${result.assessment_id}`} />
        <Meta
          label="Screening Form"
          value={`${result.question_paper_title} (v${result.question_paper_version})`}
        />
        <Meta label="Link Created" value={formatDateTime(result.created_at)} />
        <Meta label="Started" value={formatDateTime(result.started_at)} />
        <Meta label="Submitted" value={formatDateTime(result.submitted_at)} />
        <Meta
          label="Time Limit"
          value={result.duration_minutes ? `${result.duration_minutes} minutes` : 'Not timed'}
        />
        <Meta
          label="Questions Answered"
          value={`${result.answered_count} of ${result.questions.length}`}
        />
        <Meta label="Resume" value={resume ? resume.original_filename : 'Not uploaded'} />
      </div>

      {resume && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-slate-600">
            Resume on file: <strong className="text-slate-900">{resume.original_filename}</strong>{' '}
            <span className="text-xs text-slate-500">
              (uploaded {formatDateTime(resume.uploaded_at)})
            </span>
          </p>
          <Link
            to={`/admin/resumes?search=${encodeURIComponent(result.candidate_email)}&open=${resume.id}`}
            className="btn-secondary"
          >
            Open Resume
          </Link>
        </div>
      )}

      {result.auto_submitted && (
        <Alert kind="info">
          The time limit expired before the candidate submitted, so the paper closed automatically.
          Answers saved up to that moment are shown below.
        </Alert>
      )}

      {unanswered > 0 && !result.auto_submitted && (
        <Alert kind="info">
          {unanswered} question{unanswered === 1 ? ' was' : 's were'} left unanswered.
        </Alert>
      )}

      {/* Question-by-question responses */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Questions &amp; Answers ({result.questions.length} questions, in the order presented)
        </h2>
        {result.questions.map((q) => (
          <QuestionBlock key={q.question_id} q={q} assessmentId={result.assessment_id} />
        ))}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function QuestionBlock({ q, assessmentId }: { q: ResultQuestion; assessmentId: number }) {
  const [notes, setNotes] = useState(q.evaluator_feedback ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(q.evaluated_at);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [showCriteria, setShowCriteria] = useState(false);

  const answer = (q.subjective_answer ?? '').trim();

  async function save() {
    setSaving(true);
    setErr('');
    setMsg('');
    try {
      await adminApi.saveReviewNotes(assessmentId, q.question_id, notes);
      setMsg('Notes saved.');
      setSavedAt(new Date().toISOString());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save notes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge bg-slate-900 text-white">Q{q.question_order}</span>
        {answer ? (
          <span className="badge bg-emerald-100 text-emerald-800">Answered</span>
        ) : (
          <span className="badge bg-slate-100 text-slate-600">Not answered</span>
        )}
        {q.evaluation_criteria && (
          <button
            type="button"
            className="badge bg-amber-100 text-amber-800 hover:bg-amber-200"
            onClick={() => setShowCriteria((v) => !v)}
          >
            {showCriteria ? 'Hide what to look for' : 'What to look for'}
          </button>
        )}
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm font-semibold text-slate-900">
        {q.question_text}
      </p>
      {q.instructions && <p className="mt-1.5 text-xs italic text-slate-500">{q.instructions}</p>}

      {showCriteria && q.evaluation_criteria && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="whitespace-pre-wrap text-xs text-amber-900">{q.evaluation_criteria}</p>
        </div>
      )}

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Candidate's answer
        </p>
        <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          {answer ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-800">
              {q.subjective_answer}
            </pre>
          ) : (
            <p className="text-sm italic text-slate-400">No answer submitted.</p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label className="label">Reviewer notes</label>
        <textarea
          className="input min-h-[70px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Your assessment of this answer…"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button onClick={save} className="btn-secondary !px-3 !py-1.5 !text-xs" disabled={saving}>
            {saving ? 'Saving…' : 'Save Notes'}
          </button>
          {savedAt && !msg && (
            <span className="text-xs text-slate-500">Last saved {formatDateTime(savedAt)}</span>
          )}
          {msg && <span className="text-xs font-semibold text-emerald-700">{msg}</span>}
          {err && <span className="text-xs font-semibold text-rose-700">{err}</span>}
        </div>
      </div>
    </div>
  );
}
