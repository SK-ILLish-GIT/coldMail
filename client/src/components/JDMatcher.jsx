import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { api } from "../lib/api.js";
import { useJd } from "../context/jdContext.jsx";
import { useTailorTarget } from "../context/tailorTarget.jsx";
import Spinner from "./Spinner.jsx";

/**
 * Collapsible panel that asks Gemini to pick the best template + resume for
 * a given Job Description. Lives at the top of Compose as the explicit
 *"Step 0" entry point. The actual selection plumbing lives in the parent
 * (EmailForm) via the onMatch callback — this component is purely the UI +
 * API call. The"Tailor template" button deep-links to the Tailor tab
 * (single canonical entry) instead of opening yet another modal.
 *
 * Props:
 * - templates: [{id, name, tags}]
 * - resumes: [{id, name, tags}]
 * - aiEnabled: boolean
 * - onMatch: ({ templateId, resumeId, reasoning }) => void
 * - activeTemplateId: currently selected template id (for"Tailor template")
 */
export default function JDMatcher({
  templates = [],
  resumes = [],
  aiEnabled = false,
  onMatch,
  activeTemplateId = "",
}) {
  const { jd, setJd } = useJd();
  const { requestTailorTemplate } = useTailorTarget();
  const libraryReady = templates.length > 0 && resumes.length > 0;
  const libraryEmpty = templates.length === 0 && resumes.length === 0;
  // Auto-open when a JD is already pasted OR when the library is set up
  // (templates AND resumes present). Empty library = leave it collapsed.
  const [open, setOpen] = useState(() => jd.trim().length > 20 || libraryReady);
  // Reflect library readiness on first arrival (e.g. user lands here before
  // templates/resumes have finished loading).
  useEffect(() => {
    if (libraryReady && !open && !jd.trim()) setOpen(true);
    // intentionally only react to libraryReady becoming true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryReady]);

  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const canRun = aiEnabled && !libraryEmpty && jd.trim().length > 20 && !busy;
  const activeTemplate = activeTemplateId
    ? templates.find((t) => t.id === activeTemplateId)
    : null;
  const canTailor =
    aiEnabled && Boolean(activeTemplate) && jd.trim().length > 20;

  const run = async () => {
    if (!canRun) return;
    setBusy(true);
    setLastResult(null);
    try {
      const result = await api.matchJD({
        jobDescription: jd.trim(),
        templates: templates.map((t) => ({
          id: t.id,
          name: t.name,
          tags: t.tags || [],
        })),
        resumes: resumes.map((r) => ({
          id: r.id,
          name: r.name,
          tags: r.tags || [],
        })),
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
        toast.success(`AI picked"${pickedT}" +"${pickedR}".`);
      } else if (pickedT || pickedR) {
        toast.success(
          `AI picked ${pickedT ? `template"${pickedT}"` : `resume"${pickedR}"`}.`,
        );
      } else {
        toast(`No good match — review your library tags.`, { icon: "ℹ️" });
      }
    } catch (err) {
      toast.error(err.message || "JD match failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="surface-brand rounded-lg border border-ui-border/80">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="icon-brand flex h-7 w-7 items-center justify-center rounded-md">
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
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ui-fg">
              Step 0 · Match by JD
              <span className="ml-1 font-normal text-ui-fg-muted">
                (optional)
              </span>
            </p>
            <p className="text-2xs text-ui-fg-muted">
              Paste a JD; AI picks the best-fit template + resume from your
              library.
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
          className={`h-4 w-4 text-ui-fg-muted transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="anim-in space-y-3 border-t border-ui-border/70 px-4 py-3">
          {!aiEnabled && (
            <p className="hint text-rose-600 dark:text-rose-400">
              AI is disabled on the server — set{""}
              <span className="font-mono">GEMINI_API_KEY</span> to enable this.
            </p>
          )}
          {libraryEmpty && (
            <p className="hint text-amber-600 dark:text-amber-400">
              Add at least one template or resume first, otherwise there&apos;s
              nothing to pick from.
            </p>
          )}
          <div>
            <label className="label" htmlFor="jd-text">
              Job description
            </label>
            <textarea
              id="jd-text"
              rows={6}
              className="input font-mono text-xs leading-snug"
              placeholder="Paste the full JD here..."
              value={jd}
              onChange={(e) => setJd(e.target.value)}
            />
            {jd.trim().length > 0 && (
              <p className="hint mt-1">{jd.trim().length} chars</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-secondary btn-xs"
              onClick={run}
              disabled={!canRun}
              title={
                !aiEnabled
                  ? "AI disabled on the server"
                  : libraryEmpty
                    ? "Add a template or resume first"
                    : jd.trim().length < 20
                      ? "Paste a longer JD"
                      : "Ask AI to pick the best fit"
              }
            >
              {busy && <Spinner />}
              {busy ? "Analysing..." : "Find best fit"}
            </button>
            <button
              type="button"
              className="btn-ghost btn-xs text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:ring-brand-800/50 dark:bg-brand-900/20 dark:hover:bg-brand-900/40"
              onClick={() => requestTailorTemplate(activeTemplate)}
              disabled={!canTailor}
              title={
                !aiEnabled
                  ? "AI disabled on the server"
                  : !activeTemplate
                    ? "Pick a template below first"
                    : jd.trim().length < 20
                      ? "Paste a longer JD"
                      : "Open the Tailor tab with this template + JD pre-filled"
              }
            >
              Tailor template →
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
