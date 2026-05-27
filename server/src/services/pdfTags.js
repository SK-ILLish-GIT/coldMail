import { GoogleGenerativeAI } from '@google/generative-ai';

import { getGeminiModel } from './geminiModel.js';
import { normalizeTags } from '../utils/tags.js';

// Reuse the same Gemini config as the rest of the app.
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
        'Short, lowercase, hyphenated resume tags representing the strongest skills, technologies, domains, and role types in the PDF. 5-12 tags.',
    },
  },
  required: ['tags'],
};

const SYSTEM_PROMPT = `You read a candidate's resume PDF and emit a clean, lowercase, hyphenated tag list that describes their strongest skills, technologies, domains, and role types.

Hard rules:
1. 5-12 tags total. Aim for the most JD-matchable signals.
2. Each tag is lowercase, words joined by hyphens (e.g. "java-spring-boot", "distributed-systems", "backend").
3. Prefer concrete technologies and well-known stacks over filler words.
4. Skip generic filler like "team", "skills", "experience", "year", "candidate".
5. Output ONLY JSON matching the supplied schema. No prose, no markdown fences.`;

/**
 * Ask Gemini to summarise a resume PDF into a normalised tag list.
 * @param {Buffer} pdfBuffer
 * @param {string} mimeType  default 'application/pdf'
 * @returns {Promise<string[]>}
 */
export async function suggestTagsFromPdf(pdfBuffer, mimeType = 'application/pdf') {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error('PDF buffer is required.');
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

  // Gemini 2.5 Flash accepts PDFs natively via inlineData (base64).
  const res = await model.generateContent([
    {
      inlineData: {
        mimeType: mimeType || 'application/pdf',
        data: pdfBuffer.toString('base64'),
      },
    },
    {
      text: 'Read this resume PDF and produce the JSON tag list per the schema.',
    },
  ]);

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

export function isPdfTaggingEnabled() {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}
