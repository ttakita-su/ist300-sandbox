// Builds the Catalog object every engine takes (ARCHITECTURE.md section 4.2).

/**
 * @param {{ version?: string, brands: any[], products: any[], variants: any[], images: any[],
 *   retailers: any[], offers: any[] }} data
 */
export function buildCatalog(data) {
  const byId = (list) => new Map((list ?? []).map((x) => [x.id, x]));
  const brands = byId(data.brands);
  const products = byId(data.products);
  const variants = byId(data.variants);
  const images = byId(data.images);
  const retailers = byId(data.retailers);
  const offers = byId(data.offers);

  const group = (list, key) => {
    const map = new Map();
    for (const item of list ?? []) {
      const k = item[key];
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    }
    return map;
  };

  const variantsByProduct = group(data.variants, 'productId');
  const offersByVariant = group(data.offers, 'variantId');
  const imagesByVariant = group(data.images, 'variantId');

  return {
    version: data.version ?? 'unversioned',
    brands,
    products,
    variants,
    images,
    retailers,
    offers,
    variantsByProduct,
    offersByVariant,
    imagesByVariant,
    product: (id) => products.get(id) ?? null,
    variant: (id) => variants.get(id) ?? null,
    brand: (id) => brands.get(id) ?? null,
    retailer: (id) => retailers.get(id) ?? null,
    productOf(variantId) {
      const v = variants.get(variantId);
      return v ? products.get(v.productId) ?? null : null;
    },
    brandOf(productId) {
      const p = products.get(productId);
      return p ? brands.get(p.brandId) ?? null : null;
    },
    variantsOf: (productId) => variantsByProduct.get(productId) ?? [],
    offersOf: (variantId) => offersByVariant.get(variantId) ?? [],
    imagesOf: (variantId) => imagesByVariant.get(variantId) ?? [],
    listProducts({ category } = {}) {
      const all = [...products.values()];
      return category ? all.filter((p) => p.category === category) : all;
    },
    listVariants({ category } = {}) {
      const all = [...variants.values()];
      if (!category) return all;
      return all.filter((v) => products.get(v.productId)?.category === category);
    },
  };
}

/** Display name for a variant: "Kestrel Runner 2, Olive / Bone". */
export function variantTitle(catalog, variantId) {
  const v = catalog.variant(variantId);
  if (!v) return null;
  const p = catalog.product(v.productId);
  const b = p ? catalog.brand(p.brandId) : null;
  return `${b ? `${b.name} ` : ''}${p?.name ?? ''}, ${v.name}`.trim();
}

/** The identifier shown on labels: style code for sneakers/clothing, reference for watches. */
export function primaryCode(variant) {
  if (!variant) return null;
  return variant.identifiers?.styleCode ?? variant.identifiers?.reference ?? null;
}
