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
  validateSize,
  RETRIEVAL,
  IDENTITY,
  VARIANT_STATE,
} from '../data/schema.js';
import { COLOR_BY_NAME } from '../data/colors.js';

const MAX_NOTES = 2000;
const MAX_TEXT = 120;

export function iso(ms) {
  return new Date(ms).toISOString();
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
  };
  const display = ['catalog', 'original', 'cleaned'].includes(input.display)
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
    if (!['catalog', 'original', 'cleaned'].includes(patch.display)) errors.display = 'Unknown image choice';
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
    photos: { originalId: input.photos?.originalId ?? null },
    purchasedOwnedId: null,
  };
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
