import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { api } from '../lib/api.js';
import { extractVariables, renderTemplate } from '../lib/render.js';
import PreviewModal from './PreviewModal.jsx';
import LivePreview from './LivePreview.jsx';
import CsvUploader from './CsvUploader.jsx';
import MailIDPanel from './MailIDPanel.jsx';
import LinkedInPanel from './LinkedInPanel.jsx';
import VariableChips from './VariableChips.jsx';
import { TagPills } from './Tags.jsx';
import JDMatcher from './JDMatcher.jsx';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ATTACH_DEVICE = '__device__';
const TEST_EMAIL_KEY = 'coldmail.testEmail';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Each mode carries a tone so the active tab gets a clear color cue:
// email-ish = rose (red), csv = emerald (green), linkedin = sky (blue).
const MODES = [
  { id: 'mailid', label: 'By MailID', tone: 'rose' },
  { id: 'bulk', label: 'By CSV', tone: 'emerald' },
  { id: 'linkedin', label: 'By LinkedIn', tone: 'sky' },
];

// Subtle wash + ring applied to the recipient block per active mode so
// the channel context is obvious at a glance, not just in the tab pill.
const MODE_PANEL_CLASS = {
  mailid:
    'rounded-xl bg-rose-50/60 ring-1 ring-rose-200/60 dark:bg-rose-900/10 dark:ring-rose-800/40 p-4',
  bulk:
    'rounded-xl bg-emerald-50/60 ring-1 ring-emerald-200/60 dark:bg-emerald-900/10 dark:ring-emerald-800/40 p-4',
  linkedin:
    'rounded-xl bg-sky-50/60 ring-1 ring-sky-200/60 dark:bg-sky-900/10 dark:ring-sky-800/40 p-4',
};

const DEFAULT_TEMPLATE_ID = '__default__';

// Per-recipient send statuses (keyed by email). 'sending' shows a spinner,
// 'drafted' / 'failed' show a coloured dot. Cleared when the user kicks off
// a new send.
function mergeStatus(prev, email, patch) {
  return { ...prev, [email.toLowerCase()]: { ...(prev[email.toLowerCase()] || {}), ...patch } };
}

