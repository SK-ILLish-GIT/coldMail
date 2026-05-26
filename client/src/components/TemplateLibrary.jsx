import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { api } from '../lib/api.js';
import { confirmAsync } from '../lib/confirm.jsx';
import { useTailorTarget } from '../lib/tailorTarget.jsx';
import EmptyState from './EmptyState.jsx';
import { TagInput, TagPills } from './Tags.jsx';
import TailoredForPill from './TailoredForPill.jsx';

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const BLANK = { name: '', subject: '', body: '', tags: [] };

export default function TemplateLibrary({ onUseTemplate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(BLANK);
  // Tailoring is now a single canonical flow on the Tailor tab. Clicking
  // "AI Tailor" here just stages the chosen template and switches tab.
  const { requestTailorTemplate } = useTailorTarget();

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api.listTemplates();
      setItems(data);
    } catch (err) {
      toast.error(err.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const startEdit = (tpl) => {
    setEditingId(tpl.id);
    setForm({
      name: tpl.name,
      subject: tpl.subject,
      body: tpl.body,
      tags: tpl.tags || [],
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(BLANK);
  };

  const save = async () => {
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) {
      return toast.error('Name, subject and body are required.');
    }
    try {
      if (editingId) {
        await api.updateTemplate(editingId, form);
        toast.success('Template updated.');
      } else {
        await api.createTemplate(form);
        toast.success('Template created.');
      }
      cancelEdit();
      refresh();
    } catch (err) {
      toast.error(err.message || 'Save failed');
    }
  };

  const remove = async (tpl) => {
    const ok = await confirmAsync({
      title: `Delete template "${tpl.name}"?`,
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteTemplate(tpl.id);
      toast.success('Template deleted.');
      refresh();
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <section className="card overflow-hidden lg:col-span-3">
        <header className="flex items-center justify-between border-b border-ink-200/60 dark:border-ink-800 px-6 py-4">
          <h2 className="text-base font-semibold text-ink-900 dark:text-ink-100">Saved templates</h2>
          <button type="button" className="btn-ghost btn-xs" onClick={refresh}>
            Refresh
          </button>
        </header>

        {loading ? (
          <div className="space-y-2 p-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-ink-100 dark:bg-ink-800" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="template"
            title="No templates yet"
            description="Save subject + body combos here for quick reuse across campaigns."
          />
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {items.map((tpl) => (
              <li
                key={tpl.id}
                className="flex flex-wrap items-start justify-between gap-3 px-6 py-4 transition hover:bg-ink-50/40 dark:hover:bg-ink-800/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-900 dark:text-ink-100">{tpl.name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-500 dark:text-ink-400">{tpl.subject}</p>
                  {tpl.tailoredFor ? (
                    <div className="mt-1.5">
                      <TailoredForPill tailoredFor={tpl.tailoredFor} />
                    </div>
                  ) : null}
                  {tpl.tags?.length > 0 && (
                    <div className="mt-1.5">
                      <TagPills tags={tpl.tags} />
                    </div>
                  )}
                  <p className="mt-1 text-2xs text-ink-400 dark:text-ink-500">
                    Updated {fmtDate(tpl.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="btn-primary btn-xs"
                    onClick={() => onUseTemplate(tpl)}
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-xs text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:ring-brand-800/50 dark:bg-brand-900/20 dark:hover:bg-brand-900/40"
                    onClick={() => requestTailorTemplate(tpl)}
                    title="Open the Tailor tab with this template pre-selected"
                  >
                    AI Tailor →
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-xs text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:ring-amber-800/50 dark:bg-amber-900/20 dark:hover:bg-amber-900/40"
                    onClick={() => startEdit(tpl)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-xs text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:ring-rose-800/50 dark:bg-rose-900/20 dark:hover:bg-rose-900/40"
                    onClick={() => remove(tpl)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside className="card overflow-hidden lg:col-span-2">
        <header className="border-b border-ink-200/60 dark:border-ink-800 px-5 py-4">
          <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-100">
            {editingId ? 'Edit template' : 'New template'}
          </h3>
        </header>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="label">Name</label>
            <input
              type="text"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Cold outreach v1"
            />
          </div>
          <div>
            <label className="label">Subject</label>
            <input
              type="text"
              className="input"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Quick question for {{company}}"
            />
          </div>
          <div>
            <label className="label">Body (HTML)</label>
            <textarea
              className="input-mono min-h-[200px]"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="<h2>Hello {{name}}</h2>"
            />
          </div>
          <div>
            <label className="label">Tags</label>
            <TagInput
              tags={form.tags}
              onChange={(tags) => setForm({ ...form, tags })}
            />
          </div>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-ink-200/60 dark:border-ink-800 bg-ink-50/40 dark:bg-ink-800/40 px-5 py-3">
          {editingId && (
            <button type="button" className="btn-ghost btn-xs" onClick={cancelEdit}>
              Cancel
            </button>
          )}
          <button type="button" className="btn-primary" onClick={save}>
            {editingId ? 'Update template' : 'Create template'}
          </button>
        </footer>
      </aside>
    </div>
  );
}
