// Grounded recommendations (ARCHITECTURE.md 6.1: RecItem, RecResult, Comparison).
//
// Pipeline: real catalog variants -> scope by mode -> hard constraints, counted when they
// exclude something (owned versions, dismissed products, strap fit, size, price, budget,
// stock) -> transparent weighted scoring (DEFAULT_WEIGHTS, admin-editable) -> MMR with
// per-product caps so the list doesn't repeat itself -> RecItems whose explanations come only
// from relations computed against the person's own items (explain.js). Prices and
// availability come only from summarizeOffers() over offers the caller supplies.
import { summarizeOffers } from './offers.js';
import { paletteHarmony, paletteSimilarity, roleSimilarity, PAIRING_THRESHOLD } from './harmony.js';
import { itemDetail, explain, colorPhrase, typeWord, tagPhrase } from './explain.js';
import { BOTTOM_TYPES, CATEGORIES, CATEGORY_LABEL, PRODUCT_TYPES, TYPE_LABEL, STYLE_LABEL, USE_LABEL } from '../data/schema.js';
import { COLOR_BY_NAME, colorLabel } from '../data/colors.js';
import { money, size as sizeText, listJoin, relative } from '../lib/format.js';

export const MODES = ['similar', 'matching', 'alternatives'];

/**
 * Ranking weights. Each multiplies one score component (see WEIGHT_RANGES for what each does);
 * `diversity` is the MMR trade-off between relevance and variety.
 */
export const DEFAULT_WEIGHTS = Object.freeze({
  style: 1,
  color: 0.6,
  harmony: 1.2,
  shape: 1.5,
  price: 0.4,
  budget: 0.5,
  request: 1.5,
  use: 0.3,
  feedback: 1,
  diversity: 0.3,
});

/** Bounds and copy for the admin weight editor. */
export const WEIGHT_RANGES = Object.freeze({
  style: { min: 0, max: 3, step: 0.1, label: 'Style match', help: 'Shared style tags with the starting items and with the styles in the profile.' },
  color: { min: 0, max: 3, step: 0.1, label: 'Liked and avoided colors', help: 'Colors the person likes count for an item; colors they avoid count against it.' },
  harmony: { min: 0, max: 3, step: 0.1, label: 'Color relation', help: "Matching: how well colors pair with the person's items. Similar: how close the colors are to the starting item." },
  shape: { min: 0, max: 3, step: 0.1, label: 'Shape and materials', help: 'Same type, silhouette, materials and key specs as the starting item.' },
  price: { min: 0, max: 2, step: 0.1, label: 'Price closeness', help: 'Known price close to the starting item, or to an "around" price in a typed request.' },
  budget: { min: 0, max: 2, step: 0.1, label: 'Profile budget', help: 'Known price within the budget set for the category counts for an item; over budget counts against.' },
  request: { min: 0, max: 3, step: 0.1, label: 'Typed request', help: 'Colors, styles, materials, brands and case size from a typed request.' },
  use: { min: 0, max: 2, step: 0.1, label: 'Intended use', help: 'Styles associated with the uses the person picked, like work or running.' },
  feedback: { min: 0, max: 3, step: 0.1, label: 'Feedback', help: 'Strength of "More like this", "Not my style", "Too similar" and "Too expensive".' },
  diversity: { min: 0, max: 0.9, step: 0.05, label: 'Variety', help: 'How much the final list trades relevance for variety. 0 keeps the ranking order.' },
});

/** Styles that tend to suit each intended use. A soft preference only, never a claim. */
export const USE_STYLES = Object.freeze({
  everyday: ['minimal', 'classic', 'street'],
  work: ['classic', 'minimal', 'dressy', 'preppy'],
  running: ['sporty', 'tech'],
  training: ['sporty', 'tech'],
  outdoors: ['outdoor', 'workwear', 'tech'],
  going_out: ['street', 'bold', 'dressy'],
  formal: ['dressy', 'classic'],
});

const LOOKALIKE_THRESHOLD = 0.85;
const STYLE_MATCH_MIN_TAGS = 2;
const DUPLICATE_PENALTY = 1.5;
const MAX_RELATED = 3;
const MAX_DUPLICATES_SHOWN = 2;
const THIN_RESULTS = 3;
const DEFAULT_LIMIT = 12;
const OUTER_TYPES = ['chore-jacket', 'field-jacket', 'bomber'];
const FIT_ATTACHMENTS = ['spring_bar', 'quick_release'];
const IN_STOCK = new Set(['in_stock_in_size', 'in_stock']);
const KIND_FOR_MODE = { similar: 'similar', matching: 'complementary', alternatives: 'wishlist_alternative' };
const CATEGORY_WORD = { sneaker: 'sneaker', watch: 'watch', clothing: 'clothing' };
const CATEGORY_PLURAL = { sneaker: 'sneakers', watch: 'watches', clothing: 'clothing' };
const SIZE_SOURCE_LABEL = { request: '', wishlist: ', from your wishlist item', profile: ', from your profile' };
const EMPTY_PROFILE = { sizes: {}, budgets: {}, styles: [], colorsLiked: [], colorsAvoided: [], uses: [], categories: [] };
const TYPE_CATEGORY = Object.fromEntries(Object.entries(PRODUCT_TYPES).flatMap(([category, types]) => types.map((t) => [t, category])));

// ---------- Weights ----------

/**
 * Validates admin-entered weights against WEIGHT_RANGES.
 * @returns {{ weights: typeof DEFAULT_WEIGHTS, errors: Record<string, string> }}
 */
export function validateWeights(raw) {
  const weights = { ...DEFAULT_WEIGHTS };
  const errors = {};
  for (const [key, range] of Object.entries(WEIGHT_RANGES)) {
    if (raw?.[key] == null || raw[key] === '') continue;
    const value = Number(raw[key]);
    if (!Number.isFinite(value) || value < range.min || value > range.max) {
      errors[key] = `${range.label} must be between ${range.min} and ${range.max}`;
      continue;
    }
    weights[key] = value;
  }
  return { weights, errors };
}

/** Stored weights merged over the defaults, clamped to their ranges; unknown keys are dropped. */
export function normalizeWeights(raw) {
  const weights = { ...DEFAULT_WEIGHTS };
  for (const [key, range] of Object.entries(WEIGHT_RANGES)) {
    const value = Number(raw?.[key]);
    if (raw?.[key] != null && raw[key] !== '' && Number.isFinite(value)) weights[key] = Math.min(range.max, Math.max(range.min, value));
  }
  return weights;
}

// ---------- Small helpers ----------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

function cosine(a = [], b = []) {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  const shared = new Set(a.filter((x) => set.has(x))).size;
  return shared / Math.sqrt(new Set(a).size * set.size);
}

function jaccard(a = [], b = []) {
  if (!a.length && !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  const shared = [...A].filter((x) => B.has(x)).length;
  return shared / new Set([...A, ...B]).size;
}

const eq = (a, b) => (a == null || b == null ? null : a === b ? 1 : 0);
const closeNum = (a, b, span) => (Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, 1 - Math.abs(a - b) / span) : null);

function mean(values) {
  const known = values.filter((v) => v != null);
  return known.length ? known.reduce((s, v) => s + v, 0) / known.length : 0;
}

/** Rounds a price up to a figure a person would type: $5 steps under $100, $10 to $500, $25 above. */
function niceCeiling(minor) {
  const step = minor < 10000 ? 500 : minor < 50000 ? 1000 : 2500;
  return Math.ceil(minor / step) * step;
}

