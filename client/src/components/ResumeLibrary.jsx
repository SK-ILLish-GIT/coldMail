import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { api } from '../lib/api.js';
import EmptyState from './EmptyState.jsx';
import { TagInput, TagPills } from './Tags.jsx';

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

export default function ResumeLibrary({ onChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [tags, setTags] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState([]);
  const fileInputRef = useRef(null);

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
      await api.uploadResume(name.trim(), file, tags);
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
    if (!confirm(`Delete "${item.name}"? This can't be undone.`)) return;
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
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/60 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Upload a resume</h2>
            <p className="text-xs text-ink-500">
              PDF only · max 10 MB · stored in MongoDB · pick one from
              the Compose tab when drafting.
            </p>
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
            <label className="label">Tags</label>
            <TagInput tags={tags} onChange={setTags} />
            <p className="hint mt-1">
              e.g. <span className="font-mono">backend, java, golang, sre</span> — used to filter pickers in Compose.
            </p>
          </div>
          <div>
            <button
              type="button"
              className="btn-primary"
              onClick={upload}
              disabled={uploading || !file || !name.trim()}
            >
              {uploading ? 'Uploading...' : 'Upload PDF'}
            </button>
          </div>
        </div>
      </section>

      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/60 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Your resumes</h2>
            <p className="text-xs text-ink-500">
              {items.length} stored · attached files are auto-renamed on
              draft for consistency.
            </p>
          </div>
          <button type="button" className="btn-ghost btn-xs" onClick={refresh}>
            Refresh
          </button>
        </header>

        {loading ? (
          <div className="p-6">
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-ink-100" />
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
          <ul className="divide-y divide-ink-200/60">
            {items.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-start gap-3 px-6 py-3 transition hover:bg-ink-50/40"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-rose-50 text-rose-600">
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
                      <p className="truncate text-sm font-medium text-ink-900">{r.name}</p>
                      {r.tags?.length > 0 && <TagPills tags={r.tags} />}
                    </>
                  )}
                  <p className="truncate text-2xs text-ink-500">
                    {r.filename || 'resume.pdf'} · {fmtSize(r.size)} · {fmtDate(r.createdAt)}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <a
                    className="btn-ghost btn-xs"
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
                        className="btn-ghost btn-xs"
                        onClick={() => startEdit(r)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-xs text-rose-600 hover:bg-rose-50"
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
