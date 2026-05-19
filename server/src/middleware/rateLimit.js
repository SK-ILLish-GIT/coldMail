import rateLimit from 'express-rate-limit';

const windowMin = Number(process.env.RATE_LIMIT_WINDOW_MIN) || 1;
const max = Number(process.env.RATE_LIMIT_MAX) || 30;

/**
 * Throttles outbound email endpoints per client IP. Bulk requests count as a
 * single hit here; pacing inside a bulk request is handled in the route.
 */
export const sendLimiter = rateLimit({
  windowMs: windowMin * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: `Too many requests. Limit is ${max} per ${windowMin} minute(s).`,
  },
  skip: (req) => {
    // Throttle the actual send routes plus the AI enrichment endpoint
    // (OpenAI calls cost money). Preview & reads pass through.
    // baseUrl + path covers both /api/send-* (mounted at /api) and
    // /api/enrich/email (mounted at /api/enrich).
    const full = (req.baseUrl || '') + req.path;
    return !(
      full === '/api/send-email' ||
      full === '/api/send-bulk' ||
      full === '/api/enrich/email'
    );
  },
});
