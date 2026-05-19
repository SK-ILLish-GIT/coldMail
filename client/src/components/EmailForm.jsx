import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { api } from '../lib/api.js';
import { extractVariables } from '../lib/render.js';
import PreviewModal from './PreviewModal.jsx';
import CsvUploader from './CsvUploader.jsx';
import MailIDPanel from './MailIDPanel.jsx';
import LinkedInPanel from './LinkedInPanel.jsx';
import VariableChips from './VariableChips.jsx';
import { TagPills } from './Tags.jsx';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ATTACH_DEVICE = '__device__';

function isPdf(file) {
  if (!file) return false;
  if (file.type === 'application/pdf') return true;
  return /\.pdf$/i.test(file.name || '');
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DEFAULT_TEMPLATE = `<div style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;width:100%;line-height:1.65;font-size:15px;">
  <p style="margin:0 0 18px;">Hi {{name}},</p>

  <h3 style="margin:22px 0 8px;color:#2563eb;font-size:18px;font-weight:700;">About Me:</h3>
  <p style="margin:0 0 18px;">
    I&rsquo;m Sk Sahil Parvez, a B.Tech graduate in <strong>IT from IIIT Allahabad</strong> (2021&ndash;2025),
    currently pursuing an <strong>FDE certification from IIT Roorkee.</strong>
  </p>

  <h3 style="margin:22px 0 8px;color:#dc2626;font-size:18px;font-weight:700;">Why This Mail:</h3>
  <p style="margin:0 0 18px;">
    I currently work at Highspot, bringing my total experience to 1+ year.
    <strong>I&rsquo;d love to be considered for this open opportunity. I would like to discuss it on a call.</strong>
  </p>

  <h3 style="margin:22px 0 8px;color:#2563eb;font-size:18px;font-weight:700;">Experience:</h3>
  <ol style="margin:0 0 18px;padding-left:20px;">
    <li style="margin-bottom:6px;">
      <strong>SDE at Highspot</strong>&mdash;Working on Analytics using React, Golang, MongoDB, GraphQL, JavaScript, and Ruby.
    </li>
    <li style="margin-bottom:6px;">
      <strong>SDE Intern at Zscaler</strong>&mdash;Worked on Observability (OpenTelemetry, Prometheus, and Grafana), Docker and CI/CD.
    </li>
    <li style="margin-bottom:6px;">
      <strong>SDE Intern at Fractal Analytics</strong>&mdash;Worked with React &amp; SQL, built automated test scripts in Python, optimized LLM outputs.
    </li>
  </ol>

  <p style="margin:0 0 18px;">I invite you to explore my CV.</p>

  <p style="margin:22px 0 0;">
    Best Wishes,<br>
    Sk Sahil Parvez<br>
    <a href="https://www.linkedin.com/in/" style="color:#2563eb;text-decoration:underline;">LinkedIn</a> | Phone: (+91) 9874435806<br>
    Email: <a href="mailto:sksahilparvez2000@gmail.com" style="color:#2563eb;text-decoration:underline;">sksahilparvez2000@gmail.com</a>
  </p>
</div>`;

const DEFAULT_SUBJECT =
  'SK Sahil – IIIT Allahabad | Highspot | 1+ Year Exp | Interested in {{company}}';

const MODES = [
  { id: 'mailid', label: 'By MailID' },
  { id: 'bulk', label: 'By CSV' },
  { id: 'linkedin', label: 'By LinkedIn' },
];

// Sentinel value for the "(Default)" choice in the template picker.
// We can't use empty string because <select> will pick the placeholder.
const DEFAULT_TEMPLATE_ID = '__default__';

export default function EmailForm({ initialTemplate, onClearTemplate, aiEnabled = false }) {
  const [mode, setMode] = useState('mailid');
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);

  // Both modes (MailID + CSV) populate this single recipients array; the
  // submit path is the same bulk endpoint either way.
  const [recipients, setRecipients] = useState([]);

  // MailID mode: company is one value applied to every row.
  const [mailidCompany, setMailidCompany] = useState('');

  // LinkedIn mode: single recipient. Lifted up so the Full-preview modal
  // can show {{name}} / {{company}} merge fields before the user picks
  // an AI-suggested email.
  const [linkedinName, setLinkedinName] = useState('');
  const [linkedinCompany, setLinkedinCompany] = useState('');

  const [previewOpen, setPreviewOpen] = useState(false);

  const [sending, setSending] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [savingAs, setSavingAs] = useState(false);
  const [savedName, setSavedName] = useState('');

  // Single attachment per draft: either a saved-library resume (resumeId)
  // or a one-shot device upload (deviceFile). Mutually exclusive.
  const [attachment, setAttachment] = useState({ resumeId: '', deviceFile: null });
  const [resumes, setResumes] = useState([]);
  const [resumeTagFilter, setResumeTagFilter] = useState([]);
  const [templateTagFilter, setTemplateTagFilter] = useState([]);

  // Saved templates loaded from the API, plus which one is currently in use.
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_TEMPLATE_ID);

  const subjectRef = useRef(null);

  // Hydrate from a chosen saved template
  useEffect(() => {
    if (initialTemplate) {
      setSubject(initialTemplate.subject || '');
      setTemplate(initialTemplate.body || '');
      setSelectedTemplateId(initialTemplate.id || DEFAULT_TEMPLATE_ID);
      toast.success(`Loaded template "${initialTemplate.name}"`);
      onClearTemplate?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTemplate]);

  // Pull the user's saved templates once for the in-compose picker.
  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const data = await api.listTemplates();
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      // Non-fatal: the picker will just show "(Default)" only.
      console.warn('Failed to load templates:', err.message);
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  // Resume library for the attachment dropdown.
  const loadResumes = async () => {
    try {
      const data = await api.listResumes();
      setResumes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to load resumes:', err.message);
    }
  };

  useEffect(() => {
    loadResumes();
  }, []);

  // Turn the current attachment state into the (payload, files[]) pair that
  // api.sendEmail / api.sendBulk expect.
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
      : '';

  // Unique tags across resumes / templates — drive the filter pill rows.
  const allResumeTags = useMemo(
    () => Array.from(new Set(resumes.flatMap((r) => r.tags || []))).sort(),
    [resumes]
  );
  const allTemplateTags = useMemo(
    () => Array.from(new Set(templates.flatMap((t) => t.tags || []))).sort(),
    [templates]
  );

  // OR-semantics: an item passes the filter if ANY of its tags is selected.
  // Empty filter = show everything.
  const filteredResumes = useMemo(() => {
    if (!resumeTagFilter.length) return resumes;
    const wanted = new Set(resumeTagFilter);
    return resumes.filter((r) => (r.tags || []).some((t) => wanted.has(t)));
  }, [resumes, resumeTagFilter]);
  const filteredTemplates = useMemo(() => {
    if (!templateTagFilter.length) return templates;
    const wanted = new Set(templateTagFilter);
    return templates.filter((t) => (t.tags || []).some((x) => wanted.has(x)));
  }, [templates, templateTagFilter]);

  const toggleResumeTag = (t) =>
    setResumeTagFilter((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
    );
  const toggleTemplateTag = (t) =>
    setTemplateTagFilter((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
    );

  const onAttachmentSelect = (value) => {
    if (!value) {
      setAttachment({ resumeId: '', deviceFile: null });
      return;
    }
    if (value === ATTACH_DEVICE) {
      setAttachment({ resumeId: '', deviceFile: null });
      // The hidden file input is opened by the "Choose file" button below.
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
    setAttachment({ resumeId: '', deviceFile: file });
  };

  const onPickTemplate = (id) => {
    setSelectedTemplateId(id);
    if (id === DEFAULT_TEMPLATE_ID) {
      setSubject(DEFAULT_SUBJECT);
      setTemplate(DEFAULT_TEMPLATE);
      return;
    }
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setSubject(tpl.subject || '');
    setTemplate(tpl.body || '');
    toast.success(`Loaded "${tpl.name}"`);
  };

  // Clear the recipients table when the user switches mode so a stale list
  // from CSV doesn't bleed into MailID (or vice versa).
  useEffect(() => {
    setRecipients([]);
  }, [mode]);

  const detectedVars = useMemo(
    () => Array.from(new Set([...extractVariables(template), ...extractVariables(subject)])),
    [template, subject]
  );

  const previewVars = useMemo(() => {
    if (mode === 'linkedin') {
      return { name: linkedinName, company: linkedinCompany, email: '' };
    }
    if (recipients.length) return recipients[0];
    return { name: '', company: mailidCompany, email: '' };
  }, [mode, recipients, mailidCompany, linkedinName, linkedinCompany]);

  const previewTo =
    mode === 'linkedin' ? '' : recipients[0]?.email || '';

  // ----------------------- Saving drafts -----------------------

  const sendBulk = async () => {
    if (!recipients.length) {
      return toast.error(
        mode === 'mailid'
          ? 'Add emails and extract names first.'
          : 'Upload a CSV first.'
      );
    }
    if (!subject.trim()) return toast.error('Subject is required.');
    if (!template.trim()) return toast.error('Template is empty.');

    setSending(true);
    const promise = api.sendBulk(
      { recipients, subject, template, ...attachmentArgs.extraPayload },
      attachmentArgs.files
    );
    try {
      const res = await toast.promise(promise, {
        loading: `Saving ${recipients.length} draft${recipients.length === 1 ? '' : 's'}...`,
        success: (data) =>
          `Drafts saved: ${data.sent}${data.failed ? `, ${data.failed} failed` : ''}.`,
        error: (err) => err.message || 'Saving drafts failed',
      });
      if (res.failed) {
        console.warn('Failed drafts:', res.results.filter((r) => r.status === 'failed'));
      }
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (sending) return;
    sendBulk();
  };

  // ----------------------- Save as template -----------------------

  const saveAsTemplate = async () => {
    const name = savedName.trim();
    if (!name) return toast.error('Give the template a name.');
    if (!subject.trim() || !template.trim()) return toast.error('Subject and body are required.');
    setSavingAs(true);
    try {
      await api.createTemplate({ name, subject, body: template });
      toast.success(`Saved "${name}" to your library.`);
      setSavedName('');
      setSaveOpen(false);
    } catch (err) {
      toast.error(err.message || 'Failed to save template.');
    } finally {
      setSavingAs(false);
    }
  };

  // ----------------------- Modal helpers -----------------------

  const modalSubject = useMemo(() => {
    if (!subject) return '';
    try {
      return subject.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => previewVars?.[k] ?? '');
    } catch {
      return subject;
    }
  }, [subject, previewVars]);

  const modalHtml = useMemo(() => {
    if (!template) return '';
    try {
      return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => previewVars?.[k] ?? '');
    } catch {
      return template;
    }
  }, [template, previewVars]);

  // ----------------------- Render -----------------------

  return (
    <div className="space-y-6">
      {/* ---------- Form card (full width) ---------- */}
      <form onSubmit={handleSubmit} className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/60 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Compose</h2>
            <p className="text-xs text-ink-500">
              Write once, personalise per recipient with{' '}
              <span className="rounded bg-ink-100 px-1 py-0.5 font-mono text-2xs">{`{{vars}}`}</span>.
            </p>
          </div>
          <div className="tabs text-xs">
            {MODES.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => setMode(m.id)}
                className={['tab', mode === m.id && 'tab-active'].filter(Boolean).join(' ')}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* Recipients — driven by the active mode */}
          {mode === 'mailid' && (
            <MailIDPanel
              company={mailidCompany}
              setCompany={setMailidCompany}
              recipients={recipients}
              setRecipients={setRecipients}
              aiEnabled={aiEnabled}
            />
          )}
          {mode === 'bulk' && (
            <CsvUploader recipients={recipients} onChange={setRecipients} />
          )}
          {mode === 'linkedin' && (
            <LinkedInPanel
              name={linkedinName}
              setName={setLinkedinName}
              company={linkedinCompany}
              setCompany={setLinkedinCompany}
              subject={subject}
              template={template}
              attachmentArgs={attachmentArgs}
              aiEnabled={aiEnabled}
            />
          )}

          <div className="divider" />

          {/* Template picker — body editing lives in the Templates tab */}
          <div>
            <div className="mb-1.5 flex items-end justify-between gap-3">
              <label className="label !mb-0" htmlFor="template-picker">Template</label>
              <span className="hint">
                {templatesLoading
                  ? 'Loading templates...'
                  : templates.length
                    ? `${filteredTemplates.length}/${templates.length} shown${templateTagFilter.length ? ' · filtered' : ''}`
                    : 'No saved templates yet · using the built-in default'}
              </span>
            </div>
            {allTemplateTags.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <TagPills
                  tags={allTemplateTags}
                  activeTags={templateTagFilter}
                  onToggle={toggleTemplateTag}
                />
                {templateTagFilter.length > 0 && (
                  <button
                    type="button"
                    className="text-2xs text-ink-500 underline hover:text-ink-700"
                    onClick={() => setTemplateTagFilter([])}
                  >
                    Clear filter
                  </button>
                )}
              </div>
            )}
            <select
              id="template-picker"
              className="input"
              value={selectedTemplateId}
              onChange={(e) => onPickTemplate(e.target.value)}
            >
              <option value={DEFAULT_TEMPLATE_ID}>(Default)</option>
              {filteredTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tags?.length ? `${t.name}  ·  ${t.tags.join(', ')}` : t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Subject */}
          <div>
            <div className="mb-1.5 flex items-end justify-between gap-3">
              <label className="label !mb-0" htmlFor="subject">Subject</label>
              <VariableChips inputRef={subjectRef} extra={detectedVars} />
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

          {/* Attachment — pick a saved resume or upload one PDF from device.
              Always renamed server-side to the configured public filename. */}
          <div>
            <div className="mb-1.5 flex items-end justify-between gap-3">
              <label className="label !mb-0" htmlFor="attachment-picker">
                Attachment <span className="font-normal text-ink-500">(optional, max 1 PDF)</span>
              </label>
              <span className="hint">
                Saved in Gmail draft as <span className="font-mono">Sk_Sahil_Parvez_CV.pdf</span>
              </span>
            </div>
            {allResumeTags.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <TagPills
                  tags={allResumeTags}
                  activeTags={resumeTagFilter}
                  onToggle={toggleResumeTag}
                />
                {resumeTagFilter.length > 0 && (
                  <button
                    type="button"
                    className="text-2xs text-ink-500 underline hover:text-ink-700"
                    onClick={() => setResumeTagFilter([])}
                  >
                    Clear filter
                  </button>
                )}
              </div>
            )}
            <select
              id="attachment-picker"
              className="input"
              value={attachmentSelectValue}
              onChange={(e) => onAttachmentSelect(e.target.value)}
            >
              <option value="">(None)</option>
              <option value={ATTACH_DEVICE}>Upload from device...</option>
              {filteredResumes.length > 0 && (
                <optgroup label="Saved resumes">
                  {filteredResumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.tags?.length ? `${r.name}  ·  ${r.tags.join(', ')}` : r.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            {attachmentSelectValue === ATTACH_DEVICE && (
              <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-ink-200 bg-ink-50/40 px-3 py-2">
                <input
                  id="attachment-device-file"
                  type="file"
                  accept="application/pdf,.pdf"
                  className="input !p-1.5 !h-auto flex-1"
                  onChange={(e) => onDeviceFilePicked(e.target.files?.[0] || null)}
                />
                {attachment.deviceFile && (
                  <span className="text-2xs text-ink-500">
                    {attachment.deviceFile.name} · {fmtSize(attachment.deviceFile.size)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Save-as panel (collapsible) */}
        {saveOpen && (
          <div className="anim-in border-t border-ink-200/60 bg-ink-50/50 px-6 py-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="grow">
                <label className="label" htmlFor="save-name">Template name</label>
                <input
                  id="save-name"
                  type="text"
                  className="input"
                  placeholder="e.g. Cold outreach v1"
                  value={savedName}
                  onChange={(e) => setSavedName(e.target.value)}
                  autoFocus
                />
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={saveAsTemplate}
                disabled={savingAs}
              >
                {savingAs ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setSaveOpen(false);
                  setSavedName('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200/60 bg-ink-50/40 px-6 py-3.5">
          <button
            type="button"
            className="btn-ghost btn-xs"
            onClick={() => setSaveOpen((v) => !v)}
            title="Save the current subject + body as a reusable template"
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
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            {saveOpen ? 'Hide save panel' : 'Save as template'}
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPreviewOpen(true)}>
              Full preview
            </button>
            {mode !== 'linkedin' && (
            <button
              type="submit"
              className="btn-gradient"
              disabled={sending || recipients.length === 0}
              title={recipients.length === 0 ? 'Add recipients first' : ''}
            >
              {sending ? (
                <>
                  <svg
                    className="h-4 w-4 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Saving...
                </>
              ) : (
                <>
                  Save {recipients.length || 0} draft{recipients.length === 1 ? '' : 's'} to Gmail
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
            )}
            {mode === 'linkedin' && (
              <span className="hint">
                Use the Draft button on a candidate above to save 1 draft.
              </span>
            )}
          </div>
        </div>
      </form>

      <PreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        subject={modalSubject}
        html={modalHtml}
        to={previewTo}
      />
    </div>
  );
}
