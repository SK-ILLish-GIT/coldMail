// Tag normalisation shared across resumes and templates.
// Tags are short, lower-case, machine-friendly labels (e.g. "backend",
// "java", "golang", "sre"). We deliberately constrain the character set
// so the same tag typed two different ways collapses to one canonical form
// and can be safely compared with === / Set membership.

const MAX_TAGS = 25;
const MAX_TAG_LEN = 24;

// First char must be a letter or digit; rest can include letters/digits and
// a small set of common separators. No spaces — they encourage typos.
const VALID_TAG = /^[a-z0-9][a-z0-9+./_-]*$/;

/**
 * Normalise user input into a clean, deduped string[].
 * Accepts an array OR a comma/newline-separated string.
 *
 * @param {unknown} input
 * @returns {string[]}
 */
export function normalizeTags(input) {
  if (input == null) return [];
  const arr = Array.isArray(input) ? input : String(input).split(/[,\n]+/);
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const t = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .slice(0, MAX_TAG_LEN);
    if (!t || !VALID_TAG.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
