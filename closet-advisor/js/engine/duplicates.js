// Duplicate detection for owned and wishlist items. A duplicate is a warning, not a block:
// people can own several physical copies of the same version.

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Active items that look like the same thing as `candidate`.
 * - Same catalog variant: duplicate.
 * - Same product with the variant unknown on either side: possible duplicate.
 * - Custom items: same category, brand and name.
 * @param {any[]} items records belonging to one person
 * @param {{ category?: string, productId?: string|null, variantId?: string|null, custom?: any }} candidate
 * @returns {any[]}
 */
export function findDuplicates(items, candidate) {
  const active = items.filter((i) => !i.archivedAt && i.status !== 'removed' && i.status !== 'purchased');
  if (candidate.variantId) {
    return active.filter((i) => i.variantId === candidate.variantId || (i.productId === candidate.productId && !i.variantId));
  }
  if (candidate.productId) {
    return active.filter((i) => i.productId === candidate.productId);
  }
  const brand = norm(candidate.custom?.brand);
  const name = norm(candidate.custom?.name);
  if (!brand || !name) return [];
  return active.filter((i) => !i.productId && i.category === candidate.category && norm(i.custom?.brand) === brand && norm(i.custom?.name) === name);
}
