const STORAGE_KEY = 'coldmail.geminiModel';
export const GEMINI_MODEL_CHANGE_EVENT = 'coldmail:gemini-model-change';

export const FALLBACK_GEMINI_MODEL = 'gemini-2.5-flash';

export function getSelectedGeminiModel() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored?.trim() || FALLBACK_GEMINI_MODEL;
  } catch {
    return FALLBACK_GEMINI_MODEL;
  }
}

export function setSelectedGeminiModel(modelId) {
  const id = String(modelId || '').trim();
  if (!id) return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent(GEMINI_MODEL_CHANGE_EVENT, { detail: id }));
}

/** Axios request interceptor — sends the user's model pick to the server. */
export function attachGeminiModelRequest(config) {
  const model = getSelectedGeminiModel();
  if (model) {
    config.headers = config.headers || {};
    config.headers['X-Gemini-Model'] = model;
  }
  return config;
}
