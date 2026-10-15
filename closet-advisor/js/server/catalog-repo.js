// Catalog persistence: the static demo catalog is copied into IndexedDB so admin imports and
// accepted corrections persist. Engines read it through buildCatalog().
import * as demoCatalog from '../data/catalog.js';
import * as demoRetailers from '../data/retailers.js';
import { buildCatalog } from '../data/catalog-index.js';

const CATALOG_STORES = {
  catalogBrands: () => demoCatalog.brands,
  catalogProducts: () => demoCatalog.products,
  catalogVariants: () => demoCatalog.variants,
  catalogImages: () => demoCatalog.images,
  retailers: () => demoRetailers.retailers,
  offers: () => demoRetailers.offers,
};

/**
 * Seeds (or re-seeds after a catalog version change) the catalog stores.
 * A version bump replaces admin changes; that is acceptable for demo data.
 * @returns {Promise<boolean>} true when the stores were written
 */
export async function ensureCatalogSeeded(db) {
  const meta = await db.get('meta', 'catalogVersion');
  if (meta?.value === demoCatalog.CATALOG_VERSION) return false;
  for (const [store, source] of Object.entries(CATALOG_STORES)) {
    await db.clear(store);
    await db.bulkPut(store, source());
  }
  await db.clear('catalogFeatures');
  await db.put('meta', { key: 'catalogVersion', value: demoCatalog.CATALOG_VERSION });
  return true;
}

/** Loads the catalog from the db into the Catalog object (ARCHITECTURE.md 4.2). */
export async function loadCatalog(db) {
  const [brands, products, variants, images, retailers, offers] = await Promise.all([
    db.all('catalogBrands'),
    db.all('catalogProducts'),
    db.all('catalogVariants'),
    db.all('catalogImages'),
    db.all('retailers'),
    db.all('offers'),
  ]);
  const meta = await db.get('meta', 'catalogVersion');
  return buildCatalog({ version: meta?.value ?? demoCatalog.CATALOG_VERSION, brands, products, variants, images, retailers, offers });
}

/** Catalog straight from the static modules, for tests and offline tools. */
export function staticCatalog() {
  return buildCatalog({
    version: demoCatalog.CATALOG_VERSION,
    brands: demoCatalog.brands,
    products: demoCatalog.products,
    variants: demoCatalog.variants,
    images: demoCatalog.images,
    retailers: demoRetailers.retailers,
    offers: demoRetailers.offers,
  });
}
