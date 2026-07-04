import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { api } from "../lib/api.js";
import { confirmAsync } from "../lib/confirm.jsx";
import { useTailorTarget } from "../context/tailorTarget.jsx";
import AutoTagModal from "./AutoTagModal.jsx";
import EmptyState from "./EmptyState.jsx";
import RowActionsMenu from "./RowActionsMenu.jsx";
import Spinner from "./Spinner.jsx";
import { TagInput, TagPills } from "./Tags.jsx";
import TailoredForPill from "./TailoredForPill.jsx";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function isPdf(file) {
  if (!file) return false;
  if (file.type === "application/pdf") return true;
  return /\.pdf$/i.test(file.name || "");
}

const AUTO_TAG_KEY = "coldmail.autoTagOnUpload";

export default function ResumeLibrary({
  onChange,
  onUseResume,
  aiEnabled = false,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [tags, setTags] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  // Persisted: when on, an upload also kicks off the AI tag-suggest flow
  // and merges results into the tag list before saving.
  const [autoTagOnUpload, setAutoTagOnUpload] = useState(() => {
    try {
      return localStorage.getItem(AUTO_TAG_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState([]);
  // Upload form is a modal now — only mounted when the user opens it from
  // the"+ Upload resume" button. List stays full-width otherwise.
  const [uploadOpen, setUploadOpen] = useState(false);
  const [updateVersionTarget, setUpdateVersionTarget] = useState(null);
  const [updateVersionFile, setUpdateVersionFile] = useState(null);
  const [updatingVersion, setUpdatingVersion] = useState(false);
  const fileInputRef = useRef(null);
  const updateVersionInputRef = useRef(null);
  const { requestTailorResume } = useTailorTarget();
  const [autoTagLoading, setAutoTagLoading] = useState(false);
  const [autoTagApplying, setAutoTagApplying] = useState(false);
  const [autoTagSession, setAutoTagSession] = useState(null);

  const persistAutoTag = (value) => {
    setAutoTagOnUpload(value);
    try {
      localStorage.setItem(AUTO_TAG_KEY, value ? "1" : "0");
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
      toast.error("Choose a PDF first.");
      return null;
    }
    if (!aiEnabled) {
      toast.error("AI is disabled. Set GEMINI_API_KEY on the server.");
      return null;
    }
    setSuggesting(true);
    try {
      const res = await api.suggestResumeTags(forFile);
      const suggested = Array.isArray(res?.tags) ? res.tags : [];
      if (!suggested.length) {
        toast("No tags inferred from the PDF.", { icon: "ℹ️" });
      } else {
        toast.success(
          `Suggested ${suggested.length} tag${suggested.length === 1 ? "" : "s"} from the PDF.`,
        );
      }
      return suggested;
    } catch (err) {
      toast.error(err.message || "Tag suggestion failed");
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
      toast.error(err.message || "Failed to load resumes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // Escape closes the upload modal + body scroll lock. Mirrors the modal
  // pattern used elsewhere so the overlay UX is consistent.
  useEffect(() => {
    if (!uploadOpen) return;
    const onKey = (e) =>
      e.key === "Escape" && !uploading && setUploadOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [uploadOpen, uploading]);

  useEffect(() => {
    if (!updateVersionTarget) return;
    const onKey = (e) =>
      e.key === "Escape" && !updatingVersion && closeUpdateVersionModal();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [updateVersionTarget, updatingVersion]);

  const resetUploadForm = () => {
    setName("");
    setFile(null);
    setTags([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openUploadModal = () => {
    resetUploadForm();
    setUploadOpen(true);
  };

  const closeUploadModal = () => {
    if (uploading) return;
    setUploadOpen(false);
    resetUploadForm();
  };

  const resetUpdateVersionForm = () => {
    setUpdateVersionFile(null);
    if (updateVersionInputRef.current) updateVersionInputRef.current.value = "";
  };

  const openUpdateVersionModal = (item) => {
    resetUpdateVersionForm();
    setUpdateVersionTarget(item);
  };

  const closeUpdateVersionModal = () => {
    if (updatingVersion) return;
    setUpdateVersionTarget(null);
    resetUpdateVersionForm();
  };

  const onPickUpdateVersionFile = (f) => {
    if (!f) {
      setUpdateVersionFile(null);
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
    setUpdateVersionFile(f);
  };

  const updateVersion = async () => {
    const item = updateVersionTarget;
    if (!item) return;
    if (!updateVersionFile) return toast.error("Choose a PDF first.");
    setUpdatingVersion(true);
    try {
      await api.updateResumeVersion(item.id, updateVersionFile);
      toast.success(`Updated PDF for "${item.name}".`);
      closeUpdateVersionModal();
      await refresh();
      onChange?.();
    } catch (err) {
      toast.error(err.message || "Update failed");
    } finally {
      setUpdatingVersion(false);
    }
  };

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
    if (!name.trim()) setName(f.name.replace(/\.pdf$/i, ""));
  };

  const upload = async () => {
    if (!file) return toast.error("Choose a PDF first.");
    if (!name.trim()) return toast.error("Give the resume a name.");
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
          toast(`Auto-tag skipped: ${err.message || "AI error"}`, {
            icon: "⚠️",
          });
        }
      }
      await api.uploadResume(name.trim(), file, finalTags);
      toast.success(`Uploaded"${name.trim()}".`);
      resetUploadForm();
      setUploadOpen(false);
      await refresh();
      onChange?.();
    } catch (err) {
      toast.error(err.message || "Upload failed");
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
    setEditName("");
    setEditTags([]);
  };

  const saveEdit = async (id) => {
    if (!editName.trim()) return toast.error("Name cannot be empty.");
    try {
      await api.updateResume(id, { name: editName.trim(), tags: editTags });
      toast.success("Saved.");
      cancelEdit();
      await refresh();
      onChange?.();
    } catch (err) {
      toast.error(err.message || "Save failed");
    }
  };

  const onAutoTagRow = async (item) => {
    if (!aiEnabled) {
      return toast.error(
        "AI is disabled on the server — set GEMINI_API_KEY to enable.",
      );
    }
    setAutoTagLoading(true);
    try {
      const res = await api.suggestStoredResumeTags(item.id);
      const proposed = Array.isArray(res?.tags) ? res.tags : [];
      setAutoTagSession({
        target: item,
        existingTags: item.tags || [],
        proposed,
      });
    } catch (err) {
      toast.error(err.message || "Auto-tag failed.");
    } finally {
      setAutoTagLoading(false);
    }
  };

  const applyAutoTags = async (finalTags) => {
    const item = autoTagSession?.target;
    if (!item) {
      setAutoTagSession(null);
      return;
    }
    setAutoTagApplying(true);
    try {
      await api.updateResume(item.id, { name: item.name, tags: finalTags });
      toast.success(`Tags updated on"${item.name}".`);
      setAutoTagSession(null);
      await refresh();
      onChange?.();
    } catch (err) {
      toast.error(err.message || "Failed to save tags.");
    } finally {
      setAutoTagApplying(false);
    }
  };

  const remove = async (item) => {
    const ok = await confirmAsync({
      title: `Delete"${item.name}"?`,
      description: "This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteResume(item.id);
      toast.success("Deleted.");
      await refresh();
      onChange?.();
    } catch (err) {
      toast.error(err.message || "Delete failed");
    }
  };

  const toggleDefault = async (item) => {
    try {
      if (item.isDefault) {
        await api.clearDefaultResume(item.id);
        toast.success("Removed default resume.");
      } else {
        await api.setDefaultResume(item.id);
        toast.success(`"${item.name}" is now your default resume.`);
      }
      await refresh();
    } catch (err) {
      toast.error(err.message || "Could not update default");
    }
  };

  // Downloads are auth-protected, so open via an authenticated blob fetch
  // instead of a plain link (which would 401). Open the tab synchronously to
  // dodge popup blockers, then point it at the object URL.
  const viewResume = async (item) => {
    const win = window.open("", "_blank");
    try {
      const url = await api.openResumeObjectUrl(item.id);
      if (win) win.location = url;
      else window.open(url, "_blank");
    } catch (err) {
      if (win) win.close();
      toast.error(err.message || "Could not open resume");
    }
  };

  return (
    <>
      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border/70 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-ui-fg">Your resumes</h2>
            <p className="text-xs text-ui-fg-muted">
              {items.length} stored · PDF, max 10 MB
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={refresh}
            >
              Refresh
            </button>
            <button
              type="button"
              className="btn-primary btn-xs"
              onClick={openUploadModal}
            >
              + Upload resume
            </button>
          </div>
        </header>

        {loading ? (
          <div className="p-6">
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-lg bg-ui-inset"
                />
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
                className="flex flex-wrap items-start gap-3 px-6 py-3 transition hover:bg-ui-inset/50"
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
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ui-fg">
                        <span className="truncate">{r.name}</span>
                        {r.isDefault && (
                          <span className="pill shrink-0 bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/15 dark:text-brand-300">
                            ★ Default
                          </span>
                        )}
                      </p>
                      {r.tailoredFor ? (
                        <div className="mt-1">
                          <TailoredForPill tailoredFor={r.tailoredFor} />
                        </div>
                      ) : null}
                      {r.tags?.length > 0 ? (
                        <div className="mt-1.5">
                          <TagPills tags={r.tags} size="sm" maxVisible={8} />
                        </div>
                      ) : null}
                    </>
                  )}
                  <p className="truncate text-2xs text-ui-fg-muted">
                    {r.filename || "resume.pdf"} · {fmtSize(r.size)} ·{""}
                    {fmtDate(r.createdAt)}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
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
                        className="btn-primary btn-sm"
                        onClick={() => onUseResume?.(r)}
                        disabled={!onUseResume}
                        title="Attach this resume in Compose"
                      >
                        Use
                      </button>
                      <RowActionsMenu
                        items={[
                          {
                            label: "View",
                            onClick: () => viewResume(r),
                            tone: "emerald",
                          },
                          {
                            label: r.isDefault
                              ? "Remove default"
                              : "Set as default",
                            onClick: () => toggleDefault(r),
                            tone: "emerald",
                          },
                          {
                            label: "AI Tailor",
                            onClick: () => requestTailorResume(),
                            tone: "brand",
                          },
                          aiEnabled && {
                            label:
                              autoTagLoading &&
                              autoTagSession?.target?.id === r.id
                                ? "Tagging..."
                                : "Auto tag",
                            onClick: () => onAutoTagRow(r),
                            disabled: autoTagLoading,
                            tone: "indigo",
                          },
                          {
                            label: "Edit",
                            onClick: () => startEdit(r),
                            tone: "amber",
                          },
                          {
                            label: "Update version",
                            onClick: () => openUpdateVersionModal(r),
                            tone: "brand",
                          },
                          {
                            label: "Delete",
                            onClick: () => remove(r),
                            tone: "rose",
                            separated: true,
                          },
                        ].filter(Boolean)}
                      />
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Upload-resume modal. Backdrop click + Escape close (unless mid-upload). */}
      {uploadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ui-overlay/50 p-4 backdrop-blur-sm anim-in"
          onClick={closeUploadModal}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-ui-panel shadow-lift"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-ui-border/70 px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-ui-fg">
                  Upload a resume
                </h3>
                <p className="mt-0.5 text-xs text-ui-fg-muted">
                  PDF · max 10 MB
                </p>
              </div>
              <button
                type="button"
                onClick={closeUploadModal}
                disabled={uploading}
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

            <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <label className="label" htmlFor="resume-name">
                    Name (your label)
                  </label>
                  <input
                    id="resume-name"
                    type="text"
                    className="input"
                    placeholder="e.g. Frontend role v3"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
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
                        ? "AI is disabled on the server — set GEMINI_API_KEY"
                        : !file
                          ? "Pick a PDF first"
                          : "Read the PDF and propose tags (merged with what you already have)"
                    }
                  >
                    {suggesting ? (
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
                    {suggesting ? "Asking AI..." : "Suggest from PDF"}
                  </button>
                </div>
                <TagInput tags={tags} onChange={setTags} />
                <label className="mt-2 flex items-center gap-2 text-2xs text-ui-fg-muted">
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
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-ui-border/70 bg-ui-inset/50 px-5 py-3">
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={closeUploadModal}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={upload}
                disabled={uploading || suggesting || !file || !name.trim()}
              >
                {uploading ? "Uploading..." : "Upload PDF"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Update-version modal — replaces the stored PDF for an existing resume. */}
      {updateVersionTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ui-overlay/50 p-4 backdrop-blur-sm anim-in"
          onClick={closeUpdateVersionModal}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-ui-panel shadow-lift"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-ui-border/70 px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-ui-fg">
                  Update version
                </h3>
                <p className="mt-0.5 truncate text-xs text-ui-fg-muted">
                  Replace the PDF for "{updateVersionTarget.name}" · keeps name
                  and tags
                </p>
              </div>
              <button
                type="button"
                onClick={closeUpdateVersionModal}
                disabled={updatingVersion}
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

            <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
              <p className="text-xs text-ui-fg-muted">
                Current file: {updateVersionTarget.filename || "resume.pdf"} ·{" "}
                {fmtSize(updateVersionTarget.size)}
              </p>
              <div>
                <label className="label">New PDF file</label>
                <input
                  ref={updateVersionInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="input !p-1.5"
                  onChange={(e) =>
                    onPickUpdateVersionFile(e.target.files?.[0] || null)
                  }
                />
                {updateVersionFile && (
                  <p className="hint mt-1">
                    {updateVersionFile.name} · {fmtSize(updateVersionFile.size)}
                  </p>
                )}
              </div>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-ui-border/70 bg-ui-inset/50 px-5 py-3">
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={closeUpdateVersionModal}
                disabled={updatingVersion}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={updateVersion}
                disabled={updatingVersion || !updateVersionFile}
              >
                {updatingVersion ? "Updating..." : "Replace PDF"}
              </button>
            </footer>
          </div>
        </div>
      )}

      <AutoTagModal
        open={!!autoTagSession}
        onClose={() => (autoTagApplying ? null : setAutoTagSession(null))}
        onApply={applyAutoTags}
        existingTags={autoTagSession?.existingTags || []}
        proposed={autoTagSession?.proposed || []}
        title={`Auto-tag"${autoTagSession?.target?.name || ""}"`}
        subtitle="Selected tags will be saved to this resume immediately."
        applying={autoTagApplying}
      />
    </>
  );
}
