import { useState } from "react";
import toast from "react-hot-toast";

import { api } from "../lib/api.js";
import Spinner from "./Spinner.jsx";

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const GENERIC_LOCALS = new Set([
  "sales",
  "info",
  "contact",
  "hr",
  "support",
  "admin",
  "team",
  "hello",
  "noreply",
  "no-reply",
  "careers",
  "jobs",
  "billing",
  "accounts",
]);

// Deterministic fallback when AI is unavailable (or quota-hit).
// Splits the local-part on common separators and title-cases the pieces.
function algoExtractName(email) {
  const local = email.split("@")[0]?.split("+")[0] ?? "";
  if (!local) return "";
  const tokens = local.split(/[._-]+/).filter((s) => s && !/^\d+$/.test(s));
  if (!tokens.length) return "";
  if (tokens.length === 1 && GENERIC_LOCALS.has(tokens[0].toLowerCase()))
    return "";
  return tokens
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join("");
}

function parseEmails(raw) {
  const seen = new Set();
  const out = [];
  for (const token of String(raw || "").split(/[\s,;]+/)) {
    const e = token.trim().toLowerCase();
    if (e && EMAIL_REGEX.test(e) && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

function StatusDot({ status }) {
  if (!status) return null;
  if (status.status === "sending") {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-ui-fg-muted">
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="3"
          />
          <path
            d="M22 12a10 10 0 0 1-10 10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        Sending
      </span>
    );
  }
  if (status.status === "drafted") {
    return (
      <span className="pill-emerald" title="Saved to Gmail Drafts">
        <span className="status-dot bg-emerald-500" />
        Drafted
      </span>
    );
  }
  if (status.status === "failed") {
    return (
      <span className="pill-rose" title={status.error || "Failed"}>
        <span className="status-dot bg-rose-500" />
        Failed
      </span>
    );
  }
  if (status.status === "pending") {
    return (
      <span className="pill-ink" title="Queued">
        <span className="status-dot bg-ink-300 dark:bg-ink-600" />
        Queued
      </span>
    );
  }
  return null;
}

export default function MailIDPanel({
  company,
  setCompany,
  recipients,
  setRecipients,
  aiEnabled = false,
  sendStatuses = {},
}) {
  const [rawInput, setRawInput] = useState("");
  const [extracting, setExtracting] = useState(false);

  const previewEmails = parseEmails(rawInput);
  const canExtract =
    previewEmails.length > 0 && company.trim().length > 0 && !extracting;

  const buildRecipients = (candidates) =>
    candidates.map((c) => ({
      email: c.email,
      name: c.name || "",
      company: company.trim(),
    }));

  const extract = async () => {
    const emails = parseEmails(rawInput);
    if (!emails.length) return toast.error("Add at least one valid email.");
    if (!company.trim())
      return toast.error("Company is required for this mode.");

    setExtracting(true);
    try {
      if (aiEnabled) {
        try {
          const res = await api.extractNames({
            emails,
            company: company.trim(),
          });
          setRecipients(buildRecipients(res.candidates));
          toast.success(
            `Extracted ${res.candidates.length} name${res.candidates.length === 1 ? "" : "s"} via AI.`,
          );
          return;
        } catch (err) {
          // Fall back to algorithmic on quota / network / model errors.
          toast(
            `AI extraction failed (${err.message || "unknown"}). Using basic split.`,
            { icon: "⚠️" },
          );
        }
      }
      const candidates = emails.map((email) => ({
        email,
        name: algoExtractName(email),
      }));
      setRecipients(buildRecipients(candidates));
      toast.success(
        `Parsed ${candidates.length} email${candidates.length === 1 ? "" : "s"}.`,
      );
    } finally {
      setExtracting(false);
    }
  };

  const updateName = (idx, value) => {
    setRecipients(
      recipients.map((r, i) => (i === idx ? { ...r, name: value } : r)),
    );
  };

  const removeRow = (idx) => {
    setRecipients(recipients.filter((_, i) => i !== idx));
  };

  const clearAll = () => {
    setRecipients([]);
    setRawInput("");
  };

  // If the user changes the company AFTER extraction, propagate to every row
  // so the {{company}} merge field stays in sync.
  const onCompanyChange = (value) => {
    setCompany(value);
    if (recipients.length) {
      setRecipients(recipients.map((r) => ({ ...r, company: value.trim() })));
    }
  };

  return (
    <fieldset className="space-y-4">
      <legend className="label !mb-2">Recipients</legend>

      <div>
        <label className="label" htmlFor="mailid-company">
          Company (applies to all)
        </label>
        <input
          id="mailid-company"
          type="text"
          className="input"
          placeholder="Acme Inc."
          value={company}
          onChange={(e) => onCompanyChange(e.target.value)}
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-end justify-between gap-3">
          <label className="label !mb-0" htmlFor="mailid-emails">
            Emails
          </label>
          {previewEmails.length > 0 && (
            <span className="hint">{previewEmails.length} valid</span>
          )}
        </div>
        <textarea
          id="mailid-emails"
          rows={4}
          className="input font-mono text-sm"
          placeholder="alice@acme.com, bob.lee@acme.com&#10;charlie@acme.com"
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-secondary btn-xs"
          onClick={extract}
          disabled={!canExtract}
          title={
            !previewEmails.length
              ? "Add at least one valid email"
              : !company.trim()
                ? "Company is required"
                : aiEnabled
                  ? "Use AI to infer recipient names from each email"
                  : "Parse names from each email (no AI)"
          }
        >
          {extracting ? (
            <Spinner />
          ) : (
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
          )}
          {extracting
            ? "Extracting..."
            : aiEnabled
              ? "Extract names with AI"
              : "Parse emails"}
        </button>
        {recipients.length > 0 && (
          <button
            type="button"
            className="btn-ghost btn-xs text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:ring-rose-800/50 dark:bg-rose-900/20 dark:hover:bg-rose-900/40"
            onClick={clearAll}
          >
            Clear all
          </button>
        )}
      </div>

      {recipients.length > 0 && (
        <div className="anim-in overflow-hidden rounded-lg border border-ui-border/70">
          <div className="flex items-center justify-between bg-ui-inset/60 px-4 py-2">
            <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-ui-fg-muted">
              Recipients ({recipients.length})
            </span>
          </div>
          <div className="max-h-[360px] divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
            {recipients.map((r, i) => {
              const status = sendStatuses[r.email.toLowerCase()];
              return (
                <div
                  key={r.email}
                  className="space-y-2 px-3 py-2.5 transition hover:bg-ui-inset/50"
                >
                  <div className="flex items-center gap-2">
                    <p
                      className="min-w-0 flex-1 truncate font-mono text-xs text-ui-fg"
                      title={r.email}
                    >
                      {r.email}
                    </p>
                    <div className="flex shrink-0 items-center gap-1">
                      <StatusDot status={status} />
                      <button
                        type="button"
                        className="btn-ghost btn-xs w-7 shrink-0 px-0 text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:ring-rose-800/50 dark:bg-rose-900/20 dark:hover:bg-rose-900/40"
                        onClick={() => removeRow(i)}
                        title="Remove this recipient"
                        aria-label={`Remove ${r.email}`}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    className="input !h-8 w-full !py-1 text-sm"
                    placeholder="Name (editable)"
                    value={r.name}
                    onChange={(e) => updateName(i, e.target.value)}
                    aria-label={`Name for ${r.email}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </fieldset>
  );
}
