import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, formatDateTime } from '../services/api';
import type { AssessmentRow, DashboardStats } from '../types';
import { Alert, Spinner, StatusBadge } from '../components/ui';

const CARDS: { key: keyof DashboardStats; label: string; tone: string }[] = [
  { key: 'total_generated', label: 'Total Assessments Generated', tone: 'bg-brand-50 text-brand-700' },
  { key: 'in_progress', label: 'Assessments In Progress', tone: 'bg-amber-50 text-amber-700' },
  { key: 'submitted', label: 'Assessments Submitted', tone: 'bg-emerald-50 text-emerald-700' },
  { key: 'pending', label: 'Assessments Pending', tone: 'bg-slate-100 text-slate-700' },
];

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [rows, setRows] = useState<AssessmentRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, list] = await Promise.all([
          adminApi.stats(),
          adminApi.assessments({ page_size: 10, sort_by: 'created_at', sort_dir: 'desc' }),
        ]);
        if (!alive) return;
        setStats(s);
        setRows(list.items);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Spinner label="Loading dashboard…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">Live recruitment assessment activity.</p>
        </div>
        <Link to="/admin/generate" className="btn-primary">
          + Generate Assessment
        </Link>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {CARDS.map((c) => (
          <div key={c.key} className="card p-5">
            <p className="text-sm font-medium text-slate-500">{c.label}</p>
            <div className="mt-3 flex items-end justify-between">
              <span className="text-3xl font-bold text-slate-900">{stats?.[c.key] ?? 0}</span>
              <span className={`badge ${c.tone}`}>live</span>
            </div>
          </div>
        ))}
      </div>

      {stats && stats.new_resumes > 0 && (
        <Alert kind="info">
          <strong>{stats.new_resumes}</strong> newly uploaded resume
          {stats.new_resumes === 1 ? '' : 's'} awaiting review.{' '}
          <Link className="font-semibold underline" to="/admin/resumes?resume_status=NEW">
            Open Resumes
          </Link>
        </Alert>
      )}

      {stats && stats.submitted > 0 && (
        <Alert kind="info">
          <strong>{stats.submitted}</strong> submitted assessment
          {stats.submitted === 1 ? '' : 's'} ready to read.{' '}
          <Link className="font-semibold underline" to="/admin/candidates?status=SUBMITTED">
            View answers
          </Link>
        </Alert>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Recent Candidate Assessments</h2>
          <Link to="/admin/candidates" className="text-sm font-semibold text-brand-600 hover:underline">
            View all →
          </Link>
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            No assessments yet. Generate the first candidate link to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Candidate</th>
                  <th className="th">Applied Role</th>
                  <th className="th">Test Role</th>
                  <th className="th">Interviewer 1</th>
                  <th className="th">Interviewer 2</th>
                  <th className="th">Status</th>
                  <th className="th">Created</th>
                  <th className="th">Submitted</th>
                  <th className="th">Answers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="td">
                      <div className="font-semibold text-slate-900">{r.candidate_name}</div>
                      <div className="text-xs text-slate-500">{r.candidate_email}</div>
                    </td>
                    <td className="td max-w-[180px]">{r.applied_role_name}</td>
                    <td className="td max-w-[180px]">
                      {r.test_role_name ? (
                        <span
                          className={
                            r.test_role_name === r.applied_role_name
                              ? ''
                              : 'font-semibold text-violet-800'
                          }
                        >
                          {r.test_role_name}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="td text-xs">{r.interviewer_1 || '—'}</td>
                    <td className="td text-xs">{r.interviewer_2 || '—'}</td>
                    <td className="td">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="td whitespace-nowrap text-xs">{formatDateTime(r.created_at)}</td>
                    <td className="td whitespace-nowrap text-xs">{formatDateTime(r.submitted_at)}</td>
                    <td className="td">
                      {r.answered_count > 0 ? (
                        <Link to={`/admin/results/${r.id}`} className="btn-secondary !px-3 !py-1.5 !text-xs">
                          View Answers ({r.answered_count}/{r.question_count})
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
