// Recommendations, harmony, explanations, request parsing, feedback and help-me-choose.
// Two kinds of fixtures: a small fully controlled catalog for exact engine assertions, and
// fixture products added to the seeded demo catalog so the brief's scenario runs end to end
// through the API whatever the demo catalog grows into. All names are fictional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../../js/data/catalog-index.js';
import * as demoRetailers from '../../js/data/retailers.js';
import { loadCatalog, staticCatalog } from '../../js/server/catalog-repo.js';
import { listOffers } from '../../js/server/providers/offers.js';
import { productSummary, variantView, ownedView, wishlistView } from '../../js/server/views.js';
import { recommend, feed, helpMeChoose, DEFAULT_WEIGHTS, WEIGHT_RANGES, normalizeWeights, validateWeights, strapFit, slotOf } from '../../js/engine/recommend.js';
import { harmony, harmonyScore, paletteHarmony, PAIRING_THRESHOLD } from '../../js/engine/harmony.js';
import { relationDetail, explain } from '../../js/engine/explain.js';
import { parseRequest, constraintsFromChips, resolveSeedHints } from '../../js/engine/parse-request.js';
import { createTestEnv, rejectsWith, ALEX, SAM, NOW } from '../helpers.mjs';

// ---------- Fixture builders ----------

const US_M = ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '13'];
const OFFER_SIZES = ['8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12'];
const ALPHA = ['S', 'M', 'L', 'XL'];
const WAIST = ['30x32', '32x32', '34x32'];
const FEED_SOURCE = [{ provider: 'fixture-feed', sourceId: 'fx', retrievedAt: '2026-10-01T09:00:00Z' }];

const BRANDS = [
  { id: 'fx-foot', name: 'Fixture Footwear', categories: ['sneaker'] },
  { id: 'fx-wear', name: 'Fixture Apparel', categories: ['clothing'] },
  { id: 'fx-time', name: 'Fixture Time', categories: ['watch'] },
];

function product(id, { category, type, brandId, name, tags, materials = [], attributes = {}, sizing }) {
  const kind = category;
  const shape = category === 'watch' ? (type === 'strap' ? 'strap' : 'round') : type;
  const defaultSizing = category === 'sneaker'
    ? { system: 'US-M', sizes: US_M }
    : category === 'clothing'
      ? ['chinos', 'trousers', 'jeans', 'shorts'].includes(type) ? { system: 'WAIST-INSEAM', sizes: WAIST } : { system: 'ALPHA', sizes: ALPHA }
      : type === 'strap' ? { system: 'ONE-SIZE', sizes: ['OS'] } : null;
  return {
    id,
    category,
    type,
    brandId,
    name,
    styleTags: tags,
    materials,
    features: [],
    description: `${name} (fixture).`,
    sizing: sizing === undefined ? defaultSizing : sizing,
    attributes,
    sources: FEED_SOURCE,
    illustration: { kind, shape },
  };
}

function variant(id, productId, name, colors, attributes = {}) {
  return {
    id,
    productId,
    name,
    identifiers: { styleCode: id.toUpperCase().slice(0, 18) },
    colors: colors.map(([n, weight, role]) => ({ name: n, weight, role: role ?? 'main' })),
    attributes,
    msrpMinor: null,
    currency: 'USD',
    release: null,
    illustration: { palette: {} },
  };
}

const image = (variantId) => ({
  id: `img-${variantId}`,
  variantId,
  provider: 'demo-illustrations',
  sourceUrl: `generated:${variantId}`,
  attribution: 'Illustration generated for the demo catalog',
  license: 'owned',
  permissions: { inventoryDisplay: true, requiresActiveOffer: false, cacheTtlHours: 720, attributionRequired: false },
  status: 'active',
  fetchedAt: '2026-10-01T09:00:00Z',
  expiresAt: null,
});

function sizedOffer(id, variantId, price, { system = 'US-M', values = OFFER_SIZES, out = [], condition = 'new', age = 3, retailerId } = {}) {
  return {
    id,
    retailerId: retailerId ?? (system === 'US-M' ? 'northline' : 'fieldhouse-outfitters'),
    listingId: id,
    variantId,
    condition,
    sellerType: condition === 'new' ? 'retailer' : 'marketplace_seller',
    includedComponents: null,
    sizes: values.map((value) => ({ value, system, priceMinor: price, stock: out.includes(value) ? 'out_of_stock' : 'in_stock' })),
    priceMinor: null,
    stock: null,
    currency: 'USD',
    shipping: { kind: 'free' },
    fees: { kind: 'none' },
    tax: { kind: 'unknown' },
    delivery: null,
    returns: null,
    warranty: { kind: 'unknown' },
    url: `https://northline.example/p/${id}`,
    listingStatus: 'active',
    demoAgeHours: age,
  };
}

function watchOffer(id, variantId, price, { age = 3, condition = 'new' } = {}) {
  return {
    ...sizedOffer(id, variantId, price, { condition, age }),
    retailerId: 'meridian-time',
    sizes: null,
    priceMinor: price,
    stock: 'in_stock',
    url: `https://meridiantime.example/watch/${id}`,
  };
}

