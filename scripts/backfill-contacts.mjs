#!/usr/bin/env node
/**
 * One-time backfill: sent_log → company_contacts
 * Usage: npm run contacts:backfill
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, '../server/package.json'));
require('dotenv').config({ path: path.resolve(__dirname, '../server/.env') });

import { connect, disconnect, getDb } from '../server/src/services/db.js';
import { findByEmail } from '../server/src/services/userStore.js';
import { contactStore } from '../server/src/services/contactStore.js';

async function main() {
  const email = (process.env.COLDMAIL_OWNER_EMAIL || process.env.SEED_ADMIN_EMAIL || '').trim();
  if (!email) {
    console.error('Set COLDMAIL_OWNER_EMAIL or SEED_ADMIN_EMAIL in server/.env');
    process.exit(1);
  }

  await connect();
  const user = await findByEmail(email);
  if (!user) {
    console.error(`User not found: ${email}`);
    await disconnect();
    process.exit(1);
  }

  const rows = await getDb()
    .collection('sent_log')
    .find({ userId: user.id, status: { $in: ['drafted', 'sent'] } })
    .sort({ sentAt: 1 })
    .toArray();

  let processed = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!String(row.company || '').trim() || !row.to) {
      skipped += 1;
      continue;
    }
    await contactStore.upsertFromDraftForUser(user.id, {
      company: row.company,
      email: row.to,
      name: row.name || '',
      contactedAt: row.sentAt || new Date().toISOString(),
    });
    processed += 1;
  }

  const totalContacts = await getDb()
    .collection('company_contacts')
    .countDocuments({ userId: user.id });

  console.log(
    JSON.stringify(
      {
        ok: true,
        user: email,
        logRows: rows.length,
        processed,
        skipped,
        uniqueContacts: totalContacts,
      },
      null,
      2
    )
  );

  await disconnect();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try {
    await disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
