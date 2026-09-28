import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, formatDateTime } from '../services/api';
import type { AssessmentRow, AssessmentStatus, Role } from '../types';
import {
  Alert,
  CopyButton,
  EvaluationBadge,
  InterestBadge,
  Spinner,
  StatusBadge,
  UploadButton,
} from '../components/ui';

const PAGE_SIZE = 15;

export default function Candidates() {
  const [params, setParams] = useSearchParams();
  const [roles, setRoles] = useState<Role[]>([]);
  const [rows, setRows] = useState<AssessmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);
  const [notice, setNotice] = useState('');

  const search = params.get('search') ?? '';
  const roleId = params.get('role_id') ?? '';
  const status = params.get('status') ?? '';
  const sortBy = params.get('sort_by') ?? 'created_at';
  const sortDir = params.get('sort_dir') ?? 'desc';
  const page = Number(params.get('page') ?? 1);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!('page' in patch)) next.set('page', '1');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    adminApi.roles().then(setRoles).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await adminApi.assessments({
        search: search || undefined,
        role_id: roleId || undefined,
        status: status || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
        page,
        page_size: PAGE_SIZE,
      });
      setRows(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assessments.');
    } finally {
      setLoading(false);
    }
  }, [search, roleId, status, sortBy, sortDir, page]);

  useEffect(() => {
    const t = setTimeout(load, 200); // debounce the search box
    return () => clearTimeout(t);
  }, [load]);

  async function attachResume(assessmentId: number, candidate: string, file: File) {
    setUploadingFor(assessmentId);
    setError('');
    setNotice('');
    try {
      const r = await adminApi.uploadResumeForAssessment(assessmentId, file);
      setNotice(`Resume "${r.original_filename}" attached for ${candidate}. They will be asked to review it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploadingFor(null);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Candidates / Assessments</h1>
          <p className="text-sm text-slate-500">{total} assessment(s) in the database.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary">
            ⟳ Refresh
          </button>
          <Link to="/admin/generate" className="btn-primary">
            + Generate
          </Link>
        </div>
      </div>

      <div className="card grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <input
          className="input"
          placeholder="Search name or email…"
          defaultValue={search}
          onChange={(e) => update({ search: e.target.value })}
        />
        <select className="input" value={roleId} onChange={(e) => update({ role_id: e.target.value })}>
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.role_name}
            </option>
          ))}
        </select>
        <select className="input" value={status} onChange={(e) => update({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="GENERATED">Generated</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="SUBMITTED">Submitted</option>
        </select>
        <select
          className="input"
          value={`${sortBy}:${sortDir}`}
          onChange={(e) => {
            const [by, dir] = e.target.value.split(':');
            update({ sort_by: by, sort_dir: dir });
          }}
        >
          <option value="created_at:desc">Created — newest first</option>
          <option value="created_at:asc">Created — oldest first</option>
          <option value="submitted_at:desc">Submitted — newest first</option>
          <option value="submitted_at:asc">Submitted — oldest first</option>
        </select>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner label="Loading assessments…" />
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            No assessments match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Candidate Name</th>
                  <th className="th">Candidate Email</th>
                  <th className="th">Technical Role</th>
                  <th className="th">Assessment Link</th>
                  <th className="th">Resume</th>
                  <th className="th">Candidate Interest</th>
                  <th className="th">Created Date</th>
                  <th className="th">Status</th>
                  <th className="th">Submission Date</th>
                  <th className="th">Objective Score</th>
                  <th className="th">Subjective Evaluation</th>
                  <th className="th">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="td font-semibold text-slate-900">{r.candidate_name}</td>
                    <td className="td text-xs">{r.candidate_email}</td>
                    <td className="td min-w-[200px]">{r.role_name}</td>
                    <td className="td">
                      {r.assessment_url ? (
                        <CopyButton
                          value={r.assessment_url}
                          label="Copy"
                          className="btn-secondary !px-3 !py-1.5 !text-xs"
                        />
                      ) : (
                        <span className="text-xs text-slate-400">unavailable</span>
                      )}
                    </td>
                    <td className="td">
                      <UploadButton
                        onPick={(f) => attachResume(r.id, r.candidate_name, f)}
                        busy={uploadingFor === r.id}
                        label={r.resume_confirmed_at ? 'Replace' : 'Attach'}
                        className="btn-secondary !px-3 !py-1.5 !text-xs"
                        disabled={r.status === 'SUBMITTED'}
                      />
                    </td>
                    <td className="td">
                      <InterestBadge response={r.interest_response} />
                    </td>
                    <td className="td whitespace-nowrap text-xs">{formatDateTime(r.created_at)}</td>
                    <td className="td">
                      <StatusBadge status={r.status as AssessmentStatus} />
                    </td>
                    <td className="td whitespace-nowrap text-xs">{formatDateTime(r.submitted_at)}</td>
                    <td className="td whitespace-nowrap">
                      {r.status !== 'SUBMITTED' ? (
                        <span className="text-slate-400">—</span>
                      ) : r.objective_max === 0 ? (
                        <span className="text-xs text-slate-500">n/a</span>
                      ) : (
                        <span className="font-semibold text-slate-900">
                          {r.objective_score ?? 0} / {r.objective_max}
                        </span>
                      )}
                    </td>
                    <td className="td">
                      {r.status === 'SUBMITTED' ? (
                        <EvaluationBadge status={r.evaluation_status} />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="td">
                      {r.status === 'SUBMITTED' ? (
                        <Link to={`/admin/results/${r.id}`} className="btn-primary !px-3 !py-1.5 !text-xs">
                          View Result
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">Not submitted</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm">
            <span className="text-slate-500">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <button
                className="btn-secondary !px-3 !py-1.5"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) })}
              >
                Previous
              </button>
              <button
                className="btn-secondary !px-3 !py-1.5"
                disabled={page >= pages}
                onClick={() => update({ page: String(page + 1) })}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
