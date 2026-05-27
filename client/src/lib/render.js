// Lightweight {{var}} renderer for client-side previews.
// Server uses real Handlebars; this keeps the bundle small for the same
// simple substitution behaviour ({{name}}, {{company}}, {{email}}, ...).
const TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function renderTemplate(template, vars = {}) {
  if (typeof template !== "string") return "";
  return template.replace(TOKEN, (match, key) => {
    const value = vars[key];
    return value == null ? "" : String(value);
  });
}

export function extractVariables(template) {
  if (typeof template !== "string") return [];
  const found = new Set();
  for (const m of template.matchAll(TOKEN)) found.add(m[1]);
  return [...found];
}
