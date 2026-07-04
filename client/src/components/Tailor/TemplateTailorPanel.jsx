import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { api } from "../../lib/api.js";
import {
  formatAiError as formatGeminiError,
  isAiQuotaError as isGeminiQuotaError,
} from "../../lib/aiError.js";
import { tailorApi } from "../../lib/tailorApi.js";
import {
  getStoredTemplateSessionId,
  setStoredTemplateSessionId,
} from "../../lib/tailorSessionStorage.js";
import { useJd } from "../../context/jdContext.jsx";
import AutoTagModal from "../AutoTagModal.jsx";
import Spinner from "../Spinner.jsx";
import { TagInput } from "../Tags.jsx";
import TemplateLivePreview, {
  TemplateTailorSplit,
} from "./TemplateLivePreview.jsx";

const TARGET_LABEL = (target) => {
  if (target === "subject") return "Subject line";
  const m = /^paragraph:(\d+)$/.exec(target || "");
  return m ? `Paragraph ${Number(m[1]) + 1}` : target;
};

function SuggestionCard({ suggestion, busy, onDecide }) {
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState("");

  const submit = () => {
    if (!editText.trim()) return;
    onDecide("edit", editText.trim());
    setEditOpen(false);
    setEditText("");
  };

  return (
    <div className="surface anim-in p-4 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <span className="pill-ink">{TARGET_LABEL(suggestion.target)}</span>
        <span className="pill-emerald">impact {suggestion.impact}/10</span>
      </div>
      {suggestion.reason ? (
        <p className="mt-3 text-xs text-ui-fg-subtle">
          <span className="font-semibold">Why: </span>
          {suggestion.reason}
        </p>
      ) : null}

      {suggestion.targetText ? (
        <div className="mt-3">
          <p className="label">Before</p>
          <p className="whitespace-pre-wrap rounded-md bg-rose-50/70 px-3 py-2 font-mono text-xs text-ui-fg dark:bg-rose-900/20">
            {suggestion.targetText}
          </p>
        </div>
      ) : null}

      <div className="mt-3">
        <p className="label">After</p>
        <p className="whitespace-pre-wrap rounded-md bg-emerald-50/70 px-3 py-2 font-mono text-xs text-ui-fg dark:bg-emerald-900/20">
          {suggestion.previewText}
        </p>
      </div>

      {suggestion.atsKeywords?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestion.atsKeywords.map((k, i) => (
            <span key={`${k}-${i}`} className="pill-brand">
              {k}
            </span>
          ))}
        </div>
      ) : null}

      {editOpen ? (
        <div className="mt-3 rounded-md border border-ui-border/70 bg-ui-panel p-3">
          <label className="label">How should I revise this?</label>
          <textarea
            className="input-mono h-20 resize-y"
            placeholder="e.g. mention Kubernetes, sound more casual, drop the buzzwords..."
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            autoFocus
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="btn-ghost btn-xs"
              onClick={() => {
                setEditOpen(false);
                setEditText("");
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="btn-primary btn-xs"
              onClick={submit}
              disabled={busy || !editText.trim()}
            >
              Revise
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="btn-primary"
            onClick={() => onDecide("approve")}
            disabled={busy}
          >
            Approve &amp; apply
          </button>
          <button
            className="btn-secondary"
            onClick={() => setEditOpen(true)}
            disabled={busy}
          >
            Edit
          </button>
          <button
            className="btn-ghost"
            onClick={() => onDecide("reject")}
            disabled={busy}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryItem({ suggestion, decision }) {
  const tone =
    decision === "applied" || decision === "refined-applied"
      ? "pill-emerald"
      : decision === "rejected"
        ? "pill-rose"
        : decision === "failed"
          ? "pill-rose"
          : "pill-amber";
  const label =
    decision === "applied" || decision === "refined-applied"
      ? "Applied"
      : decision === "rejected"
        ? "Rejected"
        : decision === "failed"
          ? "Failed"
          : decision;
  return (
    <div className="surface p-3 opacity-90">
      <div className="flex flex-wrap items-center gap-2">
        <span className={tone}>{label}</span>
        <span className="pill-ink">{TARGET_LABEL(suggestion.target)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-xs text-ui-fg-subtle">
        {suggestion.previewText}
      </p>
    </div>
  );
}

const DEFAULT_SENIORITY = "Entry Level (1 YOE)";
const SENIORITY_OPTIONS = [
  "Entry Level (1 YOE)",
  "Junior (1-3 YOE)",
  "Mid-level (3-5 YOE)",
  "Senior (5-8 YOE)",
  "Staff / Principal (8+ YOE)",
];

export default function TemplateTailorPanel({
  template,
  initialJobDescription = "",
  initialTargetRole = "",
  initialTargetCompany = "",
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
  aiEnabled = false,
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
  const [error, setError] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saveTags, setSaveTags] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState(null);
  const [autoTagLoading, setAutoTagLoading] = useState(false);
  const [autoTagSession, setAutoTagSession] = useState(null);
  const chatBottomRef = useRef(null);
  const autoStartLaunchedRef = useRef(false);
  const templateRestoreAttempted = useRef(false);

  const applyTemplateRestore = (data) => {
    if (!data?.restored || !data.session) return false;
    if (data.templateId && data.templateId !== template.id) return false;
    setSession(data.session);
    if (data.jobDescription) setJd(data.jobDescription);
    if (data.targetRole) setTargetRole(data.targetRole);
    if (data.targetCompany) setTargetCompany(data.targetCompany);
    if (data.seniority) setSeniority(data.seniority);
    setStoredTemplateSessionId(data.session.sessionId);
    const date = new Date().toISOString().slice(0, 10);
    setSaveName(
      [template.name, data.targetCompany || targetCompany, date]
        .filter(Boolean)
        .join(" —"),
    );
    if (data.done) {
      setDone(true);
      setCurrent(null);
    } else if (data.firstSuggestion) {
      setCurrent(data.firstSuggestion);
      setDone(false);
    }
    return true;
  };

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history, current, done]);

  useEffect(() => {
    if (session || starting || autoStart) return;
    if (templateRestoreAttempted.current) return;
    templateRestoreAttempted.current = true;
    (async () => {
      try {
        let data = null;
        const storedId = getStoredTemplateSessionId();
        if (storedId) {
          try {
            data = await tailorApi.restoreTemplateSession(storedId);
          } catch {
            setStoredTemplateSessionId("");
          }
        }
        if (!data?.restored) {
          data = await tailorApi.activeTemplateSession();
        }
        if (applyTemplateRestore(data)) {
          toast.success("Resumed your template tailoring session", {
            duration: 3500,
          });
        }
      } catch {
        /* no saved session */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, session, starting, autoStart]);

  // Auto-start once when caller passes `autoStart` and the inputs are ready.
  // Guard with a ref so a failed start (e.g. 429) does not re-fire endlessly.
  useEffect(() => {
    if (
      !autoStart ||
      autoStartLaunchedRef.current ||
      session ||
      starting ||
      !jd.trim()
    ) {
      return;
    }
    autoStartLaunchedRef.current = true;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, session, starting, jd]);

  const start = async () => {
    if (!jd.trim()) {
      setError("Paste a job description first.");
      return;
    }
    if (starting || session) return;
    setError("");
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
      setStoredTemplateSessionId(result.sessionId);
      const date = new Date().toISOString().slice(0, 10);
      setSaveName(
        [template.name, targetCompany, date].filter(Boolean).join(" —"),
      );
      // Seed save-tags from original + obvious hints
      setSaveTags(
        [...(template.tags || []), targetCompany, targetRole, seniority]
          .filter(Boolean)
          .slice(0, 10),
      );
      if (result.firstSuggestion) {
        setCurrent(result.firstSuggestion);
      } else {
        setDone(true);
      }
    } catch (err) {
      const message = formatGeminiError(err);
      setError(message);
      if (isGeminiQuotaError(err)) toast.error(message, { duration: 8000 });
    } finally {
      setStarting(false);
    }
  };

  const decide = async (decision, editInstruction = "") => {
    if (!session || !current) return;
    setBusy(true);
    setError("");
    try {
      const result = await tailorApi.templateDecide(session.sessionId, {
        suggestionId: current.id,
        decision,
        editInstruction,
      });
      if (result.result === "refined") {
        setCurrent(result.next);
      } else {
        setHistory((h) => [
          ...h,
          { suggestion: current, decision: result.result },
        ]);
        setSession((s) => ({ ...s, ...result.state }));
        if (result.next) {
          setCurrent(result.next);
        } else {
          setCurrent(null);
          setDone(true);
        }
        if (result.result === "failed")
          setError(result.error || "Could not apply.");
      }
    } catch (err) {
      const message = formatGeminiError(err);
      setError(message);
      if (isGeminiQuotaError(err)) toast.error(message, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  const onAutoTagSave = async () => {
    if (!session) return;
    if (!aiEnabled) {
      return toast.error(
        "AI is disabled on the server — set GEMINI_API_KEY to enable.",
      );
    }
    setAutoTagLoading(true);
    try {
      const res = await api.suggestTemplateTags({
        subject: session.subject || "",
        body: session.body || "",
        tags: saveTags,
      });
      const proposed = Array.isArray(res?.tags) ? res.tags : [];
      setAutoTagSession({
        existingTags: saveTags,
        proposed,
      });
    } catch (err) {
      toast.error(err.message || "Auto-tag failed.");
    } finally {
      setAutoTagLoading(false);
    }
  };

  const applyAutoTags = (finalTags) => {
    setSaveTags(finalTags);
    setAutoTagSession(null);
    toast.success("Tags updated. Save when ready.");
  };

  const save = async () => {
    if (!session || !saveName.trim()) return;
    setSaving(true);
    setError("");
    try {
      const created = await tailorApi.saveTemplateSession(session.sessionId, {
        name: saveName.trim(),
        tags: saveTags,
      });
      try {
        await tailorApi.abandonTemplateSession(session.sessionId);
      } catch {
        /* ignore */
      }
      setStoredTemplateSessionId("");
      setSavedTemplate(created);
      onSaved?.(created);
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const suggestionsColumn = (
    <div className="space-y-3">
      {history.map((h, i) => (
        <HistoryItem
          key={`${h.suggestion?.id || "h"}-${i}`}
          suggestion={h.suggestion}
          decision={h.decision}
        />
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
            <button className="btn-primary mt-3" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <div className="surface space-y-3 p-4">
            <p className="text-sm font-semibold text-ui-fg">
              Save as a new template
            </p>
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="My template — Stripe SDE · 2026-05-23"
              />
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
                <label className="label !mb-0">Tags</label>
                {aiEnabled && (
                  <button
                    type="button"
                    className="btn-ghost btn-xs text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:ring-indigo-800/50 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/40"
                    onClick={onAutoTagSave}
                    disabled={autoTagLoading || saving}
                    title="Suggest tags from the tailored subject and body"
                  >
                    {autoTagLoading && <Spinner className="h-3 w-3" />}
                    {autoTagLoading ? "Tagging..." : "Auto tag"}
                  </button>
                )}
              </div>
              <TagInput
                tags={saveTags}
                onChange={setSaveTags}
                placeholder="backend, kubernetes..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={save}
                disabled={saving || !saveName.trim()}
              >
                {saving ? "Saving..." : "Save as new template"}
              </button>
            </div>
          </div>
        )
      ) : null}
      {error ? (
        <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>
      ) : null}
      <div ref={chatBottomRef} />
    </div>
  );

  const previewSubject = session?.subject ?? template.subject ?? "";
  const previewBody = session?.body ?? template.body ?? "";
  const previewHint = session
    ? "Updates as you approve suggestions."
    : "Original template — changes appear here after you start.";

  const sessionHeader = session ? (
    <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ui-border/70 pb-2">
      <p className="text-xs font-medium text-ui-fg">
        Suggestions ({session.pending} pending)
      </p>
      <p className="text-2xs text-ui-fg-muted">
        {session.applied} applied · {session.pending} pending ·{""}
        {session.totalSuggestions} total
      </p>
    </div>
  ) : null;

  const quotaBlocked = Boolean(error && isGeminiQuotaError({ message: error }));

  const leftColumn =
    !session && hideInputsForm ? (
      <div className="surface space-y-3 p-4">
        {starting ? (
          <p className="text-xs text-ui-fg-muted">
            Starting template tailoring…
          </p>
        ) : error ? (
          <p className="text-xs leading-relaxed text-rose-700 dark:text-rose-300">
            {error}
          </p>
        ) : (
          <p className="text-xs text-ui-fg-muted">Waiting to start.</p>
        )}
        {error && !starting ? (
          <button
            type="button"
            className="btn-secondary btn-xs"
            onClick={() => start()}
            disabled={quotaBlocked}
            title={
              quotaBlocked
                ? "Daily Gemini free-tier limit — pick another model in the header or wait for reset"
                : undefined
            }
          >
            {quotaBlocked ? "Quota exhausted" : "Try again"}
          </button>
        ) : null}
      </div>
    ) : !session ? (
      <div className="max-w-xl space-y-3">
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
            <input
              className="input"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              placeholder="e.g. SDE intern"
            />
          </div>
          <div>
            <label className="label">Company (optional)</label>
            <input
              className="input"
              value={targetCompany}
              onChange={(e) => setTargetCompany(e.target.value)}
              placeholder="e.g. Stripe"
            />
          </div>
          <div className="col-span-2">
            <label className="label">Seniority</label>
            <select
              className="input"
              value={seniority}
              onChange={(e) => setSeniority(e.target.value)}
            >
              {SENIORITY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          className="btn-gradient w-full"
          onClick={start}
          disabled={starting || !jd.trim()}
        >
          {starting ? "Starting..." : "Start tailoring"}
        </button>
        {error ? (
          <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>
        ) : null}
      </div>
    ) : (
      suggestionsColumn
    );

  const content = (
    <TemplateTailorSplit
      header={sessionHeader}
      left={leftColumn}
      preview={
        <TemplateLivePreview
          subject={previewSubject}
          body={previewBody}
          hint={previewHint}
        />
      }
    />
  );

  const autoTagModal = (
    <AutoTagModal
      open={!!autoTagSession}
      onClose={() => setAutoTagSession(null)}
      onApply={applyAutoTags}
      existingTags={autoTagSession?.existingTags || []}
      proposed={autoTagSession?.proposed || []}
      title="Auto-tag this tailored template"
      subtitle="Selected tags will be used when you save. You can still edit them before saving."
    />
  );

  if (embedded) {
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {content}
        </div>
        {autoTagModal}
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-start justify-center bg-ui-overlay/55 px-4 py-8 backdrop-blur-sm">
        <div className="card flex max-h-[90vh] min-h-[min(85vh,720px)] w-full max-w-7xl flex-col overflow-hidden">
          <header className="flex shrink-0 items-center justify-between border-b border-ui-border/70 px-5 py-3">
            <div>
              <h2 className="text-base font-semibold text-ui-fg">
                Tailor template — {template.name}
              </h2>
            </div>
            <button
              className="btn-ghost btn-xs"
              onClick={onClose}
              aria-label="Close"
            >
              Close
            </button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
            {content}
          </div>
        </div>
      </div>
      {autoTagModal}
    </>
  );
}
