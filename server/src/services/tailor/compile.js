import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

import { parseResume } from './texParser.js';

// texlive.net is a public LaTeX-as-a-service maintained by Norbert Preining.
// Same backend that powers the "compile" button on tex.stackexchange.com.
// The CGI endpoint accepts multipart/form-data with paired filename[]/filecontents[]
// fields and returns either the compiled PDF (return=pdf) or the log (return=log).
const DEFAULT_URL =
  process.env.TEXLIVE_NET_URL || 'https://texlive.net/cgi-bin/latexcgi';

function url() {
  return (process.env.TEXLIVE_NET_URL || DEFAULT_URL).trim();
}

// Recursively collect every file from the CV root, preserving paths relative
// to the root. We send the entire tree so includegraphics + \input both work.
async function collectAllFiles(cvRoot) {
  const root = path.resolve(cvRoot);
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip dotfiles, .bak snapshots, and the tmp files atomicWrite creates.
      if (entry.name.startsWith('.')) continue;
      if (entry.name.endsWith('.bak')) continue;
      if (entry.name.includes('.tmp-')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(root, full).replace(/\\/g, '/');
        const buf = await fs.readFile(full);
        out.push({ rel, buf });
      }
    }
  }
  await walk(root);
  return out;
}

// We need main.tex to be the FIRST file (texlive.net compiles the first file
// in the filename[] list).
function reorderMainFirst(files) {
  const idx = files.findIndex((f) => f.rel === 'main.tex');
  if (idx <= 0) return files;
  const [main] = files.splice(idx, 1);
  files.unshift(main);
  return files;
}

// texlive.net rejects filenames containing "/" — all uploaded files live in a
// flat directory. We rename every file to its basename and rewrite the
// \input{sections/foo} references in main.tex so they resolve to the flat
// names. We also rename main.tex → document.tex because the service explicitly
// requires the root file to be named "document.tex". Conflicting basenames
// (rare for resumes) get a numeric suffix.
function flattenForTexlive(files) {
  const used = new Set();
  const flatMap = new Map(); // old rel -> new flat name
  for (const f of files) {
    let base =
      f.rel === 'main.tex' ? 'document.tex' : path.basename(f.rel);
    if (used.has(base)) {
      const ext = path.extname(base);
      const stem = base.slice(0, base.length - ext.length);
      let n = 1;
      while (used.has(`${stem}-${n}${ext}`)) n += 1;
      base = `${stem}-${n}${ext}`;
    }
    used.add(base);
    flatMap.set(f.rel, base);
  }
  // Rewrite \input{path/to/foo} (with or without .tex) in every text file to
  // use the new flat basename. We also handle \includegraphics{path/to/img}.
  const renamed = files.map((f) => {
    const newName = flatMap.get(f.rel);
    if (isBinary(f.rel)) {
      return { rel: newName, buf: f.buf };
    }
    let text = f.buf.toString('utf8');
    // Apply known-safe preamble patches for texlive.net compilation. We do
    // this in memory only — the user's source files are untouched.
    if (f.rel === 'main.tex') {
      text = patchMainForTexlive(text);
    }
    text = escapeHashInHrefUrls(text);
    for (const [oldRel, newRel] of flatMap.entries()) {
      const stem = oldRel.replace(/\.tex$/, '');
      const newStem = newRel.replace(/\.tex$/, '');
      // Common LaTeX inclusion macros use basename (no extension). Replace
      // both with-extension and without-extension forms.
      const macros = ['input', 'include', 'subfile', 'includegraphics'];
      for (const m of macros) {
        const reExt = new RegExp(`\\\\${m}(\\[[^\\]]*\\])?\\{\\s*${escapeRegex(oldRel)}\\s*\\}`, 'g');
        text = text.replace(reExt, (_full, optArgs = '') =>
          `\\${m}${optArgs || ''}{${newRel}}`
        );
        const reNoExt = new RegExp(`\\\\${m}(\\[[^\\]]*\\])?\\{\\s*${escapeRegex(stem)}\\s*\\}`, 'g');
        text = text.replace(reNoExt, (_full, optArgs = '') =>
          `\\${m}${optArgs || ''}{${newStem}}`
        );
      }
    }
    return { rel: newName, buf: Buffer.from(text, 'utf8') };
  });
  return renamed;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// pdflatex's \href{URL}{text} chokes on unescaped # in the URL ("Illegal
// parameter number in definition of \Hy@tempa") because # is TeX's macro
// parameter sigil. Hyperref docs recommend \# inside URLs. We rewrite only
// inside the FIRST argument of \href, leaving the visible text untouched.
function escapeHashInHrefUrls(text) {
  return text.replace(/\\href\{([^}]*)\}/g, (full, url) => {
    if (!url.includes('#')) return full;
    // Don't double-escape an already-escaped \#.
    const safe = url.replace(/(^|[^\\])#/g, '$1\\#');
    return `\\href{${safe}}`;
  });
}

// Non-destructive preamble fixes applied to main.tex only when compiling on
// texlive.net. The user's source files on disk are NEVER modified by this.
// Current patches:
//   - wasysym + amsmath both loaded: pass [nointegrals] to wasysym so it
//     doesn't redefine \iint and friends and crash amsmath.
function patchMainForTexlive(text) {
  const hasWasy = /\\usepackage(?:\[[^\]]*\])?\{wasysym\}/.test(text);
  const hasAmsmath = /\\usepackage(?:\[[^\]]*\])?\{amsmath\}/.test(text);
  if (hasWasy && hasAmsmath) {
    text = text.replace(
      /\\usepackage(\[[^\]]*\])?\{wasysym\}/,
      (_full, opts) => {
        if (opts && /nointegrals/.test(opts)) return _full;
        if (!opts) return '\\usepackage[nointegrals]{wasysym}';
        const inner = opts.slice(1, -1).trim();
        const merged = inner ? `${inner},nointegrals` : 'nointegrals';
        return `\\usepackage[${merged}]{wasysym}`;
      }
    );
  }
  return text;
}

