import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { api } from "../lib/api.js";
import { tabClick, tabMouseDown } from "../lib/tabButton.js";
import { confirmAsync } from "../lib/confirm.jsx";
import EmptyState from "./EmptyState.jsx";

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Build a Gmail web URL that searches the user's Drafts for this specific
// row. We can't link to the IMAP UID directly (Gmail doesn't expose it in
// URLs), but in:drafts + to: + subject: nails it for nearly every case.
function gmailSearchUrl({ to, subject }) {
  const parts = ["in:drafts"];
  if (to) parts.push(`to:${to}`);
  if (subject) {
    const trimmed = subject.length > 80 ? subject.slice(0, 80) : subject;
    parts.push(`subject:"${trimmed.replace(/"/g, "")}"`);
  }
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(parts.join(""))}`;
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "drafted", label: "Drafted" },
  { id: "failed", label: "Failed" },
];

// Accept legacy 'sent' entries as"successful" so older rows still render.
const isSuccess = (status) => status === "drafted" || status === "sent";

export default function SentLog() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api.listLog();
      setItems(data);
    } catch (err) {
      toast.error(err.message || "Failed to load log");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "drafted") return items.filter((i) => isSuccess(i.status));
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const counts = useMemo(() => {
    const total = items.length;
    const drafted = items.filter((i) => isSuccess(i.status)).length;
    const failed = total - drafted;
    return { total, drafted, failed };
  }, [items]);

  const clearAll = async () => {
    if (!items.length) return;
    const ok = await confirmAsync({
      title: "Clear the entire drafts log?",
      description: "This cannot be undone. Gmail Drafts remain untouched.",
      confirmLabel: "Clear",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.clearLog();
      toast.success("Log cleared.");
      refresh();
    } catch (err) {
      toast.error(err.message || "Failed to clear log");
    }
  };

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border/70 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-ui-fg">Drafts log</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ui-fg-muted">
            <span className="pill-ink">{counts.total} total</span>
            <span className="pill-emerald">{counts.drafted} drafted</span>
            <span className="pill-rose">{counts.failed} failed</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="tabs tabs-3 text-xs">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onMouseDown={tabMouseDown}
                onClick={tabClick(() => setFilter(f.id))}
                aria-selected={filter === f.id}
                className={["tab", filter === f.id && "tab-active"]
                  .filter(Boolean)
                  .join(" ")}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn-ghost btn-xs" onClick={refresh}>
            Refresh
          </button>
          <button
            type="button"
            className="btn-ghost btn-xs text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:ring-rose-800/50 dark:bg-rose-900/20 dark:hover:bg-rose-900/40"
            onClick={clearAll}
            disabled={!items.length}
          >
            Clear
          </button>
        </div>
      </header>

      {loading ? (
        <div className="p-6">
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-lg bg-ui-inset"
              />
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="mail"
          title={
            items.length === 0
              ? "No drafts saved yet"
              : `No ${filter} emails to show`
          }
          description={
            items.length === 0
              ? "Once you save drafts to Gmail, you’ll see a per-recipient audit trail here."
              : "Try a different filter or come back after saving more drafts."
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-ui-inset/60 text-2xs uppercase tracking-[0.08em] text-ui-fg-muted">
              <tr>
                <th className="px-6 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold">Recipient</th>
                <th className="px-6 py-3 font-semibold">Subject</th>
                <th className="px-6 py-3 font-semibold">When</th>
                <th className="px-6 py-3 font-semibold">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {filtered.map((row) => (
                <tr key={row.id} className="transition hover:bg-ui-inset/50">
                  <td className="px-6 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      {isSuccess(row.status) ? (
                        <span className="pill-emerald">
                          <span className="status-dot bg-emerald-500" />
                          Drafted
                        </span>
                      ) : (
                        <span className="pill-rose" title={row.error || ""}>
                          <span className="status-dot bg-rose-500" />
                          Failed
                        </span>
                      )}
                      {row.meta?.enriched && (
                        <span
                          className="pill-brand"
                          title={
                            row.meta?.pattern
                              ? `${row.meta.pattern} @ ${Math.round((row.meta.confidence || 0) * 100)}%`
                              : "AI-suggested email"
                          }
                        >
                          AI
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <div className="font-medium text-ui-fg">{row.to}</div>
                    {(row.name || row.company) && (
                      <div className="text-xs text-ui-fg-muted">
                        {[row.name, row.company].filter(Boolean).join(" ·")}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3 max-w-sm truncate text-ui-fg">
                    {row.subject || (
                      <span className="italic text-ui-fg-muted">
                        (no subject)
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-xs text-ui-fg-muted">
                    {fmtDate(row.sentAt)}
                  </td>
                  <td className="px-6 py-3 text-xs">
                    {isSuccess(row.status) ? (
                      <a
                        href={gmailSearchUrl({
                          to: row.to,
                          subject: row.subject,
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-brand-300"
                        title="Open this draft in Gmail (search by recipient + subject)"
                      >
                        Gmail
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-3 w-3"
                        >
                          <path d="M15 3h6v6" />
                          <path d="M10 14L21 3" />
                          <path d="M21 14v7H3V3h7" />
                        </svg>
                      </a>
                    ) : (
                      <span className="text-ui-fg-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
