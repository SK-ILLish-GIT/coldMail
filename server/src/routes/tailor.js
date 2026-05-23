import path from 'node:path';
import fs from 'node:fs/promises';

import { Router } from 'express';

import { HttpError } from '../middleware/error.js';
import {
  createSession,
  decideSuggestion,
  getSession,
  nextSuggestion,
  rollbackSession,
  buildReport,
} from '../services/tailor/session.js';
import { compileResume, buildResumeZip } from '../services/tailor/compile.js';
import { isGeminiConfigured } from '../services/tailor/gemini.js';
import { extractAutoTags } from '../services/tailor/autoTags.js';
import { resumeStore } from '../services/resumeStore.js';
import { normalizeTags } from '../utils/tags.js';

// CV folders are resolved against the project root (the parent of server/).
// We refuse to traverse outside the project to keep this safe even when the
// folder path comes from the client.
const SERVER_ROOT = path.resolve(process.cwd());
const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');

function resolveCvRoot(input) {
  const fallback = process.env.CV_DEFAULT_PATH || './Sk_Sahil_Parvez_CV_';
  const raw = (input && String(input).trim()) || fallback;
  const abs = path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
  const rel = path.relative(PROJECT_ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new HttpError(400, 'cvPath must stay inside the project directory.');
  }
  return abs;
}

async function ensureCvRoot(absPath) {
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isDirectory()) {
      throw new HttpError(400, 'cvPath is not a directory.');
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new HttpError(404, `CV folder not found: ${absPath}`);
    }
    throw err;
  }
  try {
    await fs.access(path.join(absPath, 'main.tex'));
  } catch {
    throw new HttpError(400, 'CV folder must contain main.tex.');
  }
}

const router = Router();

router.get('/status', (_req, res) => {
  res.json({
    aiConfigured: isGeminiConfigured(),
    defaultCvPath: process.env.CV_DEFAULT_PATH || './Sk_Sahil_Parvez_CV_',
    texliveUrl:
      process.env.TEXLIVE_NET_URL || 'https://texlive.net/cgi-bin/latexcgi',
  });
});

router.post('/session', async (req, res, next) => {
  try {
    if (!isGeminiConfigured()) {
      throw new HttpError(503, 'GEMINI_API_KEY is not configured on the server.');
    }
    const body = req.body || {};
    const cvRoot = resolveCvRoot(body.cvPath);
    await ensureCvRoot(cvRoot);
    const result = await createSession({
      cvRoot,
      jobDescription: body.jobDescription,
      targetRole: body.targetRole,
      targetCompany: body.targetCompany,
      seniority: body.seniority,
      tone: body.tone,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/session/:id/next', (req, res, next) => {
  try {
    res.json(nextSuggestion(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.get('/session/:id/auto-tags', (req, res, next) => {
  try {
    const s = getSession(req.params.id);
    if (!s) throw new HttpError(404, 'Session not found or expired.');
    res.json({ tags: extractAutoTags(s.parsed, s) });
  } catch (err) {
    next(err);
  }
});

router.post('/session/:id/decide', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.suggestionId) throw new HttpError(400, 'suggestionId is required.');
    if (!body.decision) throw new HttpError(400, 'decision is required.');
    const result = await decideSuggestion(req.params.id, {
      suggestionId: body.suggestionId,
      decision: body.decision,
      editInstruction: body.editInstruction,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/session/:id/compile', async (req, res, next) => {
  try {
    const s = getSession(req.params.id);
    if (!s) throw new HttpError(404, 'Session not found or expired.');

    const result = await compileResume(s.cvRoot, { engine: req.body?.engine });
    if (!result.ok) {
      return res.status(422).json({
        ok: false,
        status: result.status,
        log: result.log,
        logSummary: result.logSummary,
      });
    }

    const save = String(req.query.save || '').toLowerCase() === '1';
    let saved = null;
    if (save) {
      const name = String(req.body?.name || s.targetCompany || s.targetRole || 'tailored-resume')
        .trim()
        .slice(0, 180);
      // Tag source priority: explicit tags from request body if provided,
      // otherwise the auto-tags derived from the resume's skills section +
      // approved ATS keywords + role/company hints.
      const tags =
        req.body?.tags !== undefined
          ? normalizeTags(req.body.tags)
          : extractAutoTags(s.parsed, s);
      saved = await resumeStore.create({
        name: name || 'tailored-resume',
        filename: `${name || 'tailored-resume'}.pdf`,
        contentType: 'application/pdf',
        size: result.pdf.length,
        content: result.pdf,
        tags,
      });
    }

    res.json({
      ok: true,
      pdfBase64: result.pdf.toString('base64'),
      size: result.pdf.length,
      pageCount: result.pageCount || 0,
      saved,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/session/:id/zip', async (req, res, next) => {
  try {
    const s = getSession(req.params.id);
    if (!s) throw new HttpError(404, 'Session not found or expired.');
    const buf = await buildResumeZip(s.cvRoot);
    const name = (s.targetCompany || s.targetRole || 'tailored-resume')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tailored-resume';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

router.post('/session/:id/rollback', async (req, res, next) => {
  try {
    const result = await rollbackSession(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/session/:id/report', (req, res, next) => {
  try {
    res.json(buildReport(req.params.id));
  } catch (err) {
    next(err);
  }
});

export default router;
