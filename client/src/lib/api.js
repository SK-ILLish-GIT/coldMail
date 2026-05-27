import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

const client = axios.create({
  baseURL,
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
});

function unwrapError(err) {
  if (err.response?.data?.error) {
    const e = new Error(err.response.data.error);
    e.details = err.response.data.details;
    e.status = err.response.status;
    return e;
  }
  if (err.message) return new Error(err.message);
  return new Error('Network error');
}

async function call(method, url, data) {
  try {
    const res = await client.request({ method, url, data });
    return res.data;
  } catch (err) {
    throw unwrapError(err);
  }
}

async function callForm(method, url, formData) {
  try {
    // Let the browser set the multipart boundary automatically.
    const res = await client.request({
      method,
      url,
      data: formData,
      headers: { 'Content-Type': undefined },
    });
    return res.data;
  } catch (err) {
    throw unwrapError(err);
  }
}

function buildSendFormData(payload, attachments) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(payload)) {
    if (value == null) continue;
    if (typeof value === 'object') {
      // Arrays + plain objects (e.g. recipients, extra, meta) → JSON.
      fd.append(key, JSON.stringify(value));
    } else {
      fd.append(key, String(value));
    }
  }
  for (const file of attachments) {
    fd.append('attachments', file, file.name);
  }
  return fd;
}

export const api = {
  health: () => call('get', '/health'),

  preview: (payload) => call('post', '/preview', payload),

  sendEmail: (payload, attachments = []) =>
    attachments.length
      ? callForm('post', '/send-email', buildSendFormData(payload, attachments))
      : call('post', '/send-email', payload),

  sendBulk: (payload, attachments = []) =>
    attachments.length
      ? callForm('post', '/send-bulk', buildSendFormData(payload, attachments))
      : call('post', '/send-bulk', payload),

  listTemplates: () => call('get', '/templates'),
  createTemplate: (payload) => call('post', '/templates', payload),
  updateTemplate: (id, payload) => call('put', `/templates/${id}`, payload),
  deleteTemplate: (id) => call('delete', `/templates/${id}`),
  // AI: ask Gemini for tag suggestions based on a template's subject + body.
  // Stateless; the caller decides whether to merge/replace existing tags.
  suggestTemplateTags: ({ subject, body, tags }) =>
    call('post', '/templates/suggest-tags', { subject, body, tags }),

  listLog: () => call('get', '/log'),
  clearLog: () => call('delete', '/log'),

  enrichEmail: (payload) => call('post', '/enrich/email', payload),
  extractNames: (payload) => call('post', '/enrich/names', payload),
  matchJD: (payload) => call('post', '/enrich/jd-match', payload),

  listResumes: () => call('get', '/resumes'),
  uploadResume: (name, file, tags = []) => {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('file', file, file.name);
    if (tags && tags.length) fd.append('tags', JSON.stringify(tags));
    return callForm('post', '/resumes', fd);
  },
  // AI: parse a PDF and return suggested resume tags (no upload, no storage).
  suggestResumeTags: (file) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return callForm('post', '/resumes/suggest-tags', fd);
  },
  // PATCH-ish: name and/or tags. Either can be omitted to leave unchanged.
  updateResume: (id, patch) => call('put', `/resumes/${id}`, patch),
  // Back-compat shim for callers that only want to rename.
  renameResume: (id, name) => call('put', `/resumes/${id}`, { name }),
  deleteResume: (id) => call('delete', `/resumes/${id}`),
  resumeDownloadUrl: (id) => `${baseURL}/resumes/${id}`,
};
