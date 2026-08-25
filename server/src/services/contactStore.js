import { nanoid } from 'nanoid';

import { normalizeCompanyKey } from '../utils/companyKey.js';
import { getDb } from './db.js';
import { requireCurrentUserId } from './userContext.js';

const COL = 'company_contacts';
const STRIP = { projection: { _id: 0, userId: 0 } };

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function upsertContact(userId, { company, email, name, contactedAt }) {
  const companyDisplay = String(company || '').trim();
  const companyKey = normalizeCompanyKey(companyDisplay);
  const emailNorm = String(email || '').trim().toLowerCase();
  if (!companyKey || !emailNorm) return null;

  const now = contactedAt || new Date().toISOString();
  const col = getDb().collection(COL);
  const existing = await col.findOne({ userId, companyKey, email: emailNorm });

  if (existing) {
    await col.updateOne(
      { userId, companyKey, email: emailNorm },
      {
        $set: {
          companyDisplay,
          name: String(name || '').trim(),
          lastContactedAt: now,
        },
        $inc: { draftCount: 1 },
      }
    );
    return {
      ...existing,
      companyDisplay,
      name: String(name || '').trim(),
      lastContactedAt: now,
      draftCount: (existing.draftCount || 1) + 1,
    };
  }

  const doc = {
    id: nanoid(10),
    userId,
    companyKey,
    companyDisplay,
    email: emailNorm,
    name: String(name || '').trim(),
    lastContactedAt: now,
    draftCount: 1,
  };
  await col.insertOne(doc);
  return doc;
}

export const contactStore = {
  normalizeCompanyKey,

  async upsertFromDraft({ company, email, name }) {
    const userId = requireCurrentUserId();
    return upsertContact(userId, { company, email, name });
  },

  /** For backfill scripts — no request auth context required. */
  async upsertFromDraftForUser(userId, { company, email, name, contactedAt }) {
    return upsertContact(userId, { company, email, name, contactedAt });
  },

  async listByCompanyKey(companyKey) {
    const key = normalizeCompanyKey(companyKey);
    if (!key) return [];
    const userId = requireCurrentUserId();
    return getDb()
      .collection(COL)
      .find({ userId, companyKey: key }, STRIP)
      .sort({ lastContactedAt: -1 })
      .toArray();
  },

  async listByCompany(company) {
    return this.listByCompanyKey(company);
  },

  async searchCompanies(q, limit = 8) {
    const userId = requireCurrentUserId();
    const query = String(q || '').trim();
    const keyPrefix = normalizeCompanyKey(query);
    if (!keyPrefix || keyPrefix.length < 2) return [];

    const rows = await getDb()
      .collection(COL)
      .aggregate([
        {
          $match: {
            userId,
            $or: [
              { companyKey: { $regex: `^${escapeRegex(keyPrefix)}` } },
              { companyDisplay: { $regex: escapeRegex(query), $options: 'i' } },
            ],
          },
        },
        {
          $group: {
            _id: '$companyKey',
            companyKey: { $first: '$companyKey' },
            companyDisplay: { $last: '$companyDisplay' },
            contactCount: { $sum: 1 },
            lastContactedAt: { $max: '$lastContactedAt' },
          },
        },
        { $sort: { lastContactedAt: -1 } },
        { $limit: Math.min(Math.max(Number(limit) || 8, 1), 20) },
      ])
      .toArray();

    return rows.map((r) => ({
      companyKey: r.companyKey,
      companyDisplay: r.companyDisplay,
      contactCount: r.contactCount,
      lastContactedAt: r.lastContactedAt,
    }));
  },

  /** All contacts grouped by company for the Contacts tab. */
  async listGrouped({ q = '' } = {}) {
    const userId = requireCurrentUserId();
    const query = String(q || '').trim();
    const match = { userId };

    if (query.length >= 1) {
      const keyPrefix = normalizeCompanyKey(query);
      const or = [
        { companyDisplay: { $regex: escapeRegex(query), $options: 'i' } },
        { email: { $regex: escapeRegex(query), $options: 'i' } },
        { name: { $regex: escapeRegex(query), $options: 'i' } },
      ];
      if (keyPrefix.length >= 2) {
        or.push({ companyKey: { $regex: escapeRegex(keyPrefix) } });
      }
      match.$or = or;
    }

    const rows = await getDb()
      .collection(COL)
      .aggregate([
        { $match: match },
        { $sort: { lastContactedAt: -1 } },
        {
          $group: {
            _id: '$companyKey',
            companyKey: { $first: '$companyKey' },
            companyDisplay: { $last: '$companyDisplay' },
            contactCount: { $sum: 1 },
            lastContactedAt: { $max: '$lastContactedAt' },
            contacts: {
              $push: {
                id: '$id',
                email: '$email',
                name: '$name',
                lastContactedAt: '$lastContactedAt',
                draftCount: '$draftCount',
              },
            },
          },
        },
        { $sort: { lastContactedAt: -1 } },
      ])
      .toArray();

    return rows.map((r) => ({
      companyKey: r.companyKey,
      companyDisplay: r.companyDisplay,
      contactCount: r.contactCount,
      lastContactedAt: r.lastContactedAt,
      contacts: r.contacts,
    }));
  },
};
