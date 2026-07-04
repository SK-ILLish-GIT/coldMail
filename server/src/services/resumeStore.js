import { Binary } from 'mongodb';
import { nanoid } from 'nanoid';

import { getDb } from './db.js';
import { requireCurrentUserId } from './userContext.js';
import { normalizeTags } from '../utils/tags.js';

const COLLECTION = 'resumes';

function col() {
  return getDb().collection(COLLECTION);
}

// Mongo's driver returns Binary for binary fields. Normalise to a Node Buffer.
function toBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Binary) return value.buffer;
  if (value.buffer && Buffer.isBuffer(value.buffer)) return value.buffer;
  return Buffer.from(value);
}

/**
 * Library of resume PDFs stored inline in MongoDB. Designed for a small
 * personal collection (5-50 docs). A single MongoDB document is capped at
 * 16 MB; we cap individual files at 10 MB in the upload middleware so this
 * stays comfortably inside that limit.
 */
export const resumeStore = {
  async list() {
    return col()
      .find({ userId: requireCurrentUserId() }, { projection: { content: 0, userId: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
  },

  async get(id) {
    const doc = await col().findOne({ id, userId: requireCurrentUserId() });
    if (!doc) return null;
    return { ...doc, content: toBuffer(doc.content) };
  },

  async create({ name, filename, contentType, size, content, tags, tailoredFor }) {
    const id = nanoid(10);
    const createdAt = new Date().toISOString();
    const normTags = normalizeTags(tags);
    const doc = {
      id,
      userId: requireCurrentUserId(),
      name: String(name || '').trim(),
      filename: String(filename || '').trim(),
      contentType: contentType || 'application/pdf',
      size: Number(size) || (content ? content.length : 0),
      tags: normTags,
      content,
      createdAt,
    };
    if (tailoredFor && typeof tailoredFor === 'object') doc.tailoredFor = tailoredFor;
    await col().insertOne(doc);
    return {
      id, name, filename, contentType, size, tags: normTags, createdAt,
      ...(doc.tailoredFor ? { tailoredFor: doc.tailoredFor } : {}),
    };
  },

  async update(id, { name, tags }) {
    const $set = { updatedAt: new Date().toISOString() };
    if (typeof name === 'string') $set.name = name.trim();
    if (tags !== undefined) $set.tags = normalizeTags(tags);
    const res = await col().findOneAndUpdate(
      { id, userId: requireCurrentUserId() },
      { $set },
      { returnDocument: 'after', projection: { content: 0, userId: 0 } }
    );
    return res?.value || res || null;
  },

  async replaceContent(id, { filename, contentType, size, content }) {
    const $set = {
      filename: String(filename || '').trim(),
      contentType: contentType || 'application/pdf',
      size: Number(size) || (content ? content.length : 0),
      content,
      updatedAt: new Date().toISOString(),
    };
    const res = await col().findOneAndUpdate(
      { id, userId: requireCurrentUserId() },
      { $set },
      { returnDocument: 'after', projection: { content: 0, userId: 0 } }
    );
    return res?.value || res || null;
  },

  async delete(id) {
    const res = await col().deleteOne({ id, userId: requireCurrentUserId() });
    return res.deletedCount > 0;
  },

  // Mark one resume as the user's default (or clear it). At most one default
  // per user. Returns the updated metadata, or null if not found / not owned.
  async setDefault(id, flag = true) {
    const userId = requireCurrentUserId();
    const projection = { content: 0, userId: 0 };
    if (!flag) {
      const res = await col().findOneAndUpdate(
        { id, userId },
        { $unset: { isDefault: '' } },
        { returnDocument: 'after', projection }
      );
      return res?.value || res || null;
    }
    const res = await col().findOneAndUpdate(
      { id, userId },
      { $set: { isDefault: true } },
      { returnDocument: 'after', projection }
    );
    const updated = res?.value || res || null;
    if (!updated) return null;
    await col().updateMany(
      { userId, isDefault: true, id: { $ne: id } },
      { $unset: { isDefault: '' } }
    );
    return updated;
  },
};
