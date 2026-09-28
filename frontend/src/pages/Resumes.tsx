import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, formatDateTime, formatFileSize } from '../services/api';
import type { ResumeDetail, ResumePreview, ResumeRow, ResumeStatus, Role } from '../types';
import {
  Alert,
  InterestBadge,
  Modal,
  ResumeStatusBadge,
  Spinner,
  StatusBadge,
  UploaderBadge,
} from '../components/ui';

const PAGE_SIZE = 15;
const POLL_MS = 10_000;

const RESUME_STATUS_LABELS: Record<ResumeStatus, string> = {
  NEW: 'New',
  REVIEWED: 'Reviewed',
  SHORTLISTED: 'Shortlisted',
};

export default function Resumes() {
  const [params, setParams] = useSearchParams();
  const [roles, setRoles] = useState<Role[]>([]);
  const [rows, setRows] = useState<ResumeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const seenIds = useRef<Set<number>>(new Set());
  const [arrived, setArrived] = useState(0);

  const search = params.get('search') ?? '';
  const roleId = params.get('role_id') ?? '';
  const resumeStatus = params.get('resume_status') ?? '';
  const assessmentStatus = params.get('assessment_status') ?? '';
  const page = Number(params.get('page') ?? 1);

  // Allow other pages to link straight to one resume: /admin/resumes?open=<id>
  useEffect(() => {
    const requested = params.get('open');
    if (requested) setOpenId(Number(requested));
  }, [params]);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (!('page' in patch)) next.set('page', '1');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    adminApi.roles().then(setRoles).catch(() => undefined);
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const data = await adminApi.resumes({
          search: search || undefined,
          role_id: roleId || undefined,
          resume_status: resumeStatus || undefined,
          assessment_status: assessmentStatus || undefined,
          page,
          page_size: PAGE_SIZE,
        });
        // Count rows that showed up since the last poll so the admin sees new arrivals.
        if (seenIds.current.size > 0) {
          const fresh = data.items.filter((r) => !seenIds.current.has(r.id)).length;
          if (fresh > 0) setArrived((n) => n + fresh);
        }
        data.items.forEach((r) => seenIds.current.add(r.id));
        setRows(data.items);
        setTotal(data.total);
        setNewCount(data.new_count);
        setLastSync(new Date());
        setError('');
      } catch (err) {
        if (!quiet) setError(err instanceof Error ? err.message : 'Failed to load resumes.');
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [search, roleId, resumeStatus, assessmentStatus, page],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), 200); // debounce filter changes
    return () => clearTimeout(t);
  }, [load]);

  // Poll so newly uploaded resumes appear without a manual page refresh.
  useEffect(() => {
    const id = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            Resumes
            {newCount > 0 && (
              <span className="badge bg-rose-600 text-white">{newCount} new</span>
            )}
          </h1>
          <p className="text-sm text-slate-500">
            {total} resume(s) · updates automatically
            {lastSync ? ` · last checked ${lastSync.toLocaleTimeString()}` : ''}
          </p>
        </div>
        <button onClick={() => void load()} className="btn-secondary">
          ⟳ Refresh
        </button>
      </div>

      {arrived > 0 && (
        <Alert kind="info">
          {arrived} new resume{arrived === 1 ? '' : 's'} arrived while you were on this page.{' '}
          <button className="font-semibold underline" onClick={() => setArrived(0)}>
            Dismiss
          </button>
        </Alert>
      )}

      <div className="card grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <input
          className="input"
          placeholder="Search name, email or filename…"
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
        <select
          className="input"
          value={resumeStatus}
          onChange={(e) => update({ resume_status: e.target.value })}
        >
          <option value="">All resume statuses</option>
          <option value="NEW">New</option>
          <option value="REVIEWED">Reviewed</option>
          <option value="SHORTLISTED">Shortlisted</option>
        </select>
        <select
          className="input"
          value={assessmentStatus}
          onChange={(e) => update({ assessment_status: e.target.value })}
        >
          <option value="">All assessment statuses</option>
          <option value="GENERATED">Generated</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="SUBMITTED">Submitted</option>
        </select>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner label="Loading resumes…" />
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            No resumes match the current filters. Resumes appear here as soon as candidates upload
            them.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Candidate Name</th>
                  <th className="th">Candidate Email</th>
                  <th className="th">Applied Role</th>
                  <th className="th">Resume File Name</th>
                  <th className="th">Uploaded By</th>
                  <th className="th">Candidate Interest</th>
                  <th className="th">Uploaded</th>
                  <th className="th">Resume Status</th>
                  <th className="th">Assessment Status</th>
                  <th className="th">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`hover:bg-slate-50 ${r.resume_status === 'NEW' ? 'bg-brand-50/40' : ''}`}
                  >
                    <td className="td font-semibold text-slate-900">{r.candidate_name}</td>
                    <td className="td text-xs">{r.candidate_email}</td>
                    <td className="td min-w-[200px]">{r.role_name}</td>
                    <td className="td">
                      <button
                        type="button"
                        onClick={() => setOpenId(r.id)}
                        className="block max-w-[200px] truncate text-left font-medium text-brand-600 underline decoration-brand-300 hover:text-brand-800"
                        title="Open this resume"
                      >
                        {r.original_filename}
                      </button>
                      <span className="text-xs text-slate-500">
                        {formatFileSize(r.file_size)}
                        {r.version > 1 ? ` · v${r.version}` : ''}
                        {r.is_locked ? ' · locked' : ''}
                      </span>
                    </td>
                    <td className="td">
                      <UploaderBadge by={r.uploaded_by_type} />
                      {r.uploaded_by_type === 'CANDIDATE' && r.version > 1 && (
                        <span className="mt-1 block text-xs text-violet-700">updated by candidate</span>
                      )}
                    </td>
                    <td className="td">
                      <InterestBadge response={r.interest_response} />
                    </td>
                    <td className="td whitespace-nowrap text-xs">{formatDateTime(r.uploaded_at)}</td>
                    <td className="td">
                      <ResumeStatusBadge status={r.resume_status} />
                    </td>
                    <td className="td">
                      <StatusBadge status={r.assessment_status} />
                    </td>
                    <td className="td">
                      <button
                        className="btn-primary !px-3 !py-1.5 !text-xs"
                        onClick={() => setOpenId(r.id)}
                      >
                        View Resume
                      </button>
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

      {openId !== null && (
        <ResumeDetailModal
          resumeId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void load(true)}
        />
      )}
    </div>
  );
}

