import { getDb } from './db.js';
import { requireCurrentUserId } from './userContext.js';

// Strip Mongo's internal _id and the ownership field from outgoing documents
// so the JSON API shape stays identical to what the client expects.
const STRIP_ID = { projection: { _id: 0, userId: 0 } };

/**
 * Returns a tiny CRUD-ish store backed by a MongoDB collection. Every
 * operation is scoped to the current authenticated user (via userContext), so
 * users only ever see and mutate their own documents.
 * Documents are expected to carry their own `id: string` (nanoid).
 */
export function createCollection(name) {
  const col = () => getDb().collection(name);

  return {
    async list() {
      return col().find({ userId: requireCurrentUserId() }, STRIP_ID).toArray();
    },

    async append(item) {
      // insertOne mutates its arg by adding _id; clone so callers don't see it,
      // and stamp the owner without leaking it back in the returned item.
      await col().insertOne({ ...item, userId: requireCurrentUserId() });
      return item;
    },

    /**
     * Upsert by document id (default) or any custom key field, scoped to owner.
     */
    async upsert(item, keyFn = (x) => x.id) {
      const userId = requireCurrentUserId();
      const key = keyFn(item);
      await col().replaceOne(
        { id: key, userId },
        { ...item, userId },
        { upsert: true }
      );
      return item;
    },

    /**
     * Delete documents matching the given filter (scoped to owner). Routes
     * only ever delete by `{ id }`.
     */
    async remove(filter) {
      const res = await col().deleteMany({ ...filter, userId: requireCurrentUserId() });
      return res.deletedCount;
    },

    async clear() {
      await col().deleteMany({ userId: requireCurrentUserId() });
    },
  };
}

export const templatesStore = createCollection('templates');
export const sentLogStore = createCollection('sent_log');
