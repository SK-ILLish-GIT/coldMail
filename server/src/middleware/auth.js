import { HttpError } from './error.js';
import { verifyAccessToken } from '../services/jwt.js';
import { findById, toPublicUser } from '../services/userStore.js';
import { runWithUser } from '../services/userContext.js';

const BEARER_RE = /^Bearer\s+(.+)$/i;

/**
 * Gate for protected routes. Verifies the access token from the
 * Authorization header, loads the user, attaches `req.user`, and runs the
 * rest of the request inside the per-user AsyncLocalStorage context so every
 * store scopes its queries automatically. Mirrors aiModelMiddleware's style.
 */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.get('Authorization') || '';
    const match = BEARER_RE.exec(header);
    if (!match) throw new HttpError(401, 'Not authenticated');

    let payload;
    try {
      payload = verifyAccessToken(match[1]);
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }

    const user = await findById(payload.sub);
    if (!user) throw new HttpError(401, 'Account no longer exists');

    req.user = toPublicUser(user);
    runWithUser(user.id, () => next());
  } catch (err) {
    next(err);
  }
}
