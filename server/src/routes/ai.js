import { Router } from 'express';

import { HttpError } from '../middleware/error.js';
import { getGeminiModel, listAccessibleGeminiModels } from '../services/geminiModel.js';
import { isEnrichmentEnabled } from '../services/enrich.js';

const router = Router();

router.get('/models', async (_req, res, next) => {
  try {
    if (!isEnrichmentEnabled()) {
      throw new HttpError(
        503,
        'GEMINI_API_KEY is not configured. Set it in server/.env to list models.'
      );
    }
    const listed = await listAccessibleGeminiModels();
    res.json({
      ...listed,
      activeModel: getGeminiModel(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
