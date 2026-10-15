// Reference features from the catalog's own illustrations (js/engine/reference.js). The
// matching operations cache the result per variant, so only new or changed versions render.
import { computeReferenceFeatures } from '../../engine/reference.js';

export const referenceProvider = {
  /**
   * @param {any} catalog
   * @param {string[]} [variantIds] only these variants (default: all)
   * @param {{ onProgress?: (done: number, total: number) => void }} [opts]
   * @returns {Promise<Map<string, any>>}
   */
  async features(catalog, variantIds, opts = {}) {
    return computeReferenceFeatures(catalog, { variantIds, onProgress: opts.onProgress });
  },
};
