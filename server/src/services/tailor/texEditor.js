import fs from 'node:fs/promises';
import path from 'node:path';

import { stripLatex, refreshSection } from './texParser.js';

// How much longer (compared to the original plain-text) a replacement is
// allowed to be. We accept the LARGER of these two bounds so short bullets
// don't get blocked by a tight % limit and long bullets don't get a free pass
// from a tiny absolute limit.
const LENGTH_GROWTH_ABS = 20; // characters
const LENGTH_GROWTH_PCT = 0.15; // 15%

function lengthBudget(originalText) {
  const n = (originalText || '').length;
  return Math.max(LENGTH_GROWTH_ABS, Math.ceil(n * LENGTH_GROWTH_PCT));
}

// Parse `\macroName{arg1}{arg2}...` from the start of `fragment` and return the
// macro's name plus the brace-balanced arguments. Returns null if `fragment`
// doesn't start with a macro call we recognize.
function parseLeadingMacro(fragment) {
  if (!fragment) return null;
  const trimmed = fragment.replace(/^\s+/, '');
  const m = trimmed.match(/^\\([a-zA-Z]+)\*?/);
  if (!m) return null;
  const name = m[1];
  let i = m[0].length;
  const args = [];
  while (i < trimmed.length) {
    // Skip whitespace between args.
    while (i < trimmed.length && /\s/.test(trimmed[i])) i += 1;
    if (trimmed[i] !== '{') break;
    i += 1; // past "{"
    const start = i;
    let depth = 1;
    while (i < trimmed.length && depth > 0) {
      const ch = trimmed[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      if (depth === 0) break;
      i += 1;
    }
    if (depth !== 0) return null;
    args.push(trimmed.slice(start, i));
    i += 1; // past "}"
  }
  return { name, args };
}

// Sanity check that the fragment we're about to write looks like reasonable
// LaTeX. We're not parsing LaTeX, just checking that we won't trivially break
// the document.
function validateFragment(fragment) {
  if (!fragment || typeof fragment !== 'string') {
    throw new Error('Empty LaTeX fragment.');
  }
  // Count unescaped braces.
  let depth = 0;
  for (let i = 0; i < fragment.length; i += 1) {
    const ch = fragment[i];
    if (ch === '\\') {
      i += 1; // skip next char
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth < 0) throw new Error('Unbalanced braces in LaTeX fragment.');
  }
  if (depth !== 0) throw new Error('Unbalanced braces in LaTeX fragment.');
  // Disallow obviously dangerous control sequences that could break the doc.
  const dangerous = [/\\documentclass/, /\\usepackage/, /\\begin\{document\}/, /\\end\{document\}/, /\\input\{/];
  for (const re of dangerous) {
    if (re.test(fragment)) {
      throw new Error('LaTeX fragment contains forbidden control sequence.');
    }
  }
  // Disallow stray unescaped percent that would comment out the rest of a line
  // in the middle of a bullet body. We allow `\%`.
  // (Heuristic: scan char by char.)
  for (let i = 0; i < fragment.length; i += 1) {
    if (fragment[i] === '%' && fragment[i - 1] !== '\\') {
      throw new Error('LaTeX fragment contains an unescaped percent sign.');
    }
  }
  return true;
}

async function snapshotIfNeeded(touchedSet, absPath) {
  if (touchedSet.has(absPath)) return;
  const bak = `${absPath}.bak`;
  try {
    await fs.access(bak);
  } catch {
    const raw = await fs.readFile(absPath, 'utf8');
    await fs.writeFile(bak, raw, 'utf8');
  }
  touchedSet.add(absPath);
}

async function atomicWrite(absPath, contents) {
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, contents, 'utf8');
  await fs.rename(tmp, absPath);
}

function replaceBulletByText(raw, sectionBullets, targetText) {
  if (!targetText) return null;
  const norm = stripLatex(targetText).toLowerCase().slice(0, 80);
  const match = sectionBullets.find(
    (b) => stripLatex(b.text).toLowerCase().slice(0, 80) === norm
  );
  if (!match) {
    // Try a looser contains match.
    const loose = sectionBullets.find((b) =>
      stripLatex(b.text).toLowerCase().includes(norm)
    );
    if (!loose) return null;
    return loose;
  }
  return match;
}

function replaceSkillsLineByCategory(skillsLines, category) {
  if (!category) return null;
  const norm = category.trim().toLowerCase();
  return (
    skillsLines.find((s) => stripLatex(s.args[0]).toLowerCase() === norm) ||
    skillsLines.find((s) =>
      stripLatex(s.args[0]).toLowerCase().includes(norm)
    )
  );
}

function replaceSummaryParagraph(raw, newParagraph) {
  // Find \section{...} using brace-balanced matching since the title itself
  // contains nested macros (e.g. \section{\large \textbf{SUMMARY}}).
  const sectionStart = raw.search(/\\section\b/);
  if (sectionStart < 0) return null;
  // Locate the opening brace right after \section.
  let i = sectionStart + '\\section'.length;
  // Skip optional star or whitespace.
  while (i < raw.length && /[\s*]/.test(raw[i])) i += 1;
  if (raw[i] !== '{') return null;
  i += 1;
  let depth = 1;
  while (i < raw.length && depth > 0) {
    const ch = raw[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  if (depth !== 0) return null;
  // i is now just after the closing } of \section{...}.
  const headerEnd = i;
  // Skip whitespace/newlines.
  let bodyStart = headerEnd;
  while (bodyStart < raw.length && /[ \t\r\n]/.test(raw[bodyStart])) bodyStart += 1;
  // Body ends at next blank line, next \section, or EOF.
  let bodyEnd = bodyStart;
  while (bodyEnd < raw.length) {
    if (raw.startsWith('\\section', bodyEnd)) break;
    if (raw[bodyEnd] === '\n') {
      // Look ahead for blank line.
      let j = bodyEnd + 1;
      while (j < raw.length && /[ \t]/.test(raw[j])) j += 1;
      if (j < raw.length && raw[j] === '\n') break;
    }
    bodyEnd += 1;
  }
  const before = raw.slice(0, headerEnd);
  const after = raw.slice(bodyEnd);
  const separator = before.endsWith('\n') ? '' : '\n';
  return `${before}${separator}${newParagraph.trim()}\n${after}`;
}

/**
 * Apply one approved suggestion to disk.
 *
 * @param {object} parsed         current parseResume() output
 * @param {object} suggestion     normalized suggestion (see gemini.js)
 * @param {Set<string>} touchedSet  set of absolute file paths already snapshotted in this session
 * @returns {Promise<{file: string, action: string, ok: true}>}
 */
export async function applySuggestion(parsed, suggestion, touchedSet) {
  const section = parsed.sections[suggestion.section];
  if (!section) {
    throw new Error(`Section "${suggestion.section}" not found in resume.`);
  }
  const absPath = section.abs;
  validateFragment(suggestion.draftLatex);

  let raw = await fs.readFile(absPath, 'utf8');
  let next = null;

  if (suggestion.action === 'replace_bullet') {
    const target = replaceBulletByText(
      raw,
      section.bullets,
      suggestion.targetBulletText
    );
    if (!target) {
      throw new Error(
        `Could not locate the original bullet to replace ("${(suggestion.targetBulletText || '').slice(0, 60)}...").`
      );
    }
    // GUARD 1: replacement must use the same LaTeX macro and same arity.
    const originalMacro = parseLeadingMacro(target.latex);
    const newMacro = parseLeadingMacro(suggestion.draftLatex);
    if (!newMacro || !originalMacro) {
      throw new Error('Replacement does not start with a recognizable macro call.');
    }
    if (newMacro.name !== originalMacro.name) {
      throw new Error(
        `Format change blocked: original macro is \\${originalMacro.name} but replacement uses \\${newMacro.name}. Only the inner text may change.`
      );
    }
    if (newMacro.args.length !== originalMacro.args.length) {
      throw new Error(
        `Format change blocked: \\${originalMacro.name} expects ${originalMacro.args.length} argument(s) but replacement has ${newMacro.args.length}.`
      );
    }
    // GUARD 2: replacement plain-text length must be similar to the original.
    const origText = stripLatex(target.latex);
    const newText = stripLatex(suggestion.draftLatex);
    const allowed = origText.length + lengthBudget(origText);
    if (newText.length > allowed) {
      throw new Error(
        `Length cap exceeded: original ${origText.length} chars, replacement ${newText.length} chars (max allowed ${allowed}). Ask the model to shorten.`
      );
    }
    next = `${raw.slice(0, target.start)}${suggestion.draftLatex}${raw.slice(target.end)}`;
  } else if (suggestion.action === 'update_skills_line') {
    if (suggestion.section !== 'skills') {
      throw new Error('update_skills_line only valid in the skills section.');
    }
    const target = replaceSkillsLineByCategory(
      section.skillsLines || [],
      suggestion.targetSkillsCategory
    );
    if (!target) {
      throw new Error(
        `Could not locate skills category "${suggestion.targetSkillsCategory}".`
      );
    }
    // GUARD: same macro, same category label, similar length.
    const originalMacro = parseLeadingMacro(target.latex);
    const newMacro = parseLeadingMacro(suggestion.draftLatex);
    if (!newMacro || newMacro.name !== originalMacro?.name) {
      throw new Error(
        `Format change blocked: skills line must stay \\${originalMacro?.name || 'resumeSubItem'}.`
      );
    }
    if (
      newMacro.args.length !== originalMacro.args.length ||
      stripLatex(newMacro.args[0]).trim() !== stripLatex(originalMacro.args[0]).trim()
    ) {
      throw new Error(
        `Format change blocked: skills category label must stay "${stripLatex(originalMacro.args[0]).trim()}". Only the value list may change.`
      );
    }
    const origText = stripLatex(target.latex);
    const newText = stripLatex(suggestion.draftLatex);
    const allowed = origText.length + lengthBudget(origText);
    if (newText.length > allowed) {
      throw new Error(
        `Length cap exceeded: skills line was ${origText.length} chars, replacement ${newText.length} chars (max allowed ${allowed}).`
      );
    }
    next = `${raw.slice(0, target.start)}${suggestion.draftLatex}${raw.slice(target.end)}`;
  } else if (suggestion.action === 'replace_summary') {
    if (suggestion.section !== 'summary') {
      throw new Error('replace_summary only valid in the summary section.');
    }
    // GUARD: summary plain-text length must be similar to the original.
    const origSummary = section.summary?.text || '';
    const newText = stripLatex(suggestion.draftLatex);
    if (origSummary) {
      const allowed = origSummary.length + lengthBudget(origSummary);
      if (newText.length > allowed) {
        throw new Error(
          `Length cap exceeded: summary was ${origSummary.length} chars, replacement ${newText.length} chars (max allowed ${allowed}).`
        );
      }
    }
    next = replaceSummaryParagraph(raw, suggestion.draftLatex);
    if (next == null) {
      throw new Error('Could not locate summary paragraph to replace.');
    }
  } else {
    throw new Error(`Unsupported action "${suggestion.action}".`);
  }

  // Final brace-balance sanity check on the whole new file.
  validateWholeFileBraces(next, absPath);

  await snapshotIfNeeded(touchedSet, absPath);
  await atomicWrite(absPath, next);
  await refreshSection(parsed, suggestion.section);

  return {
    file: section.file,
    action: suggestion.action,
    ok: true,
  };
}

function validateWholeFileBraces(text, absPath) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '%') {
      // Skip to end of line (LaTeX comment).
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth < 0) {
      throw new Error(
        `Edit would produce unbalanced braces in ${path.basename(absPath)} (depth < 0).`
      );
    }
  }
  if (depth !== 0) {
    throw new Error(
      `Edit would produce unbalanced braces in ${path.basename(absPath)} (depth=${depth}).`
    );
  }
}

/**
 * Restore every .bak file in touchedSet to its original location, then clear
 * the set. Returns list of restored files.
 */
export async function rollbackAll(touchedSet) {
  const restored = [];
  for (const absPath of touchedSet) {
    const bak = `${absPath}.bak`;
    try {
      const raw = await fs.readFile(bak, 'utf8');
      await atomicWrite(absPath, raw);
      await fs.unlink(bak).catch(() => {});
      restored.push(absPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  touchedSet.clear();
  return restored;
}
