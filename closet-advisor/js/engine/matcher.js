// Photo-to-product matching. Evidence is combined in a fixed order of trust: product
// identifiers (style code, reference, GTIN) from a label, barcode or typed entry; a resolved
// product link; brand words on a label; then visual similarity of color and layout against
// the catalog's reference renders. The matcher abstains (`no_match`) rather than return a
// confident wrong product, says `similar_result` when only lookalikes are found, and never
// guesses between versions that only an identifier can tell apart. Pure: runs in Node.
import { paletteTransport, gridDistance } from './features.js';
import { colorLabel } from '../data/colors.js';

/**
 * Every threshold and weight in one place so calibration can tune them. Distances are in
 * Lab-like units: 0 means identical, about 5 is a close match through a phone camera, 20+ is
 * a different-looking item.
 */
export const MATCH_CONFIG = {
  version: 'match-2026-10-14.1',
  visual: {
    // Weighted sum of palette transport distance, mean grid-cell distance and aspect ratio.
    weights: { palette: 0.45, grid: 0.4, aspect: 0.15 },
    lightness: 0.6, // weight on L differences: lighting changes lightness far more than hue
    aspectScale: 30, // |ln(aspect ratio)| -> distance units
    gridMissing: 22, // cost of a cell filled on one side and empty on the other
    // Global lighting compensation: the photo palette may shift by up to these amounts toward
    // the reference, at a cost per unit, estimated from color pairs closer than pairMax.
    shift: { maxL: 10, maxA: 4, maxB: 8, penalty: 0.3, pairMax: 25 },
  },
  // fgRatio outside this range means no item could be separated from the background.
  object: { minFgRatio: 0.012, maxFgRatio: 0.93 },
  thresholds: {
    strong: 5, // visual distance for a strong product match
    accept: 8.5, // visual distance below which a match may be claimed...
    margin: 2, // ...when the next different product is at least this much farther
    strongMargin: 4,
    similar: 13, // shown as similar products
    weak: 18, // loose lookalikes listed under no_match
    // A claim also needs the layout to agree: when part of an item blends into the backdrop, the
    // colors that remain can sit close to another product whose shape is plainly different.
    // True matches stay under about 8 on synthetic photos (docs/evaluation.md).
    layout: 9,
  },
  // Clothing silhouettes overlap more than sneakers or watches, so claims need more.
  byCategory: {
    sneaker: {},
    watch: {},
    clothing: { accept: 7.5, margin: 2.5 },
  },
  variant: {
    margin: 1.5, // photo distance gap needed to commit to a version
    guessMargin: 0.6, // smallest gap that still justifies showing a best guess
    nearDuplicate: 7, // sibling renders closer than this are near-identical colorways
    minorShare: 0.35, // ...as are siblings sharing the main color and differing in less weight
    indistinguishable: 0.8, // renders this close look the same (38 vs 40 mm)
    conflictMargin: 1.5, // photo favors another version than the code by at least this much
  },
  brand: { bonus: 0.12 }, // distance reduction for products of a brand read on the label
  colors: { mentionWeight: 0.12, dominantWeight: 0.25, missingDeltaE: 18 },
  identifiers: {
    minLength: 5, // shorter tokens are never treated as codes
    fuzzyMinLength: 6, // one edit is tolerated only for codes this long...
    maxEdits: 1, // ...and only when exactly one catalog code is that close
    maxTokens: 4, // OCR splits codes: join up to this many neighboring tokens
    confusions: { O: '0', I: '1', S: '5', B: '8', Z: '2' },
  },
  maxCandidates: 5,
  maxLookalikes: 3,
};

const ASK_REASONS = {
  size_tag_photo: 'Take a photo of the size tag inside the tongue. It shows the style code.',
  style_code: 'Or type the style code printed on the size tag.',
  brand_label: 'Take a photo of the brand label or care tag. It often shows the style code.',
  barcode: 'Or photograph the barcode on the hang tag or care label.',
  reference: 'Type the reference number from the case back or the papers.',
  caseback_photo: 'Or take a photo of the case back, where the reference is engraved.',
  product_link: 'Or paste a link to the product page for this exact version.',
};

/** What to ask for when the version can't be told apart from the photo. */
export const ASK_FOR_VARIANT = {
  sneaker: ['size_tag_photo', 'style_code'],
  clothing: ['brand_label', 'barcode'],
  watch: ['reference', 'caseback_photo', 'product_link'],
};

const CODE_WORD = { style_code: 'Style code', reference: 'Reference', gtin: 'Barcode' };
const SOURCE_PHRASE = {
  ocr: 'read from your label photo',
  barcode: 'scanned from your barcode photo',
  user_entered: 'that you typed',
};

// ---------- Text and identifier helpers ----------

const DASHES = /[‐-―−﹘﹣－]/g;

/** Uppercases, unifies dash characters and tightens spaces around dashes. */
export function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(DASHES, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
}

