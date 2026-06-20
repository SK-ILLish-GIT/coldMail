import { Router } from 'express';

import {
  AI_PROVIDERS,
  getAiModel,
  getAiProvider,
  isAiEnabled,
  isProviderConfigured,
  listAccessibleModels,
} from '../services/aiModel.js';

const router = Router();

router.get('/models', async (req, res, next) => {
  try {
    const requested = String(req.query.provider || '').trim().toLowerCase();
    const provider = AI_PROVIDERS.includes(requested) ? requested : getAiProvider();

    const listed = await listAccessibleModels(provider);
    res.json({
      ...listed,
      activeProvider: getAiProvider(),
      activeModel: getAiModel(),
      providers: {
        gemini: isProviderConfigured('gemini'),
        groq: isProviderConfigured('groq'),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/providers', async (_req, res) => {
  res.json({
    enabled: isAiEnabled(),
    providers: AI_PROVIDERS.map((id) => ({
      id,
      configured: isProviderConfigured(id),
    })),
    activeProvider: getAiProvider(),
    activeModel: getAiModel(),
  });
});

export default router;
