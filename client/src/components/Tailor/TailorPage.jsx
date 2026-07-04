import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { api } from "../../lib/api.js";
import { tabClick, tabMouseDown } from "../../lib/tabButton.js";
import { tailorApi } from "../../lib/tailorApi.js";
import {
  getStoredResumeSessionId,
  setStoredResumeSessionId,
} from "../../lib/tailorSessionStorage.js";
import { useJd } from "../../context/jdContext.jsx";
import { useTailorTarget } from "../../context/tailorTarget.jsx";
import { confirmAsync } from "../../lib/confirm.jsx";
import Chat from "./Chat.jsx";
import FinalActions from "./FinalActions.jsx";
import ScorePanel from "./ScorePanel.jsx";
import TemplateTailorPanel from "./TemplateTailorPanel.jsx";
import TemplateLivePreview, {
  TemplateTailorSplit,
} from "./TemplateLivePreview.jsx";

const SENIORITY_OPTIONS = [
  "Entry Level (1 YOE)",
  "Junior (1-3 YOE)",
  "Mid-level (3-5 YOE)",
  "Senior (5-8 YOE)",
  "Staff / Principal (8+ YOE)",
];
const DEFAULT_SENIORITY = SENIORITY_OPTIONS[0];
const TEXLIVE_OPTOUT_KEY = "coldmail.texliveOptOut";

