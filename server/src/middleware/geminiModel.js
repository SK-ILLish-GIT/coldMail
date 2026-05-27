import {
  defaultModelFromEnv,
  runWithGeminiModel,
  sanitizeModelId,
} from '../services/geminiModel.js';

/** Per-request Gemini model from X-Gemini-Model (browser picker) or server default. */
export function geminiModelMiddleware(req, res, next) {
  const header = sanitizeModelId(req.get('X-Gemini-Model'));
  const model = header || defaultModelFromEnv();
  runWithGeminiModel(model, () => next());
}
