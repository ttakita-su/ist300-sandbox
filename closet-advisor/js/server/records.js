// Record builders and input validation shared by inventory, wishlist and matching operations.
import { newId } from '../lib/ids.js';
import { invalid } from './errors.js';
import {
  CATEGORIES,
  OWNED_CONDITIONS,
  WISH_CONDITIONS,
  WISH_REASONS,
  WISH_INTENTS,
  WISH_INTENT_FOR_REASON,
  OUTFIT_LIMITS,
  validateSize,
  RETRIEVAL,
  IDENTITY,
  VARIANT_STATE,
} from '../data/schema.js';
import { COLOR_BY_NAME } from '../data/colors.js';
import { date as formatDate } from '../lib/format.js';

const MAX_NOTES = 2000;
const MAX_TEXT = 120;

/** Images an owned item can show. 'web' is a store image saved on this device (photos.webId). */
export const OWNED_DISPLAYS = ['catalog', 'original', 'cleaned', 'web'];

/** How a web snapshot was found: a store page, a Bing Shopping listing, or Bing visual search. */
export const WEB_VIA = ['page', 'search', 'photo'];
export const WEB_AVAILABILITY = ['in_stock', 'out_of_stock', 'preorder', 'backorder', 'discontinued', 'limited'];
const MAX_PRICE_MINOR = 1e9;

export function iso(ms) {
  return new Date(ms).toISOString();
}

/** A link stored with an item for reference. Never fetched; rendered through safeUrl. */
export function cleanLinkUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 2048) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  return url.toString();
}

/** The host people recognize: lowercase, without "www.". */
export function displayHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

// C0 and C1 controls, DEL, zero-width characters, and the bidi marks, embeddings, overrides and
// isolates a page could use to make text read in a different order than it is stored.
const UNSAFE_TEXT = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/**
 * Page text is untrusted: control, zero-width and bidi control characters go, whitespace
 * collapses; '' is null.
 * @param {unknown} value
 * @param {number} max
 * @returns {string|null}
 */
export function cleanWebText(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value)
    .replace(UNSAFE_TEXT, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
  return text || null;
}

/** { amountMinor, currency } with an integer amount and an ISO currency code, else null. */
export function cleanWebPrice(price) {
  if (!price || typeof price !== 'object') return null;
  const amountMinor = price.amountMinor;
  if (!Number.isInteger(amountMinor) || amountMinor < 0 || amountMinor > MAX_PRICE_MINOR) return null;
  if (typeof price.currency !== 'string' || !/^[A-Z]{3}$/.test(price.currency)) return null;
  return { amountMinor, currency: price.currency };
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * When a page was read, as an ISO string: `value` when it is an ISO 8601 date-time with a time
 * zone and no later than a day from now, else now. "0" or "Oct 14 2026" are not dates here.
 * @param {unknown} value
 * @param {number} nowMs
 * @returns {string}
 */
export function webFetchedAt(value, nowMs) {
  const at = typeof value === 'string' && ISO_TIME.test(value) ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) && at <= nowMs + 86400000 ? iso(at) : iso(nowMs);
}

/**
 * Validates and rebuilds a WebSnapshot (ARCHITECTURE.md 4.3: what a store page, listing or
 * visual search said about an item when it was saved). Strings are trimmed and capped, the host
 * is derived from the URL (never taken from input), unknown enum values become null, query is
 * kept only for via 'search' or 'photo', and a fetchedAt that isn't a possible ISO time becomes now. Without a usable http(s) URL there is no snapshot: null.
 * @param {any} input
 * @param {number} nowMs
 * @returns {null | { url, host, siteName, title, brand, price, availability, identifiers: { sku, gtin, mpn },
 *   color, imageUrl, via, query, fetchedAt }}
 */
