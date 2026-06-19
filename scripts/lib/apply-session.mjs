import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SESSIONS_DIR = path.resolve(__dirname, '../../.cursor/sessions');

export function createSessionId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `apply-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function createEmptySession({ id, inputs = {} }) {
  return {
    id,
    status: 'created',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    inputs: {
      jobUrl: inputs.jobUrl || '',
      jdText: inputs.jdText || '',
      recruiterEmails: inputs.recruiterEmails || [],
      company: inputs.company || '',
    },
    extracted: {
      company: '',
      roleTitle: '',
      jd: '',
    },
    matches: {
      templateId: '',
      templateName: '',
      templateSubject: '',
      templateBody: '',
      resumeId: '',
      resumeName: '',
      reasoning: '',
    },
    recipients: [],
    drafts: {
      drafted: 0,
      failed: 0,
      results: [],
    },
    errors: [],
  };
}

export function sessionPath(id) {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

export async function ensureSessionsDir() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

export async function loadSession(id) {
  const raw = await fs.readFile(sessionPath(id), 'utf8');
  return JSON.parse(raw);
}

export async function saveSession(session) {
  await ensureSessionsDir();
  session.updatedAt = new Date().toISOString();
  await fs.writeFile(sessionPath(session.id), `${JSON.stringify(session, null, 2)}\n`);
  return session;
}

export function recordError(session, step, err) {
  session.errors.push({
    step,
    message: err?.message || String(err),
    status: err?.status || null,
    at: new Date().toISOString(),
  });
}