function applyPatch(base, patch) {
  const next = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

// ---------- Subjects: one shape for catalog variants and the person's items ----------

/** Body slot: what an item is worn as. Complements come from different slots. */
export function slotOf(category, type) {
  if (category === 'sneaker') return 'feet';
  if (category === 'watch') return type === 'strap' ? 'strap' : 'wrist';
  if (category === 'clothing') {
    if (BOTTOM_TYPES.includes(type)) return 'bottom';
    if (OUTER_TYPES.includes(type)) return 'outer';
    return 'top';
  }
  return null;
}

function sizeSlot(product) {
  if (product.category === 'sneaker') return 'shoe';
  if (product.category === 'clothing') return BOTTOM_TYPES.includes(product.type) ? 'bottom' : 'top';
  return null;
}

function slotForSizeSystem(system) {
  if (['US-M', 'US-W', 'EU', 'UK'].includes(system)) return 'shoe';
  if (system === 'ALPHA') return 'top';
  if (system === 'WAIST-INSEAM') return 'bottom';
  return null;
}

function customType(category, raw) {
  if (!raw) return null;
  const text = String(raw).trim().toLowerCase();
  const types = PRODUCT_TYPES[category] ?? [];
  if (types.includes(text)) return text;
  return types.find((t) => (TYPE_LABEL[t] ?? '').toLowerCase() === text) ?? null;
}

function variantSubject(catalog, variant) {
  const product = catalog.product(variant.productId);
  if (!product) return null;
  return {
    key: `variant:${variant.id}`,
    itemId: null,
    itemType: 'variant',
    record: null,
    category: product.category,
    productId: product.id,
    variantId: variant.id,
    product,
    variant,
    brandName: catalog.brand(product.brandId)?.name ?? '',
    title: product.name,
    variantName: variant.name,
    type: product.type,
    slot: slotOf(product.category, product.type),
    colors: variant.colors ?? [],
    styleTags: product.styleTags ?? [],
    materials: product.materials ?? [],
    verifiedVariant: true,
  };
}

/** Subject for an owned or wishlist record. Custom items keep only what the person entered. */
function itemSubject(catalog, record, itemType) {
  const product = record.productId ? catalog.product(record.productId) : null;
  const variantRow = record.variantId ? catalog.variant(record.variantId) : null;
  const variant = variantRow && product && variantRow.productId === product.id ? variantRow : null;
  const base = { key: `${itemType}:${record.id}`, itemId: record.id, itemType, record };
  if (product) {
    return {
      ...base,
      category: product.category,
      productId: product.id,
      variantId: variant?.id ?? null,
      product,
      variant,
      brandName: catalog.brand(product.brandId)?.name ?? '',
      title: product.name,
      variantName: variant?.name ?? null,
      type: product.type,
      slot: slotOf(product.category, product.type),
      // An unconfirmed version has unknown colors; don't borrow another version's palette.
      colors: variant?.colors ?? [],
      styleTags: product.styleTags ?? [],
      materials: product.materials ?? [],
      verifiedVariant: Boolean(variant) && !['conflicting', 'incomplete'].includes(record.identity?.variant),
    };
  }
  const custom = record.custom ?? {};
  const type = customType(record.category, custom.type);
  const names = (custom.colors ?? []).filter((c) => COLOR_BY_NAME.has(c));
  return {
    ...base,
    category: record.category,
    productId: null,
    variantId: null,
    product: null,
    variant: null,
    brandName: custom.brand ?? '',
    title: custom.name || 'Untitled item',
    variantName: custom.variantName ?? null,
    type,
    slot: slotOf(record.category, type),
    colors: names.map((name) => ({ name, weight: 1 / names.length, role: null })),
    styleTags: [],
    materials: [],
    verifiedVariant: false,
  };
}

function baseName(subject) {
  return [subject.brandName, subject.title].filter(Boolean).join(' ').trim() || 'item';
}

function fullName(subject) {
  return subject.variantName ? `${baseName(subject)}, ${subject.variantName}` : baseName(subject);
}

function shapeWords(subject) {
  if (subject.category !== 'sneaker') return typeWord(subject.type);
  const cut = subject.product?.attributes?.cut;
  if (!cut || ['high-top', 'slip-on'].includes(subject.type)) return typeWord(subject.type);
  return `${cut} ${typeWord(subject.type)}`;
}

// ---------- Catalog facts: strap fit and lookalikes ----------

/**
 * Whether a strap fits a watch, from catalog facts only: the watch's catalog lug width must
 * equal the strap's width and its attachment must take standard spring bars. Integrated
 * bracelets, unconfirmed versions and widths the person typed in never produce a fit claim.
 * @returns {{ fits: boolean, reason: string|null, widthMm?: number, lugWidthMm?: number, attachment?: string }}
 */
export function strapFit(strap, watch) {
  if (strap?.slot !== 'strap' || watch?.slot !== 'wrist') return { fits: false, reason: 'not_applicable' };
  if (!watch.product || !watch.variant) return { fits: false, reason: 'not_in_catalog' };
  if (!watch.verifiedVariant) return { fits: false, reason: 'variant_unconfirmed' };
  const attachment = watch.product.attributes?.attachment ?? null;
  if (attachment === 'integrated') return { fits: false, reason: 'integrated' };
  if (!FIT_ATTACHMENTS.includes(attachment)) return { fits: false, reason: 'attachment_unknown' };
  const lug = watch.variant.attributes?.lugWidthMm;
  if (!Number.isFinite(lug)) return { fits: false, reason: 'lug_width_unknown' };
  if (strap.product?.attributes?.attachment === 'integrated') return { fits: false, reason: 'strap_integrated' };
  const width = strap.variant?.attributes?.strapWidthMm;
  if (!Number.isFinite(width)) return { fits: false, reason: 'strap_width_unknown' };
  if (width !== lug) return { fits: false, reason: 'width_mismatch', widthMm: width, lugWidthMm: lug, attachment };
  return { fits: true, reason: null, widthMm: width, lugWidthMm: lug, attachment };
}

/** How much `a` looks like `b` (0..1) and, for versions of one product, what differs. */
function lookalike(a, b) {
  const none = { score: 0, identical: false, sameProduct: false, differingRoles: [], sizeChange: null, shape: null };
  if (a.variantId && a.variantId === b.variantId) return { ...none, score: 1, identical: true, sameProduct: true };
  if (!a.colors.length || !b.colors.length || a.slot !== b.slot || a.category !== b.category) return none;
  if (a.productId && a.productId === b.productId) {
    const { similarity, differingRoles } = roleSimilarity(a.colors, b.colors);
    const da = a.variant?.attributes?.diameterMm;
    const db = b.variant?.attributes?.diameterMm;
    const sizeChange = !differingRoles.length && Number.isFinite(da) && Number.isFinite(db) && da !== db ? { from: db, to: da } : null;
    return { ...none, score: 0.5 + 0.5 * similarity, sameProduct: true, differingRoles, sizeChange };
  }
  const sameType = a.type && a.type === b.type ? 1 : 0;
  return { ...none, score: 0.25 + 0.2 * sameType + 0.55 * colorLikeness(a.colors, b.colors), shape: a.type ? shapeWords(a) : null };
}

/**
 * Color likeness for lookalike checks. When both palettes name their parts (upper, sole,
 * dial), parts are compared with parts, so a tan shoe on a white sole isn't a lookalike of a
 * white shoe on a tan sole; otherwise the palettes are compared as a whole.
 */
function colorLikeness(colorsA, colorsB) {
  const roles = (list) => new Set(list.map((c) => c.role).filter((r) => r && r !== 'main'));
  const ra = roles(colorsA);
  const rb = roles(colorsB);
  const shared = [...ra].filter((r) => rb.has(r));
  const weightOn = (list, set) => list.filter((c) => set.has(c.role)).reduce((sum, c) => sum + (c.weight ?? 1), 0) / (list.reduce((sum, c) => sum + (c.weight ?? 1), 0) || 1);
  const sharedSet = new Set(shared);
  if (shared.length && weightOn(colorsA, sharedSet) >= 0.5 && weightOn(colorsB, sharedSet) >= 0.5) return roleSimilarity(colorsA, colorsB).similarity;
  return paletteSimilarity(colorsA, colorsB);
}

function attributeCloseness(a, b) {
  const pa = a.product?.attributes ?? {};
  const pb = b.product?.attributes ?? {};
  const va = a.variant?.attributes ?? {};
  const vb = b.variant?.attributes ?? {};
  if (a.category === 'sneaker') return mean([eq(pa.cut, pb.cut), eq(pa.closure, pb.closure)]);
  if (a.category === 'watch') {
    if (a.type === 'strap' || b.type === 'strap') return mean([eq(va.strapWidthMm, vb.strapWidthMm)]);
    return mean([closeNum(va.diameterMm, vb.diameterMm, 4), eq(pa.movement, pb.movement), eq(va.caseMaterial, vb.caseMaterial)]);
  }
  return mean([eq(pa.fit, pb.fit), eq(pa.weight, pb.weight)]);
}

/** Type, silhouette, materials and key specs (0..1). Different categories score 0. */
function shapeSimilarity(a, b) {
  if (a.category !== b.category) return 0;
  let s = 0;
  if (a.type && a.type === b.type) s += 0.45;
  if (a.slot === b.slot) s += 0.15;
  s += 0.2 * jaccard(a.materials, b.materials);
  s += 0.2 * attributeCloseness(a, b);
  return Math.min(1, s);
}

function sameShapeFacts(cand, other) {
  const va = cand.variant?.attributes ?? {};
  const vb = other.variant?.attributes ?? {};
  const dialDiffers = va.dialColor && vb.dialColor && va.dialColor !== vb.dialColor;
  const caseDiffers = Number.isFinite(va.diameterMm) && Number.isFinite(vb.diameterMm) && va.diameterMm !== vb.diameterMm;
  return {
    category: cand.category,
    type: cand.type,
    shape: shapeWords(cand),
    colorPhrase: colorPhrase(cand.colors),
    dial: cand.category === 'watch' && (dialDiffers || !vb.dialColor) ? va.dialColor ?? null : null,
    caseMm: cand.category === 'watch' && caseDiffers ? va.diameterMm : null,
  };
}

/**
 * Every relation between a suggested variant and one of the person's items. A lookalike is
 * reported as a near-duplicate and nothing else, so it is never also sold as a pairing.
 */
function relate(cand, item) {
  const out = [];
  const look = lookalike(cand, item);
  if (look.identical || look.score >= LOOKALIKE_THRESHOLD) {
    out.push({ relation: 'near_duplicate', subject: item, strength: look.score, group: 'duplicate', facts: look });
    return out;
  }
  if (cand.slot === 'strap' || item.slot === 'strap') {
    const fit = cand.slot === 'strap' ? strapFit(cand, item) : strapFit(item, cand);
    if (fit.fits) {
      out.push({
        relation: 'strap_fit',
        subject: item,
        strength: 1,
        group: 'complement',
        facts: { widthMm: fit.widthMm, attachment: fit.attachment, direction: cand.slot === 'strap' ? 'strap_for_watch' : 'watch_for_strap' },
      });
    }
    return out;
  }
  const shared = cand.styleTags.filter((t) => item.styleTags.includes(t));
  if (cand.slot !== item.slot) {
    const h = paletteHarmony(cand.colors, item.colors);
    if (h.score >= PAIRING_THRESHOLD && h.kind !== 'clash' && h.kind !== 'none') {
      out.push({ relation: 'color_pairing', subject: item, strength: h.score, group: 'complement', facts: { sentence: h.sentence, kind: h.kind, colors: h.colors } });
    } else if (h.score < 0) {
      // Kept for ranking only; a clash is never shown as a reason to buy.
      out.push({ relation: 'clash', subject: item, strength: -h.score, group: 'clash', facts: { sentence: h.sentence } });
    }
    if (shared.length >= STYLE_MATCH_MIN_TAGS) out.push({ relation: 'style_match', subject: item, strength: Math.min(1, shared.length / 3), group: 'complement', facts: { tags: shared } });
  } else {
    if (cand.type && cand.type === item.type) out.push({ relation: 'same_shape', subject: item, strength: shapeSimilarity(cand, item), group: 'similar', facts: sameShapeFacts(cand, item) });
    if (shared.length >= STYLE_MATCH_MIN_TAGS) out.push({ relation: 'style_match', subject: item, strength: Math.min(1, shared.length / 3), group: 'similar', facts: { tags: shared } });
  }
  return out;
}

/** Strongest complementary value per anchor, best first, with clashes as negatives. */
function complementScore(relations) {
  const perItem = new Map();
  for (const r of relations) {
    const value = r.group === 'complement' ? (r.relation === 'style_match' ? 0.6 * r.strength : r.strength) : r.group === 'clash' ? -r.strength : null;
    if (value == null) continue;
    const prev = perItem.get(r.subject.key);
    perItem.set(r.subject.key, prev == null ? value : value < 0 || prev < 0 ? prev + value : Math.max(prev, value));
  }
  const values = [...perItem.values()].sort((a, b) => b - a);
  const positives = values.filter((v) => v > 0);
  const negatives = values.filter((v) => v < 0);
  const best = (positives[0] ?? 0) + 0.5 * (positives[1] ?? 0);
  return clamp(best / 1.5 + 0.5 * negatives.reduce((s, v) => s + v, 0), -1, 1);
}

// ---------- Context ----------

function byCreated(a, b) {
  return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id));
}

function defaultViews(catalog) {
  return {
    product: (p) => ({ id: p.id, category: p.category, type: p.type, typeLabel: TYPE_LABEL[p.type] ?? p.type, name: p.name, brand: catalog.brand(p.brandId) ? { id: p.brandId, name: catalog.brand(p.brandId).name } : null, styleTags: p.styleTags }),
    variant: (v) => ({ id: v.id, productId: v.productId, name: v.name, identifiers: v.identifiers, code: v.identifiers?.styleCode ?? v.identifiers?.reference ?? null, colors: v.colors, attributes: v.attributes, msrpMinor: v.msrpMinor, currency: v.currency, release: v.release, image: { url: null, label: null } }),
    owned: () => null,
    wishlist: () => null,
  };
}