export function cleanWebSnapshot(input, nowMs) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const url = cleanLinkUrl(input.url);
  if (!url) return null;
  const ids = input.identifiers && typeof input.identifiers === 'object' ? input.identifiers : {};
  const via = WEB_VIA.includes(input.via) ? input.via : null;
  return {
    url,
    host: displayHost(url),
    siteName: cleanWebText(input.siteName, 120),
    title: cleanWebText(input.title, 200),
    brand: cleanWebText(input.brand, 120),
    price: cleanWebPrice(input.price),
    availability: WEB_AVAILABILITY.includes(input.availability) ? input.availability : null,
    identifiers: { sku: cleanWebText(ids.sku, 64), gtin: cleanWebText(ids.gtin, 64), mpn: cleanWebText(ids.mpn, 64) },
    color: cleanWebText(input.color, 120),
    imageUrl: cleanLinkUrl(input.imageUrl),
    via,
    query: via === 'search' || via === 'photo' ? cleanWebText(input.query, 200) : null,
    fetchedAt: webFetchedAt(input.fetchedAt, nowMs),
  };
}

/** Identity block (ARCHITECTURE.md 4.3). Defaults describe a manual record. */
export function makeIdentity(overrides = {}) {
  return {
    retrieval: 'not_run',
    resolution: 'manual',
    variant: 'not_applicable',
    evidence: [],
    conflicts: [],
    confirmedBy: null,
    confirmedAt: null,
    matchJobId: null,
    ...overrides,
  };
}

/** Identity for an item picked from catalog search or a resolved product link. */
export function catalogIdentity({ userId, now, variantId, source = 'catalog_search', detail }) {
  return makeIdentity({
    retrieval: 'not_run',
    resolution: 'user_confirmed',
    variant: variantId ? 'confirmed' : 'incomplete',
    evidence: [
      {
        kind: source === 'product_link' ? 'product_link' : 'catalog_search',
        source: source === 'product_link' ? 'url' : 'catalog',
        detail: detail ?? (source === 'product_link' ? 'Added from a product link' : 'Chosen from catalog search'),
      },
    ],
    confirmedBy: userId,
    confirmedAt: iso(now),
  });
}

export function validateIdentity(identity) {
  const problems = {};
  if (!RETRIEVAL.includes(identity.retrieval)) problems.retrieval = 'Unknown retrieval status';
  if (!IDENTITY.includes(identity.resolution)) problems.resolution = 'Unknown identity resolution';
  if (!VARIANT_STATE.includes(identity.variant)) problems.variant = 'Unknown variant state';
  return problems;
}

/**
 * The evidence line for an item saved from the web: where the details came from and that
 * Rotation didn't check them. `photoFlow`: saved from a photo match (confirmMatch).
 * @param {{ host: string|null, siteName: string|null, via: string|null, fetchedAt: string }} web cleaned snapshot
 */
export function webEvidence(web, { photoFlow = false } = {}) {
  const on = formatDate(web.fetchedAt);
  let detail;
  if (photoFlow || web.via === 'photo') detail = `Found with Bing visual search from your photo on ${on}; you chose it.`;
  else if (web.via === 'search') detail = `Picked from a Bing Shopping listing${web.siteName ? ` (${web.siteName})` : ''} on ${on}; not checked by Rotation.`;
  else detail = `Details from ${web.host ?? 'a store page'} on ${on}; not checked by Rotation.`;
  return { kind: 'product_link', source: 'url', detail };
}

/** Identity of an item saved from a store page or listing: a custom item, never a catalog match. */
export function webIdentity(web) {
  return makeIdentity({ evidence: [webEvidence(web)] });
}

