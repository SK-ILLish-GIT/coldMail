// Shared tag widgets used by resumes, templates, and the compose filter row.
// Kept in one file so the visual style is consistent across the app.

import { useState } from "react";

const VALID_TAG = /^[a-z0-9][a-z0-9+./_-]*$/;
const MAX_TAG_LEN = 24;
const MAX_TAGS = 25;

/**
 * Normalise a raw token (or array of tokens) into a clean string[].
 * Mirrors the server normaliser so the client preview matches.
 */
export function normalizeTags(input) {
  if (input == null) return [];
  const arr = Array.isArray(input) ? input : String(input).split(/[,\n]+/);
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const t = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .slice(0, MAX_TAG_LEN);
    if (!t || !VALID_TAG.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Free-form chip input. The user types tags separated by comma or Enter;
 * pills appear inline. Backspace on empty input removes the last pill.
 *
 * Props:
 * - tags: string[]
 * - onChange: (tags: string[]) => void
 * - placeholder?: string
 */
export function TagInput({
  tags = [],
  onChange,
  placeholder = "backend, java, golang...",
}) {
  const [draft, setDraft] = useState("");

  const commitDraft = (raw) => {
    const value = String(raw ?? draft);
    if (!value.trim()) {
      setDraft("");
      return;
    }
    onChange(normalizeTags([...tags, value]));
    setDraft("");
  };

  const handleChange = (e) => {
    const value = e.target.value;
    // If the user typed/pasted a comma, commit everything before the comma
    // and keep the rest as the new draft.
    if (value.includes(",")) {
      const parts = value.split(",");
      const tail = parts.pop() ?? "";
      const committed = parts.filter((p) => p.trim().length > 0);
      if (committed.length) {
        onChange(normalizeTags([...tags, ...committed]));
      }
      setDraft(tail);
    } else {
      setDraft(value);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && !draft && tags.length) {
      e.preventDefault();
      onChange(tags.slice(0, -1));
    }
  };

  const removeTag = (t) => onChange(tags.filter((x) => x !== t));

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-ui-border bg-ui-panel px-2 py-1.5 focus-within:ring-2 focus-within:ring-brand-200">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-900/30 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300"
        >
          {t}
          <button
            type="button"
            className="-mr-0.5 ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-brand-500 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-800/50 hover:text-brand-800 dark:hover:text-brand-200"
            onClick={() => removeTag(t)}
            aria-label={`Remove tag ${t}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        className="min-w-[120px] flex-1 border-0 bg-transparent py-0.5 text-sm outline-none placeholder:text-ui-fg-muted dark:placeholder:text-ui-fg-muted"
        placeholder={tags.length ? "" : placeholder}
        value={draft}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => commitDraft()}
      />
    </div>
  );
}

/** Readable label for a stored tag slug (display only). */
export function formatTagLabel(tag) {
  return String(tag || "").replace(/[-_]/g, " ");
}

/**
 * Read-only display of tags as pills. When `onToggle` is provided, each pill
 * becomes a button: clicking adds/removes the tag from `activeTags`, useful
 * as a filter row.
 *
 * Props:
 * - tags: string[]
 * - activeTags?: string[]
 * - onToggle?: (tag: string) => void
 * - size?: 'sm' | 'xs'
 * - maxVisible?: number — collapse overflow behind "+N more"
 */
export function TagPills({
  tags = [],
  activeTags = [],
  onToggle,
  size = "xs",
  maxVisible,
}) {
  const [expanded, setExpanded] = useState(false);
  const list = normalizeTags(tags);
  if (!list.length) return null;

  const interactive = typeof onToggle === "function";
  const limit =
    typeof maxVisible === "number" && maxVisible > 0 && !expanded
      ? maxVisible
      : list.length;
  const visible = list.slice(0, limit);
  const hidden = list.length - visible.length;

  const sizeClass =
    size === "sm"
      ? "px-2.5 py-0.5 text-xs"
      : "px-2 py-0.5 text-2xs leading-tight";

  const idleClass = interactive
    ? "bg-ui-inset text-ui-fg ring-1 ring-inset ring-ui-border hover:bg-ui-panel-muted"
    : "bg-ui-inset/90 text-ui-fg-subtle ring-1 ring-inset ring-ui-border/80";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((t) => {
        const active = activeTags.includes(t);
        const Component = interactive ? "button" : "span";
        return (
          <Component
            key={t}
            type={interactive ? "button" : undefined}
            title={t}
            onClick={interactive ? () => onToggle(t) : undefined}
            className={[
              "inline-flex max-w-[14rem] truncate rounded-full font-medium",
              sizeClass,
              active
                ? "bg-brand-600 text-white ring-1 ring-inset ring-brand-700/30 dark:bg-brand-500"
                : idleClass,
              interactive ? "cursor-pointer transition" : "",
              interactive && active ? "hover:bg-brand-700 dark:hover:bg-brand-400" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {formatTagLabel(t)}
          </Component>
        );
      })}
      {hidden > 0 ? (
        <button
          type="button"
          className={`rounded-full font-medium text-ui-fg-muted ring-1 ring-inset ring-ui-border/80 bg-ui-panel hover:bg-ui-inset hover:text-ui-fg ${sizeClass}`}
          onClick={() => setExpanded(true)}
        >
          +{hidden} more
        </button>
      ) : null}
      {expanded && list.length > (maxVisible || 0) ? (
        <button
          type="button"
          className={`rounded-full font-medium text-brand-600 hover:underline dark:text-brand-300 ${size === "sm" ? "text-xs" : "text-2xs"}`}
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      ) : null}
    </div>
  );
}
