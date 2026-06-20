import path from 'node:path';
import fs from 'node:fs/promises';

import { Router } from 'express';

import { HttpError } from '../middleware/error.js';
import {
  abandonResumeSession,
  buildResumeRestorePayload,
  createSession,
  decideSuggestion,
  getActiveResumeSession,
  getSession,
  nextSuggestion,
  rollbackSession,
  buildReport,
} from '../services/tailor/session.js';
import { compileResume, buildResumeZip } from '../services/tailor/compile.js';
import { isGeminiConfigured } from '../services/tailor/gemini.js';
import { extractAutoTags } from '../services/tailor/autoTags.js';
import { buildTailoredForMeta } from '../services/tailor/tailoredFor.js';
import {
  abandonTemplateSession,
  buildTemplateRestorePayload,
  createTemplateSession,
  decideTemplateSuggestion,
  getActiveTemplateSession,
  getTemplateSession,
  nextTemplateSuggestion,
  saveTemplateSession,
  isTailorTemplateEnabled,
} from '../services/tailor/templateTailor.js';
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

// Inspect the default CV folder. Returns total size, file count, last-modified.
// Lets the Tailor tab show "what I'm about to operate on" before the user
// commits to a session.
async function inspectCvFolder(absPath) {
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isDirectory()) return { exists: false, error: 'Not a directory' };
    let totalSize = 0;
    let fileCount = 0;
    let lastModified = stat.mtime.toISOString();
    const walk = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        // Skip the .bak/baseline files we create during sessions so the size
        // reflects the actual CV, not our scratch state.
        if (ent.name.endsWith('.bak')) continue;
        if (ent.name.startsWith('.')) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(full);
        } else if (ent.isFile()) {
          const s = await fs.stat(full);
          totalSize += s.size;
          fileCount += 1;
          if (s.mtime.toISOString() > lastModified) lastModified = s.mtime.toISOString();
        }
      }
    };
    await walk(absPath);
    return { exists: true, totalSize, fileCount, lastModified, path: absPath };
  } catch (err) {
    return { exists: false, error: err.message };
  }
}

router.get('/status', async (_req, res) => {
  const defaultCvPath = process.env.CV_DEFAULT_PATH || './Sk_Sahil_Parvez_CV_';
  let cvInfo = null;
  try {
    const abs = resolveCvRoot(defaultCvPath);
    cvInfo = await inspectCvFolder(abs);
  } catch (err) {
    cvInfo = { exists: false, error: err.message };
  }
  res.json({
    aiConfigured: isGeminiConfigured(),
    defaultCvPath,
    cvInfo,
    texliveUrl:
      process.env.TEXLIVE_NET_URL || 'https://texlive.net/cgi-bin/latexcgi',
  });
});

// Public list of every suggestion in the session — pending, approved,
// rejected, failed. Powers the bulk-triage view in the Tailor tab.
router.get('/session/active', async (req, res, next) => {
  try {
    const s = await getActiveResumeSession();
    if (!s) return res.json({ restored: false });
    res.json({ restored: true, ...buildResumeRestorePayload(s) });
  } catch (err) {
    next(err);
  }
});

router.get('/session/:id/restore', async (req, res, next) => {
  try {
    const s = await getSession(req.params.id);
    if (!s) throw new HttpError(404, 'Session not found or expired.');
    res.json({ restored: true, ...buildResumeRestorePayload(s) });
  } catch (err) {
    next(err);
  }
});

router.post('/session/:id/abandon', async (req, res, next) => {
  try {
    await abandonResumeSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/session/:id/queue', async (req, res, next) => {
  try {
    const s = await getSession(req.params.id);
    if (!s) throw new HttpError(404, 'Session not found or expired.');
    res.json({
      sessionId: s.id,
      suggestions: s.queue.map((q) => ({
        id: q.id,
        section: q.section,
        subheading: q.subheading,
        action: q.action,
        targetBulletText: q.targetBulletText,
        targetSkillsCategory: q.targetSkillsCategory,
        draftLatex: q.draftLatex,
        previewText: q.previewText,
        reason: q.reason,
        atsKeywords: q.atsKeywords,
        impact: q.impact,
        status: q.status,
        error: q.error,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/session', async (req, res, next) => {
  try {
    if (!isGeminiConfigured()) {
      throw new HttpError(503, 'AI is disabled. Set GEMINI_API_KEY or GROQ_API_KEY on the server.');
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

router.get('/session/:id/next', async (req, res, next) => {
  try {
    res.json(await nextSuggestion(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.get('/session/:id/auto-tags', async (req, res, next) => {
  try {
    const s = await getSession(req.params.id);
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
    const s = await getSession(req.params.id);
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
        tailoredFor: buildTailoredForMeta(s),
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
    const s = await getSession(req.params.id);
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

router.get('/session/:id/report', async (req, res, next) => {
  try {
    res.json(await buildReport(req.params.id));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Template Tailor endpoints (separate session pool from resume tailoring,
// same chat-iterative pattern)
// ---------------------------------------------------------------------------

router.post('/template-session', async (req, res, next) => {
  try {
    if (!isTailorTemplateEnabled()) {
      throw new HttpError(503, 'AI is disabled. Set GEMINI_API_KEY or GROQ_API_KEY on the server.');
    }
    const body = req.body || {};
    if (!body.templateId) throw new HttpError(400, 'templateId is required.');
    if (!body.jobDescription || !body.jobDescription.trim()) {
      throw new HttpError(400, 'jobDescription is required.');
    }
    const result = await createTemplateSession({
      templateId: body.templateId,
      jobDescription: body.jobDescription,
      targetRole: body.targetRole,
      targetCompany: body.targetCompany,
      seniority: body.seniority,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/template-session/active', async (req, res, next) => {
  try {
    const s = await getActiveTemplateSession();
    if (!s) return res.json({ restored: false });
    res.json({ restored: true, ...buildTemplateRestorePayload(s) });
  } catch (err) {
    next(err);
  }
});

router.get('/template-session/:id/restore', async (req, res, next) => {
  try {
    const s = await getTemplateSession(req.params.id);
    if (!s) throw new HttpError(404, 'Session not found or expired.');
    res.json({ restored: true, ...buildTemplateRestorePayload(s) });
  } catch (err) {
    next(err);
  }
});

router.post('/template-session/:id/abandon', async (req, res, next) => {
  try {
    await abandonTemplateSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/template-session/:id/next', async (req, res, next) => {
  try {
    res.json(await nextTemplateSuggestion(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post('/template-session/:id/decide', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.suggestionId) throw new HttpError(400, 'suggestionId is required.');
    if (!body.decision) throw new HttpError(400, 'decision is required.');
    const result = await decideTemplateSuggestion(req.params.id, {
      suggestionId: body.suggestionId,
      decision: body.decision,
      editInstruction: body.editInstruction,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/template-session/:id/save', async (req, res, next) => {
  try {
    const created = await saveTemplateSession(req.params.id, {
      name: req.body?.name,
      tags: req.body?.tags,
    });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

export default router;
