import { Router } from 'express';
import { nanoid } from 'nanoid';

import { renderTemplate } from '../utils/render.js';
import { saveDraft } from '../services/imapDrafts.js';
import { sentLogStore } from '../services/store.js';
import { resumeStore } from '../services/resumeStore.js';
import { HttpError } from '../middleware/error.js';
import { validateSingleSend, validateBulkSend } from '../middleware/validate.js';
import { acceptAttachments, parseJsonField } from '../middleware/upload.js';

const router = Router();
const BULK_DELAY = Number(process.env.BULK_SEND_DELAY_MS) || 250;

// Every draft attachment is renamed to this on the way out so the recipient
// always sees a consistent filename, regardless of which library PDF or
// device PDF was selected. Override via the env var if needed.
const ATTACHMENT_FILENAME = (
  process.env.DRAFT_ATTACHMENT_FILENAME || 'Sk_Sahil_Parvez_CV'
).replace(/\.pdf$/i, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildVars(row) {
  // Allow {{name}}, {{company}}, {{email}} plus any extra CSV columns.
  return { name: '', company: '', email: '', ...row };
}

// Resolve the single attachment for a draft. Precedence: device upload
// (multipart "attachments" field) > library resume id > none. Hard-cap to
// one file and rename it to the configured public filename so the recipient
// always sees the same name.
async function resolveAttachment({ files = [], resumeId }) {
  let chosen = null;
  if (Array.isArray(files) && files.length) {
    const f = files[0];
    chosen = {
      filename: f.originalname,
      content: f.buffer,
      contentType: f.mimetype || 'application/pdf',
      size: f.size,
    };
  } else if (resumeId) {
    const doc = await resumeStore.get(String(resumeId));
    if (!doc) throw new HttpError(400, 'Selected resume not found.');
    chosen = {
      filename: doc.filename || 'resume.pdf',
      content: doc.content,
      contentType: doc.contentType || 'application/pdf',
      size: doc.size,
    };
  }
  if (!chosen) return { attachments: [], info: null };

  const renamed = { ...chosen, filename: `${ATTACHMENT_FILENAME}.pdf` };
  return {
    attachments: [renamed],
    info: [{ name: renamed.filename, size: chosen.size }],
  };
}

// Some multipart clients send the `meta` field as a JSON string. Normalise it.
function parseMaybeJson(value) {
  if (value == null) return undefined;
  if (typeof value === 'object') return value;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function logSend(entry) {
  try {
    await sentLogStore.append(entry);
  } catch (err) {
    console.error('[coldMail] failed to write sent log entry:', err);
  }
}

// POST /api/preview — server-side render so client and server stay in sync.
router.post('/preview', (req, res, next) => {
  try {
    const { template, subject, variables } = req.body || {};
    if (typeof template !== 'string') {
      throw new HttpError(400, 'template (string) is required');
    }
    const vars = buildVars(variables || {});
    res.json({
      subject: subject ? renderTemplate(subject, vars) : '',
      html: renderTemplate(template, vars),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/send-email
router.post(
  '/send-email',
  acceptAttachments,
  parseJsonField('extra'),
  parseJsonField('meta'),
  validateSingleSend,
  async (req, res, next) => {
    const {
      email,
      name = '',
      company = '',
      template,
      subject,
      extra = {},
    } = req.body;
    const meta = parseMaybeJson(req.body.meta) || req.body.meta;
    const vars = buildVars({ email, name, company, ...extra });

    let attachments;
    let attachInfo;
    try {
      const resolved = await resolveAttachment({
        files: req.files,
        resumeId: req.body.resumeId,
      });
      attachments = resolved.attachments;
      attachInfo = resolved.info;
    } catch (err) {
      return next(err);
    }

    const mergedMeta =
      meta || attachInfo
        ? { ...(typeof meta === 'object' ? meta : {}), ...(attachInfo ? { attachments: attachInfo } : {}) }
        : null;
    const metaPart = mergedMeta ? { meta: mergedMeta } : {};

    try {
      const html = renderTemplate(template, vars);
      const renderedSubject = renderTemplate(subject, vars);

      const info = await saveDraft({
        to: email,
        subject: renderedSubject,
        html,
        attachments,
      });

      const entry = {
        id: nanoid(10),
        to: email,
        name,
        company,
        subject: renderedSubject,
        messageId: info.messageId,
        status: 'drafted',
        sentAt: new Date().toISOString(),
        ...metaPart,
      };
      await logSend(entry);

      res.json({ success: true, ...entry });
    } catch (err) {
      await logSend({
        id: nanoid(10),
        to: email,
        name,
        company,
        subject,
        status: 'failed',
        error: err.message,
        sentAt: new Date().toISOString(),
        ...metaPart,
      });
      next(new HttpError(502, `Failed to save draft: ${err.message}`));
    }
  }
);

// POST /api/send-bulk
router.post(
  '/send-bulk',
  acceptAttachments,
  parseJsonField('recipients'),
  validateBulkSend,
  async (req, res, next) => {
    const { recipients, template, subject } = req.body;

    let attachments;
    let attachInfo;
    try {
      const resolved = await resolveAttachment({
        files: req.files,
        resumeId: req.body.resumeId,
      });
      attachments = resolved.attachments;
      attachInfo = resolved.info;
    } catch (err) {
      return next(err);
    }

    const metaPart = attachInfo ? { meta: { attachments: attachInfo } } : {};

    const results = [];
    let sent = 0;
    let failed = 0;

    try {
      for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        const vars = buildVars(r);
        const renderedSubject = renderTemplate(subject, vars);
        const html = renderTemplate(template, vars);

        try {
          const info = await saveDraft({
            to: r.email,
            subject: renderedSubject,
            html,
            attachments,
          });
          const entry = {
            id: nanoid(10),
            to: r.email,
            name: r.name || '',
            company: r.company || '',
            subject: renderedSubject,
            messageId: info.messageId,
            status: 'drafted',
            sentAt: new Date().toISOString(),
            ...metaPart,
          };
          await logSend(entry);
          results.push({ email: r.email, status: 'drafted', messageId: info.messageId });
          sent++;
        } catch (err) {
          await logSend({
            id: nanoid(10),
            to: r.email,
            name: r.name || '',
            company: r.company || '',
            subject: renderedSubject,
            status: 'failed',
            error: err.message,
            sentAt: new Date().toISOString(),
            ...metaPart,
          });
          results.push({ email: r.email, status: 'failed', error: err.message });
          failed++;
        }

        if (i < recipients.length - 1 && BULK_DELAY > 0) {
          await sleep(BULK_DELAY);
        }
      }

      res.json({ success: true, total: recipients.length, sent, failed, results });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
