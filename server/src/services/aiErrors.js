import { getAiModel, getAiProvider } from './aiModel.js';

function parseRetrySeconds(message) {
  const direct = message.match(/retry in ([\d.]+)s/i);
  if (direct) return Math.ceil(Number(direct[1]));
  const jsonDelay = message.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (jsonDelay) return Number(jsonDelay[1]);
  return null;
}

function isGeminiMessage(message) {
  return /GoogleGenerativeAI|generativelanguage\.googleapis\.com|gemini-/i.test(
    message || ''
  );
}

function isGroqMessage(message) {
  return /groq\.com|Groq API error/i.test(message || '');
}

function isQuotaOrRateLimit(message) {
  return /quota|429|too many requests|rate.?limit|exceeded/i.test(message || '');
}

function mapGeminiQuotaError(message) {
  const retrySec = parseRetrySeconds(message);
  const dailyLimit = /PerDay|per day|free_tier_requests/i.test(message);
  const modelMatch = message.match(/model:\s*([^\s,\]]+)/i);
  const model = modelMatch?.[1] || getAiModel();

  let friendly = dailyLimit
    ? `Gemini free-tier daily limit reached for ${model} (typically 20 requests/day on the free plan).`
    : `Gemini rate limit reached for ${model}.`;

  if (retrySec && !dailyLimit) {
    friendly += ` Try again in about ${retrySec} seconds.`;
  } else if (dailyLimit) {
    friendly += ' Usage resets on a rolling 24h window, or enable billing / use another API key.';
  } else if (retrySec) {
    friendly += ` You can try again in about ${retrySec} seconds, or wait until the daily quota resets.`;
  }

  friendly +=
    ' Options: pick another model in the header dropdown, wait for quota reset, or add billing at https://aistudio.google.com/';

  const e = new Error(friendly);
  e.status = 429;
  return e;
}

function mapGroqQuotaError(message) {
  const retrySec = parseRetrySeconds(message);
  const model = getAiModel();
  let friendly = `Groq rate limit reached for ${model}.`;
  if (retrySec) {
    friendly += ` Try again in about ${retrySec} seconds.`;
  }
  friendly +=
    ' Options: pick another model, switch to Gemini in settings, or check limits at https://console.groq.com/';
  const e = new Error(friendly);
  e.status = 429;
  return e;
}

/**
 * Map raw AI provider errors to short HttpErrors for the UI.
 * Returns null when the error is unrelated to configured providers.
 */
export function mapAiError(err) {
  const message = err?.message || String(err || '');
  const provider = getAiProvider();

  if (!isGeminiMessage(message) && !isGroqMessage(message) && !isQuotaOrRateLimit(message)) {
    return null;
  }

  if (isQuotaOrRateLimit(message) || err?.status === 429) {
    if (provider === 'groq' || isGroqMessage(message)) {
      return mapGroqQuotaError(message);
    }
    return mapGeminiQuotaError(message);
  }

  if (isGroqMessage(message)) {
    const short = message
      .replace(/^Groq API error \(\d+\):\s*/i, '')
      .slice(0, 280);
    const e = new Error(short || 'Groq request failed.');
    e.status = err?.status === 429 ? 429 : 502;
    return e;
  }

  const short = message
    .replace(/^\[GoogleGenerativeAI Error\]:\s*/i, '')
    .replace(/Error fetching from [^\s]+:\s*/i, '')
    .slice(0, 280);

  const e = new Error(short || 'Gemini request failed.');
  e.status = err?.status === 429 ? 429 : 502;
  return e;
}

export function throwIfAiError(err) {
  const mapped = mapAiError(err);
  if (mapped) throw mapped;
  throw err;
}

/** @deprecated use mapAiError */
export function mapGeminiError(err) {
  return mapAiError(err);
}

/** @deprecated use throwIfAiError */
export function throwIfGeminiError(err) {
  return throwIfAiError(err);
}
