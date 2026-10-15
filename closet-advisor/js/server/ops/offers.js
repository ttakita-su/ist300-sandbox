// Offers, outbound clicks and product-link import. Offers are public catalog data; clicks are
// pseudonymous (analyticsId, never a user id) and never touch wishlist or owned records.
import { ApiError, notFound, invalid } from '../errors.js';
import { compareOffers, FRESH_HOURS, AFFILIATE_DISCLOSURE } from '../../engine/offers.js';
import { buildOutboundUrl, newClickRef } from '../../engine/affiliate.js';
import { validateImportUrl, resolveRetailerUrl } from '../urlsafety.js';
import { productSummary, variantView } from '../views.js';
import { newId } from '../../lib/ids.js';
import { OFFER_CONDITIONS, WISH_CONDITIONS, validateSize } from '../../data/schema.js';

const CONDITIONS = [...WISH_CONDITIONS, ...OFFER_CONDITIONS];
const PRICES_DOWN = 'Retailer prices could not be checked right now. Try again shortly.';
const LISTING_GONE = 'This listing is no longer available.';

/**
 * Reads the requested size. A bare value ('10') takes the product's sizing system; unsized
 * products ignore the size, since watches aren't bought by size.
 */
function readSize(arg, product) {
  if (arg == null || arg === '' || !product?.sizing) return null;
  const size = typeof arg === 'string' ? { value: arg, system: product.sizing.system } : { value: arg.value, system: arg.system ?? product.sizing.system };
  if (size.value == null || String(size.value).trim() === '') return null;
  const raw = String(size.value).trim();
  const value = size.system === 'ALPHA' ? raw.toUpperCase() : size.system === 'WAIST-INSEAM' ? raw.toLowerCase().replace(/\s+/g, '') : raw;
  const normalized = { value, system: String(size.system) };
  const problem = validateSize(normalized, product.category);
  if (problem) throw invalid({ size: problem }, 'Choose a size from the list.');
  return normalized;
}

function retailerView(retailer) {
  return { id: retailer.id, name: retailer.name, domain: retailer.domain };
}

export const ops = {
  /**
   * args: { variantId, size?: {value, system} | string, condition?: 'new_only'|'new_or_used'|OFFER_CONDITION }
   * result: OffersView (engine/offers.js compareOffers; additions in docs/affiliate.md).
   * When providerSimulation.offers is 'down' it throws ApiError('unavailable').
   */
  getOffers: {
    auth: 'any',
    async run(ctx, args) {
      const catalog = await ctx.catalog();
      const variant = args.variantId ? catalog.variant(args.variantId) : null;
      if (!variant) throw notFound('That version');
      const product = catalog.product(variant.productId);
      const condition = args.condition ?? 'new_or_used';
      if (!CONDITIONS.includes(condition)) throw invalid({ condition: 'Choose new only, new or used, or one condition' }, 'Choose a condition from the list.');
      const size = readSize(args.size, product);

      const simulation = (await ctx.config.get('providerSimulation')) ?? {};
      if (simulation.offers === 'down') {
        await ctx.metric('provider_unavailable', { provider: 'offers' });
        throw new ApiError('unavailable', PRICES_DOWN);
      }
      const hours = await ctx.config.get('offerFreshnessHours');
      const freshnessHours = Number.isFinite(hours) && hours > 0 ? hours : FRESH_HOURS;
      const now = ctx.now();
      let offers;
      try {
        offers = await ctx.providers.offers.list(catalog, variant.id, now);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        await ctx.metric('provider_unavailable', { provider: 'offers' });
        throw new ApiError('unavailable', PRICES_DOWN);
      }
      return compareOffers({ catalog, offers: offers ?? [], variantId: variant.id, size, condition, now, freshnessHours });
    },
  },

  /**
   * Records an outbound click and returns the destination. Never marks anything purchased and
   * never counts as revenue. Only active listings can be opened.
   * args: { offerId, idempotencyKey } -> { clickRef, destination, tracked, retailer: {id, name, domain},
   *   affiliate: { network, status } | null, disclosure, offerId, variantId, productId }
   */
  createClick: {
    auth: 'any',
    idempotent: true,
    async run(ctx, { offerId }) {
      const catalog = await ctx.catalog();
      const offer = offerId ? catalog.offers.get(offerId) ?? null : null;
      if (!offer) throw notFound('That offer');
      const retailer = catalog.retailer(offer.retailerId);
      if (offer.listingStatus !== 'active' || !retailer) throw new ApiError('unavailable', LISTING_GONE);

      const clickRef = newClickRef();
      const outbound = buildOutboundUrl({ offer, retailer, clickRef });
      // Pseudonymous on purpose: the analytics id can't be joined to an account by the network.
      const click = {
        id: newId('clk'),
        clickRef,
        analyticsId: ctx.actor.analyticsId ?? null,
        offerId: offer.id,
        retailerId: retailer.id,
        networkId: outbound.network,
        destination: outbound.url,
        tracked: outbound.tracked,
        createdAt: ctx.iso(),
      };
      await ctx.db.put('clicks', click);
      await ctx.metric('outbound_click', { retailerId: retailer.id, tracked: outbound.tracked, condition: offer.condition });

      const program = retailer.affiliate;
      return {
        clickRef,
        destination: outbound.url,
        tracked: outbound.tracked,
        retailer: retailerView(retailer),
        affiliate: program ? { network: program.networkId ?? null, status: program.status } : null,
        disclosure: outbound.tracked ? AFFILIATE_DISCLOSURE : "This is a plain link. Rotation doesn't earn a commission from it.",
        offerId: offer.id,
        variantId: offer.variantId,
        productId: catalog.variant(offer.variantId)?.productId ?? null,
      };
    },
  },

  /**
   * Imports a product link. Validates with urlsafety.validateImportUrl (scheme, credentials,
   * private hosts, ports, length), then resolves demo retailer URLs to an offer/variant. It never
   * fetches the URL. `reason` is always a sentence that can be shown; `code` is machine-readable.
   * args: { url } -> { status: 'resolved', productId, variantId, offerId, retailerId, size, sizeNote,
   *                    listingStatus, url, product, variant, retailer }
   *               | { status: 'unsupported_link', host, code, reason, url }
   *               | { status: 'invalid_url', code, reason }
   */
  importFromUrl: {
    auth: 'user',
    async run(ctx, { url }) {
      const checked = validateImportUrl(url);
      if (!checked.ok) {
        await ctx.metric('url_import', { status: 'invalid_url', code: checked.reason });
        return { status: 'invalid_url', code: checked.reason, reason: checked.message };
      }
      const catalog = await ctx.catalog();
      const resolved = resolveRetailerUrl(checked.url, catalog);
      await ctx.metric('url_import', { status: resolved.status, code: resolved.code ?? null, retailerId: resolved.retailerId ?? null });
      if (resolved.status !== 'resolved') return { ...resolved, url: checked.url };
      return {
        ...resolved,
        url: checked.url,
        product: productSummary(catalog, catalog.product(resolved.productId)),
        variant: variantView(catalog, catalog.variant(resolved.variantId), { now: ctx.now(), context: 'product' }),
        retailer: retailerView(catalog.retailer(resolved.retailerId)),
      };
    },
  },
};