/** Letters and digits only: 'kr2 - 304' -> 'KR2304'. */
export function compactCode(text) {
  return normalizeText(text).replace(/[^A-Z0-9]/g, '');
}

/** Maps characters OCR confuses (O/0, I/1, S/5, B/8, Z/2) to one form. */
export function codeSkeleton(text, confusions = MATCH_CONFIG.identifiers.confusions) {
  let out = '';
  for (const ch of compactCode(text)) out += confusions[ch] ?? ch;
  return out;
}

/** Levenshtein distance with an early exit above `max`. */
export function editDistance(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** GTIN-8/12/13/14 check digit test (weights 3,1,3,... from the right). */
export function isValidGtin(digits) {
  const s = String(digits ?? '');
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return false;
  let sum = 0;
  for (let i = s.length - 2, k = 0; i >= 0; i--, k++) sum += Number(s[i]) * (k % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(s[s.length - 1]);
}

/** Pads a GTIN to 14 digits so GTIN-12/13/14 forms of the same number compare equal. */
export function gtin14(digits) {
  return String(digits).padStart(14, '0');
}

/** Digit runs that could be GTINs, allowing the spaces barcodes print between groups. */
function digitRuns(text) {
  const runs = [];
  for (const m of String(text).matchAll(/\d(?:[ -]?\d){7,13}/g)) {
    const digits = m[0].replace(/\D/g, '');
    if ([8, 12, 13, 14].includes(digits.length)) runs.push(digits);
  }
  return runs;
}

/** Candidate code strings from one text: tokens and runs of neighboring tokens. */
function codeCandidates(text, cfg) {
  const out = new Set();
  for (const line of normalizeText(text).split('\n')) {
    const tokens = line.split(/[^A-Z0-9-]+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      let joined = '';
      for (let k = i; k < Math.min(tokens.length, i + cfg.maxTokens); k++) {
        joined += tokens[k];
        const compact = compactCode(joined);
        if (compact.length >= cfg.minLength && /\d/.test(compact)) out.add(compact);
      }
    }
  }
  return [...out];
}

/** Brand regexes: 'Harbor & Pine' also matches 'HARBOR AND PINE' and 'HARBOR PINE'. */
function brandPattern(name) {
  const words = normalizeText(name)
    .split(/[^A-Z0-9]+/)
    .filter((w) => w && w !== 'AND');
  if (!words.length || words.join('').length < 4) return null;
  return new RegExp(`(?:^|[^A-Z0-9])${words.join('\\s*(?:&|AND|\\+)?\\s*')}(?:$|[^A-Z0-9])`);
}

// ---------- Index ----------

/**
 * Catalog facts say two versions are near-identical colorways when they share the dominant
 * color and differ only in minor parts (White / Gum vs White / Natural: only the sole).
 */
function catalogNearPair(a, b, minorShare) {
  const ca = a.colors ?? [];
  const cb = b.colors ?? [];
  if (!ca.length || !cb.length) return false;
  const main = ca.reduce((x, y) => (y.weight > x.weight ? y : x));
  const mainB = cb.find((c) => c.role === main.role);
  if (!mainB || mainB.name !== main.name) return false;
  let differing = 0;
  for (const c of ca) {
    const other = cb.find((x) => x.role === c.role);
    if (!other || other.name !== c.name) differing += c.weight;
  }
  return differing <= minorShare;
}

/**
 * Prepares the catalog for matching.
 * @param {any} catalog Catalog (data/catalog-index.js)
 * @param {Map<string, any>} refFeatures variantId -> Features of the variant's reference render
 * @param {typeof MATCH_CONFIG} [cfg]
 */
export function buildIndex(catalog, refFeatures = new Map(), cfg = MATCH_CONFIG) {
  const entries = [];
  const byVariant = new Map();
  const byProduct = new Map();
  const codes = [];
  const gtins = new Map();
  for (const variant of catalog.variants.values()) {
    const product = catalog.product(variant.productId);
    if (!product) continue;
    const entry = {
      variantId: variant.id,
      productId: product.id,
      brandId: product.brandId,
      category: product.category,
      variantName: variant.name,
      colors: variant.colors ?? [],
      attributes: variant.attributes ?? {},
      features: refFeatures.get(variant.id) ?? null,
    };
    entries.push(entry);
    byVariant.set(variant.id, entry);
    if (!byProduct.has(product.id)) byProduct.set(product.id, []);
    byProduct.get(product.id).push(entry);
    const ids = variant.identifiers ?? {};
    for (const [kind, raw] of [['style_code', ids.styleCode], ['reference', ids.reference]]) {
      if (!raw) continue;
      codes.push({ kind, raw, compact: compactCode(raw), skeleton: codeSkeleton(raw), variantId: variant.id, productId: product.id, category: product.category });
    }
    for (const raw of ids.gtins ?? []) {
      const key = gtin14(String(raw).replace(/\D/g, ''));
      if (!gtins.has(key)) gtins.set(key, []);
      gtins.get(key).push({ kind: 'gtin', raw, variantId: variant.id, productId: product.id, category: product.category });
    }
  }
  const products = new Map();
  for (const product of catalog.products.values()) {
    const brand = catalog.brand(product.brandId);
    products.set(product.id, { id: product.id, name: product.name, category: product.category, brandId: product.brandId, brandName: brand?.name ?? '', type: product.type });
  }
  const brands = [...catalog.brands.values()]
    .map((b) => ({ id: b.id, name: b.name, pattern: brandPattern(b.name) }))
    .filter((b) => b.pattern);

  // Visual distance between sibling renders: tells near-identical colorways apart from
  // versions that only an identifier can separate.
  const siblings = new Map();
  const nearPairs = new Set();
  for (const list of byProduct.values()) {
    for (const a of list) {
      const row = new Map();
      for (const b of list) {
        if (a === b) continue;
        row.set(b.variantId, a.features && b.features ? visualDistance(a.features, b.features, cfg.visual).total : null);
        if (catalogNearPair(a, b, cfg.variant.minorShare) || catalogNearPair(b, a, cfg.variant.minorShare)) nearPairs.add(`${a.variantId}|${b.variantId}`);
      }
      siblings.set(a.variantId, row);
    }
  }
  return {
    catalogVersion: catalog.version,
    entries,
    byVariant,
    byProduct,
    products,
    brands,
    codes,
    gtins,
    siblings,
    nearPairs,
    withFeatures: entries.filter((e) => e.features).length,
  };
}

// ---------- Visual distance ----------

function clampShift(shift, limits) {
  const clamp = (v, m) => Math.max(-m, Math.min(m, v));
  return [clamp(shift[0], limits.maxL), clamp(shift[1], limits.maxA), clamp(shift[2], limits.maxB)];
}

/**
 * Distance between photo features and a reference (lower is closer), with its parts.
 * Lighting is compensated by letting the photo's colors shift a bounded amount toward the
 * reference, paying for the shift so it can't hide a real color difference.
 */
export function visualDistance(photo, ref, cfg = MATCH_CONFIG.visual) {
  const opts = { lightness: cfg.lightness };
  const base = paletteTransport(photo.palette, ref.palette, { ...opts, cap: 45 });
  // Robust shift: mean displacement over color pairs that plausibly correspond.
  const pairs = paletteTransport(photo.palette, ref.palette, { ...opts, shiftPairMax: cfg.shift.pairMax });
  const shift = clampShift(pairs.shift, cfg.shift);
  const shifted = paletteTransport(photo.palette, ref.palette, { ...opts, shift, cap: 45 });
  const shiftCost = cfg.shift.penalty * Math.hypot(shift[0] * cfg.lightness, shift[1], shift[2]);
  const gridAt = (s) => gridDistance(photo.grid, ref.grid, { ...opts, shift: s, mirror: true, missing: cfg.gridMissing }).distance;
  const aspect = Math.abs(Math.log(Math.max(0.05, photo.aspect) / Math.max(0.05, ref.aspect))) * cfg.aspectScale;
  const w = cfg.weights;
  const plainGrid = gridAt([0, 0, 0]);
  const plainTotal = w.palette * base.cost + w.grid * plainGrid + w.aspect * aspect;
  // The shift moves both the palette and the grid, so it is paid for once on the total. Paying
  // only inside the palette term let a navy photo borrow a free shift toward black in the grid.
  const shiftedGrid = gridAt(shift);
  const shiftedTotal = w.palette * shifted.cost + w.grid * shiftedGrid + w.aspect * aspect + shiftCost;
  if (shiftedTotal < plainTotal) {
    return { total: shiftedTotal, palette: shifted.cost + shiftCost, grid: shiftedGrid, aspect, shift };
  }
  return { total: plainTotal, palette: base.cost, grid: plainGrid, aspect, shift: [0, 0, 0] };
}

/** Similarity for internal ordering only (never shown as a percentage). */
const similarity = (d) => Math.round(Math.exp(-d / 10) * 1000) / 1000;

// ---------- Text evidence ----------

/**
 * Finds catalog identifiers in OCR, barcode or typed text.
 * @param {ReturnType<typeof buildIndex>} index
 * @param {Array<{ text: string, source: string }>} texts
 * @returns {{ hits: any[], notes: string[] }} hits: { variantId, productId, category, kind,
 *   code, read, source, exactness: 'exact'|'confusable'|'near' }
 */
export function findIdentifiers(index, texts = [], cfg = MATCH_CONFIG.identifiers) {
  const RANK = { exact: 0, confusable: 1, near: 2 };
  const best = new Map();
  const notes = [];
  const keep = (hit) => {
    const key = `${hit.variantId}|${hit.kind}|${hit.source}`;
    const prev = best.get(key);
    if (!prev || RANK[hit.exactness] < RANK[prev.exactness]) best.set(key, hit);
  };
  for (const entry of texts) {
    const text = String(entry?.text ?? '');
    const source = entry?.source ?? 'user_entered';
    if (!text.trim()) continue;
    const local = [];

    // GTINs: exact catalog numbers only. The check digit separates a valid barcode that is
    // not in the catalog from a misread one.
    for (const digits of digitRuns(text)) {
      const found = index.gtins.get(gtin14(digits));
      if (found) {
        for (const g of found) local.push({ variantId: g.variantId, productId: g.productId, category: g.category, kind: 'gtin', code: g.raw, read: digits, source, exactness: 'exact' });
      } else if (isValidGtin(digits)) {
        notes.push(`Barcode ${digits} is not in the demo catalog.`);
      } else if (source === 'user_entered') {
        notes.push(`The barcode number ${digits} doesn't add up (its check digit is wrong). Check the digits and try again.`);
      } else {
        notes.push(`The barcode digits ${digits} did not read cleanly, so they were not used.`);
      }
    }

    // Style codes and references, compared without separators.
    const candidates = codeCandidates(text, cfg);
    const fullCompact = compactCode(text);
    const fullSkeleton = codeSkeleton(text, cfg.confusions);
    for (const code of index.codes) {
      let exactness = null;
      let read = null;
      for (const cand of candidates) {
        if (cand === code.compact) {
          exactness = 'exact';
          read = cand;
          break;
        }
        if (!exactness && codeSkeleton(cand, cfg.confusions) === code.skeleton) {
          exactness = 'confusable';
          read = cand;
        }
      }
      // A code run together with neighboring text ("STYLEKR2304") still counts.
      if (!exactness && code.skeleton.length >= cfg.fuzzyMinLength && fullSkeleton.includes(code.skeleton)) {
        exactness = fullCompact.includes(code.compact) ? 'exact' : 'confusable';
        read = code.raw;
      }
      if (exactness) local.push({ variantId: code.variantId, productId: code.productId, category: code.category, kind: code.kind, code: code.raw, read, source, exactness, compact: code.compact });
    }
    // A shorter code found inside a longer one that also matched is not separate evidence.
    const found = local.filter((h) => !h.compact || !local.some((o) => o !== h && o.compact && o.compact.length > h.compact.length && o.compact.includes(h.compact)));
    for (const { compact: _c, ...hit } of found) keep(hit);

    // One OCR slip is tolerated for long codes, but only when exactly one code is that close
    // and nothing matched outright (KR2-304 and KR2-305 are one character apart).
    if (!found.some((h) => h.kind !== 'gtin')) {
      for (const cand of candidates) {
        const sk = codeSkeleton(cand, cfg.confusions);
        if (sk.length < cfg.fuzzyMinLength) continue;
        const close = index.codes.filter((c) => c.skeleton.length >= cfg.fuzzyMinLength && editDistance(sk, c.skeleton, cfg.maxEdits) <= cfg.maxEdits);
        if (close.length === 1) {
          const c = close[0];
          keep({ variantId: c.variantId, productId: c.productId, category: c.category, kind: c.kind, code: c.raw, read: cand, source, exactness: 'near' });
        }
      }
    }
  }
  return { hits: [...best.values()], notes: [...new Set(notes)] };
}

/** Brand names (and model names of that brand) found in label text. */
export function findBrands(index, texts = []) {
  const found = new Map();
  for (const entry of texts) {
    const text = normalizeText(entry?.text ?? '');
    if (!text) continue;
    for (const brand of index.brands) {
      if (!brand.pattern.test(text)) continue;
      const models = [...index.products.values()]
        .filter((p) => p.brandId === brand.id && p.name.length >= 4 && text.includes(normalizeText(p.name)))
        .map((p) => p.id);
      const prev = found.get(brand.id);
      if (!prev) found.set(brand.id, { brandId: brand.id, name: brand.name, source: entry.source ?? 'user_entered', models });
      else prev.models = [...new Set([...prev.models, ...models])];
    }
  }
  return [...found.values()];
}

// ---------- Descriptions ----------

function photoColorNames(features, minWeight) {
  const names = [];
  for (const c of features?.palette ?? []) {
    if (c.weight < minWeight) continue;
    if (!names.includes(c.name)) names.push(c.name);
    if (names.length === 3) break;
  }
  return names;
}

const lowerLabel = (name) => colorLabel(name).toLowerCase();

/** Plain description of how one version differs from another, from catalog facts. */
function difference(a, b) {
  const parts = [];
  const attrs = ['diameterMm', 'dialColor', 'caseMaterial', 'bracelet', 'color', 'colorway'];
  for (const key of attrs) {
    const va = a.attributes?.[key];
    const vb = b.attributes?.[key];
    if (va == null || vb == null || va === vb) continue;
    if (key === 'diameterMm') parts.push(`${va} mm case instead of ${vb} mm`);
    else if (key === 'colorway' || key === 'color') continue;
    else parts.push(`${String(va).toLowerCase()} ${key === 'dialColor' ? 'dial' : ''} instead of ${String(vb).toLowerCase()}`.replace(/\s+/g, ' '));
    if (parts.length === 2) break;
  }
  if (parts.length < 2) {
    for (const ca of a.colors ?? []) {
      const cb = (b.colors ?? []).find((c) => c.role === ca.role);
      if (cb && cb.name !== ca.name) {
        parts.push(`${ca.role} is ${lowerLabel(ca.name)} instead of ${lowerLabel(cb.name)}`);
        if (parts.length === 2) break;
      }
    }
  }
  if (!parts.length) return null;
  const sentence = parts.join('; ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function dominantMissing(photo, ref, shift, cfg) {
  const missing = [];
  for (const c of photo.palette ?? []) {
    if (c.weight < cfg.colors.dominantWeight) continue;
    const lab = [c.lab[0] + shift[0], c.lab[1] + shift[1], c.lab[2] + shift[2]];
    const close = (ref.palette ?? []).some((r) => Math.hypot(cfg.visual.lightness * (lab[0] - r.lab[0]), lab[1] - r.lab[1], lab[2] - r.lab[2]) < cfg.colors.missingDeltaE);
    if (!close && !missing.includes(c.name)) missing.push(c.name);
  }
  return missing;
}

function visualDetail(d, t) {
  if (d <= t.strong) return 'Shape and color layout closely match the catalog image';
  if (d <= t.accept) return 'Shape and color layout are close to the catalog image';
  if (d <= t.similar) return 'Similar shape and colors, but not a close match';
  return 'Only loosely similar to your photo';
}

function identifierDetail(hit, versionName) {
  const word = CODE_WORD[hit.kind] ?? 'Code';
  const where = SOURCE_PHRASE[hit.source] ?? 'from your evidence';
  if (hit.exactness === 'near') return `${word} read as ${hit.read}, one character from ${hit.code} (${versionName})`;
  if (hit.exactness === 'confusable' && compactCode(hit.read) !== compactCode(hit.code)) {
    return `${word} ${hit.code} ${where} (read as ${hit.read})`;
  }
  return `${word} ${hit.code} ${where}`;
}

// ---------- Matching ----------

/**
 * Matches one photo (plus any label text) against the catalog.
 * @param {ReturnType<typeof buildIndex>} index
 * @param {{ features: any, category?: string|null, texts?: Array<{ text: string, source: string }>,
 *   productUrl?: string|null }} query MatchQuery (ARCHITECTURE.md 6.1)
 * @param {{ link?: { status: string, productId?: string, variantId?: string } | null,
 *   config?: typeof MATCH_CONFIG, now?: () => number }} [opts] link: a product URL the
 *   server already resolved against the catalog
 * @returns {any} MatchResult (ARCHITECTURE.md 4.3), plus `notes` (sentences about evidence
 *   that did not attach to a candidate)
 */
export function match(index, query, opts = {}) {
  const started = (opts.now ?? (() => globalThis.performance?.now?.() ?? Date.now()))();
  const cfg = opts.config ?? MATCH_CONFIG;
  const category = query.category ?? null;
  const t = { ...cfg.thresholds, ...(category ? cfg.byCategory?.[category] ?? {} : {}) };
  const features = query.features ?? null;
  const texts = Array.isArray(query.texts) ? query.texts : [];
  const notes = [];
  const inCategory = (e) => !category || e.category === category;

  // 1. Identifiers and brand words.
  const ids = findIdentifiers(index, texts, cfg.identifiers);
  notes.push(...ids.notes);
  const idHits = ids.hits.filter(inCategory);
  for (const hit of ids.hits.filter((h) => !inCategory(h))) {
    const p = index.products.get(hit.productId);
    notes.push(`The code ${hit.code} belongs to the ${p.brandName} ${p.name}, which is not in this category. Change the category to use it.`);
  }
  const brandHits = findBrands(index, texts).filter((b) => [...index.products.values()].some((p) => p.brandId === b.brandId && (!category || p.category === category)));
  const link = opts.link?.status === 'resolved' && opts.link.productId && index.products.has(opts.link.productId) ? opts.link : null;
  if (link && category && index.products.get(link.productId).category !== category) {
    notes.push('The product link is for an item in a different category, so it was not used.');
  }
  const linkOk = link && (!category || index.products.get(link.productId).category === category) ? link : null;

  // 2. Visual distances for every reference in the category.
  const usable = Boolean(features && features.palette?.length && features.fgRatio >= cfg.object.minFgRatio && features.fgRatio <= cfg.object.maxFgRatio);
  if (features && !usable) notes.push("We couldn't separate an item from the background. A photo on a plain surface, with some space around the item, works best.");
  const visual = new Map();
  if (usable) {
    for (const e of index.entries) {
      if (!inCategory(e) || !e.features) continue;
      visual.set(e.variantId, visualDistance(features, e.features, cfg.visual));
    }
  }

  // 3. Products ranked by their closest version, with brand text as a small bonus.
  const brandIds = new Set(brandHits.map((b) => b.brandId));
  const products = [];
  for (const [productId, list] of index.byProduct) {
    const p = index.products.get(productId);
    if (category && p.category !== category) continue;
    const options = list
      .map((e) => ({ entry: e, v: visual.get(e.variantId) ?? null }))
      .sort((a, b) => (a.v?.total ?? Infinity) - (b.v?.total ?? Infinity));
    const best = options[0]?.v?.total ?? Infinity;
    const ranked = brandIds.has(p.brandId) ? best * (1 - cfg.brand.bonus) : best;
    products.push({
      productId,
      product: p,
      options,
      best,
      ranked,
      ids: idHits.filter((h) => h.productId === productId),
      linked: linkOk?.productId === productId,
    });
  }
  products.sort((a, b) => b.ids.filter((h) => h.exactness !== 'near').length - a.ids.filter((h) => h.exactness !== 'near').length || Number(b.linked) - Number(a.linked) || a.ranked - b.ranked);

  const strongIds = (p) => p.ids.filter((h) => h.exactness !== 'near');
  const identified = products.filter((p) => strongIds(p).length || p.linked);
  const nearOnly = products.filter((p) => !strongIds(p).length && !p.linked && p.ids.length);
  const visualRank = products.filter((p) => Number.isFinite(p.ranked)).sort((a, b) => a.ranked - b.ranked);
  const top = visualRank[0] ?? null;
  const second = visualRank[1] ?? null;
  const gap = top && second ? second.ranked - top.ranked : Infinity;
  const brandBacked = top && brandIds.has(top.product.brandId) && !visualRank.slice(1).some((p) => p.product.brandId === top.product.brandId && p.ranked - top.ranked < t.margin);
  const layoutAgrees = Boolean(top?.options[0]?.v && top.options[0].v.grid <= t.layout);

  let retrieval;
  let chosen = [];
  if (identified.length) {
    retrieval = 'candidate_found';
    chosen = identified;
  } else if (nearOnly.length === 1) {
    retrieval = 'candidate_found';
    chosen = nearOnly;
  } else if (top && top.ranked <= t.accept && layoutAgrees && (gap >= t.margin || (brandBacked && top.ranked <= t.accept))) {
    retrieval = 'candidate_found';
    chosen = [top];
  } else if (top && top.ranked <= t.similar) {
    if (top.ranked <= t.accept && !layoutAgrees) notes.push("The colors are close to a catalog product, but the item's shape in the photo doesn't match it, so it is only shown as similar.");
    retrieval = 'similar_result';
  } else {
    retrieval = 'no_match';
  }

  // 4. Candidate list: claimed matches first, then lookalikes.
  const maxSimilar = retrieval === 'no_match' ? cfg.maxLookalikes : cfg.maxCandidates;
  const similarLimit = retrieval === 'no_match' ? t.weak : t.similar;
  const chosenIds = new Set(chosen.map((p) => p.productId));
  const lookalikes = visualRank.filter((p) => !chosenIds.has(p.productId) && p.ranked <= similarLimit);
  // Near identifier hits that were not unique still deserve a look.
  const extra = retrieval === 'candidate_found' ? lookalikes : [...nearOnly.filter((p) => !lookalikes.includes(p)), ...lookalikes];
  const list = [...chosen, ...extra].slice(0, retrieval === 'candidate_found' ? cfg.maxCandidates : Math.min(cfg.maxCandidates, chosen.length + maxSimilar));

  const photoNames = usable ? photoColorNames(features, cfg.colors.mentionWeight) : [];
  const candidates = list.map((p, rank) => describeCandidate(p, { rank, chosen: chosenIds.has(p.productId), retrieval, idHits, brandHits, linkOk, photoNames, features, usable, index, t, cfg, gapToNext: rank === 0 ? gap : null }));

  // 5. What to ask for next.
  const askFor = [];
  const ask = (kind) => {
    if (!askFor.some((a) => a.kind === kind)) askFor.push({ kind, reason: ASK_REASONS[kind] });
  };
  const cat = category ?? candidates[0]?.category ?? null;
  const lead = candidates[0];
  if (retrieval === 'no_match') {
    askFor.push({ kind: 'product_link', reason: "Paste a link to the product page and we'll check it against the catalog." });
    for (const kind of ASK_FOR_VARIANT[cat] ?? []) if (kind !== 'product_link') ask(kind);
  } else if (retrieval === 'similar_result') {
    for (const kind of ASK_FOR_VARIANT[cat] ?? []) ask(kind);
    ask('product_link');
  } else if (lead?.variantAmbiguous || (lead && lead.strength !== 'strong' && !lead.evidence.some((e) => e.kind === 'identifier' || e.kind === 'product_link'))) {
    for (const kind of ASK_FOR_VARIANT[cat] ?? []) ask(kind);
  }

  const colors = [];
  for (const c of features?.palette ?? []) {
    const prev = colors.find((x) => x.name === c.name);
    if (prev) prev.weight = Math.round((prev.weight + c.weight) * 1000) / 1000;
    else colors.push({ name: c.name, hex: c.hex, weight: c.weight });
  }
  const finished = (opts.now ?? (() => globalThis.performance?.now?.() ?? Date.now()))();
  return {
    retrieval,
    candidates: candidates.map(({ category: _c, ...rest }) => rest),
    askFor,
    features: { colors: usable ? colors : [], aspect: features?.aspect ?? null, category },
    latencyMs: Math.max(0, Math.round(finished - started)),
    notes: [...new Set(notes)],
  };
}

function describeCandidate(p, ctx) {
  const { idHits, brandHits, linkOk, photoNames, features, usable, index, t, cfg, retrieval } = ctx;
  const evidence = [];
  const conflicts = [];
  const productHits = idHits.filter((h) => h.productId === p.productId);
  const exactHits = productHits.filter((h) => h.exactness !== 'near');
  const hitVariants = [...new Set(exactHits.map((h) => h.variantId))];
  const nearVariants = [...new Set(productHits.filter((h) => h.exactness === 'near').map((h) => h.variantId))];
  const name = (variantId) => index.byVariant.get(variantId)?.variantName ?? variantId;

  for (const hit of productHits) evidence.push({ kind: 'identifier', source: hit.source, detail: identifierDetail(hit, name(hit.variantId)) });
  if (linkOk?.productId === p.productId) {
    evidence.push({ kind: 'product_link', source: 'url', detail: linkOk.variantId ? `The product link you added is for ${name(linkOk.variantId)}` : 'The product link you added is for this product' });
  }
  for (const b of brandHits) {
    if (b.brandId === p.product.brandId) {
      const model = b.models.includes(p.productId) ? ` and model name ${p.product.name}` : '';
      evidence.push({ kind: 'brand_text', source: b.source, detail: `Brand name ${b.name}${model} ${SOURCE_PHRASE[b.source] ?? 'in your evidence'}` });
    } else {
      conflicts.push({ kind: 'brand_text', detail: `Your label says ${b.name}, but this is a ${p.product.brandName} product` });
    }
  }
  // Codes on the label that belong to other products disagree with this one.
  const foreign = idHits.filter((h) => h.productId !== p.productId && h.exactness !== 'near');
  for (const h of foreign) {
    const other = index.products.get(h.productId);
    conflicts.push({ kind: 'identifier', detail: `The code ${h.code} on your label belongs to the ${other.brandName} ${other.name}, not this product` });
  }

  // Visual evidence for the product's best version.
  const bestOption = p.options[0];
  const d = p.best;
  if (usable && bestOption?.v) {
    evidence.push({ kind: 'visual', source: 'image_features', detail: visualDetail(d, t) });
    const refColors = new Set(bestOption.entry.colors.map((c) => c.name));
    const shared = photoNames.filter((n) => refColors.has(n));
    if (shared.length) evidence.push({ kind: 'color', source: 'image_features', detail: `Main colors in your photo: ${photoNames.map(lowerLabel).join(', ')}` });
    for (const missing of dominantMissing(features, bestOption.entry.features, bestOption.v.shift, cfg)) {
      conflicts.push({ kind: 'color', detail: `${colorLabel(missing)} is a main color in your photo but not in this product's catalog colors` });
    }
    if (exactHits.length && d > t.similar) {
      conflicts.push({ kind: 'visual', detail: "The code matches, but the photo doesn't look like this product. Check that the label photo is from the same item." });
    }
  }

  // Version resolution.
  const v = resolveVariant(p, { hitVariants, nearVariants, linkOk, usable, index, cfg });
  if (v.conflict) conflicts.push(v.conflict);

  let strength;
  if (ctx.chosen) {
    const visualConflict = conflicts.some((c) => c.kind === 'visual' || c.kind === 'identifier' || c.kind === 'brand_text');
    if (hitVariants.length || linkOk?.productId === p.productId) strength = visualConflict || v.conflict ? 'possible' : 'strong';
    else if (nearVariants.length) strength = 'possible';
    else strength = d <= t.strong && (ctx.gapToNext ?? 0) >= t.strongMargin && !conflicts.length ? 'strong' : 'possible';
  } else {
    strength = retrieval === 'similar_result' && d <= t.accept ? 'possible' : 'weak';
  }

  const kind = ctx.chosen ? 'match' : 'similar';
  const score = ctx.chosen && (hitVariants.length || linkOk?.productId === p.productId) ? 1 : usable && Number.isFinite(d) ? similarity(p.ranked) : 0;
  return {
    id: `cand_${p.productId}`,
    productId: p.productId,
    category: p.product.category,
    kind,
    strength,
    score,
    variantId: v.variantId,
    variantOptions: v.options,
    variantAmbiguous: v.ambiguous,
    evidence,
    conflicts,
  };
}

/**
 * Picks the version: an identifier or link decides; otherwise the photo decides only when
 * one version is clearly closer and no sibling is a near-identical render.
 */
function resolveVariant(p, { hitVariants, nearVariants, linkOk, usable, index, cfg }) {
  const vc = cfg.variant;
  const ordered = p.options;
  const notes = new Map();
  let variantId = null;
  let ambiguous = false;
  let conflict = null;

  const visualBest = usable && ordered[0]?.v ? ordered[0] : null;
  const visualSecond = usable && ordered[1]?.v ? ordered[1] : null;
  const visualGap = visualBest && visualSecond ? visualSecond.v.total - visualBest.v.total : Infinity;
  const pair = visualBest && visualSecond ? index.siblings.get(visualBest.entry.variantId)?.get(visualSecond.entry.variantId) ?? null : null;
  const nearPair = Boolean(visualBest && visualSecond && index.nearPairs.has(`${visualBest.entry.variantId}|${visualSecond.entry.variantId}`));

  const decided = hitVariants.length === 1 ? hitVariants[0] : linkOk?.productId === p.productId && linkOk.variantId ? linkOk.variantId : null;
  if (decided) {
    variantId = decided;
    notes.set(decided, hitVariants.includes(decided) ? 'Matches the code on your label' : 'Matches your product link');
    // The photo clearly favoring another version is a conflict to show, even between
    // near-identical colorways: the person should check the label against the shoe.
    if (visualBest && visualBest.entry.variantId !== decided) {
      const decidedOpt = ordered.find((o) => o.entry.variantId === decided);
      const gapToDecided = decidedOpt?.v ? decidedOpt.v.total - visualBest.v.total : 0;
      if (gapToDecided >= vc.conflictMargin) {
        const by = hitVariants.includes(decided) ? 'The code on your label' : 'Your product link';
        conflict = { kind: 'identifier', detail: `${by} belongs to ${index.byVariant.get(decided).variantName}, but the colors look like ${visualBest.entry.variantName}` };
      }
    }
    if (linkOk?.productId === p.productId && linkOk.variantId && hitVariants.length === 1 && linkOk.variantId !== hitVariants[0]) {
      conflict = { kind: 'product_link', detail: `Your product link is for ${index.byVariant.get(linkOk.variantId).variantName}, but the code on your label is for ${index.byVariant.get(hitVariants[0]).variantName}` };
    }
  } else if (hitVariants.length > 1) {
    ambiguous = true;
    conflict = { kind: 'identifier', detail: `Your label shows codes for more than one version: ${hitVariants.map((id) => index.byVariant.get(id).variantName).join(' and ')}` };
  } else if (nearVariants.length === 1) {
    // One character off: a good lead, not proof.
    variantId = nearVariants[0];
    ambiguous = true;
    notes.set(variantId, 'Close to the code on your label');
  } else if (visualBest) {
    const single = ordered.length === 1;
    if (single) {
      variantId = visualBest.entry.variantId;
    } else if (pair != null && pair < vc.indistinguishable) {
      ambiguous = true;
    } else if ((pair != null && pair < vc.nearDuplicate) || nearPair) {
      ambiguous = true;
      if (visualGap >= vc.guessMargin) variantId = visualBest.entry.variantId;
    } else if (visualGap < vc.margin) {
      ambiguous = true;
      if (visualGap >= vc.guessMargin) variantId = visualBest.entry.variantId;
    } else {
      variantId = visualBest.entry.variantId;
    }
    if (variantId) notes.set(variantId, ambiguous ? 'Closest to your photo, but not certain' : 'Closest to your photo');
  } else {
    ambiguous = ordered.length > 1;
    if (!ambiguous) variantId = ordered[0]?.entry.variantId ?? null;
  }

  const reference = index.byVariant.get(variantId ?? visualBest?.entry.variantId ?? ordered[0]?.entry.variantId);
  const options = ordered.map((o) => {
    let note = notes.get(o.entry.variantId) ?? null;
    if (!note && reference && reference.variantId !== o.entry.variantId) {
      const pairD = index.siblings.get(reference.variantId)?.get(o.entry.variantId);
      const diff = difference(o.entry, reference);
      if (pairD != null && pairD < vc.indistinguishable) note = diff ? `${diff}; looks the same in photos` : 'Looks the same in photos';
      else note = diff;
    }
    return { variantId: o.entry.variantId, score: o.v ? similarity(o.v.total) : 0, note };
  });
  if (decided || nearVariants.length === 1) {
    // Keep the identified version first.
    options.sort((a, b) => Number(b.variantId === variantId) - Number(a.variantId === variantId));
  }
  return { variantId, ambiguous, options, conflict };
}
