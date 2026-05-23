import fs from 'node:fs/promises';
import path from 'node:path';

// Tokenize a LaTeX argument string starting AFTER the opening "{" of an
// already-located macro call. Returns { args: [...], end } where `end` is the
// index just past the closing "}" of the final argument. We deliberately do
// NOT try to parse all of LaTeX — only the well-known macros this resume
// template uses (\resumeItem, \ProjectItem, \resumeSubheading, etc.). Brace
// balancing is enough for those.
function readBracedArgs(src, openIdx, n) {
  const args = [];
  let i = openIdx;
  for (let a = 0; a < n; a += 1) {
    // Skip whitespace / newlines between args.
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src[i] !== '{') {
      return { args: null, end: i };
    }
    i += 1; // past "{"
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '\\') {
        // Skip the next char (escaped, e.g. \{, \}, \%, \&).
        i += 2;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      if (depth === 0) break;
      i += 1;
    }
    if (depth !== 0) return { args: null, end: i };
    args.push(src.slice(start, i));
    i += 1; // past "}"
  }
  return { args, end: i };
}

// Find every occurrence of a macro call `\name{...}{...}` with `arity` args.
// Returns array of { start, end, args }.
function findMacroCalls(src, name, arity) {
  const out = [];
  const needle = '\\' + name;
  let from = 0;
  while (from < src.length) {
    const idx = src.indexOf(needle, from);
    if (idx < 0) break;
    // Ensure the next char isn't a letter (avoid matching \resumeItemList when
    // we're looking for \resumeItem).
    const after = src[idx + needle.length];
    if (after && /[A-Za-z]/.test(after)) {
      from = idx + needle.length;
      continue;
    }
    const parsed = readBracedArgs(src, idx + needle.length, arity);
    if (parsed.args) {
      out.push({ start: idx, end: parsed.end, args: parsed.args });
      from = parsed.end;
    } else {
      from = idx + needle.length;
    }
  }
  return out;
}

// Strip LaTeX commands to get a rough plain-text version of a fragment.
// Good enough for token scoring and UI previews; not a real LaTeX renderer.
export function stripLatex(s) {
  if (!s) return '';
  return String(s)
    .replace(/\\href\{[^}]*\}\{([^}]*)\}/g, '$1')
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\textit\{([^}]*)\}/g, '$1')
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\emph\{([^}]*)\}/g, '$1')
    // Unescape common LaTeX specials. Do this BEFORE the catch-all macro strip
    // so we don't lose the character (the macro strip would eat the leading
    // backslash but the char itself stays — so "\&" already survives as "&"
    // post-strip; explicit replacements keep this robust for "\%", "\$" etc.).
    .replace(/\\([&%$_#{}])/g, '$1')
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/~+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SECTION_RE = /\\section\{\s*([^}]*)\}/;
function sectionTitleOf(raw) {
  const m = raw.match(SECTION_RE);
  if (!m) return null;
  return stripLatex(m[1]).toLowerCase();
}

function parseInputs(mainTex) {
  const inputs = [];
  // \input{sections/foo} — ignore lines starting with %
  const lines = mainTex.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.replace(/(^|[^\\])%.*$/, '$1'); // strip trailing comment
    const m = trimmed.match(/\\input\{\s*([^}]+?)\s*\}/);
    if (m) inputs.push(m[1]);
  }
  return inputs;
}

// Bullet detection per section: the resume uses \ProjectItem{...},
// \resumeItem{title}{body}, \resumeSubItem{title}{body}. We collect them all.
function collectBullets(raw) {
  const bullets = [];
  for (const c of findMacroCalls(raw, 'ProjectItem', 1)) {
    bullets.push({
      macro: 'ProjectItem',
      latex: raw.slice(c.start, c.end),
      args: c.args,
      text: stripLatex(c.args[0]),
      start: c.start,
      end: c.end,
    });
  }
  for (const c of findMacroCalls(raw, 'resumeSubItem', 2)) {
    bullets.push({
      macro: 'resumeSubItem',
      latex: raw.slice(c.start, c.end),
      args: c.args,
      text: `${stripLatex(c.args[0])}: ${stripLatex(c.args[1])}`,
      start: c.start,
      end: c.end,
    });
  }
  for (const c of findMacroCalls(raw, 'resumeItem', 2)) {
    bullets.push({
      macro: 'resumeItem',
      latex: raw.slice(c.start, c.end),
      args: c.args,
      text: `${stripLatex(c.args[0])}: ${stripLatex(c.args[1])}`,
      start: c.start,
      end: c.end,
    });
  }
  // De-dup nested matches (resumeSubItem wraps resumeItem — but we matched both
  // separately above). Drop any resumeItem whose range is wholly contained in a
  // resumeSubItem range.
  const subs = bullets.filter((b) => b.macro === 'resumeSubItem');
  const filtered = bullets.filter((b) => {
    if (b.macro !== 'resumeItem') return true;
    return !subs.some((s) => s.start <= b.start && s.end >= b.end);
  });
  filtered.sort((a, b) => a.start - b.start);
  return filtered;
}

