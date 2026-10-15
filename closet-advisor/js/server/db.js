// Document store with the same interface over IndexedDB (browser) and memory (tests).
// Records are cloned on the way in and out, like IndexedDB, so callers never share references.

/** Store name -> { key, indexes }. Bump DB_VERSION when adding stores or indexes. */
export const STORES = {
  users: { key: 'id', indexes: ['email'] },
  sessions: { key: 'token', indexes: ['userId'] },
  profiles: { key: 'userId', indexes: [] },
  photos: { key: 'id', indexes: ['userId'] },
  ownedItems: { key: 'id', indexes: ['userId', 'variantId'] },
  wishlistItems: { key: 'id', indexes: ['userId'] },
  matchJobs: { key: 'id', indexes: ['userId', 'status'] },
  recRequests: { key: 'id', indexes: ['userId'] },
  feedback: { key: 'id', indexes: ['userId'] },
  clicks: { key: 'id', indexes: ['clickRef', 'analyticsId'] },
  conversions: { key: 'id', indexes: ['clickRef'] },
  stylistAssignments: { key: 'id', indexes: ['stylistId', 'userId'] },
  stylistRequests: { key: 'id', indexes: ['userId', 'stylistId'] },
  stylistRecs: { key: 'id', indexes: ['requestId', 'userId'] },
  audit: { key: 'id', indexes: ['targetId', 'actorId'] },
  corrections: { key: 'id', indexes: ['status'] },
  idempotency: { key: 'id', indexes: [] },
  events: { key: 'id', indexes: ['type'] },
  config: { key: 'key', indexes: [] },
  meta: { key: 'key', indexes: [] },
  catalogBrands: { key: 'id', indexes: [] },
  catalogProducts: { key: 'id', indexes: ['category'] },
  catalogVariants: { key: 'id', indexes: ['productId'] },
  catalogImages: { key: 'id', indexes: ['variantId'] },
  retailers: { key: 'id', indexes: [] },
  offers: { key: 'id', indexes: ['variantId'] },
  catalogFeatures: { key: 'id', indexes: [] },
};

export const DB_NAME = 'rotation-prototype';
export const DB_VERSION = 1;

/**
 * @typedef {{
 *   get(store: string, key: string): Promise<any|null>,
 *   put(store: string, value: any): Promise<any>,
 *   bulkPut(store: string, values: any[]): Promise<void>,
 *   delete(store: string, key: string): Promise<void>,
 *   where(store: string, field: string, value: any): Promise<any[]>,
 *   all(store: string): Promise<any[]>,
 *   count(store: string): Promise<number>,
 *   clear(store: string): Promise<void>,
 *   kind: 'memory'|'indexeddb'
 * }} Db
 */

function keyOf(store, value) {
  const def = STORES[store];
  if (!def) throw new Error(`Unknown store ${store}`);
  const key = value?.[def.key];
  if (key == null) throw new Error(`Record for ${store} is missing ${def.key}`);
  return key;
}

/** @returns {Db} */
export function createMemoryDb() {
  const data = new Map(Object.keys(STORES).map((name) => [name, new Map()]));
  const table = (store) => {
    const t = data.get(store);
    if (!t) throw new Error(`Unknown store ${store}`);
    return t;
  };
  return {
    kind: 'memory',
    async get(store, key) {
      const value = table(store).get(key);
      return value === undefined ? null : structuredClone(value);
    },
    async put(store, value) {
      table(store).set(keyOf(store, value), structuredClone(value));
      return value;
    },
    async bulkPut(store, values) {
      for (const value of values) table(store).set(keyOf(store, value), structuredClone(value));
    },
    async delete(store, key) {
      table(store).delete(key);
    },
    async where(store, field, value) {
      return [...table(store).values()].filter((r) => r[field] === value).map((r) => structuredClone(r));
    },
    async all(store) {
      return [...table(store).values()].map((r) => structuredClone(r));
    },
    async count(store) {
      return table(store).size;
    },
    async clear(store) {
      table(store).clear();
    },
  };
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Opens the IndexedDB database, creating stores and indexes from STORES.
 * @returns {Promise<Db>}
 */
export async function openIndexedDb(name = DB_NAME) {
  const request = indexedDB.open(name, DB_VERSION);
  request.onupgradeneeded = () => {
    const idb = request.result;
    for (const [store, def] of Object.entries(STORES)) {
      const os = idb.objectStoreNames.contains(store)
        ? request.transaction.objectStore(store)
        : idb.createObjectStore(store, { keyPath: def.key });
      for (const index of def.indexes) {
        if (!os.indexNames.contains(index)) os.createIndex(index, index, { unique: false });
      }
    }
  };
  const idb = await promisify(request);
  idb.onversionchange = () => idb.close();

  const tx = (store, mode = 'readonly') => idb.transaction(store, mode).objectStore(store);
  const done = (transaction) =>
    new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

  return {
    kind: 'indexeddb',
    async get(store, key) {
      const value = await promisify(tx(store).get(key));
      return value ?? null;
    },
    async put(store, value) {
      keyOf(store, value);
      await promisify(tx(store, 'readwrite').put(value));
      return value;
    },
    async bulkPut(store, values) {
      const transaction = idb.transaction(store, 'readwrite');
      const os = transaction.objectStore(store);
      for (const value of values) os.put(value);
      await done(transaction);
    },
    async delete(store, key) {
      await promisify(tx(store, 'readwrite').delete(key));
    },
    async where(store, field, value) {
      const os = tx(store);
      // null/undefined/booleans are not valid IndexedDB keys, so those lookups scan instead.
      const indexable = typeof value === 'string' || typeof value === 'number';
      if (indexable && os.indexNames.contains(field)) return promisify(os.index(field).getAll(value));
      const all = await promisify(os.getAll());
      return all.filter((r) => r[field] === value);
    },
    async all(store) {
      return promisify(tx(store).getAll());
    },
    async count(store) {
      return promisify(tx(store).count());
    },
    async clear(store) {
      await promisify(tx(store, 'readwrite').clear());
    },
  };
}

/** Deletes the whole IndexedDB database (used by "Reset demo"). */
export function deleteIndexedDb(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
