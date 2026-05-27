import { useEffect, useState } from "react";

// Lightweight check: don't hijack the keystroke if the user is typing into a
// real input/textarea/contenteditable/select (or if a modifier is held).
function shouldIgnoreShortcut(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const t = e.target;
  if (!t) return false;
  const tag = (t.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (t.isContentEditable) return true;
  return false;
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

const ACTION_LABELS = {
  replace_bullet: "Rewrite bullet",
  replace_summary: "Rewrite summary",
  update_skills_line: "Update skills line",
};

function ChipList({ items }) {
  if (!items || !items.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((k, i) => (
        <span key={`${k}-${i}`} className="pill-brand">
          {k}
        </span>
      ))}
    </div>
  );
}

function SuggestionCard({ suggestion, busy, onDecide }) {
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState("");

  const submitEdit = () => {
    if (!editText.trim()) return;
    onDecide("edit", editText.trim());
    setEditOpen(false);
    setEditText("");
  };

  // Keyboard shortcuts on the active card: a = approve, r = reject, e = edit.
  // Listener auto-cleans up when this card unmounts (i.e. as soon as the next
  // suggestion takes its place).
  useEffect(() => {
    const onKey = (e) => {
      if (shouldIgnoreShortcut(e)) return;
      if (busy || editOpen) return;
      const key = e.key.toLowerCase();
      if (key === "a") {
        e.preventDefault();
        onDecide("approve");
      } else if (key === "r") {
        e.preventDefault();
        onDecide("reject");
      } else if (key === "e") {
        e.preventDefault();
        setEditOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, editOpen, onDecide]);

  return (
    <div className="surface anim-in p-4 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <span className="pill-ink">
          {SECTION_LABELS[suggestion.section] || suggestion.section}
        </span>
        <span className="pill-ink">
          {ACTION_LABELS[suggestion.action] || suggestion.action}
        </span>
        {suggestion.subheading ? (
          <span className="pill-amber">{suggestion.subheading}</span>
        ) : null}
        <span className="pill-emerald">impact {suggestion.impact}/10</span>
      </div>

      {suggestion.reason ? (
        <p className="mt-3 text-xs text-ui-fg-subtle">
          <span className="font-semibold">Why: </span>
          {suggestion.reason}
        </p>
      ) : null}

      {suggestion.targetBulletText ? (
        <div className="mt-3">
          <p className="label">Before</p>
          <p className="rounded-md bg-rose-50/70 px-3 py-2 font-mono text-xs text-ui-fg dark:bg-rose-900/20">
            {suggestion.targetBulletText}
          </p>
        </div>
      ) : null}

      <div className="mt-3">
        <p className="label">
          {suggestion.targetBulletText ? "After" : "New content"}
        </p>
        <p className="rounded-md bg-emerald-50/70 px-3 py-2 font-mono text-xs text-ui-fg dark:bg-emerald-900/20">
          {suggestion.previewText}
        </p>
        <details className="mt-2 text-2xs text-ui-fg-muted">
          <summary className="cursor-pointer">View LaTeX</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-ink-50 px-3 py-2 text-2xs text-ui-fg bg-ui-inset">
            {suggestion.draftLatex}
          </pre>
        </details>
      </div>

      <ChipList items={suggestion.atsKeywords} />

      {editOpen ? (
        <div className="mt-3 rounded-md border border-ui-border/70 bg-ui-panel p-3">
          <label className="label">How should I revise this?</label>
          <textarea
            className="input-mono h-20 resize-y"
            placeholder="e.g. make it shorter, mention Kubernetes, drop the percentage..."
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
              onClick={submitEdit}
              disabled={busy || !editText.trim()}
            >
              Revise
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="btn-primary"
              onClick={() => onDecide("approve")}
              disabled={busy}
              title="Approve & apply (A)"
            >
              Approve &amp; apply
            </button>
            <button
              className="btn-secondary"
              onClick={() => setEditOpen(true)}
              disabled={busy}
              title="Edit (E)"
            >
              Edit
            </button>
            <button
              className="btn-ghost"
              onClick={() => onDecide("reject")}
              disabled={busy}
              title="Reject (R)"
            >
              Reject
            </button>
          </div>
          <p className="mt-2 text-2xs text-ui-fg-muted">
            Shortcuts:{""}
            <kbd className="rounded bg-ui-inset px-1 bg-ui-inset">A</kbd>{" "}
            approve ·{" "}
            <kbd className="rounded bg-ui-inset px-1 bg-ui-inset">R</kbd>
            {""}
            reject ·{""}
            <kbd className="rounded bg-ui-inset px-1 bg-ui-inset">E</kbd> edit
          </p>
        </>
      )}
    </div>
  );
}

function Bubble({ role, children }) {
  const cls =
    role === "user"
      ? "ml-auto bg-brand-600 text-white"
      : role === "system"
        ? "mx-auto bg-ink-100 text-ui-fg-subtle bg-ui-inset"
        : "bg-ui-panel text-ui-fg ring-1 ring-ui-border/70";
  return (
    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${cls}`}>
      {children}
    </div>
  );
}

// Render a past decision. The user can re-decide via the inline buttons —
// the"current" pill flips to the new outcome on the server's response.
function HistoryItem({ suggestion, decision, busy, onRedecide }) {
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState("");

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
          : decision === "refined"
            ? "Refined (pending)"
            : decision;

  const isApplied = decision === "applied" || decision === "refined-applied";
  const isRejected = decision === "rejected";

  const submitEdit = () => {
    if (!editText.trim()) return;
    onRedecide?.(suggestion, "edit", editText.trim());
    setEditOpen(false);
    setEditText("");
  };

  return (
    <div className="surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={tone}>{label}</span>
        <span className="pill-ink">
          {SECTION_LABELS[suggestion.section] || suggestion.section}
        </span>
        {suggestion.subheading ? (
          <span className="pill-ink">{suggestion.subheading}</span>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-ui-fg-subtle">{suggestion.previewText}</p>

      {onRedecide ? (
        editOpen ? (
          <div className="mt-2 rounded-md border border-ui-border/70 bg-ui-panel p-2">
            <textarea
              className="input-mono h-16 resize-y text-2xs"
              placeholder="Revise instruction..."
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              autoFocus
            />
            <div className="mt-1 flex justify-end gap-1">
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
                onClick={submitEdit}
                disabled={busy || !editText.trim()}
              >
                Revise
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!isApplied ? (
              <button
                className="btn-primary btn-xs"
                onClick={() => onRedecide(suggestion, "approve")}
                disabled={busy}
              >
                Approve
              </button>
            ) : null}
            {!isRejected ? (
              <button
                className="btn-ghost btn-xs"
                onClick={() => onRedecide(suggestion, "reject")}
                disabled={busy}
                title={
                  isApplied
                    ? "Revert this change — your other approved edits stay applied."
                    : "Mark this suggestion rejected."
                }
              >
                {isApplied ? "Revert" : "Reject"}
              </button>
            ) : null}
            <button
              className="btn-secondary btn-xs"
              onClick={() => setEditOpen(true)}
              disabled={busy}
            >
              Edit
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}

export default function Chat({
  messages,
  current,
  done,
  busy,
  onDecide,
  onRedecide,
}) {
  return (
    <div className="space-y-3">
      {messages.map((m, i) => {
        if (m.role === "history") {
          return (
            <HistoryItem
              key={`${m.suggestion?.id || "h"}-${i}`}
              suggestion={m.suggestion}
              decision={m.decision}
              busy={busy}
              onRedecide={onRedecide}
            />
          );
        }
        return (
          <Bubble key={i} role={m.role}>
            {m.text}
          </Bubble>
        );
      })}
      {current && !done ? (
        <SuggestionCard suggestion={current} busy={busy} onDecide={onDecide} />
      ) : null}
    </div>
  );
}
