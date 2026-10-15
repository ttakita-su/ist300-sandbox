// Marketplace search and StockX/GOAT link import. Nothing here contacts a marketplace: StockX and
// GOAT searches return their own public search link for the person to open, and pasted links are
// read as text (js/server/marketplaces.js).
import { ApiError, invalid } from '../errors.js';
import { MARKETPLACES, parseMarketplaceUrl, cleanQuery, INVALID_LINK_REASONS } from '../marketplaces.js';
import { marketplacesProvider } from '../providers/marketplaces.js';
import { searchProducts } from './catalog.js';
import { productSummary, variantView } from '../views.js';

const provider = (ctx) => ctx.providers.marketplaces ?? marketplacesProvider;

function resultViews(catalog, results, now) {
  return results.map((r) => ({
    product: productSummary(catalog, r.product),
    variants: catalog.variantsOf(r.product.id).map((v) => variantView(catalog, v, { now, context: 'product' })),
    matchedVariantIds: r.matchedVariantIds,
  }));
}

export const ops = {
  /** -> [{ id, name, connected, demo, note, searchUrlTemplate }] */
  listMarketplaces: {
    auth: 'user',
    async run(ctx) {
      return provider(ctx).list().map((s) => ({
        ...s,
        note: s.demo ? 'Searches the fictional demo catalog.' : MARKETPLACES[s.id].accessNote,
        searchUrlTemplate: s.demo ? null : MARKETPLACES[s.id].searchUrlTemplate,
      }));
    },
  },

  /**
   * args: { query, marketplaceId? }
   * -> { query, sources: [{ id, name, connected, demo, reason, searchUrl, results: [{ product, variants, matchedVariantIds }] }] }
   * StockX and GOAT are not connected: their results are empty and searchUrl opens their own
   * search page for the query. Demo results are real catalog products (fictional demo data).
   */
  searchMarketplaces: {
    auth: 'user',
    rateLimit: 'recs',
    async run(ctx, { query, marketplaceId } = {}) {
      const q = cleanQuery(query);
      if (!q) throw invalid({ query: 'Type a brand, model or style code to search' });
      const sources = provider(ctx).list().filter((s) => !marketplaceId || s.id === marketplaceId);
      if (!sources.length) throw new ApiError('not_found', 'That marketplace is not available.');
      const catalog = await ctx.catalog();
      const now = ctx.now();
      const out = [];
      for (const source of sources) {
        const found = await provider(ctx).search(source.id, q, { catalog });
        out.push({
          id: source.id,
          name: source.name,
          demo: source.demo,
          connected: found.connected,
          reason: found.reason,
          searchUrl: source.demo ? null : MARKETPLACES[source.id].searchUrl(q),
          results: source.demo ? resultViews(catalog, found.results, now) : [],
        });
      }
      await ctx.metric('marketplace_search', { sources: out.length });
      return { query: q, sources: out };
    },
  },

  /**
   * Reads a pasted StockX or GOAT product link as text and returns a draft for a custom item.
   * args: { url }
   * -> { ok: true, link: parse result, catalogMatches: [{ product, variants, matchedVariantIds }],
   *      draft: { category, custom: { brand, name, variantName, type, colors }, sourceUrl, styleCodeGuess,
   *               sizeGuess, evidence: { kind, source, detail } } }
   *  | { ok: false, reason: 'unsupported_marketplace' | 'not_a_product_page', message, marketplace }
   * Malformed or unsafe links throw ApiError('invalid', ..., { fields: { url } }). The draft never
   * carries a catalog identity; choosing a catalog match is a separate, explicit step.
   */
  importMarketplaceLink: {
    auth: 'user',
    async run(ctx, { url } = {}) {
      const link = parseMarketplaceUrl(url);
      if (!link.ok) {
        if (INVALID_LINK_REASONS.includes(link.reason)) throw new ApiError('invalid', link.message, { fields: { url: link.message } });
        return { ok: false, reason: link.reason, message: link.message, marketplace: link.marketplace };
      }
      const catalog = await ctx.catalog();
      const now = ctx.now();
      // An exact style code is the strongest hint; fall back to the brand and name words.
      let matches = link.styleCodeGuess ? searchProducts(catalog, { q: link.styleCodeGuess, category: link.categoryGuess, limit: 3 }) : [];
      if (!matches.length && link.nameGuess) {
        matches = searchProducts(catalog, { q: [link.brandGuess, link.nameGuess].filter(Boolean).join(' '), category: link.categoryGuess, limit: 3 });
      }
      await ctx.metric('marketplace_link_import', { marketplace: link.marketplace.id, matched: matches.length > 0 });
      return {
        ok: true,
        link,
        catalogMatches: resultViews(catalog, matches, now),
        draft: {
          category: link.categoryGuess,
          custom: { brand: link.brandGuess ?? '', name: link.nameGuess ?? '', variantName: null, type: null, colors: [] },
          sourceUrl: link.url,
          styleCodeGuess: link.styleCodeGuess,
          sizeGuess: link.sizeGuess,
          evidence: {
            kind: 'product_link',
            source: 'url',
            detail: `Name taken from your ${link.marketplace.name} link; not checked with ${link.marketplace.name}`,
          },
        },
      };
    },
  },
};
