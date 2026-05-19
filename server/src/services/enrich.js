import { resolveMx } from 'node:dns/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
  const modelName = (process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim();
  const gen = getClient();
  const model = gen.getGenerativeModel({
    model: modelName,
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
