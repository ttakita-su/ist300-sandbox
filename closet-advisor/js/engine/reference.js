// Reference features: every catalog variant's illustration rasterized on its contrasting studio
// tone and measured by the same extractor that analyzes photos, so both sides of a comparison
// are measured the same way. Browser only (SVG to canvas). Results are cached by the matching
// operations in the 'catalogFeatures' store, keyed by generator and extractor version.
import { extractFeatures, referenceBackdrop, ANALYSIS_SIZE } from './features.js';
import { renderVariantSvg, specFor } from '../data/illustrations.js';
import { makeCanvas } from './image.js';

const yieldToPage = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Rasterizes SVG markup to RGBA pixels at size x size. */
export async function rasterizeSvg(svg, size = ANALYSIS_SIZE) {
  const img = new Image();
  img.decoding = 'async';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

/** The reference render of one variant: its illustration on the studio tone farthest from its colors. */
export async function referenceImageData(product, variant, size = ANALYSIS_SIZE) {
  const spec = specFor(product, variant);
  const background = referenceBackdrop(Object.values(spec.palette ?? {}));
  return rasterizeSvg(renderVariantSvg(product, variant, { background, size }), size);
}

/**
 * Features for catalog variants (all of them, or `variantIds`).
 * @param {any} catalog
 * @param {{ variantIds?: string[], onProgress?: (done: number, total: number) => void }} [opts]
 * @returns {Promise<Map<string, any>>} variantId -> Features
 */
export async function computeReferenceFeatures(catalog, { variantIds, onProgress } = {}) {
  const ids = variantIds ?? catalog.listVariants().map((v) => v.id);
  const out = new Map();
  let done = 0;
  for (const id of ids) {
    const variant = catalog.variant(id);
    const product = variant ? catalog.product(variant.productId) : null;
    if (product) out.set(id, extractFeatures(await referenceImageData(product, variant), { category: product.category }));
    done += 1;
    onProgress?.(done, ids.length);
    // Extraction is synchronous; giving the page a turn now and then keeps progress visible.
    if (done % 3 === 0) await yieldToPage();
  }
  return out;
}
