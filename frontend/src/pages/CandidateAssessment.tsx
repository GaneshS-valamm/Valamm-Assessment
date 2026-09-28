import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, candidateApi, formatFileSize } from '../services/api';
import type {
  CandidateAssessment as CandidateMeta,
  CandidateQuestion,
  CandidateResume,
  InterestResponse,
  ResumePreview,
  Role,
} from '../types';
import { Alert, Modal, Spinner } from '../components/ui';

// Wording about picking a role is handled by the role step itself, and the candidate UI
// must not mention a question count or a time limit.
const HIDDEN_INSTRUCTIONS = [
  'Let us know whether you would like to go ahead with this role.',
  'Use Previous / Next or the question panel to move between questions.',
];

type Phase = 'loading' | 'welcome' | 'exam' | 'submitted' | 'declined' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'retrying' | 'failed';

const DEBOUNCE_MS = 900;

export default function CandidateAssessment() {
  const { token = '' } = useParams();
  const [phase, setPhase] = useState<Phase>('loading');
  const [meta, setMeta] = useState<CandidateMeta | null>(null);
  const [questions, setQuestions] = useState<CandidateQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [confirming, setConfirming] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  // 'role' = declined the applied role, choosing among the others.
  const [interestStep, setInterestStep] = useState<'ask' | 'role'>('ask');

  /* ----------------------------- bootstrap ----------------------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await candidateApi.get(token);
        if (!alive) return;
        setMeta(m);
        if (m.status === 'SUBMITTED') {
          setPhase('submitted');
        } else if (m.interest_response === 'NOT_INTERESTED') {
          setPhase('declined');
        } else if (m.status === 'IN_PROGRESS') {
          // Resume: an already-started assessment goes straight back to the paper.
          const q = await candidateApi.questions(token);
          if (!alive) return;
          setQuestions(q.questions);
          applyDeadline(q.seconds_remaining);
          setPhase('exam');
        } else {
          setPhase('welcome');
        }
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'This link is not valid.');
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  async function start() {
    setError('');
    try {
      const m = await candidateApi.start(token);
      setMeta(m);
      const q = await candidateApi.questions(token);
      setQuestions(q.questions);
      applyDeadline(q.seconds_remaining);
      setIndex(0);
      setPhase('exam');
    } catch (err) {
      // A missing resume is recoverable - keep the candidate on the welcome page.
      setError(err instanceof Error ? err.message : 'Could not open the questions.');
    }
  }

  async function confirmResume() {
    setError('');
    try {
      await candidateApi.confirmResume(token);
      const m = await candidateApi.get(token);
      setMeta(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm your resume.');
    }
  }

  async function answerInterest(interested: boolean) {
    setError('');
    // Declining the applied role offers the other roles before closing anything.
    if (!interested) {
      setInterestStep('role');
      return;
    }
    try {
      const m = await candidateApi.declareInterest(token, true);
      setMeta(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your response.');
    }
  }

  async function chooseOtherRole(roleId: number) {
    setError('');
    try {
      const m = await candidateApi.chooseRole(token, roleId);
      setMeta(m);
      setInterestStep('ask');
      const q = await candidateApi.questions(token);
      setQuestions(q.questions);
      applyDeadline(q.seconds_remaining);
      setIndex(0);
      setPhase('exam');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch to that role.');
    }
  }

  async function declineAllRoles() {
    setError('');
    try {
      await candidateApi.declareInterest(token, false);
    } catch {
      /* the screen below is the response either way */
    }
    setPhase('declined');
  }

  /* ------------------------------ countdown ---------------------------- */

  // The server is the authority on time; it sends the seconds left and closes the paper
  // itself if the deadline passes. This turns that into a local ticking clock.
  function applyDeadline(secondsLeft: number | null | undefined) {
    if (secondsLeft === null || secondsLeft === undefined) {
      setDeadline(null);
      setRemaining(null);
      return;
    }
    setDeadline(Date.now() + secondsLeft * 1000);
    setRemaining(secondsLeft);
  }

  useEffect(() => {
    if (deadline === null || phase !== 'exam') return;
    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setTimeUp(true);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline, phase]);

  // When the clock hits zero the paper closes itself - no further answers are accepted.
  useEffect(() => {
    if (!timeUp || phase !== 'exam') return;
    void (async () => {
      Object.values(timers.current).forEach(clearTimeout);
      try {
        const res = await candidateApi.submit(token);
        setSubmitMsg(res.message);
      } catch {
        setSubmitMsg(
          'Your time has run out, so your answers have been sent to us as they were. Thank you for your time.',
        );
      }
      setConfirming(false);
      setMeta((m) => (m ? { ...m, status: 'SUBMITTED' } : m));
      setPhase('submitted');
    })();
  }, [timeUp, phase, token]);

  /* -------------------------- backend autosave ------------------------- */
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const persist = useCallback(
    async (
      questionId: number,
      payload: { selected_option_id?: number | null; subjective_answer?: string | null },
      attempt = 1,
    ) => {
      setSaveState(attempt === 1 ? 'saving' : 'retrying');
      try {
        await candidateApi.saveAnswer(token, questionId, payload);
        setSaveState('saved');
      } catch (err) {
        // The server closed the paper because time ran out - stop retrying.
        if (err instanceof ApiError && err.status === 410) {
          setTimeUp(true);
          return;
        }
        // Retry transient failures (network drop) with a short backoff.
        if (attempt < 4) {
          setTimeout(() => void persist(questionId, payload, attempt + 1), attempt * 1200);
          setSaveState('retrying');
        } else {
          setSaveState('failed');
        }
      }
    },
    [token],
  );

  function selectOption(questionId: number, optionId: number) {
    setQuestions((prev) =>
      prev.map((q) => (q.id === questionId ? { ...q, selected_option_id: optionId } : q)),
    );
    void persist(questionId, { selected_option_id: optionId });
  }

  function typeAnswer(questionId: number, text: string) {
    setQuestions((prev) =>
      prev.map((q) => (q.id === questionId ? { ...q, subjective_answer: text } : q)),
    );
    clearTimeout(timers.current[questionId]);
    setSaveState('saving');
    timers.current[questionId] = setTimeout(
      () => void persist(questionId, { subjective_answer: text }),
      DEBOUNCE_MS,
    );
  }

  // Flush any pending debounce before the tab closes.
  useEffect(() => {
    const flush = () => {
      Object.values(timers.current).forEach(clearTimeout);
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  const answered = useMemo(
    () =>
      questions.filter(
        (q) =>
          q.selected_option_id !== null ||
          (q.subjective_answer !== null && q.subjective_answer.trim().length > 0),
      ).length,
    [questions],
  );

  async function submit() {
    setSubmitting(true);
    try {
      Object.values(timers.current).forEach(clearTimeout);
      // Make sure the last keystrokes are persisted before the paper is closed.
      const current = questions[index];
      if (current?.question_type === 'SUBJECTIVE') {
        await candidateApi.saveAnswer(token, current.id, {
          subjective_answer: current.subjective_answer ?? '',
        });
      }
      const res = await candidateApi.submit(token);
      setSubmitMsg(res.message);
      setConfirming(false);
      setPhase('submitted');
      setMeta((m) => (m ? { ...m, status: 'SUBMITTED', submitted_at: res.submitted_at } : m));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your answers.');
      setConfirming(false);
      if (err instanceof Error && err.message.includes('already been submitted')) {
        setPhase('submitted');
      }
    } finally {
      setSubmitting(false);
    }
  }

  /* ------------------------------- render ------------------------------ */

  if (phase === 'loading') return <Shell><Spinner label="Checking your link…" /></Shell>;

  if (phase === 'error')
    return (
      <Shell>
        <div className="card mx-auto max-w-lg p-8 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-rose-100 text-xl text-rose-600">
            !
          </div>
          <h1 className="text-xl font-bold text-slate-900">This link is unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <p className="mt-4 text-xs text-slate-500">
            Please contact the recruitment team for a new link.
          </p>
        </div>
      </Shell>
    );

  if (phase === 'declined')
    return (
      <Shell>
        <div className="card mx-auto max-w-xl p-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-2xl text-slate-500">
            &#10003;
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Thank you for your response</h1>
          <p className="mt-3 text-slate-600">
            We have noted that you would prefer not to go ahead at the moment. There is nothing
            further for you to do.
          </p>
          <p className="mt-4 text-sm text-slate-500">
            We appreciate you taking the time to let us know, {meta?.candidate_name}.
          </p>
          <dl className="mt-6 space-y-2 border-t border-slate-200 pt-6 text-left text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Role</dt>
              <dd className="text-right font-medium text-slate-900">{meta?.role_name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Your response</dt>
              <dd className="font-medium text-slate-900">Not at this time</dd>
            </div>
            {meta?.interest_responded_at && (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Recorded at</dt>
                <dd className="font-medium text-slate-900">
                  {new Date(meta.interest_responded_at).toLocaleString()}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </Shell>
    );

  if (phase === 'submitted')
    return (
      <Shell>
        <div className="card mx-auto max-w-xl p-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
            ✓
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {timeUp ? 'Time Is Up' : 'Thank You'}
          </h1>
          <p className="mt-3 text-slate-600">
            {submitMsg || 'Thank you - your answers have been sent to our recruitment team.'}
          </p>
          <dl className="mt-6 space-y-2 border-t border-slate-200 pt-6 text-left text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Candidate</dt>
              <dd className="font-medium text-slate-900">{meta?.candidate_name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Role</dt>
              <dd className="text-right font-medium text-slate-900">{meta?.role_name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Status</dt>
              <dd className="font-medium text-emerald-700">Submitted</dd>
            </div>
            {meta?.submitted_at && (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Sent at</dt>
                <dd className="font-medium text-slate-900">
                  {new Date(meta.submitted_at).toLocaleString()}
                </dd>
              </div>
            )}
            {meta?.resume && (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Resume on file</dt>
                <dd className="text-right font-medium text-slate-900">
                  {meta.resume.original_filename}
                  <span className="ml-2 text-xs font-normal text-slate-500">locked</span>
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-6 text-xs text-slate-500">
            Your answers are now with our recruitment team. This link can no longer be used to
            change them.
          </p>
        </div>
      </Shell>
    );

  if (phase === 'welcome' && meta)
    return (
      <Shell>
        <div className="card mx-auto max-w-2xl p-8">
          <h1 className="text-2xl font-bold text-slate-900">Hi, {meta.candidate_name}!</h1>
          <p className="mt-2 text-slate-600">
            Thanks for your interest in joining us. Below are a few questions from our recruitment
            team - please read the note before you begin.
          </p>

          <ResumeReview
            token={token}
            resume={meta.resume}
            confirmed={meta.resume_confirmed_at !== null}
            maxMb={meta.max_resume_mb}
            onUploaded={(r) => {
              setMeta((m) =>
                m ? { ...m, resume: r, resume_confirmed_at: new Date().toISOString() } : m,
              );
              setError('');
            }}
            onConfirm={confirmResume}
          />

          <InterestGate
            roleName={meta.role_name}
            enabled={meta.resume_confirmed_at !== null}
            response={meta.interest_response}
            step={interestStep}
            otherRoles={meta.other_roles}
            onAnswer={answerInterest}
            onChooseRole={chooseOtherRole}
            onDeclineAll={declineAllRoles}
          />

          <div className="mt-6 rounded-xl border-2 border-brand-300 bg-brand-50 p-5">
            <h2 className="text-base font-bold text-brand-900">Before you start</h2>
            <ul className="mt-3 space-y-2.5 text-sm font-medium leading-relaxed text-brand-900">
              {meta.instructions
                .filter((line) => !HIDDEN_INSTRUCTIONS.includes(line))
                .map((line) => (
                  <li key={line} className="flex gap-2">
                    <span className="mt-0.5 font-bold text-brand-600">•</span>
                    <span>{line}</span>
                  </li>
                ))}
            </ul>
          </div>

          {error && (
            <div className="mt-6">
              <Alert kind="error">{error}</Alert>
            </div>
          )}

          <button
            onClick={start}
            className="btn-primary mt-8 w-full sm:w-auto"
            disabled={meta.interest_response !== 'INTERESTED'}
          >
            Start
          </button>
          {meta.interest_response !== 'INTERESTED' && (
            <p className="mt-2 text-xs text-slate-500">
              {meta.resume_confirmed_at === null
                ? 'Review the resume above first, then let us know about the role.'
                : 'Let us know about the role to begin.'}
            </p>
          )}
        </div>
      </Shell>
    );

  /* ------------------------------ the exam ----------------------------- */
  const q = questions[index];
  if (!q) return <Shell><Spinner /></Shell>;

  return (
    <Shell>
      <div className="mx-auto max-w-5xl">
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">{meta?.candidate_name}</p>
            <p className="text-xs text-slate-500">{meta?.role_name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <SaveIndicator state={saveState} />
            <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
              {answered} / {questions.length} answered
            </span>
            {remaining !== null && <Countdown seconds={remaining} />}
          </div>
        </div>

        {error && (
          <div className="mb-4">
            <Alert kind="error">{error}</Alert>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-4">
          {/* Question navigation panel */}
          <div className="card order-2 p-4 lg:order-1">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Questions
            </p>
            <div className="grid grid-cols-8 gap-2 lg:grid-cols-4">
              {questions.map((item, i) => {
                const done =
                  item.selected_option_id !== null ||
                  (item.subjective_answer !== null && item.subjective_answer.trim().length > 0);
                return (
                  <button
                    key={item.id}
                    onClick={() => setIndex(i)}
                    className={`grid h-9 place-items-center rounded-lg border text-sm font-semibold transition ${
                      i === index
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : done
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                    title={`Question ${item.question_order}`}
                  >
                    {item.question_order}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 space-y-1.5 border-t border-slate-200 pt-4 text-xs text-slate-500">
              <p>
                <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" />
                Answered ({answered})
              </p>
              <p>
                <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-slate-300" />
                Unanswered ({questions.length - answered})
              </p>
            </div>
            <button
              onClick={() => setConfirming(true)}
              className="btn-primary mt-4 w-full !bg-emerald-600 hover:!bg-emerald-700"
            >
              Send My Answers
            </button>
          </div>

          {/* Question body */}
          <div className="order-1 lg:order-2 lg:col-span-3">
            <div className="card p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge bg-slate-900 text-white">
                  Question {index + 1} of {questions.length}
                </span>
                <span
                  className={`badge ${
                    q.question_type === 'OBJECTIVE'
                      ? 'bg-brand-100 text-brand-800'
                      : 'bg-violet-100 text-violet-800'
                  }`}
                >
                  In your own words
                </span>
              </div>

              <p className="mt-4 whitespace-pre-wrap text-base font-medium leading-relaxed text-slate-900">
                {q.question_text}
              </p>
              {q.instructions && (
                <p className="mt-2 text-sm italic text-slate-500">{q.instructions}</p>
              )}

              {q.question_type === 'OBJECTIVE' ? (
                <div className="mt-6 space-y-2.5">
                  {q.options.map((o) => {
                    const selected = q.selected_option_id === o.id;
                    return (
                      <label
                        key={o.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-sm transition ${
                          selected
                            ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`q-${q.id}`}
                          className="mt-0.5 h-4 w-4 accent-brand-600"
                          checked={selected}
                          onChange={() => selectOption(q.id, o.id)}
                        />
                        <span className="text-slate-800">
                          <strong className="mr-1.5">
                            {String.fromCharCode(64 + o.option_order)}.
                          </strong>
                          {o.option_text}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-6">
                  <label className="label" htmlFor={`ta-${q.id}`}>
                    Your answer
                  </label>
                  <textarea
                    id={`ta-${q.id}`}
                    className="input min-h-[280px] font-mono text-sm leading-relaxed"
                    value={q.subjective_answer ?? ''}
                    onChange={(e) => typeAnswer(q.id, e.target.value)}
                    placeholder="Type your detailed answer here. Line breaks, lists and code snippets are preserved."
                    spellCheck
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    {(q.subjective_answer ?? '').trim()
                      ? `${(q.subjective_answer ?? '').trim().split(/\s+/).length} words`
                      : 'Not answered yet'}{' '}
                    · saved automatically
                  </p>
                </div>
              )}

              <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-200 pt-6">
                <button
                  className="btn-secondary"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={index === 0}
                >
                  ← Previous
                </button>
                {index < questions.length - 1 ? (
                  <button className="btn-primary" onClick={() => setIndex((i) => i + 1)}>
                    Next →
                  </button>
                ) : (
                  <button
                    className="btn-primary !bg-emerald-600 hover:!bg-emerald-700"
                    onClick={() => setConfirming(true)}
                  >
                    Review &amp; Send
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {confirming && (
        <Modal
          title="Send your answers?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setConfirming(false)} disabled={submitting}>
                Keep writing
              </button>
              <button
                className="btn-primary !bg-emerald-600 hover:!bg-emerald-700"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? 'Sending…' : 'Yes, send my answers'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-emerald-50 p-3 text-center">
                <p className="text-2xl font-bold text-emerald-700">{answered}</p>
                <p className="text-xs text-emerald-800">Answered</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-3 text-center">
                <p className="text-2xl font-bold text-amber-700">{questions.length - answered}</p>
                <p className="text-xs text-amber-800">Unanswered</p>
              </div>
            </div>
            {answered < questions.length && (
              <Alert kind="info">
                You still have {questions.length - answered} unanswered question
                {questions.length - answered === 1 ? '' : 's'}. You can go back and complete them.
              </Alert>
            )}
            <p>
              This is <strong>final</strong>. Once sent, you will not be able to change your
              answers or reopen this link.
            </p>
          </div>
        </Modal>
      )}
    </Shell>
  );
}

function Countdown({ seconds }: { seconds: number }) {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  const urgent = seconds <= 300; // last five minutes
  const critical = seconds <= 60;
  return (
    <span
      className={`rounded-full px-3 py-1 font-bold tabular-nums ${
        critical
          ? 'animate-pulse bg-rose-600 text-white'
          : urgent
            ? 'bg-amber-100 text-amber-900'
            : 'bg-slate-900 text-white'
      }`}
      title="Time remaining"
    >
      {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')} left
    </span>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 font-bold text-white">
            RA
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-900">Valamm.AI Recruitment</p>
            <p className="text-xs text-slate-500">A few questions from our team</p>
          </div>
        </div>
      </header>
      <div className="p-4 sm:p-6 lg:p-8">{children}</div>
    </div>
  );
}

function ResumeReview({
  token,
  resume,
  confirmed,
  maxMb,
  onUploaded,
  onConfirm,
}: {
  token: string;
  resume: CandidateResume | null;
  confirmed: boolean;
  maxMb: number;
  onUploaded: (r: CandidateResume) => void;
  onConfirm: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState('');
  const [textPreview, setTextPreview] = useState<ResumePreview | null>(null);

  const isPdf = resume?.content_type === 'application/pdf';

  // Load the resume through the token-scoped endpoint so the candidate can actually read it.
  useEffect(() => {
    if (!resume) {
      setPreviewUrl(null);
      setTextPreview(null);
      return;
    }
    let url: string | null = null;
    let alive = true;
    setPreviewErr('');

    if (isPdf) {
      candidateApi
        .resumeBlobUrl(token, 'inline')
        .then((u) => {
          url = u;
          if (alive) setPreviewUrl(u);
          else URL.revokeObjectURL(u);
        })
        .catch((e) =>
          alive && setPreviewErr(e instanceof Error ? e.message : 'Preview unavailable.'),
        );
    } else {
      // Word files are rendered as text by the backend so they can be read here.
      candidateApi
        .resumePreview(token)
        .then((pv) => alive && setTextPreview(pv))
        .catch((e) =>
          alive && setPreviewErr(e instanceof Error ? e.message : 'Preview unavailable.'),
        );
    }

    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [token, resume?.id, isPdf]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setErr('');
    setBusy(true);
    try {
      onUploaded(await candidateApi.uploadResume(token, file));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function download() {
    setErr('');
    try {
      const url = await candidateApi.resumeBlobUrl(token, 'attachment');
      const a = document.createElement('a');
      a.href = url;
      a.download = resume?.original_filename ?? 'resume';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Download failed.');
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Step 1 &middot; Review your resume
        </h2>
        {confirmed ? (
          <span className="badge bg-emerald-100 text-emerald-800">Reviewed</span>
        ) : (
          <span className="badge bg-amber-100 text-amber-800">Action needed</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />

      {!resume ? (
        <>
          <p className="mt-1.5 text-sm text-slate-600">
            Our recruitment team has not attached a resume for you yet. You can upload one here
            (PDF or DOCX, up to {maxMb} MB), or contact the team if you were expecting to see one.
          </p>
          <button
            type="button"
            className="btn-primary mt-4"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? 'Uploading\u2026' : 'Upload Resume'}
          </button>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-slate-600">
            This is the resume our recruitment team has on file for you. Please check that it is
            correct and up to date. If it is not, upload a new version &mdash; up to {maxMb} MB,
            PDF or DOCX.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white">
              {isPdf ? 'PDF' : 'DOC'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">
                {resume.original_filename}
              </p>
              <p className="text-xs text-slate-500">
                {formatFileSize(resume.file_size)} &middot;{' '}
                {resume.uploaded_by_type === 'ADMIN'
                  ? 'provided by our recruitment team'
                  : 'uploaded by you'}{' '}
                &middot; {new Date(resume.uploaded_at).toLocaleString()}
                {resume.version > 1 ? ' \u00b7 version ' + resume.version : ''}
              </p>
            </div>
          </div>

          {isPdf ? (
            previewErr ? (
              <div className="mt-3">
                <Alert kind="error">{previewErr}</Alert>
              </div>
            ) : previewUrl ? (
              <object
                data={previewUrl}
                type="application/pdf"
                className="mt-3 h-[420px] w-full rounded-lg border border-slate-200"
              >
                <p className="p-4 text-sm text-slate-600">
                  Your browser cannot display PDFs inline &mdash; use Download to open it.
                </p>
              </object>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Loading preview\u2026</p>
            )
          ) : textPreview === null ? (
            <p className="mt-3 text-sm text-slate-500">Opening your resume&hellip;</p>
          ) : textPreview.kind === 'text' && textPreview.text ? (
            <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-slate-200 bg-white p-4">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-800">
                {textPreview.text}
              </pre>
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              This file could not be shown here. Use <strong>Download</strong> to open it and check
              the contents.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary" onClick={download}>
              &#11015; Download
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => inputRef.current?.click()}
              disabled={busy || resume.is_locked}
            >
              {busy ? 'Uploading\u2026' : 'Upload a New Version'}
            </button>
            {!confirmed && (
              <button type="button" className="btn-primary" onClick={confirm} disabled={busy}>
                This resume is correct
              </button>
            )}
            {confirmed && (
              <span className="text-sm font-semibold text-emerald-700">
                &#10003; Thank you &mdash; resume reviewed
              </span>
            )}
          </div>
          {confirmed && !resume.is_locked && (
            <p className="mt-2 text-xs text-slate-500">
              You can still upload a newer version until you send your answers.
            </p>
          )}
        </>
      )}

      {err && (
        <div className="mt-3">
          <Alert kind="error">{err}</Alert>
        </div>
      )}
    </div>
  );
}

function InterestGate({
  roleName,
  enabled,
  response,
  step,
  otherRoles,
  onAnswer,
  onChooseRole,
  onDeclineAll,
}: {
  roleName: string;
  enabled: boolean;
  response: InterestResponse;
  step: 'ask' | 'role';
  otherRoles: Role[];
  onAnswer: (interested: boolean) => Promise<void>;
  onChooseRole: (roleId: number) => Promise<void>;
  onDeclineAll: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`mt-4 rounded-xl border p-5 ${
        enabled ? 'border-slate-200' : 'border-slate-200 bg-slate-50 opacity-60'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Step 2 &middot; The role</h2>
        {response === 'INTERESTED' ? (
          <span className="badge bg-emerald-100 text-emerald-800">Ready to begin</span>
        ) : (
          <span className="badge bg-amber-100 text-amber-800">Action needed</span>
        )}
      </div>

      {!enabled ? (
        <p className="mt-3 text-xs text-slate-500">Please review your resume above first.</p>
      ) : response === 'INTERESTED' ? (
        <p className="mt-3 text-sm font-semibold text-emerald-700">
          &#10003; Thank you &mdash; you can begin below.
        </p>
      ) : step === 'ask' ? (
        <>
          <p className="mt-1.5 text-sm text-slate-600">
            Would you like to go ahead with the{' '}
            <strong className="text-slate-900">{roleName}</strong> role?
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-primary !bg-emerald-600 hover:!bg-emerald-700"
              onClick={() => void run(() => onAnswer(true))}
              disabled={busy}
            >
              Yes, I am interested
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void run(() => onAnswer(false))}
              disabled={busy}
            >
              No, not this time
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">
            Are you interested in other roles?
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Pick one and we will show you the questions for it instead.
          </p>

          <div className="mt-4 space-y-2.5">
            {otherRoles.map((r) => (
              <label
                key={r.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-sm transition ${
                  picked === r.id
                    ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="other-role"
                  className="mt-0.5 h-4 w-4 accent-brand-600"
                  checked={picked === r.id}
                  onChange={() => setPicked(r.id)}
                  disabled={busy}
                />
                <span>
                  <span className="font-medium text-slate-900">{r.role_name}</span>
                  {r.description && (
                    <span className="mt-0.5 block text-xs text-slate-500">{r.description}</span>
                  )}
                </span>
              </label>
            ))}
            {otherRoles.length === 0 && (
              <p className="text-sm text-slate-500">There are no other open roles right now.</p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-primary"
              onClick={() => picked !== null && void run(() => onChooseRole(picked))}
              disabled={busy || picked === null}
            >
              {busy ? 'Opening\u2026' : 'Continue with this role'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void run(onDeclineAll)}
              disabled={busy}
            >
              No, none of these
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, [string, string]> = {
    idle: ['text-slate-400', 'Autosave ready'],
    saving: ['text-brand-600', 'Saving…'],
    saved: ['text-emerald-600', '✓ All answers saved'],
    retrying: ['text-amber-600', 'Connection issue — retrying…'],
    failed: ['text-rose-600', '⚠ Save failed — check your connection'],
  };
  const [cls, label] = map[state];
  return <span className={`font-semibold ${cls}`}>{label}</span>;
}
