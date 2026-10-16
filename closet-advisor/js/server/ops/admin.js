// Admin operations: catalog imports and corrections, image source status, offer freshness, match
// job health, provider simulation, ranking weights, stylist assignments, pseudonymous clicks and
// conversions. Admins manage shared data and operations. Nothing here returns a person's items,
// photos, notes, sizes or prices paid; people appear only as accounts or short hashes.
import { ApiError, invalid, notFound } from '../errors.js';
import { hashString, newId } from '../../lib/ids.js';
import { redactAccountForAdmin } from '../policy.js';
import {
  ATTRIBUTE_RULES,
  CATEGORIES,
  FEEDBACK_TYPES,
  OFFER_CONDITIONS,
  PRODUCT_TYPES,
  RETRIEVAL,
  ROLES,
  SELLER_TYPE_LABEL,
  SIZE_SYSTEMS,
  STYLE_TAGS,
  TYPE_LABEL,
  sizeSystemFor,
  validateAttributes,
} from '../../data/schema.js';
import { COLOR_BY_NAME, colorHex } from '../../data/colors.js';
import { primaryCode } from '../../data/catalog-index.js';
import { imagePermitted } from '../../engine/provenance.js';
import { FRESH_HOURS, freshness } from '../../engine/offers.js';
import { DEFAULT_WEIGHTS, WEIGHT_RANGES, normalizeWeights, validateWeights } from '../../engine/recommend.js';
import { demoConversionEvents, reconcileConversions, summarize } from '../../engine/conversions.js';
import { revokePhotoUrls } from './photos.js';
import { notConnectedWeb } from '../providers/web.js';
import { requeueMatchJob } from './matching.js';

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const cleanText = (v) => String(v ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();

// ---------- Correction fields (shared with inventory.reportCatalogIssue) ----------

const FIXED_FIELDS = {
  'product.name': { level: 'product', path: ['name'], type: 'text', max: 80, label: 'Product name' },
  'product.description': { level: 'product', path: ['description'], type: 'text', max: 600, label: 'Description' },
  'variant.name': { level: 'variant', path: ['name'], type: 'text', max: 80, label: 'Version name' },
  'variant.identifiers.styleCode': { level: 'variant', path: ['identifiers', 'styleCode'], type: 'code', label: 'Style code', categories: ['sneaker', 'clothing'] },
  'variant.identifiers.reference': { level: 'variant', path: ['identifiers', 'reference'], type: 'code', label: 'Reference', categories: ['watch'] },
  'variant.msrpMinor': { level: 'variant', path: ['msrpMinor'], type: 'money', label: 'Retail price' },
  other: { level: 'product', path: null, type: 'none', label: 'Something else' },
};

const ATTRIBUTE_LABEL = {
  upperMaterial: 'Upper material',
  soleType: 'Sole',
  closure: 'Closure',
  cut: 'Cut',
  colorway: 'Colorway',
  movement: 'Movement',
  waterResistanceM: 'Water resistance (m)',
  crystal: 'Crystal',
  attachment: 'Strap attachment',
  dialColor: 'Dial color',
  caseMaterial: 'Case material',
  diameterMm: 'Case diameter (mm)',
  thicknessMm: 'Case thickness (mm)',
  lugToLugMm: 'Lug to lug (mm)',
  lugWidthMm: 'Lug width (mm)',
  bracelet: 'Bracelet or strap',
  strapWidthMm: 'Strap width (mm)',
  fit: 'Fit',
  material: 'Material',
  weight: 'Fabric weight',
  color: 'Color',
};

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9./-]{1,31}$/;

function readPath(record, path) {
  return path ? path.reduce((value, key) => (value == null ? undefined : value[key]), record) : undefined;
}

function writePath(record, path, value) {
  const next = structuredClone(record);
  let target = next;
  for (const key of path.slice(0, -1)) {
    if (!isObj(target[key])) target[key] = {};
    target = target[key];
  }
  target[path[path.length - 1]] = value;
  return next;
}

function fieldSpec(category, field) {
  if (typeof field !== 'string') return null;
  let base = Object.hasOwn(FIXED_FIELDS, field) ? FIXED_FIELDS[field] : null;
  if (base?.categories && !base.categories.includes(category)) return null;
  if (!base) {
    const m = /^(product|variant)\.attributes\.([A-Za-z]+)$/.exec(field);
    const rule = m ? ATTRIBUTE_RULES[category]?.[m[1]]?.find(([name]) => name === m[2]) : null;
    if (!rule) return null;
    const type = rule[1];
    base = {
      level: m[1],
      path: ['attributes', m[2]],
      type: type === 'number' ? 'number' : type.startsWith('enum:') ? 'enum' : 'text',
      options: type.startsWith('enum:') ? type.slice(5).split('|') : null,
      max: 120,
      label: ATTRIBUTE_LABEL[m[2]] ?? m[2],
    };
  }
  return { field, ...base, get: (record) => readPath(record, base.path) };
}

/**
 * Fields people can propose fixes for in a category, for building the report form.
 * @returns {Array<{ field, label, level: 'product'|'variant', type, options: string[]|null }>}
 */
export function correctionFieldsFor(category) {
  const attrs = ['product', 'variant'].flatMap((level) => (ATTRIBUTE_RULES[category]?.[level] ?? []).map(([name]) => `${level}.attributes.${name}`));
  return [...Object.keys(FIXED_FIELDS).filter((f) => f !== 'other'), ...attrs, 'other']
    .map((field) => fieldSpec(category, field))
    .filter(Boolean)
    .map(({ field, label, level, type, options }) => ({ field, label, level, type, options: options ?? null }));
}

/**
 * Resolves what a correction is about. Returns { problems } (field errors) or
 * { product, variant, spec, record } where record is the product or variant the field lives on.
 */
export function correctionField(catalog, { productId, variantId, field }) {
  const product = typeof productId === 'string' ? catalog.product(productId) : null;
  if (!product) return { problems: { productId: 'That product is not in the catalog' } };
  const variant = variantId ? catalog.variant(variantId) : null;
  if (variantId && (!variant || variant.productId !== product.id)) return { problems: { variantId: 'That version does not belong to this product' } };
  const spec = fieldSpec(product.category, field);
  if (!spec) return { problems: { field: 'Choose what is wrong from the list' } };
  if (spec.level === 'variant' && !variant) return { problems: { variantId: 'Choose the version this is about' } };
  return { product, variant, spec, record: spec.level === 'variant' ? variant : product };
}

/** Checks a proposed value against the field's type. Returns { value } or { problem }. */
export function coerceCorrectionValue(spec, value) {
  switch (spec.type) {
    case 'none':
      return { value: null };
    case 'text': {
      const text = cleanText(value);
      if (!text) return { problem: 'Enter the correct value' };
      if (text.length > spec.max) return { problem: `Keep it under ${spec.max} characters` };
      return { value: text };
    }
    case 'code': {
      const text = cleanText(value).toUpperCase();
      return CODE_PATTERN.test(text) ? { value: text } : { problem: 'Use letters, numbers and dashes, like KR2-304' };
    }
    case 'money':
      return Number.isInteger(value) && value > 0 && value <= 100000000 ? { value } : { problem: 'Enter a price above zero' };
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
      return Number.isFinite(n) && n > 0 && n <= 10000 ? { value: n } : { problem: 'Enter a number above zero' };
    }
    case 'enum':
      return spec.options.includes(value) ? { value } : { problem: `Choose one of: ${spec.options.join(', ')}` };
    default:
      return { problem: 'This field cannot be corrected' };
  }
}

/** Every identifier in the catalog except one variant's, for uniqueness checks. */
function identifierOwners(variants, exceptId) {
  const owners = new Map();
  for (const v of variants) {
    if (v.id === exceptId) continue;
    const ids = v.identifiers ?? {};
    for (const code of [ids.styleCode, ids.reference, ...(ids.gtins ?? [])]) if (code) owners.set(String(code).toUpperCase(), v.id);
  }
  return owners;
}

// ---------- Feed import ----------

const SLUG = /^[a-z0-9]+(?:-{1,2}[a-z0-9]+)*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const GTIN = /^(\d{8}|\d{12}|\d{13}|\d{14})$/;
const MAX_FEED_CHARS = 2000000;
const MAX_RECORDS = 500;
const FEED_KINDS = ['brands', 'products', 'variants', 'images', 'offers'];
const STOCK = ['in_stock', 'low_stock', 'out_of_stock'];
const IMAGE_STATUSES = ['active', 'expired', 'taken_down'];
const FIELDS = {
  brands: ['id', 'name', 'categories', 'country'],
  products: ['id', 'category', 'type', 'brandId', 'name', 'styleTags', 'materials', 'features', 'description', 'sizing', 'attributes', 'sources', 'illustration'],
  variants: ['id', 'productId', 'name', 'identifiers', 'colors', 'attributes', 'msrpMinor', 'currency', 'release', 'illustration'],
  images: ['id', 'variantId', 'provider', 'sourceUrl', 'attribution', 'license', 'permissions', 'status', 'fetchedAt', 'expiresAt'],
  offers: ['id', 'retailerId', 'listingId', 'variantId', 'condition', 'sellerType', 'includedComponents', 'sizes', 'priceMinor', 'stock', 'currency', 'shipping', 'fees', 'tax', 'delivery', 'returns', 'warranty', 'url', 'listingStatus', 'demoAgeHours', 'checkedAt'],
};
const STORE_FOR = { brands: 'catalogBrands', products: 'catalogProducts', variants: 'catalogVariants', images: 'catalogImages', offers: 'offers' };

