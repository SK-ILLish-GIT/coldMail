import { createHash } from 'node:crypto';

// Shared "tailoredFor" metadata builder. The same shape is stored on saved
// resumes AND on saved tailored templates, so the library views can render a
// consistent pill ("Tailored for Stripe SDE · +14 ATS") and future features
// (compare, re-open, filter) can rely on a single schema.

const PREVIEW_CHARS = 140;

function shortHash(input) {
  return createHash('sha256').update(String(input || '').trim()).digest('hex').slice(0, 12);
}

function trimPreview(jd) {
  const flat = String(jd || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= PREVIEW_CHARS) return flat;
  return `${flat.slice(0, PREVIEW_CHARS - 1)}…`;
}

function countByStatus(queue, status) {
  if (!Array.isArray(queue)) return 0;
  return queue.filter((q) => q.status === status).length;
}

/**
 * Build the `tailoredFor` document fragment from a tailoring session.
 *
 * Works for both kinds of sessions:
 *  - Resume session (session.js)        — has `initialScores` + `currentScores`
 *  - Template session (templateTailor)  — no scores
 *
 * The returned object is small (≤ ~250 bytes) so embedding it in every saved
 * item is cheap.
 */
export function buildTailoredForMeta(session) {
  if (!session) return null;
  const jd = session.jobDescription || '';
  const meta = {
    jdHash: shortHash(jd),
    jdPreview: trimPreview(jd),
    role: session.targetRole || '',
    company: session.targetCompany || '',
    seniority: session.seniority || '',
    sessionId: session.id || '',
    appliedCount: countByStatus(session.queue, 'approved'),
    rejectedCount: countByStatus(session.queue, 'rejected'),
    savedAt: new Date().toISOString(),
  };
  // Score deltas are only meaningful for resumes (templates have no scoring).
  const initial = session.initialScores;
  const current = session.currentScores;
  if (initial && current) {
    meta.atsScoreInitial = initial.atsScore;
    meta.atsScoreFinal = current.atsScore;
    meta.jdMatchInitial = initial.jdMatchPct;
    meta.jdMatchFinal = current.jdMatchPct;
  }
  return meta;
}
