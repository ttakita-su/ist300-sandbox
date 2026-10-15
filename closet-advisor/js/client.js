// Browser client: owns the database, the in-tab "server" and the session token. Screens call
// `api.someOperation(args)` and the current session is attached automatically.
import { createApi } from './server/api.js';
import { openIndexedDb, createMemoryDb, deleteIndexedDb } from './server/db.js';
import { createBrowserProviders } from './server/providers/index.browser.js';

const TOKEN_KEY = 'rotation.session.v1';
const THEME_KEY = 'rotation.theme';

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the session simply won't survive a reload.
  }
}

let server = null;
let session = null;
let token = readStorage(TOKEN_KEY);
let storage = 'indexeddb';
const listeners = new Set();

/** Opens storage, seeds demo data and restores the session. */
export async function startClient() {
  let db;
  try {
    db = await openIndexedDb();
  } catch (error) {
    console.warn('IndexedDB unavailable, using memory storage', error);
    db = createMemoryDb();
    storage = 'memory';
  }
  server = createApi({ db, providers: createBrowserProviders() });
  await server.initialize();
  if (token) {
    try {
      session = await server.me({ token }, {});
    } catch {
      token = null;
      writeStorage(TOKEN_KEY, null);
    }
  }
  return { session, storage };
}

/** api.listOwned({...}) -> server.listOwned({ token }, {...}) */
export const api = new Proxy(
  {},
  {
    get(_, name) {
      if (name === 'then' || typeof name !== 'string') return undefined;
      return (args = {}) => {
        if (!server) return Promise.reject(new Error('Client not started'));
        if (typeof server[name] !== 'function') return Promise.reject(new Error(`Unknown operation ${name}`));
        return server[name]({ token }, args);
      };
    },
  },
);

export function getSession() {
  return session;
}

/** Stores the session from signIn/signUp/signInDemo results. */
export function setSession(result) {
  token = result.token;
  session = result.session;
  writeStorage(TOKEN_KEY, token);
  for (const fn of listeners) fn(session);
}

export async function signOut() {
  try {
    if (server && token) await server.signOut({ token }, {});
  } catch {
    // Already signed out.
  }
  token = null;
  session = null;
  writeStorage(TOKEN_KEY, null);
  for (const fn of listeners) fn(null);
}

export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function storageKind() {
  return storage;
}

/** Wipes every local record and photo, then reloads so demo data is re-created. */
export async function resetDemo() {
  writeStorage(TOKEN_KEY, null);
  try {
    await deleteIndexedDb();
  } catch (error) {
    console.error(error);
  }
  location.hash = '#/welcome';
  location.reload();
}

export function savedTheme() {
  return readStorage(THEME_KEY) ?? 'system';
}

/** Applies 'system' | 'light' | 'dark' and remembers it for the next load. */
export function applyTheme(theme) {
  const value = theme === 'light' || theme === 'dark' ? theme : 'system';
  if (value === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', value);
  writeStorage(THEME_KEY, value);
}
