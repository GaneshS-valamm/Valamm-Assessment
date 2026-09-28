import { useEffect, useState } from 'react';
import { adminApi, formatDateTime } from '../services/api';
import type { PaperDetail, PaperSummary } from '../types';
import { Alert, Spinner } from '../components/ui';

export default function QuestionPapers() {
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [selected, setSelected] = useState<PaperDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    adminApi
      .papers()
      .then((p) => {
        setPapers(p);
        if (p.length) void open(p[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load papers.'))
      .finally(() => setLoading(false));
  }, []);

  async function open(id: number) {
    setDetailLoading(true);
    try {
      setSelected(await adminApi.paper(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load paper.');
    } finally {
      setDetailLoading(false);
    }
  }

  if (loading) return <Spinner label="Loading question papers…" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Question Papers</h1>
        <p className="text-sm text-slate-500">
          The four screening forms. Reviewer guidance is stored on the backend and never sent to
          candidates.
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3">
          {papers.map((p) => (
            <button
              key={p.id}
              onClick={() => open(p.id)}
              className={`card w-full p-4 text-left transition hover:border-brand-300 ${
                selected?.id === p.id ? 'border-brand-500 ring-2 ring-brand-500/20' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{p.role_name}</p>
                <span className={`badge ${p.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                  v{p.version}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {p.question_count} questions · created {formatDateTime(p.created_at)}
              </p>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2">
          {detailLoading ? (
            <Spinner label="Loading paper…" />
          ) : !selected ? (
            <div className="card p-6 text-sm text-slate-500">Select a paper to view its questions.</div>
          ) : (
            <div className="space-y-4">
              <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <h2 className="font-semibold text-slate-900">{selected.paper_title}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {selected.role_name} · version {selected.version} ·{' '}
                    {selected.is_active ? 'Active' : 'Archived'} · {selected.questions.length} questions
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={showKeys}
                    onChange={(e) => setShowKeys(e.target.checked)}
                  />
                  Show reviewer guidance
                </label>
              </div>

              {selected.questions.map((q) => (
                <div key={q.id} className="card p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge bg-slate-900 text-white">Q{q.question_order}</span>
                    <span
                      className={`badge ${
                        q.question_type === 'OBJECTIVE'
                          ? 'bg-brand-100 text-brand-800'
                          : 'bg-violet-100 text-violet-800'
                      }`}
                    >
                      {q.question_type === 'OBJECTIVE' ? 'Objective' : 'Subjective'}
                    </span>
                  </div>

                  <p className="mt-3 whitespace-pre-wrap text-sm font-medium text-slate-900">
                    {q.question_text}
                  </p>

                  {q.instructions && (
                    <p className="mt-2 text-xs italic text-slate-500">{q.instructions}</p>
                  )}

                  {q.question_type === 'OBJECTIVE' && (
                    <ul className="mt-3 space-y-1.5">
                      {q.options.map((o) => (
                        <li
                          key={o.id}
                          className={`rounded-lg border px-3 py-2 text-sm ${
                            showKeys && o.is_correct
                              ? 'border-emerald-300 bg-emerald-50 font-medium text-emerald-900'
                              : 'border-slate-200 text-slate-700'
                          }`}
                        >
                          {String.fromCharCode(64 + o.option_order)}. {o.option_text}
                          {showKeys && o.is_correct && (
                            <span className="ml-2 text-xs font-semibold">✓ correct</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {q.question_type === 'SUBJECTIVE' && showKeys && q.evaluation_criteria && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                        What to look for
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap text-xs text-amber-900">
                        {q.evaluation_criteria}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card p-5 text-sm text-slate-600">
        <h3 className="font-semibold text-slate-900">Updating questions</h3>
        <p className="mt-2">
          Each form is seeded from a JSON file in <code className="rounded bg-slate-100 px-1.5 py-0.5">backend/question_bank/</code>, transcribed from the official Valamm.AI screening documents. Edit a file and restart the backend: the paper is updated in place if no assessment has been issued against it, otherwise a new version is published and existing assessments stay pinned to the version they were created with.
        </p>
      </div>
    </div>
  );
}
