// Accounts and sessions. Prototype accounts live only in this browser's IndexedDB; passwords
// are still hashed (PBKDF2-SHA256) so the flow matches what a real backend would store.
import { newToken } from '../lib/ids.js';

const ITERATIONS = 150000;
const SESSION_DAYS = 30;

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  return new Uint8Array(hex.match(/../g).map((h) => Number.parseInt(h, 16)));
}

/** @returns {Promise<{ hash: string, salt: string }>} */
export async function hashPassword(password, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return { hash: toHex(bits), salt: toHex(salt) };
}

export async function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.salt) return false;
  const { hash } = await hashPassword(password, user.salt);
  // Constant-time comparison of equal-length hex strings.
  let diff = hash.length ^ user.passwordHash.length;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ (user.passwordHash.charCodeAt(i) || 0);
  return diff === 0;
}

export async function createSession(db, userId, clock) {
  const now = clock.now();
  const session = {
    token: newToken(),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_DAYS * 86400000).toISOString(),
  };
  await db.put('sessions', session);
  return session;
}

export function toActor(user) {
  return {
    id: user.id,
    role: user.role,
    displayName: user.displayName,
    email: user.email,
    analyticsId: user.analyticsId,
    demo: Boolean(user.demo),
  };
}

/** Resolves a session token to an actor, or null when missing, expired or orphaned. */
export async function resolveSession(db, token, clock) {
  if (!token || typeof token !== 'string') return null;
  const session = await db.get('sessions', token);
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= clock.now()) {
    await db.delete('sessions', token);
    return null;
  }
  const user = await db.get('users', session.userId);
  return user ? toActor(user) : null;
}

export async function endSession(db, token) {
  if (token) await db.delete('sessions', token);
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
