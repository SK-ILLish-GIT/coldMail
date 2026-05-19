import { useState } from 'react';
import toast from 'react-hot-toast';

import { api } from '../lib/api.js';

/**
 * Collapsible panel that asks Gemini to pick the best template + resume for
 * a given Job Description. The actual selection plumbing lives in the parent
 * (EmailForm) via the onMatch callback — this component is purely the UI +
 * API call.
 *
 * Props:
 *  - templates: [{id, name, tags}]
 *  - resumes:   [{id, name, tags}]
 *  - aiEnabled: boolean
 *  - onMatch:   ({ templateId, resumeId, reasoning }) => void
 */
export default function JDMatcher({ templates = [], resumes = [], aiEnabled = false, onMatch }) {
  const [open, setOpen] = useState(false);
  const [jd, setJd] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const libraryEmpty = templates.length === 0 && resumes.length === 0;
  const canRun = aiEnabled && !libraryEmpty && jd.trim().length > 20 && !busy;

  const run = async () => {
    if (!canRun) return;
    setBusy(true);
    setLastResult(null);
    try {
      const result = await api.matchJD({
        jobDescription: jd.trim(),
        // Only send what the model needs — never bodies or PDF bytes.
        templates: templates.map((t) => ({ id: t.id, name: t.name, tags: t.tags || [] })),
        resumes: resumes.map((r) => ({ id: r.id, name: r.name, tags: r.tags || [] })),
      });
      setLastResult(result);
      onMatch?.(result);

      const pickedT = result.templateId
        ? templates.find((t) => t.id === result.templateId)?.name
        : null;
      const pickedR = result.resumeId
        ? resumes.find((r) => r.id === result.resumeId)?.name
        : null;
      if (pickedT && pickedR) {
        toast.success(`AI picked "${pickedT}" + "${pickedR}".`);
      } else if (pickedT || pickedR) {
        toast.success(`AI picked ${pickedT ? `template "${pickedT}"` : `resume "${pickedR}"`}.`);
      } else {
        toast(`No good match — review your library tags.`, { icon: 'ℹ️' });
      }
    } catch (err) {
      toast.error(err.message || 'JD match failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-ink-200/80 bg-gradient-to-br from-brand-50/40 to-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-brand text-white">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
            >
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">Match by JD</p>
            <p className="text-2xs text-ink-500">
              Paste a job description — AI picks the best template + resume from your library.
            </p>
          </div>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 text-ink-500 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="anim-in space-y-3 border-t border-ink-200/60 px-4 py-3">
          {!aiEnabled && (
            <p className="hint text-rose-600">
              AI is disabled on the server — set <span className="font-mono">GEMINI_API_KEY</span> to enable this.
            </p>
          )}
          {libraryEmpty && (
            <p className="hint text-amber-600">
              Add at least one template or resume first, otherwise there's nothing to pick from.
            </p>
          )}
          <div>
            <label className="label" htmlFor="jd-text">Job description</label>
            <textarea
              id="jd-text"
              rows={6}
              className="input font-mono text-xs leading-snug"
              placeholder="Paste the full JD here..."
              value={jd}
              onChange={(e) => setJd(e.target.value)}
            />
            <p className="hint mt-1">
              {jd.trim().length} chars · only template/resume names + tags are sent to the model, never bodies or PDFs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-secondary btn-xs"
              onClick={run}
              disabled={!canRun}
              title={
                !aiEnabled
                  ? 'AI disabled on the server'
                  : libraryEmpty
                    ? 'Add a template or resume first'
                    : jd.trim().length < 20
                      ? 'Paste a longer JD'
                      : 'Ask AI to pick the best fit'
              }
            >
              {busy ? 'Analysing...' : 'Find best fit'}
            </button>
            {lastResult?.reasoning && (
              <span className="hint italic">{lastResult.reasoning}</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
