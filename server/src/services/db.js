import { MongoClient } from 'mongodb';

let client = null;
let db = null;
let indexesEnsured = false;

function getUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri || !uri.trim()) {
    throw new Error(
      'MONGODB_URI is required. Set it in server/.env (see server/.env.example).'
    );
  }
  return uri.trim();
}

async function ensureIndexes(database) {
  if (indexesEnsured) return;
  await Promise.all([
    database.collection('templates').createIndex({ updatedAt: -1 }),
    database.collection('templates').createIndex({ id: 1 }, { unique: true }),
    database.collection('sent_log').createIndex({ sentAt: -1 }),
    database.collection('sent_log').createIndex({ status: 1 }),
    database.collection('sent_log').createIndex({ id: 1 }, { unique: true }),
    database.collection('resumes').createIndex({ createdAt: -1 }),
    database.collection('resumes').createIndex({ id: 1 }, { unique: true }),
  ]);
  indexesEnsured = true;
}

/**
 * Connect to MongoDB Atlas (or any Mongo). Idempotent — repeat calls return
 * the cached handle. Throws fast (5s) if the URI is bad or the cluster is
 * unreachable, so callers can fail the boot cleanly.
 */
export async function connect() {
  if (db) return db;

  const uri = getUri();
  const dbName = (process.env.MONGODB_DB || 'coldmail').trim();

  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  db = client.db(dbName);
  await ensureIndexes(db);
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('Mongo not connected. Call connect() before using getDb().');
  }
  return db;
}

export async function ping() {
  if (!db) return false;
  try {
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function disconnect() {
  if (client) {
    await client.close();
  }
  client = null;
  db = null;
  indexesEnsured = false;
}
