/**
 * Resolve owner email from MongoDB and obtain JWT for CLI/API scripts.
 * Email comes from DB; password must be in env (stored hashed in DB).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, '../../server/package.json'));
require('dotenv').config({ path: path.resolve(__dirname, '../../server/.env') });

import { connect, disconnect, getDb } from '../../server/src/services/db.js';
import { findByEmail } from '../../server/src/services/userStore.js';

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Load owner email from users collection (SEED_ADMIN_EMAIL hint or first user). */
export async function resolveOwnerEmailFromDb() {
  await connect();
  const hint = (
    process.env.COLDMAIL_OWNER_EMAIL ||
    process.env.SEED_ADMIN_EMAIL ||
    process.env.COLDMAIL_EMAIL ||
    ''
  ).trim();

  if (hint) {
    const user = await findByEmail(hint);
    if (!user) {
      throw new AuthError(`User not found in database: ${hint}`);
    }
    return user.email;
  }

  const user = await getDb()
    .collection('users')
    .findOne({}, { sort: { createdAt: 1 }, projection: { email: 1 } });
  if (!user?.email) {
    throw new AuthError(
      'No users in database. Set SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD or sign up in the UI.'
    );
  }
  return user.email;
}

function resolvePasswordFromEnv() {
  const password =
    process.env.COLDMAIL_PASSWORD ||
    process.env.SEED_ADMIN_PASSWORD ||
    '';
  if (!password) {
    throw new AuthError(
      'Password not in database (bcrypt hash only). Set COLDMAIL_PASSWORD or SEED_ADMIN_PASSWORD in server/.env.'
    );
  }
  return password;
}

/** POST /auth/login → accessToken */
export async function loginForAccessToken(baseUrl) {
  const email = await resolveOwnerEmailFromDb();
  const password = resolvePasswordFromEnv();
  const base = baseUrl.replace(/\/$/, '');

  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    throw new AuthError(data?.error || `Login failed (${res.status})`);
  }
  if (!data?.accessToken) {
    throw new AuthError('Login succeeded but no accessToken returned.');
  }
  return { accessToken: data.accessToken, email, user: data.user };
}

/** Prefer COLDMAIL_ACCESS_TOKEN; else login via DB email + env password. */
export async function resolveAccessToken(baseUrl) {
  const preset = (process.env.COLDMAIL_ACCESS_TOKEN || '').trim();
  if (preset) return { accessToken: preset, email: null, fromEnv: true };

  const session = await loginForAccessToken(baseUrl);
  return { ...session, fromEnv: false };
}

export async function closeDb() {
  await disconnect().catch(() => {});
}
