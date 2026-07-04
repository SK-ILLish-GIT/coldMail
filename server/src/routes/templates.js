import { Router } from 'express';
import { nanoid } from 'nanoid';

import { templatesStore } from '../services/store.js';
import {
  isTemplateTaggingEnabled,
  suggestTagsForTemplate,
} from '../services/templateTags.js';
import { HttpError } from '../middleware/error.js';
import { validateTemplate } from '../middleware/validate.js';
import { normalizeTags } from '../utils/tags.js';

const router = Router();

// POST /api/templates/suggest-tags — stateless AI tag suggestion for a
// subject+body pair. Used by the "Auto tag" buttons in the library and
// inside the Edit/New template modal. Declared before the parameterised
// routes for clarity (POST collisions aren't possible, but keeping the
// suggestion endpoint near the top makes the route file easier to scan).
router.post('/suggest-tags', async (req, res, next) => {
  try {
    if (!isTemplateTaggingEnabled()) {
      throw new HttpError(503, 'AI is disabled. Set GEMINI_API_KEY or GROQ_API_KEY on the server.');
    }
    const { subject, body, tags } = req.body || {};
    const tagsArr = Array.isArray(tags) ? tags : [];
    if (!String(subject || '').trim() && !String(body || '').trim()) {
      throw new HttpError(400, 'subject or body is required.');
    }
    const suggested = await suggestTagsForTemplate({ subject, body, tags: tagsArr });
    res.json({ tags: suggested });
  } catch (err) {
    // Surface Gemini quota/auth issues as a clean 429/503 instead of 500.
    if (err?.status && err instanceof HttpError) return next(err);
    if (err?.status) return next(new HttpError(err.status, err.message));
    if (/quota|rate/i.test(err?.message || '')) {
      return next(new HttpError(429, err.message));
    }
    next(err);
  }
});

router.get('/', async (_req, res, next) => {
  try {
    const items = await templatesStore.list();
    // Newest first.
    items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post('/', validateTemplate, async (req, res, next) => {
  try {
    const { name, subject, body, tags } = req.body;
    const now = new Date().toISOString();
    const item = {
      id: nanoid(10),
      name: name.trim(),
      subject: subject.trim(),
      body,
      tags: normalizeTags(tags),
      createdAt: now,
      updatedAt: now,
    };
    await templatesStore.append(item);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', validateTemplate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const items = await templatesStore.list();
    const existing = items.find((t) => t.id === id);
    if (!existing) throw new HttpError(404, 'Template not found');

    const updated = {
      ...existing,
      name: req.body.name.trim(),
      subject: req.body.subject.trim(),
      body: req.body.body,
      tags: normalizeTags(
        req.body.tags !== undefined ? req.body.tags : existing.tags
      ),
      updatedAt: new Date().toISOString(),
    };
    await templatesStore.upsert(updated);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PUT /api/templates/:id/default — mark as the user's default template.
router.put('/:id/default', async (req, res, next) => {
  try {
    const updated = await templatesStore.setDefault(req.params.id, true);
    if (!updated) throw new HttpError(404, 'Template not found');
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/templates/:id/default — clear the default flag.
router.delete('/:id/default', async (req, res, next) => {
  try {
    const updated = await templatesStore.setDefault(req.params.id, false);
    if (!updated) throw new HttpError(404, 'Template not found');
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const removed = await templatesStore.remove({ id: req.params.id });
    if (!removed) throw new HttpError(404, 'Template not found');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
