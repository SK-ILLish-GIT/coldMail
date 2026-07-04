import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

import { createApp } from './app.js';
import { connect, disconnect } from './services/db.js';
import { seedAdmin } from './seed/seedAdmin.js';

// Anchor .env to the server/ directory so `npm start` works from either
// the repo root (production single-origin deploy) or the server folder
// (local dev). On Render, secrets come from the dashboard and there's no
// .env file — dotenv silently no-ops, which is exactly what we want.
// Safe to run after imports because every module reads process.env lazily
// (inside functions, not at import time).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, '..', '.env') });

const port = Number(process.env.PORT) || 4000;

async function main() {
  try {
    await connect();
    console.log(
      `[coldMail] storage: mongodb (db=${(process.env.MONGODB_DB || 'coldmail').trim()})`
    );
    try {
      await seedAdmin();
    } catch (err) {
      console.error(`[coldMail] admin seed failed (continuing): ${err.message}`);
    }
  } catch (err) {
    console.error(
      `[coldMail] Cannot connect to MongoDB: ${err.message}\n` +
        '  Check MONGODB_URI in server/.env and that your Atlas Network Access\n' +
        '  allowlist includes this machine.'
    );
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`[coldMail] API listening on http://localhost:${port}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[coldMail] ${signal} received, shutting down...`);
    server.close(async () => {
      try {
        await disconnect();
      } catch (err) {
        console.error('[coldMail] error closing Mongo:', err);
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
