/**
 * Normalize a company name for matching (Acme Inc. → acme).
 * Same algorithm as enrich.js slug() — kept here to avoid coupling stores to enrich.
 */
export function normalizeCompanyKey(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
