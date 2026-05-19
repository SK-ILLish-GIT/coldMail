import { Router } from 'express';

import { HttpError } from '../middleware/error.js';
import {
  findEmailCandidates,
  isEnrichmentEnabled,
} from '../services/enrich.js';

const router = Router();

const MAX_FIELD = 200;

function nonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

router.post('/email', async (req, res, next) => {
  try {
    if (!isEnrichmentEnabled()) {
      throw new HttpError(
        503,
        'AI email finder is disabled. Set GEMINI_API_KEY in server/.env to enable it.'
      );
    }

    const { firstName, lastName, company, domain } = req.body || {};
    const errors = {};

    if (!nonEmpty(firstName)) errors.firstName = 'First name is required.';
    if (!nonEmpty(lastName)) errors.lastName = 'Last name is required.';
    if (!nonEmpty(company)) errors.company = 'Company is required.';

    for (const [k, v] of Object.entries({ firstName, lastName, company, domain })) {
      if (typeof v === 'string' && v.length > MAX_FIELD) {
        errors[k] = `${k} is too long (max ${MAX_FIELD} chars).`;
      }
    }

    if (Object.keys(errors).length) {
      throw new HttpError(400, 'Validation failed', errors);
    }

    const result = await findEmailCandidates({
      firstName,
      lastName,
      company,
      domain,
    });

    res.json(result);
  } catch (err) {
    // Map upstream Gemini errors to a clean 502 so the UI gets a friendly message.
    if (err.status && err.status >= 400 && err.status < 600 && err.message) {
      return next(err);
    }
    const msg = err.message || 'Gemini request failed';
    // Gemini returns quota errors with status 429 in the message text.
    if (/quota|exceeded|rate/i.test(msg)) {
      return next(
        new HttpError(
          429,
          'Gemini quota exhausted. Check your free-tier limits at https://aistudio.google.com/'
        )
      );
    }
    next(new HttpError(502, `Gemini error: ${msg}`));
  }
});

export default router;
