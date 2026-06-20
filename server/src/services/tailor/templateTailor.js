import { nanoid } from 'nanoid';

import { generateStructuredJson, isLlmConfigured } from '../llm.js';
import { templatesStore } from '../store.js';
import { normalizeTags } from '../../utils/tags.js';
import { buildTailoredForMeta } from './tailoredFor.js';
import {
  abandonSession,
  cacheSession,
  evictExpiredFromDb,
  findLatestActiveDoc,
  loadSessionDoc,
  persistSessionDoc,
  touchSessionTimestamps,
} from './sessionPersistence.js';

// ---------------------------------------------------------------------------
// Template parsing — split body into ordered paragraphs. Subject is its own
// targetable unit. Handlebars-style placeholders ({{firstName}}) inside the
// text are preserved verbatim in suggestions (Gemini is instructed not to
// touch them).
// ---------------------------------------------------------------------------

export function parseTemplate(template) {
  const body = String(template?.body || '');
  // Split on blank lines so paragraphs read like the way humans wrote them.
  // We keep the original separators so the round-trip back to body text is
  // lossless.
  const paragraphs = body
    .split(/\r?\n\s*\r?\n/)
    .map((p, i) => ({ index: i, text: p.trim() }))
    .filter((p) => p.text.length > 0);
  return {
    id: template.id,
    name: template.name,
    subject: String(template.subject || ''),
    body,
    paragraphs,
    tags: Array.isArray(template.tags) ? template.tags : [],
  };
}

function paragraphsToBody(parsed) {
  return parsed.paragraphs.map((p) => p.text).join('\n\n');
}

// ---------------------------------------------------------------------------
// Gemini schemas / prompts
// ---------------------------------------------------------------------------

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description:
              'Which part of the template to rewrite. Use "subject" for the subject line, or "paragraph:N" where N is the zero-based paragraph index shown in the input (e.g. "paragraph:0", "paragraph:1").',
          },
          targetText: {
            type: 'string',
            description: 'The plain text of the existing subject or paragraph being replaced (must match what was shown in the input).',
          },
          draft: {
            type: 'string',
            description:
              'Rewritten subject or paragraph. Change ONLY human-readable text for the JD. FORMAT IS FIXED: keep identical HTML tags, style="..." attributes (colors, fonts, margins), tag nesting, list type/count, links, and line breaks. All {{handlebars}} placeholders unchanged. Same approximate length and tone.',
          },
          previewText: {
            type: 'string',
            description: 'A human-readable preview of the new content (usually identical to draft).',
          },
          reason: { type: 'string', description: 'One short sentence citing the JD requirement this addresses.' },
          atsKeywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'Keywords from the JD this suggestion strengthens.',
          },
          impact: { type: 'number', description: '1 (low) to 10 (high) impact on JD match.' },
        },
        required: ['target', 'draft', 'previewText', 'reason', 'impact'],
      },
    },
  },
  required: ['suggestions'],
};

