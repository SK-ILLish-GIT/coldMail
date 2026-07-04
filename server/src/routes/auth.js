import { Router } from 'express';

import { HttpError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import {
  validateSignup,
  validateLogin,
  validateChangePassword,
} from '../middleware/validate.js';
import {
  findByEmail,
  findById,
  createUser,
  verifyPassword,
  updateProfile,
  updatePassword,
  toPublicUser,
} from '../services/userStore.js';
import {
  issueRefreshToken,
  findActive,
  rotate,
  revoke,
  revokeAllForUser,
} from '../services/refreshTokenStore.js';
import {
  signAccessToken,
  verifyRefreshToken,
  REFRESH_TTL_MS,
} from '../services/jwt.js';

const router = Router();

const REFRESH_COOKIE = 'refreshToken';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // Scope the cookie to the auth endpoints only, so it is never attached to
    // normal API calls (those use the Authorization: Bearer access token).
    path: '/api/auth',
    maxAge: REFRESH_TTL_MS,
  };
}

async function establishSession(res, user) {
  const refreshToken = await issueRefreshToken(user.id);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return signAccessToken(user);
}

// POST /api/auth/signup
router.post('/signup', authLimiter, validateSignup, async (req, res, next) => {
  try {
    const { email, name, password } = req.body;
    const existing = await findByEmail(email);
    if (existing) throw new HttpError(409, 'An account with that email already exists.');
    const user = await createUser({ email, name, password });
    const accessToken = await establishSession(res, user);
    res.status(201).json({ accessToken, user });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, validateLogin, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const doc = await findByEmail(email);
    const ok = doc && (await verifyPassword(doc, password));
    if (!ok) throw new HttpError(401, 'Invalid email or password.');
    const user = toPublicUser(doc);
    const accessToken = await establishSession(res, user);
    res.json({ accessToken, user });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh — rotate the refresh token, mint a new access token.
router.post('/refresh', authLimiter, async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new HttpError(401, 'No refresh token.');

    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      throw new HttpError(401, 'Invalid refresh token.');
    }

    const rec = await findActive(payload.jti);
    if (!rec) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      throw new HttpError(401, 'Session not found.');
    }
    if (!rec.active) {
      // A revoked jti being replayed means the token was stolen/reused —
      // revoke every session for this user as a safety measure.
      await revokeAllForUser(payload.sub);
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      throw new HttpError(401, 'Session expired. Please sign in again.');
    }

    const user = toPublicUser(await findById(payload.sub));
    if (!user) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      throw new HttpError(401, 'Account no longer exists.');
    }

    const newRefresh = await rotate(payload.sub, payload.jti);
    res.cookie(REFRESH_COOKIE, newRefresh, refreshCookieOptions());
    res.json({ accessToken: signAccessToken(user), user });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout — revoke the current refresh token + clear the cookie.
router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      try {
        const payload = verifyRefreshToken(token);
        if (payload?.jti) await revoke(payload.jti);
      } catch {
        /* token already invalid — nothing to revoke */
      }
    }
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// PATCH /api/auth/profile — update display name.
router.patch('/profile', requireAuth, async (req, res, next) => {
  try {
    const name = req.body?.name;
    if (typeof name !== 'string' || !name.trim()) {
      throw new HttpError(400, 'Name cannot be empty.');
    }
    if (name.trim().length > 120) {
      throw new HttpError(400, 'Name too long (max 120 chars).');
    }
    const user = await updateProfile(req.user.id, { name });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/change-password — verify current, set new, revoke other sessions.
router.post(
  '/change-password',
  requireAuth,
  validateChangePassword,
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const doc = await findById(req.user.id);
      const ok = doc && (await verifyPassword(doc, currentPassword));
      if (!ok) throw new HttpError(401, 'Current password is incorrect.');

      await updatePassword(req.user.id, newPassword);
      // Invalidate all sessions, then re-establish one for this client so the
      // user stays logged in here but is signed out everywhere else.
      await revokeAllForUser(req.user.id);
      const accessToken = await establishSession(res, req.user);
      res.json({ ok: true, accessToken });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
