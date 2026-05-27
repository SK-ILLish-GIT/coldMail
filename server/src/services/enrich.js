import { resolveMx } from 'node:dns/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';

import { getGeminiModel } from './geminiModel.js';

let client = null;

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
  if (!client) client = new GoogleGenerativeAI(getKey());
  return client;
}

export function isEnrichmentEnabled() {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}

// --- Tiny in-memory TTL cache keyed by company|domain ---
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

// --- Helpers ---
function slug(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function applyPattern(pattern, { first, last, domain }) {
  return pattern
    .replace(/\{first\}/gi, first)
    .replace(/\{last\}/gi, last)
    .replace(/\{f\}/gi, first.charAt(0))
    .replace(/\{l\}/gi, last.charAt(0))
    .replace(/\{domain\}/gi, domain)
    .toLowerCase()
    .trim();
}

async function hasMx(domain) {
  if (!domain) return false;
  try {
    const records = await resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

// --- Gemini structured-output schema (OpenAPI 3.0 subset) ---
const PATTERN_SCHEMA = {
  type: 'object',
  properties: {
    domain: {
      type: 'string',
      description: 'Best-guess primary email domain for the company (e.g. acme.com)',
    },
    patterns: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description:
              'Pattern using tokens {first}, {last}, {f}, {l}, {domain}. Example: {first}.{last}@{domain}',
          },
          confidence: {
            type: 'number',
            description:
              'Probability the pattern matches (0..1). Only well-known public conventions may exceed 0.7; speculative guesses must score lower.',
          },
          reasoning: {
            type: 'string',
            description: 'One short sentence explaining why this pattern is likely.',
          },
        },
        required: ['pattern', 'confidence', 'reasoning'],
      },
    },
  },
  required: ['domain', 'patterns'],
};

const SYSTEM_PROMPT = `You are an expert on B2B email naming conventions.
Given a company name (and optionally a known domain), output the 5 most likely email address PATTERNS used by employees there, ranked most-likely first.

Rules:
- Use only these tokens in patterns: {first}, {last}, {f}, {l}, {domain}.
- Calibrate confidence honestly. Only well-known, publicly-documented conventions may exceed 0.7. Speculative guesses must be below 0.6.
- "domain" must be the primary corporate email domain (often the company's main website domain). If the user provided one, use it.
- Always provide exactly 5 patterns even if confidence is low.
- Return ONLY the JSON object matching the provided schema, with no markdown fences or commentary.`;

// --- Validation: defensive parse of the model output ---
function validateModelOutput(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Gemini returned a non-object response.');
  }
  if (typeof raw.domain !== 'string') {
    throw new Error('Gemini response missing "domain".');
  }
  if (!Array.isArray(raw.patterns) || raw.patterns.length === 0) {
    throw new Error('Gemini response missing "patterns" array.');
  }
  const cleaned = raw.patterns
    .filter(
      (p) =>
        p &&
        typeof p.pattern === 'string' &&
        typeof p.confidence === 'number' &&
        typeof p.reasoning === 'string'
    )
    .map((p) => ({
      pattern: p.pattern,
      confidence: Math.max(0, Math.min(1, p.confidence)),
      reasoning: p.reasoning,
    }));
  if (cleaned.length === 0) {
    throw new Error('Gemini response had no usable patterns.');
  }
  return { domain: raw.domain, patterns: cleaned };
}

async function callGemini({ company, domain }) {
  const gen = getClient();
  const model = gen.getGenerativeModel({
    model: getGeminiModel(),
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: PATTERN_SCHEMA,
    },
  });

  const userPrompt = domain
    ? `Company: "${company}". Known domain: "${domain}".`
    : `Company: "${company}". Domain: unknown — infer the most likely primary email domain.`;

  const result = await model.generateContent(userPrompt);
  const text = result?.response?.text?.();
  if (!text) throw new Error('Gemini returned an empty response.');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned non-JSON content.');
  }
  return validateModelOutput(parsed);
}

// ===========================================================================
// Reverse direction: given email addresses, infer the recipient's full name.
// Used by the "By MailID" compose mode.
// ===========================================================================