function createContext(input) {
  const catalog = input.catalog;
  const now = input.now;
  const mode = MODES.includes(input.mode) ? input.mode : 'similar';
  const views = { ...defaultViews(catalog), ...(input.views ?? {}) };
  const profile = { ...EMPTY_PROFILE, ...(input.profile ?? {}) };
  const owned = (input.owned ?? []).filter((i) => !i.archivedAt).sort(byCreated);
  const wishlist = (input.wishlist ?? []).filter((w) => (w.status ?? 'active') === 'active').sort(byCreated);
  const ownedSubjects = owned.map((r) => itemSubject(catalog, r, 'owned'));
  const wishSubjects = wishlist.map((r) => itemSubject(catalog, r, 'wishlist'));

  const seeds = [];
  for (const seed of input.seeds ?? []) {
    if (!seed?.record) continue;
    if (seed.type === 'variant') {
      const s = variantSubject(catalog, seed.record);
      if (s) seeds.push(s);
      continue;
    }
    // Build from the record passed in (it may be newer than the list copy); keys still match.
    seeds.push(itemSubject(catalog, seed.record, seed.type === 'wishlist' ? 'wishlist' : 'owned'));
  }

  const ctx = {
    input,
    catalog,
    now,
    mode,
    views,
    profile,
    weights: normalizeWeights(input.weights),
    limit: clamp(Math.round(input.limit ?? DEFAULT_LIMIT), 1, 48),
    constraints: { ...(input.constraints ?? {}) },
    scope: input.scope ?? {},
    exploreColorways: Boolean(input.exploreColorways ?? input.constraints?.exploreColorways),
    freshnessHours: input.freshnessHours,
    ownedSubjects,
    wishSubjects,
    seeds,
    seedSlots: new Set(seeds.map((s) => s.slot)),
    seedVariantIds: new Set(seeds.map((s) => s.variantId).filter(Boolean)),
    excludeVariantIds: new Set(input.excludeVariantIds ?? []),
    ownedVariantIds: new Set(ownedSubjects.map((s) => s.variantId).filter(Boolean)),
    wishVariantIds: new Set(wishSubjects.map((s) => s.variantId).filter(Boolean)),
    blocked: null,
    intent: null,
    wishSeed: null,
    anchors: [],
  };

  // Names: add the version when two of the person's items share a product.
  const counts = new Map();
  for (const s of ownedSubjects) if (s.productId) counts.set(`owned:${s.productId}`, (counts.get(`owned:${s.productId}`) ?? 0) + 1);
  for (const s of wishSubjects) if (s.productId) counts.set(`wishlist:${s.productId}`, (counts.get(`wishlist:${s.productId}`) ?? 0) + 1);
  ctx.nameOf = (subject, precise = false) => {
    if (subject.itemType === 'variant') return null;
    const shared = subject.productId && (counts.get(`${subject.itemType}:${subject.productId}`) ?? 0) > 1;
    return precise || shared ? fullName(subject) : baseName(subject);
  };

  const offerCache = new Map();
  ctx.offers = (variantId) => {
    if (!offerCache.has(variantId)) offerCache.set(variantId, (input.offersFor ? input.offersFor(variantId) : catalog.offersOf(variantId)) ?? []);
    return offerCache.get(variantId);
  };
  const summaryCache = new Map();
  ctx.summary = (variantId, size, condition) => {
    const key = `${variantId}|${size ? `${size.system}:${size.value}` : '-'}|${condition}`;
    if (!summaryCache.has(key)) {
      summaryCache.set(key, summarizeOffers({ offers: ctx.offers(variantId), retailers: catalog.retailers, size, condition, now, freshnessHours: ctx.freshnessHours }));
    }
    return summaryCache.get(key);
  };
  const viewCache = new Map();
  ctx.viewOf = (subject) => {
    if (!viewCache.has(subject.key)) {
      const view = subject.itemType === 'owned' ? views.owned(subject.record) : subject.itemType === 'wishlist' ? views.wishlist(subject.record) : null;
      viewCache.set(subject.key, view ?? null);
    }
    return viewCache.get(subject.key);
  };

  setUpMode(ctx);
  ctx.feedback = feedbackModel(ctx, input.feedback ?? []);
  return ctx;
}

/** Anchors, intent and the reasons a mode cannot run at all. */
function setUpMode(ctx) {
  const { mode, seeds } = ctx;
  if (mode === 'matching') {
    ctx.anchors = seeds.length ? seeds : ctx.ownedSubjects;
    if (!ctx.anchors.length) ctx.blocked = 'Add items to your collection to see what goes with them.';
    else if (seeds.length && seeds.every((s) => !s.colors.length && !s.styleTags.length && s.slot !== 'wrist')) {
      ctx.blocked = `Add the colors of ${seeds.length > 1 ? 'these items' : `your ${baseName(seeds[0])}`} so we can suggest what goes with ${seeds.length > 1 ? 'them' : 'it'}.`;
    }
    return;
  }
  if (mode === 'alternatives') {
    const wish = seeds.find((s) => s.itemType === 'wishlist') ?? seeds.find((s) => s.itemType === 'variant') ?? null;
    if (!wish) {
      ctx.blocked = 'Choose a wishlist item to find alternatives for.';
      return;
    }
    ctx.wishSeed = wish;
    const record = wish.record;
    ctx.intent = wish.itemType === 'wishlist' ? record.intent ?? 'inspiration' : 'inspiration';
    if (ctx.intent === 'exact') {
      if (!record.desired?.variantFlexible) {
        ctx.blocked = "You want this exact version, so we don't suggest replacements. Its offers are on the product page.";
      } else if (!wish.productId) {
        ctx.blocked = 'This is a custom item, so there are no catalog colorways to suggest.';
      }
    }
    if (ctx.intent === 'complement') {
      const linked = new Set(record.linkedOwnedIds ?? []);
      const picked = ctx.ownedSubjects.filter((s) => linked.has(s.itemId));
      ctx.anchors = picked.length ? picked : ctx.ownedSubjects;
      if (!ctx.anchors.length) ctx.blocked = 'Add items to your collection to see what goes with them.';
    }
  }
}

function feedbackModel(ctx, feedback) {
  const model = { dismissed: new Set(), likes: [], dislikes: [], tooSimilar: [], ceilings: new Map(), count: 0 };
  const { catalog } = ctx;
  for (const fb of feedback) {
    if (fb.active === false) continue;
    const product = catalog.product(fb.productId);
    if (!product) continue;
    const variantRow = fb.variantId ? catalog.variant(fb.variantId) : null;
    const variant = variantRow?.productId === product.id ? variantRow : catalog.variantsOf(product.id)[0] ?? null;
    const subject = variant ? variantSubject(catalog, variant) : null;
    model.count += 1;
    if (fb.type === 'more_like_this' && subject) model.likes.push(subject);
    if (fb.type === 'wrong_style') {
      model.dismissed.add(product.id);
      if (subject) model.dislikes.push(subject);
    }
    if (fb.type === 'too_similar') {
      model.dismissed.add(product.id);
      const context = fb.contextItemId
        ? [...ctx.ownedSubjects, ...ctx.wishSubjects].find((s) => s.itemId === fb.contextItemId)
        : null;
      if (context ?? subject) model.tooSimilar.push(context ?? subject);
    }
    if (fb.type === 'too_expensive') {
      // The price the person reacted to: the best known new price, else the list price.
      const variants = variantRow?.productId === product.id ? [variantRow] : catalog.variantsOf(product.id);
      const prices = variants.map((v) => ctx.summary(v.id, null, 'new_only').fromMinor).filter((p) => p != null);
      const price = prices.length ? Math.min(...prices) : variants.map((v) => v.msrpMinor).filter((p) => p != null).sort((a, b) => a - b)[0] ?? null;
      if (price != null) model.ceilings.set(product.category, Math.min(model.ceilings.get(product.category) ?? Infinity, price));
    }
  }
  return model;
}

// ---------- Candidates (constraint-independent facts, computed once per request) ----------

function candidates(ctx) {
  if (ctx.candidateList) return ctx.candidateList;
  const list = [];
  const seedKeys = new Set(ctx.seeds.map((s) => s.key));
  const anchorKeys = new Set(ctx.anchors.map((a) => a.key));
  for (const variant of ctx.catalog.variants.values()) {
    if (ctx.seedVariantIds.has(variant.id) || ctx.excludeVariantIds.has(variant.id)) continue;
    const subject = variantSubject(ctx.catalog, variant);
    if (!subject) continue;
    const ownedRelations = ctx.ownedSubjects.filter((o) => !seedKeys.has(o.key)).flatMap((o) => relate(subject, o));
    const seedRelations = ctx.seeds.flatMap((s) => relate(subject, s));
    const all = [...seedRelations, ...ownedRelations];
    const anchorRelations = all.filter((r) => anchorKeys.has(r.subject.key));
    const lookalikes = all.filter((r) => r.relation === 'near_duplicate' && r.subject.itemType === 'owned');
    list.push({
      subject,
      variant,
      product: subject.product,
      owned: ctx.ownedVariantIds.has(variant.id),
      onWishlist: ctx.wishVariantIds.has(variant.id),
      seedRelations,
      ownedRelations,
      anchorRelations,
      lookalikes,
    });
  }
  ctx.candidateList = list;
  return list;
}

// ---------- Constraints ----------

function sizeLabel(size) {
  const text = sizeText(size) ?? `${size.value}`;
  return size.system === 'ALPHA' ? `size ${text}` : text;
}

