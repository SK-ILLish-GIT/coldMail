import { useEffect } from 'react';

export default function PreviewModal({ open, onClose, subject, html, to }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/55 p-4 backdrop-blur-sm anim-in"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-200/60 px-5 py-4">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
              Email preview
            </p>
            <h3 className="truncate text-base font-semibold text-ink-900">
              {subject || <span className="italic text-ink-400">(no subject)</span>}
            </h3>
            {to && (
              <p className="mt-0.5 truncate text-xs text-ink-500">
                To <span className="font-medium text-ink-700">{to}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            aria-label="Close preview"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-auto bg-ink-100/60 p-4">
          <iframe
            title="Email preview"
            srcDoc={html || '<p style="font-family:sans-serif;color:#94a3b8;">Nothing to preview yet.</p>'}
            sandbox=""
            className="preview-frame h-[60vh] w-full rounded-lg border border-ink-200 bg-white"
          />
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-ink-200/60 bg-white px-5 py-3">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