function isBinary(rel) {
  return /\.(png|jpe?g|gif|pdf|svg|webp|ico)$/i.test(rel);
}

function mimeFor(rel) {
  if (rel.endsWith('.png')) return 'image/png';
  if (rel.endsWith('.jpg') || rel.endsWith('.jpeg')) return 'image/jpeg';
  if (rel.endsWith('.gif')) return 'image/gif';
  if (rel.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

/**
 * Compile the resume by POSTing all files to texlive.net.
 *
 * Retries ONCE on transient infra failures (network errors, timeouts, HTTP 5xx
 * responses, or empty-body 200s). Does NOT retry when texlive.net returns a
 * 200 with a LaTeX error log — that's the user's content, retrying won't help.
 *
 * @param {string} cvRoot
 * @param {object} opts            { engine?: 'pdflatex' | 'xelatex' | 'lualatex', timeoutMs? }
 * @returns {Promise<{pdf: Buffer, ok: true} | {ok: false, log: string, logSummary: string, status: number}>}
 */
export async function compileResume(cvRoot, opts = {}) {
  try {
    return await compileOnce(cvRoot, opts);
  } catch (err) {
    if (!isTransient(err)) throw err;
    await sleep(1500);
    return compileOnce(cvRoot, opts);
  }
}

function isTransient(err) {
  if (!err || !err.message) return false;
  const msg = err.message;
  return (
    err.name === 'AbortError' ||
    /timed out/i.test(msg) ||
    /compile failed:/i.test(msg) || // fetch-level failure
    /status 5\d\d/i.test(msg)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function compileOnce(cvRoot, opts = {}) {
  const engine = opts.engine || 'pdflatex';
  const timeoutMs = opts.timeoutMs || 60_000;

  const collected = await collectAllFiles(cvRoot);
  reorderMainFirst(collected);
  if (!collected.length || collected[0].rel !== 'main.tex') {
    throw new Error('main.tex not found in CV root.');
  }
  const files = flattenForTexlive(collected);

  // The service expects multipart/form-data and is fussy about line endings —
  // text submissions must use CRLF (per the upstream Perl CGI's parser).
  // Binary files (images) can't be uploaded — the CGI treats every
  // filecontents[] as text and corrupts the bytes ("PNG file corrupted by
  // ASCII conversion"). The current template has no images, but we keep the
  // skip as a safety net: if a user adds an image later the compile will
  // simply render it as missing instead of crashing the whole request.
  const form = new FormData();
  form.append('return', 'pdf');
  form.append('engine', engine);
  for (const f of files) {
    if (isBinary(f.rel)) continue;
    form.append('filename[]', f.rel);
    const text = f.buf.toString('utf8').replace(/\r?\n/g, '\r\n');
    form.append('filecontents[]', text);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url(), {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`texlive.net compile timed out after ${timeoutMs}ms.`);
    }
    throw new Error(`texlive.net compile failed: ${err.message}`);
  }
  clearTimeout(timer);

  const contentType = res.headers.get('content-type') || '';
  if (res.ok && contentType.includes('application/pdf')) {
    const ab = await res.arrayBuffer();
    const pdf = Buffer.from(ab);
    return { ok: true, pdf, pageCount: countPdfPages(pdf) };
  }

  // 5xx responses are infra failures, not LaTeX errors. Throw so the outer
  // compileResume wrapper can retry once. The same goes for an empty body.
  const text = await res.text();
  if (res.status >= 500) {
    throw new Error(`texlive.net compile failed: status ${res.status}`);
  }
  if (!text || !text.trim()) {
    throw new Error('texlive.net compile failed: empty response body');
  }

  // 200/4xx with a body — texlive.net returns 200 with a log on LaTeX errors.
  const logTail = text.split(/\r?\n/).slice(-40).join('\n');
  return {
    ok: false,
    status: res.status,
    log: logTail || text.slice(-2000),
    logSummary: summarizeCompileLog(text),
  };
}

// Extract the actionable lines from a pdflatex log so the UI can show a
// short summary instead of just the raw tail. We grab:
//   - every line starting with "! " (LaTeX error markers)
//   - the "l.NN ..." line that follows (file/line context)
//   - any "Fatal error" / "Emergency stop" hints
// Result is at most 10 short lines joined by \n.
export function summarizeCompileLog(text) {
  if (!text || typeof text !== 'string') return '';
  const lines = text.split(/\r?\n/);
  const out = [];
  const seen = new Set();
  const push = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed.slice(0, 240));
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^!\s/.test(line)) {
      push(line);
      // Capture the next "l.NN ..." within a small window.
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j += 1) {
        if (/^l\.\d+/.test(lines[j])) {
          push(lines[j]);
          break;
        }
      }
    } else if (/Fatal error|Emergency stop|Timeout\/Error status/i.test(line)) {
      push(line);
    }
    if (out.length >= 10) break;
  }
  return out.join('\n');
}