/** Effective hard and soft constraints for one run (relaxations re-run with a patch). */
function makePlan(ctx, constraints) {
  const c = constraints ?? {};
  const explicitCategories = c.category ? [c.category] : Array.isArray(c.categories) && c.categories.length ? c.categories : null;
  const scopeCategories = ctx.scope.categories?.length ? ctx.scope.categories : null;
  const categories = explicitCategories && scopeCategories
    ? explicitCategories.filter((x) => scopeCategories.includes(x))
    : explicitCategories ?? scopeCategories;
  const explicitTypes = Array.isArray(c.types) && c.types.length ? c.types : null;
  const scopeTypes = ctx.scope.types?.length ? ctx.scope.types : null;
  const types = explicitTypes && scopeTypes ? explicitTypes.filter((t) => scopeTypes.includes(t)) : explicitTypes ?? scopeTypes;

  let maxPriceMinor = Number.isInteger(c.maxPriceMinor) && c.maxPriceMinor > 0 ? c.maxPriceMinor : null;
  let ceilingSource = maxPriceMinor != null ? 'request' : null;
  const minPriceMinor = Number.isInteger(c.minPriceMinor) && c.minPriceMinor > 0 ? c.minPriceMinor : null;
  const aroundMinor = Number.isInteger(c.priceAroundMinor) && c.priceAroundMinor > 0 ? c.priceAroundMinor : null;
  if (maxPriceMinor == null && aroundMinor != null) {
    // "Around $200" should not surface a $600 watch: allow a quarter above the figure.
    maxPriceMinor = niceCeiling(Math.round(aroundMinor * 1.25));
    ceilingSource = 'around';
  }

  const wish = ctx.mode === 'alternatives' ? ctx.wishSeed : null;
  const wishRecord = wish?.itemType === 'wishlist' ? wish.record : null;
  let wishPriceMinor = null;
  const condition = ['new_only', 'new_or_used'].includes(c.condition) ? c.condition : wishRecord?.desired?.condition ?? 'new_only';

  // Sizes per body slot: typed request first, then the wishlist item, then the profile.
  const sizes = {};
  if (!c.anySize) {
    const profileSizes = ctx.profile.sizes ?? {};
    for (const slot of ['shoe', 'top', 'bottom']) if (profileSizes[slot]?.value) sizes[slot] = { size: profileSizes[slot], source: 'profile' };
    const wishSize = wishRecord?.desired?.size;
    if (wishSize?.value && wish.product) {
      const slot = sizeSlot(wish.product);
      if (slot) sizes[slot] = { size: wishSize, source: 'wishlist' };
    }
    if (c.size?.value && c.size?.system) {
      const slot = slotForSizeSystem(c.size.system);
      if (slot) sizes[slot] = { size: { value: String(c.size.value), system: c.size.system }, source: 'request' };
    }
  }

  if (wish && maxPriceMinor == null) {
    const wishSizePick = wish.product ? sizes[sizeSlot(wish.product)] : null;
    const wishSize = wishSizePick && wish.product?.sizing?.system === wishSizePick.size.system ? wishSizePick.size : null;
    wishPriceMinor = wish.variantId ? ctx.summary(wish.variantId, wishSize, condition).fromMinor : null;
    if (wishRecord?.targetPriceMinor != null) {
      maxPriceMinor = wishRecord.targetPriceMinor;
      ceilingSource = 'target';
    } else if (wishRecord?.reason === 'too_expensive' && wishPriceMinor != null) {
      maxPriceMinor = wishPriceMinor - 1;
      ceilingSource = 'wish_price';
    }
  } else if (wish?.variantId) {
    wishPriceMinor = ctx.summary(wish.variantId, null, condition).fromMinor;
  }

  return {
    constraints: c,
    categories,
    categoriesExplicit: Boolean(explicitCategories),
    types,
    typeCategories: new Set((types ?? []).map((t) => TYPE_CATEGORY[t]).filter(Boolean)),
    typesExplicit: Boolean(explicitTypes),
    maxPriceMinor,
    minPriceMinor,
    aroundMinor,
    ceilingSource,
    wishPriceMinor,
    // Items without offers can't be checked against a price range, a typed size or "in stock".
    priceChecked: maxPriceMinor != null || minPriceMinor != null || Boolean(sizes.shoe?.source === 'request' || sizes.top?.source === 'request' || sizes.bottom?.source === 'request') || Boolean(c.inStockOnly),
    priceRange: maxPriceMinor != null || minPriceMinor != null,
    condition,
    sizes,
    anySize: Boolean(c.anySize),
    strapWidthMm: Number.isFinite(c.strapWidthMm) ? c.strapWidthMm : null,
    caseDiameterMm: Number.isFinite(c.caseDiameterMm) ? c.caseDiameterMm : null,
    includeOwned: Boolean(c.includeOwned),
    includeUnknownPrice: Boolean(c.includeUnknownPrice),
    inStockOnly: Boolean(c.inStockOnly),
    request: {
      colors: (c.colors ?? []).filter((x) => COLOR_BY_NAME.has(x)),
      avoidColors: (c.avoidColors ?? []).filter((x) => COLOR_BY_NAME.has(x)),
      styles: (c.styles ?? []).filter((x) => STYLE_LABEL[x]),
      avoidStyles: (c.avoidStyles ?? []).filter((x) => STYLE_LABEL[x]),
      uses: (c.uses ?? []).filter((x) => USE_STYLES[x]),
      materials: (c.materials ?? []).map((m) => String(m).toLowerCase()).filter(Boolean),
      brandIds: (c.brandIds ?? []).filter((id) => ctx.catalog.brand(id)),
    },
  };
}

function sizeFor(plan, product) {
  if (plan.anySize) return null;
  const sizing = product.sizing;
  if (!sizing || sizing.system === 'ONE-SIZE') return null;
  const slot = sizeSlot(product);
  const pick = slot ? plan.sizes[slot] : null;
  if (!pick) return null;
  return { ...pick, slot, comparable: pick.size.system === sizing.system };
}

function categoryScope(plan, cand) {
  if (plan.categories && !plan.categories.includes(cand.product.category)) return false;
  if (!plan.types) return true;
  // A type narrows its own category; another category stays only when it was asked for too
  // ("olive sneakers and a field jacket" keeps every sneaker and only field jackets).
  if (plan.typeCategories.has(cand.product.category)) return plan.types.includes(cand.product.type);
  return Boolean(plan.categories?.includes(cand.product.category));
}

function modeScope(ctx, cand) {
  const s = cand.subject;
  if (ctx.mode === 'similar') return { ok: !ctx.seeds.length || ctx.seedSlots.has(s.slot) };
  if (ctx.mode === 'matching') {
    if (s.slot === 'strap') {
      const watches = ctx.anchors.filter((a) => a.slot === 'wrist');
      if (!watches.length) return { ok: false };
      const fits = cand.anchorRelations.some((r) => r.relation === 'strap_fit');
      return fits ? { ok: true } : { ok: true, incompatible: watches.map((w) => ({ watch: w, ...strapFit(s, w) })) };
    }
    if (ctx.seeds.length && ctx.seedSlots.has(s.slot)) return { ok: false };
    return { ok: cand.anchorRelations.some((r) => r.group === 'complement') };
  }
  // Alternatives keep the wishlist item's category and body slot, and honor its intent.
  const wish = ctx.wishSeed;
  if (ctx.intent === 'exact') return { ok: Boolean(wish.productId) && s.productId === wish.productId };
  if (s.slot !== wish.slot || s.category !== wish.category) return { ok: false };
  if (ctx.intent === 'complement') return { ok: cand.anchorRelations.some((r) => r.group === 'complement') };
  return { ok: true };
}

function widthMatches(cand, width) {
  const attrs = cand.variant.attributes ?? {};
  if (cand.subject.slot === 'strap') return attrs.strapWidthMm === width;
  if (cand.subject.slot === 'wrist') return attrs.lugWidthMm === width;
  return true;
}

// ---------- Scoring ----------

function colorShare(colors, names) {
  const set = new Set(names);
  const total = colors.reduce((s, c) => s + (c.weight ?? 1), 0) || 1;
  return colors.filter((c) => set.has(c.name)).reduce((s, c) => s + (c.weight ?? 1), 0) / total;
}

function colorAffinity(profile, colors) {
  if (!colors.length) return 0;
  const liked = new Set(profile.colorsLiked ?? []);
  const avoided = new Set(profile.colorsAvoided ?? []);
  const total = colors.reduce((s, c) => s + (c.weight ?? 1), 0) || 1;
  let v = 0;
  for (const c of colors) v += ((c.weight ?? 1) / total) * (liked.has(c.name) ? 1 : avoided.has(c.name) ? -1.5 : 0);
  return clamp(v, -1, 1);
}

function priceProximity(price, reference) {
  if (price == null || reference == null || price <= 0 || reference <= 0) return 0;
  return Math.max(0, 1 - Math.abs(Math.log(price / reference)) / Math.log(2));
}

function seedPrice(ctx, plan, seed) {
  if (!seed.variantId) return null;
  const pick = seed.product ? sizeFor(plan, seed.product) : null;
  return ctx.summary(seed.variantId, pick?.comparable ? pick.size : null, plan.condition).fromMinor;
}

function feedbackPart(ctx, entry) {
  const s = entry.cand.subject;
  const fb = ctx.feedback;
  let v = 0;
  for (const liked of fb.likes) v += 0.5 * cosine(s.styleTags, liked.styleTags) + 0.5 * paletteSimilarity(s.colors, liked.colors);
  for (const disliked of fb.dislikes) v -= 0.8 * cosine(s.styleTags, disliked.styleTags);
  for (const ref of fb.tooSimilar) {
    const sim = lookalike(s, ref).score;
    if (sim >= 0.6) v -= (sim - 0.6) / 0.4;
  }
  const ceiling = fb.ceilings.get(s.category);
  const price = entry.summary.fromMinor;
  if (ceiling != null && price != null && price >= ceiling) v -= 0.5 + Math.min(0.5, (price - ceiling) / ceiling);
  return clamp(v, -2, 1.5);
}

function requestPart(plan, cand) {
  const r = plan.request;
  const s = cand.subject;
  const facets = [];
  if (r.colors.length) facets.push(Math.min(1, colorShare(s.colors, r.colors) / 0.5));
  if (r.avoidColors.length) facets.push(-Math.min(1, 1.5 * colorShare(s.colors, r.avoidColors)));
  if (r.styles.length) facets.push(cosine(s.styleTags, r.styles));
  if (r.avoidStyles.length) facets.push(-cosine(s.styleTags, r.avoidStyles));
  if (r.materials.length) {
    const text = [...(cand.product.materials ?? []), cand.product.attributes?.material, cand.product.attributes?.upperMaterial, cand.variant.attributes?.bracelet]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    facets.push(r.materials.filter((m) => text.includes(m)).length / r.materials.length);
  }
  if (r.brandIds.length) facets.push(r.brandIds.includes(cand.product.brandId) ? 1 : 0);
  if (plan.caseDiameterMm != null && s.slot === 'wrist') facets.push(closeNum(cand.variant.attributes?.diameterMm, plan.caseDiameterMm, 6) ?? 0);
  return facets.length ? clamp(facets.reduce((a, b) => a + b, 0) / facets.length, -1, 1) : 0;
}

function scoreEntry(ctx, plan, entry) {
  const { cand, summary } = entry;
  const s = cand.subject;
  const seeds = ctx.seeds;
  const profileStyles = ctx.profile.styles ?? [];
  const seedTags = [...new Set(seeds.flatMap((x) => x.styleTags))];
  const uses = [...new Set([...(ctx.profile.uses ?? []), ...plan.request.uses])];
  const useStyles = [...new Set(uses.flatMap((u) => USE_STYLES[u] ?? []))];
  const price = summary.fromMinor;
  const budget = ctx.profile.budgets?.[s.category];

  let harmony = 0;
  let shape = 0;
  let priceRef = plan.aroundMinor;
  if (ctx.mode === 'matching' || (ctx.mode === 'alternatives' && ctx.intent === 'complement')) {
    harmony = complementScore(cand.anchorRelations);
  } else if (seeds.length) {
    const same = seeds.filter((x) => x.category === s.category);
    harmony = Math.max(0, ...same.map((x) => paletteSimilarity(s.colors, x.colors)));
    shape = Math.max(0, ...same.map((x) => shapeSimilarity(s, x)));
  } else {
    // Request and profile picks: lean toward things that also pair with the collection.
    harmony = 0.5 * complementScore(cand.ownedRelations);
  }
  // Price closeness to a seed is a "similar" signal; matching only uses an "around" target.
  if (priceRef == null && seeds.length && (ctx.mode === 'similar' || (ctx.mode === 'alternatives' && ctx.intent !== 'complement'))) {
    const known = seeds.filter((x) => x.category === s.category).map((x) => seedPrice(ctx, plan, x)).filter((p) => p != null);
    priceRef = known.length ? known[0] : null;
  }

  const parts = {
    style: seeds.length ? 0.6 * cosine(s.styleTags, seedTags) + 0.4 * cosine(s.styleTags, profileStyles) : cosine(s.styleTags, profileStyles),
    color: colorAffinity(ctx.profile, s.colors),
    harmony,
    shape,
    price: priceProximity(price, priceRef),
    budget: budget && price != null ? (price <= budget ? 1 : -Math.min(1, (2 * (price - budget)) / budget)) : 0,
    request: requestPart(plan, cand),
    use: cosine(s.styleTags, useStyles),
    feedback: feedbackPart(ctx, entry),
  };
  let score = 0;
  for (const [key, value] of Object.entries(parts)) score += (ctx.weights[key] ?? 0) * value;
  if (entry.duplicate && !cand.owned) score -= DUPLICATE_PENALTY;
  return { score, parts };
}