// The controlled catalog. Comments say what each entry is for.
function fixtureData(prefix = 'f') {
  const p = (s) => `${prefix}-${s}`;
  const products = [
    product(p('court'), { category: 'sneaker', type: 'court', brandId: 'fx-foot', name: 'Court One', tags: ['minimal', 'classic', 'street'], materials: ['leather', 'rubber'], attributes: { cut: 'low', closure: 'laces' } }),
    product(p('runner'), { category: 'sneaker', type: 'runner', brandId: 'fx-foot', name: 'Day Runner', tags: ['sporty', 'street', 'minimal'], materials: ['mesh', 'suede'], attributes: { cut: 'low', closure: 'laces' } }),
    product(p('trail'), { category: 'sneaker', type: 'trail', brandId: 'fx-foot', name: 'Ridge Trail', tags: ['outdoor', 'sporty', 'minimal'], materials: ['mesh', 'rubber'], attributes: { cut: 'low', closure: 'laces' } }),
    product(p('luxe'), { category: 'sneaker', type: 'runner', brandId: 'fx-foot', name: 'Luxe Runner', tags: ['minimal', 'classic'], materials: ['leather'], attributes: { cut: 'low' } }),
    product(p('used'), { category: 'sneaker', type: 'skate', brandId: 'fx-foot', name: 'Old Skate', tags: ['street', 'vintage'], materials: ['suede'], attributes: { cut: 'low' } }),
    product(p('stale'), { category: 'sneaker', type: 'slip-on', brandId: 'fx-foot', name: 'Easy Slip', tags: ['minimal', 'street'], materials: ['canvas'], attributes: { cut: 'low' } }),
    product(p('quiet'), { category: 'sneaker', type: 'court', brandId: 'fx-foot', name: 'Quiet Court', tags: ['minimal', 'classic'], materials: ['leather'], attributes: { cut: 'low' } }),
    product(p('ghost'), { category: 'sneaker', type: 'trail', brandId: 'fx-foot', name: 'Ghost Trail', tags: ['outdoor', 'minimal'], materials: ['mesh'], attributes: { cut: 'low' } }),
    product(p('field'), { category: 'clothing', type: 'field-jacket', brandId: 'fx-wear', name: 'Field Coat', tags: ['classic', 'outdoor', 'workwear'], materials: ['cotton twill'], attributes: { fit: 'regular' } }),
    product(p('trouser'), { category: 'clothing', type: 'trousers', brandId: 'fx-wear', name: 'Wool Trouser', tags: ['classic', 'dressy', 'minimal'], materials: ['wool'], attributes: { fit: 'slim' } }),
    product(p('chino'), { category: 'clothing', type: 'chinos', brandId: 'fx-wear', name: 'Easy Chino', tags: ['classic', 'preppy', 'minimal'], materials: ['cotton'], attributes: { fit: 'regular' } }),
    product(p('tee'), { category: 'clothing', type: 'tee', brandId: 'fx-wear', name: 'Pocket Tee', tags: ['minimal', 'classic'], materials: ['cotton'], attributes: { fit: 'regular' } }),
    product(p('fwatch'), { category: 'watch', type: 'field', brandId: 'fx-time', name: 'Field Auto', tags: ['classic', 'outdoor', 'minimal'], materials: ['stainless steel'], attributes: { movement: 'automatic', attachment: 'spring_bar' } }),
    product(p('diver'), { category: 'watch', type: 'diver', brandId: 'fx-time', name: 'Deep Diver', tags: ['sporty', 'bold'], materials: ['stainless steel'], attributes: { movement: 'automatic', attachment: 'integrated' } }),
    product(p('dress'), { category: 'watch', type: 'dress', brandId: 'fx-time', name: 'Slim Dress', tags: ['dressy', 'classic'], materials: ['stainless steel'], attributes: { movement: 'quartz', attachment: 'quick_release' } }),
    product(p('nolug'), { category: 'watch', type: 'field', brandId: 'fx-time', name: 'Unlisted Field', tags: ['classic', 'outdoor'], materials: ['stainless steel'], attributes: { movement: 'automatic', attachment: 'spring_bar' } }),
    product(p('leather-strap'), { category: 'watch', type: 'strap', brandId: 'fx-time', name: 'Leather Strap', tags: ['classic', 'minimal'], materials: ['leather'], attributes: { attachment: 'quick_release' } }),
    product(p('canvas-strap'), { category: 'watch', type: 'strap', brandId: 'fx-time', name: 'Canvas Strap', tags: ['outdoor', 'sporty'], materials: ['canvas'], attributes: { attachment: 'quick_release' } }),
    product(p('fitted-strap'), { category: 'watch', type: 'strap', brandId: 'fx-time', name: 'Fitted Strap', tags: ['sporty'], materials: ['rubber'], attributes: { attachment: 'integrated' } }),
  ];
  const v = [
    variant(p('court--white-gum'), p('court'), 'White / Gum', [['white', 0.68, 'upper'], ['gum', 0.26, 'sole'], ['off-white', 0.06, 'laces']]),
    // Differs from White / Gum only in sole color: a lookalike of the owned pair.
    variant(p('court--white-natural'), p('court'), 'White / Natural', [['white', 0.68, 'upper'], ['off-white', 0.26, 'sole'], ['off-white', 0.06, 'laces']]),
    variant(p('court--black-white'), p('court'), 'Black / White', [['black', 0.66, 'upper'], ['white', 0.28, 'sole'], ['black', 0.06, 'laces']]),
    variant(p('runner--olive-bone'), p('runner'), 'Olive / Bone', [['olive', 0.58, 'upper'], ['bone', 0.3, 'sole'], ['tan', 0.12, 'accent']]),
    variant(p('runner--olive-sail'), p('runner'), 'Olive / Sail', [['olive', 0.58, 'upper'], ['off-white', 0.3, 'sole'], ['olive', 0.12, 'accent']]),
    variant(p('runner--navy-white'), p('runner'), 'Navy / White', [['navy', 0.6, 'upper'], ['white', 0.3, 'sole'], ['light-grey', 0.1, 'accent']]),
    variant(p('trail--olive-gum'), p('trail'), 'Olive / Gum', [['olive', 0.6, 'upper'], ['gum', 0.3, 'sole'], ['bone', 0.1, 'accent']]),
    variant(p('trail--rust-khaki'), p('trail'), 'Rust / Khaki', [['rust', 0.6, 'upper'], ['khaki', 0.3, 'sole'], ['off-white', 0.1, 'accent']]),
    variant(p('luxe--tan'), p('luxe'), 'Tan', [['tan', 0.7, 'upper'], ['off-white', 0.3, 'sole']]),
    variant(p('used--brown'), p('used'), 'Brown', [['brown', 0.7, 'upper'], ['gum', 0.3, 'sole']]),
    variant(p('stale--olive'), p('stale'), 'Olive', [['olive', 0.7, 'upper'], ['white', 0.3, 'sole']]),
    variant(p('quiet--tan'), p('quiet'), 'Tan', [['tan', 0.7, 'upper'], ['white', 0.3, 'sole']]),
    // No retailer lists this one: its price and stock are unknown.
    variant(p('ghost--olive'), p('ghost'), 'Olive', [['olive', 0.7, 'upper'], ['khaki', 0.3, 'sole']]),
    variant(p('field--navy'), p('field'), 'Navy', [['navy', 0.88, 'body'], ['brown', 0.07, 'collar'], ['gunmetal', 0.05, 'hardware']]),
    variant(p('field--olive'), p('field'), 'Olive', [['olive', 0.88, 'body'], ['brown', 0.07, 'collar'], ['bronze', 0.05, 'hardware']]),
    variant(p('trouser--grey'), p('trouser'), 'Grey', [['grey', 1, 'body']]),
    variant(p('trouser--charcoal'), p('trouser'), 'Charcoal', [['charcoal', 1, 'body']]),
    variant(p('chino--khaki'), p('chino'), 'Khaki', [['khaki', 1, 'body']]),
    variant(p('tee--brown'), p('tee'), 'Brown', [['brown', 1, 'body']]),
    variant(p('fwatch--38'), p('fwatch'), '38 mm, black dial', [['steel', 0.4, 'case'], ['black', 0.45, 'dial'], ['white', 0.15, 'indices']], { dialColor: 'Black', diameterMm: 38, lugWidthMm: 20 }),
    // Same look as the 38 mm; only the case size differs.
    variant(p('fwatch--40'), p('fwatch'), '40 mm, black dial', [['steel', 0.4, 'case'], ['black', 0.45, 'dial'], ['white', 0.15, 'indices']], { dialColor: 'Black', diameterMm: 40, lugWidthMm: 20 }),
    variant(p('diver--blue'), p('diver'), 'Blue', [['steel', 0.4, 'case'], ['blue', 0.5, 'dial'], ['white', 0.1, 'indices']], { dialColor: 'Blue', diameterMm: 41 }),
    variant(p('dress--white'), p('dress'), 'White dial', [['steel', 0.4, 'case'], ['white', 0.5, 'dial'], ['black', 0.1, 'indices']], { dialColor: 'White', diameterMm: 36, lugWidthMm: 22 }),
    // The catalog doesn't list this watch's lug width, so no strap fit can be claimed.
    variant(p('nolug--green'), p('nolug'), 'Green dial', [['steel', 0.4, 'case'], ['green', 0.5, 'dial'], ['white', 0.1, 'indices']], { dialColor: 'Green', diameterMm: 39 }),
    variant(p('leather-strap--brown-20'), p('leather-strap'), 'Brown, 20 mm', [['brown', 0.9, 'strap'], ['steel', 0.1, 'buckle']], { strapWidthMm: 20 }),
    variant(p('leather-strap--tan-22'), p('leather-strap'), 'Tan, 22 mm', [['tan', 0.9, 'strap'], ['steel', 0.1, 'buckle']], { strapWidthMm: 22 }),
    variant(p('canvas-strap--olive-18'), p('canvas-strap'), 'Olive, 18 mm', [['olive', 1, 'strap']], { strapWidthMm: 18 }),
    variant(p('canvas-strap--olive-20'), p('canvas-strap'), 'Olive, 20 mm', [['olive', 1, 'strap']], { strapWidthMm: 20 }),
    variant(p('fitted-strap--black-20'), p('fitted-strap'), 'Black, 20 mm', [['black', 1, 'strap']], { strapWidthMm: 20 }),
  ];
  const o = [
    sizedOffer(p('o-court-wg'), p('court--white-gum'), 10000),
    sizedOffer(p('o-court-wn'), p('court--white-natural'), 10000),
    sizedOffer(p('o-court-bw'), p('court--black-white'), 10500),
    sizedOffer(p('o-runner-ob'), p('runner--olive-bone'), 12400),
    sizedOffer(p('o-runner-nw'), p('runner--navy-white'), 13000),
    sizedOffer(p('o-trail-og'), p('trail--olive-gum'), 11800),
    sizedOffer(p('o-trail-rk'), p('trail--rust-khaki'), 13500, { out: ['10'] }),
    sizedOffer(p('o-luxe'), p('luxe--tan'), 24000),
    sizedOffer(p('o-used'), p('used--brown'), 7000, { condition: 'used_good', values: ['10'] }),
    sizedOffer(p('o-stale'), p('stale--olive'), 9000, { age: 60 }),
    sizedOffer(p('o-quiet'), p('quiet--tan'), 9500),
    sizedOffer(p('o-field-n'), p('field--navy'), 19800, { system: 'ALPHA', values: ALPHA }),
    sizedOffer(p('o-field-o'), p('field--olive'), 19800, { system: 'ALPHA', values: ALPHA }),
    sizedOffer(p('o-trouser-g'), p('trouser--grey'), 16500, { system: 'WAIST-INSEAM', values: WAIST }),
    sizedOffer(p('o-trouser-c'), p('trouser--charcoal'), 16500, { system: 'WAIST-INSEAM', values: WAIST }),
    sizedOffer(p('o-chino'), p('chino--khaki'), 8800, { system: 'WAIST-INSEAM', values: WAIST }),
    sizedOffer(p('o-tee'), p('tee--brown'), 3500, { system: 'ALPHA', values: ALPHA }),
    watchOffer(p('o-fw38'), p('fwatch--38'), 49500),
    watchOffer(p('o-fw40'), p('fwatch--40'), 52500),
    watchOffer(p('o-diver'), p('diver--blue'), 38000),
    watchOffer(p('o-dress'), p('dress--white'), 30000),
    watchOffer(p('o-nolug'), p('nolug--green'), 41000),
    watchOffer(p('o-ls20'), p('leather-strap--brown-20'), 4500),
    watchOffer(p('o-ls22'), p('leather-strap--tan-22'), 4500),
    watchOffer(p('o-cs18'), p('canvas-strap--olive-18'), 2500),
    watchOffer(p('o-cs20'), p('canvas-strap--olive-20'), 2500),
    watchOffer(p('o-fit20'), p('fitted-strap--black-20'), 6000),
  ];
  // runner--olive-sail has no offers at all: its price is unknown.
  return { brands: BRANDS, products, variants: v, images: v.map((x) => image(x.id)), retailers: demoRetailers.retailers, offers: o };
}

function fixtureCatalog() {
  return buildCatalog({ version: 'fixture', ...fixtureData('f') });
}

const confirmed = (userId) => ({
  retrieval: 'not_run', resolution: 'user_confirmed', variant: 'confirmed', evidence: [], conflicts: [],
  confirmedBy: userId, confirmedAt: '2026-09-01T00:00:00Z', matchJobId: null,
});

function ownedRecord(catalog, id, variantId, { size = null, userId = 'u_fx', identity, ownerChanges = [], created = '2026-09-01T00:00:00Z', custom = null } = {}) {
  const v = variantId ? catalog.variant(variantId) : null;
  const p = v ? catalog.product(v.productId) : null;
  return {
    id,
    userId,
    createdAt: created,
    updatedAt: created,
    archivedAt: null,
    category: p?.category ?? custom.category,
    productId: p?.id ?? null,
    variantId: v?.id ?? null,
    custom: custom ? { brand: custom.brand, name: custom.name, variantName: null, type: custom.type ?? null, colors: custom.colors ?? [] } : null,
    identity: identity ?? (custom ? { ...confirmed(userId), resolution: 'manual', variant: 'not_applicable' } : confirmed(userId)),
    details: { size, condition: 'good', purchase: null, notes: 'private note', serialNumber: null },
    ownerChanges,
    photos: { originalId: null, cleanedId: null, labelIds: [] },
    display: 'catalog',
  };
}

function wishRecord(catalog, id, variantId, { intent = 'inspiration', reason = 'like_style', size = { value: '10', system: 'US-M' }, condition = 'new_only', flexible = true, target = 15000, linked = [], userId = 'u_fx' } = {}) {
  const v = catalog.variant(variantId);
  const p = catalog.product(v.productId);
  return {
    id,
    userId,
    createdAt: '2026-10-09T00:00:00Z',
    updatedAt: '2026-10-09T00:00:00Z',
    status: 'active',
    category: p.category,
    productId: p.id,
    variantId,
    custom: null,
    identity: confirmed(userId),
    reason,
    reasonNote: '',
    intent,
    linkedOwnedIds: linked,
    desired: { size, condition, variantFlexible: flexible },
    targetPriceMinor: target,
    currency: 'USD',
    sourceUrl: null,
    matchPending: false,
    photos: { originalId: null },
    purchasedOwnedId: null,
  };
}

const PROFILE = {
  userId: 'u_fx',
  onboardedAt: '2026-08-01T00:00:00Z',
  sizes: { shoe: { value: '10', system: 'US-M' }, top: { value: 'M', system: 'ALPHA' }, bottom: { value: '32x32', system: 'WAIST-INSEAM' } },
  budgets: { sneaker: 15000, watch: 60000, clothing: 20000 },
  styles: ['minimal', 'classic'],
  colorsLiked: ['olive', 'navy', 'grey', 'white'],
  colorsAvoided: [],
  uses: ['everyday', 'work'],
  categories: ['sneaker', 'watch', 'clothing'],
};

/** The brief's person on the fixture catalog: white sneakers, navy jacket, grey trousers, steel watch. */
function fixturePerson(catalog = fixtureCatalog()) {
  const owned = [
    ownedRecord(catalog, 'own_sneaker', 'f-court--white-gum', { size: { value: '10', system: 'US-M' }, created: '2026-09-01T00:00:00Z' }),
    ownedRecord(catalog, 'own_jacket', 'f-field--navy', { size: { value: 'M', system: 'ALPHA' }, created: '2026-09-02T00:00:00Z' }),
    ownedRecord(catalog, 'own_trouser', 'f-trouser--grey', { size: { value: '32x32', system: 'WAIST-INSEAM' }, created: '2026-09-03T00:00:00Z' }),
    ownedRecord(catalog, 'own_watch', 'f-fwatch--38', { created: '2026-09-04T00:00:00Z' }),
  ];
  const wishlist = [wishRecord(catalog, 'wish_runner', 'f-runner--olive-bone')];
  return { catalog, owned, wishlist, profile: structuredClone(PROFILE) };
}

