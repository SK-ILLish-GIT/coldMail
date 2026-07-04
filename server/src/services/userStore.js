import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

import { getDb } from './db.js';

const COLLECTION = 'users';
const SALT_ROUNDS = 10;

function col() {
  return getDb().collection(COLLECTION);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** The client-safe shape — never leaks passwordHash or _id. */
export function toPublicUser(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    email: doc.email,
    name: doc.name,
    createdAt: doc.createdAt,
  };
}

export async function findByEmail(email) {
  return col().findOne({ email: normalizeEmail(email) });
}

export async function findById(id) {
  return col().findOne({ id });
}

export async function createUser({ email, name, password }) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const now = new Date().toISOString();
  const doc = {
    id: nanoid(12),
    email: normalizeEmail(email),
    name: String(name || '').trim(),
    passwordHash,
    createdAt: now,
    updatedAt: now,
  };
  await col().insertOne(doc);
  return toPublicUser(doc);
}

export async function verifyPassword(doc, password) {
  if (!doc?.passwordHash) return false;
  return bcrypt.compare(password, doc.passwordHash);
}

export async function updateProfile(id, { name }) {
  const $set = { updatedAt: new Date().toISOString() };
  if (typeof name === 'string') $set.name = name.trim();
  const res = await col().findOneAndUpdate(
    { id },
    { $set },
    { returnDocument: 'after' }
  );
  return toPublicUser(res?.value || res || null);
}

export async function updatePassword(id, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await col().updateOne(
    { id },
    { $set: { passwordHash, updatedAt: new Date().toISOString() } }
  );
}