// ---------- Pipeline ----------

function runPipeline(ctx, constraints) {
  const plan = makePlan(ctx, constraints);
  const excluded = { owned: 0, overBudget: 0, priceUnknown: 0, sizeUnavailable: 0, dismissed: 0, incompatible: 0, nearDuplicates: 0 };
  const notes = { inScope: 0, overBudgetPrices: [], sizeIncomparable: 0, sizesApplied: new Map(), strapReasons: [], strapsConsidered: 0 };
  if (ctx.blocked) return { plan, excluded, notes, passed: [], selected: [] };

  const passed = [];
  for (const cand of candidates(ctx)) {
    if (!categoryScope(plan, cand)) continue;
    const scope = modeScope(ctx, cand);
    if (!scope.ok) continue;
    notes.inScope += 1;
    if (cand.subject.slot === 'strap') notes.strapsConsidered += 1;
    if (cand.owned && !plan.includeOwned) {
      excluded.owned += 1;
      continue;
    }
    if (ctx.feedback.dismissed.has(cand.product.id)) {
      excluded.dismissed += 1;
      continue;
    }
    if (scope.incompatible) {
      excluded.incompatible += 1;
      notes.strapReasons.push(...scope.incompatible);
      continue;
    }
    const pick = sizeFor(plan, cand.product);
    const size = pick?.comparable ? pick.size : null;
    const summary = ctx.summary(cand.variant.id, size, plan.condition);
    if (pick) {
      if (!pick.comparable || !(cand.product.sizing.sizes ?? []).includes(pick.size.value)) {
        excluded.sizeUnavailable += 1;
        if (!pick.comparable) notes.sizeIncomparable += 1;
        notes.sizesApplied.set(pick.slot, pick);
        continue;
      }
      notes.sizesApplied.set(pick.slot, pick);
      if (summary.availability === 'size_unavailable' || summary.availability === 'out_of_stock') {
        excluded.sizeUnavailable += 1;
        continue;
      }
    }
    if (plan.strapWidthMm != null && !widthMatches(cand, plan.strapWidthMm)) {
      excluded.sizeUnavailable += 1;
      continue;
    }
    const known = summary.fromMinor != null;
    if (!known && plan.priceChecked && !plan.includeUnknownPrice) {
      excluded.priceUnknown += 1;
      continue;
    }
    if (known && plan.maxPriceMinor != null && summary.fromMinor > plan.maxPriceMinor) {
      excluded.overBudget += 1;
      notes.overBudgetPrices.push(summary.fromMinor);
      continue;
    }
    if (known && plan.minPriceMinor != null && summary.fromMinor < plan.minPriceMinor) {
      excluded.overBudget += 1;
      continue;
    }
    if (plan.inStockOnly && !IN_STOCK.has(summary.availability)) {
      excluded.sizeUnavailable += 1;
      continue;
    }
    const duplicate = cand.lookalikes.length > 0;
    // A lookalike of something owned doesn't "go with" it; it replaces it.
    if (duplicate && !cand.owned && ctx.mode === 'matching') {
      excluded.nearDuplicates += 1;
      continue;
    }
    passed.push({ cand, summary, size, sizeSource: pick?.source ?? null, duplicate });
  }

  const scored = passed.map((entry) => ({ ...entry, ...scoreEntry(ctx, plan, entry) }));
  const selected = select(ctx, scored, excluded);
  return { plan, excluded, notes, passed: scored, selected };
}

function diversitySim(ctx, a, b) {
  if (a.product.id === b.product.id) return 1;
  const key = a.variant.id < b.variant.id ? `${a.variant.id}|${b.variant.id}` : `${b.variant.id}|${a.variant.id}`;
  ctx.simCache ??= new Map();
  if (!ctx.simCache.has(key)) {
    const sameType = a.subject.type && a.subject.type === b.subject.type ? 1 : 0;
    ctx.simCache.set(key, 0.3 * sameType + 0.4 * paletteSimilarity(a.subject.colors, b.subject.colors) + 0.3 * cosine(a.subject.styleTags, b.subject.styleTags));
  }
  return ctx.simCache.get(key);
}

function compareEntries(a, b) {
  return b.score - a.score || a.cand.variant.id.localeCompare(b.cand.variant.id);
}

/**
 * Maximal marginal relevance: each pick balances its own score against how much it repeats
 * what is already on the list. Products are capped (one version each; two when exploring
 * colorways), and lookalikes of owned items are capped too.
 */
function select(ctx, scored, excluded) {
  const lambda = 1 - ctx.weights.diversity;
  const perProduct = ctx.mode === 'alternatives' && ctx.intent === 'exact' ? Infinity : ctx.mode === 'similar' && ctx.exploreColorways ? 2 : 1;
  const pool = [...scored].sort(compareEntries);
  if (!pool.length) return [];
  const max = pool[0].score;
  const min = pool[pool.length - 1].score;
  const relevance = (score) => (max - min > 1e-9 ? (score - min) / (max - min) : 1);
  const chosen = [];
  const perProductCount = new Map();
  let duplicates = 0;
  // While diversity is on, a lookalike of something already picked waits until nothing else
  // qualifies, so the list never runs through near-identical products.
  const repeats = (entry) => ctx.weights.diversity > 0 && chosen.some((c) => c.cand.product.id !== entry.cand.product.id && lookalike(entry.cand.subject, c.cand.subject).score >= LOOKALIKE_THRESHOLD);
  const pick = (allowRepeats) => {
    let best = null;
    let bestValue = -Infinity;
    for (const entry of pool) {
      if (entry.taken) continue;
      if ((perProductCount.get(entry.cand.product.id) ?? 0) >= perProduct) continue;
      if (entry.duplicate && !entry.cand.owned && duplicates >= MAX_DUPLICATES_SHOWN) continue;
      if (!allowRepeats && repeats(entry)) continue;
      const overlap = chosen.length ? Math.max(...chosen.map((c) => diversitySim(ctx, entry.cand, c.cand))) : 0;
      const value = lambda * relevance(entry.score) - (1 - lambda) * overlap;
      if (value > bestValue + 1e-9 || (best && Math.abs(value - bestValue) <= 1e-9 && compareEntries(entry, best) < 0)) {
        best = entry;
        bestValue = value;
      }
    }
    return best;
  };
  while (chosen.length < ctx.limit) {
    const best = pick(false) ?? pick(true);
    if (!best) break;
    best.taken = true;
    chosen.push(best);
    perProductCount.set(best.cand.product.id, (perProductCount.get(best.cand.product.id) ?? 0) + 1);
    if (best.duplicate && !best.cand.owned) duplicates += 1;
  }
  if (duplicates >= MAX_DUPLICATES_SHOWN) {
    excluded.nearDuplicates += pool.filter((e) => !e.taken && e.duplicate && !e.cand.owned).length;
  }
  for (const entry of pool) delete entry.taken;
  return chosen;
}

// ---------- Building RecItems ----------

function toExplainRel(ctx, rel) {
  const precise = rel.relation === 'near_duplicate' && rel.facts?.sameProduct && !rel.facts?.identical;
  return { relation: rel.relation, itemType: rel.subject.itemType, itemId: rel.subject.itemId, name: ctx.nameOf(rel.subject, precise), facts: rel.facts };
}

/** Relations to the wishlist item an alternative is for: why it is an alternative, and price. */
function wishRelations(ctx, plan, entry) {
  const wish = ctx.wishSeed;
  const cand = entry.cand.subject;
  const shared = cand.styleTags.filter((t) => wish.styleTags.includes(t));
  let basis = 'category';
  if (cand.productId && cand.productId === wish.productId) basis = 'colorway';
  else if (cand.type && cand.type === wish.type) basis = 'shape';
  else if (shared.length) basis = 'style';
  const out = [{ relation: 'wishlist_seed', subject: wish, strength: 1, group: 'seed', facts: { basis, ...sameShapeFacts(cand, wish), tags: shared } }];
  const price = entry.summary.fromMinor;
  if (price != null && plan.wishPriceMinor != null && price < plan.wishPriceMinor) {
    out.push({ relation: 'cheaper_alternative', subject: wish, strength: 0.9, group: 'seed', facts: { differenceMinor: plan.wishPriceMinor - price, currency: entry.summary.currency } });
  }
  return out;
}

/** Relations worth showing, most important first, limited to MAX_RELATED named items. */
function displayRelations(ctx, plan, entry) {
  const cand = entry.cand;
  const byStrength = (list) => [...list].sort((a, b) => b.strength - a.strength || a.subject.key.localeCompare(b.subject.key));
  const duplicates = byStrength(cand.lookalikes);
  const fits = cand.ownedRelations.filter((r) => r.relation === 'strap_fit').concat(cand.seedRelations.filter((r) => r.relation === 'strap_fit'));
  let ordered;
  if (ctx.mode === 'matching') {
    ordered = [...duplicates, ...byStrength(cand.anchorRelations.filter((r) => r.group === 'complement'))];
  } else if (ctx.mode === 'alternatives') {
    const pairs = ctx.intent === 'complement' ? cand.anchorRelations : cand.ownedRelations;
    ordered = [...wishRelations(ctx, plan, entry), ...duplicates, ...fits, ...byStrength(pairs.filter((r) => r.group === 'complement' && r.relation !== 'strap_fit')).slice(0, 1)];
  } else if (ctx.seeds.length) {
    const seedSimilar = byStrength(cand.seedRelations.filter((r) => r.group === 'similar' || r.group === 'duplicate'));
    ordered = [...duplicates, ...seedSimilar, ...fits, ...byStrength(cand.ownedRelations.filter((r) => r.group === 'complement' && r.relation !== 'strap_fit')).slice(0, 1)];
  } else {
    ordered = [...duplicates, ...fits, ...byStrength(cand.ownedRelations.filter((r) => r.group === 'complement' && r.relation !== 'strap_fit')).slice(0, 2)];
  }
  // Only the person's own items can be named; catalog seeds (a product page) stay unnamed.
  const named = ordered.filter((r) => r.subject.itemId);
  const items = [];
  for (const r of named) {
    if (!items.includes(r.subject.key)) items.push(r.subject.key);
  }
  const keep = new Set(items.slice(0, MAX_RELATED));
  const relations = named.filter((r) => keep.has(r.subject.key));
  // A catalog seed still explains a similar result, without naming anything.
  const unnamedSeed = !relations.length ? ordered.find((r) => !r.subject.itemId && r.group !== 'clash') : null;
  return { relations, unnamedSeed };
}

