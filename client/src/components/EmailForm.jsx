import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { api } from "../lib/api.js";
import { tabClick, tabMouseDown } from "../lib/tabButton.js";
import { extractVariables, renderTemplate } from "../lib/render.js";
import PreviewModal from "./PreviewModal.jsx";
import LivePreview from "./LivePreview.jsx";
import CsvUploader from "./CsvUploader.jsx";
import MailIDPanel from "./MailIDPanel.jsx";
import LinkedInPanel from "./LinkedInPanel.jsx";
import VariableChips from "./VariableChips.jsx";
import JDMatcher from "./JDMatcher.jsx";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ATTACH_DEVICE = "__device__";

function isPdf(file) {
  if (!file) return false;
  if (file.type === "application/pdf") return true;
  return /\.pdf$/i.test(file.name || "");
}

function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Compose starts blank. The user's chosen default template (if any) is applied
// on load, and any saved template can be marked default from the Templates tab.
const BLANK_SUBJECT = "";
const BLANK_TEMPLATE = "";

// Each mode carries a tone so the active tab gets a clear color cue:
// email-ish = rose (red), csv = emerald (green), linkedin = sky (blue).
const MODES = [
  { id: "mailid", label: "By MailID", tone: "rose" },
  { id: "bulk", label: "By CSV", tone: "emerald" },
  { id: "linkedin", label: "By LinkedIn", tone: "sky" },
];

// Neutral panel + left accent per channel (readable in light and dark).
const MODE_PANEL_CLASS = {
  mailid: "panel-mode panel-mode-rose",
  bulk: "panel-mode panel-mode-emerald",
  linkedin: "panel-mode panel-mode-sky",
};

// Sentinel for the "no template / blank" picker option.
const BLANK_TEMPLATE_ID = "";

// Per-recipient send statuses (keyed by email). 'sending' shows a spinner,
// 'drafted' / 'failed' show a coloured dot. Cleared when the user kicks off
// a new send.
function mergeStatus(prev, email, patch) {
  return {
    ...prev,
    [email.toLowerCase()]: { ...(prev[email.toLowerCase()] || {}), ...patch },
  };
}

