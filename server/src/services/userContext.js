import { AsyncLocalStorage } from 'node:async_hooks';

import { HttpError } from '../middleware/error.js';

// Per-request identity, carried the same way as the AI model context
// (services/aiModel.js). requireAuth runs the rest of the request inside
// runWithUser(), so every store can read the current userId without threading
// it through dozens of call sites.
const storage = new AsyncLocalStorage();

export function runWithUser(userId, fn) {
  return storage.run({ userId }, fn);
}

export function getCurrentUserId() {
  return storage.getStore()?.userId;
}

/**
 * For data-access code that must be scoped to a user. Throws 401 if called
 * outside an authenticated request context — a safety net so an un-scoped
 * query can never accidentally read or write across users.
 */
export function requireCurrentUserId() {
  const userId = getCurrentUserId();
  if (!userId) throw new HttpError(401, 'Not authenticated');
  return userId;
}
