import { generateStructuredJson, isLlmConfigured } from '../llm.js';

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            description:
              'Which resume section this targets: one of summary, skills, experience, projects, certifications, coding.',
          },
          subheading: {
            type: 'string',
            description:
              'Name of the experience/project/education block to target. Leave empty for section-level edits like summary or skills.',
          },
          action: {
            type: 'string',
            description:
              'One of: replace_bullet, replace_summary, update_skills_line. You only rewrite text in place — never add new bullets or remove existing ones.',
          },
          targetBulletText: {
            type: 'string',
            description:
              'For replace_bullet: the plain-text of the existing bullet to replace (must match an existing bullet shown in the input). Empty for other actions.',
          },
          targetSkillsCategory: {
            type: 'string',
            description:
              'For update_skills_line: the existing skills category label whose value list should be rewritten (e.g. "DevOps & Observability"). The category label itself MUST be preserved exactly. Empty for other actions.',
          },
          draftLatex: {
            type: 'string',
            description:
              'The LaTeX fragment that replaces the targeted text. For replace_bullet, return the full macro call (e.g. \\ProjectItem{...}) using the SAME macro the original bullet used. For update_skills_line, return the full \\resumeSubItem{Category}{value list} call with the SAME category label as the original. For replace_summary, return the raw paragraph text without the \\section{} wrapper.',
          },
          previewText: {
            type: 'string',
            description:
              'Plain-text preview of the new content (no LaTeX). Will be shown to the user in the approval card.',
          },
          reason: {
            type: 'string',
            description: 'One-sentence rationale citing the JD requirement this addresses.',
          },
          atsKeywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'JD keywords this suggestion will introduce or strengthen.',
          },
          impact: {
            type: 'number',
            description: 'Impact 1 (minor) to 10 (high) on JD match.',
          },
        },
        required: ['section', 'action', 'draftLatex', 'previewText', 'reason', 'impact'],
      },
    },
  },
  required: ['suggestions'],
};

