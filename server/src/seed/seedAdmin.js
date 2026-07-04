import { getDb } from '../services/db.js';
import { findByEmail, createUser } from '../services/userStore.js';

// Collections whose pre-auth documents were global (no owner). On first boot
// with an admin seed configured, they get assigned to the admin user.
const OWNED_COLLECTIONS = ['templates', 'sent_log', 'resumes', 'tailor_sessions'];

/**
 * Idempotent boot seed. If SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD are set:
 *   1. Create the admin user if it doesn't exist (never resets an existing one).
 *   2. Assign every currently-unowned document to that admin.
 * Safe to run on every boot — steps become no-ops once satisfied.
 */
export async function seedAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL || '').trim();
  const password = process.env.SEED_ADMIN_PASSWORD || '';
  const name = (process.env.SEED_ADMIN_NAME || 'Sahil').trim();

  if (!email || !password) return;

  let admin = await findByEmail(email);
  if (!admin) {
    admin = await createUser({ email, name, password });
    console.log(`[coldMail] seeded admin user ${email}`);
  }

  const db = getDb();
  let claimed = 0;
  await Promise.all(
    OWNED_COLLECTIONS.map(async (name) => {
      const res = await db
        .collection(name)
        .updateMany({ userId: { $exists: false } }, { $set: { userId: admin.id } });
      claimed += res.modifiedCount || 0;
    })
  );
  if (claimed > 0) {
    console.log(`[coldMail] assigned ${claimed} existing document(s) to ${email}`);
  }
}
