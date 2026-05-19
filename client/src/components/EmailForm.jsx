import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { api } from '../lib/api.js';
import { extractVariables } from '../lib/render.js';
import PreviewModal from './PreviewModal.jsx';
import CsvUploader from './CsvUploader.jsx';
import EnrichPanel from './EnrichPanel.jsx';
import LivePreview from './LivePreview.jsx';
import TemplateEditor from './TemplateEditor.jsx';
import VariableChips from './VariableChips.jsx';
import AttachmentList from './AttachmentList.jsx';

const DEFAULT_TEMPLATE = `<div style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;max-width:640px;line-height:1.65;font-size:15px;">
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
  { id: 'single', label: 'Single recipient' },
  { id: 'bulk', label: 'Bulk (CSV)' },
];

const BODY_TABS = [
  { id: 'preview', label: 'Live preview' },
  { id: 'editor', label: 'HTML editor' },
];

export default function EmailForm({ initialTemplate, onClearTemplate, aiEnabled = false }) {
  const [mode, setMode] = useState('single');
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);

  const [recipient, setRecipient] = useState({ email: '', name: '', company: '' });
  const [recipients, setRecipients] = useState([]);

  const [previewOpen, setPreviewOpen] = useState(false);

  const [sending, setSending] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [savingAs, setSavingAs] = useState(false);
  const [savedName, setSavedName] = useState('');

  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState(null);

  const [attachments, setAttachments] = useState([]);

  const [bodyTab, setBodyTab] = useState('preview');

  const subjectRef = useRef(null);
  const templateRef = useRef(null);

  // Hydrate from a chosen saved template
  useEffect(() => {
    if (initialTemplate) {
      setSubject(initialTemplate.subject || '');
      setTemplate(initialTemplate.body || '');
      toast.success(`Loaded template "${initialTemplate.name}"`);
      // Jump to editor so user can review what just loaded
      setBodyTab('editor');
      onClearTemplate?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTemplate]);

  useEffect(() => {
    setEnrichResult(null);
  }, [mode, recipient.name, recipient.company]);

  const detectedVars = useMemo(
    () => Array.from(new Set([...extractVariables(template), ...extractVariables(subject)])),
    [template, subject]
  );

  const previewVars = useMemo(() => {
    if (mode === 'bulk' && recipients.length) return recipients[0];
    return { ...recipient };
  }, [mode, recipients, recipient]);

  const previewTo = mode === 'bulk' ? recipients[0]?.email || '' : recipient.email;

  // ----------------------- Sending -----------------------

  const sendSingle = async () => {
    if (!recipient.email.trim()) return toast.error('Recipient email is required.');
    if (!subject.trim()) return toast.error('Subject is required.');
    if (!template.trim()) return toast.error('Template is empty.');

    setSending(true);
    const promise = api.sendEmail(
      {
        email: recipient.email.trim(),
        name: recipient.name.trim(),
        company: recipient.company.trim(),
        subject,
        template,
      },
      attachments
    );
    try {
      await toast.promise(promise, {
        loading: `Sending to ${recipient.email}...`,
        success: 'Email sent.',
        error: (err) => err.message || 'Send failed',
      });
    } finally {
      setSending(false);
    }
  };

  const sendBulk = async () => {
    if (!recipients.length) return toast.error('Upload a CSV first.');
    if (!subject.trim()) return toast.error('Subject is required.');
    if (!template.trim()) return toast.error('Template is empty.');

    setSending(true);
    const promise = api.sendBulk({ recipients, subject, template }, attachments);
    try {
      const res = await toast.promise(promise, {
        loading: `Sending to ${recipients.length} recipients...`,
        success: (data) =>
          `Bulk complete: ${data.sent} sent${data.failed ? `, ${data.failed} failed` : ''}.`,
        error: (err) => err.message || 'Bulk send failed',
      });
      if (res.failed) {
        console.warn('Failed sends:', res.results.filter((r) => r.status === 'failed'));
      }
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (sending) return;
    if (mode === 'single') sendSingle();
    else sendBulk();
  };

  // ----------------------- AI lookup -----------------------

  const splitName = (full) => {
    const parts = (full || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { firstName: '', lastName: '' };
    if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
    return { firstName: parts[0], lastName: parts[parts.length - 1] };
  };

  const canEnrich =
    aiEnabled &&
    mode === 'single' &&
    recipient.name.trim() &&
    recipient.company.trim();

  const findWithAI = async () => {
    if (!canEnrich || enriching) return;
    const { firstName, lastName } = splitName(recipient.name);
    setEnriching(true);
    try {
      const res = await api.enrichEmail({
        firstName,
        lastName,
        company: recipient.company.trim(),
      });
      setEnrichResult(res);
      if (!res.candidates?.length) toast.error('AI returned no usable candidates.');
    } catch (err) {
      toast.error(err.message || 'AI lookup failed');
    } finally {
      setEnriching(false);
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
          {/* Recipient */}
          {mode === 'single' ? (
            <fieldset className="space-y-4">
              <legend className="label !mb-2">Recipient</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    required
                    className="input"
                    placeholder="john@example.com"
                    value={recipient.email}
                    onChange={(e) => setRecipient({ ...recipient, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="name">Full name</label>
                  <input
                    id="name"
                    type="text"
                    className="input"
                    placeholder="John Doe"
                    value={recipient.name}
                    onChange={(e) => setRecipient({ ...recipient, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="company">Company</label>
                  <input
                    id="company"
                    type="text"
                    className="input"
                    placeholder="Acme Inc."
                    value={recipient.company}
                    onChange={(e) => setRecipient({ ...recipient, company: e.target.value })}
                  />
                </div>
              </div>

              {aiEnabled && (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="btn-secondary btn-xs"
                    onClick={findWithAI}
                    disabled={!canEnrich || enriching}
                    title={
                      !recipient.name.trim() || !recipient.company.trim()
                        ? 'Fill name + company first'
                        : 'Ask AI for likely email addresses'
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
                    {enriching ? 'Asking AI...' : 'Find email with AI'}
                  </button>
                  <span className="hint">
                    {canEnrich
                      ? 'Uses name + company to propose 5 likely email addresses.'
                      : 'Fill the name and company fields to enable.'}
                  </span>
                </div>
              )}

              {enrichResult && (
                <div className="anim-in">
                  <EnrichPanel
                    result={enrichResult}
                    recipientName={recipient.name}
                    company={recipient.company}
                    subject={subject}
                    template={template}
                    attachments={attachments}
                  />
                </div>
              )}
            </fieldset>
          ) : (
            <CsvUploader recipients={recipients} onChange={setRecipients} />
          )}

          <div className="divider" />

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

          {/* Attachments */}
          <div>
            <label className="label">Attachments</label>
            <AttachmentList files={attachments} onChange={setAttachments} />
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
            <button type="submit" className="btn-gradient" disabled={sending}>
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
                  Sending...
                </>
              ) : mode === 'single' ? (
                <>
                  Send Email
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
              ) : (
                <>Send to {recipients.length || 0}</>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* ---------- Body: tabbed Preview / Editor (full width below) ---------- */}
      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/60 px-6 py-3.5">
          <div className="tabs">
            {BODY_TABS.map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => setBodyTab(t.id)}
                className={['tab', bodyTab === t.id && 'tab-active'].filter(Boolean).join(' ')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="text-2xs text-ink-500">
            {bodyTab === 'preview'
              ? 'Renders with the form values above (or the first CSV row in bulk mode).'
              : 'HTML email body. Use the chips to insert template variables.'}
          </div>
        </header>

        {bodyTab === 'preview' ? (
          <LivePreview
            subject={subject}
            template={template}
            vars={previewVars}
            to={previewTo}
            attachmentCount={attachments.length}
            onOpenFull={() => setPreviewOpen(true)}
          />
        ) : (
          <TemplateEditor
            ref={templateRef}
            value={template}
            onChange={setTemplate}
            detectedVars={detectedVars}
          />
        )}
      </section>

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
