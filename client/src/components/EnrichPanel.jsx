import { useState } from "react";
import toast from "react-hot-toast";

import { api } from "../lib/api.js";

function confidenceTone(value, threshold) {
  if (value >= threshold + 0.2)
    return { bar: "bg-emerald-500", pill: "pill-emerald" };
  if (value >= threshold) return { bar: "bg-amber-500", pill: "pill-amber" };
  return { bar: "bg-rose-400", pill: "pill-rose" };
}

function ConfidenceCell({ value, threshold }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const tone = confidenceTone(value, threshold);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-100">
        <div className={`h-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`${tone.pill} font-mono tabular-nums`}>
        {Math.round(pct)}%
      </span>
    </div>
  );
}

export default function EnrichPanel({
  result,
  recipientName,
  company,
  subject,
  template,
  jobLink = "",
  attachmentArgs = { extraPayload: {}, files: [] },
  onLoggedSend,
}) {
  const [sendingEmail, setSendingEmail] = useState(null);

  if (!result) return null;
  const { domain, candidates = [], threshold = 0.5, mxValid } = result;

  const canSend = subject.trim() && template.trim();

  const sendTo = async (cand) => {
    if (sendingEmail) return;
    if (!canSend) {
      toast.error("Add subject and template before drafting.");
      return;
    }
    setSendingEmail(cand.email);
    const promise = api.sendEmail(
      {
        email: cand.email,
        name: recipientName,
        company,
        subject,
        template,
        extra: { jobLink },
        ...attachmentArgs.extraPayload,
        meta: {
          enriched: true,
          pattern: cand.pattern,
          confidence: cand.confidence,
          mxValid: cand.mxValid,
        },
      },
      attachmentArgs.files,
    );
    try {
      await toast.promise(promise, {
        loading: `Saving draft for ${cand.email}...`,
        success: "Draft saved in Gmail.",
        error: (err) => err.message || "Could not save draft",
      });
      onLoggedSend?.();
    } catch {
      // toast already surfaced the error
    } finally {
      setSendingEmail(null);
    }
  };

  return (
    <section className="surface overflow-hidden">
      <header className="surface-brand flex flex-wrap items-center justify-between gap-2 border-b border-ui-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="icon-brand flex h-6 w-6 items-center justify-center rounded-md">
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
            <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-brand-700 dark:text-brand-300">
              AI email candidates
            </p>
            <p className="text-2xs text-ui-fg-muted">
              Domain{""}
              <span className="font-mono text-ui-fg">
                {domain || "unknown"}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {mxValid ? (
            <span className="pill-emerald">
              <span className="status-dot bg-emerald-500" />
              MX OK
            </span>
          ) : (
            <span className="pill-rose">
              <span className="status-dot bg-rose-500" />
              No MX
            </span>
          )}
          <span className="pill-ink">≥ {Math.round(threshold * 100)}%</span>
        </div>
      </header>

      <ul className="divide-y divide-ink-200/60 dark:divide-ink-800">
        {candidates.map((c) => {
          const disabled = !c.mxValid || !canSend || sendingEmail !== null;
          const tooltip = !c.mxValid
            ? "Domain has no MX records — mail will bounce."
            : !canSend
              ? "Add a subject and template first."
              : `Save draft for ${c.email}`;
          return (
            <li
              key={c.email}
              className="grid grid-cols-[1fr_auto] items-start gap-3 px-4 py-3 transition hover:bg-ui-inset/60 sm:grid-cols-[1fr_auto_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-ui-fg">
                  {c.email}
                </p>
                {c.reasoning && (
                  <p
                    className="mt-0.5 line-clamp-1 text-2xs text-ui-fg-muted"
                    title={c.reasoning}
                  >
                    {c.reasoning}
                  </p>
                )}
              </div>
              <ConfidenceCell value={c.confidence} threshold={threshold} />
              <button
                type="button"
                className="btn-primary btn-xs disabled:opacity-50"
                onClick={() => sendTo(c)}
                disabled={disabled}
                title={tooltip}
              >
                {sendingEmail === c.email ? "Saving..." : "Draft"}
              </button>
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-ui-border/70 bg-ui-inset/50 px-4 py-2.5 text-2xs text-ui-fg-muted">
        Patterns proposed by Google Gemini. Confidence is a model estimate, not
        deliverability.
      </footer>
    </section>
  );
}
