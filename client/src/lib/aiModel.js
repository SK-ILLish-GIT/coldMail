const PROVIDER_KEY = "coldmail.aiProvider";
const MODEL_KEY = "coldmail.aiModel";
const LEGACY_MODEL_KEY = "coldmail.geminiModel";

export const AI_MODEL_CHANGE_EVENT = "coldmail:ai-model-change";
/** @deprecated use AI_MODEL_CHANGE_EVENT */
export const GEMINI_MODEL_CHANGE_EVENT = AI_MODEL_CHANGE_EVENT;

export const FALLBACK_PROVIDER = "gemini";
export const FALLBACK_GEMINI_MODEL = "gemini-2.5-flash";
export const FALLBACK_GROQ_MODEL = "llama-3.3-70b-versatile";

export function getSelectedAiProvider() {
  try {
    const stored = localStorage.getItem(PROVIDER_KEY);
    const p = stored?.trim().toLowerCase();
    if (p === "gemini" || p === "groq") return p;
    return FALLBACK_PROVIDER;
  } catch {
    return FALLBACK_PROVIDER;
  }
}

export function setSelectedAiProvider(provider) {
  const p = String(provider || "").trim().toLowerCase();
  if (p !== "gemini" && p !== "groq") return;
  try {
    localStorage.setItem(PROVIDER_KEY, p);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(
    new CustomEvent(AI_MODEL_CHANGE_EVENT, {
      detail: { provider: p, model: getSelectedAiModel() },
    }),
  );
}

export function getSelectedAiModel() {
  try {
    const stored = localStorage.getItem(MODEL_KEY) || localStorage.getItem(LEGACY_MODEL_KEY);
    if (stored?.trim()) return stored.trim();
    return getSelectedAiProvider() === "groq"
      ? FALLBACK_GROQ_MODEL
      : FALLBACK_GEMINI_MODEL;
  } catch {
    return FALLBACK_GEMINI_MODEL;
  }
}

export function setSelectedAiModel(modelId) {
  const id = String(modelId || "").trim();
  if (!id) return;
  try {
    localStorage.setItem(MODEL_KEY, id);
    localStorage.setItem(LEGACY_MODEL_KEY, id);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(
    new CustomEvent(AI_MODEL_CHANGE_EVENT, {
      detail: { provider: getSelectedAiProvider(), model: id },
    }),
  );
}

/** @deprecated use getSelectedAiModel */
export function getSelectedGeminiModel() {
  return getSelectedAiModel();
}

/** @deprecated use setSelectedAiModel */
export function setSelectedGeminiModel(modelId) {
  setSelectedAiModel(modelId);
}

/** Axios request interceptor — sends provider + model to the server. */
export function attachAiModelRequest(config) {
  const provider = getSelectedAiProvider();
  const model = getSelectedAiModel();
  config.headers = config.headers || {};
  if (provider) config.headers["X-AI-Provider"] = provider;
  if (model) {
    config.headers["X-AI-Model"] = model;
    if (provider === "gemini") {
      config.headers["X-Gemini-Model"] = model;
    }
  }
  return config;
}

/** @deprecated use attachAiModelRequest */
export const attachGeminiModelRequest = attachAiModelRequest;
