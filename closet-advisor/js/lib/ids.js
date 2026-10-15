// Identifier helpers. Record ids are random and carry a short prefix that says what they are.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomString(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 36];
  return out;
}

/** @param {string} prefix e.g. 'own', 'wish', 'job' */
export function newId(prefix) {
  return `${prefix}_${randomString(16)}`;
}

/** 256-bit hex token for sessions. */
export function newToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** One key per user intent; reuse it when retrying the same intent. */
export function idempotencyKey() {
  return `idem_${randomString(20)}`;
}

/** Deterministic PRNG (mulberry32) for demo data and the synthetic evaluation. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a), for seeding and cache keys. */
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
