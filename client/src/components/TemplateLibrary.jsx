import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { api } from "../lib/api.js";
import { confirmAsync } from "../lib/confirm.jsx";
import { extractVariables, renderTemplate } from "../lib/render.js";
import { useTailorTarget } from "../context/tailorTarget.jsx";
import AutoTagModal from "./AutoTagModal.jsx";
import EmptyState from "./EmptyState.jsx";
import PreviewModal from "./PreviewModal.jsx";
import RowActionsMenu from "./RowActionsMenu.jsx";
import Spinner from "./Spinner.jsx";
import { TagInput, TagPills } from "./Tags.jsx";
import TailoredForPill from "./TailoredForPill.jsx";
import VariableChips from "./VariableChips.jsx";

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const BLANK = { name: "", subject: "", body: "", tags: [] };

// Sample merge values used purely for the preview modal so {{name}} /
// {{company}} / {{email}} render as something readable instead of empty
// strings. These never leave the client.
const PREVIEW_SAMPLE_VARS = {
  name: "Sample Recipient",
  company: "Sample Co",
  email: "sample@example.com",
};

export default function TemplateLibrary({ onUseTemplate, aiEnabled = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(BLANK);
  // Form is a modal now — only mounted/visible when the user explicitly opens
  // it via"New template" or by editing an existing row.
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // The template currently being previewed in the read-only modal.
  const [previewing, setPreviewing] = useState(null);

  // Auto-tag flow state.
  // autoTagSession.mode = 'row' → applying to a saved template (has id)
  // autoTagSession.mode = 'form' → applying to the in-progress form state
  // existingTags + proposed are what the AutoTagModal renders.
  const [autoTagLoading, setAutoTagLoading] = useState(false);
  const [autoTagApplying, setAutoTagApplying] = useState(false);
  const [autoTagSession, setAutoTagSession] = useState(null);

  // Refs for the quick-insert variable chips (insert {{token}} at the caret).
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);

  // Tokens already present in the form, plus {{jobLink}} which Compose can
  // supply at send time. Drives the chip list next to Subject + Body.
  const chipVars = useMemo(
    () =>
      Array.from(
        new Set([
          ...extractVariables(form.subject || ""),
          ...extractVariables(form.body || ""),
          "jobLink",
        ]),
      ),
    [form.subject, form.body],
  );

  // Live preview of the in-progress form, rendered with sample merge vars so
  // {{name}} / {{company}} / {{email}} read as something concrete.
  const livePreviewSubject = useMemo(
    () => renderTemplate(form.subject || "", PREVIEW_SAMPLE_VARS),
    [form.subject],
  );
  const livePreviewHtml = useMemo(
    () => renderTemplate(form.body || "", PREVIEW_SAMPLE_VARS),
    [form.body],
  );
  // Tailoring is now a single canonical flow on the Tailor tab. Clicking
  //"AI Tailor" here just stages the chosen template and switches tab.
  const { requestTailorTemplate } = useTailorTarget();

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api.listTemplates();
      setItems(data);
    } catch (err) {
      toast.error(err.message || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(BLANK);
    setFormOpen(true);
  };

  const startEdit = (tpl) => {
    setEditingId(tpl.id);
    setForm({
      name: tpl.name,
      subject: tpl.subject,
      body: tpl.body,
      tags: tpl.tags || [],
    });
    setFormOpen(true);
  };

  // "Edit a copy": duplicate the template first, then open the edit modal on
  // the new copy so the original stays untouched.
  const editCopy = async (tpl) => {
    try {
      const created = await api.createTemplate({
        name: `${tpl.name} (copy)`,
        subject: tpl.subject || "",
        body: tpl.body || "",
        tags: tpl.tags || [],
      });
      toast.success(`Created a copy of "${tpl.name}".`);
      await refresh();
      startEdit(created);
    } catch (err) {
      toast.error(err.message || "Failed to create a copy.");
    }
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setEditingId(null);
    setForm(BLANK);
  };

  const save = async () => {
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) {
      return toast.error("Name, subject and body are required.");
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.updateTemplate(editingId, form);
        toast.success("Template updated.");
      } else {
        await api.createTemplate(form);
        toast.success("Template created.");
      }
      setFormOpen(false);
      setEditingId(null);
      setForm(BLANK);
      refresh();
    } catch (err) {
      toast.error(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (tpl) => {
    const ok = await confirmAsync({
      title: `Delete template"${tpl.name}"?`,
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteTemplate(tpl.id);
      toast.success("Template deleted.");
      refresh();
    } catch (err) {
      toast.error(err.message || "Delete failed");
    }
  };

  const toggleDefault = async (tpl) => {
    try {
      if (tpl.isDefault) {
        await api.clearDefaultTemplate(tpl.id);
        toast.success("Removed default template.");
      } else {
        await api.setDefaultTemplate(tpl.id);
        toast.success(`"${tpl.name}" is now your default template.`);
      }
      refresh();
    } catch (err) {
      toast.error(err.message || "Could not update default");
    }
  };

  // ----------------------- Auto-tag flow -----------------------
  // Shared helper: fetch AI suggestions for arbitrary subject/body/tags and
  // stage them into AutoTagModal. mode controls how Apply behaves.
  const requestAutoTags = async ({ mode, subject, body, tags, target }) => {
    if (!aiEnabled) {
      return toast.error(
        "AI is disabled on the server — set GEMINI_API_KEY to enable.",
      );
    }
    if (!subject.trim() && !body.trim()) {
      return toast.error("Add a subject or body before auto-tagging.");
    }
    setAutoTagLoading(true);
    try {
      const res = await api.suggestTemplateTags({ subject, body, tags });
      const proposed = Array.isArray(res?.tags) ? res.tags : [];
      setAutoTagSession({
        mode,
        target,
        existingTags: Array.isArray(tags) ? tags : [],
        proposed,
      });
    } catch (err) {
      toast.error(err.message || "Auto-tag failed.");
    } finally {
      setAutoTagLoading(false);
    }
  };

  const onAutoTagRow = (tpl) =>
    requestAutoTags({
      mode: "row",
      subject: tpl.subject || "",
      body: tpl.body || "",
      tags: tpl.tags || [],
      target: tpl,
    });

  const onAutoTagForm = () =>
    requestAutoTags({
      mode: "form",
      subject: form.subject || "",
      body: form.body || "",
      tags: form.tags || [],
      target: null,
    });

  const applyAutoTags = async (finalTags) => {
    if (!autoTagSession) return;
    if (autoTagSession.mode === "form") {
      // Edit/New modal: just patch local form state; the user still has to
      // click Save/Update to persist the template.
      setForm((f) => ({ ...f, tags: finalTags }));
      setAutoTagSession(null);
      toast.success("Tags applied to the form. Save to persist.");
      return;
    }
    // 'row' mode: persist directly via PUT.
    const tpl = autoTagSession.target;
    if (!tpl) {
      setAutoTagSession(null);
      return;
    }
    setAutoTagApplying(true);
    try {
      await api.updateTemplate(tpl.id, {
        name: tpl.name,
        subject: tpl.subject,
        body: tpl.body,
        tags: finalTags,
      });
      toast.success(`Tags updated on"${tpl.name}".`);
      setAutoTagSession(null);
      refresh();
    } catch (err) {
      toast.error(err.message || "Failed to save tags.");
    } finally {
      setAutoTagApplying(false);
    }
  };

  // Escape closes, body scroll-lock while open. Mirrors PreviewModal so
  // overlay behaviour is consistent across the app.
  useEffect(() => {
    if (!formOpen) return;
    const onKey = (e) => e.key === "Escape" && closeForm();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen]);

  return (
    <>
      <section className="card overflow-hidden">
        <header className="flex items-center justify-between border-b border-ui-border/70 px-6 py-4">
          <h2 className="text-base font-semibold text-ui-fg">
            Saved templates
          </h2>
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
              onClick={openCreate}
            >
              + New template
            </button>
          </div>
        </header>

        {loading ? (
          <div className="space-y-2 p-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg bg-ui-inset"
              />
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
                className="flex flex-wrap items-start justify-between gap-3 px-6 py-4 transition hover:bg-ui-inset/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ui-fg">
                    <span className="truncate">{tpl.name}</span>
                    {tpl.isDefault && (
                      <span className="pill shrink-0 bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/15 dark:text-brand-300">
                        ★ Default
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ui-fg-muted">
                    {tpl.subject}
                  </p>
                  {tpl.tailoredFor ? (
                    <div className="mt-1.5">
                      <TailoredForPill tailoredFor={tpl.tailoredFor} />
                    </div>
                  ) : null}
                  {tpl.tags?.length > 0 && (
                    <div className="mt-1.5">
                      <TagPills tags={tpl.tags} size="sm" maxVisible={8} />
                    </div>
                  )}
                  <p className="mt-1 text-2xs text-ui-fg-muted">
                    Updated {fmtDate(tpl.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={() => onUseTemplate(tpl)}
                  >
                    Use
                  </button>
                  <RowActionsMenu
                    items={[
                      {
                        label: "Preview",
                        onClick: () => setPreviewing(tpl),
                      },
                      {
                        label: tpl.isDefault
                          ? "Remove default"
                          : "Set as default",
                        onClick: () => toggleDefault(tpl),
                        tone: "emerald",
                      },
                      {
                        label: "AI Tailor",
                        onClick: () => requestTailorTemplate(tpl),
                        tone: "brand",
                      },
                      aiEnabled && {
                        label:
                          autoTagLoading &&
                          autoTagSession?.target?.id === tpl.id
                            ? "Tagging..."
                            : "Auto tag",
                        onClick: () => onAutoTagRow(tpl),
                        disabled: autoTagLoading,
                        tone: "indigo",
                      },
                      {
                        label: "Edit",
                        onClick: () => startEdit(tpl),
                        tone: "amber",
                      },
                      {
                        label: "Edit a copy",
                        onClick: () => editCopy(tpl),
                        tone: "amber",
                      },
                      {
                        label: "Delete",
                        onClick: () => remove(tpl),
                        tone: "rose",
                        separated: true,
                      },
                    ].filter(Boolean)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Create / edit modal — backdrop click + Escape both close. */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ui-overlay/50 p-4 backdrop-blur-sm anim-in"
          onClick={closeForm}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-ui-panel shadow-lift"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-4 border-b border-ui-border/70 px-5 py-4">
              <h3 className="text-sm font-semibold text-ui-fg">
                {editingId ? "Edit template" : "New template"}
              </h3>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-md p-1.5 text-ui-fg-muted hover:bg-ui-inset/60 hover:text-ui-fg"
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

            {/* Two-column body: form on the left, live preview on the right.
 Each column scrolls independently so a long body doesn't push
 the preview out of view. Stacks vertically on smaller screens. */}
            <div className="grid flex-1 min-h-0 grid-cols-1 md:grid-cols-2 divide-ink-200/60 dark:divide-ink-800 md:divide-x">
              <div className="flex-1 space-y-3 overflow-auto px-5 py-4">
                <div>
                  <label className="label">Name</label>
                  <input
                    type="text"
                    className="input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Cold outreach v1"
                    autoFocus
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-end justify-between gap-3">
                    <label className="label !mb-0">Subject</label>
                    <VariableChips inputRef={subjectRef} extra={chipVars} />
                  </div>
                  <input
                    ref={subjectRef}
                    type="text"
                    className="input"
                    value={form.subject}
                    onChange={(e) =>
                      setForm({ ...form, subject: e.target.value })
                    }
                    placeholder="Quick question for {{company}}"
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-end justify-between gap-3">
                    <label className="label !mb-0">Body (HTML)</label>
                    <VariableChips inputRef={bodyRef} extra={chipVars} />
                  </div>
                  <textarea
                    ref={bodyRef}
                    className="input-mono min-h-[260px]"
                    value={form.body}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                    placeholder="<h2>Hello {{name}}</h2>"
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-end justify-between gap-3">
                    <label className="label !mb-0">Tags</label>
                    {aiEnabled && (
                      <button
                        type="button"
                        className="btn-ghost btn-xs text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:ring-indigo-800/50 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/40"
                        onClick={onAutoTagForm}
                        disabled={autoTagLoading}
                        title="Ask AI for tag suggestions based on the current subject + body"
                      >
                        {autoTagLoading ? (
                          <>
                            <Spinner className="h-3 w-3" />
                            Tagging...
                          </>
                        ) : (
                          "Auto tag"
                        )}
                      </button>
                    )}
                  </div>
                  <TagInput
                    tags={form.tags}
                    onChange={(tags) => setForm({ ...form, tags })}
                  />
                </div>
              </div>

              <div className="flex flex-col overflow-hidden bg-ui-inset/50">
                <div className="flex items-start justify-between gap-3 border-b border-ui-border/70 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ui-fg-muted">
                      Live preview
                    </p>
                    <p className="mt-0.5 truncate text-sm font-medium text-ui-fg">
                      {livePreviewSubject || (
                        <span className="italic text-ui-fg-muted">
                          (no subject)
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-2xs text-ui-fg-muted">
                      Tokens rendered with sample values
                    </p>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  {form.body?.trim() ? (
                    <iframe
                      title="Template live preview"
                      srcDoc={livePreviewHtml}
                      sandbox=""
                      className="preview-frame h-full min-h-[420px] w-full rounded-lg border border-ui-border"
                    />
                  ) : (
                    <div className="grid h-full min-h-[420px] place-items-center rounded-lg border border-dashed border-ui-border bg-ui-panel-muted/80 px-4 text-center text-xs text-ui-fg-muted">
                      Start typing the body — the preview updates live.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-ui-border/70 bg-ui-inset/50 px-5 py-3">
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={closeForm}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={save}
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Update template"
                    : "Create template"}
              </button>
            </footer>
          </div>
        </div>
      )}

      <PreviewModal
        open={!!previewing}
        onClose={() => setPreviewing(null)}
        subject={
          previewing
            ? renderTemplate(previewing.subject || "", PREVIEW_SAMPLE_VARS)
            : ""
        }
        html={
          previewing
            ? renderTemplate(previewing.body || "", PREVIEW_SAMPLE_VARS)
            : ""
        }
        to=""
        editLabel="Edit template"
        onEdit={
          previewing
            ? () => {
                const tpl = previewing;
                setPreviewing(null);
                startEdit(tpl);
              }
            : undefined
        }
      />

      <AutoTagModal
        open={!!autoTagSession}
        onClose={() => (autoTagApplying ? null : setAutoTagSession(null))}
        onApply={applyAutoTags}
        existingTags={autoTagSession?.existingTags || []}
        proposed={autoTagSession?.proposed || []}
        title={
          autoTagSession?.mode === "form"
            ? editingId
              ? "Auto-tag this template"
              : "Auto-tag the new template"
            : `Auto-tag"${autoTagSession?.target?.name || ""}"`
        }
        subtitle={
          autoTagSession?.mode === "form"
            ? "Selected tags will fill the Tags field — save the template to persist."
            : "Selected tags will be saved to this template immediately."
        }
        applying={autoTagApplying}
      />
    </>
  );
}
