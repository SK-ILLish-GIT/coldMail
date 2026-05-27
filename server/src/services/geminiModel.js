import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

const MODEL_ID_RE = /^gemini-[a-z0-9][a-z0-9.-]*$/i;

/** Models commonly available on the free tier (separate per-model quotas). */
export const FREE_TIER_MODEL_CANDIDATES = [
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    hint: 'Default — fast, strong JSON',
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    hint: 'Cheapest — use when Flash quota is out',
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    hint: 'General purpose',
  },
  {
    id: 'gemini-2.0-flash-lite',
    label: 'Gemini 2.0 Flash Lite',
    hint: 'High throughput',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    hint: 'Stronger reasoning — lower free limits',
  },
];

export function defaultModelFromEnv() {
  return (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
}

export function sanitizeModelId(input) {
  const id = String(input || '').trim();
  if (!id || id.length > 64 || !MODEL_ID_RE.test(id)) return null;
  return id;
}

/** Active model for the current HTTP request (set by middleware). */
export function getGeminiModel() {
  const fromCtx = storage.getStore();
  return sanitizeModelId(fromCtx) || defaultModelFromEnv();
}

export function runWithGeminiModel(model, fn) {
  const safe = sanitizeModelId(model) || defaultModelFromEnv();
  return storage.run(safe, fn);
}

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  return key?.trim() || '';
}

/**
 * List models your API key can call (generateContent). Falls back to curated
 * free-tier candidates when the list API is unavailable.
 */
export async function listAccessibleGeminiModels() {
  const key = getApiKey();
  const defaultModel = defaultModelFromEnv();
  const candidateIds = new Set(FREE_TIER_MODEL_CANDIDATES.map((m) => m.id));

  if (!key) {
    return {
      configured: false,
      defaultModel,
      models: FREE_TIER_MODEL_CANDIDATES.map((m) => ({
        id: m.id,
        displayName: m.label,
        description: m.hint,
        recommendedForFreeTier: true,
      })),
    };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`ListModels HTTP ${res.status}`);
    }
    const data = await res.json();
    const models = (data.models || [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => {
        const id = String(m.name || '').replace(/^models\//, '');
        const curated = FREE_TIER_MODEL_CANDIDATES.find((c) => c.id === id);
        return {
          id,
          displayName: m.displayName || curated?.label || id,
          description: curated?.hint || m.description || '',
          recommendedForFreeTier: candidateIds.has(id),
        };
      })
      .filter((m) => sanitizeModelId(m.id))
      .sort((a, b) => {
        if (a.recommendedForFreeTier !== b.recommendedForFreeTier) {
          return a.recommendedForFreeTier ? -1 : 1;
        }
        return a.id.localeCompare(b.id);
      });

    if (models.length) {
      return { configured: true, defaultModel, models };
    }
  } catch (err) {
    console.warn('[coldMail] ListModels failed, using curated list:', err.message);
  }

  return {
    configured: true,
    defaultModel,
    models: FREE_TIER_MODEL_CANDIDATES.map((m) => ({
      id: m.id,
      displayName: m.label,
      description: m.hint,
      recommendedForFreeTier: true,
    })),
  };
}