function engineInput(person, extra = {}) {
  const { catalog } = person;
  return {
    catalog,
    now: NOW,
    owned: person.owned,
    wishlist: person.wishlist,
    profile: person.profile,
    feedback: [],
    weights: DEFAULT_WEIGHTS,
    constraints: {},
    limit: 12,
    offersFor: (id) => listOffers(catalog, id, NOW),
    views: {
      product: (p) => productSummary(catalog, p),
      variant: (v) => variantView(catalog, v, { now: NOW, context: 'product' }),
      owned: (item) => ownedView(catalog, item, { now: NOW }),
      wishlist: (item) => wishlistView(catalog, item, { now: NOW }),
    },
    ...extra,
  };
}

const ids = (result) => result.items.map((i) => i.variantId);
const byId = (person, id) => person.owned.find((o) => o.id === id) ?? person.wishlist.find((w) => w.id === id);

// ---------- Grounding checks shared by many tests ----------

function offerPrices(catalog, item, condition) {
  const live = catalog.offersOf(item.variantId).filter((o) => o.listingStatus === 'active' && (condition !== 'new_only' || o.condition === 'new'));
  return live.flatMap((o) => {
    if (!o.sizes) return o.stock !== 'out_of_stock' && o.priceMinor != null ? [o.priceMinor] : [];
    return o.sizes
      .filter((s) => s.stock !== 'out_of_stock' && (!item.size || (s.value === item.size.value && s.system === item.size.system)))
      .map((s) => s.priceMinor);
  });
}

/**
 * Every result is a real catalog variant, every price is a real offer price for that variant,
 * size and condition, every related item is the person's own, and explanations only name
 * related items.
 */
function assertGrounded(result, { catalog, itemIds, condition = 'new_only' }) {
  const productNames = [...catalog.products.values()].map((p) => `${catalog.brand(p.brandId)?.name ?? ''} ${p.name}`.trim());
  for (const item of result.items) {
    assert.ok(catalog.variant(item.variantId), `${item.variantId} is in the catalog`);
    assert.equal(catalog.variant(item.variantId).productId, item.productId);
    assert.equal(item.variant.id, item.variantId);
    if (item.price.fromMinor == null) {
      assert.equal(item.price.status, 'unknown', `${item.variantId} has no price, so its status is unknown`);
    } else {
      assert.ok(offerPrices(catalog, item, condition).includes(item.price.fromMinor), `${item.variantId} price ${item.price.fromMinor} is a real offer price`);
      assert.notEqual(item.price.fromMinor, 0);
    }
    const relatedNames = new Set(item.related.map((r) => `${r.brandName} ${r.title}`.trim()));
    for (const r of item.related) {
      assert.ok(itemIds.has(r.itemId), `related ${r.itemId} belongs to the person`);
      assert.ok(['owned', 'wishlist'].includes(r.itemType));
      assert.ok(r.detail && /[.]$/.test(r.detail), 'each related item has one sentence of detail');
    }
    for (const name of productNames) {
      if (item.explanation.includes(name)) assert.ok(relatedNames.has(name), `"${name}" is named in "${item.explanation}" but not related`);
    }
    assert.doesNotMatch(item.explanation, /%|\bscore\b|outfits?\b|\bwore\b|\bworn\b/i);
  }
}

// ---------- Weights ----------

test('default weights sit inside the documented admin ranges', () => {
  assert.deepEqual(Object.keys(DEFAULT_WEIGHTS).sort(), Object.keys(WEIGHT_RANGES).sort());
  for (const [key, value] of Object.entries(DEFAULT_WEIGHTS)) {
    const range = WEIGHT_RANGES[key];
    assert.ok(value >= range.min && value <= range.max, key);
    assert.ok(range.label && range.help, `${key} has copy for the editor`);
  }
  const normalized = normalizeWeights({ style: 99, color: -4, harmony: '2', bogus: 5, diversity: null });
  assert.equal(normalized.style, WEIGHT_RANGES.style.max);
  assert.equal(normalized.color, WEIGHT_RANGES.color.min);
  assert.equal(normalized.harmony, 2);
  assert.equal(normalized.diversity, DEFAULT_WEIGHTS.diversity);
  assert.equal('bogus' in normalized, false);
  const checked = validateWeights({ shape: 7, price: 1.2 });
  assert.ok(checked.errors.shape);
  assert.equal(checked.weights.price, 1.2);
});

// ---------- Harmony ----------

test('harmony returns explainable pairings phrased as suggestions', () => {
  assert.equal(harmony('olive', 'navy').kind, 'classic_pair');
  assert.equal(harmony('olive', 'navy').sentence, 'Olive and navy are a classic pairing');
  for (const [a, b] of [['navy', 'grey'], ['navy', 'tan'], ['navy', 'khaki'], ['navy', 'white'], ['grey', 'olive'], ['brown', 'olive'], ['brown', 'off-white'], ['black', 'white']]) {
    assert.equal(harmony(a, b).kind, 'classic_pair', `${a} + ${b}`);
  }
  assert.equal(harmony('tan', 'olive').kind, 'earth_palette');
  assert.equal(harmony('rust', 'khaki').kind, 'earth_palette');
  assert.equal(harmony('olive', 'olive').kind, 'tonal');
  assert.equal(harmony('rust', 'grey').kind, 'contrast_accent');
  assert.equal(harmony('charcoal', 'tan').kind, 'neutral_base');
  assert.equal(harmony('charcoal', 'tan').sentence, 'Charcoal is an easy neutral to wear with tan');
  const steelNavy = harmony('steel', 'navy');
  assert.equal(steelNavy.kind, 'metal');
  assert.ok(steelNavy.strength >= 0.6);
  assert.ok(harmony('gold', 'olive').strength >= 0.6, 'warm metals suit earth tones');
  assert.ok(harmony('steel', 'olive').strength < PAIRING_THRESHOLD, 'cool metals are a weak match for earth tones');
  assert.ok(harmony('gold', 'grey').strength < PAIRING_THRESHOLD);
  const clash = harmony('navy', 'black');
  assert.equal(clash.kind, 'clash');
  assert.ok(harmonyScore(clash) < 0, 'a clash counts against');
  assert.equal(harmony('olive', 'not-a-color').kind, 'none');
  for (const [a, b] of [['olive', 'navy'], ['steel', 'navy'], ['navy', 'black'], ['rust', 'grey'], ['olive', 'olive']]) {
    const s = harmony(a, b).sentence;
    assert.doesNotMatch(s, /%|always|perfect|guarantee|matches exactly/i, s);
  }
  const runnerVsJacket = paletteHarmony([{ name: 'olive', weight: 0.58 }, { name: 'bone', weight: 0.3 }, { name: 'tan', weight: 0.12 }], [{ name: 'navy', weight: 0.88 }, { name: 'brown', weight: 0.07 }]);
  assert.equal(runnerVsJacket.kind, 'classic_pair');
  assert.ok(runnerVsJacket.score >= PAIRING_THRESHOLD);
  assert.deepEqual(runnerVsJacket.colors, ['olive', 'navy']);
});

// ---------- Explanations ----------

test('relation details read like the brief and name the item', () => {
  assert.equal(
    relationDetail({ relation: 'color_pairing', itemType: 'owned', name: 'Harbor & Pine Deck Field Jacket', facts: { sentence: 'Olive and navy are a classic pairing' } }),
    'Olive and navy are a classic pairing, so this would sit well with your Harbor & Pine Deck Field Jacket.',
  );
  assert.equal(
    relationDetail({ relation: 'same_shape', itemType: 'owned', name: 'Vela Court Low', facts: { category: 'sneaker', type: 'court', shape: 'low court', colorPhrase: 'black' } }),
    'Same low court shape as your Vela Court Low, in black.',
  );
  assert.equal(
    relationDetail({ relation: 'cheaper_alternative', itemType: 'wishlist', name: 'Kestrel Runner 2', facts: { differenceMinor: 2500, currency: 'USD' } }),
    '$25 less than the Kestrel Runner 2 on your wishlist at the prices we checked.',
  );
  assert.equal(
    relationDetail({ relation: 'strap_fit', itemType: 'owned', name: 'Arden Field', facts: { widthMm: 20, attachment: 'spring_bar', direction: 'strap_for_watch' } }),
    'Fits your Arden Field: both 20 mm with standard spring bars, from catalog specs.',
  );
  assert.equal(
    relationDetail({ relation: 'near_duplicate', itemType: 'owned', name: 'Vela Court Low, White / Gum', facts: { sameProduct: true, differingRoles: ['sole'] } }),
    'Very close to your Vela Court Low, White / Gum: only the sole color differs.',
  );
  const stale = explain({ relations: [], price: { status: 'stale', fromMinor: 9000, currency: 'USD', checkedAt: new Date(NOW - 60 * 3600000).toISOString() }, now: NOW, preferences: { likedColors: ['olive'] } });
  assert.equal(stale, 'In olive, a color you like. Its price was last checked 3 days ago, so it may have changed.');
});

// ---------- The brief's scenario on the fixture catalog (exact) ----------

test('matching complements the collection with real items and names the owned items', () => {
  const person = fixturePerson();
  const itemIds = new Set([...person.owned, ...person.wishlist].map((r) => r.id));
  const result = recommend(engineInput(person, { mode: 'matching', constraints: { maxPriceMinor: 15000 } }));
  assertGrounded(result, { catalog: person.catalog, itemIds });
  assert.ok(result.items.length >= 3);
  for (const item of result.items) {
    assert.equal(item.kind, 'complementary');
    assert.ok(item.price.fromMinor != null && item.price.fromMinor <= 15000, `${item.variantId} is within $150 at a known price`);
    if (item.product.category === 'sneaker') {
      assert.deepEqual(item.size, { value: '10', system: 'US-M' });
      assert.equal(item.availability, 'in_stock_in_size');
    }
    assert.ok(item.related.length >= 1, 'every match names what it goes with');
  }
  const trail = result.items.find((i) => i.variantId === 'f-trail--olive-gum');
  assert.ok(trail, 'the olive trail runner is suggested');
  const jacket = trail.related.find((r) => r.itemId === 'own_jacket');
  assert.equal(jacket.relation, 'color_pairing');
  assert.match(jacket.detail, /^Olive and navy are a classic pairing, so this would sit well with your Fixture Apparel Field Coat\.$/);
  assert.match(trail.explanation, /Fixture Apparel Field Coat/);
  assert.ok(trail.related.some((r) => r.itemId === 'own_trouser'), 'olive also pairs with the grey trousers');
  assert.ok(result.items.some((i) => ['olive', 'khaki', 'tan', 'brown', 'rust'].includes(i.variant.colors[0].name)), 'earth tones are suggested');
  assert.ok(result.applied.hard.some((h) => h.kind === 'budget' && /\$150/.test(h.label)));
  assert.ok(result.applied.hard.some((h) => h.kind === 'size' && /US M 10/.test(h.label)));
  assert.equal(result.excluded.overBudget > 0, true, 'the $240 runner was over budget');
  assert.equal(result.excluded.sizeUnavailable > 0, true, 'the rust trail runner is out of stock in 10');
  assert.ok(result.excluded.priceUnknown > 0, 'items without offers cannot be checked against the budget');
});

