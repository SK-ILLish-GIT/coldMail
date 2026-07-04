import axios from "axios";

import { attachAiModelRequest } from "./aiModel.js";
import { installAuthInterceptors } from "./authToken.js";

const baseURL = import.meta.env.VITE_API_BASE_URL || "/api";

const client = axios.create({
  baseURL,
  timeout: 60_000,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

client.interceptors.request.use(attachAiModelRequest);
installAuthInterceptors(client);

function unwrapError(err) {
  if (err.response?.data?.error) {
    const e = new Error(err.response.data.error);
    e.details = err.response.data.details;
    e.status = err.response.status;
    return e;
  }
  if (err.message) return new Error(err.message);
  return new Error("Network error");
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
      headers: { "Content-Type": undefined },
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
    if (typeof value === "object") {
      // Arrays + plain objects (e.g. recipients, extra, meta) → JSON.
      fd.append(key, JSON.stringify(value));
    } else {
      fd.append(key, String(value));
    }
  }
  for (const file of attachments) {
    fd.append("attachments", file, file.name);
  }
  return fd;
}

export const api = {
  health: () => call("get", "/health"),

  // --- Auth ---
  login: (payload) => call("post", "/auth/login", payload),
  signup: (payload) => call("post", "/auth/signup", payload),
  logout: () => call("post", "/auth/logout"),
  me: () => call("get", "/auth/me"),
  updateProfile: (patch) => call("patch", "/auth/profile", patch),
  changePassword: (payload) => call("post", "/auth/change-password", payload),

  listAiModels: (provider) =>
    call("get", provider ? `/ai/models?provider=${encodeURIComponent(provider)}` : "/ai/models"),
  listAiProviders: () => call("get", "/ai/providers"),

  /** @deprecated use listAiModels */
  listGeminiModels: () => call("get", "/ai/models"),

  preview: (payload) => call("post", "/preview", payload),

  sendEmail: (payload, attachments = []) =>
    attachments.length
      ? callForm("post", "/send-email", buildSendFormData(payload, attachments))
      : call("post", "/send-email", payload),

  sendBulk: (payload, attachments = []) =>
    attachments.length
      ? callForm("post", "/send-bulk", buildSendFormData(payload, attachments))
      : call("post", "/send-bulk", payload),

  listTemplates: () => call("get", "/templates"),
  createTemplate: (payload) => call("post", "/templates", payload),
  updateTemplate: (id, payload) => call("put", `/templates/${id}`, payload),
  deleteTemplate: (id) => call("delete", `/templates/${id}`),
  setDefaultTemplate: (id) => call("put", `/templates/${id}/default`),
  clearDefaultTemplate: (id) => call("delete", `/templates/${id}/default`),
  // AI: ask Gemini for tag suggestions based on a template's subject + body.
  // Stateless; the caller decides whether to merge/replace existing tags.
  suggestTemplateTags: ({ subject, body, tags }) =>
    call("post", "/templates/suggest-tags", { subject, body, tags }),

  listLog: () => call("get", "/log"),
  clearLog: () => call("delete", "/log"),

  enrichEmail: (payload) => call("post", "/enrich/email", payload),
  extractNames: (payload) => call("post", "/enrich/names", payload),
  matchJD: (payload) => call("post", "/enrich/jd-match", payload),

  listResumes: () => call("get", "/resumes"),
  uploadResume: (name, file, tags = []) => {
    const fd = new FormData();
    fd.append("name", name);
    fd.append("file", file, file.name);
    if (tags && tags.length) fd.append("tags", JSON.stringify(tags));
    return callForm("post", "/resumes", fd);
  },
  // AI: parse a PDF and return suggested resume tags (no upload, no storage).
  suggestResumeTags: (file) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return callForm("post", "/resumes/suggest-tags", fd);
  },
  // AI: suggest tags for an already-stored resume by id.
  suggestStoredResumeTags: (id) => call("post", `/resumes/${id}/suggest-tags`),
  // PATCH-ish: name and/or tags. Either can be omitted to leave unchanged.
  updateResume: (id, patch) => call("put", `/resumes/${id}`, patch),
  // Replace the stored PDF for an existing resume (same id, name, tags).
  updateResumeVersion: (id, file) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return callForm("put", `/resumes/${id}/content`, fd);
  },
  // Back-compat shim for callers that only want to rename.
  renameResume: (id, name) => call("put", `/resumes/${id}`, { name }),
  deleteResume: (id) => call("delete", `/resumes/${id}`),
  setDefaultResume: (id) => call("put", `/resumes/${id}/default`),
  clearDefaultResume: (id) => call("delete", `/resumes/${id}/default`),
  resumeDownloadUrl: (id) => `${baseURL}/resumes/${id}`,
  // Downloads are auth-protected (Bearer), so a plain link 401s. Fetch the PDF
  // with the authenticated client and hand back an object URL to open.
  openResumeObjectUrl: async (id) => {
    const res = await client.request({
      method: "get",
      url: `/resumes/${id}`,
      responseType: "blob",
    });
    return URL.createObjectURL(res.data);
  },
};