export default function EmailForm({
  initialTemplate,
  onClearTemplate,
  initialResume,
  onClearResume,
  aiEnabled = false,
}) {
  const [mode, setMode] = useState("mailid");
  const [subject, setSubject] = useState(BLANK_SUBJECT);
  const [template, setTemplate] = useState(BLANK_TEMPLATE);

  // Per-mode recipients — switching modes no longer destroys what you typed
  // into the other mode's pane.
  const [mailidRecipients, setMailidRecipients] = useState([]);
  const [csvRecipients, setCsvRecipients] = useState([]);

  // MailID mode: company is one value applied to every row.
  const [mailidCompany, setMailidCompany] = useState("");

  // LinkedIn mode: single recipient. Lifted up so the Full-preview modal
  // can show {{name}} / {{company}} merge fields before the user picks
  // an AI-suggested email.
  const [linkedinName, setLinkedinName] = useState("");
  const [linkedinCompany, setLinkedinCompany] = useState("");

  const [previewOpen, setPreviewOpen] = useState(false);

  const [sending, setSending] = useState(false);
  // Per-row status map for the current send. Keyed by lowercased email.
  const [sendStatuses, setSendStatuses] = useState({});

  // Inline body editor (collapsed by default so the existing flow is unchanged).
  const [bodyEditOpen, setBodyEditOpen] = useState(false);

  // Optional job link, surfaced to templates via the {{jobLink}} merge token.
  const [jobLink, setJobLink] = useState("");

  // The Template → Attachment block is collapsible as a single unit so the
  // composer can be condensed. Expanded by default to preserve the flow.
  const [contentOpen, setContentOpen] = useState(true);

  // Single attachment per draft: either a saved-library resume (resumeId)
  // or a one-shot device upload (deviceFile). Mutually exclusive.
  const [attachment, setAttachment] = useState({
    resumeId: "",
    deviceFile: null,
  });
  const [resumes, setResumes] = useState([]);
  // Type-to-filter inputs above each picker.
  const [templateSearch, setTemplateSearch] = useState("");
  const [resumeSearch, setResumeSearch] = useState("");

  // Saved templates loaded from the API, plus which one is currently in use.
  const [templates, setTemplates] = useState([]);
  const [, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] =
    useState(BLANK_TEMPLATE_ID);

  // Auto-apply the user's default template/resume only once, and only if they
  // haven't arrived via a "Use" action from the library.
  const defaultTemplateAppliedRef = useRef(false);
  const defaultResumeAppliedRef = useRef(false);

  const subjectRef = useRef(null);
  const bodyRef = useRef(null);
  const deviceFileRef = useRef(null);

  // Hydrate from a chosen saved template
  useEffect(() => {
    if (initialTemplate) {
      // Arrived via "Use" — takes precedence over any auto-applied default.
      defaultTemplateAppliedRef.current = true;
      setSubject(initialTemplate.subject || "");
      setTemplate(initialTemplate.body || "");
      setSelectedTemplateId(initialTemplate.id || BLANK_TEMPLATE_ID);
      toast.success(`Loaded template"${initialTemplate.name}"`);
      onClearTemplate?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTemplate]);

  // Hydrate attachment from a chosen saved resume (Resumes tab → Use).
  useEffect(() => {
    if (!initialResume?.id) return;
    defaultResumeAppliedRef.current = true;
    setAttachment({ resumeId: initialResume.id, deviceFile: null });
    toast.success(`Attached"${initialResume.name || "resume"}"`);
    onClearResume?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialResume]);

  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const data = await api.listTemplates();
      const list = Array.isArray(data) ? data : [];
      setTemplates(list);
      // Apply the user's default template on first load (unless a template was
      // already loaded via "Use").
      if (!defaultTemplateAppliedRef.current && !initialTemplate) {
        const def = list.find((t) => t.isDefault);
        if (def) {
          setSelectedTemplateId(def.id);
          setSubject(def.subject || "");
          setTemplate(def.body || "");
        }
      }
      defaultTemplateAppliedRef.current = true;
    } catch (err) {
      console.warn("Failed to load templates:", err.message);
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadResumes = async () => {
    try {
      const data = await api.listResumes();
      const list = Array.isArray(data) ? data : [];
      setResumes(list);
      // Pre-select the user's default resume on first load (unless one was
      // already attached via "Use" or a device upload).
      if (!defaultResumeAppliedRef.current && !initialResume) {
        const def = list.find((r) => r.isDefault);
        if (def) {
          setAttachment((prev) =>
            prev.resumeId || prev.deviceFile
              ? prev
              : { resumeId: def.id, deviceFile: null },
          );
        }
      }
      defaultResumeAppliedRef.current = true;
    } catch (err) {
      console.warn("Failed to load resumes:", err.message);
    }
  };

  useEffect(() => {
    loadResumes();
  }, []);

  // Active recipients depend on the current mode. LinkedIn submits via its
  // own per-candidate button so its recipients[] is empty here. Memoised so
  // useMemo deps that read it don't fire on every render.
  const EMPTY_RECIPIENTS = useMemo(() => [], []);
  const recipients = useMemo(() => {
    if (mode === "mailid") return mailidRecipients;
    if (mode === "bulk") return csvRecipients;
    return EMPTY_RECIPIENTS;
  }, [mode, mailidRecipients, csvRecipients, EMPTY_RECIPIENTS]);

  const attachmentArgs = useMemo(() => {
    if (attachment.resumeId) {
      return { extraPayload: { resumeId: attachment.resumeId }, files: [] };
    }
    if (attachment.deviceFile) {
      return { extraPayload: {}, files: [attachment.deviceFile] };
    }
    return { extraPayload: {}, files: [] };
  }, [attachment]);

  const attachmentSelectValue = attachment.resumeId
    ? attachment.resumeId
    : attachment.deviceFile
      ? ATTACH_DEVICE
      : "";

  const filteredResumes = useMemo(() => {
    if (!resumeSearch.trim()) return resumes;
    const q = resumeSearch.trim().toLowerCase();
    return resumes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.tags || []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [resumes, resumeSearch]);

  const filteredTemplates = useMemo(() => {
    if (!templateSearch.trim()) return templates;
    const q = templateSearch.trim().toLowerCase();
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.tags || []).some((x) => x.toLowerCase().includes(q)),
    );
  }, [templates, templateSearch]);

  const applyJDMatch = ({ templateId, resumeId }) => {
    if (templateId) {
      setTemplateSearch("");
      onPickTemplate(templateId);
    }
    if (resumeId) {
      setResumeSearch("");
      setAttachment({ resumeId, deviceFile: null });
    }
  };

  const onAttachmentSelect = (value) => {
    if (!value) {
      setAttachment({ resumeId: "", deviceFile: null });
      return;
    }
    if (value === ATTACH_DEVICE) {
      setAttachment({ resumeId: "", deviceFile: null });
      // Open the device picker immediately — one click instead of two.
      requestAnimationFrame(() => deviceFileRef.current?.click());
      return;
    }
    setAttachment({ resumeId: value, deviceFile: null });
  };

  const onDeviceFilePicked = (file) => {
    if (!file) return;
    if (!isPdf(file)) {
      toast.error(`"${file.name}" isn't a PDF.`);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error(`"${file.name}" is over 10 MB.`);
      return;
    }
    setAttachment({ resumeId: "", deviceFile: file });
  };

  const onPickTemplate = (id) => {
    setSelectedTemplateId(id);
    if (id === BLANK_TEMPLATE_ID) {
      setSubject(BLANK_SUBJECT);
      setTemplate(BLANK_TEMPLATE);
      return;
    }
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setSubject(tpl.subject || "");
    setTemplate(tpl.body || "");
    toast.success(`Loaded"${tpl.name}"`);
  };

  const detectedVars = useMemo(
    () =>
      Array.from(
        new Set([...extractVariables(template), ...extractVariables(subject)]),
      ),
    [template, subject],
  );

  // P2-12: validate that the recipients carry every token the template uses.
  // Empty `recipients[]` doesn't produce a warning — only kicks in when the
  // user has actual rows to send to.
  const missingVars = useMemo(() => {
    if (!recipients.length) return [];
    const all = ["name", "company", "email"];
    const provided = new Set([...all, ...Object.keys(recipients[0] || {})]);
    // A token is"missing" if it's required by the template/subject but
    // absent from the column set AND at least one row also leaves it blank.
    return detectedVars.filter((v) => {
      if (provided.has(v)) {
        return recipients.some((r) => !String(r[v] || "").trim());
      }
      return true;
    });
  }, [detectedVars, recipients]);

  const previewVars = useMemo(() => {
    const sample = recipients[0] || {};
    if (mode === "linkedin") {
      return {
        name: linkedinName,
        company: linkedinCompany,
        email: "",
        jobLink,
        ...sample,
      };
    }
    return {
      name: sample.name || "",
      company: sample.company || mailidCompany,
      email: sample.email || "",
      jobLink,
      ...sample,
    };
  }, [mode, recipients, mailidCompany, linkedinName, linkedinCompany, jobLink]);

  // Quick-insert chips: always offer {{jobLink}} so users can place it where
  // they want, in addition to any tokens already present in the template.
  const chipVars = useMemo(
    () => Array.from(new Set([...detectedVars, "jobLink"])),
    [detectedVars],
  );

  const previewTo = mode === "linkedin" ? "" : recipients[0]?.email || "";

  // ----------------------- Saving drafts -----------------------

  // Client-side sequential loop so the recipients table can show per-row
  // progress in real time. Each iteration hits /send-email; we pause between
  // calls to match the server's BULK_SEND_DELAY guidance.
  const sendBulkSequential = async () => {
    if (!recipients.length) {
      return toast.error(
        mode === "mailid"
          ? "Add emails and extract names first."
          : "Upload a CSV first.",
      );
    }
    if (!subject.trim()) return toast.error("Subject is required.");
    if (!template.trim()) return toast.error("Template is empty.");

    setSending(true);
    // Reset statuses for this batch: every row starts as"pending".
    setSendStatuses(() => {
      const m = {};
      for (const r of recipients)
        m[r.email.toLowerCase()] = { status: "pending" };
      return m;
    });

    const toastId = toast.loading(`Saving 0/${recipients.length} drafts...`);
    let drafted = 0;
    let failed = 0;
    try {
      for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        setSendStatuses((prev) =>
          mergeStatus(prev, r.email, { status: "sending" }),
        );
        try {
          await api.sendEmail(
            {
              email: r.email,
              name: r.name || "",
              company: r.company || mailidCompany,
              // Forward any extra CSV columns plus the shared job link so
              // {{column}} and {{jobLink}} tokens render.
              extra: { ...r, jobLink },
              subject,
              template,
              ...attachmentArgs.extraPayload,
            },
            attachmentArgs.files,
          );
          setSendStatuses((prev) =>
            mergeStatus(prev, r.email, { status: "drafted" }),
          );
          drafted++;
        } catch (err) {
          setSendStatuses((prev) =>
            mergeStatus(prev, r.email, {
              status: "failed",
              error: err.message,
            }),
          );
          failed++;
        }
        toast.loading(`Saving ${i + 1}/${recipients.length} drafts...`, {
          id: toastId,
        });
        if (i < recipients.length - 1) await sleep(250);
      }
      if (failed === 0) {
        toast.success(
          `Saved ${drafted} draft${drafted === 1 ? "" : "s"} to Gmail.`,
          { id: toastId },
        );
      } else {
        toast.error(
          `${drafted} saved, ${failed} failed — see row indicators.`,
          { id: toastId },
        );
      }
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (sending) return;
    sendBulkSequential();
  };

  // ----------------------- Render -----------------------

  const renderedSubject = useMemo(
    () => (subject ? renderTemplate(subject, previewVars) : ""),
    [subject, previewVars],
  );
  const renderedHtml = useMemo(
    () => (template ? renderTemplate(template, previewVars) : ""),
    [template, previewVars],
  );

  const previewAttachment = useMemo(() => {
    if (attachment.resumeId) {
      const r = resumes.find((x) => x.id === attachment.resumeId);
      if (!r) {
        return {
          kind: "resume",
          name: "Saved resume",
          id: attachment.resumeId,
        };
      }
      return {
        kind: "resume",
        name: r.name,
        filename: r.filename,
        size: r.size,
        mimeType: r.contentType,
        tags: r.tags,
        tailoredFor: r.tailoredFor,
      };
    }
    if (attachment.deviceFile) {
      return {
        kind: "device",
        name: attachment.deviceFile.name,
        filename: attachment.deviceFile.name,
        size: attachment.deviceFile.size,
        mimeType: attachment.deviceFile.type || "application/pdf",
      };
    }
    return null;
  }, [attachment, resumes]);

  // Footer CTA shape depends on mode. LinkedIn keeps the button visible so
  // the layout doesn't change between modes — it's just disabled with a
  // tooltip directing the user to the per-candidate Draft button above.
  const submitDisabled = sending || recipients.length === 0;
  const submitLabel = sending
    ? "Saving..."
    : mode === "linkedin"
      ? "Use a candidate above"
      : `Save ${recipients.length || 0} draft${recipients.length === 1 ? "" : "s"} to Gmail`;
  const submitTitle =
    mode === "linkedin"
      ? "For LinkedIn mode, click Draft on the AI candidate row you trust."
      : recipients.length === 0
        ? "Add recipients first"
        : "";

  return (
    <>
      <section className="card flex min-h-[min(85vh,900px)] flex-col overflow-hidden lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)]">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-ui-border/70 px-6 py-4">
          <h2 className="text-base font-semibold text-ui-fg">Compose</h2>
          <div className="tabs tabs-3 text-xs">
            {MODES.map((m) => (
              <button
                type="button"
                key={m.id}
                onMouseDown={tabMouseDown}
                onClick={tabClick(() => setMode(m.id))}
                aria-selected={mode === m.id}
                className={["tab", mode === m.id && `tab-active-${m.tone}`]
                  .filter(Boolean)
                  .join(" ")}
              >
                {m.label}
              </button>
            ))}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(380px,46%)]">
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              {/* JD-based auto-picker — explicit"Step 0" at the top so the
 relationship between JD and the pickers below is obvious. */}
              <JDMatcher
                templates={templates}
                resumes={resumes}
                aiEnabled={aiEnabled}
                onMatch={applyJDMatch}
                activeTemplateId={selectedTemplateId}
              />

              {/* Recipients — driven by the active mode. */}
              <div className={MODE_PANEL_CLASS[mode]}>
                {mode === "mailid" && (
                  <MailIDPanel
                    company={mailidCompany}
                    setCompany={setMailidCompany}
                    recipients={mailidRecipients}
                    setRecipients={setMailidRecipients}
                    aiEnabled={aiEnabled}
                    sendStatuses={sendStatuses}
                  />
                )}
                {mode === "bulk" && (
                  <CsvUploader
                    recipients={csvRecipients}
                    onChange={setCsvRecipients}
                    sendStatuses={sendStatuses}
                  />
                )}
                {mode === "linkedin" && (
                  <LinkedInPanel
                    name={linkedinName}
                    setName={setLinkedinName}
                    company={linkedinCompany}
                    setCompany={setLinkedinCompany}
                    subject={subject}
                    template={template}
                    jobLink={jobLink}
                    attachmentArgs={attachmentArgs}
                    aiEnabled={aiEnabled}
                  />
                )}
              </div>

              {/* Variable validation warning */}
              {missingVars.length > 0 && (
                <div className="callout-warning">
                  <span className="font-semibold">Heads up: </span>
                  the template uses{""}
                  {missingVars.map((v, i) => (
                    <span key={v}>
                      <code className="font-mono">{`{{${v}}}`}</code>
                      {i < missingVars.length - 1 ? "," : ""}
                    </span>
                  ))}
                  {""}
                  but{""}
                  {recipients.length > 1
                    ? "some recipients lack"
                    : "this row lacks"}
                  {""}
                  that value — those tokens will render empty.
                </div>
              )}

              <div className="divider" />

              {/* Email content (collapsible card) — Template → Attachment as a
 single condensable unit, mirroring the JD"Step 0" pattern. */}
              <section className="rounded-lg border border-ui-border/80">
                <button
                  type="button"
                  onClick={() => setContentOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  aria-expanded={contentOpen}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ui-inset text-ui-fg-muted">
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
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ui-fg">
                        Email content
                      </p>
                      <p className="text-2xs text-ui-fg-muted">
                        Template, subject, job link, body &amp; attachment.
                      </p>
                    </div>
                  </div>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-4 w-4 text-ui-fg-muted transition-transform ${contentOpen ? "rotate-180" : ""}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {contentOpen && (
                  <div className="anim-in space-y-6 border-t border-ui-border/70 px-4 py-4">
                    {/* Template picker — body editing lives in the Templates tab or in
 the inline body editor below. */}
                    <div>
                      <div className="mb-1.5 flex items-end justify-between gap-3">
                        <label
                          className="label !mb-0"
                          htmlFor="template-picker"
                        >
                          Template
                        </label>
                        {templates.length > 0 && templateSearch.trim() && (
                          <span className="hint">
                            {filteredTemplates.length}/{templates.length} shown
                          </span>
                        )}
                      </div>
                      {templates.length > 4 && (
                        <input
                          type="search"
                          className="input !h-8 !py-1 mb-1.5 text-xs"
                          placeholder="Filter templates by name or tag..."
                          value={templateSearch}
                          onChange={(e) => setTemplateSearch(e.target.value)}
                          aria-label="Filter templates"
                        />
                      )}
                      <select
                        id="template-picker"
                        className="input"
                        value={selectedTemplateId}
                        onChange={(e) => onPickTemplate(e.target.value)}
                      >
                        <option value={BLANK_TEMPLATE_ID}>(None / blank)</option>
                        {filteredTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.isDefault ? "★ " : ""}
                            {t.tags?.length
                              ? `${t.name} · ${t.tags.join(",")}`
                              : t.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Subject */}
                    <div>
                      <div className="mb-1.5 flex items-end justify-between gap-3">
                        <label className="label !mb-0" htmlFor="subject">
                          Subject
                        </label>
                        <VariableChips inputRef={subjectRef} extra={chipVars} />
                      </div>
                      <input
                        ref={subjectRef}
                        id="subject"
                        type="text"
                        className="input"
                        placeholder="Quick question for {{company}}"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                      />
                    </div>

                    {/* Job link — feeds the {{jobLink}} merge token. */}
                    <div>
                      <label className="label" htmlFor="job-link">
                        Job link
                      </label>
                      <input
                        id="job-link"
                        type="url"
                        className="input"
                        placeholder="https://company.com/careers/role-123"
                        value={jobLink}
                        onChange={(e) => setJobLink(e.target.value)}
                      />
                    </div>

                    {/* Inline body editor (collapsible) */}
                    <div>
                      <div className="mb-1.5 flex items-end justify-between gap-3">
                        <label className="label !mb-0">Body (HTML)</label>
                        <div className="flex items-center gap-3">
                          {bodyEditOpen && (
                            <VariableChips
                              inputRef={bodyRef}
                              extra={chipVars}
                            />
                          )}
                          <button
                            type="button"
                            className="btn-ghost btn-xs"
                            onClick={() => setBodyEditOpen((v) => !v)}
                            title={
                              bodyEditOpen
                                ? "Hide body editor"
                                : "Edit body inline"
                            }
                          >
                            {bodyEditOpen ? "Hide editor" : "Edit body"}
                          </button>
                        </div>
                      </div>
                      {bodyEditOpen ? (
                        <textarea
                          ref={bodyRef}
                          className="input-mono min-h-[200px] resize-y"
                          value={template}
                          onChange={(e) => setTemplate(e.target.value)}
                          placeholder="<h2>Hello {{name}}</h2>"
                        />
                      ) : (
                        <p className="text-xs text-ui-fg-muted">
                          {template.trim().length
                            ? `${template.length} chars · using ${selectedTemplateId === BLANK_TEMPLATE_ID ? "custom" : templates.find((t) => t.id === selectedTemplateId)?.name || "custom"}.`
                            : "No body set yet."}
                          {""}
                          Click <strong>Edit body</strong> to tweak inline, or
                          use the Templates tab for a full editor.
                        </p>
                      )}
                    </div>

                    {/* Attachment */}
                    <div>
                      <div className="mb-1.5 flex items-end justify-between gap-3">
                        <label
                          className="label !mb-0"
                          htmlFor="attachment-picker"
                        >
                          Attachment
                        </label>
                      </div>
                      {resumes.length > 4 && (
                        <input
                          type="search"
                          className="input !h-8 !py-1 mb-1.5 text-xs"
                          placeholder="Filter resumes by name or tag..."
                          value={resumeSearch}
                          onChange={(e) => setResumeSearch(e.target.value)}
                          aria-label="Filter resumes"
                        />
                      )}
                      <div className="flex gap-2">
                        <select
                          id="attachment-picker"
                          className="input flex-1"
                          value={attachmentSelectValue}
                          onChange={(e) => onAttachmentSelect(e.target.value)}
                        >
                          <option value="">(None)</option>
                          <option value={ATTACH_DEVICE}>
                            Upload from device...
                          </option>
                          {filteredResumes.length > 0 && (
                            <optgroup label="Saved resumes">
                              {filteredResumes.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.isDefault ? "★ " : ""}
                                  {r.tags?.length
                                    ? `${r.name} · ${r.tags.join(",")}`
                                    : r.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        {/* One-click"Browse" — bypasses the dropdown indirection. */}
                        <button
                          type="button"
                          className="btn-secondary btn-xs whitespace-nowrap"
                          onClick={() => deviceFileRef.current?.click()}
                          title="Pick a PDF from this device"
                        >
                          Browse...
                        </button>
                      </div>
                      {/* Hidden file input — opened by either the dropdown choice or
 the Browse button above. */}
                      <input
                        ref={deviceFileRef}
                        id="attachment-device-file"
                        type="file"
                        accept="application/pdf,.pdf"
                        className="hidden"
                        onChange={(e) =>
                          onDeviceFilePicked(e.target.files?.[0] || null)
                        }
                      />
                      {attachment.deviceFile && (
                        <p className="mt-1 text-2xs text-ui-fg-muted">
                          Device file:{""}
                          <span className="font-mono">
                            {attachment.deviceFile.name}
                          </span>
                          {""}· {fmtSize(attachment.deviceFile.size)}
                          <button
                            type="button"
                            className="ml-2 underline hover:text-ui-fg"
                            onClick={() =>
                              setAttachment({ resumeId: "", deviceFile: null })
                            }
                          >
                            remove
                          </button>
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* Footer actions */}
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-ui-border/70 bg-ui-inset/50 px-6 py-3.5">
              <button
                type="submit"
                className="btn-gradient"
                disabled={submitDisabled}
                title={submitTitle}
              >
                {sending ? (
                  <>
                    <svg
                      className="h-4 w-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeOpacity="0.25"
                        strokeWidth="3"
                      />
                      <path
                        d="M22 12a10 10 0 0 1-10 10"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </svg>
                    {submitLabel}
                  </>
                ) : (
                  <>
                    {submitLabel}
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
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="flex min-h-[min(50vh,480px)] flex-col border-t border-ui-border/70 lg:min-h-0 lg:border-l lg:border-t-0">
            <LivePreview
              subject={renderedSubject}
              template={template}
              vars={previewVars}
              to={previewTo}
              attachment={previewAttachment}
              onOpenFull={() => setPreviewOpen(true)}
            />
          </div>
        </div>
      </section>

      <PreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        subject={renderedSubject}
        html={renderedHtml}
        to={previewTo}
      />
    </>
  );
}