const REFINE_SCHEMA = {
  type: 'object',
  properties: {
    draftLatex: { type: 'string' },
    previewText: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['draftLatex', 'previewText'],
};

const PLAN_SYSTEM_PROMPT = `You are an expert resume tailoring assistant.

You receive a candidate's resume (parsed into sections + bullets) and a target Job Description (JD). You output an ordered list of high-impact, ATS-aware suggestions that improve the resume's match against the JD WITHOUT inventing experience the candidate does not have, and WITHOUT changing the resume's structure.

HARD RULES (non-negotiable):
1. CONTENT-ONLY. You may ONLY rewrite text that already exists in the resume. You MUST NOT add new bullets, remove existing bullets, or reorder anything. The macro structure (\\ProjectItem, \\resumeSubItem, etc.), section ordering, and overall layout stay byte-identical except for the inner text you rewrite.
2. SAME OR SHORTER. The plain-text length of every replacement should be no longer than the original it replaces. Prefer 5-15% shorter. Never go over the original by more than 10 characters.
3. NEVER fabricate companies, dates, certifications, technologies, or numbers that aren't already in the resume or directly implied by an existing bullet's wording.
4. Use the SAME LaTeX macro and macro arguments shape as the original:
    * If the original bullet is \\ProjectItem{...}, the replacement is \\ProjectItem{...}.
    * If the original is \\resumeSubItem{Category}{value list}, the replacement is \\resumeSubItem{<same Category>}{<new value list>} — the category label MUST be identical to the original.
    * For SUMMARY, return a single short paragraph (no \\section{} wrapper), at most 40 words.
5. Bullets stay under 25 words, start with a strong action verb, and where possible carry a number, %, or scale signal that was already in the candidate's original wording.
6. Escape LaTeX special characters in visible text: percent signs as \\%, ampersands as \\&.
7. Do not emit comments, \\href{} to fabricated URLs, or any new packages.
8. Output ONLY JSON matching the supplied schema. No prose, no markdown fences.

Return at most 12 suggestions, ordered most-impactful first. Only the three actions replace_bullet, replace_summary, update_skills_line are allowed.`;

const REFINE_SYSTEM_PROMPT = `You are revising a single resume-tailoring suggestion based on user feedback.

You receive: the original draft (LaTeX + plain preview), the section it targets, and a free-text instruction from the user. Produce a revised draft that follows the same LaTeX macro style as the original, respects the hard rules below, and stays focused on the user's instruction.

Hard rules:
- Do not invent companies, dates, certifications, or numbers.
- Match the original macro style (e.g. \\ProjectItem{...} stays \\ProjectItem{...}).
- Bullets stay under 30 words, start with a strong action verb where applicable.
- Escape LaTeX specials (% as \\%, & as \\&).
- Output ONLY JSON matching the schema. No markdown fences.`;

function buildResumeSummaryForPrompt(parsed) {
  const out = [];
  for (const sec of Object.values(parsed.sections)) {
    if (sec.id === 'header') continue;
    out.push(`### Section: ${sec.id} (${sec.sectionTitle})`);
    if (sec.id === 'summary' && sec.summary) {
      out.push(`SUMMARY_PARAGRAPH: ${sec.summary.text}`);
      continue;
    }
    if (sec.id === 'skills' && sec.skillsLines?.length) {
      for (const s of sec.skillsLines) {
        out.push(`SKILL_LINE: ${s.text}`);
      }
      continue;
    }
    if (sec.subheadings?.length) {
      for (const sh of sec.subheadings) {
        out.push(`SUBHEADING: ${sh.name} | date: ${sh.date}`);
      }
    }
    for (const b of sec.bullets) {
      out.push(`BULLET: ${b.text}`);
    }
  }
  return out.join('\n');
}

/**
 * Ask the configured AI provider for an ordered list of suggestions.
 */
export async function generateSuggestions(parsed, opts) {
  const {
    jobDescription,
    targetRole = '',
    targetCompany = '',
    seniority = '',
    tone = '',
  } = opts || {};
  if (!jobDescription || !jobDescription.trim()) {
    throw new Error('jobDescription is required.');
  }

  const userPrompt = [
    '# Resume',
    buildResumeSummaryForPrompt(parsed),
    '',
    '# Job Description',
    jobDescription.trim(),
    '',
    '# Hints',
    targetRole && `Target role: ${targetRole}`,
    targetCompany && `Target company: ${targetCompany}`,
    seniority && `Seniority: ${seniority}`,
    tone && `Preferred tone: ${tone}`,
  ]
    .filter(Boolean)
    .join('\n');

  const parsedJson = await generateStructuredJson({
    systemPrompt: PLAN_SYSTEM_PROMPT,
    userPrompt,
    schema: SUGGESTION_SCHEMA,
    temperature: 0.35,
  });
  return normalizeSuggestions(parsedJson);
}

function normalizeSuggestions(raw) {
  if (!raw || !Array.isArray(raw.suggestions)) {
    return { suggestions: [] };
  }
  const allowedSections = new Set([
    'summary','skills','experience','projects','certifications','coding','education',
  ]);
  const allowedActions = new Set([
    'replace_bullet','replace_summary','update_skills_line',
  ]);
  const cleaned = raw.suggestions
    .filter(
      (s) =>
        s &&
        typeof s.section === 'string' &&
        allowedSections.has(s.section) &&
        typeof s.action === 'string' &&
        allowedActions.has(s.action) &&
        typeof s.draftLatex === 'string' &&
        s.draftLatex.trim() &&
        typeof s.previewText === 'string'
    )
    .map((s) => ({
      section: s.section,
      subheading: typeof s.subheading === 'string' ? s.subheading : '',
      action: s.action,
      targetBulletText: typeof s.targetBulletText === 'string' ? s.targetBulletText : '',
      targetSkillsCategory:
        typeof s.targetSkillsCategory === 'string' ? s.targetSkillsCategory : '',
      draftLatex: s.draftLatex.trim(),
      previewText: s.previewText.trim(),
      reason: typeof s.reason === 'string' ? s.reason : '',
      atsKeywords: Array.isArray(s.atsKeywords)
        ? s.atsKeywords.map(String).slice(0, 8)
        : [],
      impact: Number.isFinite(s.impact) ? Math.max(1, Math.min(10, s.impact)) : 5,
    }));
  cleaned.sort((a, b) => b.impact - a.impact);
  return { suggestions: cleaned.slice(0, 12) };
}

/**
 * Refine a single suggestion based on user feedback.
 */
export async function refineSuggestion({ original, instruction }) {
  if (!original || typeof original !== 'object') {
    throw new Error('original suggestion is required.');
  }
  if (!instruction || !instruction.trim()) {
    throw new Error('instruction is required.');
  }

  const userPrompt = [
    `Section: ${original.section}`,
    original.subheading && `Subheading: ${original.subheading}`,
    `Action: ${original.action}`,
    '',
    'Original LaTeX draft:',
    original.draftLatex,
    '',
    'Original preview:',
    original.previewText,
    '',
    'User instruction:',
    instruction.trim(),
  ]
    .filter(Boolean)
    .join('\n');

  const parsedJson = await generateStructuredJson({
    systemPrompt: REFINE_SYSTEM_PROMPT,
    userPrompt,
    schema: REFINE_SCHEMA,
    temperature: 0.3,
  });

  if (
    !parsedJson ||
    typeof parsedJson.draftLatex !== 'string' ||
    !parsedJson.draftLatex.trim()
  ) {
    throw new Error('Refined draft missing draftLatex.');
  }
  return {
    draftLatex: parsedJson.draftLatex.trim(),
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

export function isGeminiConfigured() {
  return isLlmConfigured();
}
