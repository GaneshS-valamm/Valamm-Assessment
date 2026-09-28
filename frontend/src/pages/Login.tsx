import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi, auth } from '../services/api';
import { Alert } from '../components/ui';

export default function Login() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await adminApi.login(userId.trim(), password);
      auth.set(res.access_token);
      localStorage.setItem('ra_admin_user', res.user_id);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      <div className="hidden flex-1 flex-col justify-between bg-slate-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-600 font-bold">RA</span>
          <span className="font-semibold">Recruitment Assessment Platform</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-bold leading-tight">
            Role-based assessments for enterprise hiring.
          </h1>
          <p className="mt-4 text-slate-300">
            Generate secure, single-use assessment links per candidate, capture objective and
            subjective responses, and evaluate results in one place.
          </p>
          <ul className="mt-8 space-y-2 text-sm text-slate-400">
            <li>• Four role-specific question papers, versioned</li>
            <li>• Auto-scored objective sections</li>
            <li>• Human evaluation for subjective answers</li>
          </ul>
        </div>
        <p className="text-xs text-slate-500">Authorised personnel only.</p>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-600 font-bold text-white">
              RA
            </span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Admin Login</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            Sign in to manage candidate assessments and results.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            {error && <Alert kind="error">{error}</Alert>}

            <div>
              <label className="label" htmlFor="user_id">
                User ID
              </label>
              <input
                id="user_id"
                className="input"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                autoComplete="username"
                placeholder="admin"
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
            </div>

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