const NAMES_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          name: {
            type: 'string',
            description:
              'Likely Full Name title-cased. Empty string if local-part is generic (sales, info, hr, support, admin, team, hello, noreply).',
          },
        },
        required: ['email', 'name'],
      },
    },
  },
  required: ['candidates'],
};

const NAMES_SYSTEM_PROMPT = `You infer a person's full name from the local-part of an email address.

Rules:
- Recognise common conventions: "first.last@", "f.last@", "firstlast@", "first_last@", "firstname@".
- Strip digits, plus-addressing suffixes, and obvious noise.
- Title-case the result.
- If the local-part is a generic alias (sales, info, contact, hr, support, admin, team, hello, noreply, no-reply, careers, jobs, billing), return an empty string for name.
- Return EXACTLY one entry per input email, preserving the input order.
- Return ONLY JSON matching the provided schema; no markdown, no commentary.`;

function algoExtractName(email) {
  const local = String(email || '').split('@')[0]?.split('+')[0] ?? '';
  if (!local) return '';
  const generic = new Set([
    'sales', 'info', 'contact', 'hr', 'support', 'admin', 'team', 'hello',
    'noreply', 'no-reply', 'careers', 'jobs', 'billing', 'accounts',
  ]);
  const tokens = local
    .split(/[._-]+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^\d+$/.test(s));
  if (!tokens.length) return '';
  if (tokens.length === 1 && generic.has(tokens[0].toLowerCase())) return '';
  return tokens
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Use Gemini to extract a likely Full Name from each email's local-part.
 * Falls back to a deterministic algorithmic split when the model returns
 * an empty or malformed answer for a row.
 *
 * @param {{ emails: string[], company: string }} input
 * @returns {Promise<Array<{ email: string, name: string }>>}
 */
export async function extractNamesFromEmails({ emails, company }) {
  const gen = getClient();
  const model = gen.getGenerativeModel({
    model: getGeminiModel(),
    systemInstruction: NAMES_SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: NAMES_SCHEMA,
    },
  });

  const userPrompt = `Company: "${company}".\nEmails:\n${emails
    .map((e, i) => `${i + 1}. ${e}`)
    .join('\n')}`;

  const result = await model.generateContent(userPrompt);
  const text = result?.response?.text?.();
  if (!text) throw new Error('Gemini returned an empty response.');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned non-JSON content.');
  }
  if (!parsed?.candidates || !Array.isArray(parsed.candidates)) {
    throw new Error('Gemini response missing candidates array.');
  }

  // Build email->name map (case-insensitive lookup), then return in input order.
  const map = new Map();
  for (const c of parsed.candidates) {
    if (typeof c?.email === 'string' && typeof c?.name === 'string') {
      map.set(c.email.trim().toLowerCase(), c.name.trim());
    }
  }
  return emails.map((email) => {
    const aiName = map.get(email.trim().toLowerCase());
    return { email, name: aiName || algoExtractName(email) };
  });
}

// ===========================================================================
// JD matcher: given a Job Description and the user's template+resume library
// (id, name, tags only — no body/file bytes sent to the model), pick the
// best-fit template and resume. Empty string = "no good match".
// ===========================================================================

const JD_MATCH_SCHEMA = {
  type: 'object',
  properties: {
    templateId: {
      type: 'string',
      description:
        'The id of the best-fit template, copied EXACTLY from the input list. Empty string if nothing reasonably matches.',
    },
    resumeId: {
      type: 'string',
      description:
        'The id of the best-fit resume, copied EXACTLY from the input list. Empty string if nothing reasonably matches.',
    },
    reasoning: {
      type: 'string',
      description:
        'One short sentence explaining the picks. Reference tags or names that drove the choice.',
    },
  },
  required: ['templateId', 'resumeId', 'reasoning'],
};

