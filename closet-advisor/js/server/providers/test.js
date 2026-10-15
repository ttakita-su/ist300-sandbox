// Providers for Node tests. No DOM, no canvas: images are plain Blobs and features come from
// fixtures. Pass overrides to change behaviour per test.
import { offersProvider } from './offers.js';
import { conversionsProvider } from './conversions.js';
import { marketplacesProvider } from './marketplaces.js';
import { ApiError } from '../errors.js';

/**
 * @param {{
 *   features?: any | ((args: any) => any),          // vision.analyze result
 *   referenceFeatures?: Map<string, any> | ((catalog: any) => Map<string, any>),
 *   ocrText?: string | ((blob: Blob) => string),
 *   normalize?: (blob: Blob) => any,
 *   visionDelayMs?: number,
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
    urls: {
      objectUrl(blob, id) {
        urlCounter += 1;
        return `blob:test/${id ?? urlCounter}`;
      },
      revoke() {},
    },
  };
}
