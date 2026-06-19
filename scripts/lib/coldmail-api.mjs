const DEFAULT_BASE = 'https://coldmail-e9x0.onrender.com/api';

export class ApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function createClient(baseUrl = process.env.COLDMAIL_API_BASE || DEFAULT_BASE) {
  const base = baseUrl.replace(/\/$/, '');

  async function request(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
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
      throw new ApiError(data?.error || res.statusText || 'Request failed', res.status, data?.details);
    }
    return data;
  }

  return {
    health: () => request('GET', '/health'),
    jobIntake: (payload) => request('POST', '/enrich/job-intake', payload),
    extractNames: (payload) => request('POST', '/enrich/names', payload),
    matchJD: (payload) => request('POST', '/enrich/jd-match', payload),
    listTemplates: () => request('GET', '/templates'),
    listResumes: () => request('GET', '/resumes'),
    sendBulk: (payload) => request('POST', '/send-bulk', payload),
  };
}

export function parseEmails(raw) {
  const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const seen = new Set();
  const out = [];
  for (const token of String(raw || '').split(/[\s,;]+/)) {
    const e = token.trim().toLowerCase();
    if (e && EMAIL_REGEX.test(e) && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

const GENERIC_LOCALS = new Set([
  'sales', 'info', 'contact', 'hr', 'support', 'admin', 'team', 'hello',
  'noreply', 'no-reply', 'careers', 'jobs', 'billing', 'accounts',
]);

export function algoExtractName(email) {
  const local = email.split('@')[0]?.split('+')[0] ?? '';
  if (!local) return '';
  const tokens = local.split(/[._-]+/).filter((s) => s && !/^\d+$/.test(s));
  if (!tokens.length) return '';
  if (tokens.length === 1 && GENERIC_LOCALS.has(tokens[0].toLowerCase())) return '';
  return tokens
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join(' ');
}
