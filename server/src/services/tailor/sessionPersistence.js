import { getDb } from '../db.js';
import { requireCurrentUserId } from '../userContext.js';

export const TAILOR_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const COLLECTION = 'tailor_sessions';
const cache = new Map();

function collection() {
  return getDb().collection(COLLECTION);
}

// Namespace by owner so a cached session can never be served to another user.
function cacheKey(kind, id) {
  return `${requireCurrentUserId()}:${kind}:${id}`;
}

export function touchSessionTimestamps(session) {
  const now = Date.now();
  session.expiresAt = now + TAILOR_SESSION_TTL_MS;
  session.updatedAt = now;
}

export function cacheSession(kind, session) {
  cache.set(cacheKey(kind, session.id), session);
}

export function dropCached(kind, id) {
  cache.delete(cacheKey(kind, id));
}

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
}

function docForMongo(doc) {
  return {
    ...doc,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
    expiresAt: new Date(doc.expiresAt),
  };
}

export async function persistSessionDoc(doc) {
  const userId = requireCurrentUserId();
  await collection().replaceOne(
    { id: doc.id, kind: doc.kind, userId },
    docForMongo({ ...doc, userId }),
    { upsert: true }
  );
}

export async function loadSessionDoc(id, kind) {
  const key = cacheKey(kind, id);
  const hit = cache.get(key);
  if (hit && hit.expiresAt >= Date.now() && hit.status !== 'abandoned') {
    return hit;
  }
  if (hit) cache.delete(key);

  const doc = await collection().findOne(
    { id, kind, userId: requireCurrentUserId(), status: { $ne: 'abandoned' } },
    { projection: { _id: 0 } }
  );
  if (!doc || toMs(doc.expiresAt) < Date.now()) return null;
  return normalizeDoc(doc);
}

function normalizeDoc(doc) {
  if (!doc) return null;
  return {
    ...doc,
    createdAt: toMs(doc.createdAt),
    updatedAt: toMs(doc.updatedAt),
    expiresAt: toMs(doc.expiresAt),
  };
}

export async function findLatestActiveDoc(kind) {
  const doc = await collection().findOne(
    {
      kind,
      userId: requireCurrentUserId(),
      status: { $ne: 'abandoned' },
      expiresAt: { $gt: new Date() },
    },
    {
      sort: { updatedAt: -1 },
      projection: { _id: 0 },
    }
  );
  return normalizeDoc(doc);
}

export async function abandonSession(id, kind) {
  dropCached(kind, id);
  await collection().updateOne(
    { id, kind, userId: requireCurrentUserId() },
    { $set: { status: 'abandoned', updatedAt: Date.now() } }
  );
}

export async function evictExpiredFromDb() {
  const now = Date.now();
  await collection().deleteMany({ expiresAt: { $lt: new Date(now) } });
  for (const [key, s] of cache.entries()) {
    if (s.expiresAt < now) cache.delete(key);
  }
}