const JD_MATCH_SYSTEM_PROMPT = `You are helping a candidate match a job description to the right cold-email template and the right resume from their personal library.

You receive:
- A Job Description (JD)
- A list of available email templates: each has id, name, and tags
- A list of available resumes: each has id, name, and tags

Pick the best-fit template AND the best-fit resume by reasoning about:
- Tags are the strongest signal (e.g. JD mentions "backend Java" -> prefer items tagged "backend" or "java").
- Names are a weaker signal but useful when tags are empty.
- If nothing reasonably matches in a category, return an EMPTY STRING for that id; do not guess.
- Always copy ids verbatim from the input lists.

Return ONLY JSON matching the schema. No markdown, no commentary outside the JSON.`;

function summariseList(items) {
  return items.map((it) => ({
    id: it.id,
    name: it.name || '',
    tags: Array.isArray(it.tags) ? it.tags : [],
  }));
}

/**
 * Ask Gemini to match a JD to one template + one resume from the user's library.
 * Returns { templateId, resumeId, reasoning }. Either id can be empty string.
 *
 * @param {{ jobDescription: string, templates: Array, resumes: Array }} input
 */
export async function matchJobDescription({ jobDescription, templates, resumes }) {
  const gen = getClient();
  const model = gen.getGenerativeModel({
    model: getGeminiModel(),
    systemInstruction: JD_MATCH_SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: JD_MATCH_SCHEMA,
    },
  });

  const userPrompt = [
    'Job Description:',
    '"""',
    jobDescription.trim(),
    '"""',
    '',
    'Available templates:',
    JSON.stringify(summariseList(templates), null, 2),
    '',
    'Available resumes:',
    JSON.stringify(summariseList(resumes), null, 2),
  ].join('\n');

  const result = await model.generateContent(userPrompt);
  const text = result?.response?.text?.();
  if (!text) throw new Error('Gemini returned an empty response.');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned non-JSON content.');
  }
  if (typeof parsed?.templateId !== 'string' || typeof parsed?.resumeId !== 'string') {
    throw new Error('Gemini response missing required fields.');
  }

  // Defensive: ensure ids actually exist in the input lists; drop bogus ones.
  const tIds = new Set(templates.map((t) => t.id));
  const rIds = new Set(resumes.map((r) => r.id));
  return {
    templateId: tIds.has(parsed.templateId) ? parsed.templateId : '',
    resumeId: rIds.has(parsed.resumeId) ? parsed.resumeId : '',
    reasoning: String(parsed.reasoning || '').slice(0, 400),
  };
}

/**
 * Find 5 candidate email addresses for a person at a company.
 *
 * @param {{ firstName: string, lastName: string, company: string, domain?: string }} input
 * @returns {Promise<{ domain: string, mxValid: boolean, candidates: Array, threshold: number }>}
 */
export async function findEmailCandidates({ firstName, lastName, company, domain }) {
  const first = slug(firstName);
  const last = slug(lastName);
  const inputDomain = domain ? domain.trim().toLowerCase() : '';
  const cacheKey = `${company.trim().toLowerCase()}|${inputDomain}`;

  let model = cacheGet(cacheKey);
  if (!model) {
    model = await callGemini({ company: company.trim(), domain: inputDomain });
    cacheSet(cacheKey, model);
  }

  const resolvedDomain = (inputDomain || model.domain || '').toLowerCase().trim();
  const mxValid = await hasMx(resolvedDomain);

  // Apply patterns + dedupe by resolved email (keep highest confidence).
  const seen = new Map();
  for (const p of model.patterns) {
    const email = applyPattern(p.pattern, { first, last, domain: resolvedDomain });
    if (!email.includes('@')) continue;
    const existing = seen.get(email);
    if (!existing || p.confidence > existing.confidence) {
      seen.set(email, {
        email,
        pattern: p.pattern,
        confidence: p.confidence,
        reasoning: p.reasoning,
        mxValid,
      });
    }
  }

  const candidates = [...seen.values()].sort((a, b) => b.confidence - a.confidence);
  const threshold = Number(process.env.ENRICH_CONFIDENCE_THRESHOLD) || 0.5;

  return { domain: resolvedDomain, mxValid, candidates, threshold };
}