export default function EmailForm({ initialTemplate, onClearTemplate, aiEnabled = false }) {
  const [mode, setMode] = useState('mailid');
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);

  // Per-mode recipients — switching modes no longer destroys what you typed
  // into the other mode's pane.
  const [mailidRecipients, setMailidRecipients] = useState([]);
  const [csvRecipients, setCsvRecipients] = useState([]);

  // MailID mode: company is one value applied to every row.
  const [mailidCompany, setMailidCompany] = useState('');

  // LinkedIn mode: single recipient. Lifted up so the Full-preview modal
  // can show {{name}} / {{company}} merge fields before the user picks
  // an AI-suggested email.
  const [linkedinName, setLinkedinName] = useState('');
  const [linkedinCompany, setLinkedinCompany] = useState('');

  const [previewOpen, setPreviewOpen] = useState(false);

  const [sending, setSending] = useState(false);
  // Per-row status map for the current send. Keyed by lowercased email.
  const [sendStatuses, setSendStatuses] = useState({});

  const [saveOpen, setSaveOpen] = useState(false);
  const [savingAs, setSavingAs] = useState(false);
  const [savedName, setSavedName] = useState('');

  // Inline body editor (collapsed by default so the existing flow is unchanged).
  const [bodyEditOpen, setBodyEditOpen] = useState(false);

  // Test-to-me panel state.
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState(() => {
    try {
      return localStorage.getItem(TEST_EMAIL_KEY) || '';
    } catch {
      return '';
    }
  });
  const [testSending, setTestSending] = useState(false);

  // Single attachment per draft: either a saved-library resume (resumeId)
  // or a one-shot device upload (deviceFile). Mutually exclusive.
  const [attachment, setAttachment] = useState({ resumeId: '', deviceFile: null });
  const [resumes, setResumes] = useState([]);
  const [resumeTagFilter, setResumeTagFilter] = useState([]);
  const [templateTagFilter, setTemplateTagFilter] = useState([]);
  // Type-to-filter inputs above each picker.
  const [templateSearch, setTemplateSearch] = useState('');
  const [resumeSearch, setResumeSearch] = useState('');

  // Saved templates loaded from the API, plus which one is currently in use.
  const [templates, setTemplates] = useState([]);
  const [, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_TEMPLATE_ID);

  const subjectRef = useRef(null);
  const bodyRef = useRef(null);
  const deviceFileRef = useRef(null);

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

  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const data = await api.listTemplates();
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to load templates:', err.message);
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
      setResumes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to load resumes:', err.message);
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
    if (mode === 'mailid') return mailidRecipients;
    if (mode === 'bulk') return csvRecipients;
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
      : '';

  const allResumeTags = useMemo(
    () => Array.from(new Set(resumes.flatMap((r) => r.tags || []))).sort(),
    [resumes]
  );
  const allTemplateTags = useMemo(
    () => Array.from(new Set(templates.flatMap((t) => t.tags || []))).sort(),
    [templates]
  );

  const filteredResumes = useMemo(() => {
    let list = resumes;
    if (resumeTagFilter.length) {
      const wanted = new Set(resumeTagFilter);
      list = list.filter((r) => (r.tags || []).some((t) => wanted.has(t)));
    }
    if (resumeSearch.trim()) {
      const q = resumeSearch.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [resumes, resumeTagFilter, resumeSearch]);

  const filteredTemplates = useMemo(() => {
    let list = templates;
    if (templateTagFilter.length) {
      const wanted = new Set(templateTagFilter);
      list = list.filter((t) => (t.tags || []).some((x) => wanted.has(x)));
    }
    if (templateSearch.trim()) {
      const q = templateSearch.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.tags || []).some((x) => x.toLowerCase().includes(q))
      );
    }
    return list;
  }, [templates, templateTagFilter, templateSearch]);

  const toggleResumeTag = (t) =>
    setResumeTagFilter((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
    );
  const toggleTemplateTag = (t) =>
    setTemplateTagFilter((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
    );

  const applyJDMatch = ({ templateId, resumeId }) => {
    if (templateId) {
      setTemplateTagFilter([]);
      setTemplateSearch('');
      onPickTemplate(templateId);
    }
    if (resumeId) {
      setResumeTagFilter([]);
      setResumeSearch('');
      setAttachment({ resumeId, deviceFile: null });
    }
  };

  const onAttachmentSelect = (value) => {
    if (!value) {
      setAttachment({ resumeId: '', deviceFile: null });
      return;
    }
    if (value === ATTACH_DEVICE) {
      setAttachment({ resumeId: '', deviceFile: null });
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

  const detectedVars = useMemo(
    () => Array.from(new Set([...extractVariables(template), ...extractVariables(subject)])),
    [template, subject]
  );

  // P2-12: validate that the recipients carry every token the template uses.
  // Empty `recipients[]` doesn't produce a warning — only kicks in when the
  // user has actual rows to send to.
  const missingVars = useMemo(() => {
    if (!recipients.length) return [];
    const all = ['name', 'company', 'email'];
    const provided = new Set([
      ...all,
      ...Object.keys(recipients[0] || {}),
    ]);
    // A token is "missing" if it's required by the template/subject but
    // absent from the column set AND at least one row also leaves it blank.
    return detectedVars.filter((v) => {
      if (provided.has(v)) {
        return recipients.some((r) => !String(r[v] || '').trim());
      }
      return true;
    });
  }, [detectedVars, recipients]);

  const previewVars = useMemo(() => {
    const sample = recipients[0] || {};
    if (mode === 'linkedin') {
      return { name: linkedinName, company: linkedinCompany, email: '', ...sample };
    }
    return {
      name: sample.name || '',
      company: sample.company || mailidCompany,
      email: sample.email || '',
      ...sample,
    };
  }, [mode, recipients, mailidCompany, linkedinName, linkedinCompany]);

  const previewTo =
    mode === 'linkedin' ? '' : recipients[0]?.email || '';

  // ----------------------- Saving drafts -----------------------

  // Client-side sequential loop so the recipients table can show per-row
  // progress in real time. Each iteration hits /send-email; we pause between
  // calls to match the server's BULK_SEND_DELAY guidance.
  const sendBulkSequential = async () => {
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
    // Reset statuses for this batch: every row starts as "pending".
    setSendStatuses(() => {
      const m = {};
      for (const r of recipients) m[r.email.toLowerCase()] = { status: 'pending' };
      return m;
    });

    const toastId = toast.loading(`Saving 0/${recipients.length} drafts...`);
    let drafted = 0;
    let failed = 0;
    try {
      for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        setSendStatuses((prev) => mergeStatus(prev, r.email, { status: 'sending' }));
        try {
          await api.sendEmail(
            {
              email: r.email,
              name: r.name || '',
              company: r.company || mailidCompany,
              // Forward any extra CSV columns so {{column}} tokens render.
              extra: r,
              subject,
              template,
              ...attachmentArgs.extraPayload,
            },
            attachmentArgs.files
          );
          setSendStatuses((prev) => mergeStatus(prev, r.email, { status: 'drafted' }));
          drafted++;
        } catch (err) {
          setSendStatuses((prev) =>
            mergeStatus(prev, r.email, { status: 'failed', error: err.message })
          );
          failed++;
        }
        toast.loading(
          `Saving ${i + 1}/${recipients.length} drafts...`,
          { id: toastId }
        );
        if (i < recipients.length - 1) await sleep(250);
      }
      if (failed === 0) {
        toast.success(`Saved ${drafted} draft${drafted === 1 ? '' : 's'} to Gmail.`, { id: toastId });
      } else {
        toast.error(`${drafted} saved, ${failed} failed — see row indicators.`, { id: toastId });
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

  // ----------------------- Test send -----------------------

  const runTestSend = async () => {
    const to = testEmail.trim();
    if (!to) return toast.error('Enter your test email address.');
    if (!subject.trim() || !template.trim()) {
      return toast.error('Subject and template are required.');
    }
    try {
      localStorage.setItem(TEST_EMAIL_KEY, to);
    } catch {
      /* non-fatal */
    }
    setTestSending(true);
    try {
      await toast.promise(
        api.sendEmail(
          {
            email: to,
            name: 'Test',
            company: mailidCompany || linkedinCompany || 'Test Co',
            subject,
            template,
            ...attachmentArgs.extraPayload,
            meta: { test: true },
          },
          attachmentArgs.files
        ),
        {
          loading: `Sending test draft to ${to}...`,
          success: 'Test draft saved in Gmail.',
          error: (err) => err.message || 'Test send failed',
        }
      );
    } finally {
      setTestSending(false);
    }
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

  // ----------------------- Render -----------------------

  const renderedSubject = useMemo(
    () => (subject ? renderTemplate(subject, previewVars) : ''),
    [subject, previewVars]
  );
  const renderedHtml = useMemo(
    () => (template ? renderTemplate(template, previewVars) : ''),
    [template, previewVars]
  );

  const attachmentCount = (attachment.resumeId || attachment.deviceFile) ? 1 : 0;

  // Footer CTA shape depends on mode. LinkedIn keeps the button visible so
  // the layout doesn't change between modes — it's just disabled with a
  // tooltip directing the user to the per-candidate Draft button above.
  const submitDisabled = sending || recipients.length === 0;
  const submitLabel = sending
    ? 'Saving...'
    : mode === 'linkedin'
      ? 'Use a candidate above'
      : `Save ${recipients.length || 0} draft${recipients.length === 1 ? '' : 's'} to Gmail`;
  const submitTitle =
    mode === 'linkedin'
      ? 'For LinkedIn mode, click Draft on the AI candidate row you trust.'
      : recipients.length === 0
        ? 'Add recipients first'
        : '';

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* ---------- Form card ---------- */}
      <form onSubmit={handleSubmit} className="card overflow-hidden lg:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/60 dark:border-ink-800/60 px-6 py-4">
          <h2 className="text-base font-semibold text-ink-900 dark:text-white">Compose</h2>
          <div className="tabs text-xs">
            {MODES.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => setMode(m.id)}
                className={[
                  'tab',
                  mode === m.id && `tab-active-${m.tone}`,
                ].filter(Boolean).join(' ')}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* JD-based auto-picker — explicit "Step 0" at the top so the
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
            {mode === 'mailid' && (
              <MailIDPanel
                company={mailidCompany}
                setCompany={setMailidCompany}
                recipients={mailidRecipients}
                setRecipients={setMailidRecipients}
                aiEnabled={aiEnabled}
                sendStatuses={sendStatuses}
              />
            )}
            {mode === 'bulk' && (
              <CsvUploader
                recipients={csvRecipients}
                onChange={setCsvRecipients}
                sendStatuses={sendStatuses}
              />
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
          </div>

          {/* Variable validation warning */}
          {missingVars.length > 0 && (
            <div className="rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
              <span className="font-semibold">Heads up: </span>
              the template uses{' '}
              {missingVars.map((v, i) => (
                <span key={v}>
                  <code className="font-mono">{`{{${v}}}`}</code>
                  {i < missingVars.length - 1 ? ', ' : ''}
                </span>
              ))}
              {' '}but {recipients.length > 1 ? 'some recipients lack' : 'this row lacks'} that value — those tokens will render empty.
            </div>
          )}

          <div className="divider" />

          {/* Template picker — body editing lives in the Templates tab or in
              the inline body editor below. */}
          <div>
            <div className="mb-1.5 flex items-end justify-between gap-3">
              <label className="label !mb-0" htmlFor="template-picker">Template</label>
              {templates.length > 0 && (templateTagFilter.length > 0 || templateSearch.trim()) && (
                <span className="hint">
                  {filteredTemplates.length}/{templates.length} shown
                </span>
              )}
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
                    className="text-2xs text-ink-500 dark:text-ink-400 underline hover:text-ink-700 dark:hover:text-ink-200"
                    onClick={() => setTemplateTagFilter([])}
                  >
                    Clear filter
                  </button>
                )}
              </div>
            )}
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

          {/* Inline body editor (collapsible) */}
          <div>
            <div className="mb-1.5 flex items-end justify-between gap-3">
              <label className="label !mb-0">Body (HTML)</label>
              <div className="flex items-center gap-3">
                {bodyEditOpen && <VariableChips inputRef={bodyRef} extra={detectedVars} />}
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  onClick={() => setBodyEditOpen((v) => !v)}
                  title={bodyEditOpen ? 'Hide body editor' : 'Edit body inline'}
                >
                  {bodyEditOpen ? 'Hide editor' : 'Edit body'}
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
              <p className="text-xs text-ink-500 dark:text-ink-400">
                {template.trim().length
                  ? `${template.length} chars · using ${selectedTemplateId === DEFAULT_TEMPLATE_ID ? '(Default)' : templates.find(t => t.id === selectedTemplateId)?.name || 'custom'}.`
                  : 'No body set yet.'}
                {' '}Click <strong>Edit body</strong> to tweak inline, or use the Templates tab for a full editor.
              </p>
            )}
          </div>

          {/* Attachment */}
          <div>
            <div className="mb-1.5 flex items-end justify-between gap-3">
              <label className="label !mb-0" htmlFor="attachment-picker">Attachment</label>
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
                    className="text-2xs text-ink-500 dark:text-ink-400 underline hover:text-ink-700 dark:hover:text-ink-200"
                    onClick={() => setResumeTagFilter([])}
                  >
                    Clear filter
                  </button>
                )}
              </div>
            )}
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
              {/* One-click "Browse" — bypasses the dropdown indirection. */}
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
              onChange={(e) => onDeviceFilePicked(e.target.files?.[0] || null)}
            />
            {attachment.deviceFile && (
              <p className="mt-1 text-2xs text-ink-500 dark:text-ink-400">
                Device file: <span className="font-mono">{attachment.deviceFile.name}</span> · {fmtSize(attachment.deviceFile.size)}
                <button
                  type="button"
                  className="ml-2 underline hover:text-ink-700 dark:hover:text-ink-200"
                  onClick={() => setAttachment({ resumeId: '', deviceFile: null })}
                >
                  remove
                </button>
              </p>
            )}
          </div>
        </div>

        {/* Test-to-me panel (collapsible) */}
        {testOpen && (
          <div className="anim-in border-t border-ink-200/60 dark:border-ink-800/60 bg-sky-50/40 dark:bg-sky-900/10 px-6 py-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="grow">
                <label className="label" htmlFor="test-email">Send a test draft to</label>
                <input
                  id="test-email"
                  type="email"
                  className="input"
                  placeholder="me@example.com"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={runTestSend}
                disabled={testSending || !testEmail.trim()}
              >
                {testSending ? 'Sending...' : 'Send test'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setTestOpen(false)}
              >
                Close
              </button>
            </div>
            <p className="mt-2 text-2xs text-ink-500 dark:text-ink-400">
              Saves one Gmail draft addressed to this email using the current subject, body and attachment.
              Variable tokens render as <code className="font-mono">Test</code> / your typed company.
            </p>
          </div>
        )}

        {/* Save-as panel (collapsible) */}
        {saveOpen && (
          <div className="anim-in border-t border-ink-200/60 dark:border-ink-800/60 bg-ink-50/50 dark:bg-ink-800/30 px-6 py-4">
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200/60 dark:border-ink-800/60 bg-ink-50/40 dark:bg-ink-800/40 px-6 py-3.5">
          <div className="flex flex-wrap items-center gap-1.5">
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
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => setTestOpen((v) => !v)}
              title="Send a single draft to your own address to preview in Gmail"
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
                <path d="M3 12l18-9-7 19-4-8-7-2z" />
              </svg>
              Test to me
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPreviewOpen(true)}>
              Full preview
            </button>
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
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
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
        </div>
      </form>

      {/* ---------- LivePreview side panel ---------- */}
      <aside className="card overflow-hidden lg:col-span-2 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)]">
        <LivePreview
          subject={renderedSubject}
          template={template}
          vars={previewVars}
          to={previewTo}
          attachmentCount={attachmentCount}
          onOpenFull={() => setPreviewOpen(true)}
        />
      </aside>

      <PreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        subject={renderedSubject}
        html={renderedHtml}
        to={previewTo}
      />
    </div>
  );
}
