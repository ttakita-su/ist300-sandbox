// Recommendations, wishlist comparison, feedback and typed-request parsing. Only the actor's
// own records are read (owned items, wishlist, profile, feedback); catalog facts and offers
// are shared. Ranking weights come from config so admins can tune them without a deploy.
import { ApiError, invalid, notFound } from '../errors.js';
import { isOwner } from '../policy.js';
import { newId } from '../../lib/ids.js';
import { listJoin } from '../../lib/format.js';
import { defaultProfile } from '../records.js';
import { productSummary, variantView, ownedView, wishlistView, copyCounts } from '../views.js';
import { recommend, feed, helpMeChoose, normalizeWeights } from '../../engine/recommend.js';
import { parseRequest, resolveSeedHints } from '../../engine/parse-request.js';
import {
  CATEGORIES,
  FEEDBACK_TYPES,
  FEEDBACK_LABEL,
  WISH_CONDITIONS,
  SIZE_SYSTEMS,
  STYLE_TAGS,
  INTENDED_USES,
  PRODUCT_TYPES,
  validateSize,
} from '../../data/schema.js';
import { COLOR_BY_NAME } from '../../data/colors.js';

const MODES = ['similar', 'matching', 'alternatives', 'feed'];
const SEED_TYPES = ['owned', 'wishlist', 'variant'];
const ALL_TYPES = new Set(Object.values(PRODUCT_TYPES).flat());
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 24;
const MAX_TEXT = 300;
const OFFERS_DOWN = 'Retailer prices could not be checked right now. Try again shortly.';

// Opposite signals about one product can't both stand; the newest one wins.
const OPPOSITES = {
  more_like_this: ['wrong_style', 'too_similar'],
  wrong_style: ['more_like_this', 'saved'],
  too_similar: ['more_like_this'],
  saved: ['wrong_style'],
  too_expensive: [],
};

const vocabCache = new WeakMap();
/** Parser vocabulary for a catalog (brand names), cached so phrase tables are built once. */
function vocabFor(catalog) {
  if (!vocabCache.has(catalog)) vocabCache.set(catalog, { brands: [...catalog.brands.values()].map((b) => ({ id: b.id, name: b.name })) });
  return vocabCache.get(catalog);
}

async function loadActorData(ctx) {
  const userId = ctx.actor.id;
  const [owned, wishlist, profile, feedback] = await Promise.all([
    ctx.db.where('ownedItems', 'userId', userId),
    ctx.db.where('wishlistItems', 'userId', userId),
    ctx.db.get('profiles', userId),
    ctx.db.where('feedback', 'userId', userId),
  ]);
  // The index lookup already scopes by user; the policy check keeps that true if it changes.
  return {
    owned: owned.filter((r) => isOwner(ctx.actor, r)),
    wishlist: wishlist.filter((r) => isOwner(ctx.actor, r)),
    profile: profile && isOwner(ctx.actor, profile) ? profile : defaultProfile(userId),
    feedback: feedback.filter((r) => isOwner(ctx.actor, r) && r.active),
  };
}

function makeViews(catalog, now, owned) {
  const copies = copyCounts(owned);
  return {
    product: (p) => productSummary(catalog, p),
    variant: (v) => variantView(catalog, v, { now, context: 'product' }),
    owned: (item) => ownedView(catalog, item, { now, copies: item.variantId ? copies.get(item.variantId) ?? 1 : 1 }),
    wishlist: (item) => wishlistView(catalog, item, { now }),
  };
}

async function assertOffersAvailable(ctx) {
  const simulation = await ctx.config.get('providerSimulation');
  if (simulation?.offers === 'down') throw new ApiError('unavailable', OFFERS_DOWN);
}

async function engineEnv(ctx, catalog, data) {
  const now = ctx.now();
  const freshness = await ctx.config.get('offerFreshnessHours');
  return {
    catalog,
    now,
    owned: data.owned,
    wishlist: data.wishlist,
    profile: data.profile,
    feedback: data.feedback,
    weights: normalizeWeights(await ctx.config.get('rankingWeights')),
    freshnessHours: Number.isFinite(freshness) && freshness > 0 ? freshness : undefined,
    offersFor: (variantId) => ctx.providers.offers.list(catalog, variantId, now),
    views: makeViews(catalog, now, data.owned),
  };
}

const SIZE_CATEGORY = { 'US-M': 'sneaker', 'US-W': 'sneaker', EU: 'sneaker', UK: 'sneaker', ALPHA: 'clothing', 'WAIST-INSEAM': 'clothing', 'ONE-SIZE': 'watch' };

