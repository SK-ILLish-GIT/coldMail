/** User-facing message for Gemini / quota failures from the API. */
export function formatGeminiError(err) {
  const msg = (err?.message || '').trim();
  if (!msg) return 'Something went wrong. Please try again.';

  if (
    err?.status === 429 ||
    /quota|free-tier|rate limit|too many requests/i.test(msg)
  ) {
    if (!msg.startsWith('[GoogleGenerativeAI') && msg.length <= 500) {
      return msg;
    }
    return (
      'Gemini API quota reached (free tier is often ~20 requests/day per model). ' +
      'Wait for the limit to reset, choose another model from the header dropdown, ' +
      'or enable billing at https://aistudio.google.com/'
    );
  }

  return msg
    .replace(/^\[GoogleGenerativeAI Error\]:\s*/i, '')
    .replace(/Error fetching from [^\s]+:\s*/i, '')
    .slice(0, 400);
}

export function isGeminiQuotaError(err) {
  return (
    err?.status === 429 ||
    /quota|free-tier|rate limit|too many requests/i.test(err?.message || '')
  );
}
