import jwt from 'jsonwebtoken';

// Two independent secrets so a leaked access secret can't mint refresh tokens.
// Fallbacks keep local dev working; production MUST set real secrets.
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me';
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TTL = process.env.JWT_REFRESH_TTL || '30d';

if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET)
) {
  console.warn(
    '[coldMail] JWT_ACCESS_SECRET / JWT_REFRESH_SECRET are not set — using insecure dev defaults. Set them in the environment.'
  );
}

const DURATION_RE = /^(\d+)\s*([smhd])$/i;
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parse a jsonwebtoken-style duration ("15m", "30d") into milliseconds. */
export function durationToMs(value) {
  if (typeof value === 'number') return value;
  const m = DURATION_RE.exec(String(value).trim());
  if (!m) return 0;
  return Number(m[1]) * UNIT_MS[m[2].toLowerCase()];
}

export const REFRESH_TTL_MS = durationToMs(REFRESH_TTL);

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

export function signRefreshToken(userId, jti) {
  return jwt.sign({ sub: userId, jti }, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}
