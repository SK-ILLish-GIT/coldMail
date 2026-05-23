import { GoogleGenerativeAI } from '@google/generative-ai';
import { nanoid } from 'nanoid';

import { templatesStore } from '../store.js';
import { normalizeTags } from '../../utils/tags.js';
import { buildTailoredForMeta } from './tailoredFor.js';

// ---------------------------------------------------------------------------
// Gemini wiring (mirrors the resume gemini.js client — kept private to keep
// the two systems independently testable).
// ---------------------------------------------------------------------------

let cachedClient = null;
function getKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !key.trim()) {
    const err = new Error('GEMINI_API_KEY is not configured on the server.');
    err.status = 503;
    throw err;
  }
  return key.trim();
}
function getClient() {
  if (!cachedClient) cachedClient = new GoogleGenerativeAI(getKey());
  return cachedClient;
}
function modelName() {
  return (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
}

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
              'The rewritten plain text. Preserve all {{handlebars}} placeholders exactly as they appeared in the original. Keep the same approximate length and tone.',
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

const PLAN_SYSTEM_PROMPT = `You are an expert cold-email template tailoring assistant.

You receive a candidate's existing email template (subject + paragraphs) and a target Job Description. You output an ordered list of small, focused rewrites that improve relevance to the JD without inventing facts.

HARD RULES (non-negotiable):
1. CONTENT-ONLY. Only rewrite the subject or individual paragraphs in place. NEVER add new paragraphs, remove paragraphs, or reorder them.
2. PRESERVE PLACEHOLDERS. Every {{handlebars}} token in the original (e.g. {{firstName}}, {{company}}, {{role}}) MUST appear in your rewrite, in the same place where it semantically belongs. Do not invent new placeholders.
3. SAME OR SHORTER. Each rewrite's length should be no longer than the original it replaces — prefer 5-15% shorter. Never exceed by more than 15 characters.
4. NEVER fabricate the candidate's experience, employers, projects, dates, or numbers. Only reframe what's already implied by the original wording.
5. Keep the tone professional but warm; preserve the candidate's voice.
6. Output ONLY JSON matching the supplied schema. No prose, no markdown fences.

Return at most 6 suggestions, ordered most-impactful first. Allowed targets: "subject" and "paragraph:N" where N is one of the indices shown in the input.`;

const REFINE_SYSTEM_PROMPT = `You are revising a single email-template suggestion based on user feedback.

Hard rules:
- Preserve every {{handlebars}} placeholder from the previous draft.
- Keep length similar to the original (15% or less growth, never +15 chars).
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
// Gemini calls
// ---------------------------------------------------------------------------

async function generateSuggestions(parsed, opts) {
  const gen = getClient();
  const model = gen.getGenerativeModel({
    model: modelName(),
    systemInstruction: PLAN_SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.35,
      responseMimeType: 'application/json',
      responseSchema: SUGGESTION_SCHEMA,
    },
  });
  const res = await model.generateContent(buildPromptBody(parsed, opts));
  const text = res?.response?.text?.();
  if (!text) throw new Error('Gemini returned an empty response.');
  let parsedJson;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned non-JSON content for suggestions.');
  }
  return normalizeSuggestions(parsedJson, parsed);
}

async function refineSuggestion({ original, instruction }) {
  if (!instruction?.trim()) throw new Error('instruction is required.');
  const gen = getClient();
  const model = gen.getGenerativeModel({
    model: modelName(),
    systemInstruction: REFINE_SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema: REFINE_SCHEMA,
    },
  });
  const prompt = [
    `Target: ${original.target}`,
    'Original draft:',
    original.draft,
    '',
    'User instruction:',
    instruction.trim(),
  ].join('\n');
  const res = await model.generateContent(prompt);
  const text = res?.response?.text?.();
  if (!text) throw new Error('Gemini returned an empty response.');
  const parsedJson = JSON.parse(text);
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
// Session map
// ---------------------------------------------------------------------------

const TTL_MS = 60 * 60 * 1000;
const sessions = new Map();
function touch(s) {
  s.expiresAt = Date.now() + TTL_MS;
}
function evictExpired() {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) if (s.expiresAt < now) sessions.delete(id);
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
  evictExpired();
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
  const s = {
    id,
    original,
    working,
    jobDescription,
    targetRole,
    targetCompany,
    seniority,
    queue,
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
  };
  sessions.set(id, s);
  return {
    ...publicState(s),
    firstSuggestion: publicSuggestion(nextPending(s)),
  };
}

export function getTemplateSession(id) {
  evictExpired();
  return sessions.get(id) || null;
}

export function nextTemplateSuggestion(id) {
  const s = getTemplateSession(id);
  if (!s) {
    const e = new Error('Session not found or expired.');
    e.status = 404;
    throw e;
  }
  touch(s);
  const np = nextPending(s);
  if (!np) return { done: true, state: publicState(s) };
  return { done: false, suggestion: publicSuggestion(np), state: publicState(s) };
}

export async function decideTemplateSuggestion(id, { suggestionId, decision, editInstruction }) {
  const s = getTemplateSession(id);
  if (!s) {
    const e = new Error('Session not found or expired.');
    e.status = 404;
    throw e;
  }
  touch(s);
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
    if (sug.status === 'rejected') return respond({ result: 'rejected' });
    sug.status = 'rejected';
    if (wasApproved) replayApprovedQueue(s);
    return respond({ result: 'rejected' });
  }

  if (decision === 'edit') {
    const refined = await refineSuggestion({ original: sug, instruction: editInstruction });
    sug.draft = refined.draft;
    sug.previewText = refined.previewText;
    if (refined.reason) sug.reason = refined.reason;
    if (wasApproved) {
      replayApprovedQueue(s);
      return { result: 'refined-applied', next: publicSuggestion(sug), state: publicState(s) };
    }
    sug.status = 'pending';
    return { result: 'refined', next: publicSuggestion(sug), state: publicState(s) };
  }

  if (decision === 'approve') {
    if (wasApproved) return respond({ result: 'noop' });
    if (sug.status === 'pending') {
      try {
        applySuggestion(s.working, sug);
        sug.status = 'approved';
        return respond({ result: 'applied' });
      } catch (err) {
        sug.status = 'failed';
        sug.error = err.message;
        return respond({ result: 'failed', error: err.message });
      }
    }
    // rejected/failed → flip to approved + replay
    sug.status = 'approved';
    replayApprovedQueue(s);
    if (sug.status === 'failed') {
      return respond({ result: 'failed', error: sug.error });
    }
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
  const s = getTemplateSession(id);
  if (!s) {
    const e = new Error('Session not found or expired.');
    e.status = 404;
    throw e;
  }
  touch(s);
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
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}
