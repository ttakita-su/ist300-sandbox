// Shared test environment: in-memory db, fixed clock, test providers, demo accounts seeded.
import { createApi } from '../js/server/api.js';
import { createMemoryDb } from '../js/server/db.js';
import { createTestProviders } from '../js/server/providers/test.js';

export const NOW = Date.parse('2026-10-14T12:00:00Z');

export const ALEX = 'usr_demo_alex';
export const SAM = 'usr_demo_sam';
export const JORDAN = 'usr_demo_jordan';
export const RILEY = 'usr_demo_riley';
export const MORGAN = 'usr_demo_morgan';

/**
 * @param {{ now?: number, providers?: Parameters<typeof createTestProviders>[0], rateLimits?: any, config?: any }} [opts]
 */
export async function createTestEnv(opts = {}) {
  const db = createMemoryDb();
  let t = opts.now ?? NOW;
  const clock = {
    now: () => t,
    advance(ms) {
      t += ms;
    },
    set(ms) {
      t = ms;
    },
  };
  const providers = createTestProviders(opts.providers ?? {});
  const api = createApi({ db, clock, providers, rateLimits: opts.rateLimits, config: opts.config });
  await api.initialize();
  /** Signs in a demo account and returns the call object ({ token }). */
  const as = async (userId) => {
    const result = await api.signInDemo({}, { userId });
    return { token: result.token };
  };
  return { api, db, clock, providers, as };
}

/** Asserts that a promise rejects with an ApiError of the given code. */
export async function rejectsWith(promise, code) {
  try {
    await promise;
  } catch (error) {
    if (error?.code === code) return error;
    throw new Error(`Expected ApiError ${code}, got ${error?.code ?? error}: ${error?.message}`);
  }
  throw new Error(`Expected ApiError ${code}, but the call succeeded`);
}

/** Waits until a match job leaves queued/processing (background work in tests). */
export async function waitForJob(api, call, jobId, { timeoutMs = 3000 } = {}) {
  const started = Date.now();
  for (;;) {
    const job = await api.getMatchJob(call, { jobId });
    if (!['queued', 'processing'].includes(job.status)) return job;
    if (Date.now() - started > timeoutMs) throw new Error(`Job ${jobId} still ${job.status}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** A small JPEG-signed Blob for upload tests (content is not decoded by test providers). */
export function fakeJpeg(bytes = 2048) {
  const data = new Uint8Array(bytes);
  data.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  return new Blob([data], { type: 'image/jpeg' });
}
