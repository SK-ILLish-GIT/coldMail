import { useEffect, useMemo, useState } from "react";

import Spinner from "./Spinner.jsx";
import { normalizeTags, TagInput } from "./Tags.jsx";

/**
 * Confirmation modal for AI-proposed tags. Mirrors PreviewModal's overlay
 * pattern (backdrop click + Escape close, body scroll-lock). Lets the user:
 * - toggle individual proposed tags on/off,
 * - see / edit the existing tags being kept,
 * - add custom tags before applying.
 *
 * On Apply, calls onApply(finalTags) where finalTags is the merged,
 * normalised list. The caller decides what to do (PUT existing template, or
 * just update local form state).
 *
 * Props:
 * - open: boolean
 * - onClose: () => void
 * - onApply: (tags: string[]) => void | Promise<void>
 * - existingTags: string[]
 * - proposed: string[]
 * - title?: string
 * - subtitle?: string
 * - applying?: boolean
 */
export default function AutoTagModal({
  open,
  onClose,
  onApply,
  existingTags = [],
  proposed = [],
  title = "AI-suggested tags",
  subtitle = "Pick which tags to keep, edit them, then apply.",
  applying = false,
}) {
  // Newly suggested tags = proposed minus existingTags (so we don't double-list).
  const newlySuggested = useMemo(() => {
    const existing = new Set(existingTags);
    return proposed.filter((t) => !existing.has(t));
  }, [proposed, existingTags]);

  // Toggle state — pre-select every newly-suggested tag and every existing
  // tag so applying is a one-click confirm in the common case.
  const [selectedNew, setSelectedNew] = useState(new Set());
  const [selectedExisting, setSelectedExisting] = useState(new Set());
  const [extra, setExtra] = useState([]);

  // Reset selections whenever the proposal set changes (i.e. the modal opens
  // for a different template). Without this, the second time you open it
  // you'd inherit the previous template's toggles.
  useEffect(() => {
    if (!open) return;
    setSelectedNew(new Set(newlySuggested));
    setSelectedExisting(new Set(existingTags));
    setExtra([]);
  }, [open, newlySuggested, existingTags]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && !applying && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose, applying]);

  const toggle = (setter) => (tag) =>
    setter((cur) => {
      const next = new Set(cur);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const finalTags = useMemo(
    () =>
      normalizeTags([
        ...Array.from(selectedExisting),
        ...Array.from(selectedNew),
        ...extra,
      ]),
    [selectedExisting, selectedNew, extra],
  );

  if (!open) return null;

  const hasAnyProposed = newlySuggested.length > 0;
  const hasExisting = existingTags.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ui-overlay/50 p-4 backdrop-blur-sm anim-in"
      onClick={() => (applying ? null : onClose())}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-ui-panel shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ui-border/70 px-5 py-4">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ui-fg-muted">
              Auto tag
            </p>
            <h3 className="text-base font-semibold text-ui-fg">{title}</h3>
            <p className="mt-0.5 text-xs text-ui-fg-muted">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="rounded-md p-1.5 text-ui-fg-muted hover:bg-ui-inset/60 hover:text-ui-fg disabled:opacity-50"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-auto px-5 py-4">
          {hasAnyProposed ? (
            <section>
              <p className="text-2xs font-semibold uppercase tracking-wider text-ui-fg-muted">
                Newly suggested ({newlySuggested.length})
              </p>
              <p className="mt-0.5 text-2xs text-ui-fg-muted">
                Click to toggle each tag on or off.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {newlySuggested.map((t) => {
                  const active = selectedNew.has(t);
                  return (
                    <button
                      type="button"
                      key={t}
                      onClick={() => toggle(setSelectedNew)(t)}
                      className={[
                        "rounded-full px-2 py-0.5 text-xs font-medium transition",
                        active
                          ? "bg-brand-500 text-white hover:bg-brand-600"
                          : "bg-ink-100 text-ui-fg hover:bg-ink-200 dark:hover:bg-ink-800",
                      ].join(" ")}
                    >
                      {active ? "✓" : "+"}
                      {t}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : (
            <p className="text-xs text-ui-fg-muted">
              No new tags suggested — the AI thinks your current ones already
              cover this template.
            </p>
          )}

          {hasExisting && (
            <section>
              <p className="text-2xs font-semibold uppercase tracking-wider text-ui-fg-muted">
                Existing tags ({existingTags.length})
              </p>
              <p className="mt-0.5 text-2xs text-ui-fg-muted">
                Click to drop any that no longer fit.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {existingTags.map((t) => {
                  const active = selectedExisting.has(t);
                  return (
                    <button
                      type="button"
                      key={t}
                      onClick={() => toggle(setSelectedExisting)(t)}
                      className={[
                        "rounded-full px-2 py-0.5 text-xs font-medium transition",
                        active
                          ? "bg-emerald-500 text-white hover:bg-emerald-600"
                          : "bg-ink-100 text-ui-fg-muted line-through hover:bg-ink-200 dark:hover:bg-ink-800",
                      ].join(" ")}
                    >
                      {active ? "✓" : "×"}
                      {t}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <p className="text-2xs font-semibold uppercase tracking-wider text-ui-fg-muted">
              Add custom tags
            </p>
            <div className="mt-2">
              <TagInput
                tags={extra}
                onChange={setExtra}
                placeholder="extra-tag, another-one..."
              />
            </div>
          </section>

          <section className="rounded-lg border border-ui-border/70 bg-ui-inset/50 px-3 py-2">
            <p className="text-2xs font-semibold uppercase tracking-wider text-ui-fg-muted">
              Final tag list ({finalTags.length})
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {finalTags.length === 0 ? (
                <span className="text-2xs italic text-ui-fg-muted">
                  (no tags selected)
                </span>
              ) : (
                finalTags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-ui-panel px-1.5 py-0.5 text-2xs font-medium text-ui-fg ring-1 ring-ink-200 ring-ui-border"
                  >
                    {t}
                  </span>
                ))
              )}
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-ui-border/70 bg-ui-panel px-5 py-3">
          <button
            type="button"
            className="btn-ghost btn-xs"
            onClick={onClose}
            disabled={applying}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onApply(finalTags)}
            disabled={applying}
          >
            {applying && <Spinner />}
            {applying ? "Applying..." : "Apply tags"}
          </button>
        </footer>
      </div>
    </div>
  );
}
