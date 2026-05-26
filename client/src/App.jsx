import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { api } from './lib/api.js';
import { TailorTargetProvider } from './lib/tailorTarget.jsx';
import EmailForm from './components/EmailForm.jsx';
import TemplateLibrary from './components/TemplateLibrary.jsx';
import ResumeLibrary from './components/ResumeLibrary.jsx';
import SentLog from './components/SentLog.jsx';
import StatusPill from './components/StatusPill.jsx';
import TailorPage from './components/Tailor/TailorPage.jsx';
import ThemeToggle, { useTheme } from './components/ThemeToggle.jsx';

const TABS = [
  { id: 'compose', label: 'Compose' },
  { id: 'templates', label: 'Templates' },
  { id: 'resumes', label: 'Resumes' },
  { id: 'tailor', label: 'Tailor' },
  { id: 'log', label: 'Drafts Log' },
];

const TAB_IDS = new Set(TABS.map((t) => t.id));

// Hash-based tab routing: refreshing keeps the tab, browser back/forward
// works, deep-link to a tab from anywhere by setting `location.hash`.
function readTabFromHash() {
  if (typeof window === 'undefined') return 'compose';
  const hash = window.location.hash.replace(/^#/, '');
  return TAB_IDS.has(hash) ? hash : 'compose';
}

export default function App() {
  const [tab, setTabState] = useState(readTabFromHash);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [theme, setTheme] = useTheme();
  const [health, setHealth] = useState({
    loading: true,
    ok: false,
    storage: 'mongodb',
    features: { aiEnrich: false },
  });

  const refreshHealth = async () => {
    try {
      const h = await api.health();
      setHealth({ loading: false, ok: Boolean(h.ok), ...h });
    } catch {
      setHealth((prev) => ({ ...prev, loading: false, ok: false }));
    }
  };

  useEffect(() => {
    refreshHealth();
    const id = setInterval(refreshHealth, 60_000);
    return () => clearInterval(id);
  }, []);

  // Sync tab → URL hash, and listen for back/forward.
  useEffect(() => {
    const onHash = () => setTabState(readTabFromHash());
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, []);

  // Update the URL hash when the user clicks a tab. Use pushState so back
  // navigates to the previous tab instead of out of the app.
  const setTab = useCallback((next) => {
    if (!TAB_IDS.has(next)) return;
    if (typeof window !== 'undefined' && window.location.hash !== `#${next}`) {
      window.history.pushState(null, '', `#${next}`);
    }
    setTabState(next);
  }, []);

  // Initial hash sync: if the page loaded without a hash, write the default
  // so reloads stay stable.
  const hashSyncedRef = useRef(false);
  useEffect(() => {
    if (hashSyncedRef.current) return;
    hashSyncedRef.current = true;
    if (typeof window !== 'undefined' && !window.location.hash) {
      window.history.replaceState(null, '', `#${tab}`);
    }
  }, [tab]);

  const handleUseTemplate = (tpl) => {
    setActiveTemplate(tpl);
    setTab('compose');
  };

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  // Click handler for the AI status pill: copy the env hint when AI is off
  // so the user can paste it straight into server/.env. Better than a static
  // tooltip that nobody reads.
  const handleAiPillClick = () => {
    if (health.features?.aiEnrich) return;
    const hint = 'GEMINI_API_KEY=';
    try {
      navigator.clipboard?.writeText(hint);
      toast.success('Copied GEMINI_API_KEY= — paste into server/.env, then restart.', {
        duration: 5000,
      });
    } catch {
      toast('Set GEMINI_API_KEY in server/.env, then restart.', { icon: 'ℹ️' });
    }
  };

  return (
    <TailorTargetProvider onRequestTab={setTab}>
      <div className="min-h-full">
        <header className="sticky top-0 z-30 border-b border-ink-200/70 bg-white/80 backdrop-blur-md
                          dark:border-ink-800 dark:bg-ink-950/70">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-3.5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-brand text-white shadow-md">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <path d="M2.5 6.5l9.5 6 9.5-6" />
                  <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
                </svg>
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-semibold leading-tight text-ink-900 dark:text-white">
                  coldMail
                </h1>
                <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                  Personalised email campaigns, sent right.
                </p>
              </div>
              {/* Theme toggle pinned next to the brand on mobile so it never
                  scrolls inside the tab strip. */}
              <div className="ml-auto sm:hidden">
                <ThemeToggle theme={theme} onToggle={toggleTheme} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                label="DB"
                state={
                  health.loading
                    ? 'loading'
                    : health.ok
                      ? 'ok'
                      : 'down'
                }
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
                onClick={handleAiPillClick}
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                title={
                  health.features?.aiEnrich
                    ? 'AI email finder enabled (GEMINI_API_KEY set)'
                    : 'AI is off — click to copy the env key prefix. Paste it into server/.env then restart.'
                }
              >
                <StatusPill
                  label="AI"
                  state={
                    health.loading
                      ? 'loading'
                      : health.features?.aiEnrich
                        ? 'ok'
                        : 'off'
                  }
                />
              </button>
              {/* Theme toggle on the right side on desktop only. */}
              <div className="hidden sm:block">
                <ThemeToggle theme={theme} onToggle={toggleTheme} />
              </div>
              <nav className="tabs tabs-scroll ml-1 max-w-full" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    role="tab"
                    aria-selected={tab === t.id}
                    className={['tab', 'whitespace-nowrap', tab === t.id && 'tab-active'].filter(Boolean).join(' ')}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          {tab === 'compose' && (
            <EmailForm
              initialTemplate={activeTemplate}
              onClearTemplate={() => setActiveTemplate(null)}
              aiEnabled={Boolean(health.features?.aiEnrich)}
            />
          )}
          {tab === 'templates' && <TemplateLibrary onUseTemplate={handleUseTemplate} />}
          {tab === 'resumes' && <ResumeLibrary />}
          {tab === 'tailor' && (
            <TailorPage
              aiConfigured={
                Boolean(health.features?.resumeTailor) ||
                Boolean(health.features?.aiEnrich)
              }
            />
          )}
          {tab === 'log' && <SentLog />}
        </main>

        <footer className="mx-auto max-w-6xl px-4 pb-10 text-center text-xs text-ink-400 sm:px-6 dark:text-ink-500">
          coldMail · React + Express + Nodemailer · MongoDB Atlas
        </footer>
      </div>
    </TailorTargetProvider>
  );
}
