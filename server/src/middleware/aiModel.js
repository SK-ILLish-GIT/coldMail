import {
  defaultModelForProvider,
  defaultProviderFromEnv,
  runWithAiContext,
  sanitizeModelId,
  sanitizeProvider,
} from '../services/aiModel.js';

/** Per-request AI provider + model from browser picker or server defaults. */
export function aiModelMiddleware(req, res, next) {
  const headerProvider = sanitizeProvider(req.get('X-AI-Provider'));
  const legacyGeminiModel = sanitizeModelId(req.get('X-Gemini-Model'), 'gemini');

  const provider =
    headerProvider ||
    (legacyGeminiModel ? 'gemini' : null) ||
    defaultProviderFromEnv();

  const headerModel = sanitizeModelId(req.get('X-AI-Model'), provider);
  const model =
    headerModel ||
    legacyGeminiModel ||
    defaultModelForProvider(provider);

  runWithAiContext({ provider, model }, () => next());
}

/** @deprecated use aiModelMiddleware */
export const geminiModelMiddleware = aiModelMiddleware;