test('exact owned variants are excluded by default and included on request', () => {
  const person = fixturePerson();
  const ownedVariants = new Set(person.owned.map((o) => o.variantId));
  const base = recommend(engineInput(person, { mode: 'similar', seeds: [{ type: 'owned', record: byId(person, 'own_jacket') }] }));
  assert.ok(base.items.every((i) => !ownedVariants.has(i.variantId)));
  const matching = recommend(engineInput(person, { mode: 'matching' }));
  assert.ok(matching.items.every((i) => !ownedVariants.has(i.variantId)));
  assert.equal(matching.excluded.owned, 4, 'all four owned versions were left out and counted');
  const withOwned = recommend(engineInput(person, { mode: 'matching', constraints: { includeOwned: true }, limit: 24 }));
  const ownedHits = withOwned.items.filter((i) => ownedVariants.has(i.variantId));
  assert.ok(ownedHits.length >= 1);
  for (const item of ownedHits) {
    assert.equal(item.flags.owned, true);
    assert.equal(item.kind, 'potential_duplicate', 'an owned version is never presented as something new');
    assert.ok(item.related.some((r) => r.relation === 'near_duplicate' && /^Same version as your /.test(r.detail)));
  }
  assert.equal(withOwned.excluded.owned, 0);
});

test('alternatives honor the wishlist intent, target price, size and condition', () => {
  const person = fixturePerson();
  const itemIds = new Set([...person.owned, ...person.wishlist].map((r) => r.id));
  const wish = byId(person, 'wish_runner');
  const result = recommend(engineInput(person, { mode: 'alternatives', seeds: [{ type: 'wishlist', record: wish }] }));
  assertGrounded(result, { catalog: person.catalog, itemIds });
  assert.ok(result.items.length >= 2);
  for (const item of result.items) {
    assert.equal(item.product.category, 'sneaker');
    assert.ok(item.price.fromMinor != null && item.price.fromMinor <= 15000);
    assert.deepEqual(item.size, { value: '10', system: 'US-M' });
    assert.equal(item.availability, 'in_stock_in_size');
    assert.equal(item.related[0].itemId, 'wish_runner', 'the wishlist item comes first');
    assert.notEqual(item.variantId, 'f-used--brown', 'used-only offers stay out of a new-only wish');
  }
  assert.ok(['wishlist_alternative', 'potential_duplicate'].includes(result.items[0].kind));
  const trail = result.items.find((i) => i.variantId === 'f-trail--olive-gum');
  assert.ok(trail);
  assert.equal(trail.related[0].relation, 'cheaper_alternative');
  assert.match(trail.related[0].detail, /\$6 less at the prices we checked\.$/, '$124 for the wish against $118');
  assert.ok(result.applied.hard.some((h) => h.kind === 'budget' && /\$150 target/.test(h.label)));
  assert.ok(result.applied.hard.some((h) => h.kind === 'size' && /wishlist/.test(h.label)));

  // Reason "too expensive" without a target: strictly cheaper than the wish at known prices.
  const cheaper = recommend(engineInput(person, { mode: 'alternatives', seeds: [{ type: 'wishlist', record: { ...wish, reason: 'too_expensive', targetPriceMinor: null } }] }));
  assert.ok(cheaper.items.length >= 1);
  for (const item of cheaper.items) assert.ok(item.price.fromMinor < 12400, `${item.variantId} is cheaper than the wish`);

  // Exact intent: no replacements, and only other colorways when the person allows them.
  const exact = recommend(engineInput(person, { mode: 'alternatives', seeds: [{ type: 'wishlist', record: { ...wish, intent: 'exact', desired: { ...wish.desired, variantFlexible: false } } }] }));
  assert.equal(exact.items.length, 0);
  assert.match(exact.emptyReason, /exact version/);
  assert.equal(exact.relaxations.length, 0);
  const colorways = recommend(engineInput(person, { mode: 'alternatives', seeds: [{ type: 'wishlist', record: { ...wish, intent: 'exact', targetPriceMinor: null } }], constraints: { includeUnknownPrice: true } }));
  assert.ok(colorways.items.length >= 1);
  assert.ok(colorways.items.every((i) => i.productId === 'f-runner' && i.variantId !== wish.variantId));

  // Complement intent: options that go with the linked owned items.
  const complement = recommend(engineInput(person, { mode: 'alternatives', seeds: [{ type: 'wishlist', record: { ...wish, intent: 'complement', linkedOwnedIds: ['own_jacket'] } }] }));
  assert.ok(complement.items.length >= 1);
  for (const item of complement.items) {
    assert.ok(item.related.some((r) => r.itemId === 'own_jacket' && r.relation === 'color_pairing'), `${item.variantId} goes with the linked jacket`);
  }
});

test('similar keeps the category, finds the same shape and flags lookalikes', () => {
  const person = fixturePerson();
  const sneaker = byId(person, 'own_sneaker');
  const result = recommend(engineInput(person, { mode: 'similar', seeds: [{ type: 'owned', record: sneaker }] }));
  assert.ok(result.items.every((i) => i.product.category === 'sneaker'));
  const black = result.items.find((i) => i.variantId === 'f-court--black-white');
  assert.ok(black, 'the same court shoe in black is similar');
  assert.equal(black.kind, 'similar');
  assert.equal(black.related[0].relation, 'same_shape');
  assert.equal(black.related[0].detail, 'Same low court shape as your Fixture Footwear Court One, in black.');
  assert.ok(result.items.indexOf(black) <= 1, 'shape and style lead the similar list');
  const natural = result.items.find((i) => i.variantId === 'f-court--white-natural');
  assert.ok(!natural || natural.kind === 'potential_duplicate');

  const explore = recommend(engineInput(person, { mode: 'similar', seeds: [{ type: 'owned', record: sneaker }], exploreColorways: true }));
  const lookalike = explore.items.find((i) => i.variantId === 'f-court--white-natural');
  assert.ok(lookalike, 'colorway exploration shows the near-identical version');
  assert.equal(lookalike.kind, 'potential_duplicate');
  assert.equal(lookalike.related[0].relation, 'near_duplicate');
  assert.equal(lookalike.related[0].detail, 'Very close to your Fixture Footwear Court One, White / Gum: only the sole color differs.');
  assert.ok(explore.items.indexOf(lookalike) > explore.items.indexOf(explore.items.find((i) => i.kind === 'similar')), 'lookalikes rank after real alternatives');

  // A lookalike of something owned is not sold as a match for the collection.
  const matching = recommend(engineInput(person, { mode: 'matching', limit: 24 }));
  assert.ok(!ids(matching).includes('f-court--white-natural'));
  assert.ok(!ids(matching).includes('f-fwatch--40'), 'the 40 mm looks the same as the owned 38 mm');
  assert.equal(matching.excluded.nearDuplicates, 2);
});

test('hard constraints that leave nothing return relaxations with exact counts', () => {
  const person = fixturePerson();
  const sneaker = byId(person, 'own_sneaker');
  const constraints = { maxPriceMinor: 8000 };
  const input = engineInput(person, { mode: 'similar', seeds: [{ type: 'owned', record: sneaker }], constraints });
  const result = recommend(input);
  assert.equal(result.items.length, 0);
  assert.match(result.emptyReason, /over \$80 at the prices we checked/);
  const kinds = result.relaxations.map((r) => r.kind);
  assert.ok(kinds.includes('raise_budget'));
  assert.ok(kinds.includes('include_used'), 'the used skate shoe is $70');
  assert.ok(kinds.includes('include_unknown_price'), 'the olive sail runner has no price');
  for (const relaxation of result.relaxations) {
    assert.ok(relaxation.label && relaxation.wouldReturn > 0);
    const patched = { ...constraints };
    for (const [k, v] of Object.entries(relaxation.constraints)) {
      if (v === null) delete patched[k];
      else patched[k] = v;
    }
    const rerun = recommend({ ...input, constraints: patched });
    assert.equal(rerun.items.length, relaxation.wouldReturn, `${relaxation.kind} would return what it says`);
  }
  const raise = result.relaxations.find((r) => r.kind === 'raise_budget');
  assert.ok(raise.constraints.maxPriceMinor > 8000);
  const used = recommend({ ...input, constraints: { ...constraints, condition: 'new_or_used' } });
  assert.deepEqual(ids(used), ['f-used--brown']);
  assert.equal(used.items[0].price.fromMinor, 7000);
  assertGrounded(used, { catalog: person.catalog, itemIds: new Set(person.owned.map((o) => o.id)), condition: 'new_or_used' });

  // A size nobody stocks: the any-size relaxation brings results back.
  const sizeInput = engineInput(person, { mode: 'similar', seeds: [{ type: 'owned', record: sneaker }], constraints: { size: { value: '13', system: 'US-M' } } });
  const noSize = recommend(sizeInput);
  assert.equal(noSize.items.length, 0);
  assert.match(noSize.emptyReason, /in stock in US M 13/);
  const anySize = noSize.relaxations.find((r) => r.kind === 'any_size');
  assert.ok(anySize);
  assert.equal(recommend({ ...sizeInput, constraints: { anySize: true } }).items.length, anySize.wouldReturn);

  // Category: a typed type with nothing in it can be widened.
  const typed = engineInput(person, { mode: 'similar', constraints: { category: 'sneaker', types: ['high-top'] } });
  const none = recommend(typed);
  assert.equal(none.items.length, 0);
  assert.match(none.emptyReason, /no high-top/);
  const widen = none.relaxations.find((r) => r.kind === 'any_category');
  assert.ok(widen);
  assert.equal(recommend({ ...typed, constraints: { category: 'sneaker' } }).items.length, widen.wouldReturn);
});

