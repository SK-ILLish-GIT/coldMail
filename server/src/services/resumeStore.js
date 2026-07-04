import { Binary } from 'mongodb';
import { nanoid } from 'nanoid';

import { getDb } from './db.js';
import { requireCurrentUserId } from './userContext.js';
import { normalizeTags } from '../utils/tags.js';
import {
  isS3Enabled,
  resumeObjectKey,
  putObject,
  getObjectBuffer,
  deleteObject,
} from './s3.js';

const COLLECTION = 'resumes';

// Never expose ownership fields or storage internals to the API.
const META_PROJECTION = { projection: { content: 0, userId: 0, s3Key: 0 } };

function col() {
  return getDb().collection(COLLECTION);
}

function toBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Binary) return value.buffer;
  if (value.buffer && Buffer.isBuffer(value.buffer)) return value.buffer;
  return Buffer.from(value);
}

async function loadContent(doc) {
  if (!doc) return null;
  if (doc.s3Key) {
    return getObjectBuffer(doc.s3Key);
  }
  return toBuffer(doc.content);
}

async function persistBytes(userId, resumeId, content, contentType) {
  if (isS3Enabled() && content) {
    const s3Key = resumeObjectKey(userId, resumeId);
    await putObject(s3Key, content, contentType || 'application/pdf');
    return { s3Key, content: undefined };
  }
  return { s3Key: undefined, content };
}

export const resumeStore = {
  async list() {
    return col()
      .find({ userId: requireCurrentUserId() }, META_PROJECTION)
      .sort({ createdAt: -1 })
      .toArray();
  },

  async get(id) {
    const doc = await col().findOne({ id, userId: requireCurrentUserId() });
    if (!doc) return null;
    const content = await loadContent(doc);
    return { ...doc, content };
  },

  async create({ name, filename, contentType, size, content, tags, tailoredFor }) {
    const userId = requireCurrentUserId();
    const id = nanoid(10);
    const createdAt = new Date().toISOString();
    const normTags = normalizeTags(tags);
    const stored = await persistBytes(userId, id, content, contentType);
    const doc = {
      id,
      userId,
      name: String(name || '').trim(),
      filename: String(filename || '').trim(),
      contentType: contentType || 'application/pdf',
      size: Number(size) || (content ? content.length : 0),
      tags: normTags,
      createdAt,
      ...(stored.s3Key ? { s3Key: stored.s3Key } : { content }),
    };
    if (tailoredFor && typeof tailoredFor === 'object') doc.tailoredFor = tailoredFor;
    await col().insertOne(doc);
    return {
      id,
      name: doc.name,
      filename: doc.filename,
      contentType: doc.contentType,
      size: doc.size,
      tags: normTags,
      createdAt,
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
      { returnDocument: 'after', ...META_PROJECTION }
    );
    return res?.value || res || null;
  },

  async replaceContent(id, { filename, contentType, size, content }) {
    const userId = requireCurrentUserId();
    const existing = await col().findOne({ id, userId });
    if (!existing) return null;

    let s3Key = existing.s3Key;
    if (isS3Enabled() && content) {
      s3Key = s3Key || resumeObjectKey(userId, id);
      await putObject(s3Key, content, contentType || 'application/pdf');
    }

    const $set = {
      filename: String(filename || '').trim(),
      contentType: contentType || 'application/pdf',
      size: Number(size) || (content ? content.length : 0),
      updatedAt: new Date().toISOString(),
    };
    const update = { $set };
    if (isS3Enabled() && s3Key) {
      $set.s3Key = s3Key;
      update.$unset = { content: '' };
    } else {
      $set.content = content;
    }

    const res = await col().findOneAndUpdate(
      { id, userId },
      update,
      { returnDocument: 'after', ...META_PROJECTION }
    );
    return res?.value || res || null;
  },

  async delete(id) {
    const userId = requireCurrentUserId();
    const doc = await col().findOne({ id, userId });
    if (!doc) return false;
    const res = await col().deleteOne({ id, userId });
    if (res.deletedCount > 0 && doc.s3Key) {
      await deleteObject(doc.s3Key);
    }
    return res.deletedCount > 0;
  },

  async setDefault(id, flag = true) {
    const userId = requireCurrentUserId();
    if (!flag) {
      const res = await col().findOneAndUpdate(
        { id, userId },
        { $unset: { isDefault: '' } },
        { returnDocument: 'after', ...META_PROJECTION }
      );
      return res?.value || res || null;
    }
    const res = await col().findOneAndUpdate(
      { id, userId },
      { $set: { isDefault: true } },
      { returnDocument: 'after', ...META_PROJECTION }
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
