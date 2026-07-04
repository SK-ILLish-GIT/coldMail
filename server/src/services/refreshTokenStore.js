import { nanoid } from 'nanoid';

import { getDb } from './db.js';
import { signRefreshToken, REFRESH_TTL_MS } from './jwt.js';

// One record per issued refresh token (identified by its `jti`). Rotation
// revokes the old jti and issues a new one on every refresh; presenting a
// revoked jti signals token theft/reuse and triggers a full revoke. Expired
// records auto-purge via the TTL index on `expiresAt` (see db.js).
const COLLECTION = 'refresh_tokens';

function col() {
  return getDb().collection(COLLECTION);
}

/** Create a new refresh token + its tracking record. Returns the signed token. */
export async function issueRefreshToken(userId) {
  const jti = nanoid(24);
  const now = Date.now();
  await col().insertOne({
    jti,
    userId,
    revoked: false,
    createdAt: new Date(now),
    expiresAt: new Date(now + REFRESH_TTL_MS),
  });
  return signRefreshToken(userId, jti);
}

export async function findActive(jti) {
  const rec = await col().findOne({ jti });
  if (!rec) return null;
  if (rec.revoked) return { ...rec, active: false };
  if (rec.expiresAt && rec.expiresAt.getTime() < Date.now()) {
    return { ...rec, active: false };
  }
  return { ...rec, active: true };
}

export async function revoke(jti) {
  await col().updateOne({ jti }, { $set: { revoked: true } });
}

export async function revokeAllForUser(userId) {
  await col().updateMany({ userId }, { $set: { revoked: true } });
}

/** Revoke the old jti and issue a fresh token in one step. */
export async function rotate(userId, oldJti) {
  await revoke(oldJti);
  return issueRefreshToken(userId);
}
