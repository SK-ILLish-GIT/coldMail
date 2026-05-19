import { Router } from 'express';
import { sentLogStore } from '../services/store.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const items = await sentLogStore.list();
    items.sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.delete('/', async (_req, res, next) => {
  try {
    await sentLogStore.clear();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
