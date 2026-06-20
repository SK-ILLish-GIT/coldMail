/** User-facing message for AI provider / quota failures from the API. */
export function formatAiError(err) {
  const msg = (err?.message || "").trim();
  if (!msg) return "Something went wrong. Please try again.";

  if (
    err?.status === 429 ||
    /quota|free-tier|rate limit|too many requests/i.test(msg)
  ) {
    if (!msg.startsWith("[GoogleGenerativeAI") && msg.length <= 500) {
      return msg;
    }
    return (
      "AI API quota reached. Wait for the limit to reset, choose another model or provider in settings," +
      " or check your API key limits."
    );
  }

  return msg
    .replace(/^\[GoogleGenerativeAI Error\]:\s*/i, "")
    .replace(/Error fetching from [^\s]+:\s*/i, "")
    .replace(/^Groq API error \(\d+\):\s*/i, "")
    .slice(0, 400);
}

/** @deprecated use formatAiError */
export const formatGeminiError = formatAiError;

export function isAiQuotaError(err) {
  return (
    err?.status === 429 ||
    /quota|free-tier|rate limit|too many requests/i.test(err?.message || "")
  );
}

/** @deprecated use isAiQuotaError */
export const isGeminiQuotaError = isAiQuotaError;
