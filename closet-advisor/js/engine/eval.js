// Synthetic matching evaluation. Staged photos of catalog versions (js/engine/samples.js) and of
// made-up items the catalog doesn't have go through the same steps as a real upload: re-encode,
// processing copy, on-device features, matcher. It measures the pipeline against its own
// illustrations; it says nothing about accuracy on real photos of real products, and the report
// says so. Browser only.
import { staticCatalog } from '../server/catalog-repo.js';
import { buildIndex, MATCH_CONFIG } from './matcher.js';
import { analyzeAndMatch } from '../server/ops/matching.js';
import { imagingProvider } from '../server/providers/imaging.browser.js';
import { visionProvider } from '../server/providers/vision.browser.js';
import { computeReferenceFeatures } from './reference.js';
import { stagePhoto, SURFACES } from './samples.js';
import { specFor, ILLUSTRATION_VERSION, PALETTE_PARTS } from '../data/illustrations.js';
import { CATEGORIES } from '../data/schema.js';
import { hexToLab, deltaE, rgbToHex } from '../data/colors.js';
import { seededRandom } from '../lib/ids.js';

const SURFACE_NAMES = Object.keys(SURFACES);
// A made-up item counts as out of catalog only if its main color is at least this far from
// every catalog version of the same shape, so a lookalike can't be scored as a false accept.
const OUT_MIN_DELTA_E = 25;
const MAIN_PART = { sneaker: 'upper', watch: 'dial', clothing: 'main' };

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

const rate = (n, d) => (d ? Math.round((n / d) * 1000) / 1000 : null);

/** A palette for a made-up item: random saturated colors, far from the catalog's main colors. */
function outOfCatalogSpec(catalog, category, random) {
  const products = catalog.listProducts({ category });
  const product = products[Math.floor(random() * products.length)];
  const base = specFor(product, catalog.variantsOf(product.id)[0]);
  const mains = catalog.variantsOf(product.id).map((v) => v.illustration?.palette?.[MAIN_PART[category]]).filter(Boolean).map(hexToLab);
  for (let attempt = 0; attempt < 40; attempt++) {
    const color = () => rgbToHex(40 + random() * 200, 40 + random() * 200, 40 + random() * 200);
    const palette = Object.fromEntries(PALETTE_PARTS[category].map((part) => [part, color()]));
    const main = hexToLab(palette[MAIN_PART[category]]);
    if (mains.every((m) => deltaE(m, main) >= OUT_MIN_DELTA_E)) return { ...base, palette, options: base.options };
  }
  return null;
}

function emptyTally() {
  return { count: 0, top1: 0, top3: 0, exactVariant: 0, variantErrors: 0, variantAmbiguous: 0, abstained: 0 };
}

function scoreInCatalog(tally, result, truth) {
  const lead = result.candidates[0] ?? null;
  tally.count += 1;
  if (result.retrieval !== 'candidate_found') tally.abstained += 1;
  if (lead && lead.kind === 'match' && lead.productId === truth.productId) {
    tally.top1 += 1;
    // A best guess flagged as ambiguous is a question for the person, not a pick.
    if (lead.variantAmbiguous) tally.variantAmbiguous += 1;
    else if (lead.variantId === truth.id) tally.exactVariant += 1;
    else if (lead.variantId) tally.variantErrors += 1;
  }
  if (result.candidates.slice(0, 3).some((c) => c.productId === truth.productId)) tally.top3 += 1;
}

function rates(t) {
  return {
    count: t.count,
    top1: rate(t.top1, t.count),
    top3: rate(t.top3, t.count),
    exactVariant: rate(t.exactVariant, t.count),
    variantErrors: rate(t.variantErrors, t.count),
    variantAmbiguous: rate(t.variantAmbiguous, t.count),
    abstainedInCatalog: rate(t.abstained, t.count),
  };
}

/**
 * Runs the synthetic evaluation.
 * @param {{ seed?: number, count?: number, outOfCatalog?: number, catalog?: any,
 *   onProgress?: (p: { stage: 'indexing'|'photos', done: number, total: number }) => void }} [opts]
 *   count: in-catalog photos (spread evenly over every version); outOfCatalog: made-up items
 * @returns {Promise<any>} EvalReport (ARCHITECTURE.md 6.1). Rates are shares of the photos in
 *   that group (0..1, rounded to 3 places); counts say how many photos each rate is out of.
 */
