import { useEffect, useMemo, useRef, useState } from 'react';

import { tailorApi } from '../../lib/tailorApi.js';
import { useJd } from '../../lib/jdContext.jsx';
import Chat from './Chat.jsx';
import FinalActions from './FinalActions.jsx';
import ScorePanel from './ScorePanel.jsx';

const SENIORITY_OPTIONS = [
  'Entry Level (1 YOE)',
  'Junior (1-3 YOE)',
  'Mid-level (3-5 YOE)',
  'Senior (5-8 YOE)',
  'Staff / Principal (8+ YOE)',
];
const DEFAULT_SENIORITY = SENIORITY_OPTIONS[0];

export default function TailorPage({ aiConfigured }) {
  const [status, setStatus] = useState(null);
  const { jd, setJd } = useJd();
  const [targetRole, setTargetRole] = useState('');
  const [targetCompany, setTargetCompany] = useState('');
  const [seniority, setSeniority] = useState(DEFAULT_SENIORITY);

  const [starting, setStarting] = useState(false);
  const [session, setSession] = useState(null); // { sessionId, ... }
  const [current, setCurrent] = useState(null); // active suggestion
  const [done, setDone] = useState(false);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const chatBottomRef = useRef(null);

  useEffect(() => {
    tailorApi.status().then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, current, done]);

  const aiReady = aiConfigured || status?.aiConfigured;

  const handleStart = async () => {
    if (!jd.trim()) {
      setError('Paste a job description first.');
      return;
    }
    setError('');
    setStarting(true);
    setMessages([
      {
        role: 'system',
        text: 'Analyzing your resume and the job description...',
      },
    ]);
    try {
      const result = await tailorApi.startSession({
        // cvPath omitted — server uses CV_DEFAULT_PATH from server/.env
        jobDescription: jd,
        targetRole: targetRole || undefined,
        targetCompany: targetCompany || undefined,
        seniority: seniority || undefined,
      });
      setSession(result);
      if (result.firstSuggestion) {
        setCurrent(result.firstSuggestion);
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: `I scanned your resume and prepared ${result.totalSuggestions} improvement${
              result.totalSuggestions === 1 ? '' : 's'
            }. Let's review them one by one.`,
          },
        ]);
      } else {
        setDone(true);
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            text: 'No suggestions needed — your resume already matches this JD well.',
          },
        ]);
      }
    } catch (err) {
      setError(err.message || 'Failed to start session.');
      setMessages([]);
    } finally {
      setStarting(false);
    }
  };

  const pushHistory = (suggestion, decision, note = '') => {
    setMessages((m) => [
      ...m,
      {
        role: 'history',
        suggestion,
        decision,
        note,
      },
    ]);
  };

  const handleDecide = async (decision, editInstruction = '', overrideSuggestion = null) => {
    if (!session) return;
    const target = overrideSuggestion || current;
    if (!target) return;
    const isRedecide = Boolean(overrideSuggestion);
    setBusy(true);
    setError('');
    try {
      const result = await tailorApi.decide(session.sessionId, {
        suggestionId: target.id,
        decision,
        editInstruction,
      });
      // Update history entries in place when the user re-decided one of them
      // so the chip + buttons reflect the new state without duplicating cards.
      if (isRedecide) {
        setMessages((m) =>
          m.map((msg) =>
            msg.role === 'history' && msg.suggestion?.id === target.id
              ? {
                  ...msg,
                  suggestion: result.next?.id === target.id ? result.next : msg.suggestion,
                  decision: result.result,
                }
              : msg
          )
        );
        setSession((s) => ({ ...s, ...result.state }));
        // If the redecision turned this into a pending re-edit, surface it as
        // the active card so the user can approve it again.
        if (result.result === 'refined' && result.next?.id === target.id) {
          setCurrent(result.next);
          setDone(false);
        }
        if (result.result === 'failed') {
          setError(result.error || 'Suggestion could not be applied.');
        }
        return;
      }
      if (result.result === 'refined') {
        setCurrent(result.next);
        setMessages((m) => [
          ...m,
          { role: 'user', text: editInstruction },
          { role: 'assistant', text: 'Here is a revised draft based on your instruction.' },
        ]);
      } else {
        pushHistory(current, result.result, '');
        setSession((s) => ({ ...s, ...result.state }));
        if (result.next) {
          setCurrent(result.next);
        } else {
          setCurrent(null);
          setDone(true);
          setMessages((m) => [
            ...m,
            {
              role: 'assistant',
              text:
                'All suggestions reviewed. You can compile the PDF or download the updated .tex files below.',
            },
          ]);
        }
        if (result.result === 'failed') {
          setError(result.error || 'Suggestion could not be applied.');
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to process decision.');
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async () => {
    if (!session) return;
    if (!confirm('Restore all .tex files to their original state? This undoes every applied change in this session.')) {
      return;
    }
    setBusy(true);
    try {
      const r = await tailorApi.rollback(session.sessionId);
      setSession((s) => ({ ...s, ...r.state }));
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: `Rolled back ${r.restored.length} file(s). You can re-approve any earlier suggestion.`,
        },
      ]);
      // Reload first pending suggestion
      const np = await tailorApi.next(session.sessionId);
      if (np.done) {
        setCurrent(null);
        setDone(true);
      } else {
        setCurrent(np.suggestion);
        setDone(false);
      }
    } catch (err) {
      setError(err.message || 'Rollback failed.');
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setSession(null);
    setCurrent(null);
    setDone(false);
    setMessages([]);
    setError('');
  };

  const scoreDelta = useMemo(() => {
    if (!session) return null;
    return {
      initial: session.initialScores,
      current: session.currentScores,
    };
  }, [session]);

  if (!aiReady) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-ink-900 dark:text-white">
          Resume Tailor is offline
        </h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
          Set <code className="rounded bg-ink-100 px-1 py-0.5 dark:bg-ink-800">GEMINI_API_KEY</code> in{' '}
          <code className="rounded bg-ink-100 px-1 py-0.5 dark:bg-ink-800">server/.env</code> and
          restart the server to enable JD-aware resume editing.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,360px),1fr]">
      <aside className="space-y-4">
        <div className="card p-5">
          <h2 className="text-base font-semibold text-ink-900 dark:text-white">
            Tailor your resume
          </h2>
          <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
            Paste the JD, optionally add target hints, and I&apos;ll walk you through
            edits one suggestion at a time.
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="label">Job description</label>
              <textarea
                className="input-mono h-48 resize-y"
                placeholder="Paste the full JD here..."
                value={jd}
                onChange={(e) => setJd(e.target.value)}
                disabled={Boolean(session)}
              />
              {jd && !session ? (
                <p className="mt-1 text-2xs text-ink-400 dark:text-ink-500">
                  Same JD will pre-fill in Compose &amp; template AI Tailor.
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Role (optional)</label>
                <input
                  className="input"
                  placeholder="e.g. Senior Backend"
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  disabled={Boolean(session)}
                />
              </div>
              <div>
                <label className="label">Company (optional)</label>
                <input
                  className="input"
                  placeholder="e.g. Stripe"
                  value={targetCompany}
                  onChange={(e) => setTargetCompany(e.target.value)}
                  disabled={Boolean(session)}
                />
              </div>
              <div className="col-span-2">
                <label className="label">Seniority</label>
                <select
                  className="input"
                  value={seniority}
                  onChange={(e) => setSeniority(e.target.value)}
                  disabled={Boolean(session)}
                >
                  {SENIORITY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!session ? (
              <button
                className="btn-gradient w-full"
                disabled={starting || !jd.trim()}
                onClick={handleStart}
              >
                {starting ? 'Starting...' : 'Start tailoring'}
              </button>
            ) : (
              <button className="btn-secondary w-full" onClick={restart} disabled={busy}>
                Start over (new JD)
              </button>
            )}
            {error ? (
              <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>
            ) : null}
          </div>
        </div>

        {scoreDelta ? (
          <ScorePanel initial={scoreDelta.initial} current={scoreDelta.current} />
        ) : null}
      </aside>

      <section className="card flex min-h-[60vh] flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-ink-200/70 px-5 py-3 dark:border-ink-800">
          <h3 className="text-sm font-semibold text-ink-900 dark:text-white">
            Tailoring conversation
          </h3>
          {session ? (
            <span className="pill-ink">
              {session.applied} applied · {session.pending} pending ·{' '}
              {session.totalSuggestions} total
            </span>
          ) : (
            <span className="pill-ink">idle</span>
          )}
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!session && !messages.length ? (
            <EmptyState />
          ) : (
            <Chat
              messages={messages}
              current={current}
              done={done}
              busy={busy}
              onDecide={handleDecide}
              onRedecide={(suggestion, decision, editInstruction) =>
                handleDecide(decision, editInstruction || '', suggestion)
              }
            />
          )}
          {done && session ? (
            <FinalActions
              session={session}
              onRollback={handleRollback}
              onCompileMessage={(text) =>
                setMessages((m) => [...m, { role: 'assistant', text }])
              }
            />
          ) : null}
          <div ref={chatBottomRef} />
        </div>
      </section>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md text-center text-sm text-ink-500 dark:text-ink-400">
        <p className="text-base font-semibold text-ink-700 dark:text-ink-200">
          Paste a JD on the left, then press <em>Start tailoring</em>.
        </p>
        <p className="mt-2">
          I&apos;ll read your <code>.tex</code> sources, score them against the JD,
          and propose targeted edits — bullet by bullet. You approve, reject, or
          edit each one before it touches disk.
        </p>
      </div>
    </div>
  );
}