const REFINE_SCHEMA = {
  type: 'object',
  properties: {
    draft: { type: 'string' },
    previewText: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['draft', 'previewText'],
};

// Shared definition so "format" is unambiguous to the model — users mean
// visual/HTML structure, not just paragraph count.
const FORMAT_PRESERVATION_RULES = `WHAT "FORMAT" MEANS — PRESERVE EXACTLY (change only the readable words inside):
• HTML tags & structure: same elements and nesting (<div>, <p>, <h1>–<h6>, <strong>, <em>, <b>, <i>, <ul>, <ol>, <li>, <br>, <span>, <a>, tables, etc.). Same number of blocks/sections. Do not add, remove, swap, or reorder tags or paragraphs.
• Colors & inline CSS: every style="..." attribute must stay identical — including color (e.g. #2563eb, #dc2626, rgb()), background-color, font-size, font-weight, font-family, margin, padding, line-height, text-align, text-decoration, border, etc. Do not recolor headings or body text.
• Lists & layout: same bullet vs numbered lists, same <li> count, same indentation/spacing implied by the HTML.
• Links: keep each <a href="..."> (and target/rel) unchanged; only the visible link text may change if needed for the JD.
• Line breaks & whitespace: preserve <br>, blank lines between blocks, and paragraph boundaries as in the original.
• Forbidden: stripping HTML, outputting Markdown/plain text, inventing new tags/styles, changing tag types (<p>→<div>), or any visual redesign. A new look = a new template, not tailoring.`;

const PLAN_SYSTEM_PROMPT = `You are an expert cold-email template tailoring assistant.

You receive a candidate's existing email template (subject + HTML/plain body paragraphs) and a target Job Description. You output small, focused rewrites that improve JD relevance without inventing facts.

TAILORING = CONTENT ONLY, NOT FORMAT (hard rule, non-negotiable):
You may change what the email SAYS (wording, which skills/experience are emphasized). You must NOT change how it LOOKS or how it is MARKED UP. If the user wanted different colors, fonts, HTML layout, or section design, they would create/upload a new template — not use tailoring.

${FORMAT_PRESERVATION_RULES}

HARD RULES (non-negotiable):
1. CONTENT-ONLY. Rewrite words inside the existing subject or each existing paragraph only. Never add/remove/reorder paragraphs or sections.
2. FORMAT LOCK. Treat the original HTML (tags, style attributes, colors, lists, links) as a fixed shell — only edit text nodes inside it.
3. PLACEHOLDERS. Every {{handlebars}} token (e.g. {{name}}, {{company}}) must appear in your rewrite in the same semantic position. Do not invent new placeholders.
4. SAME OR SHORTER. Prefer 5–15% shorter than the original; never more than +15 characters.
5. NO FABRICATION. Do not invent employers, projects, dates, metrics, or skills not implied by the original.
6. Preserve professional, warm tone and the candidate's voice.
7. Output ONLY JSON matching the schema. No prose, no markdown fences.

Return at most 6 suggestions, most-impactful first. Targets: "subject" or "paragraph:N" (indices from the input).`;

const REFINE_SYSTEM_PROMPT = `You are revising one email-template suggestion from user feedback.

TAILORING = CONTENT ONLY, NOT FORMAT (hard rule). Change wording only — not HTML, colors, or layout.

${FORMAT_PRESERVATION_RULES}

Hard rules:
- Keep every {{handlebars}} placeholder.
- Keep all HTML tags, style="..." attributes (including colors/fonts), list structure, links, and line breaks identical to the target being edited.
- Length within 15% of original, never +15 characters.
- Do not invent experience, companies, or numbers.
- Output ONLY JSON matching the schema. No markdown fences.`;

function buildPromptBody(parsed, opts) {
  const lines = [];
  lines.push('# Template');
  lines.push(`SUBJECT: ${parsed.subject}`);
  for (const p of parsed.paragraphs) {
    lines.push(`PARAGRAPH:${p.index}: ${p.text}`);
  }
  lines.push('');
  lines.push('# Reminder');
  lines.push(
    'CONTENT ONLY: change words for the JD. FORMAT IS LOCKED: same HTML tags, style attributes (colors, fonts, margins), list structure, links, and visual layout. Do not change #2563eb-style colors or add/remove <h3>/<p>/<li> tags.'
  );
  lines.push('');
  lines.push('# Job Description');
  lines.push(String(opts.jobDescription || '').trim());
  const hints = [];
  if (opts.targetRole) hints.push(`Target role: ${opts.targetRole}`);
  if (opts.targetCompany) hints.push(`Target company: ${opts.targetCompany}`);
  if (opts.seniority) hints.push(`Seniority: ${opts.seniority}`);
  if (hints.length) {
    lines.push('');
    lines.push('# Hints');
    lines.push(...hints);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Suggestion normalisation
// ---------------------------------------------------------------------------

const TARGET_RE = /^(subject|paragraph:(\d+))$/;

function normalizeSuggestions(raw, parsed) {
  if (!raw || !Array.isArray(raw.suggestions)) return { suggestions: [] };
  const known = new Set(['subject', ...parsed.paragraphs.map((p) => `paragraph:${p.index}`)]);
  const cleaned = raw.suggestions
    .filter(
      (s) =>
        s &&
        typeof s.target === 'string' &&
        TARGET_RE.test(s.target) &&
        known.has(s.target) &&
        typeof s.draft === 'string' &&
        s.draft.trim() &&
        typeof s.previewText === 'string'
    )
    .map((s) => ({
      target: s.target,
      targetText: typeof s.targetText === 'string' ? s.targetText : '',
      draft: s.draft.trim(),
      previewText: s.previewText.trim(),
      reason: typeof s.reason === 'string' ? s.reason : '',
      atsKeywords: Array.isArray(s.atsKeywords) ? s.atsKeywords.map(String).slice(0, 6) : [],
      impact: Number.isFinite(s.impact) ? Math.max(1, Math.min(10, s.impact)) : 5,
    }));
  cleaned.sort((a, b) => b.impact - a.impact);
  return { suggestions: cleaned.slice(0, 8) };
}

// ---------------------------------------------------------------------------
// AI calls
// ---------------------------------------------------------------------------

async function generateSuggestions(parsed, opts) {
  const parsedJson = await generateStructuredJson({
    systemPrompt: PLAN_SYSTEM_PROMPT,
    userPrompt: buildPromptBody(parsed, opts),
    schema: SUGGESTION_SCHEMA,
    temperature: 0.35,
  });
  return normalizeSuggestions(parsedJson, parsed);
}

async function refineSuggestion({ original, instruction }) {
  if (!instruction?.trim()) throw new Error('instruction is required.');
  const prompt = [
    `Target: ${original.target}`,
    'Original draft:',
    original.draft,
    '',
    'Reminder: content-only — keep all HTML tags, inline styles (colors/fonts), lists, links, and layout unchanged.',
    '',
    'User instruction:',
    instruction.trim(),
  ].join('\n');

  const parsedJson = await generateStructuredJson({
    systemPrompt: REFINE_SYSTEM_PROMPT,
    userPrompt: prompt,
    schema: REFINE_SCHEMA,
    temperature: 0.3,
  });

  if (!parsedJson || typeof parsedJson.draft !== 'string' || !parsedJson.draft.trim()) {
    throw new Error('Refined draft missing draft field.');
  }
  return {
    draft: parsedJson.draft.trim(),
    previewText:
      typeof parsedJson.previewText === 'string' && parsedJson.previewText.trim()
        ? parsedJson.previewText.trim()
        : original.previewText,
    reason:
      typeof parsedJson.reason === 'string' && parsedJson.reason.trim()
        ? parsedJson.reason.trim()
        : original.reason,
  };
}

// ---------------------------------------------------------------------------
// Apply suggestion (pure — operates on a parsed-template copy, never touches
// the DB until the user clicks "Save as new template")
// ---------------------------------------------------------------------------

const LENGTH_GROWTH_ABS = 15; // chars
const LENGTH_GROWTH_PCT = 0.15;
function lengthBudget(orig) {
  const n = (orig || '').length;
  return Math.max(LENGTH_GROWTH_ABS, Math.ceil(n * LENGTH_GROWTH_PCT));
}

function placeholdersOf(text) {
  const set = new Set();
  for (const m of String(text || '').matchAll(/\{\{\s*[\w.]+\s*\}\}/g)) set.add(m[0].replace(/\s+/g, ''));
  return set;
}

function checkPlaceholdersPreserved(originalText, newText) {
  const oset = placeholdersOf(originalText);
  if (!oset.size) return;
  const nset = placeholdersOf(newText);
  for (const ph of oset) {
    if (!nset.has(ph)) {
      throw new Error(`Replacement dropped placeholder ${ph}. Keep all {{handlebars}} tokens intact.`);
    }
  }
}

export function applySuggestion(parsed, sug) {
  if (sug.target === 'subject') {
    checkPlaceholdersPreserved(parsed.subject, sug.draft);
    const allowed = parsed.subject.length + lengthBudget(parsed.subject);
    if (sug.draft.length > allowed) {
      throw new Error(`Subject too long: ${sug.draft.length} chars (max ${allowed}).`);
    }
    parsed.subject = sug.draft;
    return;
  }
  const idx = Number(sug.target.split(':')[1]);
  const p = parsed.paragraphs.find((x) => x.index === idx);
  if (!p) throw new Error(`Paragraph ${idx} not found.`);
  checkPlaceholdersPreserved(p.text, sug.draft);
  const allowed = p.text.length + lengthBudget(p.text);
  if (sug.draft.length > allowed) {
    throw new Error(`Paragraph too long: ${sug.draft.length} chars (max ${allowed}).`);
  }
  p.text = sug.draft;
}

// ---------------------------------------------------------------------------
// Session persistence (Mongo tailor_sessions, kind=template)
// ---------------------------------------------------------------------------

function serializeTemplate(session) {
  return {
    id: session.id,
    kind: 'template',
    status: session.status || 'active',
    original: session.original,
    jobDescription: session.jobDescription,
    targetRole: session.targetRole,
    targetCompany: session.targetCompany,
    seniority: session.seniority,
    queue: session.queue,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    updatedAt: session.updatedAt,
  };
}

function hydrateTemplate(doc) {
  const session = {
    id: doc.id,
    status: doc.status || 'active',
    original: doc.original,
    jobDescription: doc.jobDescription,
    targetRole: doc.targetRole || '',
    targetCompany: doc.targetCompany || '',
    seniority: doc.seniority || '',
    queue: doc.queue || [],
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt,
    updatedAt: doc.updatedAt,
  };
  session.working = parseTemplate(session.original);
  replayApprovedQueue(session);
  return session;
}

async function persistTemplate(session) {
  touchSessionTimestamps(session);
  await persistSessionDoc(serializeTemplate(session));
  cacheSession('template', session);
}

export function buildTemplateRestorePayload(session) {
  const np = nextPending(session);
  return {
    session: publicState(session),
    jobDescription: session.jobDescription,
    targetRole: session.targetRole,
    targetCompany: session.targetCompany,
    seniority: session.seniority,
    templateId: session.original?.id,
    firstSuggestion: publicSuggestion(np),
    done: !np,
  };
}

function publicSuggestion(sug) {
  if (!sug) return null;
  return {
    id: sug.id,
    target: sug.target,
    targetText: sug.targetText,
    draft: sug.draft,
    previewText: sug.previewText,
    reason: sug.reason,
    atsKeywords: sug.atsKeywords,
    impact: sug.impact,
    status: sug.status,
  };
}

function publicState(s) {
  return {
    sessionId: s.id,
    templateId: s.original.id,
    pending: s.queue.filter((q) => q.status === 'pending').length,
    applied: s.queue.filter((q) => q.status === 'approved').length,
    totalSuggestions: s.queue.length,
    subject: s.working.subject,
    body: paragraphsToBody(s.working),
    targetCompany: s.targetCompany,
    targetRole: s.targetRole,
    seniority: s.seniority,
  };
}

function nextPending(s) {
  return s.queue.find((q) => q.status === 'pending') || null;
}

// Replay = restart from the original template, then re-apply every queue entry
// currently marked 'approved' in order. Mirrors the resume Tailor's approach.
function replayApprovedQueue(s) {
  s.working = parseTemplate(s.original);
  for (const q of s.queue) {
    if (q.status !== 'approved') continue;
    try {
      applySuggestion(s.working, q);
    } catch (err) {
      q.status = 'failed';
      q.error = err.message;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createTemplateSession({
  templateId,
  jobDescription,
  targetRole = '',
  targetCompany = '',
  seniority = '',
}) {
  await evictExpiredFromDb();
  if (!templateId) throw new Error('templateId is required.');
  if (!jobDescription || !jobDescription.trim()) {
    throw new Error('jobDescription is required.');
  }
  const items = await templatesStore.list();
  const original = items.find((t) => t.id === templateId);
  if (!original) {
    const err = new Error('Template not found.');
    err.status = 404;
    throw err;
  }
  const working = parseTemplate(original);
  const ai = await generateSuggestions(working, {
    jobDescription,
    targetRole,
    targetCompany,
    seniority,
  });
  const queue = ai.suggestions.map((sug) => ({
    ...sug,
    id: nanoid(8),
    status: 'pending',
  }));
  const id = nanoid(12);
  const now = Date.now();
  const s = {
    id,
    status: 'active',
    original,
    working,
    jobDescription,
    targetRole,
    targetCompany,
    seniority,
    queue,
    createdAt: now,
    expiresAt: now,
    updatedAt: now,
  };
  await persistTemplate(s);
  return {
    ...publicState(s),
    firstSuggestion: publicSuggestion(nextPending(s)),
  };
}

export async function getTemplateSession(id) {
  await evictExpiredFromDb();
  const doc = await loadSessionDoc(id, 'template');
  if (!doc) return null;
  const session = hydrateTemplate(doc);
  cacheSession('template', session);
  return session;
}

export async function getActiveTemplateSession() {
  await evictExpiredFromDb();
  const doc = await findLatestActiveDoc('template');
  if (!doc) return null;
  const session = hydrateTemplate(doc);
  cacheSession('template', session);
  return session;
}

export async function abandonTemplateSession(id) {
  await abandonSession(id, 'template');
}

export async function nextTemplateSuggestion(id) {
  const s = await getTemplateSession(id);
  if (!s) {
    const e = new Error('Session not found or expired.');
    e.status = 404;
    throw e;
  }
  await persistTemplate(s);
  const np = nextPending(s);
  if (!np) return { done: true, state: publicState(s) };
  return { done: false, suggestion: publicSuggestion(np), state: publicState(s) };
}

export async function decideTemplateSuggestion(id, { suggestionId, decision, editInstruction }) {
  const s = await getTemplateSession(id);
  if (!s) {
    const e = new Error('Session not found or expired.');
    e.status = 404;
    throw e;
  }
  const sug = s.queue.find((q) => q.id === suggestionId);
  if (!sug) {
    const e = new Error('Suggestion not found.');
    e.status = 404;
    throw e;
  }
  const wasApproved = sug.status === 'approved';
  const respond = (extra) => ({
    next: publicSuggestion(nextPending(s)),
    state: publicState(s),
    ...extra,
  });

  if (decision === 'reject' || decision === 'skip') {
    if (sug.status === 'rejected') {
      await persistTemplate(s);
      return respond({ result: 'rejected' });
    }
    sug.status = 'rejected';
    if (wasApproved) replayApprovedQueue(s);
    await persistTemplate(s);
    return respond({ result: 'rejected' });
  }

  if (decision === 'edit') {
    const refined = await refineSuggestion({ original: sug, instruction: editInstruction });
    sug.draft = refined.draft;
    sug.previewText = refined.previewText;
    if (refined.reason) sug.reason = refined.reason;
    if (wasApproved) {
      replayApprovedQueue(s);
      await persistTemplate(s);
      return { result: 'refined-applied', next: publicSuggestion(sug), state: publicState(s) };
    }
    sug.status = 'pending';
    await persistTemplate(s);
    return { result: 'refined', next: publicSuggestion(sug), state: publicState(s) };
  }

  if (decision === 'approve') {
    if (wasApproved) {
      await persistTemplate(s);
      return respond({ result: 'noop' });
    }
    if (sug.status === 'pending') {
      try {
        applySuggestion(s.working, sug);
        sug.status = 'approved';
        await persistTemplate(s);
        return respond({ result: 'applied' });
      } catch (err) {
        sug.status = 'failed';
        sug.error = err.message;
        await persistTemplate(s);
        return respond({ result: 'failed', error: err.message });
      }
    }
    sug.status = 'approved';
    replayApprovedQueue(s);
    if (sug.status === 'failed') {
      await persistTemplate(s);
      return respond({ result: 'failed', error: sug.error });
    }
    await persistTemplate(s);
    return respond({ result: 'applied' });
  }

  const e = new Error(`Unknown decision "${decision}".`);
  e.status = 400;
  throw e;
}

/**
 * Persist the current `working` state as a NEW template entry. Original stays
 * untouched. Tags merge: original.tags + auto-tags from the session context.
 */
export async function saveTemplateSession(id, { name, tags } = {}) {
  const s = await getTemplateSession(id);
  if (!s) {
    const e = new Error('Session not found or expired.');
    e.status = 404;
    throw e;
  }
  const date = new Date().toISOString().slice(0, 10);
  const niceName =
    String(name || '').trim() ||
    [s.original.name, s.targetCompany, date].filter(Boolean).join(' — ');
  const autoTags = [
    ...(s.original.tags || []),
    ...(s.targetCompany ? [s.targetCompany] : []),
    ...(s.targetRole ? [s.targetRole] : []),
    ...(s.seniority ? [s.seniority] : []),
    ...collectApprovedKeywords(s),
  ];
  const item = {
    id: nanoid(10),
    name: niceName,
    subject: s.working.subject,
    body: paragraphsToBody(s.working),
    tags: normalizeTags(Array.isArray(tags) ? tags : autoTags),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tailoredFor: buildTailoredForMeta(s),
  };
  await templatesStore.append(item);
  return item;
}

function collectApprovedKeywords(s) {
  const out = [];
  for (const q of s.queue) {
    if (q.status !== 'approved') continue;
    for (const k of q.atsKeywords || []) out.push(k);
  }
  return out;
}

export function isTailorTemplateEnabled() {
  return isLlmConfigured();
}
