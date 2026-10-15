// View builders: what operations return to screens (ARCHITECTURE.md 5.2). Views add the
// label-strip text and the resolved display image so screens don't need extra calls.
import { variantImageUrl } from '../data/illustrations.js';
import { primaryCode } from '../data/catalog-index.js';
import { resolveDisplayImage, catalogImageFor } from '../engine/provenance.js';
import { TYPE_LABEL } from '../data/schema.js';

const VERSION_WORD = { sneaker: 'Colorway', clothing: 'Color', watch: 'Reference' };

/** URL for a variant's catalog illustration (null if the variant is unknown). */
export function catalogUrlFor(catalog, variantId) {
  const variant = catalog.variant(variantId);
  if (!variant) return null;
  const product = catalog.product(variant.productId);
  return product ? variantImageUrl(product, variant) : null;
}

export function brandView(catalog, brandId) {
  const b = catalog.brand(brandId);
  return b ? { id: b.id, name: b.name } : null;
}

export function productSummary(catalog, product) {
  return {
    id: product.id,
    category: product.category,
    type: product.type,
    typeLabel: TYPE_LABEL[product.type] ?? product.type,
    name: product.name,
    brand: brandView(catalog, product.brandId),
    styleTags: product.styleTags,
  };
}

/** Variant facts plus its catalog image for a given context ('inventory' or 'product'). */
export function variantView(catalog, variant, { now, context = 'product' } = {}) {
  const product = catalog.product(variant.productId);
  const { image, reason } = catalogImageFor(catalog, variant.id, { context, now });
  return {
    id: variant.id,
    productId: variant.productId,
    name: variant.name,
    identifiers: variant.identifiers,
    code: primaryCode(variant),
    colors: variant.colors,
    attributes: variant.attributes,
    msrpMinor: variant.msrpMinor,
    currency: variant.currency,
    release: variant.release,
    image: image
      ? {
          url: product ? variantImageUrl(product, variant) : null,
          label: 'Catalog image',
          provider: image.provider,
          attribution: image.permissions?.attributionRequired ? image.attribution : null,
          license: image.license,
        }
      : { url: null, label: null, provider: null, attribution: null, license: null, unavailableReason: reason },
  };
}

function labelText(catalog, record) {
  const product = record.productId ? catalog.product(record.productId) : null;
  const variant = record.variantId ? catalog.variant(record.variantId) : null;
  const brand = product ? catalog.brand(product.brandId) : null;
  if (product) {
    return {
      product: productSummary(catalog, product),
      variant: variant
        ? { id: variant.id, name: variant.name, identifiers: variant.identifiers, colors: variant.colors, attributes: variant.attributes }
        : null,
      brandName: brand?.name ?? '',
      title: product.name,
      subtitle: variant ? variant.name : `${VERSION_WORD[product.category] ?? 'Version'} not confirmed`,
      code: primaryCode(variant),
    };
  }
  return {
    product: null,
    variant: null,
    brandName: record.custom?.brand ?? '',
    title: record.custom?.name ?? 'Untitled item',
    subtitle: record.custom?.variantName ?? (record.matchPending ? 'Matching in progress' : 'Custom item'),
    code: null,
  };
}

/**
 * @param {any} catalog
 * @param {any} item ownedItem record
 * @param {{ now: number, copies?: number }} env
 */
export function ownedView(catalog, item, env) {
  return {
    ...item,
    ...labelText(catalog, item),
    image: resolveDisplayImage(item, catalog, env.now, (id) => catalogUrlFor(catalog, id)),
    copies: env.copies ?? 1,
  };
}

/**
 * @param {any} catalog
 * @param {any} item wishlistItem record
 * @param {{ now: number }} env
 */
export function wishlistView(catalog, item, env) {
  // Wishlist items have no "display" preference: catalog image when permitted, else the photo.
  const record = { ...item, display: item.variantId ? 'catalog' : 'original', photos: { ...item.photos, cleanedId: null } };
  return {
    ...item,
    ...labelText(catalog, item),
    image: resolveDisplayImage(record, catalog, env.now, (id) => catalogUrlFor(catalog, id)),
  };
}

/** Counts active (not archived) copies per variant for one user's items. */
export function copyCounts(items) {
  const counts = new Map();
  for (const item of items) {
    if (item.archivedAt || !item.variantId) continue;
    counts.set(item.variantId, (counts.get(item.variantId) ?? 0) + 1);
  }
  return counts;
}
