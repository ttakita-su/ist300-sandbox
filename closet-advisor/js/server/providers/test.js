// Providers for Node tests. No DOM, no canvas: images are plain Blobs and features come from
// fixtures. Pass overrides to change behaviour per test.
import { offersProvider } from './offers.js';
import { conversionsProvider } from './conversions.js';
import { marketplacesProvider } from './marketplaces.js';
import { NOT_CONNECTED, notConnectedWeb } from './web.js';
import { ApiError } from '../errors.js';

/**
 * @param {{
 *   features?: any | ((args: any) => any),          // vision.analyze result
 *   referenceFeatures?: Map<string, any> | ((catalog: any) => Map<string, any>),
 *   ocrText?: string | ((blob: Blob) => string),
 *   normalize?: (blob: Blob) => any,
 *   visionDelayMs?: number,
 *   web?: any,                                       // e.g. fakeWebProvider({...}); default not connected
 * }} [overrides]
 */
export function createTestProviders(overrides = {}) {
  let urlCounter = 0;
  return {
    imaging: {
      async normalize(blob) {
        if (overrides.normalize) return overrides.normalize(blob);
        return { original: blob, processing: blob, width: 1200, height: 900, mime: blob.type || 'image/jpeg' };
      },
      async cleanup(blob) {
        return blob;
      },
    },
    vision: {
      async analyze(args) {
        if (overrides.visionDelayMs) await new Promise((r) => setTimeout(r, overrides.visionDelayMs));
        const f = overrides.features;
        if (typeof f === 'function') return f(args);
        if (f) return f;
        throw new ApiError('unavailable', 'No test features configured.');
      },
    },
    ocr: {
      async read(blob) {
        const t = overrides.ocrText;
        return { text: typeof t === 'function' ? t(blob) : t ?? '', confidence: 0.92 };
      },
    },
    reference: {
      async features(catalog) {
        const r = overrides.referenceFeatures;
        if (typeof r === 'function') return r(catalog);
        return r ?? new Map();
      },
    },
    offers: offersProvider,
    conversions: overrides.conversions ?? conversionsProvider,
    marketplaces: overrides.marketplaces ?? marketplacesProvider,
    web: overrides.web ?? notConnectedWeb,
    urls: {
      objectUrl(blob, id) {
        urlCounter += 1;
        return `blob:test/${id ?? urlCounter}`;
      },
      revoke() {},
    },
  };
}

/**
 * A scripted `web` provider for unit tests: no network. Each response is a value or a function of
 * the call's arguments (it may return a promise); a call with no response configured answers
 * 'unavailable'. With live: false it behaves like no local server. `calls` records every call,
 * so a test can check that nothing reached the provider.
 * @param {{ live?: boolean, lookup?: any, search?: any, searchImage?: any, fetchImage?: any }} [responses]
 */
export function fakeWebProvider(responses = {}) {
  const live = responses.live ?? true;
  const calls = { status: 0, lookup: [], search: [], searchImage: [], fetchImage: [] };
  const reply = async (name, args) => {
    calls[name].push(args);
    if (!live) return { status: 'not_connected', reason: NOT_CONNECTED };
    const response = responses[name];
    if (response === undefined) return { status: 'unavailable', reason: `No fake ${name} response is set up.` };
    return typeof response === 'function' ? response(args) : response;
  };
  return {
    name: 'web',
    calls,
    async status() {
      calls.status += 1;
      return live ? { live: true, reason: null } : { live: false, reason: NOT_CONNECTED };
    },
    lookup: (args) => reply('lookup', args),
    search: (args) => reply('search', args),
    searchImage: (args) => reply('searchImage', args),
    fetchImage: (args) => reply('fetchImage', args),
  };
}
