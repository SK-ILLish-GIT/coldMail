// Shared tag widgets used by resumes, templates, and the compose filter row.
// Kept in one file so the visual style is consistent across the app.

import { useState } from 'react';

const VALID_TAG = /^[a-z0-9][a-z0-9+./_-]*$/;
const MAX_TAG_LEN = 24;
const MAX_TAGS = 10;

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
    const t = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
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
 *  - tags: string[]
 *  - onChange: (tags: string[]) => void
 *  - placeholder?: string
 */
export function TagInput({ tags = [], onChange, placeholder = 'backend, java, golang...' }) {
  const [draft, setDraft] = useState('');

  const commitDraft = (raw) => {
    const value = String(raw ?? draft);
    if (!value.trim()) {
      setDraft('');
      return;
    }
    onChange(normalizeTags([...tags, value]));
    setDraft('');
  };

  const handleChange = (e) => {
    const value = e.target.value;
    // If the user typed/pasted a comma, commit everything before the comma
    // and keep the rest as the new draft.
    if (value.includes(',')) {
      const parts = value.split(',');
      const tail = parts.pop() ?? '';
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
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      e.preventDefault();
      onChange(tags.slice(0, -1));
    }
  };

  const removeTag = (t) => onChange(tags.filter((x) => x !== t));

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 py-1.5 focus-within:ring-2 focus-within:ring-brand-200">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
        >
          {t}
          <button
            type="button"
            className="-mr-0.5 ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-brand-500 hover:bg-brand-100 hover:text-brand-800"
            onClick={() => removeTag(t)}
            aria-label={`Remove tag ${t}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        className="min-w-[120px] flex-1 border-0 bg-transparent py-0.5 text-sm outline-none placeholder:text-ink-400"
        placeholder={tags.length ? '' : placeholder}
        value={draft}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => commitDraft()}
      />
    </div>
  );
}

/**
 * Read-only display of tags as pills. When `onToggle` is provided, each pill
 * becomes a button: clicking adds/removes the tag from `activeTags`, useful
 * as a filter row.
 *
 * Props:
 *  - tags: string[]
 *  - activeTags?: string[]
 *  - onToggle?: (tag: string) => void
 *  - size?: 'sm' | 'xs'
 */
export function TagPills({ tags = [], activeTags = [], onToggle, size = 'xs' }) {
  if (!tags?.length) return null;
  const interactive = typeof onToggle === 'function';
  const sizeClass =
    size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0.5 text-2xs';
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => {
        const active = activeTags.includes(t);
        const Component = interactive ? 'button' : 'span';
        return (
          <Component
            key={t}
            type={interactive ? 'button' : undefined}
            onClick={interactive ? () => onToggle(t) : undefined}
            className={[
              'rounded-full font-medium',
              sizeClass,
              active
                ? 'bg-brand-500 text-white'
                : 'bg-ink-100 text-ink-700',
              interactive ? 'cursor-pointer transition hover:bg-ink-200' : '',
              interactive && active ? 'hover:bg-brand-600' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {t}
          </Component>
        );
      })}
    </div>
  );
}
