import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { adminApi, auth } from '../services/api';

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: '▦', end: true },
  { to: '/admin/generate', label: 'Generate Assessment', icon: '＋' },
  { to: '/admin/candidates', label: 'Candidates / Assessments', icon: '☰' },
  { to: '/admin/resumes', label: 'Resumes', icon: '❐', badge: 'resumes' },
  { to: '/admin/question-papers', label: 'Question Papers', icon: '❑' },
];

const BADGE_POLL_MS = 15_000;

export default function AdminLayout() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [newResumes, setNewResumes] = useState(0);

  // Poll so the sidebar badge reflects newly uploaded resumes without a page refresh.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      adminApi
        .unreviewedResumeCount()
        .then((r) => alive && setNewResumes(r.new_count))
        .catch(() => undefined);
    void tick();
    const id = setInterval(tick, BADGE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function logout() {
    try {
      await adminApi.logout();
    } catch {
      /* token may already be gone - clear locally regardless */
    }
    auth.clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 shrink-0 bg-slate-900 text-slate-300 transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-6">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 font-bold text-white">
            RA
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">Recruitment</p>
            <p className="text-xs text-slate-400">Assessment Platform</p>
          </div>
        </div>

        <nav className="space-y-1 p-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-brand-600 text-white' : 'hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <span className="w-4 text-center opacity-80">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge === 'resumes' && newResumes > 0 && (
                <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">
                  {newResumes}
                </span>
              )}
            </NavLink>
          ))}
          <button
            onClick={logout}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-rose-600/90 hover:text-white"
          >
            <span className="w-4 text-center opacity-80">⏻</span>
            Logout
          </button>
        </nav>
      </aside>

      {open && (
        <div className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <button className="btn-ghost lg:hidden" onClick={() => setOpen(true)} aria-label="Menu">
            ☰
          </button>
          <Link to="/admin" className="text-sm font-semibold text-slate-900">
            Admin Console
          </Link>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="hidden sm:inline">Signed in as</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
              {localStorage.getItem('ra_admin_user') ?? 'admin'}
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
