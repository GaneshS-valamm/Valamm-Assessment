import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, formatDateTime } from '../services/api';
import type { GeneratedAssessment, ResumeRow, Role } from '../types';
import { Alert, CopyButton, StatusBadge, UploadButton, UploaderBadge } from '../components/ui';

export default function GenerateAssessment() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [duration, setDuration] = useState('60');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GeneratedAssessment | null>(null);
  const [resume, setResume] = useState<ResumeRow | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeError, setResumeError] = useState('');

  useEffect(() => {
    adminApi
      .roles()
      .then(setRoles)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load roles.'));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const created = await adminApi.createAssessment({
        candidate_name: name.trim(),
        candidate_email: email.trim(),
        role_id: Number(roleId),
        duration_minutes: duration ? Number(duration) : null,
      });
      setResult(created);
      setResume(null);
      setResumeError('');
      setName('');
      setEmail('');
      setRoleId('');
      setDuration('60');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate the assessment.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadResume(file: File) {
    if (!result) return;
    setResumeBusy(true);
    setResumeError('');
    try {
      setResume(await adminApi.uploadResumeForAssessment(result.id, file));
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setResumeBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Generate Assessment</h1>
        <p className="text-sm text-slate-500">
          Create a unique, single-candidate assessment link for a selected role.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={submit} className="card space-y-5 p-6 lg:col-span-3">
          {error && <Alert kind="error">{error}</Alert>}

          <div>
            <label className="label" htmlFor="cname">
              Candidate Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="cname"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya Raghavan"
              required
              minLength={2}
            />
          </div>

          <div>
            <label className="label" htmlFor="cemail">
              Candidate Email <span className="text-rose-500">*</span>
            </label>
            <input
              id="cemail"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="candidate@example.com"
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="role">
              Technical Role <span className="text-rose-500">*</span>
            </label>
            <select
              id="role"
              className="input"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              required
            >
              <option value="">Select a role…</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.role_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="duration">
              Assessment Duration (minutes)
            </label>
            <input
              id="duration"
              type="number"
              min={5}
              max={480}
              className="input"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-slate-500">Optional. Defaults to 60 minutes.</p>
          </div>

          <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy}>
            {busy ? 'Generating…' : 'Generate Assessment Link'}
          </button>
        </form>

        <div className="lg:col-span-2">
          {result ? (
            <div className="card space-y-4 p-6">
              <Alert kind="success">
                Assessment link generated successfully for <strong>{result.candidate_name}</strong>.
              </Alert>

              <div>
                <p className="label">Candidate Assessment URL</p>
                <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                  <code className="block break-all text-xs text-slate-700">{result.assessment_url}</code>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <CopyButton value={result.assessment_url} />
                  <a
                    href={result.assessment_url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost"
                  >
                    Open ↗
                  </a>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Send this link to the candidate manually. No email is sent automatically.
                </p>
              </div>

              <div className="border-t border-slate-200 pt-4">
                <p className="label">Candidate Resume</p>
                {resume ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="truncate text-sm font-medium text-emerald-900">
                      {resume.original_filename}
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-800">
                      Attached (v{resume.version}) &middot; the candidate will be asked to review it
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Attach the resume you received. The candidate is shown it on their assessment
                    page and asked to confirm it or upload a newer version. PDF or DOCX.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <UploadButton
                    onPick={uploadResume}
                    busy={resumeBusy}
                    label={resume ? 'Replace Resume' : 'Attach Resume'}
                    className={resume ? 'btn-secondary' : 'btn-primary'}
                  />
                  {resume && <UploaderBadge by={resume.uploaded_by_type} />}
                </div>
                {resumeError && (
                  <div className="mt-3">
                    <Alert kind="error">{resumeError}</Alert>
                  </div>
                )}
              </div>

              <dl className="space-y-2.5 border-t border-slate-200 pt-4 text-sm">
                <Row label="Candidate Name" value={result.candidate_name} />
                <Row label="Candidate Email" value={result.candidate_email} />
                <Row label="Selected Role" value={result.role_name} />
                <Row
                  label="Assessment Status"
                  value={<StatusBadge status={result.status} />}
                />
                <Row label="Link Created" value={formatDateTime(result.created_at)} />
                <Row
                  label="Paper / Questions"
                  value={`v${result.question_paper_version} · ${result.question_count} questions`}
                />
                <Row label="Duration" value={`${result.duration_minutes ?? 60} minutes`} />
              </dl>

              <Link to="/admin/candidates" className="btn-secondary w-full">
                View all assessments
              </Link>
            </div>
          ) : (
            <div className="card p-6 text-sm text-slate-500">
              <h3 className="mb-2 font-semibold text-slate-900">How it works</h3>
              <ol className="list-decimal space-y-2 pl-4">
                <li>Enter the candidate's details and pick the hiring role.</li>
                <li>
                  A cryptographically random token is generated; only its hash is used for lookup.
                </li>
                <li>The active question paper version for that role is pinned to the assessment.</li>
                <li>Attach the candidate's resume so they can review it.</li>
                <li>Copy the link and share it with the candidate directly.</li>
              </ol>
              <p className="mt-3 border-t border-slate-200 pt-3">
                On opening the link the candidate reviews the resume you attached, replaces it if it
                is out of date, then answers whether they want to proceed with the role. The
                question paper is released only if they answer <strong>Yes</strong>.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}