/** Validates request constraints; unknown values are rejected rather than silently dropped. */
export function sanitizeConstraints(raw, catalog) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  const errors = {};
  if (c.category != null && c.category !== '') {
    if (CATEGORIES.includes(c.category)) out.category = c.category;
    else errors['constraints.category'] = 'Choose sneakers, watches or clothing';
  }
  if (Array.isArray(c.categories) && c.categories.length) {
    const list = c.categories.filter((x) => CATEGORIES.includes(x));
    if (list.length !== c.categories.length) errors['constraints.categories'] = 'Choose sneakers, watches or clothing';
    else out.categories = [...new Set(list)];
  }
  if (Array.isArray(c.types) && c.types.length) {
    const list = c.types.filter((t) => ALL_TYPES.has(t));
    if (list.length !== c.types.length) errors['constraints.types'] = 'Choose types from the catalog list';
    else out.types = [...new Set(list)];
  }
  for (const key of ['maxPriceMinor', 'minPriceMinor', 'priceAroundMinor']) {
    if (c[key] == null || c[key] === '') continue;
    const v = Number(c[key]);
    if (!Number.isInteger(v) || v <= 0 || v > 100000000) errors[`constraints.${key}`] = 'Enter a price above zero';
    else out[key] = v;
  }
  if (out.minPriceMinor != null && out.maxPriceMinor != null && out.minPriceMinor > out.maxPriceMinor) {
    errors['constraints.minPriceMinor'] = 'The lowest price must be below the highest';
  }
  if (c.size != null && c.size !== '') {
    const size = { value: String(c.size?.value ?? '').trim(), system: c.size?.system };
    const problem = SIZE_SYSTEMS.includes(size.system) ? validateSize(size, SIZE_CATEGORY[size.system]) : 'Choose a sizing system';
    if (problem) errors['constraints.size'] = problem;
    else out.size = size;
  }
  if (c.condition != null && c.condition !== '') {
    if (WISH_CONDITIONS.includes(c.condition)) out.condition = c.condition;
    else errors['constraints.condition'] = 'Choose new only, or new or used';
  }
  for (const key of ['inStockOnly', 'includeOwned', 'includeUnknownPrice', 'anySize', 'exploreColorways']) {
    if (c[key] === true) out[key] = true;
  }
  for (const [key, min, max] of [['strapWidthMm', 8, 30], ['caseDiameterMm', 20, 60]]) {
    if (c[key] == null || c[key] === '') continue;
    const v = Number(c[key]);
    if (!Number.isFinite(v) || v < min || v > max) errors[`constraints.${key}`] = `Enter a width between ${min} and ${max} mm`;
    else out[key] = v;
  }
  const list = (key, ok) => {
    if (!Array.isArray(c[key]) || !c[key].length) return;
    const values = [...new Set(c[key].filter((x) => typeof x === 'string' && ok(x)))];
    if (values.length) out[key] = values.slice(0, 10);
  };
  list('colors', (x) => COLOR_BY_NAME.has(x));
  list('avoidColors', (x) => COLOR_BY_NAME.has(x));
  list('styles', (x) => STYLE_TAGS.includes(x));
  list('avoidStyles', (x) => STYLE_TAGS.includes(x));
  list('uses', (x) => INTENDED_USES.includes(x));
  list('materials', (x) => x.trim().length > 0 && x.length <= 30);
  list('brandIds', (x) => Boolean(catalog.brand(x)));
  if (Object.keys(errors).length) throw invalid(errors);
  return out;
}

function inferSeedType(id) {
  if (id.startsWith('own_')) return 'owned';
  if (id.startsWith('wish_')) return 'wishlist';
  return 'variant';
}

/** Seeds must be the actor's own records (or catalog versions); anything else is not_found. */
async function resolveSeeds(ctx, catalog, seedIds, seedType) {
  if (seedType != null && !SEED_TYPES.includes(seedType)) throw invalid({ seedType: 'Choose owned, wishlist or variant' });
  const seeds = [];
  for (const id of seedIds) {
    const type = seedType ?? inferSeedType(id);
    if (type === 'variant') {
      const variant = catalog.variant(id);
      if (!variant) throw notFound('That version');
      seeds.push({ type, record: variant });
      continue;
    }
    const record = await ctx.db.get(type === 'owned' ? 'ownedItems' : 'wishlistItems', id);
    if (!record || !isOwner(ctx.actor, record) || record.status === 'removed') throw notFound('That item');
    seeds.push({ type, record });
  }
  return seeds;
}