/**
 * Build a zip of the current CV folder (just the .tex + assets) so the user
 * can download it or upload to Overleaf manually. We avoid adding a new
 * dependency — produce a minimal in-memory zip using the well-known store-only
 * (no compression) format.
 */
export async function buildResumeZip(cvRoot) {
  const files = await collectAllFiles(cvRoot);
  reorderMainFirst(files);
  return makeZipStore(files.map((f) => ({ name: f.rel, data: f.buf })));
}

// Minimal "store" zip (no compression). Good enough for ~20 small text files +
// one image. Avoids pulling in a zip dependency.
function makeZipStore(entries) {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
      c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  const localParts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method = store
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (some valid value)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBuf, end]);
}

// Convenience: ensure the CV root parses before we bother POSTing.
export async function preflightCvRoot(cvRoot) {
  return parseResume(cvRoot);
}

// Best-effort page count for a PDF buffer. pdflatex emits an object-stream PDF
// whose content is FlateDecode-compressed, so we walk each stream, inflate it,
// and look for the /Pages root's /Count entry. Falls back to counting /Type
// /Page markers, then to scanning the raw bytes. Returns 0 if undetermined.
export function countPdfPages(pdf) {
  if (!pdf || pdf.length < 4) return 0;
  const text = pdf.toString('latin1');

  const tryParseCount = (s) => {
    // The /Pages root object has `/Type /Pages` followed by `/Count N`.
    // Other PDF objects (fonts, outlines) can also carry /Count entries with
    // unrelated meanings, so we anchor on the /Type /Pages marker.
    const rootRe = /\/Type\s*\/Pages\b[\s\S]{0,400}?\/Count\s+(\d+)/g;
    const rootCounts = [...s.matchAll(rootRe)].map((m) => Number(m[1]));
    if (rootCounts.length) {
      // If there are nested /Pages nodes, the topmost root has the largest
      // count; take the max of all matches.
      return Math.max(...rootCounts);
    }
    // Fall back to counting actual /Type /Page (singular) markers.
    return (s.match(/\/Type\s*\/Page(?![s/])/g) || []).length;
  };

  const directCount = tryParseCount(text);
  if (directCount > 0) return directCount;

  // Inflate every FlateDecode stream and try again on the decompressed bytes.
  const streamRe = /<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let combined = '';
  let m;
  while ((m = streamRe.exec(text)) !== null) {
    const dict = m[1];
    if (!/FlateDecode/.test(dict)) continue;
    try {
      combined += zlib.inflateSync(Buffer.from(m[2], 'latin1')).toString('latin1');
    } catch {
      /* ignore individual stream decode errors */
    }
  }
  if (combined) {
    const c = tryParseCount(combined);
    if (c > 0) return c;
  }
  return 0;
}
