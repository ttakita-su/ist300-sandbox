// The server boundary. Every operation goes through invoke(), which resolves the session,
// checks the role, applies rate limits and idempotency, and clones results.
import { ApiError } from './errors.js';
import { resolveSession } from './auth.js';
import { loadCatalog, ensureCatalogSeeded } from './catalog-repo.js';
import { newId } from '../lib/ids.js';

import * as account from './ops/account.js';
import * as profile from './ops/profile.js';
import * as catalogOps from './ops/catalog.js';
import * as photos from './ops/photos.js';
import * as matching from './ops/matching.js';
import * as inventory from './ops/inventory.js';
import * as wishlist from './ops/wishlist.js';
import * as recs from './ops/recs.js';
import * as offers from './ops/offers.js';
import * as stylist from './ops/stylist.js';
import * as privacy from './ops/privacy.js';
import * as admin from './ops/admin.js';
import * as marketplaces from './ops/marketplaces.js';

const MODULES = { account, profile, catalog: catalogOps, photos, matching, inventory, wishlist, recs, offers, stylist, privacy, admin, marketplaces };

export const RATE_LIMITS = {
  scan: { limit: 30, windowMs: 3600000, label: 'scans' },
  recs: { limit: 120, windowMs: 3600000, label: 'recommendation requests' },
};

const IDEMPOTENCY_TTL_MS = 24 * 3600000;

/** Default configuration; admin changes are stored in the `config` store. */
export const DEFAULT_CONFIG = {
  providerSimulation: { vision: 'ok', offers: 'ok', ocr: 'ok' },
  offerFreshnessHours: 24,
  matchTimeoutMs: 15000,
};

/**
 * @param {{ db: import('./db.js').Db, clock?: { now: () => number }, providers: any,
 *   config?: object, rateLimits?: typeof RATE_LIMITS }} deps
 */
export function createApi(deps) {
  const { db, providers } = deps;
  const clock = deps.clock ?? { now: () => Date.now() };
  const rateLimits = deps.rateLimits ?? RATE_LIMITS;
  const defaults = { ...DEFAULT_CONFIG, ...(deps.config ?? {}) };

  const defs = {};
  for (const [moduleName, mod] of Object.entries(MODULES)) {
    for (const [name, def] of Object.entries(mod.ops ?? {})) {
      if (defs[name]) throw new Error(`Operation ${name} is defined twice (${moduleName})`);
      defs[name] = { ...def, module: moduleName };
    }
  }

  let catalogPromise = null;
  const catalog = () => (catalogPromise ??= loadCatalog(db));
  const invalidateCatalog = () => {
    catalogPromise = null;
  };

  const config = {
    async get(key) {
      const row = await db.get('config', key);
      return row ? row.value : structuredClone(defaults[key] ?? null);
    },
    async set(key, value) {
      await db.put('config', { key, value });
      return value;
    },
  };

  const hits = new Map();
  function checkRate(actor, kind) {
    const rule = rateLimits[kind];
    if (!rule || !actor) return;
    const now = clock.now();
    const key = `${actor.id}:${kind}`;
    const recent = (hits.get(key) ?? []).filter((t) => now - t < rule.windowMs);
    if (recent.length >= rule.limit) {
      const retryAfterMs = rule.windowMs - (now - recent[0]);
      const minutes = Math.max(1, Math.ceil(retryAfterMs / 60000));
      throw new ApiError('rate_limited', `You've reached the limit of ${rule.limit} ${rule.label} an hour. Try again in ${minutes} min.`, { retryAfterMs });
    }
    recent.push(now);
    hits.set(key, recent);
  }

  const inflight = new Map();

  async function invoke(name, call, args, parentActor) {
    const def = defs[name];
    if (!def) throw new ApiError('not_found', `Unknown operation ${name}.`);
    const actor = parentActor !== undefined ? parentActor : await resolveSession(db, call?.token, clock);

    if (def.auth !== 'public') {
      if (!actor) throw new ApiError('unauthenticated', 'Sign in to continue.');
      if (def.auth !== 'any' && actor.role !== def.auth) {
        throw new ApiError('forbidden', "Your account can't do that.");
      }
    }

    const idemKey = def.idempotent && args?.idempotencyKey ? `${actor?.id ?? 'anon'}:${name}:${args.idempotencyKey}` : null;
    if (idemKey) {
      const stored = await db.get('idempotency', idemKey);
      if (stored && clock.now() - Date.parse(stored.createdAt) < IDEMPOTENCY_TTL_MS) return structuredClone(stored.result);
      // A second tap while the first call is still running gets the same promise.
      if (inflight.has(idemKey)) return structuredClone(await inflight.get(idemKey));
    }

    if (def.rateLimit) checkRate(actor, def.rateLimit);

    const ctx = {
      actor,
      token: call?.token ?? null,
      db,
      clock,
      config,
      providers,
      catalog,
      invalidateCatalog,
      now: () => clock.now(),
      iso: () => new Date(clock.now()).toISOString(),
      async audit(action, targetType, targetId, meta = {}) {
        await db.put('audit', { id: newId('aud'), at: new Date(clock.now()).toISOString(), actorId: actor?.id ?? null, action, targetType, targetId, meta });
      },
      async metric(type, data = {}) {
        try {
          await db.put('events', { id: newId('evt'), type, at: new Date(clock.now()).toISOString(), data });
        } catch {
          // Metrics must never break an operation.
        }
      },
      call: (op, a = {}) => invoke(op, call, a, actor),
    };

    const started = clock.now();
    const run = (async () => def.run(ctx, args ?? {}))();
    if (idemKey) inflight.set(idemKey, run);
    try {
      const result = await run;
      if (idemKey) {
        await db.put('idempotency', { id: idemKey, result: result ?? null, createdAt: new Date(clock.now()).toISOString() });
      }
      return structuredClone(result);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        console.error(`[api] ${name} failed`, error);
        await ctx.metric('op_error', { op: name, code: 'internal' });
        throw new ApiError('unavailable', 'Something went wrong on our side. Try again.', { op: name });
      }
      throw error;
    } finally {
      if (idemKey) inflight.delete(idemKey);
      const ms = clock.now() - started;
      if (ms > 2000) ctx.metric('slow_op', { op: name, ms });
    }
  }

  const api = {};
  for (const name of Object.keys(defs)) {
    api[name] = (call, args = {}) => invoke(name, call, args);
  }

  /** Seeds the catalog and demo accounts. Call once at startup. */
  api.initialize = async () => {
    const reseeded = await ensureCatalogSeeded(db);
    if (reseeded) invalidateCatalog();
    const { seedDemo } = await import('./seed.js');
    await seedDemo({ db, clock, catalog: await catalog() });
  };
  api.operations = () => Object.keys(defs);
  api.describe = (name) => (defs[name] ? { auth: defs[name].auth, idempotent: Boolean(defs[name].idempotent), rateLimit: defs[name].rateLimit ?? null, module: defs[name].module } : null);
  api.invalidateCatalog = invalidateCatalog;
  return api;
}
