import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export const AI_PROVIDERS = ['gemini', 'groq'];

const GEMINI_MODEL_ID_RE = /^gemini-[a-z0-9][a-z0-9.-]*$/i;
const GROQ_MODEL_ID_RE = /^[a-z0-9][a-z0-9._\/-]*$/i;

/** Models commonly available on the Gemini free tier (separate per-model quotas). */
export const GEMINI_MODEL_CANDIDATES = [
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

/** Popular Groq-hosted models (verified against Groq ListModels API). */
export const GROQ_MODEL_CANDIDATES = [
  {
    id: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B',
    hint: 'Default — best for structured JSON tasks',
  },
  {
    id: 'llama-3.1-8b-instant',
    label: 'Llama 3.1 8B Instant',
    hint: 'Fastest — good for simple JSON tasks',
  },
  {
    id: 'groq/compound',
    label: 'Groq Compound',
    hint: 'Agentic — web search, code exec (overkill for simple JSON)',
  },
  {
    id: 'groq/compound-mini',
    label: 'Groq Compound Mini',
    hint: 'Faster agentic variant — single tool per request',
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT-OSS 20B',
    hint: 'Open-weight — strong JSON on Groq',
  },
  {
    id: 'openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    hint: 'Larger open-weight model',
  },
  {
    id: 'meta-llama/llama-4-scout-17b-16e-instruct',
    label: 'Llama 4 Scout 17B',
    hint: 'Meta Llama 4 on Groq',
  },
  {
    id: 'qwen/qwen3-32b',
    label: 'Qwen3 32B',
    hint: 'Strong reasoning — 32B',
  },
];

export function defaultProviderFromEnv() {
  const raw = (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();
  return AI_PROVIDERS.includes(raw) ? raw : 'gemini';
}

export function defaultGeminiModelFromEnv() {
  return (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
}

export function defaultGroqModelFromEnv() {
  return (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim();
}

export function defaultModelForProvider(provider) {
  return provider === 'groq' ? defaultGroqModelFromEnv() : defaultGeminiModelFromEnv();
}

/** @deprecated use defaultGeminiModelFromEnv */
export function defaultModelFromEnv() {
  return defaultGeminiModelFromEnv();
}

export function sanitizeProvider(input) {
  const p = String(input || '').trim().toLowerCase();
  return AI_PROVIDERS.includes(p) ? p : null;
}

export function sanitizeModelId(input, provider = 'gemini') {
  const id = String(input || '').trim();
  if (!id || id.length > 96) return null;
  const re = provider === 'groq' ? GROQ_MODEL_ID_RE : GEMINI_MODEL_ID_RE;
  return re.test(id) ? id : null;
}

function getStore() {
  return storage.getStore() || {};
}

/** Active provider for the current HTTP request (set by middleware). */
export function getAiProvider() {
  const fromCtx = getStore().provider;
  return sanitizeProvider(fromCtx) || defaultProviderFromEnv();
}

/** Active model for the current HTTP request (set by middleware). */
export function getAiModel() {
  const { provider, model } = getStore();
  const p = sanitizeProvider(provider) || defaultProviderFromEnv();
  return sanitizeModelId(model, p) || defaultModelForProvider(p);
}

/** @deprecated use getAiModel */
export function getGeminiModel() {
  if (getAiProvider() !== 'gemini') return defaultGeminiModelFromEnv();
  return getAiModel();
}

export function runWithAiContext({ provider, model }, fn) {
  const p = sanitizeProvider(provider) || defaultProviderFromEnv();
  const m = sanitizeModelId(model, p) || defaultModelForProvider(p);
  return storage.run({ provider: p, model: m }, fn);
}

/** @deprecated use runWithAiContext */
export function runWithGeminiModel(model, fn) {
  return runWithAiContext({ provider: 'gemini', model }, fn);
}

export function isProviderConfigured(provider) {
  const p = sanitizeProvider(provider);
  if (p === 'gemini') {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
  }
  if (p === 'groq') {
    return Boolean(process.env.GROQ_API_KEY?.trim());
  }
  return false;
}

/** True when at least one AI provider has an API key configured. */
export function isAiEnabled() {
  return AI_PROVIDERS.some((p) => isProviderConfigured(p));
}

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY?.trim() || '';
}

function getGroqApiKey() {
  return process.env.GROQ_API_KEY?.trim() || '';
}

/**
 * List models your API key can call. Falls back to curated candidates when the
 * list API is unavailable.
 */
export async function listAccessibleModels(provider = 'gemini') {
  const p = sanitizeProvider(provider) || 'gemini';
  if (p === 'groq') return listAccessibleGroqModels();
  return listAccessibleGeminiModels();
}

export async function listAccessibleGeminiModels() {
  const key = getGeminiApiKey();
  const defaultModel = defaultGeminiModelFromEnv();
  const candidateIds = new Set(GEMINI_MODEL_CANDIDATES.map((m) => m.id));

  if (!key) {
    return {
      provider: 'gemini',
      configured: false,
      defaultModel,
      models: GEMINI_MODEL_CANDIDATES.map((m) => ({
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
        const curated = GEMINI_MODEL_CANDIDATES.find((c) => c.id === id);
        return {
          id,
          displayName: m.displayName || curated?.label || id,
          description: curated?.hint || m.description || '',
          recommendedForFreeTier: candidateIds.has(id),
        };
      })
      .filter((m) => sanitizeModelId(m.id, 'gemini'))
      .sort((a, b) => {
        if (a.recommendedForFreeTier !== b.recommendedForFreeTier) {
          return a.recommendedForFreeTier ? -1 : 1;
        }
        return a.id.localeCompare(b.id);
      });

    if (models.length) {
      return { provider: 'gemini', configured: true, defaultModel, models };
    }
  } catch (err) {
    console.warn('[coldMail] Gemini ListModels failed, using curated list:', err.message);
  }

  return {
    provider: 'gemini',
    configured: true,
    defaultModel,
    models: GEMINI_MODEL_CANDIDATES.map((m) => ({
      id: m.id,
      displayName: m.label,
      description: m.hint,
      recommendedForFreeTier: true,
    })),
  };
}

export async function listAccessibleGroqModels() {
  const key = getGroqApiKey();
  const defaultModel = defaultGroqModelFromEnv();
  const candidateIds = new Set(GROQ_MODEL_CANDIDATES.map((m) => m.id));

  if (!key) {
    return {
      provider: 'groq',
      configured: false,
      defaultModel,
      models: GROQ_MODEL_CANDIDATES.map((m) => ({
        id: m.id,
        displayName: m.label,
        description: m.hint,
        recommendedForFreeTier: true,
      })),
    };
  }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      throw new Error(`Groq ListModels HTTP ${res.status}`);
    }
    const data = await res.json();
    const models = (data.data || [])
      .map((m) => {
        const id = String(m.id || '').trim();
        const curated = GROQ_MODEL_CANDIDATES.find((c) => c.id === id);
        return {
          id,
          displayName: curated?.label || id,
          description: curated?.hint || '',
          recommendedForFreeTier: candidateIds.has(id),
        };
      })
      .filter((m) => sanitizeModelId(m.id, 'groq'))
      .sort((a, b) => {
        if (a.recommendedForFreeTier !== b.recommendedForFreeTier) {
          return a.recommendedForFreeTier ? -1 : 1;
        }
        return a.id.localeCompare(b.id);
      });

    if (models.length) {
      return { provider: 'groq', configured: true, defaultModel, models };
    }
  } catch (err) {
    console.warn('[coldMail] Groq ListModels failed, using curated list:', err.message);
  }

  return {
    provider: 'groq',
    configured: true,
    defaultModel,
    models: GROQ_MODEL_CANDIDATES.map((m) => ({
      id: m.id,
      displayName: m.label,
      description: m.hint,
      recommendedForFreeTier: true,
    })),
  };
}
