// Catalog reads: search, product and variant detail. Catalog facts are shared, not private.
import { notFound } from '../errors.js';
import { productSummary, variantView } from '../views.js';
import { TYPE_LABEL, STYLE_LABEL, CATEGORIES } from '../../data/schema.js';
import { colorLabel } from '../../data/colors.js';

/**
 * Lowercase word tokens. Catalog text also indexes the parts of codes (KR2-304 -> kr2, 304) so
 * "kr2" finds every Runner 2, while a typed code stays whole so it finds only its version.
 */
export function tokenize(text, { splitCodes = true } = {}) {
  const lower = String(text ?? '').toLowerCase();
  const words = lower.match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/g) ?? [];
  const out = new Set();
  for (const w of words) {
    out.add(w);
    if (splitCodes) for (const part of w.split(/[-.]/)) if (part) out.add(part);
  }
  return [...out];
}

function productTokens(catalog, product) {
  const brand = catalog.brand(product.brandId);
  return tokenize(
    [brand?.name, product.name, TYPE_LABEL[product.type], product.type, ...product.styleTags.map((t) => STYLE_LABEL[t] ?? t)]
      .filter(Boolean)
      .join(' '),
  );
}

function variantTokens(variant) {
  return tokenize(
    [
      variant.name,
      variant.identifiers?.styleCode,
      variant.identifiers?.reference,
      ...(variant.identifiers?.gtins ?? []),
      ...variant.colors.map((c) => colorLabel(c.name)),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

// Prefix matching lets "kest" find Kestrel; short tokens must match whole words.
const hits = (tokens, token) => tokens.includes(token) || (token.length >= 3 && tokens.some((t) => t.startsWith(token)));

/**
 * Every query token must appear in the product or one of its variants. Exact identifier hits
 * rank first, then product-level matches.
 */
export function searchProducts(catalog, { q, category, brandId, limit = 24 }) {
  const tokens = tokenize(q, { splitCodes: false });
  const results = [];
  for (const product of catalog.listProducts({ category })) {
    if (brandId && product.brandId !== brandId) continue;
    if (!tokens.length) {
      results.push({ product, score: 0, matchedVariantIds: [] });
      continue;
    }
    const pTokens = productTokens(catalog, product);
    const variants = catalog.variantsOf(product.id).map((v) => ({ v, tokens: variantTokens(v) }));
    let score = 0;
    const matched = new Set();
    let allMatched = true;
    for (const token of tokens) {
      const inProduct = hits(pTokens, token);
      const variantHits = variants.filter((entry) => hits(entry.tokens, token));
      if (!inProduct && !variantHits.length) {
        allMatched = false;
        break;
      }
      score += inProduct ? 2 : 1;
      for (const { v } of variantHits) {
        const ids = [v.identifiers?.styleCode, v.identifiers?.reference, ...(v.identifiers?.gtins ?? [])]
          .filter(Boolean)
          .map((s) => s.toLowerCase());
        if (ids.includes(token)) score += 10;
        matched.add(v.id);
      }
    }
    if (allMatched) results.push({ product, score, matchedVariantIds: [...matched] });
  }
  results.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name));
  return results.slice(0, limit);
}

export const ops = {
  /**
   * args: { q?, category?, brandId?, limit? }
   * result: [{ product: ProductSummary, variants: [VariantView], matchedVariantIds }]
   */
  searchCatalog: {
    auth: 'any',
    async run(ctx, args) {
      const catalog = await ctx.catalog();
      const category = CATEGORIES.includes(args.category) ? args.category : undefined;
      const now = ctx.now();
      return searchProducts(catalog, { q: args.q, category, brandId: args.brandId, limit: Math.min(args.limit ?? 24, 60) }).map((r) => ({
        product: productSummary(catalog, r.product),
        variants: catalog.variantsOf(r.product.id).map((v) => variantView(catalog, v, { now, context: 'product' })),
        matchedVariantIds: r.matchedVariantIds,
      }));
    },
  },

  /** args: { productId } -> full product with every variant and its facts. */
  getProduct: {
    auth: 'any',
    async run(ctx, { productId }) {
      const catalog = await ctx.catalog();
      const product = catalog.product(productId);
      if (!product) throw notFound('That product');
      const now = ctx.now();
      return {
        product: {
          ...productSummary(catalog, product),
          description: product.description,
          materials: product.materials,
          features: product.features,
          sizing: product.sizing,
          attributes: product.attributes,
          sources: product.sources,
        },
        variants: catalog.variantsOf(product.id).map((v) => variantView(catalog, v, { now, context: 'product' })),
      };
    },
  },

  /** args: { variantId } */
  getVariant: {
    auth: 'any',
    async run(ctx, { variantId }) {
      const catalog = await ctx.catalog();
      const variant = catalog.variant(variantId);
      if (!variant) throw notFound('That version');
      return {
        product: productSummary(catalog, catalog.product(variant.productId)),
        variant: variantView(catalog, variant, { now: ctx.now(), context: 'product' }),
      };
    },
  },

  listBrands: {
    auth: 'any',
    async run(ctx, { category } = {}) {
      const catalog = await ctx.catalog();
      return [...catalog.brands.values()]
        .filter((b) => !category || b.categories.includes(category))
        .map((b) => ({ id: b.id, name: b.name, categories: b.categories }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  },
};
