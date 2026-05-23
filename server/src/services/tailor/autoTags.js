import { normalizeTags } from '../../utils/tags.js';
import { stripLatex } from './texParser.js';

// A small denylist of words too generic to be useful resume tags. We let
// genuinely useful generic terms through (e.g. "backend", "frontend") and only
// strip the ones that are pure filler in nearly every JD.
const GENERIC = new Set([
  'experience','years','year','strong','solid','excellent','good','great',
  'work','team','teams','role','roles','job','jobs','candidate','candidates',
  'using','use','used','make','made','any','all','also','other','required',
  'preferred','plus','etc','including','include','includes','various','etc',
  'data','system','design','tech','stack','skills','skill',
]);

function skillsTokens(parsed) {
  const out = [];
  const skills = parsed?.sections?.skills?.skillsLines || [];
  for (const line of skills) {
    const values = stripLatex(line.args[1] || '');
    for (const token of values.split(/[,;]/)) {
      const t = token.trim();
      if (t && !GENERIC.has(t.toLowerCase())) out.push(t);
    }
  }
  return out;
}

function approvedAtsKeywords(session) {
  const out = [];
  if (!session?.queue) return out;
  for (const q of session.queue) {
    if (q.status !== 'approved') continue;
    for (const k of q.atsKeywords || []) {
      const kt = String(k).trim();
      if (kt && !GENERIC.has(kt.toLowerCase())) out.push(kt);
    }
  }
  return out;
}

function hintTokens(session) {
  const out = [];
  if (session?.targetRole) out.push(session.targetRole);
  if (session?.seniority) out.push(session.seniority);
  if (session?.targetCompany) out.push(session.targetCompany);
  return out;
}

/**
 * Build a clean, deduped list of resume tags from the resume content + the
 * tailoring session context. No extra AI call — pure hybrid of the skills
 * section, approved-suggestion ATS keywords, and target role/seniority/company.
 *
 * The result is normalised by the shared `normalizeTags` (lower-case, hyphenated,
 * capped at 10) so it slots straight into the existing `resumeStore` tag field
 * and the `/api/enrich/jd-match` flow.
 *
 * Sources are interleaved so each contributes proportionally even when one is
 * large — without that, the skills section would fill all 10 slots and the
 * JD-specific keywords would never land in the tags.
 */
export function extractAutoTags(parsed, session) {
  const skills = skillsTokens(parsed);
  const jd = approvedAtsKeywords(session);
  const hints = hintTokens(session);

  // Quotas before the 10-tag cap. Hints are small (role/seniority/company) and
  // usually high signal, so put them first. Then alternate skills and
  // JD-keywords so both populations land. The normaliser dedupes.
  const merged = [];
  for (const h of hints.slice(0, 3)) merged.push(h);
  const maxRound = Math.max(skills.length, jd.length);
  for (let i = 0; i < maxRound; i += 1) {
    if (i < skills.length) merged.push(skills[i]);
    if (i < jd.length) merged.push(jd[i]);
  }
  return normalizeTags(merged);
}