test('unknown prices stay unknown and stale prices are flagged', () => {
  const person = fixturePerson();
  const open = recommend(engineInput(person, { mode: 'similar', constraints: { category: 'sneaker' }, limit: 24 }));
  const ghost = open.items.find((i) => i.variantId === 'f-ghost--olive');
  assert.ok(ghost, 'without a budget, an item with no offers can still be suggested');
  assert.equal(ghost.price.status, 'unknown');
  assert.equal(ghost.price.fromMinor, null);
  assert.equal(ghost.availability, 'no_offers');
  assertGrounded(open, { catalog: person.catalog, itemIds: new Set(person.owned.map((o) => o.id)) });
  const stale = open.items.find((i) => i.variantId === 'f-stale--olive');
  assert.equal(stale.price.status, 'stale');
  assert.equal(stale.price.fromMinor, 9000);
  assert.match(stale.explanation, /may have changed/);

  const budgeted = recommend(engineInput(person, { mode: 'similar', constraints: { category: 'sneaker', maxPriceMinor: 15000 }, limit: 24 }));
  assert.ok(!ids(budgeted).includes('f-ghost--olive'));
  assert.ok(budgeted.excluded.priceUnknown >= 1);
  assert.ok(ids(budgeted).includes('f-stale--olive'), 'a stale price still counts, flagged');
  const included = recommend(engineInput(person, { mode: 'similar', constraints: { category: 'sneaker', maxPriceMinor: 15000, includeUnknownPrice: true }, limit: 24 }));
  assert.ok(ids(included).includes('f-ghost--olive'));
  // A typed size can't be confirmed without offers either.
  const sized = recommend(engineInput(person, { mode: 'similar', constraints: { category: 'sneaker', size: { value: '10', system: 'US-M' } }, limit: 24 }));
  assert.ok(!ids(sized).includes('f-ghost--olive'));
  assert.ok(sized.relaxations.length === 0 || sized.items.length < 3);
  assert.ok(included.applied.hard.some((h) => /price unknown/.test(h.label)));
});

