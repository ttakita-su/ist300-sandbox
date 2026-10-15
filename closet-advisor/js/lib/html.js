// Escaping template for all rendering. Every interpolated value is escaped unless it is a
// SafeHtml produced by `html` itself or explicitly marked with `raw()` by trusted code.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export class SafeHtml {
  /** @param {string} value */
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"'`]/g, (c) => ESCAPES[c]);
}

/** Marks trusted markup (icons, generated SVG, output of `html`) as safe. */
export function raw(value) {
  return value instanceof SafeHtml ? value : new SafeHtml(String(value ?? ''));
}

function serialize(value) {
  if (value == null || value === false || value === true) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(serialize).join('');
  return escapeHtml(value);
}

/**
 * Tagged template: html`<p>${userText}</p>`. Arrays are joined; null/false render nothing.
 * @returns {SafeHtml}
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += serialize(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Joins class names, skipping falsy entries: cx('btn', on && 'is-on'). */
export function cx(...names) {
  return names.flat().filter(Boolean).join(' ');
}

const SAFE_URL = /^(?:https?:|blob:|data:image\/(?:png|jpeg|webp|gif|svg\+xml)[;,]|#|\.{0,2}\/|[^:]*$)/i;

/**
 * Returns the URL if it is safe for href/src, otherwise '#'. Blocks javascript:, vbscript:,
 * data: (except images) and other schemes.
 */
export function safeUrl(url) {
  const value = String(url ?? '').trim();
  if (!value) return '#';
  // Strip control characters and whitespace browsers ignore inside schemes.
  const probe = value.replace(/[\u0000-\u001F\u007F\s]+/g, '');
  return SAFE_URL.test(probe) ? value : '#';
}

/** Renders a SafeHtml into an element. */
export function render(el, content) {
  el.innerHTML = content instanceof SafeHtml ? content.value : escapeHtml(content ?? '');
}

/** Encodes a value for use inside a data-* attribute as JSON. */
export function dataJson(value) {
  return escapeHtml(JSON.stringify(value));
}
