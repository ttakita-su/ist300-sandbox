// Decides which image represents an item, honouring catalog image source terms.
// The person's original photo is never replaced or deleted by this logic; it is the fallback.

/**
 * Whether a catalog image may be shown in a given context.
 * - inventory: needs inventoryDisplay; if requiresActiveOffer, the variant must have a live offer.
 * - product: sales context; requiresActiveOffer images need a live offer, others are fine.
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function imagePermitted(image, { context, now, hasActiveOffer }) {
  if (!image) return { ok: false, reason: 'No catalog image is available for this version.' };
  if (image.status === 'taken_down') return { ok: false, reason: 'The catalog image was withdrawn by its source.' };
  if (image.status === 'expired' || (image.expiresAt && Date.parse(image.expiresAt) <= now)) {
    return { ok: false, reason: "The catalog image expired and hasn't been refreshed." };
  }
  const perms = image.permissions ?? {};
  if (context === 'inventory' && !perms.inventoryDisplay) {
    return { ok: false, reason: "The catalog image's source only allows it next to a live offer, not in your collection." };
  }
  if (perms.requiresActiveOffer && !hasActiveOffer) {
    return { ok: false, reason: 'The catalog image can only be shown while a retailer is offering this version.' };
  }
  return { ok: true, reason: null };
}

function hasLiveOffer(catalog, variantId) {
  return catalog.offersOf(variantId).some((o) => o.listingStatus === 'active');
}

/** The best permitted catalog image for a variant in a context, or a reason there is none. */
export function catalogImageFor(catalog, variantId, { context, now }) {
  if (!variantId) return { image: null, reason: 'This version is not confirmed, so there is no catalog image.' };
  const images = catalog.imagesOf(variantId);
  const hasActiveOffer = hasLiveOffer(catalog, variantId);
  let lastReason = 'No catalog image is available for this version.';
  for (const image of images) {
    const verdict = imagePermitted(image, { context, now, hasActiveOffer });
    if (verdict.ok) return { image, reason: null };
    lastReason = verdict.reason;
  }
  return { image: null, reason: lastReason };
}

/**
 * Resolves the display image for an owned or wishlist item.
 * @param {any} item record with category, variantId, photos, display
 * @param {any} catalog
 * @param {number} now
 * @param {(variantId: string) => string} catalogUrl returns the image URL for a permitted variant
 */
export function resolveDisplayImage(item, catalog, now, catalogUrl) {
  const { image, reason } = catalogImageFor(catalog, item.variantId, { context: 'inventory', now });
  const originalId = item.photos?.originalId ?? null;
  const cleanedId = item.photos?.cleanedId ?? null;
  const options = [];
  if (image) options.push('catalog');
  if (originalId) options.push('original');
  if (cleanedId) options.push('cleaned');

  const catalogView = () => ({
    kind: 'catalog',
    url: catalogUrl(item.variantId),
    photoId: null,
    label: 'Catalog image',
    attribution: image.permissions?.attributionRequired ? image.attribution : null,
    fallbackReason: null,
    options,
  });
  const photoView = (kind, photoId, fallbackReason = null) => ({
    kind,
    url: null,
    photoId,
    label: kind === 'cleaned' ? 'Your photo, cleaned up' : 'Your photo',
    attribution: null,
    fallbackReason,
    options,
  });

  const wanted = item.display ?? (item.variantId ? 'catalog' : 'original');
  if (wanted === 'catalog') {
    if (image) return catalogView();
    const why = item.variantId ? reason : null;
    if (originalId) return photoView('original', originalId, why);
  }
  if (wanted === 'cleaned' && cleanedId) return photoView('cleaned', cleanedId);
  if ((wanted === 'original' || wanted === 'cleaned') && originalId) return photoView('original', originalId);
  if (image) return catalogView();
  return {
    kind: 'placeholder',
    url: null,
    photoId: null,
    label: null,
    attribution: null,
    fallbackReason: item.variantId ? reason : null,
    options,
  };
}
