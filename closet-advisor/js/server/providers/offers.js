// Demo offers provider: reads offers from the catalog and resolves when each was last checked.
// A real build replaces this with retailer/affiliate feed adapters behind the same interface.

/**
 * @param {any} catalog
 * @param {string} variantId
 * @param {number} now ms
 * @returns {any[]} offers with lastCheckedAt (ISO) resolved
 */
export function listOffers(catalog, variantId, now) {
  return catalog.offersOf(variantId).map((offer) => ({
    ...offer,
    lastCheckedAt: offer.checkedAt ?? new Date(now - (offer.demoAgeHours ?? 0) * 3600000).toISOString(),
  }));
}

export const offersProvider = {
  name: 'demo-offers',
  list: listOffers,
};
