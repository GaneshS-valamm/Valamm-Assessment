import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  AssessmentStatus,
  EvaluationStatus,
  InterestResponse,
  ResumeStatus,
  UploadedByType,
} from '../types';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'bg-rose-50 border-rose-200 text-rose-800',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    info: 'bg-brand-50 border-brand-200 text-brand-800',
  }[kind];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

const STATUS_STYLES: Record<AssessmentStatus, string> = {
  GENERATED: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  SUBMITTED: 'bg-emerald-100 text-emerald-800',
};

const STATUS_LABELS: Record<AssessmentStatus, string> = {
  GENERATED: 'Generated',
  IN_PROGRESS: 'In Progress',
  SUBMITTED: 'Submitted',
};

export function StatusBadge({ status }: { status: AssessmentStatus }) {
  return <span className={`badge ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function EvaluationBadge({ status }: { status: EvaluationStatus }) {
  const map: Record<EvaluationStatus, [string, string]> = {
    NOT_APPLICABLE: ['bg-slate-100 text-slate-600', 'N/A'],
    PENDING: ['bg-amber-100 text-amber-800', 'Pending'],
    COMPLETED: ['bg-emerald-100 text-emerald-800', 'Completed'],
  };
  const [cls, label] = map[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

const RESUME_STATUS_STYLES: Record<ResumeStatus, [string, string]> = {
  NEW: ['bg-brand-100 text-brand-800', 'New'],
  REVIEWED: ['bg-slate-200 text-slate-700', 'Reviewed'],
  SHORTLISTED: ['bg-emerald-100 text-emerald-800', 'Shortlisted'],
};

export function ResumeStatusBadge({ status }: { status: ResumeStatus }) {
  const [cls, label] = RESUME_STATUS_STYLES[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function InterestBadge({ response }: { response: InterestResponse }) {
  const map: Record<InterestResponse, [string, string]> = {
    PENDING: ['bg-slate-100 text-slate-600', 'Awaiting reply'],
    INTERESTED: ['bg-emerald-100 text-emerald-800', 'Yes \u2014 interested'],
    NOT_INTERESTED: ['bg-rose-100 text-rose-800', 'No \u2014 declined'],
  };
  const [cls, label] = map[response];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function UploaderBadge({ by }: { by: UploadedByType }) {
  return (
    <span
      className={`badge ${by === 'ADMIN' ? 'bg-slate-200 text-slate-700' : 'bg-violet-100 text-violet-800'}`}
    >
      {by === 'ADMIN' ? 'Admin' : 'Candidate'}
    </span>
  );
}

/** File picker styled as a button; used wherever an admin attaches a resume. */
export function UploadButton({
  onPick,
  busy,
  label = 'Upload Resume',
  className = 'btn-secondary',
  disabled,
}: {
  onPick: (file: File) => void | Promise<void>;
  busy?: boolean;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPick(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className={className}
        onClick={() => ref.current?.click()}
        disabled={busy || disabled}
      >
        {busy ? 'Uploading\u2026' : label}
      </button>
    </>
  );
}

export function CopyButton({
  value,
  className = 'btn-secondary',
  label = 'Copy Link',
}: {
  value: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API needs a secure context; fall back to a hidden textarea.
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
  }

  return (
    <button type="button" onClick={copy} className={className}>
      {copied ? '✓ Copied!' : label}
    </button>
  );
}

export function Modal({
  title,
  children,
  onClose,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg card p-6">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="mt-4 text-sm text-slate-600">{children}</div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>
      </div>
    </div>
  );
}
