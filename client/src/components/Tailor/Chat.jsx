import { useState } from 'react';

const SECTION_LABELS = {
  summary: 'Summary',
  skills: 'Skills',
  experience: 'Experience',
  projects: 'Projects',
  certifications: 'Certifications',
  coding: 'Coding',
  education: 'Education',
};

const ACTION_LABELS = {
  replace_bullet: 'Rewrite bullet',
  replace_summary: 'Rewrite summary',
  update_skills_line: 'Update skills line',
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
  const [editText, setEditText] = useState('');

  const submitEdit = () => {
    if (!editText.trim()) return;
    onDecide('edit', editText.trim());
    setEditOpen(false);
    setEditText('');
  };

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
        <p className="mt-3 text-xs text-ink-600 dark:text-ink-300">
          <span className="font-semibold">Why: </span>
          {suggestion.reason}
        </p>
      ) : null}

      {suggestion.targetBulletText ? (
        <div className="mt-3">
          <p className="label">Before</p>
          <p className="rounded-md bg-rose-50/70 px-3 py-2 font-mono text-xs text-ink-700 dark:bg-rose-900/20 dark:text-ink-200">
            {suggestion.targetBulletText}
          </p>
        </div>
      ) : null}

      <div className="mt-3">
        <p className="label">
          {suggestion.targetBulletText ? 'After' : 'New content'}
        </p>
        <p className="rounded-md bg-emerald-50/70 px-3 py-2 font-mono text-xs text-ink-700 dark:bg-emerald-900/20 dark:text-ink-100">
          {suggestion.previewText}
        </p>
        <details className="mt-2 text-2xs text-ink-500 dark:text-ink-400">
          <summary className="cursor-pointer">View LaTeX</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-ink-50 px-3 py-2 text-2xs text-ink-700 dark:bg-ink-800 dark:text-ink-200">
            {suggestion.draftLatex}
          </pre>
        </details>
      </div>

      <ChipList items={suggestion.atsKeywords} />

      {editOpen ? (
        <div className="mt-3 rounded-md border border-ink-200/70 bg-white p-3 dark:border-ink-700 dark:bg-ink-900">
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
                setEditText('');
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
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="btn-primary"
            onClick={() => onDecide('approve')}
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
            onClick={() => onDecide('reject')}
            disabled={busy}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function Bubble({ role, children }) {
  const cls =
    role === 'user'
      ? 'ml-auto bg-brand-600 text-white'
      : role === 'system'
        ? 'mx-auto bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300'
        : 'bg-white text-ink-800 ring-1 ring-ink-200/70 dark:bg-ink-900 dark:text-ink-100 dark:ring-ink-700';
  return (
    <div
      className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${cls}`}
    >
      {children}
    </div>
  );
}

// Render a past decision. The user can re-decide via the inline buttons —
// the "current" pill flips to the new outcome on the server's response.
function HistoryItem({ suggestion, decision, busy, onRedecide }) {
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState('');

  const tone =
    decision === 'applied' || decision === 'refined-applied'
      ? 'pill-emerald'
      : decision === 'rejected'
        ? 'pill-rose'
        : decision === 'failed'
          ? 'pill-rose'
          : 'pill-amber';
  const label =
    decision === 'applied' || decision === 'refined-applied'
      ? 'Applied'
      : decision === 'rejected'
        ? 'Rejected'
        : decision === 'failed'
          ? 'Failed'
          : decision === 'refined'
            ? 'Refined (pending)'
            : decision;

  const isApplied = decision === 'applied' || decision === 'refined-applied';
  const isRejected = decision === 'rejected';

  const submitEdit = () => {
    if (!editText.trim()) return;
    onRedecide?.(suggestion, 'edit', editText.trim());
    setEditOpen(false);
    setEditText('');
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
      <p className="mt-2 text-xs text-ink-600 dark:text-ink-300">
        {suggestion.previewText}
      </p>

      {onRedecide ? (
        editOpen ? (
          <div className="mt-2 rounded-md border border-ink-200/70 bg-white p-2 dark:border-ink-700 dark:bg-ink-900">
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
                  setEditText('');
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
                onClick={() => onRedecide(suggestion, 'approve')}
                disabled={busy}
              >
                Approve
              </button>
            ) : null}
            {!isRejected ? (
              <button
                className="btn-ghost btn-xs"
                onClick={() => onRedecide(suggestion, 'reject')}
                disabled={busy}
                title={
                  isApplied
                    ? 'Revert this change — your other approved edits stay applied.'
                    : 'Mark this suggestion rejected.'
                }
              >
                {isApplied ? 'Revert' : 'Reject'}
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

export default function Chat({ messages, current, done, busy, onDecide, onRedecide }) {
  return (
    <div className="space-y-3">
      {messages.map((m, i) => {
        if (m.role === 'history') {
          return (
            <HistoryItem
              key={`${m.suggestion?.id || 'h'}-${i}`}
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
        <SuggestionCard
          suggestion={current}
          busy={busy}
          onDecide={onDecide}
        />
      ) : null}
    </div>
  );
}