function ResumeDetailModal({
  resumeId,
  onClose,
  onChanged,
}: {
  resumeId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ResumeDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [textPreview, setTextPreview] = useState<ResumePreview | null>(null);

  useEffect(() => {
    let alive = true;
    adminApi
      .resume(resumeId)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Failed to load resume.'));
    return () => {
      alive = false;
    };
  }, [resumeId]);

  const isPdf = detail?.content_type === 'application/pdf';

  // Everything is shown without downloading: PDFs render in an embedded viewer, and a
  // DOCX is converted to text by the backend because browsers cannot display Word files.
  useEffect(() => {
    if (!detail) return;
    let url: string | null = null;
    let alive = true;
    setPreviewError('');

    if (isPdf) {
      adminApi
        .resumeBlobUrl(detail.id, 'inline')
        .then((u) => {
          url = u;
          if (alive) setPreviewUrl(u);
          else URL.revokeObjectURL(u);
        })
        .catch((e) =>
          alive && setPreviewError(e instanceof Error ? e.message : 'Preview unavailable.'),
        );
    } else {
      adminApi
        .resumePreview(detail.id)
        .then((pv) => alive && setTextPreview(pv))
        .catch((e) =>
          alive && setPreviewError(e instanceof Error ? e.message : 'Preview unavailable.'),
        );
    }

    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [detail, isPdf]);

  // Open the file full-screen in its own browser tab - still no download.
  async function openInTab() {
    if (!detail) return;
    try {
      const url = await adminApi.resumeBlobUrl(detail.id, 'inline');
      const win = window.open(url, '_blank', 'noopener');
      if (!win) setError('Your browser blocked the new tab. The preview below shows the same file.');
      // Revoked late so the new tab has time to load it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the resume.');
    }
  }

  async function download() {
    if (!detail) return;
    setBusy(true);
    try {
      const url = await adminApi.resumeBlobUrl(detail.id, 'attachment');
      const a = document.createElement('a');
      a.href = url;
      a.download = detail.original_filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: ResumeStatus) {
    if (!detail) return;
    setBusy(true);
    setError('');
    try {
      const updated = await adminApi.setResumeStatus(detail.id, status);
      setDetail({ ...detail, ...updated });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className="my-8 w-full max-w-3xl card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {detail ? detail.candidate_name : 'Resume'}
            </h3>
            {detail && <p className="text-sm text-slate-500">{detail.candidate_email}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            ✕
          </button>
        </div>

        {error && (
          <div className="mt-4">
            <Alert kind="error">{error}</Alert>
          </div>
        )}

        {!detail ? (
          <Spinner label="Loading resume…" />
        ) : (
          <div className="mt-5 space-y-5">
            <dl className="grid gap-x-8 gap-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <Meta label="Applied Role" value={detail.role_name} />
              <Meta label="Resume Filename" value={detail.original_filename} />
              <Meta label="Uploaded" value={formatDateTime(detail.uploaded_at)} />
              <Meta
                label="File"
                value={`${formatFileSize(detail.file_size)} · ${isPdf ? 'PDF' : 'DOCX'}${
                  detail.version > 1 ? ` · version ${detail.version}` : ''
                }`}
              />
              <Meta
                label="Review Status"
                value={RESUME_STATUS_LABELS[detail.resume_status]}
                extra={<ResumeStatusBadge status={detail.resume_status} />}
              />
              <Meta
                label="Reviewed At"
                value={detail.reviewed_at ? formatDateTime(detail.reviewed_at) : 'Not reviewed yet'}
              />
              <Meta
                label="Uploaded By"
                value=""
                extra={<UploaderBadge by={detail.uploaded_by_type} />}
              />
              <Meta
                label="Candidate Reviewed Resume"
                value={
                  detail.candidate_confirmed_at
                    ? formatDateTime(detail.candidate_confirmed_at)
                    : 'Not yet'
                }
              />
              <Meta
                label="Interested In Role"
                value={
                  detail.interest_responded_at
                    ? formatDateTime(detail.interest_responded_at)
                    : 'No response yet'
                }
                extra={<InterestBadge response={detail.interest_response} />}
              />
            </dl>

            <div className="rounded-lg border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-900">Associated assessment</p>
              <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
                <Meta label="Assessment ID" value={`#${detail.assessment_id}`} />
                <Meta
                  label="Assessment Status"
                  value=""
                  extra={<StatusBadge status={detail.assessment_status} />}
                />
                <Meta label="Created" value={formatDateTime(detail.assessment_created_at)} />
                <Meta
                  label="Submitted"
                  value={
                    detail.assessment_submitted_at
                      ? formatDateTime(detail.assessment_submitted_at)
                      : 'Not submitted'
                  }
                />
                <Meta label="Question Paper" value={`v${detail.question_paper_version}`} />
                <Meta
                  label="Objective Score"
                  value={detail.objective_score !== null ? String(detail.objective_score) : '—'}
                />
              </dl>
              {detail.assessment_url && (
                <p className="mt-3 break-all rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                  {detail.assessment_url}
                </p>
              )}
            </div>

            {/* Preview - always inline, never requires a download */}
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Resume</p>
                {isPdf && (
                  <button type="button" className="btn-ghost !px-2 !py-1 !text-xs" onClick={openInTab}>
                    Open in new tab ↗
                  </button>
                )}
              </div>
              {previewError ? (
                <Alert kind="error">{previewError}</Alert>
              ) : isPdf ? (
                previewUrl ? (
                  <object
                    data={previewUrl}
                    type="application/pdf"
                    className="h-[560px] w-full rounded-lg border border-slate-200"
                  >
                    <iframe
                      src={previewUrl}
                      title={detail.original_filename}
                      className="h-[560px] w-full rounded-lg border border-slate-200"
                    />
                  </object>
                ) : (
                  <Spinner label="Opening resume…" />
                )
              ) : textPreview === null ? (
                <Spinner label="Opening resume…" />
              ) : textPreview.kind === 'text' && textPreview.text ? (
                <div className="max-h-[560px] overflow-auto rounded-lg border border-slate-200 bg-white p-5">
                  <p className="mb-3 text-xs text-slate-500">
                    Word document shown as text so it opens here without downloading.
                  </p>
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-800">
                    {textPreview.text}
                  </pre>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                  This file's text could not be read for display. Use{' '}
                  <strong>Download Resume</strong> to open it in Word.
                </div>
              )}
            </div>

            {detail.history.length > 1 && (
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  Version history ({detail.history.length})
                </p>
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {detail.history.map((h) => (
                    <li key={h.id} className="flex flex-wrap justify-between gap-2">
                      <span>
                        v{h.version} · {h.original_filename} · {formatFileSize(h.file_size)}
                      </span>
                      <span>{formatDateTime(h.uploaded_at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-5">
              {detail.assessment_status === 'SUBMITTED' && (
                <Link
                  to={`/admin/results/${detail.assessment_id}`}
                  className="btn-secondary"
                  onClick={onClose}
                >
                  View Assessment
                </Link>
              )}
              <button className="btn-secondary" onClick={download} disabled={busy}>
                ⭳ Download Resume
              </button>
              <button
                className="btn-secondary"
                onClick={() => void setStatus('REVIEWED')}
                disabled={busy || detail.resume_status === 'REVIEWED'}
              >
                Mark as Reviewed
              </button>
              <button
                className="btn-primary !bg-emerald-600 hover:!bg-emerald-700"
                onClick={() => void setStatus('SHORTLISTED')}
                disabled={busy || detail.resume_status === 'SHORTLISTED'}
              >
                ★ Mark as Shortlisted
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({
  label,
  value,
  extra,
}: {
  label: string;
  value: string;
  extra?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
        {value && <span className="break-all">{value}</span>}
        {extra}
      </dd>
    </div>
  );
}
