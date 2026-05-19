import { getDb } from './db.js';

// Strip Mongo's internal _id from outgoing documents so the JSON API shape
// stays identical to what the client (and our tests) expect.
const STRIP_ID = { projection: { _id: 0 } };

/**
 * Returns a tiny CRUD-ish store backed by a MongoDB collection.
 * Documents are expected to carry their own `id: string` (nanoid).
 */
export function createCollection(name) {
  const col = () => getDb().collection(name);

  return {
    async list() {
      return col().find({}, STRIP_ID).toArray();
    },

    async append(item) {
      // insertOne mutates `item` by adding _id; clone so callers don't see it.
      await col().insertOne({ ...item });
      return item;
    },

    /**
     * Upsert by document id (default) or any custom key field.
     */
    async upsert(item, keyFn = (x) => x.id) {
      const key = keyFn(item);
      await col().replaceOne({ id: key }, { ...item }, { upsert: true });
      return item;
    },

    /**
     * Delete documents matching the given filter. Filter can be a Mongo
     * filter object — routes only ever delete by `{ id }`.
     */
    async remove(filter) {
      const res = await col().deleteMany(filter);
      return res.deletedCount;
    },

    async clear() {
      await col().deleteMany({});
    },
  };
}

export const templatesStore = createCollection('templates');
export const sentLogStore = createCollection('sent_log');
