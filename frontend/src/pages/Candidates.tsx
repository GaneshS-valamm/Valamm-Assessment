import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, formatDateTime } from '../services/api';
import type { AssessmentRow, AssessmentStatus, Role } from '../types';
import {
  Alert,
  CopyButton,
  InterestBadge,
  Modal,
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
  const [confirmDelete, setConfirmDelete] = useState<AssessmentRow | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  /** Persist one interviewer field; called on blur so typing is not interrupted. */
  async function saveInterviewer(row: AssessmentRow, field: 1 | 2, value: string) {
    const current = field === 1 ? row.interviewer_1 : row.interviewer_2;
    if ((current ?? '') === value.trim()) return;
    setError('');
    try {
      const updated = await adminApi.updateAssessment(row.id, {
        interviewer_1: field === 1 ? value : row.interviewer_1,
        interviewer_2: field === 2 ? value : row.interviewer_2,
      });
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setNotice(`Interviewer ${field} saved for ${row.candidate_name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the interviewer.');
      void load();
    }
  }

  /** Give a candidate more time; reopens the link if the timer had closed it. */
  async function saveExtraTime(row: AssessmentRow, value: string) {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes < 0) return;
    if (minutes === (row.extra_minutes ?? 0)) return;
    setError('');
    setNotice('');
    try {
      const updated = await adminApi.setExtraTime(row.id, minutes);
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setNotice(
        updated.status === 'IN_PROGRESS' && row.status === 'SUBMITTED'
          ? `${row.candidate_name} has ${minutes} extra minutes — their link is open again and all their answers are intact.`
          : `${row.candidate_name} now has ${minutes} extra minutes.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the extra time.');
      void load();
    }
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    setError('');
    try {
      const res = await adminApi.deleteAssessment(confirmDelete.id);
      setRows((prev) => prev.filter((r) => r.id !== confirmDelete.id));
      setTotal((t) => Math.max(0, t - 1));
      setNotice(res.message);
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the record.');
    } finally {
      setDeleting(false);
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
                  <th className="th">Applied Role</th>
                  <th className="th">Test Role</th>
                  <th className="th">Interviewer 1</th>
                  <th className="th">Interviewer 2</th>
                  <th className="th">Assessment Link</th>
                  <th className="th">Resume</th>
                  <th className="th">Candidate Interest</th>
                  <th className="th">Created Date</th>
                  <th className="th">Status</th>
                  <th className="th">Submission Date</th>
                  <th className="th">Extra Time</th>
                  <th className="th">Answers</th>
                  <th className="th">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="td font-semibold text-slate-900">{r.candidate_name}</td>
                    <td className="td text-xs">{r.candidate_email}</td>
                    <td className="td min-w-[190px]">{r.applied_role_name}</td>
                    <td className="td min-w-[190px]">
                      {r.test_role_name ? (
                        <span
                          className={
                            r.test_role_name === r.applied_role_name
                              ? 'text-slate-700'
                              : 'font-semibold text-violet-800'
                          }
                        >
                          {r.test_role_name}
                          {r.test_role_name !== r.applied_role_name && (
                            <span className="mt-0.5 block text-xs font-normal text-violet-600">
                              switched by candidate
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="td">
                      <input
                        className="input !w-36 !px-2 !py-1 !text-xs"
                        defaultValue={r.interviewer_1 ?? ''}
                        placeholder="Add name"
                        onBlur={(e) => void saveInterviewer(r, 1, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      />
                    </td>
                    <td className="td">
                      <input
                        className="input !w-36 !px-2 !py-1 !text-xs"
                        defaultValue={r.interviewer_2 ?? ''}
                        placeholder="Add name"
                        onBlur={(e) => void saveInterviewer(r, 2, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      />
                    </td>
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
                    <td className="td">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={480}
                          step={5}
                          className="input !w-20 !px-2 !py-1 !text-xs"
                          defaultValue={r.extra_minutes ?? 0}
                          title={
                            r.status === 'SUBMITTED' && !r.auto_closed
                              ? 'This candidate submitted their own answers, so the link cannot be reopened'
                              : 'Extra minutes on top of the original duration'
                          }
                          disabled={r.status === 'SUBMITTED' && !r.auto_closed}
                          onBlur={(e) => void saveExtraTime(r, e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        />
                        <span className="text-xs text-slate-500">min</span>
                      </div>
                      {r.auto_closed && (
                        <span className="mt-1 block text-xs font-semibold text-amber-700">
                          ran out of time
                        </span>
                      )}
                      {r.extra_minutes > 0 && r.status === 'IN_PROGRESS' && (
                        <span className="mt-1 block text-xs text-emerald-700">reopened</span>
                      )}
                    </td>
                    <td className="td">
                      {r.answered_count > 0 ? (
                        <Link to={`/admin/results/${r.id}`} className="btn-primary !px-3 !py-1.5 !text-xs">
                          View Answers
                          <span className="ml-1 font-normal opacity-80">
                            ({r.answered_count}/{r.question_count})
                          </span>
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">No answers yet</span>
                      )}
                    </td>
                    <td className="td">
                      <button
                        type="button"
                        className="btn-secondary !px-3 !py-1.5 !text-xs !text-rose-700 hover:!bg-rose-50"
                        onClick={() => setConfirmDelete(r)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {confirmDelete && (
        <Modal
          title={`Delete ${confirmDelete.candidate_name}?`}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button
                className="btn-secondary"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="btn-primary !bg-rose-600 hover:!bg-rose-700"
                onClick={doDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Yes, delete permanently'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p>
              This permanently removes <strong>{confirmDelete.candidate_name}</strong> (
              {confirmDelete.candidate_email}) and everything held against them:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>the assessment link, which will stop working</li>
              <li>
                every answer they wrote
                {confirmDelete.answered_count > 0 && ` (${confirmDelete.answered_count} so far)`}
              </li>
              <li>their uploaded resume and all earlier versions, including the stored files</li>
              <li>any reviewer notes</li>
            </ul>
            <p className="font-semibold text-rose-700">This cannot be undone.</p>
          </div>
        </Modal>
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
