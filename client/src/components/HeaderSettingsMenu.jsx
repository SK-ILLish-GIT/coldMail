import { useEffect, useRef, useState } from 'react';

import GeminiModelPicker from './GeminiModelPicker.jsx';
import StatusPill from './StatusPill.jsx';
import ThemeToggle from './ThemeToggle.jsx';

export default function HeaderSettingsMenu({
  health,
  theme,
  onToggleTheme,
  onAiPillClick,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const dbState = health.loading ? 'loading' : health.ok ? 'ok' : 'down';
  const aiState = health.loading ? 'loading' : health.features?.aiEnrich ? 'ok' : 'off';

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200/70 bg-white text-ink-600 shadow-sm transition hover:bg-ink-50 hover:text-ink-900 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700 dark:hover:text-white"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Settings and status"
        title="Settings"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden
        >
          <circle cx="5" cy="12" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-[min(100vw-2rem,20rem)] rounded-lg border border-ink-200/80 bg-white py-2 shadow-lg dark:border-ink-700 dark:bg-ink-900"
        >
          <p className="px-3 pb-1 text-2xs font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500">
            Status
          </p>
          <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
            <StatusPill
              label="DB"
              state={dbState}
              title={
                health.loading
                  ? 'Checking server health...'
                  : health.ok
                    ? `MongoDB connected (${health.storage || 'mongodb'})`
                    : 'Server or database unreachable'
              }
            />
            <button
              type="button"
              onClick={onAiPillClick}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              title={
                health.features?.aiEnrich
                  ? 'AI enabled (GEMINI_API_KEY set)'
                  : 'AI off — click to copy GEMINI_API_KEY='
              }
            >
              <StatusPill label="AI" state={aiState} />
            </button>
          </div>

          {health.features?.aiEnrich ? (
            <>
              <div className="border-t border-ink-100 dark:border-ink-800" />
              <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500">
                AI model
              </p>
              <div className="px-1 pb-2">
                <GeminiModelPicker
                  aiEnabled
                  variant="menu"
                  onModelChange={() => setOpen(false)}
                />
              </div>
            </>
          ) : null}

          <div className="border-t border-ink-100 dark:border-ink-800" />
          <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500">
            Appearance
          </p>
          <div className="flex items-center justify-between gap-2 px-3 pb-1">
            <span className="text-xs text-ink-600 dark:text-ink-300">
              {theme === 'dark' ? 'Dark mode' : 'Light mode'}
            </span>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