function itemImage(view) {
  const image = view?.image ?? null;
  return {
    imageUrl: image?.kind === 'catalog' ? image.url ?? null : null,
    // Photos and store images saved on this device are hydrated by id (getPhotoUrl).
    photoId: image && ['original', 'cleaned', 'web'].includes(image.kind) ? image.photoId ?? null : null,
  };
}

/** Reads typed text into chips and constraints, and resolves "my navy jacket" to owned items. */
function interpret(text, catalog, owned, views) {
  const vocab = vocabFor(catalog);
  const parsed = parseRequest(text, vocab);
  const active = owned.filter((r) => !r.archivedAt);
  const resolved = resolveSeedHints(parsed.seedHints, active, { catalog, vocab });
  const seeds = [];
  const unresolvedHints = [];
  for (const r of resolved) {
    if (!r.itemIds.length) {
      unresolvedHints.push(r.hint);
      continue;
    }
    for (const id of r.itemIds) {
      const item = active.find((o) => o.id === id);
      const view = views.owned(item);
      seeds.push({ hint: r.hint, exact: r.exact, itemId: id, itemType: 'owned', title: view.title, brandName: view.brandName, subtitle: view.subtitle, ...itemImage(view) });
    }
  }
  // Seed chips say which of the person's items the words were read as.
  const chips = parsed.chips.map((chip) => {
    if (chip.kind !== 'seed') return chip;
    const matches = seeds.filter((s) => s.hint === chip.value);
    if (!matches.length) return { ...chip, label: `Goes with your ${chip.value} (no match in your collection)` };
    return { ...chip, label: `Goes with your ${listJoin(matches.map((m) => [m.brandName, m.title].filter(Boolean).join(' ')))}` };
  });
  return {
    constraints: parsed.constraints,
    chips,
    seedHints: parsed.seedHints,
    unparsed: parsed.unparsed,
    seeds,
    unresolvedHints,
    seedIds: [...new Set(seeds.map((s) => s.itemId))],
    suggestedMode: seeds.length ? 'matching' : 'similar',
  };
}

function feedbackView(catalog, fb, now, items) {
  const product = catalog.product(fb.productId);
  const variant = fb.variantId ? catalog.variant(fb.variantId) : null;
  const brand = product ? catalog.brand(product.brandId) : null;
  const context = fb.contextItemId ? items.get(fb.contextItemId) ?? null : null;
  const contextProduct = context?.productId ? catalog.product(context.productId) : null;
  return {
    id: fb.id,
    productId: fb.productId,
    variantId: fb.variantId ?? null,
    type: fb.type,
    contextItemId: fb.contextItemId ?? null,
    createdAt: fb.createdAt,
    active: Boolean(fb.active),
    label: FEEDBACK_LABEL[fb.type] ?? fb.type,
    title: product?.name ?? 'No longer in the catalog',
    brandName: brand?.name ?? '',
    product: product ? productSummary(catalog, product) : null,
    variant: variant && product ? variantView(catalog, variant, { now, context: 'product' }) : null,
    contextItem: context
      ? {
          id: context.id,
          itemType: context.itemType,
          title: contextProduct?.name ?? context.custom?.name ?? 'Untitled item',
          brandName: contextProduct ? catalog.brand(contextProduct.brandId)?.name ?? '' : context.custom?.brand ?? '',
        }
      : null,
  };
}

async function itemIndex(ctx) {
  const [owned, wishlist] = await Promise.all([
    ctx.db.where('ownedItems', 'userId', ctx.actor.id),
    ctx.db.where('wishlistItems', 'userId', ctx.actor.id),
  ]);
  const map = new Map();
  for (const r of owned) if (isOwner(ctx.actor, r)) map.set(r.id, { ...r, itemType: 'owned' });
  for (const r of wishlist) if (isOwner(ctx.actor, r)) map.set(r.id, { ...r, itemType: 'wishlist' });
  return map;
}

