const RESUME_KEY = "coldmail.tailor.resumeSessionId";
const TEMPLATE_KEY = "coldmail.tailor.templateSessionId";

export function getStoredResumeSessionId() {
  try {
    return localStorage.getItem(RESUME_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredResumeSessionId(id) {
  try {
    if (id) localStorage.setItem(RESUME_KEY, id);
    else localStorage.removeItem(RESUME_KEY);
  } catch {
    /* ignore */
  }
}

export function getStoredTemplateSessionId() {
  try {
    return localStorage.getItem(TEMPLATE_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredTemplateSessionId(id) {
  try {
    if (id) localStorage.setItem(TEMPLATE_KEY, id);
    else localStorage.removeItem(TEMPLATE_KEY);
  } catch {
    /* ignore */
  }
}