export async function runEvaluation({ seed = 1, count = 39, outOfCatalog = 12, catalog = staticCatalog(), onProgress } = {}) {
  const random = seededRandom(seed);
  const references = await computeReferenceFeatures(catalog, { onProgress: (done, total) => onProgress?.({ stage: 'indexing', done, total }) });
  const index = buildIndex(catalog, references);
  const providers = { imaging: imagingProvider, vision: visionProvider };
  const variants = catalog.listVariants().sort((a, b) => a.id.localeCompare(b.id));
  const total = count + outOfCatalog;
  const latencies = [];
  const overall = emptyTally();
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, emptyTally()]));
  const confusions = new Map();
  const out = { count: 0, abstained: 0, falseAccepts: 0, similarShown: 0 };
  const photos = [];
  let done = 0;

  async function analyze(spec, category) {
    const photo = await stagePhoto(spec, { seed: Math.floor(random() * 1e9), surface: SURFACE_NAMES[Math.floor(random() * SURFACE_NAMES.length)], width: 1200, height: 900 });
    // The same steps as an upload: normalize (re-encode, processing copy), then analyze it.
    const normalized = await providers.imaging.normalize(photo);
    const { result } = await analyzeAndMatch({ providers, index, blob: normalized.processing, category });
    latencies.push(result.latencyMs);
    done += 1;
    onProgress?.({ stage: 'photos', done, total });
    return result;
  }

  for (let i = 0; i < count; i++) {
    const variant = variants[i % variants.length];
    const product = catalog.product(variant.productId);
    const result = await analyze(specFor(product, variant), product.category);
    scoreInCatalog(overall, result, variant);
    scoreInCatalog(byCategory[product.category], result, variant);
    const lead = result.candidates[0];
    photos.push({ variantId: variant.id, retrieval: result.retrieval, leadProductId: lead?.productId ?? null, leadKind: lead?.kind ?? null, leadVariantId: lead?.variantId ?? null, variantAmbiguous: Boolean(lead?.variantAmbiguous) });
    if (lead?.kind === 'match' && !lead.variantAmbiguous && lead.variantId && lead.variantId !== variant.id) {
      const key = `${variant.id} -> ${lead.variantId}`;
      confusions.set(key, (confusions.get(key) ?? 0) + 1);
    }
  }
  for (let i = 0; i < outOfCatalog; i++) {
    const category = CATEGORIES[i % CATEGORIES.length];
    const spec = outOfCatalogSpec(catalog, category, random);
    if (!spec) continue;
    const result = await analyze(spec, category);
    out.count += 1;
    if (result.retrieval === 'candidate_found') out.falseAccepts += 1;
    else out.abstained += 1;
    if (result.retrieval === 'similar_result') out.similarShown += 1;
    photos.push({ variantId: null, category, retrieval: result.retrieval, leadProductId: result.candidates[0]?.productId ?? null, leadKind: result.candidates[0]?.kind ?? null, leadVariantId: null, variantAmbiguous: false });
  }

  latencies.sort((a, b) => a - b);
  const summary = rates(overall);
  return {
    generatedAt: new Date().toISOString(),
    seed,
    synthetic: true,
    catalogVersion: catalog.version,
    illustrationVersion: ILLUSTRATION_VERSION,
    matcherVersion: MATCH_CONFIG.version,
    counts: { inCatalog: overall.count, outOfCatalog: out.count },
    overall: {
      top1: summary.top1,
      top3: summary.top3,
      exactVariant: summary.exactVariant,
      variantErrors: summary.variantErrors,
      variantAmbiguous: summary.variantAmbiguous,
      abstainedInCatalog: summary.abstainedInCatalog,
    },
    byCategory: Object.fromEntries(CATEGORIES.map((c) => [c, rates(byCategory[c])])),
    outOfCatalog: { count: out.count, abstained: rate(out.abstained, out.count), falseAccepts: rate(out.falseAccepts, out.count), similarShown: rate(out.similarShown, out.count) },
    confusions: [...confusions].map(([pair, n]) => ({ pair, count: n })).sort((a, b) => b.count - a.count),
    photos,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    notes: [
      'Synthetic: every photo is the catalog’s own illustration staged on a surface with light falloff, a color cast and noise. It measures this pipeline, not accuracy on real photos of real products.',
      'Out-of-catalog items are made-up color combinations on catalog silhouettes, at least 25 apart in color from every version of that silhouette.',
      'Some catalog products look alike in a photo (the navy Harbor & Pine Deck Field Jacket and the navy Wrenfield Chore Jacket). The matcher shows both as similar and asks for a label instead of claiming one, so those photos count as abstained here; that is the intended answer.',
      'A version counts as exact only when the photo alone settled it. When versions look alike (Olive / Bone and Olive / Sail, 38 and 40 mm), the matcher leaves the version open and asks for a code; that is counted separately and is the intended answer.',
      'Latency covers feature extraction and matching on the processing copy, not rendering the synthetic photo.',
    ],
  };
}