test('straps fit only by catalog lug width and attachment', () => {
  const catalog = fixtureCatalog();
  const person = fixturePerson(catalog);
  const watch = byId(person, 'own_watch');
  const result = recommend(engineInput(person, { mode: 'matching', seeds: [{ type: 'owned', record: watch }], limit: 24 }));
  const straps = result.items.filter((i) => i.product.type === 'strap');
  assert.deepEqual(straps.map((i) => i.variantId).sort(), ['f-canvas-strap--olive-20', 'f-leather-strap--brown-20'].sort().slice(0, straps.length));
  assert.ok(straps.length >= 1);
  for (const strap of straps) {
    const fit = strap.related.find((r) => r.relation === 'strap_fit');
    assert.equal(fit.itemId, 'own_watch');
    assert.equal(fit.detail, 'Fits your Fixture Time Field Auto: both 20 mm with standard spring bars, from catalog specs.');
  }
  assert.ok(!ids(result).includes('f-leather-strap--tan-22'));
  assert.ok(!ids(result).includes('f-canvas-strap--olive-18'));
  assert.ok(!ids(result).includes('f-fitted-strap--black-20'), 'an integrated strap never claims a fit');
  assert.equal(result.excluded.incompatible, 3);
  assert.ok(result.applied.hard.some((h) => h.kind === 'strap_fit'));

  // Integrated bracelets, unlisted lug widths, unconfirmed versions and typed widths: no claims.
  const integrated = ownedRecord(catalog, 'own_diver', 'f-diver--blue');
  const unlisted = ownedRecord(catalog, 'own_nolug', 'f-nolug--green');
  const conflicting = ownedRecord(catalog, 'own_conflict', 'f-fwatch--38', { identity: { ...confirmed('u_fx'), variant: 'conflicting' } });
  const custom = ownedRecord(catalog, 'own_custom', null, { custom: { category: 'watch', brand: 'Someone', name: 'Old field watch', colors: ['steel', 'black'] }, ownerChanges: [{ part: 'strap', description: 'Swapped strap', widthMm: 20 }] });
  for (const [record, reason] of [[integrated, 'integrated'], [unlisted, 'lug_width_unknown'], [conflicting, 'variant_unconfirmed'], [custom, 'not_in_catalog']]) {
    const someone = { ...person, owned: [record] };
    const r = recommend(engineInput(someone, { mode: 'matching', seeds: [{ type: 'owned', record }], scope: { types: ['strap'] } }));
    assert.equal(r.items.length, 0, `${record.id}: no straps`);
    assert.ok(r.excluded.incompatible > 0);
    if (reason === 'integrated') assert.match(r.emptyReason, /integrated bracelet/);
    if (reason === 'lug_width_unknown') assert.match(r.emptyReason, /doesn't list the lug width/);
    if (reason === 'variant_unconfirmed' || reason === 'not_in_catalog') assert.match(r.emptyReason, /widths you enter yourself aren't checked/);
    const all = recommend(engineInput(someone, { mode: 'matching', limit: 24 }));
    assert.ok(all.items.every((i) => i.related.every((rel) => rel.relation !== 'strap_fit')), `${record.id}: no fit claims anywhere`);
  }

  // The rule itself.
  const subject = (v, record = null) => {
    const p = catalog.productOf(v);
    return { slot: slotOf(p.category, p.type), product: p, variant: catalog.variant(v), verifiedVariant: record ? record.identity.variant === 'confirmed' : true };
  };
  assert.equal(strapFit(subject('f-leather-strap--brown-20'), subject('f-fwatch--38')).fits, true);
  assert.equal(strapFit(subject('f-leather-strap--tan-22'), subject('f-dress--white')).fits, true, 'quick-release watches take standard straps');
  assert.equal(strapFit(subject('f-leather-strap--tan-22'), subject('f-fwatch--38')).reason, 'width_mismatch');
  assert.equal(strapFit(subject('f-leather-strap--brown-20'), subject('f-diver--blue')).reason, 'integrated');
  assert.equal(strapFit(subject('f-leather-strap--brown-20'), subject('f-nolug--green')).reason, 'lug_width_unknown');
  assert.equal(strapFit(subject('f-fitted-strap--black-20'), subject('f-fwatch--38')).reason, 'strap_integrated');
});

test('diversity: one version per product, two when exploring colorways, no near-identical runs', () => {
  const person = fixturePerson();
  const runner = byId(person, 'wish_runner');
  const result = recommend(engineInput(person, { mode: 'similar', seeds: [{ type: 'wishlist', record: runner }], limit: 24 }));
  const perProduct = new Map();
  for (const item of result.items) perProduct.set(item.productId, (perProduct.get(item.productId) ?? 0) + 1);
  assert.ok([...perProduct.values()].every((n) => n === 1), 'one version per product');
  const explore = recommend(engineInput(person, { mode: 'similar', seeds: [{ type: 'wishlist', record: runner }], limit: 24, exploreColorways: true }));
  const counts = new Map();
  for (const item of explore.items) counts.set(item.productId, (counts.get(item.productId) ?? 0) + 1);
  assert.ok([...counts.values()].every((n) => n <= 2));
  assert.ok([...counts.values()].some((n) => n === 2), 'exploring shows a second colorway');
  assert.ok(new Set(ids(explore)).size === explore.items.length);

  // Five near-identical olive runners from different products against one different pick.
  const data = fixtureData('f');
  for (let i = 1; i <= 5; i += 1) {
    data.products.push(product(`f-clone${i}`, { category: 'sneaker', type: 'runner', brandId: 'fx-foot', name: `Clone Runner ${i}`, tags: ['sporty', 'street', 'minimal'], materials: ['mesh', 'suede'], attributes: { cut: 'low', closure: 'laces' } }));
    data.variants.push(variant(`f-clone${i}--olive`, `f-clone${i}`, 'Olive / Bone', [['olive', 0.58, 'upper'], ['bone', 0.3, 'sole'], ['tan', 0.12, 'accent']]));
    data.offers.push(sizedOffer(`f-o-clone${i}`, `f-clone${i}--olive`, 12000 + i * 100));
  }
  data.images = data.variants.map((x) => image(x.id));
  const crowded = buildCatalog({ version: 'crowded', ...data });
  const crowdedPerson = fixturePerson(crowded);
  const seed = { type: 'wishlist', record: crowdedPerson.wishlist[0] };
  const pure = recommend(engineInput(crowdedPerson, { mode: 'similar', seeds: [seed], weights: { ...DEFAULT_WEIGHTS, diversity: 0 }, limit: 8 }));
  const mixed = recommend(engineInput(crowdedPerson, { mode: 'similar', seeds: [seed], limit: 8 }));
  const firstOther = (r) => r.items.findIndex((i) => !i.productId.startsWith('f-clone') && i.productId !== 'f-runner');
  const clonesBefore = (r) => r.items.slice(0, firstOther(r) === -1 ? r.items.length : firstOther(r)).filter((i) => i.productId.startsWith('f-clone')).length;
  assert.ok(clonesBefore(pure) >= 4, 'pure relevance lines up the clones');
  assert.ok(clonesBefore(mixed) < clonesBefore(pure), 'MMR breaks the run of near-identical runners');
});

test('recommendations are deterministic', () => {
  const person = fixturePerson();
  for (const mode of ['matching', 'similar', 'alternatives']) {
    const seeds = mode === 'matching' ? [] : mode === 'similar' ? [{ type: 'owned', record: byId(person, 'own_sneaker') }] : [{ type: 'wishlist', record: byId(person, 'wish_runner') }];
    const a = recommend(engineInput(person, { mode, seeds }));
    const b = recommend(engineInput(fixturePerson(), { mode, seeds }));
    assert.deepEqual(a, b, mode);
  }
  assert.deepEqual(feed(engineInput(person)), feed(engineInput(fixturePerson())));
});

test('feedback changes later results and removing it restores them', () => {
  const person = fixturePerson();
  const input = engineInput(person, { mode: 'matching', limit: 24 });
  const before = recommend(input);
  const top = before.items[0];

  const wrong = recommend({ ...input, feedback: [{ id: 'fb1', productId: top.productId, variantId: top.variantId, type: 'wrong_style', contextItemId: null, active: true }] });
  assert.ok(!wrong.items.some((i) => i.productId === top.productId), 'dismissed product is gone');
  assert.ok(wrong.excluded.dismissed >= 1);
  assert.ok(wrong.applied.hard.some((h) => h.kind === 'dismissed'));
  const removed = recommend({ ...input, feedback: [{ id: 'fb1', productId: top.productId, variantId: top.variantId, type: 'wrong_style', contextItemId: null, active: false }] });
  assert.deepEqual(removed.items, before.items, 'inactive feedback has no effect');

  const last = before.items[before.items.length - 1];
  const liked = recommend({ ...input, feedback: [{ id: 'fb2', productId: last.productId, variantId: last.variantId, type: 'more_like_this', contextItemId: null, active: true }] });
  const likedItem = liked.items.find((i) => i.variantId === last.variantId);
  assert.ok(likedItem.score > last.score, 'more like this boosts its own tags and colors');

  const expensive = before.items.find((i) => i.product.category === 'clothing' && i.price.fromMinor >= 16500);
  assert.ok(expensive);
  const tooMuch = recommend({ ...input, feedback: [{ id: 'fb3', productId: expensive.productId, variantId: expensive.variantId, type: 'too_expensive', contextItemId: null, active: true }] });
  const after = tooMuch.items.find((i) => i.variantId === expensive.variantId);
  assert.ok(after.score < expensive.score, 'at or above the price that was too expensive counts against');
  const cheapClothing = before.items.find((i) => i.product.category === 'clothing' && i.price.fromMinor < expensive.price.fromMinor);
  if (cheapClothing) assert.equal(tooMuch.items.find((i) => i.variantId === cheapClothing.variantId).score, cheapClothing.score, 'cheaper items are untouched');

  // Too similar to the owned sneakers: that product goes, and lookalikes of the sneakers drop.
  const similarInput = engineInput(person, { mode: 'similar', seeds: [{ type: 'owned', record: byId(person, 'own_jacket') }], constraints: { category: 'sneaker' }, limit: 24 });
  const plain = recommend({ ...similarInput, mode: 'similar', seeds: [] });
  const quiet = plain.items.find((i) => i.variantId === 'f-quiet--tan');
  const tooSimilar = recommend({ ...similarInput, mode: 'similar', seeds: [], feedback: [{ id: 'fb4', productId: 'f-court', variantId: 'f-court--black-white', type: 'too_similar', contextItemId: 'own_sneaker', active: true }] });
  assert.ok(!tooSimilar.items.some((i) => i.productId === 'f-court'));
  const quietAfter = tooSimilar.items.find((i) => i.variantId === 'f-quiet--tan');
  assert.ok(quietAfter.score <= quiet.score);
});

test('cold start feed comes from the profile survey alone', () => {
  const catalog = fixtureCatalog();
  const profile = { ...PROFILE, styles: ['outdoor', 'sporty'], colorsLiked: ['olive', 'tan'], categories: ['sneaker', 'clothing'], budgets: { sneaker: 13000 } };
  const result = feed(engineInput({ catalog, owned: [], wishlist: [], profile }));
  assert.equal(result.coldStart, true);
  assert.ok(result.sections.length >= 1);
  assert.deepEqual(result.sections.map((s) => s.id), ['picks-sneaker', 'picks-clothing']);
  for (const section of result.sections) {
    assert.ok(section.items.length >= 1);
    for (const item of section.items) {
      assert.ok(profile.categories.includes(item.product.category));
      assert.equal(item.related.length, 0, 'nothing owned to relate to');
      assert.ok(item.explanation.length > 0);
    }
  }
  const first = result.sections[0].items[0];
  assert.ok(first.product.styleTags.some((t) => profile.styles.includes(t)) || first.variant.colors.some((c) => profile.colorsLiked.includes(c.name)), 'the top pick reflects the survey');
  assert.match(result.sections[0].items.map((i) => i.explanation).join(' '), /you picked|you like/);
  const seen = result.sections.flatMap((s) => s.items.map((i) => i.variantId));
  assert.equal(new Set(seen).size, seen.length, 'a variant appears once in the feed');
});

test('feed with a collection: matching, wishlist alternatives and strap sections', () => {
  const person = fixturePerson();
  const result = feed(engineInput(person));
  assert.equal(result.coldStart, false);
  const sectionIds = result.sections.map((s) => s.id);
  assert.equal(sectionIds[0], 'goes-with-collection');
  assert.ok(sectionIds.includes('alternatives-wish_runner'));
  assert.ok(sectionIds.includes('straps-own_watch'));
  const straps = result.sections.find((s) => s.id === 'straps-own_watch');
  assert.ok(straps.items.every((i) => i.product.type === 'strap' && i.related.some((r) => r.relation === 'strap_fit')));
  for (const section of result.sections) {
    assert.ok(section.title && section.description);
    if (!section.items.length) assert.ok(section.emptyReason);
  }
  const seen = result.sections.flatMap((s) => s.items.map((i) => i.variantId));
  assert.equal(new Set(seen).size, seen.length, 'no variant repeats across sections');
});

test('help me choose compares wishlist items with grounded facts', () => {
  const person = fixturePerson();
  const extra = [
    wishRecord(person.catalog, 'wish_trail', 'f-trail--olive-gum', { target: 10000 }),
    wishRecord(person.catalog, 'wish_court', 'f-court--white-natural', { target: null }),
  ];
  person.wishlist.push(...extra);
  const result = helpMeChoose({ ...engineInput(person), wishItems: person.wishlist });
  assert.equal(result.items.length, 3);
  const [runner, trail, court] = result.items;
  assert.deepEqual(runner.budget, { targetMinor: 15000, status: 'within', differenceMinor: 2600 });
  assert.deepEqual(trail.budget, { targetMinor: 10000, status: 'over', differenceMinor: 1800 });
  assert.equal(court.budget.targetMinor, 15000, 'no target: the profile budget is used and said so');
  assert.ok(court.notes.some((n) => /sneaker budget, since no target is set/.test(n)));
  assert.ok(runner.pairsWith.some((r) => r.itemId === 'own_jacket' && r.relation === 'color_pairing'));
  assert.ok(court.similarOwned.some((r) => r.itemId === 'own_sneaker' && r.relation === 'near_duplicate'));
  for (const item of result.items) {
    assert.ok(offerPrices(person.catalog, { variantId: person.wishlist.find((w) => w.id === item.wishId).variantId, size: item.size }, 'new_only').includes(item.price.fromMinor));
  }
  const text = result.summary.join(' ');
  assert.match(text, /At the prices we checked, the Fixture Footwear Day Runner fits its \$150 target and the Fixture Footwear Court One fits your \$150 sneaker budget\./);
  assert.match(text, /The Fixture Footwear Ridge Trail is \$18 over its \$100 target at the prices we checked\./);
  assert.match(text, /pairs? with your Fixture Apparel Field Coat/);
  assert.match(text, /very close to your Fixture Footwear Court One, White \/ Gum/);
  assert.doesNotMatch(text, /%|score|best choice|winner/i);
});

// ---------- Request parsing ----------

test('parseRequest reads the brief examples into chips and constraints', () => {
  const a = parseRequest('olive sneakers under $150 for work');
  assert.deepEqual(a.constraints, { colors: ['olive'], maxPriceMinor: 15000, uses: ['work'], category: 'sneaker' });
  assert.deepEqual(a.chips.map((c) => c.label), ['Olive', 'Sneakers', 'Under $150', 'For work']);
  assert.deepEqual(a.unparsed, []);

  const b = parseRequest('something to go with my navy jacket');
  assert.deepEqual(b.seedHints, ['navy jacket']);
  assert.deepEqual(b.constraints, {}, 'words about my jacket are not what I want to buy');
  assert.equal(b.chips[0].kind, 'seed');

  const c = parseRequest('a 20mm leather strap');
  assert.deepEqual(c.constraints, { strapWidthMm: 20, materials: ['leather'], types: ['strap'], category: 'watch' });
  assert.ok(c.chips.some((x) => x.label === '20 mm wide'));

  const d = parseRequest('earth tones, minimal, around $200');
  assert.deepEqual(d.constraints.colors, ['olive', 'khaki', 'tan', 'brown', 'rust']);
  assert.deepEqual(d.constraints.styles, ['minimal']);
  assert.equal(d.constraints.priceAroundMinor, 20000);
  assert.deepEqual(d.chips.map((x) => x.label), ['Earth tones', 'Minimal', 'Around $200']);
});

test('parseRequest covers synonyms, prices, sizes and negation', () => {
  const cat = (text) => parseRequest(text).constraints;
  assert.equal(cat('fresh kicks').category, 'sneaker');
  assert.equal(cat('trainers').category, 'sneaker');
  assert.equal(cat('shoes for the office').category, 'sneaker');
  assert.equal(cat('a timepiece').category, 'watch');
  assert.deepEqual(cat('a plain tee').types, ['tee']);
  assert.deepEqual(cat('grey hoodie').types, ['hoodie']);
  assert.deepEqual(cat('pants').types, ['chinos', 'trousers', 'jeans']);
  assert.deepEqual(cat('wool trousers').types, ['trousers']);
  assert.deepEqual(cat('a shirt').types, ['oxford-shirt', 'overshirt']);
  assert.deepEqual(cat('jacket').types, ['chore-jacket', 'field-jacket', 'bomber']);
  assert.deepEqual(cat('dive watch').types, ['diver']);
  assert.deepEqual(cat('neutral sneakers').colors, ['white', 'off-white', 'bone', 'light-grey', 'grey', 'charcoal', 'black', 'navy']);
  assert.deepEqual(cat('gray cream and maroon').colors, ['grey', 'off-white', 'burgundy']);
  assert.deepEqual(cat('streetwear, vintage, bold').styles, ['street', 'vintage', 'bold']);
  assert.deepEqual(cat('for running and the gym').uses, ['running', 'training']);

  assert.deepEqual(cat('between $80 and $120'), { minPriceMinor: 8000, maxPriceMinor: 12000 });
  assert.deepEqual(cat('$100-$150'), { minPriceMinor: 10000, maxPriceMinor: 15000 });
  assert.equal(cat('less than 90 dollars').maxPriceMinor, 9000);
  assert.equal(cat('max $75').maxPriceMinor, 7500);
  assert.equal(cat('below $1,200').maxPriceMinor, 120000);
  assert.equal(cat('$49.99 or less').maxPriceMinor, 4999);
  assert.equal(cat('about $1.2k').priceAroundMinor, 120000);

  assert.deepEqual(cat('size 10.5').size, { value: '10.5', system: 'US-M' });
  assert.deepEqual(cat("women's 8").size, { value: '8', system: 'US-W' });
  assert.deepEqual(cat('chinos 32x32').size, { value: '32x32', system: 'WAIST-INSEAM' });
  assert.deepEqual(cat('a tee in size m').size, { value: 'M', system: 'ALPHA' });
  assert.deepEqual(cat('medium hoodie').size, { value: 'M', system: 'ALPHA' });
  assert.equal(cat('a large watch').size, undefined, '"large" is only a size for clothing');
  assert.equal(cat('a 40mm field watch').caseDiameterMm, 40);
  assert.equal(cat('a 40mm field watch').maxPriceMinor, undefined, 'a case size is not a price');

  assert.deepEqual(cat('sneakers, no white').avoidColors, ['white']);
  assert.deepEqual(cat('not too loud').avoidStyles, ['bold']);
  assert.equal(cat('used watch').condition, 'new_or_used');
  assert.equal(cat('brand new only').condition, 'new_only');
  assert.equal(cat('in stock now').inStockOnly, true);

  const odd = parseRequest('xyzzy sneakers plugh');
  assert.deepEqual(odd.unparsed, ['xyzzy', 'plugh']);
  assert.equal(odd.constraints.category, 'sneaker');

  const brand = parseRequest('harbor and pine jacket', { brands: [{ id: 'harbor-pine', name: 'Harbor & Pine' }] });
  assert.deepEqual(brand.constraints.brandIds, ['harbor-pine']);

  const multi = parseRequest('pants that go with my white sneakers and my steel watch under $90');
  assert.deepEqual(multi.seedHints, ['white sneakers', 'steel watch']);
  assert.equal(multi.constraints.maxPriceMinor, 9000);
  assert.deepEqual(multi.constraints.types, ['chinos', 'trousers', 'jeans']);
});

test('a typed type narrows only its own category', () => {
  const person = fixturePerson();
  const { constraints } = parseRequest('olive sneakers and a field jacket');
  assert.deepEqual(constraints, { colors: ['olive'], types: ['field-jacket'], categories: ['sneaker', 'clothing'] });
  const result = recommend(engineInput(person, { mode: 'similar', constraints, limit: 24 }));
  assert.ok(result.items.some((i) => i.product.category === 'sneaker'), 'sneakers of any type stay');
  for (const item of result.items) {
    assert.ok(['sneaker', 'clothing'].includes(item.product.category));
    if (item.product.category === 'clothing') assert.equal(item.product.type, 'field-jacket');
  }
  assert.equal(result.items[0].variant.colors[0].name, 'olive', 'the color asked for leads');
  const strapsOnly = recommend(engineInput(person, { mode: 'similar', constraints: { types: ['strap'] }, limit: 24 }));
  assert.ok(strapsOnly.items.length && strapsOnly.items.every((i) => i.product.type === 'strap'));
});

test('chips rebuild the same constraints, and dropping a chip drops its constraint', () => {
  for (const text of ['olive sneakers under $150 for work', 'a 20mm leather strap', 'earth tones, minimal, around $200', 'grey trousers 32x32 no black']) {
    const r = parseRequest(text);
    assert.deepEqual(constraintsFromChips(r.chips), r.constraints, text);
  }
  const r = parseRequest('olive sneakers under $150 for work');
  const withoutPrice = constraintsFromChips(r.chips.filter((c) => c.kind !== 'price'));
  assert.equal(withoutPrice.maxPriceMinor, undefined);
  assert.equal(withoutPrice.category, 'sneaker');
});

test('seed hints resolve against the person’s own items only', () => {
  const person = fixturePerson();
  const [jacket] = resolveSeedHints(['navy jacket'], person.owned, { catalog: person.catalog });
  assert.deepEqual(jacket, { hint: 'navy jacket', itemIds: ['own_jacket'], exact: true });
  assert.deepEqual(resolveSeedHints(['white sneakers'], person.owned, { catalog: person.catalog })[0].itemIds, ['own_sneaker']);
  assert.deepEqual(resolveSeedHints(['watch'], person.owned, { catalog: person.catalog })[0].itemIds, ['own_watch']);
  assert.deepEqual(resolveSeedHints(['grey trousers'], person.owned, { catalog: person.catalog })[0].itemIds, ['own_trouser']);
  const loose = resolveSeedHints(['blue jacket'], person.owned, { catalog: person.catalog })[0];
  assert.deepEqual(loose, { hint: 'blue jacket', itemIds: ['own_jacket'], exact: false }, 'the only jacket, read loosely and said so');
  assert.deepEqual(resolveSeedHints(['red hat'], person.owned, { catalog: person.catalog })[0].itemIds, []);
  assert.deepEqual(resolveSeedHints(['black sneakers'], [], { catalog: person.catalog })[0].itemIds, []);
});

// ---------- API: the brief end to end on the demo catalog plus fixture products ----------

async function envWithFixtures() {
  const env = await createTestEnv();
  const data = fixtureData('x');
  // Only products the demo catalog doesn't have; the demo person keeps their real items.
  const keep = new Set(['x-trail', 'x-luxe', 'x-used', 'x-stale', 'x-quiet', 'x-chino', 'x-tee', 'x-leather-strap', 'x-canvas-strap', 'x-fitted-strap', 'x-diver']);
  const products = data.products.filter((p) => keep.has(p.id));
  const productIds = new Set(products.map((p) => p.id));
  const variants = data.variants.filter((v) => productIds.has(v.productId));
  const variantIds = new Set(variants.map((v) => v.id));
  await env.db.bulkPut('catalogBrands', data.brands);
  await env.db.bulkPut('catalogProducts', products);
  await env.db.bulkPut('catalogVariants', variants);
  await env.db.bulkPut('catalogImages', variants.map((v) => image(v.id)));
  await env.db.bulkPut('offers', data.offers.filter((o) => variantIds.has(o.variantId)));
  env.api.invalidateCatalog();
  const catalog = await loadCatalog(env.db);
  const alex = await env.as(ALEX);
  const alexOwned = await env.db.where('ownedItems', 'userId', ALEX);
  const alexWish = await env.db.where('wishlistItems', 'userId', ALEX);
  const samOwned = await env.db.where('ownedItems', 'userId', SAM);
  const samWish = await env.db.where('wishlistItems', 'userId', SAM);
  return {
    ...env,
    catalog,
    alex,
    alexOwned,
    alexWish,
    alexIds: new Set([...alexOwned, ...alexWish].map((r) => r.id)),
    samIds: new Set([...samOwned, ...samWish].map((r) => r.id)),
    samOwned,
    samWish,
  };
}

test('the brief: Alex gets olive and earth-tone matches that respect budget and size', async () => {
  const env = await envWithFixtures();
  const { api, alex, alexOwned, alexWish, catalog, alexIds } = env;
  const ownedVariants = new Set(alexOwned.map((o) => o.variantId));
  const jacket = alexOwned.find((o) => o.variantId === 'harbor-pine-deck-jacket--navy');
  const trousers = alexOwned.find((o) => o.variantId === 'fieldhouse-wool-trouser--grey');

  const matching = await api.recommend(alex, { mode: 'matching', constraints: { maxPriceMinor: 15000 }, limit: 24 });
  assert.ok(matching.requestId);
  assertGrounded(matching, { catalog, itemIds: alexIds });
  assert.ok(matching.items.length >= 2);
  assert.ok(matching.items.every((i) => !ownedVariants.has(i.variantId)), 'nothing Alex already owns');
  assert.ok(matching.excluded.owned >= 1);
  for (const item of matching.items) {
    assert.ok(item.price.fromMinor != null && item.price.fromMinor <= 15000);
    if (item.product.category === 'sneaker') {
      assert.deepEqual(item.size, { value: '10', system: 'US-M' });
      assert.equal(item.availability, 'in_stock_in_size');
    }
  }
  const earthy = matching.items.filter((i) => ['olive', 'khaki', 'tan', 'brown', 'rust'].includes(i.variant.colors[0].name));
  assert.ok(earthy.length >= 2, 'olive and earth-tone catalog products');
  const withJacket = earthy.find((i) => i.related.some((r) => r.itemId === jacket.id));
  assert.ok(withJacket, 'an earth-tone match names the navy jacket');
  assert.match(withJacket.related.find((r) => r.itemId === jacket.id).detail, /navy/);
  assert.match(withJacket.explanation, /your Harbor & Pine Deck Field Jacket/);
  assert.ok(earthy.some((i) => i.related.some((r) => r.itemId === trousers.id)), 'and the grey trousers');
  const strap = matching.items.find((i) => i.variantId === 'x-leather-strap--brown-20');
  assert.ok(strap, 'a 20 mm strap fits the steel Arden Field by catalog specs');
  assert.match(strap.related[0].detail, /^Fits your Arden Field: both 20 mm with standard spring bars, from catalog specs\.$/);
  assert.ok(!matching.items.some((i) => i.variantId === 'x-leather-strap--tan-22'));

  const withOwned = await api.recommend(alex, { mode: 'matching', constraints: { includeOwned: true }, limit: 24 });
  assert.ok(withOwned.items.some((i) => ownedVariants.has(i.variantId) && i.flags.owned && i.kind === 'potential_duplicate'));

  const wish = alexWish[0];
  const alternatives = await api.recommend(alex, { mode: 'alternatives', seedIds: [wish.id], seedType: 'wishlist' });
  assertGrounded(alternatives, { catalog, itemIds: alexIds });
  assert.ok(alternatives.items.length >= 1);
  for (const item of alternatives.items) {
    assert.equal(item.product.category, 'sneaker');
    assert.ok(item.price.fromMinor <= 15000);
    assert.equal(item.availability, 'in_stock_in_size');
    assert.equal(item.related[0].itemId, wish.id);
  }
  assert.ok(alternatives.items.some((i) => ['olive', 'khaki', 'tan', 'brown', 'rust'].includes(i.variant.colors[0].name)));
  const stored = await env.db.get('recRequests', alternatives.requestId);
  assert.equal(stored.userId, ALEX);
  assert.deepEqual(stored.resultIds, ids(alternatives));
  const events = await env.db.where('events', 'type', 'recs_served');
  assert.ok(events.length >= 3);
  assert.ok(events.every((e) => !JSON.stringify(e).includes(ALEX)), 'metrics carry no user ids');
});

test('the demo catalog alone: every mode stays grounded', async () => {
  const env = await createTestEnv();
  const alex = await env.as(ALEX);
  const catalog = await loadCatalog(env.db);
  const owned = await env.db.where('ownedItems', 'userId', ALEX);
  const wish = await env.db.where('wishlistItems', 'userId', ALEX);
  const itemIds = new Set([...owned, ...wish].map((r) => r.id));
  const checks = [
    await env.api.recommend(alex, { mode: 'matching' }),
    await env.api.recommend(alex, { mode: 'matching', seedIds: [owned[0].id] }),
    await env.api.recommend(alex, { mode: 'similar', seedIds: [owned[0].id] }),
    await env.api.recommend(alex, { mode: 'similar', seedIds: ['kestrel-runner-2--navy-white'], seedType: 'variant' }),
    await env.api.recommend(alex, { mode: 'alternatives', seedIds: [wish[0].id] }),
    await env.api.recommend(alex, { text: 'earth tones, minimal, around $200' }),
  ];
  for (const result of checks) {
    assertGrounded(result, { catalog, itemIds });
    if (!result.items.length) assert.ok(result.emptyReason);
  }
  const feedResult = await env.api.recommend(alex, { mode: 'feed' });
  for (const section of feedResult.sections) assertGrounded(section, { catalog, itemIds });
  assert.equal(staticCatalog().version, catalog.version);
});

test('Sam’s items never reach Alex, and ids from another account are not found', async () => {
  const env = await envWithFixtures();
  const { api, alex, samIds, samOwned, samWish, alexIds } = env;
  const results = [
    await api.recommend(alex, { mode: 'feed' }),
    await api.recommend(alex, { mode: 'matching', limit: 24 }),
    await api.recommend(alex, { mode: 'similar', seedIds: [env.alexOwned[0].id], limit: 24 }),
    await api.recommend(alex, { text: 'something to go with my black sneakers' }),
  ];
  for (const result of results) {
    const text = JSON.stringify(result);
    for (const id of samIds) assert.ok(!text.includes(id), `Sam's ${id} leaked`);
    assert.ok(!text.includes('Anniversary gift'), "Sam's notes leaked");
    assert.ok(!text.includes('usr_demo_sam'));
    const sections = result.sections ?? [result];
    for (const s of sections) for (const item of s.items) for (const r of item.related) assert.ok(alexIds.has(r.itemId));
  }
  const parsed = await api.parseRequest(alex, { text: 'something to go with my black sneakers' });
  assert.deepEqual(parsed.seeds, [], 'only Sam owns black sneakers');
  assert.deepEqual(parsed.unresolvedHints, ['black sneakers']);

  await rejectsWith(api.recommend(alex, { mode: 'matching', seedIds: [samOwned[0].id] }), 'not_found');
  await rejectsWith(api.recommend(alex, { mode: 'matching', seedIds: [samOwned[0].id], seedType: 'owned' }), 'not_found');
  await rejectsWith(api.recommend(alex, { mode: 'alternatives', seedIds: [samWish[0].id] }), 'not_found');
  await rejectsWith(api.helpMeChoose(alex, { wishlistIds: [samWish[0].id] }), 'not_found');
  await rejectsWith(api.giveFeedback(alex, { productId: 'vela-court-low', type: 'too_similar', contextItemId: samOwned[0].id }), 'not_found');
  const sam = await env.as(SAM);
  const samFeedback = await api.giveFeedback(sam, { productId: 'vela-court-low', type: 'wrong_style' });
  await rejectsWith(api.removeFeedback(alex, { feedbackId: samFeedback.id }), 'not_found');
  assert.deepEqual(await api.listFeedback(alex, {}), []);
  const alexMatching = await api.recommend(alex, { mode: 'matching', limit: 24 });
  assert.equal(alexMatching.excluded.dismissed, 0, "Sam's feedback doesn't change Alex's results");
});

test('feedback through the API changes results and can be removed', async () => {
  const env = await envWithFixtures();
  const { api, alex } = env;
  const before = await api.recommend(alex, { mode: 'matching', limit: 24 });
  const top = before.items[0];
  const fb = await api.giveFeedback(alex, { productId: top.productId, variantId: top.variantId, type: 'wrong_style', requestId: before.requestId });
  assert.equal(fb.active, true);
  assert.equal(fb.label, 'Not my style');
  assert.equal(fb.product.id, top.productId);
  const again = await api.giveFeedback(alex, { productId: top.productId, type: 'wrong_style' });
  assert.equal(again.id, fb.id, 'the same feedback twice is one record');

  const during = await api.recommend(alex, { mode: 'matching', limit: 24 });
  assert.ok(!during.items.some((i) => i.productId === top.productId));
  assert.ok(during.excluded.dismissed >= 1);
  const listed = await api.listFeedback(alex, {});
  assert.deepEqual(listed.map((f) => f.id), [fb.id]);

  assert.deepEqual(await api.removeFeedback(alex, { feedbackId: fb.id }), { ok: true });
  assert.deepEqual(await api.listFeedback(alex, {}), []);
  assert.equal((await api.listFeedback(alex, { includeInactive: true }))[0].active, false);
  const after = await api.recommend(alex, { mode: 'matching', limit: 24 });
  assert.deepEqual(after.items, before.items, 'results return to what they were');

  // Opposite signals: the newest wins.
  const like = await api.giveFeedback(alex, { productId: top.productId, type: 'more_like_this' });
  await api.giveFeedback(alex, { productId: top.productId, type: 'wrong_style' });
  const active = await api.listFeedback(alex, {});
  assert.deepEqual(active.map((f) => f.type), ['wrong_style']);
  assert.ok(!active.some((f) => f.id === like.id));

  await rejectsWith(api.giveFeedback(alex, { productId: 'not-a-product', type: 'wrong_style' }), 'not_found');
  await rejectsWith(api.giveFeedback(alex, { productId: top.productId, type: 'meh' }), 'invalid');
  await rejectsWith(api.giveFeedback(alex, { productId: top.productId, variantId: 'arden-field--af38-sl-bk', type: 'saved' }), 'invalid');
  await rejectsWith(api.removeFeedback(alex, { feedbackId: 'fb_missing' }), 'not_found');
});

test('stored ranking weights change the ranking', async () => {
  const env = await envWithFixtures();
  const base = await env.api.recommend(env.alex, { mode: 'matching', limit: 24 });
  await env.db.put('config', { key: 'rankingWeights', value: { harmony: 0, style: 0, color: 3, budget: 0, use: 0 } });
  const tuned = await env.api.recommend(env.alex, { mode: 'matching', limit: 24 });
  assert.notDeepEqual(tuned.items.map((i) => i.score), base.items.map((i) => i.score));
  const top = tuned.items[0];
  assert.ok(top.variant.colors.some((c) => ['olive', 'navy', 'grey', 'white'].includes(c.name)), 'liked colors lead when color carries the weight');
});

test('parseRequest operation resolves "my navy jacket" to Alex’s own jacket', async () => {
  const env = await envWithFixtures();
  const { api, alex, alexOwned } = env;
  const jacket = alexOwned.find((o) => o.variantId === 'harbor-pine-deck-jacket--navy');
  const parsed = await api.parseRequest(alex, { text: 'something to go with my navy jacket under $200' });
  assert.deepEqual(parsed.seedIds, [jacket.id]);
  assert.equal(parsed.suggestedMode, 'matching');
  assert.equal(parsed.seeds[0].title, 'Deck Field Jacket');
  assert.equal(parsed.chips[0].label, 'Goes with your Harbor & Pine Deck Field Jacket');
  assert.equal(parsed.constraints.maxPriceMinor, 20000);
  await rejectsWith(api.parseRequest(alex, { text: '   ' }), 'invalid');

  const typed = await api.recommend(alex, { text: 'something to go with my navy jacket under $200' });
  assert.equal(typed.mode, 'matching');
  assert.ok(typed.interpretation.chips.length >= 2);
  assert.ok(typed.items.length >= 1);
  for (const item of typed.items) {
    assert.ok(item.related.some((r) => r.itemId === jacket.id), 'each result goes with the jacket');
    assert.ok(item.price.fromMinor <= 20000);
    assert.notEqual(item.product.type, 'field-jacket');
  }
  const strap = await api.recommend(alex, { text: 'a 20mm leather strap' });
  assert.ok(strap.items.length >= 1);
  for (const item of strap.items) {
    assert.equal(item.product.type, 'strap');
    assert.equal(item.variant.attributes.strapWidthMm, 20);
  }
});

test('help me choose through the API: limits and grounding', async () => {
  const env = await envWithFixtures();
  const { api, alex, alexWish, db, catalog } = env;
  await rejectsWith(api.helpMeChoose(alex, { wishlistIds: [] }), 'invalid');
  const extra = [
    { ...alexWish[0], id: 'wish_fx_trail', variantId: 'x-trail--olive-gum', productId: 'x-trail', targetPriceMinor: 10000 },
    { ...alexWish[0], id: 'wish_fx_luxe', variantId: 'x-luxe--tan', productId: 'x-luxe', targetPriceMinor: null },
    { ...alexWish[0], id: 'wish_fx_quiet', variantId: 'x-quiet--tan', productId: 'x-quiet', targetPriceMinor: 12000 },
  ];
  await db.bulkPut('wishlistItems', extra);
  await rejectsWith(api.helpMeChoose(alex, { wishlistIds: [alexWish[0].id, ...extra.map((e) => e.id)] }), 'invalid');
  const result = await api.helpMeChoose(alex, { wishlistIds: [alexWish[0].id, 'wish_fx_trail', 'wish_fx_luxe'] });
  assert.equal(result.items.length, 3);
  const byWish = Object.fromEntries(result.items.map((i) => [i.wishId, i]));
  assert.equal(byWish.wish_fx_trail.budget.status, 'over');
  assert.equal(byWish.wish_fx_trail.budget.differenceMinor, 1800);
  assert.equal(byWish.wish_fx_luxe.budget.status, 'over', 'no target: compared with the $150 sneaker budget');
  assert.equal(byWish[alexWish[0].id].budget.status, 'within');
  for (const item of result.items) {
    assert.equal(item.view.id, item.wishId);
    const variantId = item.view.variantId;
    assert.ok(offerPrices(catalog, { variantId, size: item.size }, 'new_only').includes(item.price.fromMinor));
    for (const r of [...item.pairsWith, ...item.similarOwned]) assert.ok(env.alexIds.has(r.itemId));
  }
  assert.ok(result.summary.length >= 3);
  assert.doesNotMatch(result.summary.join(' '), /%|\bscore/i);
  assert.match(result.summary.join(' '), /fits its \$150 target/);
});

test('offers provider down: recommendations say prices could not be checked', async () => {
  const env = await createTestEnv();
  const alex = await env.as(ALEX);
  await env.db.put('config', { key: 'providerSimulation', value: { vision: 'ok', offers: 'down', ocr: 'ok' } });
  const error = await rejectsWith(env.api.recommend(alex, { mode: 'feed' }), 'unavailable');
  assert.match(error.message, /could not be checked/);
  const wish = await env.db.where('wishlistItems', 'userId', ALEX);
  await rejectsWith(env.api.helpMeChoose(alex, { wishlistIds: [wish[0].id] }), 'unavailable');
});

test('recommend validates its arguments', async () => {
  const env = await createTestEnv();
  const alex = await env.as(ALEX);
  await rejectsWith(env.api.recommend(alex, { mode: 'everything' }), 'invalid');
  await rejectsWith(env.api.recommend(alex, { mode: 'alternatives' }), 'invalid');
  await rejectsWith(env.api.recommend(alex, { mode: 'matching', constraints: { maxPriceMinor: -5 } }), 'invalid');
  await rejectsWith(env.api.recommend(alex, { mode: 'matching', constraints: { size: { value: '10', system: 'SHOE' } } }), 'invalid');
  await rejectsWith(env.api.recommend(alex, { mode: 'similar', seedIds: ['no-such-variant'], seedType: 'variant' }), 'not_found');
  await rejectsWith(env.api.recommend({ token: 'nope' }, { mode: 'feed' }), 'unauthenticated');
  const jordan = await env.as('usr_demo_jordan');
  await rejectsWith(env.api.recommend(jordan, { mode: 'feed' }), 'forbidden');
});

test('cold start through the API: a new account gets profile picks', async () => {
  const env = await createTestEnv();
  const created = await env.api.signUp({}, { email: 'new@example.com', password: 'long enough pass', displayName: 'New Person' });
  const call = { token: created.token };
  await env.api.completeOnboarding(call, { styles: ['minimal', 'classic'], colorsLiked: ['navy', 'white'], categories: ['sneaker', 'watch'], budgets: { watch: 60000 } });
  const result = await env.api.recommend(call, { mode: 'feed' });
  assert.equal(result.coldStart, true);
  assert.ok(result.sections.length >= 1);
  for (const section of result.sections) {
    assert.ok(section.id.startsWith('picks-'));
    for (const item of section.items) {
      assert.ok(['sneaker', 'watch'].includes(item.product.category));
      assert.equal(item.related.length, 0);
    }
  }
  const matching = await env.api.recommend(call, { mode: 'matching' });
  assert.equal(matching.items.length, 0);
  assert.equal(matching.emptyReason, 'Add items to your collection to see what goes with them.');
});
