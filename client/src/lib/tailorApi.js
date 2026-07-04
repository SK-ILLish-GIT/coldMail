import axios from "axios";

import { attachAiModelRequest } from "./aiModel.js";
import { installAuthInterceptors } from "./authToken.js";

const baseURL = import.meta.env.VITE_API_BASE_URL || "/api";

const client = axios.create({
  baseURL: `${baseURL}/tailor`,
  timeout: 120_000,
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
  if (err.response?.data?.log) {
    const e = new Error("LaTeX compilation failed.");
    e.log = err.response.data.log;
    e.logSummary = err.response.data.logSummary || "";
    e.status = err.response.status;
    return e;
  }
  if (err.message) return new Error(err.message);
  return new Error("Network error");
}

async function call(method, url, data, config) {
  try {
    const res = await client.request({ method, url, data, ...(config || {}) });
    return res.data;
  } catch (err) {
    throw unwrapError(err);
  }
}

export const tailorApi = {
  status: () => call("get", "/status"),

  startSession: (payload) => call("post", "/session", payload),

  activeResumeSession: () => call("get", "/session/active"),

  restoreResumeSession: (sessionId) =>
    call("get", `/session/${sessionId}/restore`),

  abandonResumeSession: (sessionId) =>
    call("post", `/session/${sessionId}/abandon`),

  next: (sessionId) => call("get", `/session/${sessionId}/next`),

  // Full queue snapshot — drives the bulk-triage view.
  queue: (sessionId) => call("get", `/session/${sessionId}/queue`),

  decide: (sessionId, payload) =>
    call("post", `/session/${sessionId}/decide`, payload),

  autoTags: (sessionId) => call("get", `/session/${sessionId}/auto-tags`),

  compile: (sessionId, { save = false, name = "", tags } = {}) => {
    const body = {};
    if (name) body.name = name;
    if (Array.isArray(tags)) body.tags = tags;
    return call(
      "post",
      `/session/${sessionId}/compile${save ? "?save=1" : ""}`,
      body,
    );
  },

  rollback: (sessionId) => call("post", `/session/${sessionId}/rollback`),

  report: (sessionId) => call("get", `/session/${sessionId}/report`),

  zipUrl: (sessionId) => `${baseURL}/tailor/session/${sessionId}/zip`,

  // ---- Template tailoring -------------------------------------------------
  startTemplateSession: (payload) => call("post", "/template-session", payload),

  activeTemplateSession: () => call("get", "/template-session/active"),

  restoreTemplateSession: (sessionId) =>
    call("get", `/template-session/${sessionId}/restore`),

  abandonTemplateSession: (sessionId) =>
    call("post", `/template-session/${sessionId}/abandon`),

  templateNext: (sessionId) =>
    call("get", `/template-session/${sessionId}/next`),

  templateDecide: (sessionId, payload) =>
    call("post", `/template-session/${sessionId}/decide`, payload),

  saveTemplateSession: (sessionId, { name, tags } = {}) =>
    call("post", `/template-session/${sessionId}/save`, { name, tags }),
};

// Open the current CV folder zip in Overleaf via their"open snippet" deep link.
// The zip URL must be publicly reachable for Overleaf to fetch it, which only
// works when this app is deployed behind a public hostname. In local dev we
// surface the link anyway as a manual fallback for `wget` + upload-to-Overleaf.
export function overleafImportUrl(zipUrl) {
  const abs = new URL(zipUrl, window.location.origin).toString();
  return `https://www.overleaf.com/docs?snip_uri=${encodeURIComponent(abs)}`;
}
