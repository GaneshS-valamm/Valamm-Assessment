import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, formatDateTime } from '../services/api';
import type { AssessmentResult, ResultQuestion, ResumeRow } from '../types';
import { Alert, EvaluationBadge, Spinner, StatusBadge } from '../components/ui';

export default function AssessmentResults() {
  const { assessmentId } = useParams();
  const id = Number(assessmentId);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resume, setResume] = useState<ResumeRow | null>(null);

  useEffect(() => {
    adminApi
      .results(id)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load results.'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    // Surface the candidate's resume from the same record.
    if (!result) return;
    adminApi
      .resumes({ search: result.candidate_email, page_size: 50 })
      .then((list) => setResume(list.items.find((r) => r.assessment_id === id) ?? null))
      .catch(() => undefined);
  }, [id, result]);

  if (loading) return <Spinner label="Loading assessment results…" />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!result) return null;

  const totalMax = result.objective_max + result.subjective_max;

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
        <div className="flex items-center gap-2">
          <StatusBadge status={result.status} />
          <EvaluationBadge status={result.evaluation_status} />
        </div>
      </div>

      {/* Candidate + assessment metadata */}
      <div className="card grid gap-x-8 gap-y-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
        <Meta label="Assigned Technical Role" value={result.role_name} />
        <Meta label="Assessment ID" value={`#${result.assessment_id}`} />
        <Meta label="Question Paper" value={`${result.question_paper_title} (v${result.question_paper_version})`} />
        <Meta label="Created" value={formatDateTime(result.created_at)} />
        <Meta label="Started" value={formatDateTime(result.started_at)} />
        <Meta label="Submitted" value={formatDateTime(result.submitted_at)} />
        <Meta
          label="Resume"
          value={resume ? resume.original_filename : 'Not uploaded'}
        />
      </div>

      {resume && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-slate-600">
            Resume on file: <strong className="text-slate-900">{resume.original_filename}</strong>{' '}
            <span className="text-xs text-slate-500">
              (uploaded {formatDateTime(resume.uploaded_at)})
            </span>
          </p>
          <Link to={`/admin/resumes?search=${encodeURIComponent(result.candidate_email)}`} className="btn-secondary">
            View Resume
          </Link>
        </div>
      )}

      {/* Score summary */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ScoreCard
          label="Objective Score"
          value={`${result.objective_score} / ${result.objective_max}`}
          tone="bg-brand-50 text-brand-700"
        />
        <ScoreCard
          label="Subjective Marks Awarded"
          value={`${result.subjective_awarded} / ${result.subjective_max}`}
          sub={`${result.subjective_evaluated_count} of ${result.subjective_total_count} evaluated`}
          tone="bg-violet-50 text-violet-700"
        />
        <ScoreCard
          label="Overall Score"
          value={result.final_score !== null ? `${result.final_score} / ${totalMax}` : 'Pending Evaluation'}
          tone={result.final_score !== null ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}
        />
        <ScoreCard
          label="Percentage"
          value={result.percentage !== null ? `${result.percentage}%` : 'Pending Evaluation'}
          tone={result.percentage !== null ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}
        />
      </div>

      {result.final_score === null && (
        <Alert kind="info">
          The final score and percentage stay <strong>Pending Evaluation</strong> until every
          subjective answer has been marked. The objective score above is final and auto-scored.
        </Alert>
      )}

      {/* Question-by-question */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">
          Responses ({result.questions.length} questions, in the order presented)
        </h2>
        {result.questions.map((q) => (
          <QuestionBlock
            key={q.question_id}
            q={q}
            assessmentId={result.assessment_id}
            onSaved={setResult}
          />
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

function ScoreCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      <span className={`badge mt-3 ${tone}`}>
        {value.includes('Pending') ? 'awaiting evaluation' : 'recorded'}
      </span>
    </div>
  );
}

function QuestionBlock({
  q,
  assessmentId,
  onSaved,
}: {
  q: ResultQuestion;
  assessmentId: number;
  onSaved: (r: AssessmentResult) => void;
}) {
  const [marks, setMarks] = useState(q.awarded_marks !== null ? String(q.awarded_marks) : '');
  const [feedback, setFeedback] = useState(q.evaluator_feedback ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function save() {
    const value = Number(marks);
    if (marks === '' || Number.isNaN(value) || value < 0 || value > q.max_marks) {
      setErr(`Awarded marks must be a number between 0 and ${q.max_marks}.`);
      setMsg('');
      return;
    }
    setSaving(true);
    setErr('');
    setMsg('');
    try {
      const updated = await adminApi.saveEvaluation(assessmentId, q.question_id, value, feedback);
      onSaved(updated);
      setMsg('Evaluation saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save evaluation.');
    } finally {
      setSaving(false);
    }
  }

  const objective = q.question_type === 'OBJECTIVE';

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge bg-slate-900 text-white">Q{q.question_order}</span>
        <span
          className={`badge ${objective ? 'bg-brand-100 text-brand-800' : 'bg-violet-100 text-violet-800'}`}
        >
          {objective ? 'Objective' : 'Subjective'}
        </span>
        <span className="badge bg-slate-100 text-slate-700">Max {q.max_marks} marks</span>
        {objective ? (
          q.is_correct === null ? (
            <span className="badge bg-slate-100 text-slate-600">Not answered</span>
          ) : q.is_correct ? (
            <span className="badge bg-emerald-100 text-emerald-800">Correct · {q.marks_obtained}</span>
          ) : (
            <span className="badge bg-rose-100 text-rose-800">Incorrect · {q.marks_obtained ?? 0}</span>
          )
        ) : q.awarded_marks !== null ? (
          <span className="badge bg-emerald-100 text-emerald-800">
            Evaluated · {q.awarded_marks}/{q.max_marks}
          </span>
        ) : (
          <span className="badge bg-amber-100 text-amber-800">Pending Evaluation</span>
        )}
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm font-medium text-slate-900">{q.question_text}</p>
      {q.instructions && <p className="mt-2 text-xs italic text-slate-500">{q.instructions}</p>}

      {objective ? (
        <ul className="mt-4 space-y-1.5">
          {q.options.map((o) => {
            const base = 'rounded-lg border px-3 py-2 text-sm flex flex-wrap items-center gap-2';
            const style = o.is_correct
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : o.is_selected
                ? 'border-rose-300 bg-rose-50 text-rose-900'
                : 'border-slate-200 text-slate-700';
            return (
              <li key={o.id} className={`${base} ${style}`}>
                <span className="font-medium">
                  {String.fromCharCode(64 + o.option_order)}. {o.option_text}
                </span>
                {o.is_selected && (
                  <span className="badge bg-slate-900 text-white">candidate's answer</span>
                )}
                {o.is_correct && (
                  <span className="badge bg-emerald-600 text-white">correct answer</span>
                )}
              </li>
            );
          })}
          {q.selected_option_id === null && (
            <li className="text-xs text-slate-500">The candidate did not answer this question.</li>
          )}
        </ul>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Candidate's answer
            </p>
            <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              {q.subjective_answer && q.subjective_answer.trim() ? (
                <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-800">
                  {q.subjective_answer}
                </pre>
              ) : (
                <p className="text-sm italic text-slate-400">No answer submitted.</p>
              )}
            </div>
          </div>

          {q.evaluation_criteria && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Evaluation criteria
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-xs text-amber-900">
                {q.evaluation_criteria}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-4">
            <p className="text-sm font-semibold text-slate-900">Evaluation</p>
            {q.evaluated_at && (
              <p className="mt-1 text-xs text-slate-500">
                Last evaluated {formatDateTime(q.evaluated_at)}
              </p>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <div>
                <label className="label">Marks awarded (0–{q.max_marks})</label>
                <input
                  type="number"
                  min={0}
                  max={q.max_marks}
                  step="0.5"
                  className="input"
                  value={marks}
                  onChange={(e) => setMarks(e.target.value)}
                />
              </div>
              <div className="sm:col-span-3">
                <label className="label">Evaluator feedback</label>
                <textarea
                  className="input min-h-[80px]"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Notes on structure, depth, accuracy, job readiness…"
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button onClick={save} className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save Evaluation'}
              </button>
              {msg && <span className="text-sm font-medium text-emerald-700">{msg}</span>}
              {err && <span className="text-sm font-medium text-rose-700">{err}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