function cleanText(value, max = MAX_TEXT) {
  if (value == null) return '';
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function cleanColors(colors) {
  if (!Array.isArray(colors)) return [];
  return [...new Set(colors.filter((c) => COLOR_BY_NAME.has(c)))].slice(0, 4);
}

/**
 * Checks the catalog identity: product exists, category matches, variant belongs to product.
 * Custom items must have a brand and a name and no catalog ids.
 */
function checkIdentityFields(input, catalog, errors) {
  if (!CATEGORIES.includes(input.category)) errors.category = 'Choose sneakers, a watch or clothing';
  if (input.productId) {
    const product = catalog.product(input.productId);
    if (!product) errors.productId = 'That product is not in the catalog';
    else if (product.category !== input.category) errors.category = 'Category does not match the product';
    if (input.variantId) {
      const variant = catalog.variant(input.variantId);
      if (!variant || variant.productId !== input.productId) errors.variantId = 'That version does not belong to this product';
    }
  } else {
    if (input.variantId) errors.variantId = 'A version needs a product';
    const custom = input.custom ?? {};
    if (!cleanText(custom.brand)) errors['custom.brand'] = 'Enter the brand';
    if (!cleanText(custom.name)) errors['custom.name'] = 'Enter a name';
  }
}

/** Validates and normalizes the private details of an owned item. */
export function normalizeDetails(details = {}, category, now, errors) {
  const size = details.size && details.size.value ? { value: String(details.size.value).trim(), system: details.size.system, ...(details.size.width ? { width: cleanText(details.size.width, 8) } : {}) } : null;
  const sizeError = validateSize(size, category);
  if (sizeError) errors['details.size'] = sizeError;

  const condition = details.condition || null;
  if (condition && !OWNED_CONDITIONS.includes(condition)) errors['details.condition'] = 'Choose a condition';

  let purchase = null;
  if (details.purchase && (details.purchase.priceMinor != null || details.purchase.date || details.purchase.from)) {
    const priceMinor = details.purchase.priceMinor == null || details.purchase.priceMinor === '' ? null : Number(details.purchase.priceMinor);
    if (priceMinor != null && (!Number.isInteger(priceMinor) || priceMinor < 0 || priceMinor > 100000000)) {
      errors['details.purchase.priceMinor'] = 'Enter a price of zero or more';
    }
    const date = details.purchase.date || null;
    if (date && (Number.isNaN(Date.parse(date)) || Date.parse(date) > now + 86400000)) {
      errors['details.purchase.date'] = 'Enter a purchase date that is not in the future';
    }
    purchase = { priceMinor, currency: 'USD', date, from: cleanText(details.purchase.from) || null };
  }

  const notes = cleanText(details.notes, MAX_NOTES);
  let serialNumber = cleanText(details.serialNumber, 64) || null;
  if (serialNumber && category !== 'watch') {
    errors['details.serialNumber'] = 'Serial numbers are only stored for watches';
    serialNumber = null;
  }
  return { size, condition, purchase, notes, serialNumber };
}

function normalizeOwnerChanges(changes, category, errors) {
  if (!Array.isArray(changes) || !changes.length) return [];
  if (category !== 'watch') {
    errors.ownerChanges = 'Owner changes are recorded for watches';
    return [];
  }
  return changes.slice(0, 5).map((c) => {
    const widthMm = c.widthMm == null || c.widthMm === '' ? null : Number(c.widthMm);
    if (widthMm != null && !(widthMm >= 8 && widthMm <= 30)) errors.ownerChanges = 'Strap width should be between 8 and 30 mm';
    return {
      part: ['strap', 'bracelet', 'other'].includes(c.part) ? c.part : 'other',
      description: cleanText(c.description, 200),
      widthMm,
    };
  });
}

/**
 * Builds a validated owned-item record. Throws ApiError('invalid') with field errors.
 * @param {object} input
 * @param {{ userId: string, now: number, catalog: any }} env
 */
export function buildOwnedItem(input, env) {
  const errors = {};
  checkIdentityFields(input, env.catalog, errors);
  const details = normalizeDetails(input.details, input.category, env.now, errors);
  const ownerChanges = normalizeOwnerChanges(input.ownerChanges, input.category, errors);
  const identity = input.identity ?? (input.productId
    ? catalogIdentity({ userId: env.userId, now: env.now, variantId: input.variantId })
    : makeIdentity());
  Object.assign(errors, validateIdentity(identity));
  if (!input.productId && identity.resolution !== 'manual') errors.identity = 'A custom item cannot carry a catalog identity';
  if (Object.keys(errors).length) throw invalid(errors);

  const photos = {
    originalId: input.photos?.originalId ?? null,
    cleanedId: input.photos?.cleanedId ?? null,
    labelIds: Array.isArray(input.photos?.labelIds) ? input.photos.labelIds : [],
    webId: input.photos?.webId ?? null,
  };
  const display = OWNED_DISPLAYS.includes(input.display)
    ? input.display
    : input.productId ? 'catalog' : 'original';

  return {
    id: newId('own'),
    userId: env.userId,
    createdAt: iso(env.now),
    updatedAt: iso(env.now),
    archivedAt: null,
    category: input.category,
    productId: input.productId ?? null,
    variantId: input.productId ? input.variantId ?? null : null,
    custom: input.productId
      ? null
      : {
          brand: cleanText(input.custom.brand),
          name: cleanText(input.custom.name),
          variantName: cleanText(input.custom.variantName) || null,
          type: cleanText(input.custom.type, 40) || null,
          colors: cleanColors(input.custom.colors),
        },
    identity,
    details,
    ownerChanges,
    photos,
    display,
    // What a store page or listing said when it was saved; only custom items carry one.
    web: input.productId ? null : cleanWebSnapshot(input.web, env.now),
  };
}

/** Applies a patch to an owned item (details, display, owner changes, custom fields). */
export function patchOwnedItem(item, patch, env) {
  const errors = {};
  const next = structuredClone(item);
  if (patch.details) next.details = normalizeDetails({ ...item.details, ...patch.details }, item.category, env.now, errors);
  if (patch.ownerChanges) next.ownerChanges = normalizeOwnerChanges(patch.ownerChanges, item.category, errors);
  if (patch.custom && !item.productId) {
    const custom = { ...item.custom, ...patch.custom };
    if (!cleanText(custom.brand)) errors['custom.brand'] = 'Enter the brand';
    if (!cleanText(custom.name)) errors['custom.name'] = 'Enter a name';
    next.custom = {
      brand: cleanText(custom.brand),
      name: cleanText(custom.name),
      variantName: cleanText(custom.variantName) || null,
      type: cleanText(custom.type, 40) || null,
      colors: cleanColors(custom.colors),
    };
  }
  if (patch.display) {
    if (!OWNED_DISPLAYS.includes(patch.display)) errors.display = 'Unknown image choice';
    next.display = patch.display;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  next.updatedAt = iso(env.now);
  return next;
}

/**
 * Builds a validated wishlist record.
 * @param {object} input
 * @param {{ userId: string, now: number, catalog: any }} env
 */
export function buildWishlistItem(input, env) {
  const errors = {};
  if (input.productId || input.custom) checkIdentityFields(input, env.catalog, errors);
  else if (!input.matchPending) errors.productId = 'Choose a product or describe the item';
  if (!CATEGORIES.includes(input.category)) errors.category = 'Choose sneakers, a watch or clothing';

  const reason = input.reason ?? 'like_style';
  if (!WISH_REASONS.includes(reason)) errors.reason = 'Choose why you saved it';
  const intent = input.intent ?? WISH_INTENT_FOR_REASON[reason] ?? 'inspiration';
  if (!WISH_INTENTS.includes(intent)) errors.intent = 'Choose what kind of match you want';

  const desired = input.desired ?? {};
  const size = desired.size && desired.size.value ? { value: String(desired.size.value).trim(), system: desired.size.system } : null;
  const sizeError = validateSize(size, input.category);
  if (sizeError) errors['desired.size'] = sizeError;
  const condition = desired.condition ?? 'new_only';
  if (!WISH_CONDITIONS.includes(condition)) errors['desired.condition'] = 'Choose new only or new or used';

  const target = input.targetPriceMinor == null || input.targetPriceMinor === '' ? null : Number(input.targetPriceMinor);
  if (target != null && (!Number.isInteger(target) || target <= 0)) errors.targetPriceMinor = 'Enter a target price above zero';

  if (Object.keys(errors).length) throw invalid(errors);

  return {
    id: newId('wish'),
    userId: env.userId,
    createdAt: iso(env.now),
    updatedAt: iso(env.now),
    status: 'active',
    category: input.category,
    productId: input.productId ?? null,
    variantId: input.productId ? input.variantId ?? null : null,
    custom: input.productId || !input.custom
      ? null
      : {
          brand: cleanText(input.custom.brand),
          name: cleanText(input.custom.name),
          variantName: cleanText(input.custom.variantName) || null,
          type: cleanText(input.custom.type, 40) || null,
          colors: cleanColors(input.custom.colors),
        },
    identity: input.identity ?? (input.productId
      ? catalogIdentity({ userId: env.userId, now: env.now, variantId: input.variantId })
      : makeIdentity()),
    reason,
    reasonNote: cleanText(input.reasonNote, 280),
    intent,
    linkedOwnedIds: Array.isArray(input.linkedOwnedIds) ? input.linkedOwnedIds.slice(0, 10) : [],
    desired: { size, condition, variantFlexible: Boolean(desired.variantFlexible ?? intent !== 'exact') },
    targetPriceMinor: target,
    currency: 'USD',
    sourceUrl: input.sourceUrl ?? null,
    matchPending: Boolean(input.matchPending),
    photos: { originalId: input.photos?.originalId ?? null, webId: input.photos?.webId ?? null },
    purchasedOwnedId: null,
    web: input.productId || !input.custom ? null : cleanWebSnapshot(input.web, env.now),
  };
}

export const OUTFIT_FIELDS = ['name', 'itemIds', 'notes'];

// Like UNSAFE_TEXT, but keeps the zero-width joiner and non-joiner that emoji and Persian need.
const NAME_STRIP = /[\u0000-\u001F\u007F-\u009F؜​‎‏‪-‮⁠-⁩﻿]/g;

/** An outfit name as stored: spaces collapsed, then control, zero-width and bidi characters removed. */
export function cleanOutfitName(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').replace(NAME_STRIP, '').replace(/\s+/g, ' ').trim() : '';
}

// Characters that draw nothing on their own: controls, format characters, spaces, combining
// marks, default-ignorable characters (joiners, soft hyphen, variation selectors, Hangul
// fillers) and the blank braille cell. A name made only of these is empty.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Z}\p{M}\p{Default_Ignorable_Code_Point}⠀]/gu;
// What comparing names ignores. Combining marks still count: in many scripts they change the word.
const IGNORED_IN_NAMES = /\p{Default_Ignorable_Code_Point}/gu;

/** What two outfit names are compared by: "Weekend  Look", "weekend look" and "Week­end look" match. */
export function outfitNameKey(name) {
  return cleanOutfitName(name)
    .normalize('NFKC')
    .toLowerCase()
    .replace(IGNORED_IN_NAMES, '')
    .replace(/⠀/g, ' ') // the blank braille cell looks like a space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cleans the outfit fields in `input` (name, itemIds, notes). Without `partial`, all three are
 * checked; with it, only the ones given. Ownership and name clashes need the database, so the
 * caller checks those and adds to `errors` before throwing.
 * @param {any} input
 * @param {{ partial?: boolean }} [opts]
 * @returns {{ fields: { name?: string, itemIds?: string[], notes?: string }, errors: Record<string, string> }}
 */
export function checkOutfitFields(input, { partial = false } = {}) {
  const fields = {};
  const errors = {};
  const has = (key) => !partial || input?.[key] !== undefined;
  if (has('name')) {
    const name = cleanOutfitName(input?.name);
    // A name has to show something: one made only of invisible characters is empty.
    if (!name.replace(INVISIBLE, '')) errors.name = 'Enter a name for this outfit';
    else if (name.length > OUTFIT_LIMITS.nameMax) errors.name = `Use ${OUTFIT_LIMITS.nameMax} characters or fewer`;
    fields.name = name;
  }
  if (has('itemIds')) {
    const ids = input?.itemIds;
    if (!Array.isArray(ids)) errors.itemIds = 'Choose items from your collection';
    const unique = Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === 'string' && id))] : [];
    if (!errors.itemIds && unique.length < OUTFIT_LIMITS.minItems) errors.itemIds = 'Choose at least two items';
    else if (unique.length > OUTFIT_LIMITS.maxItems) errors.itemIds = `Choose up to ${OUTFIT_LIMITS.maxItems} items`;
    fields.itemIds = unique;
  }
  if (has('notes')) {
    const notes = cleanText(input?.notes == null ? '' : input.notes, Infinity);
    if (notes.length > OUTFIT_LIMITS.notesMax) errors.notes = `Use ${OUTFIT_LIMITS.notesMax} characters or fewer`;
    fields.notes = notes;
  }
  return { fields, errors };
}

export function defaultProfile(userId) {
  return {
    userId,
    onboardedAt: null,
    sizes: {},
    budgets: {},
    styles: [],
    colorsLiked: [],
    colorsAvoided: [],
    uses: [],
    categories: ['sneaker', 'watch', 'clothing'],
    theme: 'system',
  };
}