const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const textList = (v, maxItems, maxLen) => Array.isArray(v) && v.length <= maxItems && v.every((s) => text(s, maxLen));
const isDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isMinor = (v) => Number.isInteger(v) && v >= 0 && v <= 100000000;
const slugId = (v, max) => typeof v === 'string' && v.length <= max && SLUG.test(v);
const isPrice = (v) => Number.isInteger(v) && v > 0 && v <= 100000000;

function unknownFields(record, allowed) {
  return Object.keys(record)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${k} is not a field a feed can set`);
}

function checkBrand(raw) {
  const problems = unknownFields(raw, FIELDS.brands);
  if (!slugId(raw.id, 60)) problems.push('id must be a lowercase slug like north-trail');
  if (!text(raw.name, 60)) problems.push('name is required (up to 60 characters)');
  if (!Array.isArray(raw.categories) || !raw.categories.length || !raw.categories.every((c) => CATEGORIES.includes(c))) {
    problems.push('categories must list sneaker, watch or clothing');
  }
  if (raw.country != null && !text(raw.country, 60)) problems.push('country must be text');
  if (problems.length) return { problems };
  return { record: { id: raw.id, name: raw.name.trim(), categories: [...new Set(raw.categories)], ...(raw.country ? { country: raw.country.trim() } : {}) } };
}

function checkProduct(raw, env) {
  const problems = unknownFields(raw, FIELDS.products);
  if (!slugId(raw.id, 80)) problems.push('id must be a lowercase slug like trail-runner-3');
  const category = raw.category;
  if (!CATEGORIES.includes(category)) {
    problems.push('category must be sneaker, watch or clothing');
    return { problems };
  }
  const existing = env.catalog.product(raw.id);
  if (existing && existing.category !== category) problems.push(`category cannot change for an existing product (it is ${existing.category})`);
  if (!PRODUCT_TYPES[category].includes(raw.type)) problems.push(`type must be one of ${PRODUCT_TYPES[category].join(', ')}`);
  const brand = env.brands.get(raw.brandId) ?? env.catalog.brand(raw.brandId);
  if (!brand) problems.push(`brandId ${raw.brandId ?? '(missing)'} is not in the catalog or this feed`);
  else if (!brand.categories.includes(category)) problems.push(`brand ${brand.id} is not listed for ${category}`);
  if (!text(raw.name, 80)) problems.push('name is required (up to 80 characters)');
  if (raw.styleTags != null && !(Array.isArray(raw.styleTags) && raw.styleTags.length <= 6 && raw.styleTags.every((t) => STYLE_TAGS.includes(t)))) {
    problems.push(`styleTags must come from ${STYLE_TAGS.join(', ')}`);
  }
  if (raw.materials != null && !textList(raw.materials, 10, 60)) problems.push('materials must be a list of short text values');
  if (raw.features != null && !textList(raw.features, 10, 60)) problems.push('features must be a list of short text values');
  if (raw.description != null && !(typeof raw.description === 'string' && raw.description.length <= 600)) problems.push('description must be text up to 600 characters');

  const system = sizeSystemFor(category, raw.type);
  if (raw.sizing != null) {
    const s = raw.sizing;
    if (!isObj(s) || !SIZE_SYSTEMS.includes(s.system) || !textList(s.sizes, 60, 12) || !s.sizes.length) problems.push('sizing must have a size system and a list of sizes');
    else if (s.system !== system) problems.push(system ? `sizing.system must be ${system} for ${raw.type}` : `${raw.type} products are not sized`);
    if (isObj(s) && s.widths != null && !textList(s.widths, 6, 4)) problems.push('sizing.widths must be a list of widths');
  }
  problems.push(...validateAttributes(category, 'product', isObj(raw.attributes) ? raw.attributes : {}));
  if (raw.attributes != null && !isObj(raw.attributes)) problems.push('attributes must be an object');
  if (raw.sources != null && !(Array.isArray(raw.sources) && raw.sources.length <= 5 && raw.sources.every((s) => isObj(s) && text(s.provider, 60) && text(s.sourceId, 80) && isDate(s.retrievedAt)))) {
    problems.push('sources must list provider, sourceId and retrievedAt');
  }
  if (raw.illustration != null && (!isObj(raw.illustration) || (raw.illustration.kind != null && raw.illustration.kind !== category))) {
    problems.push(`illustration.kind must be ${category}`);
  }
  if (problems.length) return { problems };
  return {
    record: {
      id: raw.id,
      category,
      type: raw.type,
      brandId: raw.brandId,
      name: raw.name.trim(),
      styleTags: [...new Set(raw.styleTags ?? [])],
      materials: raw.materials ?? [],
      features: raw.features ?? [],
      description: raw.description ?? '',
      sizing: raw.sizing ? { system: raw.sizing.system, sizes: raw.sizing.sizes, ...(raw.sizing.widths ? { widths: raw.sizing.widths } : {}) } : null,
      attributes: raw.attributes ?? {},
      // Records without stated provenance are attributed to the import itself.
      sources: raw.sources?.length ? raw.sources : [{ provider: 'admin-import', sourceId: raw.id, retrievedAt: env.nowIso }],
      illustration: { kind: category, shape: raw.type, ...(raw.illustration ?? {}) },
    },
  };
}

function checkVariant(raw, env) {
  const problems = unknownFields(raw, FIELDS.variants);
  if (!slugId(raw.id, 120)) problems.push('id must be a lowercase slug like trail-runner-3--black');
  const product = env.products.get(raw.productId) ?? env.catalog.product(raw.productId);
  if (!product) {
    problems.push(`productId ${raw.productId ?? '(missing)'} is not in the catalog or this feed`);
    return { problems };
  }
  const existing = env.catalog.variant(raw.id);
  if (existing && existing.productId !== raw.productId) problems.push(`productId cannot change for an existing version (it is ${existing.productId})`);
  if (!text(raw.name, 80)) problems.push('name is required (up to 80 characters)');

  const ids = raw.identifiers ?? {};
  if (!isObj(ids)) problems.push('identifiers must be an object');
  else {
    for (const key of Object.keys(ids)) if (!['styleCode', 'reference', 'gtins'].includes(key)) problems.push(`identifiers.${key} is not a known identifier`);
    for (const key of ['styleCode', 'reference']) {
      if (ids[key] != null && !(typeof ids[key] === 'string' && CODE_PATTERN.test(ids[key].toUpperCase()))) problems.push(`identifiers.${key} must use letters, numbers and dashes`);
    }
    if (ids.gtins != null && !(Array.isArray(ids.gtins) && ids.gtins.length <= 5 && ids.gtins.every((g) => typeof g === 'string' && GTIN.test(g)))) {
      problems.push('identifiers.gtins must be 8, 12, 13 or 14 digit codes');
    }
    for (const code of [ids.styleCode, ids.reference, ...(Array.isArray(ids.gtins) ? ids.gtins : [])]) {
      const owner = code ? env.identifiers.get(String(code).toUpperCase()) : null;
      if (owner && owner !== raw.id) problems.push(`identifier ${code} already belongs to ${owner}`);
    }
  }

  const colors = raw.colors;
  if (!Array.isArray(colors) || !colors.length || colors.length > 6) problems.push('colors must list one to six colors');
  else if (!colors.every((c) => isObj(c) && COLOR_BY_NAME.has(c.name) && text(c.role, 30) && typeof c.weight === 'number' && c.weight > 0 && c.weight <= 1)) {
    problems.push('each color needs a known color name, a role and a weight between 0 and 1');
  } else {
    const total = colors.reduce((sum, c) => sum + c.weight, 0);
    if (total < 0.95 || total > 1.05) problems.push('color weights must add up to 1');
  }
  if (raw.attributes != null && !isObj(raw.attributes)) problems.push('attributes must be an object');
  problems.push(...validateAttributes(product.category, 'variant', isObj(raw.attributes) ? raw.attributes : {}));
  if (raw.msrpMinor != null && !isPrice(raw.msrpMinor)) problems.push('msrpMinor must be a whole number of cents above zero, or null when unknown');
  if (raw.currency != null && raw.currency !== 'USD') problems.push('only USD prices are supported in the prototype');
  if (raw.release != null && !(isObj(raw.release) && isDate(raw.release.date) && text(raw.release.source, 60))) problems.push('release needs a date and a source, or null');
  const illus = raw.illustration;
  if (illus != null && !(isObj(illus) && (illus.palette == null || (isObj(illus.palette) && Object.values(illus.palette).every((h) => HEX.test(h)))))) {
    problems.push('illustration.palette must map parts to #rrggbb colors');
  }
  if (problems.length) return { problems };
  // Without a palette, draw the illustration from the version's own colors by role.
  const palette = illus?.palette ?? { main: colorHex(colors[0].name), ...Object.fromEntries(colors.map((c) => [c.role, colorHex(c.name)])) };
  return {
    record: {
      id: raw.id,
      productId: raw.productId,
      name: raw.name.trim(),
      identifiers: {
        ...(ids.styleCode ? { styleCode: ids.styleCode.toUpperCase() } : {}),
        ...(ids.reference ? { reference: ids.reference.toUpperCase() } : {}),
        ...(ids.gtins?.length ? { gtins: ids.gtins } : {}),
      },
      colors: colors.map((c) => ({ name: c.name, role: c.role.trim(), weight: c.weight })),
      attributes: raw.attributes ?? {},
      msrpMinor: raw.msrpMinor ?? null,
      currency: 'USD',
      release: raw.release ?? null,
      illustration: { ...(illus ?? {}), palette },
    },
  };
}

function demoOnlyUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.example') ? url : null;
  } catch {
    return null;
  }
}

function checkImage(raw, env) {
  const problems = unknownFields(raw, FIELDS.images);
  if (!slugId(raw.id, 140)) problems.push('id must be a lowercase slug like img-trail-runner-3--black');
  if (!env.variants.has(raw.variantId) && !env.catalog.variant(raw.variantId)) problems.push(`variantId ${raw.variantId ?? '(missing)'} is not in the catalog or this feed`);
  if (!text(raw.provider, 60)) problems.push('provider is required');
  if (!(typeof raw.sourceUrl === 'string' && (raw.sourceUrl.startsWith('generated:') || demoOnlyUrl(raw.sourceUrl)))) {
    problems.push('sourceUrl must be a generated: reference or an https link on a .example demo domain');
  }
  if (!text(raw.attribution, 200)) problems.push('attribution is required');
  if (!['owned', 'feed-terms'].includes(raw.license)) problems.push('license must be owned or feed-terms');
  const p = raw.permissions;
  if (!(isObj(p) && typeof p.inventoryDisplay === 'boolean' && typeof p.requiresActiveOffer === 'boolean' && typeof p.attributionRequired === 'boolean' && Number.isFinite(p.cacheTtlHours) && p.cacheTtlHours >= 0)) {
    problems.push('permissions must set inventoryDisplay, requiresActiveOffer, attributionRequired and cacheTtlHours');
  }
  if (raw.status != null && !IMAGE_STATUSES.includes(raw.status)) problems.push('status must be active, expired or taken_down');
  if (raw.fetchedAt != null && !isDate(raw.fetchedAt)) problems.push('fetchedAt must be a date');
  if (raw.expiresAt != null && !isDate(raw.expiresAt)) problems.push('expiresAt must be a date or null');
  if (problems.length) return { problems };
  return {
    record: {
      id: raw.id,
      variantId: raw.variantId,
      provider: raw.provider.trim(),
      sourceUrl: raw.sourceUrl,
      attribution: raw.attribution.trim(),
      license: raw.license,
      permissions: { inventoryDisplay: p.inventoryDisplay, requiresActiveOffer: p.requiresActiveOffer, cacheTtlHours: p.cacheTtlHours, attributionRequired: p.attributionRequired },
      status: raw.status ?? 'active',
      fetchedAt: raw.fetchedAt ?? env.nowIso,
      expiresAt: raw.expiresAt ?? null,
    },
  };
}

function checkCost(value, kinds, amountKind, label) {
  if (value == null) return { value: { kind: 'unknown' } };
  if (!isObj(value) || !kinds.includes(value.kind)) return { problem: `${label}.kind must be one of ${kinds.join(', ')}` };
  if (value.kind === amountKind) {
    if (!isMinor(value.amountMinor)) return { problem: `${label}.amountMinor is required for ${amountKind}` };
    return { value: { kind: value.kind, amountMinor: value.amountMinor, ...(text(value.label, 60) ? { label: value.label.trim() } : {}) } };
  }
  // Amounts only belong to the kind that has one; an unknown cost never carries a number.
  return { value: { kind: value.kind } };
}

function checkOffer(raw, env) {
  const problems = unknownFields(raw, FIELDS.offers);
  if (!slugId(raw.id, 80)) problems.push('id must be a lowercase slug like offer-nl-48213');
  const retailer = env.catalog.retailer(raw.retailerId);
  if (!retailer) problems.push(`retailerId ${raw.retailerId ?? '(missing)'} is not a known retailer; feeds cannot add retailers`);
  if (!text(raw.listingId, 60)) problems.push('listingId is required');
  const variant = env.variants.get(raw.variantId) ?? env.catalog.variant(raw.variantId);
  const product = variant ? env.products.get(variant.productId) ?? env.catalog.product(variant.productId) : null;
  if (!variant) problems.push(`variantId ${raw.variantId ?? '(missing)'} is not in the catalog or this feed`);
  if (!OFFER_CONDITIONS.includes(raw.condition)) problems.push(`condition must be one of ${OFFER_CONDITIONS.join(', ')}`);
  if (!Object.hasOwn(SELLER_TYPE_LABEL, raw.sellerType ?? '')) problems.push(`sellerType must be one of ${Object.keys(SELLER_TYPE_LABEL).join(', ')}`);
  if (raw.includedComponents != null && !textList(raw.includedComponents, 10, 40)) problems.push('includedComponents must be a list or null');

  if (raw.sizes != null) {
    const okSizes =
      Array.isArray(raw.sizes) &&
      raw.sizes.length > 0 &&
      raw.sizes.length <= 60 &&
      raw.sizes.every((s) => isObj(s) && text(s.value, 12) && SIZE_SYSTEMS.includes(s.system) && (s.priceMinor === null || isPrice(s.priceMinor)) && STOCK.includes(s.stock));
    if (!okSizes) problems.push('sizes must list value, system, priceMinor and stock for each size');
    else if (product && !product.sizing) problems.push(`${product.id} is not sized, so its offers cannot list sizes`);
    else if (product && raw.sizes.some((s) => s.system !== product.sizing.system)) problems.push(`sizes must use ${product.sizing.system}`);
  } else if (product?.sizing) {
    problems.push(`offers for ${product.id} must list sizes (${product.sizing.system})`);
  }
  if (raw.priceMinor != null && !isPrice(raw.priceMinor)) problems.push('priceMinor must be whole cents above zero, or null when unknown');
  if (raw.stock != null && !STOCK.includes(raw.stock)) problems.push('stock must be in_stock, low_stock or out_of_stock');
  if (raw.currency != null && raw.currency !== 'USD') problems.push('only USD prices are supported in the prototype');
  const shipping = checkCost(raw.shipping, ['free', 'flat', 'unknown', 'calculated_at_checkout'], 'flat', 'shipping');
  const fees = checkCost(raw.fees, ['none', 'known', 'unknown'], 'known', 'fees');
  const tax = checkCost(raw.tax, ['unknown', 'estimate'], 'estimate', 'tax');
  for (const c of [shipping, fees, tax]) if (c.problem) problems.push(c.problem);
  const d = raw.delivery;
  if (d != null && !(isObj(d) && Number.isInteger(d.minDays) && Number.isInteger(d.maxDays) && d.minDays >= 0 && d.maxDays >= d.minDays && d.maxDays <= 90)) {
    problems.push('delivery needs whole minDays and maxDays, or null');
  }
  if (raw.returns != null && !text(raw.returns, 200)) problems.push('returns must be text or null');
  const w = raw.warranty;
  if (w != null && !(isObj(w) && ['manufacturer', 'seller', 'none', 'unknown'].includes(w.kind) && (w.months == null || (Number.isInteger(w.months) && w.months > 0)))) {
    problems.push('warranty.kind must be manufacturer, seller, none or unknown');
  }
  const url = typeof raw.url === 'string' ? demoOnlyUrl(raw.url) : null;
  if (!url) problems.push('url must be an https link on a .example demo domain');
  else if (retailer && url.hostname !== retailer.domain && !url.hostname.endsWith(`.${retailer.domain}`)) problems.push(`url must be on ${retailer.domain}`);
  if (raw.listingStatus != null && !['active', 'removed'].includes(raw.listingStatus)) problems.push('listingStatus must be active or removed');
  if (raw.demoAgeHours != null && !(Number.isFinite(raw.demoAgeHours) && raw.demoAgeHours >= 0 && raw.demoAgeHours <= 8760)) problems.push('demoAgeHours must be between 0 and 8760');
  if (raw.checkedAt != null && !isDate(raw.checkedAt)) problems.push('checkedAt must be a date');
  if (problems.length) return { problems };
  return {
    record: {
      id: raw.id,
      retailerId: raw.retailerId,
      listingId: raw.listingId.trim(),
      variantId: raw.variantId,
      condition: raw.condition,
      sellerType: raw.sellerType,
      includedComponents: raw.includedComponents ?? null,
      sizes: raw.sizes ? raw.sizes.map((s) => ({ value: s.value.trim(), system: s.system, priceMinor: s.priceMinor, stock: s.stock })) : null,
      priceMinor: raw.sizes ? null : raw.priceMinor ?? null,
      stock: raw.sizes ? null : raw.stock ?? null,
      currency: 'USD',
      shipping: shipping.value,
      fees: fees.value,
      tax: tax.value,
      delivery: d ?? null,
      returns: raw.returns ?? null,
      warranty: w ? { kind: w.kind, ...(w.months ? { months: w.months } : {}), ...(text(w.provider, 60) ? { provider: w.provider.trim() } : {}) } : { kind: 'unknown' },
      url: url.toString(),
      listingStatus: raw.listingStatus ?? 'active',
      demoAgeHours: raw.demoAgeHours ?? 0,
      ...(raw.checkedAt ? { checkedAt: raw.checkedAt } : {}),
    },
  };
}

/** Same shape as the demo catalog's generated provenance (js/data/catalog.js). */
function generatedImageFor(variantId, nowIso) {
  return {
    id: `img-${variantId}`,
    variantId,
    provider: 'demo-illustrations',
    sourceUrl: `generated:${variantId}`,
    attribution: 'Illustration generated for the demo catalog',
    license: 'owned',
    permissions: { inventoryDisplay: true, requiresActiveOffer: false, cacheTtlHours: 720, attributionRequired: false },
    status: 'active',
    fetchedAt: nowIso,
    expiresAt: null,
  };
}

/** Drops cached reference features for changed variants so matching re-renders them. */
async function clearFeatures(ctx, variantIds) {
  if (!variantIds.size) return 0;
  let cleared = 0;
  for (const row of await ctx.db.all('catalogFeatures')) {
    const id = String(row.id);
    const hit = variantIds.has(row.id) || variantIds.has(row.variantId) || [...variantIds].some((v) => id.endsWith(`:${v}`) || id.endsWith(`/${v}`));
    if (hit) {
      await ctx.db.delete('catalogFeatures', row.id);
      cleared += 1;
    }
  }
  return cleared;
}

// ---------- Shared views ----------

async function hashSalt(ctx) {
  const row = await ctx.db.get('meta', 'adminHashSalt');
  if (row?.value) return row.value;
  const value = newId('salt');
  await ctx.db.put('meta', { key: 'adminHashSalt', value });
  return value;
}

/** A short, salted label that groups rows by person without saying who they are. */
function personHash(salt, userId) {
  return `p-${hashString(`${salt}:${userId}`).toString(36).padStart(7, '0').slice(0, 7)}`;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

function countBy(list, keyOf, keys = []) {
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const item of list) {
    const k = keyOf(item);
    if (k == null) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function jobView(job, salt) {
  return {
    id: job.id,
    status: job.status,
    category: job.category ?? null,
    attempts: job.attempts ?? 0,
    latencyMs: job.latencyMs ?? null,
    errorCode: job.error?.code ?? null,
    createdAt: job.createdAt,
    person: personHash(salt, job.userId),
  };
}

function imageView(catalog, image, now) {
  const variant = catalog.variant(image.variantId);
  const product = variant ? catalog.product(variant.productId) : null;
  const hasActiveOffer = catalog.offersOf(image.variantId).some((o) => o.listingStatus === 'active');
  return {
    ...image,
    variantName: variant?.name ?? null,
    productName: product?.name ?? null,
    brandName: product ? catalog.brand(product.brandId)?.name ?? null : null,
    inCollections: imagePermitted(image, { context: 'inventory', now, hasActiveOffer }),
    onProductPages: imagePermitted(image, { context: 'product', now, hasActiveOffer }),
  };
}

function priceRange(offer) {
  const prices = offer.sizes ? offer.sizes.map((s) => s.priceMinor).filter((p) => p != null) : offer.priceMinor != null ? [offer.priceMinor] : [];
  return prices.length ? { fromMinor: Math.min(...prices), toMinor: Math.max(...prices), currency: offer.currency } : { fromMinor: null, toMinor: null, currency: offer.currency };
}

function offerView(catalog, offer, now, freshnessHours) {
  const retailer = catalog.retailer(offer.retailerId);
  const variant = catalog.variant(offer.variantId);
  const product = variant ? catalog.product(variant.productId) : null;
  return {
    id: offer.id,
    retailer: retailer ? { id: retailer.id, name: retailer.name, domain: retailer.domain } : null,
    listingId: offer.listingId,
    variantId: offer.variantId,
    variantName: variant?.name ?? null,
    productName: product?.name ?? null,
    brandName: product ? catalog.brand(product.brandId)?.name ?? null : null,
    condition: offer.condition,
    sellerType: offer.sellerType,
    listingStatus: offer.listingStatus,
    price: priceRange(offer),
    sized: Boolean(offer.sizes),
    lastCheckedAt: offer.lastCheckedAt ?? null,
    freshness: freshness(offer.lastCheckedAt, now, freshnessHours),
    refreshedByAdmin: Boolean(offer.checkedAt),
    url: offer.url,
  };
}

async function resolvedOffers(ctx, catalog, now) {
  const out = [];
  for (const variantId of catalog.offersByVariant.keys()) out.push(...ctx.providers.offers.list(catalog, variantId, now));
  return out;
}

async function freshnessHoursOf(ctx) {
  const value = await ctx.config.get('offerFreshnessHours');
  return Number.isFinite(value) && value > 0 ? value : FRESH_HOURS;
}

async function nameMap(ctx) {
  return new Map((await ctx.db.all('users')).map((u) => [u.id, u.displayName]));
}

function assignmentView(a, names) {
  return {
    id: a.id,
    stylistId: a.stylistId,
    stylistName: names.get(a.stylistId) ?? null,
    userId: a.userId,
    userName: names.get(a.userId) ?? null,
    assignedBy: a.assignedBy,
    assignedByName: names.get(a.assignedBy) ?? null,
    createdAt: a.createdAt,
    endedAt: a.endedAt ?? null,
    active: !a.endedAt,
  };
}

const SIMULATION_OPTIONS = { vision: ['ok', 'timeout', 'error'], offers: ['ok', 'down'], ocr: ['ok', 'off'] };

async function simulationOf(ctx) {
  const value = await ctx.config.get('providerSimulation');
  return { vision: 'ok', offers: 'ok', ocr: 'ok', ...(isObj(value) ? value : {}) };
}

async function conversionReport(ctx) {
  try {
    return (await ctx.providers.conversions?.report?.()) ?? { connected: false };
  } catch {
    return { connected: false };
  }
}

/** Whether the local server for real store lookups is running. Read-only: it has no simulation. */
async function webStatusOf(ctx) {
  try {
    const status = await (ctx.providers.web ?? notConnectedWeb).status();
    return { live: status?.live === true };
  } catch {
    return { live: false };
  }
}

async function providersView(ctx) {
  const simulation = await simulationOf(ctx);
  const report = await conversionReport(ctx);
  const web = await webStatusOf(ctx);
  const catalog = await ctx.catalog();
  const cached = await ctx.db.count('catalogFeatures');
  const status = (key) => (simulation[key] === 'ok' ? 'normal' : 'simulated');
  return {
    simulation,
    providers: [
      {
        id: 'vision',
        name: 'On-device photo analysis',
        detail: 'Colors and shapes are measured in this browser. A photo is sent to Microsoft Bing only when the person asks to search online stores.',
        status: status('vision'),
        simulation: simulation.vision,
        options: SIMULATION_OPTIONS.vision,
        referenceImages: { cached, variants: catalog.variants.size },
      },
      {
        id: 'ocr',
        name: 'On-device label reading',
        detail: 'Tesseract.js is downloaded from jsDelivr only when someone asks to read a label, then runs in this browser.',
        status: status('ocr'),
        simulation: simulation.ocr,
        options: SIMULATION_OPTIONS.ocr,
      },
      {
        id: 'offers',
        name: 'Demo offers feed',
        detail: 'Fictional retailers and offers bundled with the prototype. Prices and stock are invented.',
        status: status('offers'),
        simulation: simulation.offers,
        options: SIMULATION_OPTIONS.offers,
      },
      {
        id: 'affiliate',
        name: 'Demo affiliate network',
        detail: 'Outbound links get the parameters each demo program allows. No network receives the clicks.',
        status: 'demo',
        simulation: null,
        options: [],
      },
      {
        id: 'web',
        name: 'Real store lookup',
        detail: web.live
          ? 'The local server reads store pages and searches Bing when someone asks. Results are guesses the person confirms.'
          : 'Needs the local server (npm start). Without it, only the demo stores can be looked up.',
        status: web.live ? 'connected' : 'not_connected',
        simulation: null,
        options: [],
      },
      {
        id: 'conversions',
        name: 'Conversion reports',
        detail: report?.connected
          ? `Connected to ${report.network ?? 'an affiliate network'}.`
          : 'No affiliate network is connected, so no sales or commissions are reported. Demo events can be loaded and are labeled demo.',
        status: report?.connected ? 'connected' : 'not_connected',
        simulation: null,
        options: [],
      },
    ],
  };
}

/** Weights the ranking uses now (stored values merged over the defaults and clamped), with the editor copy. */
async function weightsView(ctx) {
  const stored = await ctx.config.get('rankingWeights');
  const ranges = Object.fromEntries(Object.entries(WEIGHT_RANGES).map(([key, r]) => [key, { min: r.min, max: r.max, step: r.step, label: r.label, help: r.help }]));
  return { weights: normalizeWeights(stored), defaults: { ...DEFAULT_WEIGHTS }, ranges, custom: isObj(stored) };
}

async function conversionsView(ctx) {
  const report = await conversionReport(ctx);
  const clicks = await ctx.db.all('clicks');
  if (report.connected) {
    const reconciled = reconcileConversions(report.events ?? []);
    return { connected: true, network: report.network ?? null, report: reconciled, summary: summarize({ clicks, report: reconciled }), demo: null };
  }
  const events = (await ctx.db.all('conversions')).filter((c) => c.demo === true);
  const reconciled = events.length ? reconcileConversions(events) : null;
  return {
    connected: false,
    network: null,
    report: null,
    // Without a network, revenue is unknown; the summary says so instead of showing zero.
    summary: summarize({ clicks, report: null }),
    demo: reconciled
      ? {
          label: 'Demo data',
          note: 'Generated for the prototype. These are not real sales or commissions.',
          eventCount: events.length,
          events,
          report: reconciled,
          summary: summarize({ clicks, report: reconciled }),
        }
      : null,
  };
}

function correctionView(catalog, c, names, salt) {
  const product = catalog.product(c.productId);
  const variant = c.variantId ? catalog.variant(c.variantId) : null;
  const spec = product ? fieldSpec(product.category, c.field) : null;
  const record = spec?.level === 'variant' ? variant : product;
  return {
    id: c.id,
    status: c.status,
    productId: c.productId,
    productName: product?.name ?? null,
    brandName: product ? catalog.brand(product.brandId)?.name ?? null : null,
    variantId: c.variantId,
    variantName: variant?.name ?? null,
    field: c.field,
    fieldLabel: spec?.label ?? c.field,
    valueAtReport: c.currentValue ?? null,
    currentValue: spec && record && spec.type !== 'none' ? spec.get(record) ?? null : null,
    proposedValue: c.proposedValue,
    note: c.note,
    reporter: personHash(salt, c.userId),
    createdAt: c.createdAt,
    reviewedBy: c.reviewedBy ? names.get(c.reviewedBy) ?? c.reviewedBy : null,
    reviewedAt: c.reviewedAt ?? null,
    applied: c.applied ?? null,
  };
}

const ACCOUNT_ROLE_ORDER = Object.fromEntries(ROLES.map((r, i) => [r, i]));

export const ops = {
  /**
   * Aggregates only: scans by retrieval status and category, match latency p50/p95, failed and
   * timed-out jobs, feedback counts by type, offer freshness, outbound clicks, catalog counts,
   * open corrections, account counts, provider simulation and the saved evaluation summary.
   * Scan figures come from match metric events (no user ids) when there are any, otherwise
   * from job status counts. Never returns ids, notes, photos or anything from an item.
   */
  adminOverview: {
    auth: 'admin',
    async run(ctx) {
      const [events, jobs, feedback, clicks, users, assignments, corrections] = await Promise.all([
        ctx.db.all('events'),
        ctx.db.all('matchJobs'),
        ctx.db.all('feedback'),
        ctx.db.all('clicks'),
        ctx.db.all('users'),
        ctx.db.all('stylistAssignments'),
        ctx.db.all('corrections'),
      ]);
      const catalog = await ctx.catalog();
      const now = ctx.now();

      const matchEvents = events.filter((e) => /^(match|scan)/.test(e.type) && isObj(e.data) && RETRIEVAL.includes(e.data.retrieval));
      const fromEvents = matchEvents.length > 0;
      const results = fromEvents
        ? matchEvents.map((e) => ({ retrieval: e.data.retrieval, category: e.data.category ?? null, latencyMs: e.data.latencyMs ?? e.data.ms ?? null }))
        : jobs.filter((j) => j.result?.retrieval).map((j) => ({ retrieval: j.result.retrieval, category: j.category ?? null, latencyMs: j.latencyMs ?? j.result.latencyMs ?? null }));
      const latencies = results.map((r) => r.latencyMs).filter((ms) => Number.isFinite(ms)).sort((a, b) => a - b);
      const byCategory = {};
      for (const category of CATEGORIES) {
        const rows = results.filter((r) => r.category === category);
        byCategory[category] = { total: rows.length, byRetrieval: countBy(rows, (r) => r.retrieval, RETRIEVAL) };
      }

      const freshnessHours = await freshnessHoursOf(ctx);
      const offers = await resolvedOffers(ctx, catalog, now);
      const activeOffers = offers.filter((o) => o.listingStatus === 'active');
      const images = [...catalog.images.values()];
      const evalReport = await ctx.config.get('evalReport');

      return {
        generatedAt: new Date(now).toISOString(),
        scans: {
          source: fromEvents ? 'events' : 'jobs',
          total: results.length,
          byRetrieval: countBy(results, (r) => r.retrieval, RETRIEVAL),
          byCategory,
          latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), samples: latencies.length },
        },
        jobs: {
          total: jobs.length,
          byStatus: countBy(jobs, (j) => j.status, ['queued', 'processing', 'done', 'error', 'timeout', 'rejected', 'confirmed']),
          failed: jobs.filter((j) => j.status === 'error').length,
          timedOut: jobs.filter((j) => j.status === 'timeout').length,
        },
        feedback: { byType: countBy(feedback.filter((f) => f.active !== false), (f) => f.type, FEEDBACK_TYPES) },
        offers: {
          total: offers.length,
          active: activeOffers.length,
          removed: offers.length - activeOffers.length,
          freshness: countBy(activeOffers, (o) => freshness(o.lastCheckedAt, now, freshnessHours), ['fresh', 'aging', 'stale']),
          freshnessHours,
        },
        clicks: {
          total: clicks.length,
          tracked: clicks.filter((c) => c.tracked).length,
          untracked: clicks.filter((c) => !c.tracked).length,
          last7Days: clicks.filter((c) => now - Date.parse(c.createdAt) < 7 * 86400000).length,
        },
        catalog: {
          brands: catalog.brands.size,
          products: catalog.products.size,
          variants: catalog.variants.size,
          retailers: catalog.retailers.size,
          images: countBy(images, (i) => i.status, IMAGE_STATUSES),
          byCategory: countBy([...catalog.products.values()], (p) => p.category, CATEGORIES),
        },
        corrections: { open: corrections.filter((c) => c.status === 'open').length },
        accounts: {
          byRole: countBy(users, (u) => u.role, ROLES),
          activeAssignments: assignments.filter((a) => !a.endedAt).length,
        },
        providers: (await providersView(ctx)).providers.map(({ id, name, status, simulation }) => ({ id, name, status, simulation })),
        evaluation: isObj(evalReport)
          ? {
              generatedAt: evalReport.generatedAt ?? null,
              synthetic: evalReport.synthetic === true,
              counts: evalReport.counts ?? null,
              overall: evalReport.overall ?? null,
              outOfCatalog: evalReport.outOfCatalog ?? null,
              latencyMs: evalReport.latencyMs ?? null,
            }
          : null,
      };
    },
  },

  /** args: { q?, category? } -> [{ id, name, brand, category, type, typeLabel, variants: [...] }] */
  adminListProducts: {
    auth: 'admin',
    async run(ctx, args) {
      const catalog = await ctx.catalog();
      const q = cleanText(args.q).toLowerCase();
      const category = CATEGORIES.includes(args.category) ? args.category : undefined;
      return catalog
        .listProducts({ category })
        .map((p) => ({ product: p, brand: catalog.brand(p.brandId) }))
        .filter(({ product, brand }) => !q || `${brand?.name ?? ''} ${product.name} ${product.id}`.toLowerCase().includes(q))
        .sort((a, b) => (a.brand?.name ?? '').localeCompare(b.brand?.name ?? '') || a.product.name.localeCompare(b.product.name))
        .map(({ product, brand }) => ({
          id: product.id,
          name: product.name,
          brand: brand ? { id: brand.id, name: brand.name } : null,
          category: product.category,
          type: product.type,
          typeLabel: TYPE_LABEL[product.type] ?? product.type,
          sources: product.sources ?? [],
          variants: catalog.variantsOf(product.id).map((v) => ({
            id: v.id,
            name: v.name,
            code: primaryCode(v),
            msrpMinor: v.msrpMinor ?? null,
            currency: v.currency,
            images: catalog.imagesOf(v.id).map((i) => ({ id: i.id, status: i.status, license: i.license, provider: i.provider })),
            offerCount: catalog.offersOf(v.id).length,
          })),
        }));
    },
  },

  /**
   * args: { feed: string (JSON) } -> { accepted, rejected: [{ kind, id, problems }], byKind, created, updated, generatedImages }
   * Feed shape: { brands?, products, variants, images?, offers? } (arrays). Every record is
   * checked field by field (attributes with schema.validateAttributes) and by reference: a
   * product's brand, a variant's product and an image's or offer's variant must exist in the
   * catalog or be accepted earlier in the same feed. Retailers can't be added by a feed, offer
   * links must be on the retailer's .example domain, and missing costs stay unknown. Accepted
   * records are written, new versions without an image get a generated illustration record,
   * the catalog cache is invalidated and affected reference features are cleared.
   */
  adminImportFeed: {
    auth: 'admin',
    async run(ctx, args) {
      let feed = args.feed;
      if (typeof feed === 'string') {
        if (feed.length > MAX_FEED_CHARS) throw invalid({ feed: 'Split the feed into files under 2 MB' }, 'This feed is larger than 2 MB. Split it into smaller files.');
        try {
          feed = JSON.parse(feed);
        } catch {
          throw invalid({ feed: 'Not valid JSON' }, "This feed isn't valid JSON. Check it in a JSON validator and try again.");
        }
      }
      if (!isObj(feed)) throw invalid({ feed: 'Expected an object' }, 'A feed is a JSON object with products and variants lists.');
      const problems = {};
      for (const key of Object.keys(feed)) if (!FEED_KINDS.includes(key)) problems[key] = `${key} can't be imported from a feed`;
      for (const key of ['products', 'variants']) if (!Array.isArray(feed[key])) problems[key] = `${key} must be a list (it can be empty)`;
      for (const key of ['brands', 'images', 'offers']) if (feed[key] != null && !Array.isArray(feed[key])) problems[key] = `${key} must be a list`;
      for (const key of FEED_KINDS) if (Array.isArray(feed[key]) && feed[key].length > MAX_RECORDS) problems[key] = `Import at most ${MAX_RECORDS} ${key} at a time`;
      if (Object.keys(problems).length) throw invalid(problems, 'This feed has the wrong shape. Fix the listed parts and try again.');

      const catalog = await ctx.catalog();
      const nowIso = ctx.iso();
      const env = { catalog, nowIso, brands: new Map(), products: new Map(), variants: new Map(), identifiers: identifierOwners(catalog.listVariants(), null) };
      const accepted = { brands: [], products: [], variants: [], images: [], offers: [] };
      const rejected = [];
      const checkers = { brands: checkBrand, products: checkProduct, variants: checkVariant, images: checkImage, offers: checkOffer };
      const seen = Object.fromEntries(FEED_KINDS.map((k) => [k, new Set()]));

      for (const kind of FEED_KINDS) {
        for (const raw of feed[kind] ?? []) {
          const id = isObj(raw) && typeof raw.id === 'string' ? raw.id : null;
          if (!isObj(raw)) {
            rejected.push({ kind, id: null, problems: ['Each record must be an object'] });
            continue;
          }
          if (id && seen[kind].has(id)) {
            rejected.push({ kind, id, problems: [`${id} appears more than once in this feed`] });
            continue;
          }
          if (id) seen[kind].add(id);
          if (kind === 'variants') {
            // Uniqueness is checked against everyone else, including this feed's earlier rows.
            env.identifiers = identifierOwners([...catalog.listVariants().filter((v) => !env.variants.has(v.id)), ...env.variants.values()], null);
          }
          const result = checkers[kind](raw, env);
          if (result.problems) {
            rejected.push({ kind, id, problems: result.problems });
            continue;
          }
          accepted[kind].push(result.record);
          if (kind === 'brands') env.brands.set(id, result.record);
          if (kind === 'products') env.products.set(id, result.record);
          if (kind === 'variants') env.variants.set(id, result.record);
        }
      }

      // New versions need provenance for their catalog image; the demo draws it from the palette.
      const hasImage = new Set([...accepted.images, ...catalog.images.values()].map((i) => i.variantId));
      const generated = accepted.variants.filter((v) => !hasImage.has(v.id)).map((v) => generatedImageFor(v.id, nowIso));
      accepted.images.push(...generated);

      let created = 0;
      let updated = 0;
      const existsIn = {
        brands: (id) => catalog.brand(id),
        products: (id) => catalog.product(id),
        variants: (id) => catalog.variant(id),
        images: (id) => catalog.images.get(id),
        offers: (id) => catalog.offers.get(id),
      };
      for (const kind of FEED_KINDS) {
        for (const record of accepted[kind]) {
          if (existsIn[kind](record.id)) updated += 1;
          else created += 1;
          await ctx.db.put(STORE_FOR[kind], record);
        }
      }

      const affected = new Set(accepted.variants.map((v) => v.id));
      for (const p of accepted.products) for (const v of catalog.variantsOf(p.id)) affected.add(v.id);
      const featuresCleared = await clearFeatures(ctx, affected);
      ctx.invalidateCatalog();

      const total = FEED_KINDS.reduce((sum, k) => sum + accepted[k].length, 0);
      const byKind = Object.fromEntries(FEED_KINDS.map((k) => [k, { accepted: accepted[k].length, rejected: rejected.filter((r) => r.kind === k).length }]));
      await ctx.audit('catalog.imported', 'catalog', 'feed', { accepted: total, rejected: rejected.length, created, updated });
      await ctx.metric('catalog_imported', { accepted: total, rejected: rejected.length });
      return { accepted: total, rejected, byKind, created, updated, generatedImages: generated.length, featuresCleared };
    },
  },

  /** args: { status?: 'open'|'accepted'|'rejected'|'all' } -> [CorrectionView], newest first. Reporters are short hashes. */
  adminListCorrections: {
    auth: 'admin',
    async run(ctx, args) {
      const status = ['open', 'accepted', 'rejected', 'all'].includes(args.status) ? args.status : 'open';
      const [rows, catalog, names, salt] = await Promise.all([ctx.db.all('corrections'), ctx.catalog(), nameMap(ctx), hashSalt(ctx)]);
      return rows
        .filter((c) => status === 'all' || c.status === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((c) => correctionView(catalog, c, names, salt));
    },
  },

  /**
   * args: { correctionId, decision: 'accepted'|'rejected' } — accepted applies the fact and audits it.
   * The proposed value is re-checked against the field allowlist and the category rules, and
   * identifiers must stay unique. 'other' corrections are recorded as accepted but not applied
   * (they need a feed import). Rejected corrections record the decision only.
   */
  adminResolveCorrection: {
    auth: 'admin',
    async run(ctx, { correctionId, decision }) {
      const correction = typeof correctionId === 'string' ? await ctx.db.get('corrections', correctionId) : null;
      if (!correction) throw notFound('That correction');
      if (!['accepted', 'rejected'].includes(decision)) throw invalid({ decision: 'Choose accept or reject' }, 'Choose whether to accept or reject this correction.');
      if (correction.status !== 'open') throw new ApiError('conflict', 'This correction was already reviewed. Reload the list to see its decision.');
      const catalog = await ctx.catalog();
      const reviewed = { ...correction, status: decision, reviewedBy: ctx.actor.id, reviewedAt: ctx.iso(), applied: false };

      if (decision === 'accepted') {
        const target = correctionField(catalog, correction);
        if (target.problems) throw new ApiError('conflict', 'The product or version this correction is about is no longer in the catalog. Reject it instead.', { fields: target.problems });
        if (target.spec.type !== 'none') {
          const coerced = coerceCorrectionValue(target.spec, correction.proposedValue);
          if (coerced.problem) throw new ApiError('invalid', `The proposed value can't be applied: ${coerced.problem.toLowerCase()}. Reject it instead.`);
          const before = target.spec.get(target.record) ?? null;
          const next = writePath(target.record, target.spec.path, coerced.value);
          if (target.spec.path[0] === 'attributes') {
            const problems = validateAttributes(target.product.category, target.spec.level, next.attributes);
            if (problems.length) throw new ApiError('invalid', `The proposed value breaks the catalog rules (${problems.join('; ')}). Reject it instead.`);
          }
          if (target.spec.path[0] === 'identifiers') {
            const owner = identifierOwners(catalog.listVariants(), target.variant.id).get(coerced.value);
            if (owner) throw new ApiError('conflict', `${coerced.value} already belongs to another version (${owner}). Reject this correction or fix that version first.`);
          }
          await ctx.db.put(target.spec.level === 'variant' ? 'catalogVariants' : 'catalogProducts', next);
          ctx.invalidateCatalog();
          reviewed.applied = true;
          await ctx.audit('correction.accepted', 'correction', correction.id, {
            productId: correction.productId,
            variantId: correction.variantId,
            field: correction.field,
            from: before,
            to: coerced.value,
          });
        } else {
          await ctx.audit('correction.accepted', 'correction', correction.id, { productId: correction.productId, field: correction.field, applied: false });
        }
      } else {
        await ctx.audit('correction.rejected', 'correction', correction.id, { productId: correction.productId, field: correction.field });
      }
      await ctx.db.put('corrections', reviewed);
      const [fresh, names, salt] = await Promise.all([ctx.catalog(), nameMap(ctx), hashSalt(ctx)]);
      return correctionView(fresh, reviewed, names, salt);
    },
  },

  /** args: { status?, variantId? } -> [ImageView] with status, permissions and where it may be shown. */
  adminListImages: {
    auth: 'admin',
    async run(ctx, args) {
      const catalog = await ctx.catalog();
      const now = ctx.now();
      return [...catalog.images.values()]
        .filter((i) => (!IMAGE_STATUSES.includes(args.status) || i.status === args.status) && (!args.variantId || i.variantId === args.variantId))
        .map((i) => imageView(catalog, i, now))
        .sort((a, b) => (a.brandName ?? '').localeCompare(b.brandName ?? '') || (a.productName ?? '').localeCompare(b.productName ?? '') || a.id.localeCompare(b.id));
    },
  },

  /**
   * args: { imageId, status: 'active'|'expired'|'taken_down' } -> ImageView
   * Items that showed this image fall back to the person's photo or a placeholder with the
   * reason. Re-activating an image whose expiry passed counts as a fresh fetch.
   */
  adminSetImageStatus: {
    auth: 'admin',
    async run(ctx, { imageId, status }) {
      if (!IMAGE_STATUSES.includes(status)) throw invalid({ status: 'Choose active, expired or taken down' }, 'Choose a status for this image.');
      const image = typeof imageId === 'string' ? await ctx.db.get('catalogImages', imageId) : null;
      if (!image) throw notFound('That image');
      const now = ctx.now();
      const next = { ...image, status };
      if (status === 'active' && image.expiresAt && Date.parse(image.expiresAt) <= now) {
        next.fetchedAt = new Date(now).toISOString();
        next.expiresAt = image.permissions?.cacheTtlHours ? new Date(now + image.permissions.cacheTtlHours * 3600000).toISOString() : null;
      }
      await ctx.db.put('catalogImages', next);
      ctx.invalidateCatalog();
      await ctx.audit('image.status_changed', 'image', image.id, { from: image.status, to: status });
      return imageView(await ctx.catalog(), next, now);
    },
  },

  /** args: { variantId?, freshness?: 'fresh'|'aging'|'stale', retailerId? } -> [OfferView] with resolved lastCheckedAt. */
  adminListOffers: {
    auth: 'admin',
    async run(ctx, args) {
      const catalog = await ctx.catalog();
      const now = ctx.now();
      const hours = await freshnessHoursOf(ctx);
      return (await resolvedOffers(ctx, catalog, now))
        .map((o) => offerView(catalog, o, now, hours))
        .filter((o) => (!args.variantId || o.variantId === args.variantId) && (!args.retailerId || o.retailer?.id === args.retailerId) && (!args.freshness || o.freshness === args.freshness))
        .sort((a, b) => (a.lastCheckedAt ?? '').localeCompare(b.lastCheckedAt ?? '') || a.id.localeCompare(b.id));
    },
  },

  /**
   * args: { offerId } — marks the demo offer as checked now (checkedAt).
   * While the offers simulation is 'down' the check fails like a real feed outage would.
   */
  adminRefreshOffer: {
    auth: 'admin',
    async run(ctx, { offerId }) {
      const offer = typeof offerId === 'string' ? await ctx.db.get('offers', offerId) : null;
      if (!offer) throw notFound('That offer');
      if ((await simulationOf(ctx)).offers === 'down') {
        throw new ApiError('unavailable', 'The offers feed is down in the provider simulation, so this offer could not be checked. Set offers back to normal and try again.');
      }
      await ctx.db.put('offers', { ...offer, checkedAt: ctx.iso() });
      ctx.invalidateCatalog();
      await ctx.audit('offer.refreshed', 'offer', offer.id, {});
      const catalog = await ctx.catalog();
      const now = ctx.now();
      const resolved = ctx.providers.offers.list(catalog, offer.variantId, now).find((o) => o.id === offer.id);
      return offerView(catalog, resolved ?? { ...offer, lastCheckedAt: ctx.iso() }, now, await freshnessHoursOf(ctx));
    },
  },

  /**
   * Job status only: status, category, attempts, latency and error code, plus when it was
   * created and a salted person hash. No photos, crops, texts, results or user ids.
   * args: { status? } -> { jobs: [JobView], byStatus }
   */
  adminListJobs: {
    auth: 'admin',
    async run(ctx, args) {
      const salt = await hashSalt(ctx);
      const all = await ctx.db.all('matchJobs');
      const jobs = all
        .filter((j) => !args.status || j.status === args.status)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 200)
        .map((j) => jobView(j, salt));
      return { jobs, byStatus: countBy(all, (j) => j.status, ['queued', 'processing', 'done', 'error', 'timeout', 'rejected', 'confirmed']) };
    },
  },

  /** args: { jobId } -> JobView. Only 'error' and 'timeout' jobs; requeueMatchJob lives in matching.js. */
  adminRetryJob: {
    auth: 'admin',
    async run(ctx, { jobId }) {
      const job = typeof jobId === 'string' ? await ctx.db.get('matchJobs', jobId) : null;
      if (!job) throw notFound('That job');
      if (!['error', 'timeout'].includes(job.status)) throw new ApiError('conflict', 'Only failed or timed-out jobs can be retried.');
      await requeueMatchJob(ctx, job.id);
      await ctx.audit('match_job.retried', 'matchJob', job.id, {});
      return jobView((await ctx.db.get('matchJobs', job.id)) ?? job, await hashSalt(ctx));
    },
  },

  /** -> { simulation, providers: [{ id, name, detail, status, simulation, options }] } */
  adminGetProviders: {
    auth: 'admin',
    async run(ctx) {
      return providersView(ctx);
    },
  },

  /** args: { vision?: 'ok'|'timeout'|'error', offers?: 'ok'|'down', ocr?: 'ok'|'off' } -> same as adminGetProviders */
  adminSetProviderSimulation: {
    auth: 'admin',
    async run(ctx, args) {
      const errors = {};
      const patch = {};
      for (const [key, value] of Object.entries(args ?? {})) {
        if (value === undefined) continue;
        if (!SIMULATION_OPTIONS[key]) errors[key] = 'Unknown provider';
        else if (!SIMULATION_OPTIONS[key].includes(value)) errors[key] = `Choose ${SIMULATION_OPTIONS[key].join(', ')}`;
        else patch[key] = value;
      }
      if (Object.keys(errors).length) throw invalid(errors, 'Choose a simulation from the list for each provider.');
      const current = await simulationOf(ctx);
      const next = { ...current, ...patch };
      await ctx.config.set('providerSimulation', next);
      await ctx.audit('providers.simulation_changed', 'config', 'providerSimulation', { from: current, to: next });
      return providersView(ctx);
    },
  },

  /**
   * -> { weights, defaults, ranges: { key: { min, max, step, label, help } }, custom }
   * weights are what ranking uses now (engine/recommend.js normalizeWeights over config
   * 'rankingWeights'); custom is true when an admin has changed them.
   */
  adminGetWeights: {
    auth: 'admin',
    async run(ctx) {
      return weightsView(ctx);
    },
  },

  /**
   * args: { weights: { key: number }, reset?: boolean } -> same as adminGetWeights.
   * Keys must exist in DEFAULT_WEIGHTS and values must sit inside WEIGHT_RANGES. Partial
   * updates merge; reset returns to the defaults.
   */
  adminSetWeights: {
    auth: 'admin',
    async run(ctx, args) {
      if (args.reset) {
        await ctx.db.delete('config', 'rankingWeights');
        await ctx.audit('weights.reset', 'config', 'rankingWeights', {});
        return weightsView(ctx);
      }
      const weights = args.weights;
      if (!isObj(weights) || !Object.keys(weights).length) throw invalid({ weights: 'Send at least one weight' }, 'Choose a weight to change.');
      const errors = {};
      for (const [key, value] of Object.entries(weights)) {
        if (!Object.hasOwn(DEFAULT_WEIGHTS, key)) errors[`weights.${key}`] = 'Unknown weight';
        else if (typeof value !== 'number' || !Number.isFinite(value)) errors[`weights.${key}`] = 'Enter a number';
      }
      // The engine owns the ranges, so the editor and the ranking can't disagree about them.
      const checked = validateWeights(weights);
      for (const [key, message] of Object.entries(checked.errors)) errors[`weights.${key}`] ??= message;
      if (Object.keys(errors).length) throw invalid(errors, 'Some weights are outside their allowed range.');
      const current = (await weightsView(ctx)).weights;
      const next = { ...current };
      for (const key of Object.keys(weights)) next[key] = checked.weights[key];
      await ctx.config.set('rankingWeights', next);
      await ctx.audit('weights.changed', 'config', 'rankingWeights', { changed: Object.keys(weights) });
      return weightsView(ctx);
    },
  },

  /** Accounts as id, name, role only (policy.redactAccountForAdmin) plus assignments. -> { accounts, assignments } */
  adminListAccounts: {
    auth: 'admin',
    async run(ctx) {
      const [users, assignments, names] = await Promise.all([ctx.db.all('users'), ctx.db.all('stylistAssignments'), nameMap(ctx)]);
      return {
        accounts: users
          .map(redactAccountForAdmin)
          .sort((a, b) => (ACCOUNT_ROLE_ORDER[a.role] ?? 9) - (ACCOUNT_ROLE_ORDER[b.role] ?? 9) || a.displayName.localeCompare(b.displayName)),
        assignments: assignments
          .map((a) => assignmentView(a, names))
          .sort((a, b) => Number(b.active) - Number(a.active) || b.createdAt.localeCompare(a.createdAt)),
      };
    },
  },

  /** args: { stylistId, userId } -> AssignmentView. One live assignment per pair. */
  adminAssignStylist: {
    auth: 'admin',
    async run(ctx, { stylistId, userId }) {
      const stylist = typeof stylistId === 'string' ? await ctx.db.get('users', stylistId) : null;
      const user = typeof userId === 'string' ? await ctx.db.get('users', userId) : null;
      const errors = {};
      if (!stylist || stylist.role !== 'stylist') errors.stylistId = 'Choose a stylist account';
      if (!user || user.role !== 'user') errors.userId = 'Choose a person with a user account';
      if (Object.keys(errors).length) throw invalid(errors, 'Choose a stylist and a person to assign them to.');
      const existing = (await ctx.db.where('stylistAssignments', 'stylistId', stylist.id)).find((a) => a.userId === user.id && !a.endedAt);
      if (existing) throw new ApiError('conflict', `${stylist.displayName} is already assigned to ${user.displayName}.`);
      const assignment = { id: newId('asg'), stylistId: stylist.id, userId: user.id, assignedBy: ctx.actor.id, createdAt: ctx.iso(), endedAt: null };
      await ctx.db.put('stylistAssignments', assignment);
      await ctx.audit('stylist_assignment.created', 'stylistAssignment', assignment.id, { stylistId: stylist.id, userId: user.id });
      return assignmentView(assignment, await nameMap(ctx));
    },
  },

  /**
   * args: { assignmentId } -> AssignmentView. Access ends immediately: policy checks need a live
   * assignment, photo URLs already issued to the stylist for that person are revoked, and the
   * person's requests to that stylist are closed (status 'revoked', revokedReason
   * 'assignment_ended') so assigning the stylist again later doesn't reopen old shares.
   */
  adminEndAssignment: {
    auth: 'admin',
    async run(ctx, { assignmentId }) {
      const assignment = typeof assignmentId === 'string' ? await ctx.db.get('stylistAssignments', assignmentId) : null;
      if (!assignment) throw notFound('That assignment');
      if (assignment.endedAt) return assignmentView(assignment, await nameMap(ctx));
      const now = ctx.iso();
      const ended = { ...assignment, endedAt: now };
      await ctx.db.put('stylistAssignments', ended);
      revokePhotoUrls(ctx.providers.urls, { actorId: assignment.stylistId, ownerId: assignment.userId });
      const requests = (await ctx.db.where('stylistRequests', 'stylistId', assignment.stylistId)).filter((r) => r.userId === assignment.userId && r.status !== 'revoked');
      for (const request of requests) {
        await ctx.db.put('stylistRequests', { ...request, status: 'revoked', revokedAt: now, revokedReason: 'assignment_ended', updatedAt: now });
        await ctx.audit('stylist_request.revoked', 'stylistRequest', request.id, { stylistId: assignment.stylistId, reason: 'assignment_ended' });
      }
      await ctx.audit('stylist_assignment.ended', 'stylistAssignment', assignment.id, { stylistId: assignment.stylistId, userId: assignment.userId, requestsClosed: requests.length });
      return assignmentView(ended, await nameMap(ctx));
    },
  },

  /** Pseudonymous click records; never joined to users. args: { limit? } -> { clicks, summary } */
  adminListClicks: {
    auth: 'admin',
    async run(ctx, args) {
      const catalog = await ctx.catalog();
      const all = (await ctx.db.all('clicks')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const limit = Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, 500) : 200;
      const byRetailer = countBy(all, (c) => c.retailerId);
      return {
        clicks: all.slice(0, limit).map((c) => ({
          id: c.id,
          clickRef: c.clickRef,
          analyticsId: c.analyticsId,
          offerId: c.offerId,
          retailerId: c.retailerId,
          retailerName: catalog.retailer(c.retailerId)?.name ?? null,
          networkId: c.networkId ?? null,
          destination: c.destination,
          tracked: Boolean(c.tracked),
          createdAt: c.createdAt,
        })),
        summary: {
          total: all.length,
          tracked: all.filter((c) => c.tracked).length,
          untracked: all.filter((c) => !c.tracked).length,
          byRetailer: Object.entries(byRetailer)
            .map(([retailerId, count]) => ({ retailerId, name: catalog.retailer(retailerId)?.name ?? null, count }))
            .sort((a, b) => b.count - a.count),
        },
      };
    },
  },

  /**
   * -> { connected, network, report, summary, demo }
   * Until a network is connected: connected false, report null and summary from
   * engine/conversions.js summarize with revenue null (unknown, not zero). Demo events loaded
   * with adminLoadDemoConversions appear only under `demo` ({ label: 'Demo data', note,
   * eventCount, events, report: reconcileConversions(events), summary }), never in `summary`.
   */
  adminConversions: {
    auth: 'admin',
    async run(ctx) {
      return conversionsView(ctx);
    },
  },

  /**
   * Replaces any demo conversion events with a fresh generated set, every one labeled demo.
   * args: { seed?: positive integer } (same seed, same events) -> same as adminConversions
   */
  adminLoadDemoConversions: {
    auth: 'admin',
    async run(ctx, args = {}) {
      const seed = args.seed == null ? 1 : args.seed;
      if (!Number.isInteger(seed) || seed < 1 || seed > 1000000) throw invalid({ seed: 'Use a whole number from 1 to 1,000,000' });
      const clicks = await ctx.db.all('clicks');
      const events = demoConversionEvents(clicks, { seed, now: ctx.now(), catalog: await ctx.catalog() });
      for (const row of await ctx.db.all('conversions')) if (row.demo === true) await ctx.db.delete('conversions', row.id);
      await ctx.db.bulkPut('conversions', events.map((event) => ({ ...event, id: event.id ?? newId('conv'), demo: true })));
      await ctx.audit('conversions.demo_loaded', 'conversions', 'demo', { events: events.length, seed });
      return conversionsView(ctx);
    },
  },

  /** args: { report } — stores the latest synthetic evaluation report (config 'evalReport'). -> { ok, savedAt } */
  adminSaveEvalReport: {
    auth: 'admin',
    async run(ctx, { report }) {
      if (!isObj(report) || report.synthetic !== true) throw invalid({ report: 'Only synthetic evaluation reports can be saved' }, 'Only reports from the synthetic evaluation can be saved here.');
      if (!isDate(report.generatedAt) || !isObj(report.overall)) throw invalid({ report: 'Missing generatedAt or overall results' }, 'This report is missing its date or results. Run the evaluation again.');
      if (JSON.stringify(report).length > 500000) throw invalid({ report: 'Too large' }, 'This report is too large to store. Run a smaller evaluation.');
      const savedAt = ctx.iso();
      await ctx.config.set('evalReport', { ...report, savedAt });
      await ctx.audit('eval.saved', 'config', 'evalReport', { generatedAt: report.generatedAt });
      return { ok: true, savedAt };
    },
  },

  /** -> EvalReport | null */
  adminGetEvalReport: {
    auth: 'admin',
    async run(ctx) {
      const report = await ctx.config.get('evalReport');
      return isObj(report) ? report : null;
    },
  },
};