function fmtBytes(bytes) {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function TailorPage({ aiConfigured }) {
  const [status, setStatus] = useState(null);
  const { jd, setJd } = useJd();
  const {
    pendingTemplate,
    consumePendingTemplate,
    pendingResumeTailor,
    consumePendingResumeTailor,
  } = useTailorTarget();

  const [targetRole, setTargetRole] = useState("");
  const [targetCompany, setTargetCompany] = useState("");
  const [seniority, setSeniority] = useState(DEFAULT_SENIORITY);

  // Persist the texlive opt-out across sessions. If true, we hide compile
  // and only offer the local zip download — nothing leaves the app.
  const [texliveOptOut, setTexliveOptOut] = useState(() => {
    try {
      return localStorage.getItem(TEXLIVE_OPTOUT_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [starting, setStarting] = useState(false);
  const [session, setSession] = useState(null);
  const [current, setCurrent] = useState(null);
  const [done, setDone] = useState(false);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Active resume-session view: 'chat' (default iterative flow) or 'triage'.
  const [resumeView, setResumeView] = useState("chat");
  const [queue, setQueue] = useState([]); // for triage view

  const [templates, setTemplates] = useState([]);
  const [tailorTemplateTarget, setTailorTemplateTarget] = useState(null);
  const [rightPane, setRightPane] = useState("resume");
  // Set when a caller (TemplateLibrary's"AI Tailor", JDMatcher) deep-links
  // a specific template — pre-selects it in TemplateStartForm so the user
  // still gets to paste JD / targeting before kicking off the session.
  const [prefilledTemplateId, setPrefilledTemplateId] = useState("");

  const chatBottomRef = useRef(null);
  const resumeRestoreAttempted = useRef(false);

  const applyResumeRestore = (data) => {
    if (!data?.restored || !data.session) return false;
    setSession({
      ...data.session,
      initialScores: data.initialScores,
      currentScores: data.currentScores,
    });
    if (data.jobDescription) setJd(data.jobDescription);
    if (data.targetRole) setTargetRole(data.targetRole);
    if (data.targetCompany) setTargetCompany(data.targetCompany);
    if (data.seniority) setSeniority(data.seniority);
    setStoredResumeSessionId(data.session.sessionId);
    if (data.done) {
      setDone(true);
      setCurrent(null);
      setMessages([
        {
          role: "assistant",
          text: "Restored your session — all suggestions were already reviewed.",
        },
      ]);
    } else if (data.firstSuggestion) {
      setCurrent(data.firstSuggestion);
      setDone(false);
      setMessages([
        {
          role: "assistant",
          text: `Restored tailoring (${data.session.pending} pending, ${data.session.applied} applied).`,
        },
      ]);
    }
    return true;
  };

  useEffect(() => {
    tailorApi
      .status()
      .then(setStatus)
      .catch(() => {});
    api
      .listTemplates()
      .then((data) => {
        setTemplates(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  }, []);

  // Consume a deep-link request from JDMatcher / TemplateLibrary: switch
  // to template mode and pre-select the target template in the start form
  // (so the user still gets to paste JD / role / company before starting).
  useEffect(() => {
    if (!pendingTemplate) return;
    setRightPane("template");
    setPrefilledTemplateId(pendingTemplate.id);
    setTailorTemplateTarget(null);
    consumePendingTemplate();
  }, [pendingTemplate, consumePendingTemplate]);

  // ResumeLibrary"AI Tailor" → open the resume tailoring start form.
  useEffect(() => {
    if (!pendingResumeTailor) return;
    setRightPane("resume");
    setTailorTemplateTarget(null);
    setPrefilledTemplateId("");
    consumePendingResumeTailor();
  }, [pendingResumeTailor, consumePendingResumeTailor]);

  const refreshTemplates = () => {
    api
      .listTemplates()
      .then((data) => {
        setTemplates(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, current, done]);

  const aiReady = aiConfigured || status?.aiConfigured;
  const cvInfo = status?.cvInfo;

  useEffect(() => {
    if (!aiReady || session || resumeRestoreAttempted.current) return;
    if (rightPane !== "resume") return;
    if (pendingResumeTailor || pendingTemplate) return;

    resumeRestoreAttempted.current = true;
    (async () => {
      try {
        let data = null;
        const storedId = getStoredResumeSessionId();
        if (storedId) {
          try {
            data = await tailorApi.restoreResumeSession(storedId);
          } catch {
            setStoredResumeSessionId("");
          }
        }
        if (!data?.restored) {
          data = await tailorApi.activeResumeSession();
        }
        if (applyResumeRestore(data)) {
          toast.success("Resumed your resume tailoring session", { duration: 3500 });
        }
      } catch {
        /* no saved session */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiReady, session, rightPane, pendingResumeTailor, pendingTemplate]);

  const handleStart = async () => {
    if (!jd.trim()) {
      setError("Paste a job description first.");
      return;
    }
    setError("");
    setStarting(true);
    setMessages([
      {
        role: "system",
        text: "Analyzing your resume and the job description...",
      },
    ]);
    try {
      const result = await tailorApi.startSession({
        jobDescription: jd,
        targetRole: targetRole || undefined,
        targetCompany: targetCompany || undefined,
        seniority: seniority || undefined,
      });
      setSession(result);
      setStoredResumeSessionId(result.sessionId);
      if (result.firstSuggestion) {
        setCurrent(result.firstSuggestion);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: `I scanned your resume and prepared ${result.totalSuggestions} improvement${
              result.totalSuggestions === 1 ? "" : "s"
            }. Let's review them one by one — or switch to Triage to bulk-decide.`,
          },
        ]);
      } else {
        setDone(true);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: "No suggestions needed — your resume already matches this JD well.",
          },
        ]);
      }
    } catch (err) {
      setError(err.message || "Failed to start session.");
      setMessages([]);
    } finally {
      setStarting(false);
    }
  };

  const pushHistory = (suggestion, decision, note = "") => {
    setMessages((m) => [...m, { role: "history", suggestion, decision, note }]);
  };

  const handleDecide = async (
    decision,
    editInstruction = "",
    overrideSuggestion = null,
  ) => {
    if (!session) return;
    const target = overrideSuggestion || current;
    if (!target) return;
    const isRedecide = Boolean(overrideSuggestion);
    setBusy(true);
    setError("");
    try {
      const result = await tailorApi.decide(session.sessionId, {
        suggestionId: target.id,
        decision,
        editInstruction,
      });
      if (isRedecide) {
        setMessages((m) =>
          m.map((msg) =>
            msg.role === "history" && msg.suggestion?.id === target.id
              ? {
                  ...msg,
                  suggestion:
                    result.next?.id === target.id
                      ? result.next
                      : msg.suggestion,
                  decision: result.result,
                }
              : msg,
          ),
        );
        setSession((s) => ({ ...s, ...result.state }));
        if (result.result === "refined" && result.next?.id === target.id) {
          setCurrent(result.next);
          setDone(false);
        }
        if (result.result === "failed") {
          setError(result.error || "Suggestion could not be applied.");
        }
        if (resumeView === "triage") await refreshQueue();
        return;
      }
      if (result.result === "refined") {
        setCurrent(result.next);
        setMessages((m) => [
          ...m,
          { role: "user", text: editInstruction },
          {
            role: "assistant",
            text: "Here is a revised draft based on your instruction.",
          },
        ]);
      } else {
        pushHistory(current, result.result, "");
        setSession((s) => ({ ...s, ...result.state }));
        if (result.next) {
          setCurrent(result.next);
        } else {
          setCurrent(null);
          setDone(true);
          setMessages((m) => [
            ...m,
            {
              role: "assistant",
              text: "All suggestions reviewed. You can compile the PDF or download the updated .tex files below.",
            },
          ]);
        }
        if (result.result === "failed") {
          setError(result.error || "Suggestion could not be applied.");
        }
      }
    } catch (err) {
      setError(err.message || "Failed to process decision.");
    } finally {
      setBusy(false);
    }
  };

  // Triage view: bulk decide many suggestions without scrolling through the
  // chat. Each row is decided via the same /decide endpoint so the on-disk
  // state stays consistent with the queue.
  const refreshQueue = async () => {
    if (!session) return;
    try {
      const r = await tailorApi.queue(session.sessionId);
      setQueue(Array.isArray(r.suggestions) ? r.suggestions : []);
    } catch {
      /* swallow — triage view will just show stale */
    }
  };

  useEffect(() => {
    if (resumeView === "triage" && session) refreshQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeView, session]);

  const handleTriageDecide = async (suggestion, decision) => {
    setBusy(true);
    try {
      const result = await tailorApi.decide(session.sessionId, {
        suggestionId: suggestion.id,
        decision,
      });
      setSession((s) => ({ ...s, ...result.state }));
      if (result.next && !current) setCurrent(result.next);
      await refreshQueue();
    } catch (err) {
      setError(err.message || "Decision failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async () => {
    if (!session) return;
    const ok = await confirmAsync({
      title: "Restore all .tex files?",
      description:
        "This undoes every applied change in this session — original files are restored from .bak baselines.",
      confirmLabel: "Restore",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await tailorApi.rollback(session.sessionId);
      setSession((s) => ({ ...s, ...r.state }));
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `Rolled back ${r.restored.length} file(s). You can re-approve any earlier suggestion.`,
        },
      ]);
      const np = await tailorApi.next(session.sessionId);
      if (np.done) {
        setCurrent(null);
        setDone(true);
      } else {
        setCurrent(np.suggestion);
        setDone(false);
      }
      if (resumeView === "triage") await refreshQueue();
    } catch (err) {
      setError(err.message || "Rollback failed.");
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    const id = session?.sessionId;
    if (id) {
      try {
        await tailorApi.abandonResumeSession(id);
      } catch {
        /* ignore */
      }
    }
    setStoredResumeSessionId("");
    setSession(null);
    setCurrent(null);
    setDone(false);
    setMessages([]);
    setError("");
    setQueue([]);
    setResumeView("chat");
  };

  const scoreDelta = useMemo(() => {
    if (!session) return null;
    return { initial: session.initialScores, current: session.currentScores };
  }, [session]);

  const persistTexliveOptOut = (value) => {
    setTexliveOptOut(value);
    try {
      if (value) localStorage.setItem(TEXLIVE_OPTOUT_KEY, "1");
      else localStorage.removeItem(TEXLIVE_OPTOUT_KEY);
    } catch {
      /* non-fatal */
    }
  };

  if (!aiReady) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-ui-fg">
          Resume Tailor is offline
        </h2>
        <p className="mt-2 text-sm text-ui-fg-subtle">
          Set{""}
          <code className="rounded bg-ui-inset px-1 py-0.5 bg-ui-inset">
            GEMINI_API_KEY
          </code>
          {""}
          in{""}
          <code className="rounded bg-ui-inset px-1 py-0.5 bg-ui-inset">
            server/.env
          </code>
          {""}
          and restart the server to enable JD-aware resume editing.
        </p>
      </div>
    );
  }

  const resumeSessionActive = Boolean(session);
  const templateSessionActive = Boolean(tailorTemplateTarget);

  return (
    <section className="card flex min-h-[80vh] flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border/70 px-5 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setRightPane("resume")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              rightPane === "resume"
                ? "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 dark:bg-brand-900/30 dark:text-brand-200 dark:ring-brand-800/50"
                : "text-ui-fg-muted hover:text-ui-fg"
            }`}
          >
            Tailor resume
          </button>
          <button
            type="button"
            onClick={() => setRightPane("template")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              rightPane === "template"
                ? "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 dark:bg-brand-900/30 dark:text-brand-200 dark:ring-brand-800/50"
                : "text-ui-fg-muted hover:text-ui-fg"
            }`}
          >
            Tailor template
            {tailorTemplateTarget ? (
              <span className="ml-1 text-ui-fg-muted">
                · {tailorTemplateTarget.name.slice(0, 22)}
                {tailorTemplateTarget.name.length > 22 ? "…" : ""}
              </span>
            ) : null}
          </button>
        </div>
        {rightPane === "resume" && resumeSessionActive ? (
          <div className="flex items-center gap-2">
            <span className="pill-ink">
              {session.applied} applied · {session.pending} pending ·{""}
              {session.totalSuggestions} total
            </span>
            <div className="tabs tabs-2 text-xs">
              <button
                type="button"
                className={["tab", resumeView === "chat" && "tab-active"]
                  .filter(Boolean)
                  .join(" ")}
                onMouseDown={tabMouseDown}
                onClick={tabClick(() => setResumeView("chat"))}
                aria-selected={resumeView === "chat"}
              >
                Chat
              </button>
              <button
                type="button"
                className={["tab", resumeView === "triage" && "tab-active"]
                  .filter(Boolean)
                  .join(" ")}
                onMouseDown={tabMouseDown}
                onClick={tabClick(() => setResumeView("triage"))}
                aria-selected={resumeView === "triage"}
              >
                Triage
              </button>
            </div>
          </div>
        ) : null}
      </header>

      <div
        className={
          rightPane === "template"
            ? "flex flex-1 min-h-0 flex-col overflow-hidden px-5 py-4"
            : "flex-1 space-y-4 overflow-y-auto px-5 py-4"
        }
      >
        {rightPane === "resume" ? (
          resumeSessionActive ? (
            <>
              {scoreDelta ? (
                <ScorePanel
                  initial={scoreDelta.initial}
                  current={scoreDelta.current}
                />
              ) : null}
              {resumeView === "triage" ? (
                <TriageView
                  queue={queue}
                  busy={busy}
                  onDecide={handleTriageDecide}
                  onBackToChat={() => setResumeView("chat")}
                />
              ) : (
                <>
                  <Chat
                    messages={messages}
                    current={current}
                    done={done}
                    busy={busy}
                    onDecide={handleDecide}
                    onRedecide={(suggestion, decision, editInstruction) =>
                      handleDecide(decision, editInstruction || "", suggestion)
                    }
                  />
                  {done ? (
                    <FinalActions
                      session={session}
                      onRollback={handleRollback}
                      texliveOptOut={texliveOptOut}
                      onCompileMessage={(text) =>
                        setMessages((m) => [...m, { role: "assistant", text }])
                      }
                    />
                  ) : null}
                </>
              )}
              <div className="pt-2">
                <button
                  className="btn-secondary"
                  onClick={restart}
                  disabled={busy}
                >
                  Start over with a new JD
                </button>
              </div>
              <div ref={chatBottomRef} />
            </>
          ) : (
            <ResumeStartForm
              jd={jd}
              setJd={setJd}
              targetRole={targetRole}
              setTargetRole={setTargetRole}
              targetCompany={targetCompany}
              setTargetCompany={setTargetCompany}
              seniority={seniority}
              setSeniority={setSeniority}
              starting={starting}
              onStart={handleStart}
              error={error}
              cvInfo={cvInfo}
              texliveOptOut={texliveOptOut}
              onTexliveOptOutChange={persistTexliveOptOut}
              texliveUrl={status?.texliveUrl}
            />
          )
        ) : templateSessionActive ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <TemplateTailorPanel
              key={tailorTemplateTarget.id}
              template={tailorTemplateTarget}
              initialTargetRole={targetRole}
              initialTargetCompany={targetCompany}
              initialSeniority={seniority}
              embedded
              autoStart
              hideInputsForm
              aiEnabled={aiReady}
              onClose={() => setTailorTemplateTarget(null)}
              onSaved={() => refreshTemplates()}
            />
            <div className="shrink-0">
              <button
                className="btn-secondary"
                onClick={() => setTailorTemplateTarget(null)}
              >
                Pick a different template
              </button>
            </div>
          </div>
        ) : (
          <TemplateStartForm
            templates={templates}
            jd={jd}
            setJd={setJd}
            targetRole={targetRole}
            setTargetRole={setTargetRole}
            targetCompany={targetCompany}
            setTargetCompany={setTargetCompany}
            seniority={seniority}
            setSeniority={setSeniority}
            initialSelectedId={prefilledTemplateId}
            onStart={(tpl) => {
              setPrefilledTemplateId("");
              setTailorTemplateTarget(tpl);
            }}
          />
        )}
      </div>
    </section>
  );
}

// Shared targeting fields — single source of truth used by both modes.
function TargetingFields({
  jd,
  setJd,
  targetRole,
  setTargetRole,
  targetCompany,
  setTargetCompany,
  seniority,
  setSeniority,
}) {
  return (
    <>
      <div>
        <label className="label">Job description</label>
        <textarea
          className="input-mono h-44 resize-y"
          placeholder="Paste the full JD here..."
          value={jd}
          onChange={(e) => setJd(e.target.value)}
        />
        {jd ? (
          <p className="mt-1 text-2xs text-ui-fg-muted">
            Same JD pre-fills in Compose &amp; the Templates tab.
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
          />
        </div>
        <div>
          <label className="label">Company (optional)</label>
          <input
            className="input"
            placeholder="e.g. Stripe"
            value={targetCompany}
            onChange={(e) => setTargetCompany(e.target.value)}
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
    </>
  );
}

function CvInfoCard({ cvInfo }) {
  if (!cvInfo) return null;
  if (!cvInfo.exists) {
    return (
      <div className="rounded-lg border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs text-rose-700 dark:border-rose-800/60 dark:bg-rose-900/20 dark:text-rose-200">
        <p className="font-semibold">CV folder not found</p>
        <p className="mt-0.5">
          {cvInfo.error || "Check CV_DEFAULT_PATH in server/.env"}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-ui-border/70 bg-ui-inset/50 px-3 py-2 text-xs">
      <p className="text-2xs font-semibold uppercase tracking-wider text-ui-fg-muted">
        Source resume
      </p>
      <p className="mt-1 font-mono text-ui-fg break-all">{cvInfo.path}</p>
      <p className="mt-1 text-ui-fg-muted">
        {cvInfo.fileCount} files · {fmtBytes(cvInfo.totalSize)} · last edited
        {""}
        {fmtDate(cvInfo.lastModified)}
      </p>
    </div>
  );
}

function TexliveNotice({ optedOut, onChange, texliveUrl }) {
  return (
    <div className="callout-warning">
      <p className="font-semibold">Where your resume goes when you compile</p>
      <p className="mt-0.5">
        PDF compilation uses{""}
        <span className="font-mono">{texliveUrl || "texlive.net"}</span>, a
        public LaTeX service. The contents of your .tex files are sent there to
        render the PDF. Tick the box to disable compile and only allow local zip
        downloads — nothing leaves the app.
      </p>
      <label className="mt-2 flex items-center gap-2 text-2xs">
        <input
          type="checkbox"
          className="h-3.5 w-3.5"
          checked={optedOut}
          onChange={(e) => onChange(e.target.checked)}
        />
        Disable texlive.net compile (download zip only)
      </label>
    </div>
  );
}

function ResumeStartForm({
  starting,
  onStart,
  error,
  cvInfo,
  texliveOptOut,
  onTexliveOptOutChange,
  texliveUrl,
  ...rest
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div>
        <h3 className="text-base font-semibold text-ui-fg">
          Tailor your resume
        </h3>
        <p className="mt-0.5 text-xs text-ui-fg-muted">
          Paste the JD, optionally add target hints, and I&apos;ll walk you
          through edits one suggestion at a time — or use Triage view inside the
          session for bulk decisions.
        </p>
      </div>
      <CvInfoCard cvInfo={cvInfo} />
      <TexliveNotice
        optedOut={texliveOptOut}
        onChange={onTexliveOptOutChange}
        texliveUrl={texliveUrl}
      />
      <TargetingFields {...rest} />
      <button
        className="btn-gradient w-full"
        disabled={starting || !rest.jd.trim()}
        onClick={onStart}
      >
        {starting ? "Starting..." : "Start tailoring resume"}
      </button>
      {error ? (
        <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>
      ) : null}
    </div>
  );
}

function TemplateStartForm({
  templates,
  onStart,
  initialSelectedId = "",
  ...rest
}) {
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  // Honour a fresh deep-link from JDMatcher / TemplateLibrary mid-mount —
  // overwrite the dropdown selection when the caller pre-selects a template.
  useEffect(() => {
    if (initialSelectedId) setSelectedId(initialSelectedId);
  }, [initialSelectedId]);
  const selected = templates.find((t) => t.id === selectedId);
  const jdReady = rest.jd.trim().length >= 20;
  const canStart = Boolean(selected) && jdReady;

  const formColumn = (
    <div className="max-w-xl space-y-3">
      <div>
        <h3 className="text-base font-semibold text-ui-fg">
          Tailor an email template
        </h3>
      </div>
      <div>
        <label className="label">Template to tailor</label>
        {templates.length === 0 ? (
          <p className="text-xs text-ui-fg-muted">
            No templates yet. Create one in the <em>Templates</em> tab first.
          </p>
        ) : (
          <select
            className="input"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">Pick a template...</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {selected?.tags?.length ? (
          <p className="mt-1 text-2xs text-ui-fg-muted">
            Tags: {selected.tags.join(",")}
          </p>
        ) : null}
      </div>
      <TargetingFields {...rest} />
      <button
        className="btn-gradient w-full"
        disabled={!canStart}
        onClick={() => selected && onStart(selected)}
        title={
          !selected
            ? "Pick a template above first"
            : !jdReady
              ? "Paste a longer JD (20+ chars)"
              : "Tailor this template against the JD"
        }
      >
        Start tailoring template
      </button>
    </div>
  );

  return (
    <TemplateTailorSplit
      left={formColumn}
      preview={
        <TemplateLivePreview
          subject={selected?.subject}
          body={selected?.body}
          hint={selected ? "Selected template before tailoring." : null}
          emptyMessage={
            selected ? "(empty body)" : "Pick a template to preview it here."
          }
        />
      }
    />
  );
}

const SECTION_LABELS = {
  summary: "Summary",
  skills: "Skills",
  experience: "Experience",
  projects: "Projects",
  certifications: "Certifications",
  coding: "Coding",
  education: "Education",
};

// Compact list view of every suggestion in the session. Lets the user
// approve / reject in bulk without scrolling through the chat. Decisions
// go through the same /decide endpoint, so the chat history stays in sync.
function TriageView({ queue, busy, onDecide, onBackToChat }) {
  const groups = useMemo(() => {
    const out = { pending: [], approved: [], rejected: [], failed: [] };
    for (const q of queue) {
      const bucket = out[q.status] || out.pending;
      bucket.push(q);
    }
    return out;
  }, [queue]);

  const Row = ({ s }) => {
    const tone =
      s.status === "approved"
        ? "pill-emerald"
        : s.status === "rejected"
          ? "pill-rose"
          : s.status === "failed"
            ? "pill-rose"
            : "pill-ink";
    const label = s.status[0].toUpperCase() + s.status.slice(1);
    return (
      <li className="surface flex flex-wrap items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={tone}>{label}</span>
            <span className="pill-ink">
              {SECTION_LABELS[s.section] || s.section}
            </span>
            {s.subheading ? (
              <span className="pill-amber">{s.subheading}</span>
            ) : null}
            <span className="pill-emerald">impact {s.impact}/10</span>
          </div>
          <p className="mt-2 text-xs text-ui-fg line-clamp-3">
            {s.previewText}
          </p>
          {s.error ? (
            <p className="mt-1 text-2xs text-rose-600 dark:text-rose-300">
              {s.error}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {s.status !== "approved" ? (
            <button
              type="button"
              className="btn-primary btn-xs"
              disabled={busy}
              onClick={() => onDecide(s, "approve")}
            >
              Approve
            </button>
          ) : null}
          {s.status !== "rejected" ? (
            <button
              type="button"
              className="btn-ghost btn-xs text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:bg-rose-900/20 dark:ring-rose-800/50 dark:hover:bg-rose-900/40"
              disabled={busy}
              onClick={() => onDecide(s, "reject")}
            >
              {s.status === "approved" ? "Revert" : "Reject"}
            </button>
          ) : null}
        </div>
      </li>
    );
  };

  const Section = ({ label, items }) => {
    if (!items.length) return null;
    return (
      <section>
        <h4 className="text-2xs font-semibold uppercase tracking-wider text-ui-fg-muted">
          {label} ({items.length})
        </h4>
        <ul className="mt-2 space-y-2">
          {items.map((s) => (
            <Row key={s.id} s={s} />
          ))}
        </ul>
      </section>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ui-fg-muted">
          {queue.length} suggestion{queue.length === 1 ? "" : "s"} in this
          session. Approve / reject in any order — edits go through the same
          flow as Chat.
        </p>
        <button
          type="button"
          className="btn-ghost btn-xs"
          onClick={onBackToChat}
        >
          ← Back to Chat
        </button>
      </div>
      <Section label="Pending" items={groups.pending} />
      <Section label="Approved" items={groups.approved} />
      <Section label="Rejected" items={groups.rejected} />
      <Section label="Failed" items={groups.failed} />
    </div>
  );
}