function relatedEntry(ctx, relations) {
  const first = relations[0];
  const subject = first.subject;
  const view = ctx.viewOf(subject);
  const image = view?.image ?? null;
  const detail = itemDetail(relations.map((r) => toExplainRel(ctx, r)));
  return {
    itemId: subject.itemId,
    itemType: subject.itemType,
    title: view?.title ?? subject.title,
    brandName: view?.brandName ?? subject.brandName,
    imageUrl: image?.kind === 'catalog' ? image.url ?? null : null,
    photoId: image && (image.kind === 'original' || image.kind === 'cleaned') ? image.photoId ?? null : null,
    relation: detail.relation,
    detail: detail.detail,
  };
}

function preferenceFacts(ctx, plan, subject) {
  const main = subject.colors.filter((c) => (c.weight ?? 0) >= 0.2).map((c) => c.name);
  const unique = (list) => [...new Set(list)];
  return {
    requestColors: unique(main.filter((n) => plan.request.colors.includes(n))),
    requestStyles: subject.styleTags.filter((t) => plan.request.styles.includes(t)),
    profileStyles: subject.styleTags.filter((t) => (ctx.profile.styles ?? []).includes(t)),
    likedColors: unique(main.filter((n) => (ctx.profile.colorsLiked ?? []).includes(n))),
    hasPreferences: Boolean(ctx.profile.styles?.length || ctx.profile.colorsLiked?.length || plan.request.colors.length || plan.request.styles.length),
  };
}

function buildItem(ctx, plan, entry) {
  const { cand, summary } = entry;
  const { relations, unnamedSeed } = displayRelations(ctx, plan, entry);
  const grouped = new Map();
  for (const r of relations) {
    if (!grouped.has(r.subject.key)) grouped.set(r.subject.key, []);
    grouped.get(r.subject.key).push(r);
  }
  const related = [...grouped.values()].map((list) => relatedEntry(ctx, list));
  const budget = ctx.profile.budgets?.[cand.subject.category];
  const price = {
    status: summary.status,
    fromMinor: summary.fromMinor,
    currency: summary.currency,
    offerCount: summary.offerCount,
    checkedAt: summary.checkedAt,
    retailerName: summary.retailerName,
  };
  const explanationRelations = relations.length ? relations.map((r) => toExplainRel(ctx, r)) : unnamedSeed ? [toExplainRel(ctx, unnamedSeed)] : [];
  const explanation = explain({
    relations: explanationRelations,
    price,
    now: ctx.now,
    ceiling: plan.maxPriceMinor != null && plan.ceilingSource !== 'wish_price' ? { minor: plan.maxPriceMinor, source: plan.ceilingSource, aroundMinor: plan.aroundMinor } : null,
    budget: budget && summary.fromMinor != null && summary.fromMinor <= budget ? { minor: budget, categoryWord: CATEGORY_WORD[cand.subject.category] } : null,
    preferences: preferenceFacts(ctx, plan, cand.subject),
  });
  return {
    key: `${ctx.mode}:${cand.variant.id}`,
    productId: cand.product.id,
    variantId: cand.variant.id,
    kind: cand.owned || entry.duplicate ? 'potential_duplicate' : KIND_FOR_MODE[ctx.mode],
    product: ctx.views.product(cand.product),
    variant: ctx.views.variant(cand.variant),
    related,
    explanation,
    price,
    availability: summary.availability,
    size: entry.size,
    flags: { owned: cand.owned, onWishlist: cand.onWishlist },
    score: round(entry.score),
  };
}

// ---------- Applied constraints, empty reasons, relaxations ----------

function names(ctx, subjects) {
  return listJoin(subjects.map((s) => (s.itemType === 'variant' ? `the ${baseName(s)}` : s.itemType === 'wishlist' ? `the ${ctx.nameOf(s)} on your wishlist` : `your ${ctx.nameOf(s)}`)));
}

function priceRangeLabel(plan) {
  const max = plan.maxPriceMinor;
  const min = plan.minPriceMinor;
  if (min != null && max != null) return `${money(min)} to ${money(max)}`;
  if (min != null) return `From ${money(min)}`;
  if (plan.ceilingSource === 'target') return `Up to your ${money(max)} target`;
  if (plan.ceilingSource === 'wish_price') return `Under ${money(max + 1)}, the price of your wishlist item`;
  if (plan.ceilingSource === 'around') return `Up to ${money(max)}, around ${money(plan.aroundMinor)}`;
  return `Up to ${money(max)}`;
}

function appliedLabels(ctx, run) {
  const { plan, notes, excluded } = run;
  const hard = [];
  const soft = [];
  if (plan.categories) hard.push({ kind: 'category', label: listJoin(plan.categories.map((c) => CATEGORY_LABEL[c] ?? c), 'or') });
  if (plan.types) hard.push({ kind: 'type', label: listJoin(plan.types.map((t) => TYPE_LABEL[t] ?? t), 'or') });
  if (ctx.mode === 'similar' && ctx.seeds.length) hard.push({ kind: 'scope', label: `Same kind of item as ${names(ctx, ctx.seeds)}` });
  if (ctx.mode === 'matching' && ctx.anchors.length) {
    hard.push({ kind: 'scope', label: ctx.seeds.length ? `Pieces to wear with ${names(ctx, ctx.seeds)}` : 'Pieces that pair with your collection' });
  }
  if (ctx.mode === 'alternatives' && ctx.wishSeed) {
    const wishName = names(ctx, [ctx.wishSeed]);
    const label = ctx.intent === 'exact' ? `Other colorways of ${wishName}` : ctx.intent === 'complement' ? `Options like ${wishName} that go with ${names(ctx, ctx.anchors.slice(0, 3))}` : `Options like ${wishName}`;
    hard.push({ kind: 'scope', label });
  }
  if (plan.priceRange) hard.push({ kind: 'budget', label: `${priceRangeLabel(plan)}${plan.includeUnknownPrice ? ', or price unknown' : ' at known prices'}` });
  else if (plan.priceChecked && plan.includeUnknownPrice) hard.push({ kind: 'unknown_price', label: 'Including items without a known price' });
  // The size is a filter on catalog sizing and offer stock; each item's availability says
  // whether stock in that size is actually known.
  for (const pick of notes.sizesApplied.values()) {
    const text = sizeText(pick.size) ?? pick.size.value;
    hard.push({ kind: 'size', label: `Size ${text}${SIZE_SOURCE_LABEL[pick.source] ?? ''}` });
  }
  if (plan.strapWidthMm != null) hard.push({ kind: 'size', label: `${plan.strapWidthMm} mm wide` });
  hard.push({ kind: 'condition', label: plan.condition === 'new_only' ? 'New only' : 'New or used' });
  if (plan.inStockOnly) hard.push({ kind: 'in_stock', label: 'In stock only' });
  if (excluded.owned) hard.push({ kind: 'owned', label: 'Hiding versions you own' });
  if (excluded.dismissed) hard.push({ kind: 'dismissed', label: 'Hiding products you marked not your style or too similar' });
  if (notes.strapsConsidered && ctx.mode === 'matching') hard.push({ kind: 'strap_fit', label: 'Straps only when catalog lug width and attachment confirm the fit' });
  if (ctx.mode === 'matching') hard.push({ kind: 'near_duplicates', label: 'Leaving out lookalikes of things you own' });

  if (ctx.mode === 'matching' || ctx.intent === 'complement') soft.push({ kind: 'pairing', label: 'Color and style pairings with your items' });
  else if (ctx.seeds.length) soft.push({ kind: 'similarity', label: 'Close in shape, style, color and price' });
  const p = ctx.profile;
  if (p.styles?.length) soft.push({ kind: 'style', label: `Your styles: ${tagPhrase(p.styles)}` });
  if (p.colorsLiked?.length) soft.push({ kind: 'colors', label: `Colors you like: ${listJoin(p.colorsLiked.map((c) => colorLabel(c).toLowerCase()))}` });
  if (p.colorsAvoided?.length) soft.push({ kind: 'avoid_colors', label: `Colors you avoid: ${listJoin(p.colorsAvoided.map((c) => colorLabel(c).toLowerCase()))}` });
  const r = plan.request;
  if (r.colors.length) soft.push({ kind: 'request_colors', label: `Colors you asked for: ${listJoin(r.colors.map((c) => colorLabel(c).toLowerCase()))}` });
  if (r.avoidColors.length) soft.push({ kind: 'request_avoid_colors', label: `Avoiding ${listJoin(r.avoidColors.map((c) => colorLabel(c).toLowerCase()), 'or')}` });
  if (r.styles.length) soft.push({ kind: 'request_styles', label: `Styles you asked for: ${tagPhrase(r.styles)}` });
  if (r.avoidStyles.length) soft.push({ kind: 'request_avoid_styles', label: `Avoiding ${tagPhrase(r.avoidStyles)} styles` });
  if (r.materials.length) soft.push({ kind: 'materials', label: `Materials: ${listJoin(r.materials)}` });
  if (r.brandIds.length) soft.push({ kind: 'brands', label: `Brands: ${listJoin(r.brandIds.map((id) => ctx.catalog.brand(id)?.name ?? id))}` });
  if (plan.aroundMinor != null) soft.push({ kind: 'price_around', label: `Around ${money(plan.aroundMinor)}` });
  if (plan.caseDiameterMm != null) soft.push({ kind: 'case_size', label: `Around ${plan.caseDiameterMm} mm cases` });
  const uses = [...new Set([...(p.uses ?? []), ...r.uses])];
  if (uses.length) soft.push({ kind: 'use', label: `Uses: ${listJoin(uses.map((u) => (USE_LABEL[u] ?? u).toLowerCase()))}` });
  const budgets = Object.entries(p.budgets ?? {}).filter(([cat, v]) => v && (!plan.categories || plan.categories.includes(cat)));
  if (budgets.length) soft.push({ kind: 'budget_fit', label: `Your budgets: ${listJoin(budgets.map(([cat, v]) => `${money(v)} for ${CATEGORY_PLURAL[cat] ?? cat}`))}` });
  if (ctx.feedback.count) soft.push({ kind: 'feedback', label: `Your feedback on ${ctx.feedback.count} ${ctx.feedback.count === 1 ? 'product' : 'products'}` });
  return { hard, soft };
}

const are = (n) => (n === 1 ? 'is' : 'are');

function strapEmptyReason(ctx, notes) {
  const first = notes.strapReasons[0];
  if (!first) return null;
  const watch = `your ${ctx.nameOf(first.watch)}`;
  switch (first.reason) {
    case 'integrated':
      return `${watch.charAt(0).toUpperCase()}${watch.slice(1)} has an integrated bracelet, so strap suggestions don't apply.`;
    case 'lug_width_unknown':
      return `The catalog doesn't list the lug width of ${watch}, so we can't say which straps fit.`;
    case 'attachment_unknown':
      return `The catalog doesn't say how straps attach to ${watch}, so we can't say which straps fit.`;
    case 'variant_unconfirmed':
    case 'not_in_catalog':
      return `Confirm the catalog version of ${watch} to see straps that fit; widths you enter yourself aren't checked.`;
    case 'width_mismatch':
      return `No straps in the catalog match the ${first.lugWidthMm} mm lugs of ${watch} yet.`;
    default:
      return null;
  }
}