export const ops = {
  /**
   * Rate limit: 'recs'.
   * args: { mode: 'similar'|'matching'|'alternatives'|'feed', seedIds?: [itemId], seedType?: 'owned'|'wishlist'|'variant',
   *         category?, constraints?: { maxPriceMinor?, size?: {value, system}, condition?: 'new_only'|'new_or_used',
   *         inStockOnly?: boolean, includeOwned?: boolean, includeUnknownPrice?, anySize?, types?, colors?, ... },
   *         limit?, text?, exploreColorways? }
   * Retrieves real catalog candidates, applies hard constraints, ranks with config weights,
   * diversifies, and explains each result with computed relations to named items.
   * With `text`, the request is parsed (parseRequest) and `interpretation` is added to the
   * result so the screen can show how it was read; explicit constraints win over parsed ones.
   * result: RecResult (see engine/recommend.js), with requestId; mode 'feed' returns
   *   FeedResult { requestId, generatedAt, coldStart, sections }. Stores a recRequest.
   */
  recommend: {
    auth: 'user',
    rateLimit: 'recs',
    async run(ctx, args) {
      const catalog = await ctx.catalog();
      await assertOffersAvailable(ctx);
      const data = await loadActorData(ctx);
      const env = await engineEnv(ctx, catalog, data);

      let constraints = sanitizeConstraints(args.constraints, catalog);
      if (args.category != null && args.category !== '' && !constraints.category) {
        constraints = { ...constraints, ...sanitizeConstraints({ category: args.category }, catalog) };
      }
      let seedIds = Array.isArray(args.seedIds) ? [...new Set(args.seedIds.filter((s) => typeof s === 'string' && s))].slice(0, 10) : [];
      let seedType = args.seedType ?? null;
      let interpretation = null;
      if (args.text != null && String(args.text).trim()) {
        const text = String(args.text).trim();
        if (text.length > MAX_TEXT) throw invalid({ text: `Keep it under ${MAX_TEXT} characters` });
        interpretation = interpret(text, catalog, data.owned, env.views);
        constraints = { ...sanitizeConstraints(interpretation.constraints, catalog), ...constraints };
        if (!seedIds.length && interpretation.seedIds.length) {
          seedIds = interpretation.seedIds;
          seedType = 'owned';
        }
      }
      const mode = args.mode ?? (interpretation ? interpretation.suggestedMode : 'feed');
      if (!MODES.includes(mode)) throw invalid({ mode: 'Choose similar, matching, alternatives or feed' });
      const seeds = mode === 'feed' ? [] : await resolveSeeds(ctx, catalog, seedIds, seedType);
      if (mode === 'alternatives' && !seeds.some((s) => s.type === 'wishlist' || s.type === 'variant')) {
        throw invalid({ seedIds: 'Choose a wishlist item to find alternatives for' }, 'Choose a wishlist item to find alternatives for.');
      }
      const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(args.limit, 10) || DEFAULT_LIMIT));
      const requestId = newId('rec');
      const input = { ...env, mode, seeds, constraints, limit, requestId, exploreColorways: Boolean(args.exploreColorways ?? constraints.exploreColorways) };
      const result = mode === 'feed' ? feed(input) : recommend(input);

      const resultIds = mode === 'feed' ? result.sections.flatMap((s) => s.items.map((i) => i.variantId)) : result.items.map((i) => i.variantId);
      await ctx.db.put('recRequests', {
        id: requestId,
        userId: ctx.actor.id,
        mode,
        seedIds: seeds.map((s) => s.record.id),
        constraints,
        resultIds,
        createdAt: ctx.iso(),
      });
      await ctx.metric('recs_served', {
        mode,
        items: resultIds.length,
        empty: resultIds.length === 0,
        relaxations: mode === 'feed' ? 0 : result.relaxations.length,
        coldStart: mode === 'feed' ? result.coldStart : undefined,
        typed: Boolean(interpretation),
      });
      return interpretation ? { ...result, interpretation } : result;
    },
  },

  /**
   * Compare up to three wishlist items. args: { wishlistIds: [id] } -> Comparison
   * Same facts for each: price from offers in the wanted size and condition, fit with the
   * target (or profile budget), pairings with owned items and close lookalikes already owned.
   */
  helpMeChoose: {
    auth: 'user',
    rateLimit: 'recs',
    async run(ctx, args) {
      const ids = Array.isArray(args.wishlistIds) ? [...new Set(args.wishlistIds.filter((x) => typeof x === 'string' && x))] : [];
      if (!ids.length || ids.length > 3) {
        throw invalid({ wishlistIds: 'Choose one to three wishlist items' }, 'Choose up to three wishlist items to compare.');
      }
      const catalog = await ctx.catalog();
      await assertOffersAvailable(ctx);
      const wishItems = [];
      for (const id of ids) {
        const record = await ctx.db.get('wishlistItems', id);
        if (!record || !isOwner(ctx.actor, record) || record.status === 'removed') throw notFound('That wishlist item');
        wishItems.push(record);
      }
      const data = await loadActorData(ctx);
      const env = await engineEnv(ctx, catalog, data);
      const result = helpMeChoose({ ...env, wishItems });
      await ctx.metric('compare_served', { items: wishItems.length });
      return result;
    },
  },

  /** args: { productId, variantId?, type: FEEDBACK, contextItemId?, requestId?, idempotencyKey? } -> feedback view */
  giveFeedback: {
    auth: 'user',
    idempotent: true,
    async run(ctx, args) {
      if (!FEEDBACK_TYPES.includes(args.type)) throw invalid({ type: 'Choose a feedback option' });
      const catalog = await ctx.catalog();
      const product = typeof args.productId === 'string' ? catalog.product(args.productId) : null;
      if (!product) throw notFound('That product');
      let variantId = null;
      if (args.variantId != null && args.variantId !== '') {
        const variant = catalog.variant(args.variantId);
        if (!variant || variant.productId !== product.id) throw invalid({ variantId: 'That version does not belong to this product' });
        variantId = variant.id;
      }
      const items = await itemIndex(ctx);
      let contextItemId = null;
      if (args.contextItemId != null && args.contextItemId !== '') {
        if (!items.has(args.contextItemId)) throw notFound('That item');
        contextItemId = args.contextItemId;
      }
      let mode = null;
      if (args.requestId) {
        const request = await ctx.db.get('recRequests', args.requestId);
        if (!request || !isOwner(ctx.actor, request)) throw notFound('That recommendation');
        mode = request.mode;
      }
      const mine = (await ctx.db.where('feedback', 'userId', ctx.actor.id)).filter((f) => isOwner(ctx.actor, f));
      const same = mine.find((f) => f.active && f.productId === product.id && f.type === args.type && (f.contextItemId ?? null) === contextItemId);
      if (same) return feedbackView(catalog, same, ctx.now(), items);
      for (const f of mine) {
        if (f.active && f.productId === product.id && OPPOSITES[args.type].includes(f.type)) await ctx.db.put('feedback', { ...f, active: false });
      }
      const record = {
        id: newId('fb'),
        userId: ctx.actor.id,
        productId: product.id,
        variantId,
        type: args.type,
        contextItemId,
        createdAt: ctx.iso(),
        active: true,
      };
      await ctx.db.put('feedback', record);
      await ctx.metric('rec_feedback', { type: args.type, mode });
      return feedbackView(catalog, record, ctx.now(), items);
    },
  },

  /** args: { includeInactive?: boolean } -> [feedback view with product label], newest first (active only by default) */
  listFeedback: {
    auth: 'user',
    async run(ctx, args = {}) {
      const catalog = await ctx.catalog();
      const items = await itemIndex(ctx);
      const rows = (await ctx.db.where('feedback', 'userId', ctx.actor.id)).filter((f) => isOwner(ctx.actor, f) && (args.includeInactive || f.active));
      rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
      const now = ctx.now();
      return rows.map((f) => feedbackView(catalog, f, now, items));
    },
  },

  /** args: { feedbackId } -> { ok: true } (sets active false; later recommendations ignore it) */
  removeFeedback: {
    auth: 'user',
    async run(ctx, args) {
      const fb = typeof args.feedbackId === 'string' ? await ctx.db.get('feedback', args.feedbackId) : null;
      if (!fb || !isOwner(ctx.actor, fb)) throw notFound('That feedback');
      if (fb.active) {
        await ctx.db.put('feedback', { ...fb, active: false });
        await ctx.metric('rec_feedback_removed', { type: fb.type });
      }
      return { ok: true };
    },
  },

  /**
   * Rule-based interpretation of a typed request. args: { text }
   * -> { constraints, chips, seedHints, unparsed, seeds: [{ hint, exact, itemId, itemType, title, brandName,
   *      subtitle, imageUrl, photoId }], unresolvedHints, seedIds, suggestedMode }
   * Seed hints ("my navy jacket") resolve only against the actor's own active items.
   */
  parseRequest: {
    auth: 'user',
    async run(ctx, args) {
      const text = String(args.text ?? '').trim();
      if (!text) throw invalid({ text: 'Type what you are looking for' }, 'Type what you are looking for.');
      if (text.length > MAX_TEXT) throw invalid({ text: `Keep it under ${MAX_TEXT} characters` });
      const catalog = await ctx.catalog();
      const owned = (await ctx.db.where('ownedItems', 'userId', ctx.actor.id)).filter((r) => isOwner(ctx.actor, r));
      const result = interpret(text, catalog, owned, makeViews(catalog, ctx.now(), owned));
      await ctx.metric('request_parsed', { chips: result.chips.length, unparsed: result.unparsed.length, seeds: result.seeds.length });
      return result;
    },
  },
};
