import { generateStructuredJson, isLlmConfigured } from './llm.js';
import { normalizeTags } from '../utils/tags.js';

const TAG_SCHEMA = {
  type: 'object',
  properties: {
    tags: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Short, lowercase, hyphenated resume tags. Be thorough: include a separate tag for EVERY distinct technology, language, framework, library, database, and tool found in the PDF, plus domains and role types. Up to 25 tags.',
    },
  },
  required: ['tags'],
};

const SYSTEM_PROMPT = `You read a candidate's resume PDF and emit a clean, lowercase, hyphenated tag list that describes their strongest skills, technologies, domains, and role types.

Hard rules:
1. Be thorough — up to 25 tags. Prefer completeness over brevity.
2. CRITICAL: emit a SEPARATE tag for EVERY distinct technology, programming language, framework, library, database, cloud/platform, and tool found anywhere in the resume (skills section, experience bullets, projects). Do NOT merge multiple technologies into one tag, and do NOT skip any.
3. Each tag is lowercase, words joined by hyphens (e.g. "java-spring-boot", "distributed-systems", "backend", "react", "postgresql", "kubernetes").
4. In addition to the tech stack, also tag domains and role family/seniority where clear.
5. Skip generic filler like "team", "skills", "experience", "year", "candidate".
6. Output ONLY JSON matching the supplied schema. No prose, no markdown fences.`;

/**
 * Ask the configured AI provider to summarise a resume PDF into tags.
 * PDF uploads use Gemini when available (Groq does not support PDF input).
 */
export async function suggestTagsFromPdf(pdfBuffer, mimeType = 'application/pdf') {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error('PDF buffer is required.');
  }

  const parts = [
    {
      inlineData: {
        mimeType: mimeType || 'application/pdf',
        data: pdfBuffer.toString('base64'),
      },
    },
    {
      text: 'Read this resume PDF and produce the JSON tag list per the schema.',
    },
  ];

  const parsed = await generateStructuredJson({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: 'Read this resume PDF and produce the JSON tag list per the schema.',
    schema: TAG_SCHEMA,
    temperature: 0.2,
    parts,
  });

  if (!parsed || !Array.isArray(parsed.tags)) return [];
  return normalizeTags(parsed.tags);
}

export function isPdfTaggingEnabled() {
  return isLlmConfigured();
}