// Identify subheadings (anchors) so the AI can target "this experience block".
function collectSubheadings(raw, sectionId) {
  const out = [];
  const specs = {
    experience: [
      { macro: 'experienceDeatils', arity: 5, nameArg: 0, dateArg: 2 },
      { macro: 'experienceDeatilsWithCert', arity: 6, nameArg: 0, dateArg: 2 },
    ],
    projects: [
      { macro: 'projectSubheading', arity: 4, nameArg: 0, dateArg: 3 },
      { macro: 'projectSubheadingLink', arity: 5, nameArg: 0, dateArg: 3 },
    ],
    education: [{ macro: 'resumeSubheading', arity: 4, nameArg: 0, dateArg: 3 }],
  };
  const list = specs[sectionId] || [];
  for (const spec of list) {
    for (const c of findMacroCalls(raw, spec.macro, spec.arity)) {
      out.push({
        macro: spec.macro,
        name: stripLatex(c.args[spec.nameArg]),
        date: spec.dateArg != null ? stripLatex(c.args[spec.dateArg]) : '',
        start: c.start,
        end: c.end,
      });
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

function inferSectionId(filename, raw) {
  const base = path.basename(filename, '.tex').toLowerCase();
  const known = [
    'summary',
    'skills',
    'experience',
    'projects',
    'education',
    'certifications',
    'coding',
    'coursework',
    'header',
  ];
  if (known.includes(base)) return base;
  const title = sectionTitleOf(raw);
  if (title?.includes('skill')) return 'skills';
  if (title?.includes('experience')) return 'experience';
  if (title?.includes('project')) return 'projects';
  if (title?.includes('education')) return 'education';
  if (title?.includes('certification')) return 'certifications';
  if (title?.includes('coding')) return 'coding';
  if (title?.includes('summary')) return 'summary';
  return base;
}

// The summary section is free prose, not a macro list. Extract the paragraph
// after \section{...SUMMARY...} up to the next blank line / next section.
function extractSummaryText(raw) {
  const m = raw.match(/\\section\{[^}]*\}\s*([\s\S]*?)(?:\n\s*\n|\\section\{|$)/);
  if (!m) return null;
  const body = m[1].trim();
  return { latex: body, text: stripLatex(body) };
}

/**
 * Read the resume folder and return a structured representation:
 * {
 *   cvRoot,
 *   mainTexPath,
 *   files: [...],            // resolved files in \input order, plus main.tex
 *   sections: {               // keyed by section id (summary/skills/etc.)
 *     summary: {
 *       id, file, raw, sectionTitle,
 *       summary: { latex, text },     // only for summary
 *       skillsLines: [{macro,args,latex,text,start,end}],  // only for skills
 *       bullets: [...],               // generic per-section bullets
 *       subheadings: [...],           // anchors for AI targeting
 *     }
 *   },
 *   plainText                  // flattened plain text of all sections
 * }
 */
export async function parseResume(cvRoot) {
  const abs = path.resolve(cvRoot);
  const mainTexPath = path.join(abs, 'main.tex');
  const mainTex = await fs.readFile(mainTexPath, 'utf8');
  const inputs = parseInputs(mainTex);

  const sections = {};
  const files = [{ rel: 'main.tex', abs: mainTexPath, raw: mainTex }];

  for (const input of inputs) {
    const rel = input.endsWith('.tex') ? input : `${input}.tex`;
    const fileAbs = path.join(abs, rel);
    let raw;
    try {
      raw = await fs.readFile(fileAbs, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    files.push({ rel, abs: fileAbs, raw });
    const id = inferSectionId(rel, raw);
    const section = {
      id,
      file: rel,
      abs: fileAbs,
      raw,
      sectionTitle: sectionTitleOf(raw) || id,
      bullets: collectBullets(raw),
      subheadings: collectSubheadings(raw, id),
    };
    if (id === 'summary') {
      section.summary = extractSummaryText(raw);
    }
    if (id === 'skills') {
      // skillsLines == every \resumeSubItem in the file
      section.skillsLines = section.bullets.filter((b) => b.macro === 'resumeSubItem');
    }
    sections[id] = section;
  }

  const plainText = buildPlainText(sections);
  return { cvRoot: abs, mainTexPath, files, sections, plainText };
}

function buildPlainText(sections) {
  const parts = [];
  for (const sec of Object.values(sections)) {
    parts.push(`# ${sec.sectionTitle}`);
    if (sec.id === 'summary' && sec.summary) parts.push(sec.summary.text);
    for (const sh of sec.subheadings || []) {
      parts.push(`## ${sh.name} (${sh.date})`);
    }
    for (const b of sec.bullets || []) {
      parts.push(`- ${b.text}`);
    }
  }
  return parts.join('\n');
}

// Re-read a single file from disk (used after texEditor mutates it so that
// subsequent suggestions see the latest state).
export async function refreshSection(parsed, sectionId) {
  const sec = parsed.sections[sectionId];
  if (!sec) return parsed;
  const raw = await fs.readFile(sec.abs, 'utf8');
  const next = {
    ...sec,
    raw,
    bullets: collectBullets(raw),
    subheadings: collectSubheadings(raw, sec.id),
  };
  if (sec.id === 'summary') next.summary = extractSummaryText(raw);
  if (sec.id === 'skills') {
    next.skillsLines = next.bullets.filter((b) => b.macro === 'resumeSubItem');
  }
  parsed.sections[sectionId] = next;
  parsed.plainText = buildPlainText(parsed.sections);
  // refresh the file cache too
  const fileEntry = parsed.files.find((f) => f.rel === sec.file);
  if (fileEntry) fileEntry.raw = raw;
  return parsed;
}