function scopeEmptyReason(ctx, plan) {
  const what = plan.types ? listJoin(plan.types.map((t) => typeWord(t)), 'or') : plan.categories ? listJoin(plan.categories.map((c) => CATEGORY_PLURAL[c]), 'or') : null;
  if (ctx.mode === 'matching') {
    return ctx.seeds.length
      ? `Nothing${what ? ` in ${what}` : ''} in the catalog pairs clearly with ${names(ctx, ctx.seeds)} yet.`
      : `Nothing${what ? ` in ${what}` : ''} in the catalog pairs clearly with your collection yet.`;
  }
  if (ctx.mode === 'alternatives') {
    return ctx.intent === 'exact'
      ? `The catalog has no other colorways of ${names(ctx, [ctx.wishSeed])}.`
      : `The catalog has nothing else like ${names(ctx, [ctx.wishSeed])} yet.`;
  }
  return what ? `The catalog has no ${what} to suggest yet.` : 'The catalog has nothing to suggest for this yet.';
}

function emptyReasonText(ctx, run) {
  if (ctx.blocked) return ctx.blocked;
  const { plan, excluded: e, notes } = run;
  if (!notes.inScope) return scopeEmptyReason(ctx, plan);
  const everyStrapIncompatible = e.incompatible && e.incompatible === notes.inScope - e.owned - e.dismissed;
  if (everyStrapIncompatible) {
    const strap = strapEmptyReason(ctx, notes);
    if (strap) return strap;
  }
  const parts = [];
  if (e.dismissed) parts.push(e.dismissed === 1 ? '1 is a product you marked not for you' : `${e.dismissed} are products you marked not for you`);
  if (e.incompatible) parts.push(e.incompatible === 1 ? "1 strap doesn't fit your watch by catalog specs" : `${e.incompatible} straps don't fit your watch by catalog specs`);
  if (e.sizeUnavailable) {
    const applied = [...notes.sizesApplied.values()];
    if (notes.sizeIncomparable && notes.sizeIncomparable === e.sizeUnavailable && applied.length) {
      parts.push(`${e.sizeUnavailable} ${e.sizeUnavailable === 1 ? "isn't" : "aren't"} listed in ${applied[0].size.system.replace('-', ' ')} sizes`);
    } else {
      const where = applied.length === 1 ? sizeLabel(applied[0].size) : plan.strapWidthMm != null ? `${plan.strapWidthMm} mm` : 'your size';
      parts.push(`${e.sizeUnavailable} ${e.sizeUnavailable === 1 ? "isn't" : "aren't"} in stock in ${where}`);
    }
  }
  if (e.priceUnknown) parts.push(`${e.priceUnknown} ${e.priceUnknown === 1 ? 'has' : 'have'} no known ${plan.condition === 'new_only' ? 'new ' : ''}price at the retailers we check`);
  if (e.overBudget) {
    const range = plan.minPriceMinor != null ? `outside ${money(plan.minPriceMinor)}${plan.maxPriceMinor != null ? ` to ${money(plan.maxPriceMinor)}` : ''}` : `over ${money(plan.maxPriceMinor)}`;
    parts.push(`${e.overBudget} ${are(e.overBudget)} ${range} at the prices we checked`);
  }
  if (e.nearDuplicates) parts.push(`${e.nearDuplicates} ${are(e.nearDuplicates)} very close to things you own`);
  // Leaving out owned versions is expected, so it is only the reason when it is the only one.
  if (!parts.length && e.owned) return e.owned === 1 ? 'The only match is a version you already own.' : `The only matches are ${e.owned} versions you already own.`;
  if (!parts.length) return scopeEmptyReason(ctx, plan);
  return `Nothing matches every filter: ${listJoin(parts)}.`;
}

function relaxationOptions(ctx, run, count) {
  const { plan, excluded, notes } = run;
  const options = [];
  if (excluded.overBudget && plan.maxPriceMinor != null && notes.overBudgetPrices.length) {
    const prices = [...notes.overBudgetPrices].sort((a, b) => a - b);
    const needed = Math.max(1, Math.min(ctx.limit, THIN_RESULTS) - count);
    const ceiling = niceCeiling(prices[Math.min(needed, prices.length) - 1]);
    options.push({ kind: 'raise_budget', label: `Allow up to ${money(ceiling)}`, constraints: { maxPriceMinor: ceiling } });
  }
  if (excluded.sizeUnavailable && !plan.anySize) {
    options.push({ kind: 'any_size', label: plan.strapWidthMm != null ? 'Show any width' : 'Show any size', constraints: { anySize: true, size: null, strapWidthMm: null } });
  }
  if (plan.condition === 'new_only') options.push({ kind: 'include_used', label: 'Include used offers', constraints: { condition: 'new_or_used' } });
  if (plan.typesExplicit) {
    options.push({ kind: 'any_category', label: 'Show other types', constraints: { types: null } });
  } else if (plan.categoriesExplicit) {
    options.push({ kind: 'any_category', label: 'Show every category', constraints: { category: null, categories: null } });
  }
  if (excluded.priceUnknown && plan.priceChecked && !plan.includeUnknownPrice) {
    options.push({ kind: 'include_unknown_price', label: 'Include items without a known price', constraints: { includeUnknownPrice: true } });
  }
  return options;
}

/** Each relaxation is re-run through the same filters, so wouldReturn is exact. */
function computeRelaxations(ctx, run, count) {
  const out = [];
  for (const option of relaxationOptions(ctx, run, count)) {
    const patched = applyPatch(ctx.constraints, option.constraints);
    const wouldReturn = runPipeline(ctx, patched).selected.length;
    if (wouldReturn > count) out.push({ ...option, wouldReturn });
  }
  return out;
}

// ---------- Public API ----------

/**
 * Recommendations for one mode.
 * @param {{
 *   catalog: any, now: number, mode: 'similar'|'matching'|'alternatives',
 *   seeds?: Array<{ type: 'owned'|'wishlist'|'variant', record: any }>,
 *   owned?: any[], wishlist?: any[], profile?: any, feedback?: any[], weights?: object,
 *   constraints?: { category?, categories?, types?, maxPriceMinor?, minPriceMinor?, priceAroundMinor?,
 *     size?, anySize?, strapWidthMm?, caseDiameterMm?, condition?: 'new_only'|'new_or_used',
 *     inStockOnly?, includeOwned?, includeUnknownPrice?, colors?, avoidColors?, styles?, uses?,
 *     materials?, brandIds?, exploreColorways? },
 *   limit?: number, offersFor?: (variantId: string) => any[], freshnessHours?: number,
 *   views?: { product(p), variant(v), owned(item), wishlist(item) },
 *   requestId?: string, exploreColorways?: boolean,
 *   scope?: { categories?: string[], types?: string[] },   // fixed scope (feed sections); never relaxed
 *   excludeVariantIds?: string[]                           // already shown elsewhere; not counted
 * }} input
 * @returns {any} RecResult (ARCHITECTURE.md 6.1)
 */
export function recommend(input) {
  const ctx = createContext(input);
  const run = runPipeline(ctx, ctx.constraints);
  const items = run.selected.map((entry) => buildItem(ctx, run.plan, entry));
  const thin = items.length < Math.min(ctx.limit, THIN_RESULTS);
  return {
    requestId: input.requestId ?? null,
    mode: ctx.mode,
    generatedAt: new Date(ctx.now).toISOString(),
    applied: appliedLabels(ctx, run),
    items,
    excluded: run.excluded,
    relaxations: thin && !ctx.blocked ? computeRelaxations(ctx, run, items.length) : [],
    emptyReason: items.length ? null : emptyReasonText(ctx, run),
  };
}

function wishIntentAllowsAlternatives(record) {
  return record.intent === 'inspiration' || record.intent === 'complement';
}

/**
 * The Discover feed: sections built from the collection, the wishlist and, with no owned items
 * yet (cold start), the profile survey alone. A variant appears in one section only.
 * @param {Parameters<typeof recommend>[0]} input  mode and seeds are ignored
 * @returns {{ requestId: string|null, generatedAt: string, coldStart: boolean,
 *   sections: Array<{ id, title, description, mode, seedIds, items, emptyReason, relaxations }> }}
 */
