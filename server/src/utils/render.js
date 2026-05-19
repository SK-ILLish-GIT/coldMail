import Handlebars from 'handlebars';

// Cache compiled templates keyed by source string to avoid recompiling on every
// row of a bulk send.
const cache = new Map();
const MAX_CACHE = 50;

function compile(source) {
  let tpl = cache.get(source);
  if (!tpl) {
    tpl = Handlebars.compile(source, { noEscape: true, strict: false });
    if (cache.size >= MAX_CACHE) {
      // drop oldest entry
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    cache.set(source, tpl);
  }
  return tpl;
}

/**
 * Render an email template with the provided variables.
 * Uses Handlebars under the hood, so `{{name}}` and any custom keys work.
 *
 * @param {string} source - raw template string (HTML or text)
 * @param {Record<string, unknown>} vars
 * @returns {string}
 */
export function renderTemplate(source, vars = {}) {
  if (typeof source !== 'string') return '';
  return compile(source)(vars);
}
