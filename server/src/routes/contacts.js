import { Router } from 'express';

import { HttpError } from '../middleware/error.js';
import { contactStore } from '../services/contactStore.js';

const router = Router();

// GET /api/contacts/grouped?q=stripe
router.get('/grouped', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const groups = await contactStore.listGrouped({ q });
    res.json(groups);
  } catch (err) {
    next(err);
  }
});

// GET /api/contacts/companies?q=acme&limit=8
router.get('/companies', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Number(req.query.limit) || 8;
    const items = await contactStore.searchCompanies(q, limit);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// GET /api/contacts?company=Acme Inc.  OR  ?companyKey=acme
router.get('/', async (req, res, next) => {
  try {
    const company = String(req.query.company || '').trim();
    const companyKey = String(req.query.companyKey || '').trim();
    const key = companyKey || company;
    if (!key) {
      throw new HttpError(400, 'company or companyKey query param is required.');
    }
    const items = await contactStore.listByCompany(key);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

export default router;
