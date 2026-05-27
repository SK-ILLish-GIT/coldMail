import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { api } from '../lib/api.js';
import { confirmAsync } from '../lib/confirm.jsx';
import EmptyState from './EmptyState.jsx';
import { TagInput, TagPills } from './Tags.jsx';
import TailoredForPill from './TailoredForPill.jsx';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function isPdf(file) {
  if (!file) return false;
  if (file.type === 'application/pdf') return true;
  return /\.pdf$/i.test(file.name || '');
}

const AUTO_TAG_KEY = 'coldmail.autoTagOnUpload';

export default function ResumeLibrary({ onChange, aiEnabled = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [tags, setTags] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  // Persisted: when on, an upload also kicks off the AI tag-suggest flow
  // and merges results into the tag list before saving.
  const [autoTagOnUpload, setAutoTagOnUpload] = useState(() => {
    try {
      return localStorage.getItem(AUTO_TAG_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState([]);
  const fileInputRef = useRef(null);

  const persistAutoTag = (value) => {
    setAutoTagOnUpload(value);
    try {
      localStorage.setItem(AUTO_TAG_KEY, value ? '1' : '0');
    } catch {
      /* non-fatal */
    }
  };

  // Merge AI-suggested tags into the existing list, dedupe case-insensitively.
  const mergeTags = (existing, suggested) => {
    const lower = new Set(existing.map((t) => t.toLowerCase()));
    const out = [...existing];
    for (const t of suggested) {
      if (!lower.has(t.toLowerCase())) {
        out.push(t);
        lower.add(t.toLowerCase());
      }
    }
    return out;
  };

  const suggestTags = async (forFile = file) => {
    if (!forFile) {
      toast.error('Choose a PDF first.');
      return null;
    }
    if (!aiEnabled) {
      toast.error('AI is disabled. Set GEMINI_API_KEY on the server.');
      return null;
    }
    setSuggesting(true);
    try {
      const res = await api.suggestResumeTags(forFile);
      const suggested = Array.isArray(res?.tags) ? res.tags : [];
      if (!suggested.length) {
        toast('No tags inferred from the PDF.', { icon: 'ℹ️' });
      } else {
        toast.success(`Suggested ${suggested.length} tag${suggested.length === 1 ? '' : 's'} from the PDF.`);
      }
      return suggested;
    } catch (err) {
      toast.error(err.message || 'Tag suggestion failed');
      return null;
    } finally {
      setSuggesting(false);
    }
  };

  const handleSuggestClick = async () => {
    const suggested = await suggestTags();
    if (suggested && suggested.length) {
      setTags((cur) => mergeTags(cur, suggested));
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api.listResumes();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.message || 'Failed to load resumes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onPickFile = (f) => {
    if (!f) {
      setFile(null);
      return;
    }
    if (!isPdf(f)) {
      toast.error(`"${f.name}" isn't a PDF.`);
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      toast.error(`"${f.name}" is over 10 MB.`);
      return;
    }
    setFile(f);
    if (!name.trim()) setName(f.name.replace(/\.pdf$/i, ''));
  };

  const upload = async () => {
    if (!file) return toast.error('Choose a PDF first.');
    if (!name.trim()) return toast.error('Give the resume a name.');
    setUploading(true);
    try {
      // If auto-tag is on (and AI is configured), call the suggest endpoint
      // before uploading so the resume lands in the library with tags
      // already attached. Failures here are non-fatal — we still upload.
      let finalTags = tags;
      if (autoTagOnUpload && aiEnabled) {
        try {
          const res = await api.suggestResumeTags(file);
          if (Array.isArray(res?.tags) && res.tags.length) {
            finalTags = mergeTags(tags, res.tags);
            setTags(finalTags);
          }
        } catch (err) {
          toast(`Auto-tag skipped: ${err.message || 'AI error'}`, { icon: '⚠️' });
        }
      }
      await api.uploadResume(name.trim(), file, finalTags);
      toast.success(`Uploaded "${name.trim()}".`);
      setName('');
      setFile(null);
      setTags([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refresh();
      onChange?.();
    } catch (err) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditTags(item.tags || []);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditTags([]);
  };

  const saveEdit = async (id) => {
    if (!editName.trim()) return toast.error('Name cannot be empty.');
    try {
      await api.updateResume(id, { name: editName.trim(), tags: editTags });
      toast.success('Saved.');
      cancelEdit();
      await refresh();
      onChange?.();
    } catch (err) {
      toast.error(err.message || 'Save failed');
    }
  };

  const remove = async (item) => {
    const ok = await confirmAsync({
      title: `Delete "${item.name}"?`,
      description: "This can't be undone.",
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteResume(item.id);
      toast.success('Deleted.');
      await refresh();
      onChange?.();
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    }
  };

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/60 dark:border-ink-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900 dark:text-ink-100">Upload a resume</h2>
            <p className="text-xs text-ink-500 dark:text-ink-400">PDF · max 10 MB</p>
          </div>
        </header>
        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <label className="label" htmlFor="resume-name">Name (your label)</label>
              <input
                id="resume-name"
                type="text"
                className="input"
                placeholder="e.g. Frontend role v3"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col">
              <label className="label">PDF file</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="input !p-1.5"
                onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              />
              {file && (
                <p className="hint mt-1">
                  {file.name} · {fmtSize(file.size)}
                </p>
              )}
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
              <label className="label !mb-0">Tags</label>
              <button
                type="button"
                className="btn-ghost btn-xs text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:ring-brand-800/50 dark:bg-brand-900/20 dark:hover:bg-brand-900/40"
                onClick={handleSuggestClick}
                disabled={!aiEnabled || !file || suggesting || uploading}
                title={
                  !aiEnabled
                    ? 'AI is disabled on the server — set GEMINI_API_KEY'
                    : !file
                      ? 'Pick a PDF first'
                      : 'Read the PDF and propose tags (merged with what you already have)'
                }
              >
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
                {suggesting ? 'Asking AI...' : 'Suggest from PDF'}
              </button>
            </div>
            <TagInput tags={tags} onChange={setTags} />
            <label className="mt-2 flex items-center gap-2 text-2xs text-ink-500 dark:text-ink-400">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={autoTagOnUpload}
                onChange={(e) => persistAutoTag(e.target.checked)}
                disabled={!aiEnabled}
              />
              Auto-tag from PDF when I upload
              {!aiEnabled && (
                <span className="text-rose-600 dark:text-rose-400">
                  (AI off — set GEMINI_API_KEY)
                </span>
              )}
            </label>
          </div>
          <div>
            <button
              type="button"
              className="btn-primary"
              onClick={upload}
              disabled={uploading || suggesting || !file || !name.trim()}
            >
              {uploading ? 'Uploading...' : 'Upload PDF'}
            </button>
          </div>
        </div>
      </section>

      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/60 dark:border-ink-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900 dark:text-ink-100">Your resumes</h2>
            <p className="text-xs text-ink-500 dark:text-ink-400">{items.length} stored</p>
          </div>
          <button type="button" className="btn-ghost btn-xs" onClick={refresh}>
            Refresh
          </button>
        </header>

        {loading ? (
          <div className="p-6">
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-ink-100 dark:bg-ink-800" />
              ))}
            </div>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="mail"
            title="No resumes yet"
            description="Upload your first PDF above. You can keep different versions for different roles."
          />
        ) : (
          <ul className="divide-y divide-ink-200/60 dark:divide-ink-800">
            {items.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-start gap-3 px-6 py-3 transition hover:bg-ink-50/40 dark:hover:bg-ink-800/60"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-300">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </span>

                <div className="min-w-0 flex-1 space-y-1.5">
                  {editingId === r.id ? (
                    <>
                      <input
                        type="text"
                        className="input !h-8 !py-1 text-sm"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                      />
                      <TagInput tags={editTags} onChange={setEditTags} />
                    </>
                  ) : (
                    <>
                      <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-100">{r.name}</p>
                      {r.tailoredFor ? (
                        <div className="mt-1">
                          <TailoredForPill tailoredFor={r.tailoredFor} />
                        </div>
                      ) : null}
                      {r.tags?.length > 0 && <TagPills tags={r.tags} />}
                    </>
                  )}
                  <p className="truncate text-2xs text-ink-500 dark:text-ink-400">
                    {r.filename || 'resume.pdf'} · {fmtSize(r.size)} · {fmtDate(r.createdAt)}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <a
                    className="btn-ghost btn-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:ring-emerald-800/50 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/40"
                    href={api.resumeDownloadUrl(r.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View
                  </a>
                  {editingId === r.id ? (
                    <>
                      <button
                        type="button"
                        className="btn-primary btn-xs"
                        onClick={() => saveEdit(r.id)}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn-ghost btn-xs text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:ring-amber-800/50 dark:bg-amber-900/20 dark:hover:bg-amber-900/40"
                        onClick={() => startEdit(r)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-xs text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:ring-rose-800/50 dark:bg-rose-900/20 dark:hover:bg-rose-900/40"
                        onClick={() => remove(r)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
