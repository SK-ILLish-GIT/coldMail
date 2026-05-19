import { Router } from 'express';
import { nanoid } from 'nanoid';

import { templatesStore } from '../services/store.js';
import { HttpError } from '../middleware/error.js';
import { validateTemplate } from '../middleware/validate.js';
import { normalizeTags } from '../utils/tags.js';

const router = Router();

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
