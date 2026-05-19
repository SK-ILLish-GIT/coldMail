import { useEffect, useState } from 'react';

import { api } from './lib/api.js';
import EmailForm from './components/EmailForm.jsx';
import TemplateLibrary from './components/TemplateLibrary.jsx';
import ResumeLibrary from './components/ResumeLibrary.jsx';
import SentLog from './components/SentLog.jsx';
import StatusPill from './components/StatusPill.jsx';

const TABS = [
  { id: 'compose', label: 'Compose' },
  { id: 'templates', label: 'Templates' },
  { id: 'resumes', label: 'Resumes' },
  { id: 'log', label: 'Drafts Log' },
];

export default function App() {
  const [tab, setTab] = useState('compose');
  const [activeTemplate, setActiveTemplate] = useState(null);
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

  const handleUseTemplate = (tpl) => {
    setActiveTemplate(tpl);
    setTab('compose');
  };

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-ink-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-brand text-white shadow-md">
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
            <div>
              <h1 className="text-base font-semibold leading-tight text-ink-900">coldMail</h1>
              <p className="text-xs text-ink-500">
                Personalised email campaigns, sent right.
              </p>
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
            <StatusPill
              label="AI"
              state={
                health.loading
                  ? 'loading'
                  : health.features?.aiEnrich
                    ? 'ok'
                    : 'off'
              }
              title={
                health.features?.aiEnrich
                  ? 'AI email finder enabled (GEMINI_API_KEY set)'
                  : 'AI email finder disabled — set GEMINI_API_KEY in server/.env'
              }
            />
            <nav className="tabs ml-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={['tab', tab === t.id && 'tab-active'].filter(Boolean).join(' ')}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {tab === 'compose' && (
          <EmailForm
            initialTemplate={activeTemplate}
            onClearTemplate={() => setActiveTemplate(null)}
            aiEnabled={Boolean(health.features?.aiEnrich)}
          />
        )}
        {tab === 'templates' && <TemplateLibrary onUseTemplate={handleUseTemplate} />}
        {tab === 'resumes' && <ResumeLibrary />}
        {tab === 'log' && <SentLog />}
      </main>

      <footer className="mx-auto max-w-6xl px-6 pb-10 text-center text-xs text-ink-400">
        coldMail · React + Express + Nodemailer · MongoDB Atlas
      </footer>
    </div>
  );
}