export function feed(input) {
  const catalog = input.catalog;
  const profile = { ...EMPTY_PROFILE, ...(input.profile ?? {}) };
  const owned = (input.owned ?? []).filter((i) => !i.archivedAt).sort(byCreated);
  const wishlist = (input.wishlist ?? []).filter((w) => (w.status ?? 'active') === 'active').sort(byCreated);
  const coldStart = owned.length === 0;
  const claimed = new Set(input.excludeVariantIds ?? []);
  const profileCategories = (profile.categories ?? []).filter((c) => CATEGORIES.includes(c));
  const scopeCategories = profileCategories.length && profileCategories.length < CATEGORIES.length ? profileCategories : null;
  const base = { ...input, constraints: { ...(input.constraints ?? {}) } };
  const run = (opts) => {
    const result = recommend({ ...base, ...opts, excludeVariantIds: [...claimed] });
    for (const item of result.items) claimed.add(item.variantId);
    return result;
  };
  const section = (id, title, description, mode, seedIds, result) => ({
    id,
    title,
    description,
    mode,
    seedIds,
    items: result.items,
    emptyReason: result.items.length ? null : result.emptyReason,
    relaxations: result.relaxations,
  });
  const ownedSubjects = owned.map((r) => itemSubject(catalog, r, 'owned'));
  const named = (s) => baseName(s);

  // Wishlist alternatives claim their items first: they answer a specific wish.
  const alternatives = [];
  for (const record of [...wishlist].reverse().filter(wishIntentAllowsAlternatives).slice(0, 3)) {
    const subject = itemSubject(catalog, record, 'wishlist');
    const result = run({ mode: 'alternatives', seeds: [{ type: 'wishlist', record }], limit: 6, scope: {} });
    const size = record.desired?.size?.value ? sizeText(record.desired.size) : null;
    const target = record.targetPriceMinor != null ? money(record.targetPriceMinor) : null;
    const description = record.intent === 'complement'
      ? 'Other options that go with the items you linked to it.'
      : `Similar options${size ? ` in ${size}` : ''}${target ? `, within your ${target} target at the prices we checked` : ''}.`;
    alternatives.push(section(`alternatives-${record.id}`, `Alternatives to the ${named(subject)}`, description, 'alternatives', [record.id], result));
  }

  const sections = [];
  if (coldStart) {
    const picks = [];
    const cats = profileCategories.length ? profileCategories : CATEGORIES;
    const tailored = profile.styles?.length || profile.colorsLiked?.length || Object.keys(profile.budgets ?? {}).length;
    for (const category of cats) {
      const result = run({ mode: 'similar', seeds: [], limit: 6, scope: { categories: [category] } });
      if (!result.items.length) continue;
      const budget = profile.budgets?.[category];
      const description = tailored
        ? `Based on the styles and colors you chose${budget ? `, ranked toward your ${money(budget)} budget` : ''}.`
        : 'From the catalog. Add your styles and colors to your profile to tailor these.';
      picks.push(section(`picks-${category}`, `${CATEGORY_LABEL[category]} for you`, description, 'similar', [], result));
    }
    sections.push(...picks, ...alternatives);
    return { requestId: input.requestId ?? null, generatedAt: new Date(input.now).toISOString(), coldStart, sections };
  }

  // Straps for watches whose catalog specs allow a fit claim.
  const straps = [];
  const catalogHasStraps = catalog.listProducts({ category: 'watch' }).some((p) => p.type === 'strap');
  if (catalogHasStraps && (!scopeCategories || scopeCategories.includes('watch'))) {
    const watches = ownedSubjects.filter((s) => s.slot === 'wrist' && s.verifiedVariant && FIT_ATTACHMENTS.includes(s.product?.attributes?.attachment) && Number.isFinite(s.variant?.attributes?.lugWidthMm));
    for (const watch of watches.slice(0, 2)) {
      const result = run({ mode: 'matching', seeds: [{ type: 'owned', record: watch.record }], limit: 6, scope: { types: ['strap'] } });
      const width = watch.variant.attributes.lugWidthMm;
      straps.push(section(`straps-${watch.itemId}`, `Straps that fit your ${named(watch)}`, `Matched to its ${width} mm lug width and spring-bar attachment, from catalog specs.`, 'matching', [watch.itemId], result));
    }
  }

  const matching = run({ mode: 'matching', seeds: [], limit: 8, scope: { categories: scopeCategories } });
  sections.push(section('goes-with-collection', 'Goes with your collection', 'Catalog pieces whose colors and style pair with what you own.', 'matching', [], matching));
  sections.push(...alternatives, ...straps);

  // "More like" only earns a section when it offers something besides lookalikes.
  const latest = [...ownedSubjects].reverse().find((s) => s.productId && (!scopeCategories || scopeCategories.includes(s.category)));
  if (latest) {
    const result = run({ mode: 'similar', seeds: [{ type: 'owned', record: latest.record }], limit: 6, scope: {} });
    if (result.items.some((i) => i.kind !== 'potential_duplicate')) {
      sections.push(section(`similar-${latest.itemId}`, `More like your ${named(latest)}`, 'Same kind of item, with a related shape, style, color or price.', 'similar', [latest.itemId], result));
    }
  }
  return { requestId: input.requestId ?? null, generatedAt: new Date(input.now).toISOString(), coldStart, sections };
}

// ---------- Help me choose ----------

function comparisonSize(subject, record, profile) {
  const product = subject.product;
  if (!product?.sizing || product.sizing.system === 'ONE-SIZE') return { size: null, source: null };
  const desired = record.desired?.size;
  if (desired?.value && desired.system === product.sizing.system) return { size: desired, source: 'wishlist' };
  const slot = sizeSlot(product);
  const fromProfile = slot ? profile.sizes?.[slot] : null;
  if (fromProfile?.value && fromProfile.system === product.sizing.system) return { size: fromProfile, source: 'profile' };
  return { size: null, source: null };
}

/**
 * Side-by-side facts for up to three wishlist items: price at known offers, target fit,
 * availability in the wanted size, pairings with owned items and lookalikes already owned.
 * The summary only restates those facts; it never ranks with invented scores.
 * @param {{ catalog, now, wishItems: any[], owned?: any[], wishlist?: any[], profile?: any,
 *   offersFor?: (variantId: string) => any[], views?: any, freshnessHours?: number }} input
 * @returns {any} Comparison (ARCHITECTURE.md 6.1)
 */
export function helpMeChoose(input) {
  const ctx = createContext({ ...input, mode: 'similar', seeds: [], wishlist: [...(input.wishlist ?? []), ...(input.wishItems ?? [])] });
  const records = input.wishItems ?? [];
  const subjects = records.map((record) => itemSubject(ctx.catalog, record, 'wishlist'));
  const sharedProduct = new Map();
  for (const s of subjects) if (s.productId) sharedProduct.set(s.productId, (sharedProduct.get(s.productId) ?? 0) + 1);
  const wishName = (s) => (s.productId && sharedProduct.get(s.productId) > 1 ? fullName(s) : baseName(s));

  const entries = records.map((record, i) => {
    const subject = subjects[i];
    const { size, source: sizeSource } = comparisonSize(subject, record, ctx.profile);
    const condition = record.desired?.condition ?? 'new_only';
    const summary = subject.variantId
      ? ctx.summary(subject.variantId, size, condition)
      : { status: 'unknown', fromMinor: null, currency: record.currency ?? 'USD', offerCount: 0, checkedAt: null, retailerName: null, availability: 'no_offers' };
    const price = { status: summary.status, fromMinor: summary.fromMinor, currency: summary.currency, offerCount: summary.offerCount, checkedAt: summary.checkedAt, retailerName: summary.retailerName };
    const targetSource = record.targetPriceMinor != null ? 'target' : ctx.profile.budgets?.[record.category] ? 'profile' : null;
    const targetMinor = targetSource === 'target' ? record.targetPriceMinor : targetSource === 'profile' ? ctx.profile.budgets[record.category] : null;
    const status = targetMinor == null || price.fromMinor == null ? 'unknown' : price.fromMinor <= targetMinor ? 'within' : 'over';
    const budget = { targetMinor, status, differenceMinor: status === 'unknown' ? null : Math.abs(price.fromMinor - targetMinor) };

    const relations = ctx.ownedSubjects.flatMap((o) => relate(subject, o));
    const group = (list) => {
      const byItem = new Map();
      for (const r of [...list].sort((a, b) => b.strength - a.strength || a.subject.key.localeCompare(b.subject.key))) {
        if (!byItem.has(r.subject.key)) byItem.set(r.subject.key, []);
        byItem.get(r.subject.key).push(r);
      }
      return [...byItem.values()].slice(0, MAX_RELATED).map((rels) => relatedEntry(ctx, rels));
    };
    const pairsWith = group(relations.filter((r) => r.group === 'complement'));
    const similarOwned = group(relations.filter((r) => r.relation === 'near_duplicate' || r.relation === 'same_shape'));

    const notes = [];
    if (!subject.productId) notes.push('Custom item: there are no catalog prices to compare.');
    else if (!subject.variantId) notes.push('Pick a version to compare prices.');
    if (price.status === 'stale' && price.checkedAt) notes.push(`Price last checked ${relative(price.checkedAt, ctx.now)}; it may have changed.`);
    if (subject.variantId && summary.availability === 'size_unavailable') notes.push(`Not in stock in ${sizeLabel(size)} at the retailers we check.`);
    if (subject.variantId && summary.availability === 'out_of_stock') notes.push('Out of stock at every retailer we check.');
    if (subject.variantId && summary.availability === 'no_offers') notes.push(condition === 'new_only' ? 'No new offers at the retailers we check.' : 'No offers at the retailers we check.');
    if (size && sizeSource === 'profile') notes.push(`Checked in ${sizeLabel(size)}, the size in your profile.`);
    if (targetSource === 'profile') notes.push(`Compared with your ${money(targetMinor)} ${CATEGORY_WORD[record.category]} budget, since no target is set.`);
    return {
      wishId: record.id,
      view: ctx.views.wishlist(record) ?? null,
      price,
      availability: summary.availability,
      size,
      budget,
      pairsWith,
      similarOwned,
      notes,
      _name: `the ${wishName(subject)}`,
      _duplicates: relations.filter((r) => r.relation === 'near_duplicate'),
      _sizeSource: sizeSource,
      _targetSource: targetSource,
      _category: record.category,
    };
  });

  const summary = [];
  const Cap = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  // "its $150 target" or "your $150 sneaker budget": always say which figure was used.
  const targetPhrase = (e) => (e._targetSource === 'target' ? `its ${money(e.budget.targetMinor)} target` : `your ${money(e.budget.targetMinor)} ${CATEGORY_WORD[e._category]} budget`);
  const within = entries.filter((e) => e.budget.status === 'within');
  const over = entries.filter((e) => e.budget.status === 'over');
  const unknownPrice = entries.filter((e) => e.price.fromMinor == null);
  if (within.length) summary.push(`At the prices we checked, ${listJoin(within.map((e) => `${e._name} fits ${targetPhrase(e)}`))}.`);
  for (const e of over) summary.push(`${Cap(e._name)} is ${money(e.budget.differenceMinor)} over ${targetPhrase(e)} at the prices we checked.`);
  if (unknownPrice.length) summary.push(`We have no current price for ${listJoin(unknownPrice.map((e) => e._name))} at the retailers we check.`);
  const known = entries.filter((e) => e.price.fromMinor != null);
  if (known.length >= 2) {
    const lowest = [...known].sort((a, b) => a.price.fromMinor - b.price.fromMinor || a.wishId.localeCompare(b.wishId))[0];
    const tie = known.filter((e) => e.price.fromMinor === lowest.price.fromMinor).length > 1;
    if (!tie) {
      summary.push(`${Cap(lowest._name)} has the lowest known price: ${money(lowest.price.fromMinor, lowest.price.currency)}${lowest.price.retailerName ? ` at ${lowest.price.retailerName}` : ''}.`);
    }
  }
  const pairNames = (e) => e.pairsWith.map((r) => [r.brandName, r.title].filter(Boolean).join(' '));
  const pairing = entries.filter((e) => e.pairsWith.length);
  const sameSet = pairing.length > 1 && pairing.length === entries.length && pairing.every((e) => pairNames(e).join('|') === pairNames(pairing[0]).join('|'));
  if (sameSet) summary.push(`${entries.length === 2 ? 'Both' : 'All three'} pair with your ${listJoin(pairNames(pairing[0]))}.`);
  else for (const e of pairing) summary.push(`${Cap(e._name)} pairs with your ${listJoin(pairNames(e))}.`);
  if (ctx.ownedSubjects.length && entries.length && !pairing.length) {
    summary.push('None of these has a clear color or style pairing with what you own.');
  }
  for (const e of entries) {
    const dup = e._duplicates[0];
    if (!dup) continue;
    const ownedName = ctx.nameOf(dup.subject, dup.facts.sameProduct && !dup.facts.identical);
    summary.push(dup.facts.identical
      ? `You already own ${e._name}: it is the same version as your ${ownedName}.`
      : `${Cap(e._name)} is very close to your ${ownedName}, which you already own.`);
  }
  for (const e of entries) {
    if (e.availability === 'size_unavailable' && e.size) summary.push(`${Cap(e._name)} isn't in stock in ${sizeLabel(e.size)} at the retailers we check.`);
  }
  if (entries.length === 1) summary.push('Add another wishlist item to compare them side by side.');

  return {
    items: entries.map(({ _name, _duplicates, _sizeSource, _targetSource, _category, ...rest }) => rest),
    summary,
  };
}
