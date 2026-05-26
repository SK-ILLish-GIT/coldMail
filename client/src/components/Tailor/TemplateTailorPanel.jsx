import { useEffect, useRef, useState } from 'react';

import { tailorApi } from '../../lib/tailorApi.js';
import { useJd } from '../../lib/jdContext.jsx';
import { TagInput } from '../Tags.jsx';

const TARGET_LABEL = (target) => {
  if (target === 'subject') return 'Subject line';
  const m = /^paragraph:(\d+)$/.exec(target || '');
  return m ? `Paragraph ${Number(m[1]) + 1}` : target;
};

function SuggestionCard({ suggestion, busy, onDecide }) {
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState('');

  const submit = () => {
    if (!editText.trim()) return;
    onDecide('edit', editText.trim());
    setEditOpen(false);
    setEditText('');
  };

  return (
    <div className="surface anim-in p-4 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <span className="pill-ink">{TARGET_LABEL(suggestion.target)}</span>
        <span className="pill-emerald">impact {suggestion.impact}/10</span>
      </div>
      {suggestion.reason ? (
        <p className="mt-3 text-xs text-ink-600 dark:text-ink-300">
          <span className="font-semibold">Why: </span>
          {suggestion.reason}
        </p>
      ) : null}

      {suggestion.targetText ? (
        <div className="mt-3">
          <p className="label">Before</p>
          <p className="whitespace-pre-wrap rounded-md bg-rose-50/70 px-3 py-2 font-mono text-xs text-ink-700 dark:bg-rose-900/20 dark:text-ink-200">
            {suggestion.targetText}
          </p>
        </div>
      ) : null}

      <div className="mt-3">
        <p className="label">After</p>
        <p className="whitespace-pre-wrap rounded-md bg-emerald-50/70 px-3 py-2 font-mono text-xs text-ink-700 dark:bg-emerald-900/20 dark:text-ink-100">
          {suggestion.previewText}
        </p>
      </div>

      {suggestion.atsKeywords?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestion.atsKeywords.map((k, i) => (
            <span key={`${k}-${i}`} className="pill-brand">{k}</span>
          ))}
        </div>
      ) : null}

      {editOpen ? (
        <div className="mt-3 rounded-md border border-ink-200/70 bg-white p-3 dark:border-ink-700 dark:bg-ink-900">
          <label className="label">How should I revise this?</label>
          <textarea
            className="input-mono h-20 resize-y"
            placeholder="e.g. mention Kubernetes, sound more casual, drop the buzzwords..."
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            autoFocus
          />
          <div className="mt-2 flex justify-end gap-2">
            <button className="btn-ghost btn-xs" onClick={() => { setEditOpen(false); setEditText(''); }} disabled={busy}>
              Cancel
            </button>
            <button className="btn-primary btn-xs" onClick={submit} disabled={busy || !editText.trim()}>
              Revise
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => onDecide('approve')} disabled={busy}>
            Approve &amp; apply
          </button>
          <button className="btn-secondary" onClick={() => setEditOpen(true)} disabled={busy}>
            Edit
          </button>
          <button className="btn-ghost" onClick={() => onDecide('reject')} disabled={busy}>
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryItem({ suggestion, decision }) {
  const tone =
    decision === 'applied' || decision === 'refined-applied'
      ? 'pill-emerald'
      : decision === 'rejected'
        ? 'pill-rose'
        : decision === 'failed'
          ? 'pill-rose'
          : 'pill-amber';
  const label =
    decision === 'applied' || decision === 'refined-applied' ? 'Applied'
      : decision === 'rejected' ? 'Rejected'
      : decision === 'failed' ? 'Failed'
      : decision;
  return (
    <div className="surface p-3 opacity-90">
      <div className="flex flex-wrap items-center gap-2">
        <span className={tone}>{label}</span>
        <span className="pill-ink">{TARGET_LABEL(suggestion.target)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-xs text-ink-600 dark:text-ink-300">
        {suggestion.previewText}
      </p>
    </div>
  );
}

const DEFAULT_SENIORITY = 'Entry Level (1 YOE)';
const SENIORITY_OPTIONS = [
  'Entry Level (1 YOE)',
  'Junior (1-3 YOE)',
  'Mid-level (3-5 YOE)',
  'Senior (5-8 YOE)',
  'Staff / Principal (8+ YOE)',
];

export default function TemplateTailorPanel({
  template,
  initialJobDescription = '',
  initialTargetRole = '',
  initialTargetCompany = '',
  initialSeniority = DEFAULT_SENIORITY,
  // When true, render inline (no modal backdrop / no header bar). Used by the
  // Tailor tab where the right pane hosts the flow directly. Modal callers
  // (TemplateLibrary, JDMatcher) leave this falsy.
  embedded = false,
  // When true, skip rendering the internal JD/Role/Company/Seniority form.
  // The caller is expected to have collected those values and started the
  // session itself (via `autoStart`).
  hideInputsForm = false,
  // When true, automatically start the session as soon as the JD + template
  // are ready. Used together with hideInputsForm by the Tailor tab.
  autoStart = false,
  onClose,
  onSaved,
}) {
  // Shared JD: if the caller passes a non-empty initialJobDescription, seed it
  // into the global JD so other surfaces see it too. Otherwise, just read.
  const { jd, setJd } = useJd();
  useEffect(() => {
    if (initialJobDescription && initialJobDescription.trim() && !jd.trim()) {
      setJd(initialJobDescription);
    }
    // intentionally only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [targetRole, setTargetRole] = useState(initialTargetRole);
  const [targetCompany, setTargetCompany] = useState(initialTargetCompany);
  const [seniority, setSeniority] = useState(initialSeniority);
  const [starting, setStarting] = useState(false);
  const [session, setSession] = useState(null);
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saveTags, setSaveTags] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState(null);
  // 'suggestions' = chat-iterative approval flow (default)
  // 'preview'     = live snapshot of the working subject + body so the user
  //                 can see what the saved template will look like.
  const [view, setView] = useState('suggestions');
  const chatBottomRef = useRef(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history, current, done]);

  // Auto-start once when caller passes `autoStart` and the inputs are ready.
  // Used by the Tailor tab where the right pane collects JD/role/company/seniority
  // up front, then mounts the panel.
  useEffect(() => {
    if (autoStart && !session && !starting && jd.trim()) {
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, session, starting, jd]);

  const start = async () => {
    if (!jd.trim()) {
      setError('Paste a job description first.');
      return;
    }
    setError('');
    setStarting(true);
    try {
      const result = await tailorApi.startTemplateSession({
        templateId: template.id,
        jobDescription: jd,
        targetRole: targetRole || undefined,
        targetCompany: targetCompany || undefined,
        seniority: seniority || undefined,
      });
      setSession(result);
      const date = new Date().toISOString().slice(0, 10);
      setSaveName(
        [template.name, targetCompany, date].filter(Boolean).join(' — ')
      );
      // Seed save-tags from original + obvious hints
      setSaveTags(
        [...(template.tags || []), targetCompany, targetRole, seniority]
          .filter(Boolean)
          .slice(0, 10)
      );
      if (result.firstSuggestion) {
        setCurrent(result.firstSuggestion);
      } else {
        setDone(true);
      }
    } catch (err) {
      setError(err.message || 'Failed to start session.');
    } finally {
      setStarting(false);
    }
  };

  const decide = async (decision, editInstruction = '') => {
    if (!session || !current) return;
    setBusy(true);
    setError('');
    try {
      const result = await tailorApi.templateDecide(session.sessionId, {
        suggestionId: current.id,
        decision,
        editInstruction,
      });
      if (result.result === 'refined') {
        setCurrent(result.next);
      } else {
        setHistory((h) => [...h, { suggestion: current, decision: result.result }]);
        setSession((s) => ({ ...s, ...result.state }));
        if (result.next) {
          setCurrent(result.next);
        } else {
          setCurrent(null);
          setDone(true);
        }
        if (result.result === 'failed') setError(result.error || 'Could not apply.');
      }
    } catch (err) {
      setError(err.message || 'Failed to decide.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!session || !saveName.trim()) return;
    setSaving(true);
    setError('');
    try {
      const created = await tailorApi.saveTemplateSession(session.sessionId, {
        name: saveName.trim(),
        tags: saveTags,
      });
      setSavedTemplate(created);
      onSaved?.(created);
    } catch (err) {
      setError(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <>
      {session ? (
        <div className="mb-3 flex items-center gap-1 border-b border-ink-200/70 px-1 dark:border-ink-800">
          <button
            type="button"
            className={`px-3 py-1.5 text-xs font-medium transition ${
              view === 'suggestions'
                ? 'border-b-2 border-brand-500 text-brand-700 dark:text-brand-300'
                : 'text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200'
            }`}
            onClick={() => setView('suggestions')}
          >
            Suggestions ({session.pending} pending)
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 text-xs font-medium transition ${
              view === 'preview'
                ? 'border-b-2 border-brand-500 text-brand-700 dark:text-brand-300'
                : 'text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200'
            }`}
            onClick={() => setView('preview')}
          >
            Preview
          </button>
        </div>
      ) : null}
      <div className="flex-1 space-y-4 overflow-y-auto">
        {view === 'preview' && session ? (
          <PreviewView session={session} />
        ) : !session && hideInputsForm ? (
          <div className="surface p-4 text-xs text-ink-500 dark:text-ink-400">
            {starting ? 'Starting template tailoring…' : error || 'Waiting to start.'}
          </div>
        ) : !session ? (
            <div className="space-y-3">
              <div>
                <label className="label">Job description</label>
                <textarea
                  className="input-mono h-44 resize-y"
                  placeholder="Paste the JD here..."
                  value={jd}
                  onChange={(e) => setJd(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Role (optional)</label>
                  <input className="input" value={targetRole} onChange={(e) => setTargetRole(e.target.value)} placeholder="e.g. SDE intern" />
                </div>
                <div>
                  <label className="label">Company (optional)</label>
                  <input className="input" value={targetCompany} onChange={(e) => setTargetCompany(e.target.value)} placeholder="e.g. Stripe" />
                </div>
                <div className="col-span-2">
                  <label className="label">Seniority</label>
                  <select className="input" value={seniority} onChange={(e) => setSeniority(e.target.value)}>
                    {SENIORITY_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button className="btn-gradient w-full" onClick={start} disabled={starting || !jd.trim()}>
                {starting ? 'Starting...' : 'Start tailoring'}
              </button>
              {error ? <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((h, i) => (
                <HistoryItem key={`${h.suggestion?.id || 'h'}-${i}`} suggestion={h.suggestion} decision={h.decision} />
              ))}
              {current && !done ? (
                <SuggestionCard suggestion={current} busy={busy} onDecide={decide} />
              ) : null}
              {done ? (
                savedTemplate ? (
                  <div className="surface p-4">
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                      Saved as new template: {savedTemplate.name}
                    </p>
                    <p className="mt-1 text-xs text-ink-600 dark:text-ink-300">
                      It now appears in your Templates library and can be auto-picked by JDMatcher on matching JDs.
                    </p>
                    <button className="btn-primary mt-3" onClick={onClose}>Done</button>
                  </div>
                ) : (
                  <div className="surface p-4 space-y-3">
                    <p className="text-sm font-semibold text-ink-900 dark:text-white">
                      Save as a new template
                    </p>
                    <div>
                      <label className="label">Name</label>
                      <input className="input" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="My template — Stripe SDE · 2026-05-23" />
                    </div>
                    <div>
                      <label className="label">Tags</label>
                      <TagInput tags={saveTags} onChange={setSaveTags} placeholder="backend, kubernetes..." />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
                      <button className="btn-primary" onClick={save} disabled={saving || !saveName.trim()}>
                        {saving ? 'Saving...' : 'Save as new template'}
                      </button>
                    </div>
                  </div>
                )
              ) : null}
              {error ? <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}
            </div>
          )}
        <div ref={chatBottomRef} />
      </div>
      {session ? (
        <p className="mt-3 border-t border-ink-200/70 pt-2 text-2xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
          {session.applied} applied · {session.pending} pending · {session.totalSuggestions} total
        </p>
      ) : null}
    </>
  );

  if (embedded) {
    return <div className="flex h-full flex-col">{content}</div>;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink-900/60 px-4 py-8 backdrop-blur-sm dark:bg-black/70">
      <div className="card flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-ink-200/70 px-5 py-3 dark:border-ink-800">
          <div>
            <h2 className="text-base font-semibold text-ink-900 dark:text-white">
              Tailor template — {template.name}
            </h2>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              Saves a new template; the original stays untouched.
            </p>
          </div>
          <button className="btn-ghost btn-xs" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{content}</div>
      </div>
    </div>
  );
}

// Wrap the body in a minimal HTML shell so the iframe has email-paper
// styling (white background, sensible font) regardless of host theme. We
// preserve placeholders like `{{firstName}}` verbatim (no var substitution)
// so the user can see where personalization will land at send time.
function buildPreviewSrcDoc(body) {
  const safeBody = String(body || '');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><style>
    html,body{margin:0;padding:0;background:#ffffff;color:#1f2937;}
    body{font:15px/1.65 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:18px 20px;}
    a{color:#2563eb;}
    p{margin:0 0 14px;}
  </style></head><body>${safeBody}</body></html>`;
}

function PreviewView({ session }) {
  const empty = !session.body?.trim();
  return (
    <div className="surface p-4">
      <p className="label">Subject</p>
      <p className="rounded-md border border-ink-200/70 bg-white px-3 py-2 text-sm font-medium text-ink-900 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100">
        {session.subject || <em className="text-ink-400">(empty)</em>}
      </p>
      <p className="label mt-4">Body</p>
      {empty ? (
        <div className="rounded-md border border-ink-200/70 bg-white px-3 py-6 text-center text-xs text-ink-400 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-500">
          (empty body)
        </div>
      ) : (
        <iframe
          title="Template preview"
          srcDoc={buildPreviewSrcDoc(session.body)}
          sandbox=""
          className="preview-frame h-[420px] w-full rounded-md border border-ink-200/70 bg-white dark:border-ink-700"
        />
      )}
      <p className="mt-3 text-2xs text-ink-400 dark:text-ink-500">
        Reflects approved edits so far. Placeholders like <code>{'{{firstName}}'}</code> stay intact and will be filled when you send.
      </p>
    </div>
  );
}
