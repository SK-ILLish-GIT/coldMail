import { GoogleGenerativeAI } from '@google/generative-ai';

import { getGeminiModel } from './geminiModel.js';
import { normalizeTags } from '../utils/tags.js';

// Mirrors pdfTags.js. Kept as its own client so resume and template flows
// share the same Gemini config but can evolve their prompts independently.
let cachedClient = null;
function getClient() {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) {
    const err = new Error('GEMINI_API_KEY is not configured on the server.');
    err.status = 503;
    throw err;
  }
  if (!cachedClient) cachedClient = new GoogleGenerativeAI(key);
  return cachedClient;
}

const TAG_SCHEMA = {
  type: 'object',
  properties: {
    tags: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Short, lowercase, hyphenated email-template tags representing the role types, technologies, seniority, and target audience this template fits. 4-10 tags.',
    },
  },
  required: ['tags'],
};

const SYSTEM_PROMPT = `You read a cold-outreach email template (subject + HTML/plain body) and emit a clean, lowercase, hyphenated tag list that describes WHO this template targets and WHAT roles it fits — so it can later be auto-matched to job descriptions.

Hard rules:
1. 4-10 tags total. Aim for high-signal, JD-matchable terms.
2. Each tag is lowercase, words joined by hyphens (e.g. "backend", "java-spring-boot", "entry-level", "microsoft", "react", "data-platform").
3. Tags should describe one or more of: role family (backend/frontend/fullstack/data/ml/devops/sre/...), key technologies, target seniority, target company or industry if explicitly mentioned, and template intent ("cold-outreach", "referral-ask", "follow-up") only when clearly applicable.
4. Skip filler/personal-name/handlebars tokens (e.g. "{{company}}", "hello", "sk-sahil", "name", "subject").
5. Do not invent technologies that are not implied by the template text.
6. Output ONLY JSON matching the supplied schema. No prose, no markdown fences.`;

function stripHtml(input) {
  return String(input || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPrompt({ subject, body, tags }) {
  const lines = [];
  lines.push('# Subject');
  lines.push(String(subject || '').trim() || '(empty)');
  lines.push('');
  lines.push('# Body (plain text)');
  const plain = stripHtml(body).slice(0, 6000); // hard cap to keep token usage predictable
  lines.push(plain || '(empty)');
  if (Array.isArray(tags) && tags.length) {
    lines.push('');
    lines.push('# Existing tags (consider keeping these if still relevant)');
    lines.push(tags.join(', '));
  }
  return lines.join('\n');
}

/**
 * Ask Gemini to summarise a template's subject + body into a normalised tag
 * list. Stateless — the caller decides what to do with the returned tags.
 *
 * @param {{ subject?: string; body?: string; tags?: string[] }} input
 * @returns {Promise<string[]>}
 */
export async function suggestTagsForTemplate(input) {
  const subject = String(input?.subject || '').trim();
  const body = String(input?.body || '');
  if (!subject && !body.trim()) {
    throw new Error('subject or body is required to suggest tags.');
  }
  const gen = getClient();
  const model = gen.getGenerativeModel({
    model: getGeminiModel(),
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: TAG_SCHEMA,
    },
  });

  const res = await model.generateContent(buildPrompt({ subject, body, tags: input?.tags }));
  const text = res?.response?.text?.();
  if (!text) throw new Error('Gemini returned an empty response.');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned non-JSON content for tags.');
  }
  if (!parsed || !Array.isArray(parsed.tags)) return [];
  return normalizeTags(parsed.tags);
}

export function isTemplateTaggingEnabled() {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}
