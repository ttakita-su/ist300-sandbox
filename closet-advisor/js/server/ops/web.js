// Real product lookups through the local server (providers.web): a store's product page, a text
// search of Bing Shopping and the web, and saving a store's image on this device. Nothing here
// fetches; the provider does, and on GitHub Pages or in tests it answers 'not_connected'.
// Everything that comes back is a guess the person confirms: drafts never carry a catalog
// identity, a size or a condition, and a store price is a snapshot, never an offer. Metrics
// carry statuses and counts only, never URLs, hosts or queries.
import { ApiError, invalid } from '../errors.js';
import { validateImportUrl } from '../urlsafety.js';
import { marketplaceForHost } from '../marketplaces.js';
import { WEB_AVAILABILITY, cleanLinkUrl, cleanWebPrice, cleanWebText, displayHost, iso, webFetchedAt } from '../records.js';
import { draftFromWeb } from '../../engine/web-guess.js';
import { NOT_CONNECTED, notConnectedWeb } from '../providers/web.js';
import { storePhoto } from './photos.js';

const MAX_LISTINGS = 24;
const MAX_RESULTS = 10;
const MIN_QUERY = 2;
const MAX_QUERY = 200;
const PAGE_SOURCES = ['json-ld', 'microdata', 'meta', 'shopify', 'adapter', 'title'];
const PAGE_CONDITIONS = ['new', 'used', 'refurbished'];
// Bing's and MSN's own pages are never store results.
const ENGINE_HOSTS = /(?:^|\.)(?:bing\.com|msn\.com)$/;

const LOOKUP_UNAVAILABLE = "The store page couldn't be read right now. Try again in a moment, or enter the details yourself.";
const SEARCH_UNAVAILABLE = "Online stores couldn't be searched right now. Try again in a moment.";
const SEARCH_BLOCKED = "Bing isn't answering automated searches right now. Try again in about 30 minutes, or enter the details yourself.";
const NO_MATCH = "Bing couldn't tell what this is. Try a closer photo of just the item, or search by name.";
const IMAGE_UNAVAILABLE = "The store's image couldn't be saved. Save the item without it, or try again.";
const IMAGE_LINK = "The store image's link can't be used, so the image wasn't saved. Save the item without it.";
/** A photo search that outlived config.webSearchTimeoutMs. */
export const WEB_TIMEOUT = 'Searching online stores took too long. Try again in a moment.';

const provider = (ctx) => ctx.providers.web ?? notConnectedWeb;

const reasonOr = (out, fallback) => cleanWebText(out?.reason, 300) ?? fallback;
const hostOr = (value, fallback) => (typeof value === 'string' && /^[a-z0-9.-]{1,253}$/i.test(value) ? value.toLowerCase().replace(/^www\./, '') : fallback);

function isBlob(value) {
  return Boolean(value) && typeof value.size === 'number' && typeof value.slice === 'function' && typeof value.arrayBuffer === 'function';
}

/** Asks the provider; a provider that throws counts as one that couldn't answer. */
async function ask(call) {
  try {
    return await call();
  } catch {
    return null;
  }
}

/** A store page as the server read it (design Page shape), rebuilt from untrusted input. */
function cleanPage(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const url = cleanLinkUrl(raw.url);
  if (!url) return null;
  return {
    url,
    requestedUrl: cleanLinkUrl(raw.requestedUrl) ?? url,
    host: displayHost(url),
    siteName: cleanWebText(raw.siteName, 120),
    name: cleanWebText(raw.name, 200),
    brand: cleanWebText(raw.brand, 120),
    description: cleanWebText(raw.description, 1000),
    images: (Array.isArray(raw.images) ? raw.images : [])
      .map(cleanLinkUrl)
      .filter((u) => u && u.startsWith('https:'))
      .slice(0, 8),
    price: cleanWebPrice(raw.price),
    availability: WEB_AVAILABILITY.includes(raw.availability) ? raw.availability : null,
    // Shown as what the page said; never copied into the person's own records.
    condition: PAGE_CONDITIONS.includes(raw.condition) ? raw.condition : null,
    color: cleanWebText(raw.color, 120),
    sku: cleanWebText(raw.sku, 64),
    gtin: cleanWebText(raw.gtin, 64),
    mpn: cleanWebText(raw.mpn, 64),
    sizes: (Array.isArray(raw.sizes) ? raw.sizes : []).map((s) => cleanWebText(s, 24)).filter(Boolean).slice(0, 60),
    via: (Array.isArray(raw.via) ? raw.via : []).filter((v) => PAGE_SOURCES.includes(v)),
    fetchedAt: webFetchedAt(raw.fetchedAt, now),
  };
}

/** A Bing Shopping listing plus its draft. Listings without a title or a link are dropped. */
function cleanListing(raw, index, env) {
  if (!raw || typeof raw !== 'object') return null;
  const url = cleanLinkUrl(raw.url);
  const title = cleanWebText(raw.title, 200);
  if (!url || !title) return null;
  const listing = {
    id: cleanWebText(raw.id, 40) ?? `shop_${index + 1}`,
    title,
    price: cleanWebPrice(raw.price),
    priceText: cleanWebText(raw.priceText, 40),
    seller: cleanWebText(raw.seller, 120),
    imageUrl: cleanLinkUrl(raw.imageUrl),
    url,
    source: 'bing_shopping',
  };
  const draft = draftFromWeb({ listing, via: env.via, query: env.query, category: env.category, now: env.now });
  return draft ? { ...listing, draft } : null;
}

/** A web result (a page to open with lookupProductPage). No draft: the page itself is read first. */
function cleanResult(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const url = cleanLinkUrl(raw.url);
  const title = cleanWebText(raw.title, 200);
  const host = url ? displayHost(url) : null;
  if (!url || !title || !host || ENGINE_HOSTS.test(host)) return null;
  return { id: cleanWebText(raw.id, 40) ?? `web_${index + 1}`, title, url, host, snippet: cleanWebText(raw.snippet, 300), productPage: raw.productPage === true };
}

/**
 * Listings (each with a draft) and web results from a search or visual-search answer.
 * @param {any} out provider answer with status 'ok'
 * @param {{ via: 'search'|'photo', query: string|null, category?: string|null, now: number }} env
 */
export function cleanSearchLists(out, env) {
  const shopping = (Array.isArray(out?.shopping) ? out.shopping : [])
    .map((l, i) => cleanListing(l, i, env))
    .filter(Boolean)
    .slice(0, MAX_LISTINGS);
  const results = (Array.isArray(out?.results) ? out.results : [])
    .map(cleanResult)
    .filter(Boolean)
    .slice(0, MAX_RESULTS);
  return { shopping, results };
}

/**
 * What a photo search stores on the match job (job.web).
 * @param {any} out provider.searchImage answer
 * @param {{ category: string|null, now: number }} env
 * @returns {{ status: 'ok'|'no_match'|'not_connected'|'blocked'|'unavailable', engine: string|null,
 *   query: string|null, shopping: any[], results: any[], reason: string|null, searchedAt: string }}
 */
export function photoSearchResult(out, { category, now }) {
  const searchedAt = iso(now);
  const engine = cleanWebText(out?.engine, 20);
  const status = out?.status;
  if (status === 'ok') {
    const query = cleanWebText(out.query, 200);
    const lists = cleanSearchLists(out, { via: 'photo', query, category, now });
    return { status: 'ok', engine: engine ?? 'bing', query, ...lists, reason: null, searchedAt };
  }
  const failed = (s, reason) => ({ status: s, engine, query: null, shopping: [], results: [], reason, searchedAt });
  if (status === 'no_match') return failed('no_match', reasonOr(out, NO_MATCH));
  if (status === 'not_connected') return failed('not_connected', NOT_CONNECTED);
  if (status === 'blocked') return failed('blocked', reasonOr(out, SEARCH_BLOCKED));
  // 'invalid' (the photo couldn't be read) and anything unexpected are both "not now".
  return failed('unavailable', reasonOr(out, SEARCH_UNAVAILABLE));
}

/** Search words: control characters dropped, spaces collapsed. */
function cleanQueryText(query) {
  if (typeof query !== 'string') return '';
  return query.replace(/[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();
}

function lookupResult(out, { host, now }) {
  const status = out?.status;
  const where = hostOr(out?.host, host);
  if (status === 'found' || status === 'not_product') {
    const page = cleanPage(out.page, now);
    if (status === 'found' && page?.name) return { status: 'found', page, draft: draftFromWeb({ page, via: 'page', now }) };
    const reason = status === 'not_product' ? reasonOr(out, null) : null;
    return {
      status: 'not_product',
      host: page?.host ?? where,
      reason: reason ?? `That page on ${page?.host ?? where} doesn't look like a single product. Open the product itself and copy its link, or enter the details yourself.`,
      page,
      ...(page?.name ? { draft: draftFromWeb({ page, via: 'page', now }) } : {}),
    };
  }
  if (status === 'blocked') {
    return { status: 'blocked', host: where, reason: reasonOr(out, `Automated lookups aren't allowed on ${where}. Enter the details yourself, or try another store's link.`) };
  }
  if (status === 'invalid_url') {
    return { status: 'invalid_url', code: cleanWebText(out.code, 40) ?? 'malformed', reason: reasonOr(out, "That link can't be looked up. Copy the full link from the product page.") };
  }
  if (status === 'not_connected') return { status: 'not_connected', reason: NOT_CONNECTED };
  return { status: 'unavailable', host: where, reason: reasonOr(out, LOOKUP_UNAVAILABLE) };
}

function imageFailure(out) {
  const status = ['not_connected', 'blocked', 'invalid_url', 'unsupported'].includes(out?.status) ? out.status : 'unavailable';
  if (status === 'not_connected') return { status, reason: NOT_CONNECTED };
  return { status, reason: reasonOr(out, IMAGE_UNAVAILABLE) };
}

export const ops = {
  /** Whether real store lookups are on (the local server is running). args: {} -> { live, reason } */
  webStatus: {
    auth: 'user',
    async run(ctx) {
      const status = await ask(() => provider(ctx).status());
      if (status?.live === true) return { live: true, reason: null };
      return { live: false, reason: reasonOr(status, NOT_CONNECTED) };
    },
  },

  /**
   * Reads a store's product page through the local server. Rate limit: 'web', charged only when
   * the link is sent (an unsafe or malformed link costs nothing).
   * args: { url }
   * -> { status: 'found', page: Page, draft }
   *  | { status: 'not_product', host, reason, page: Page|null, draft? }   (draft when the page has a name)
   *  | { status: 'blocked', host, reason } | { status: 'invalid_url', code, reason }
   *  | { status: 'unavailable', host?, reason } | { status: 'not_connected', reason }
   * The link is checked with urlsafety.validateImportUrl first; an unsafe or malformed one never
   * reaches the provider. `draft` (engine/web-guess.js draftFromWeb, via 'page') is what the
   * save form starts from: { category, custom, web: WebSnapshot, imageUrl }.
   */
  lookupProductPage: {
    auth: 'user',
    rateLimit: 'web',
    chargeInRun: true,
    async run(ctx, { url } = {}) {
      const checked = validateImportUrl(url);
      if (!checked.ok) {
        await ctx.metric('web_lookup', { status: 'invalid_url' });
        return { status: 'invalid_url', code: checked.reason, reason: checked.message };
      }
      // StockX's and GOAT's terms forbid automated access, and both block it anyway, so their
      // pages are never requested: the screen reads the product from the link instead
      // (importMarketplaceLink). Nothing is charged for a request that isn't made.
      const market = marketplaceForHost(new URL(checked.url).hostname);
      if (market) {
        await ctx.metric('web_lookup', { status: 'blocked' });
        return { status: 'blocked', host: displayHost(checked.url), reason: `${market.name} doesn't allow automated lookups, so Rotation reads the product from the link instead.` };
      }
      ctx.rateLimit();
      const out = await ask(() => provider(ctx).lookup({ url: checked.url }));
      const result = lookupResult(out, { host: displayHost(checked.url), now: ctx.now() });
      await ctx.metric('web_lookup', { status: result.status });
      return result;
    },
  },

  /**
   * Searches Bing Shopping and the web for typed words through the local server. Rate limit:
   * 'web', charged only for a valid query.
   * args: { query } (2 to 200 characters, else invalid with fields.query)
   * -> { status: 'ok', engine: 'bing', query, shopping: [Listing & { draft }], results: [WebResult] }
   *  | { status: 'blocked'|'unavailable'|'invalid'|'not_connected', reason }
   * Listings are free Bing Shopping listings, each with a draft (via 'search'); results are
   * pages to open with lookupProductPage.
   */
  searchWebProducts: {
    auth: 'user',
    rateLimit: 'web',
    chargeInRun: true,
    async run(ctx, { query } = {}) {
      const q = cleanQueryText(query);
      if (q.length < MIN_QUERY) throw invalid({ query: 'Type at least 2 characters' }, 'Type what you want to find, like a brand and model.');
      if (q.length > MAX_QUERY) throw invalid({ query: 'Keep it under 200 characters' }, 'That search is too long. Type just the brand and model.');
      ctx.rateLimit();
      const out = await ask(() => provider(ctx).search({ query: q }));
      let result;
      if (out?.status === 'ok') {
        result = { status: 'ok', engine: cleanWebText(out.engine, 20) ?? 'bing', query: q, ...cleanSearchLists(out, { via: 'search', query: q, now: ctx.now() }) };
      } else if (out?.status === 'not_connected') {
        result = { status: 'not_connected', reason: NOT_CONNECTED };
      } else if (out?.status === 'blocked' || out?.status === 'invalid') {
        result = { status: out.status, reason: reasonOr(out, out.status === 'blocked' ? SEARCH_BLOCKED : 'That search could not be run. Type a brand and model, then try again.') };
      } else {
        result = { status: 'unavailable', reason: reasonOr(out, SEARCH_UNAVAILABLE) };
      }
      await ctx.metric('web_search', { status: result.status, kind: 'text', shopping: result.shopping?.length ?? 0, results: result.results?.length ?? 0 });
      return result;
    },
  },

  /**
   * Saves a store's image on this device as a photo of kind 'web', for photos.webId. The local
   * server downloads it; then it goes through the same checks and normalize step as an upload
   * (ops/photos.js storePhoto), so it is re-encoded and kept here like the person's photos.
   * Idempotent: only an 'ok' result is kept under the key, so a retry after a failure asks again.
   * Rate limit 'webImage' (api.js: its own, larger hourly limit, not the 'web' searches), charged
   * only when the link is sent; over it, the result is 'unavailable' with a reason saying so.
   * args: { imageUrl, pageUrl?, idempotencyKey }
   * -> { status: 'ok', photoId }
   *  | { status: 'invalid_url'|'not_connected'|'blocked'|'unsupported'|'invalid'|'unavailable', reason }
   * Never throws for an image that can't be fetched or kept, nor for the limit: saving the item
   * goes on without it.
   */
  importWebImage: {
    auth: 'user',
    idempotent: true,
    rateLimit: 'webImage',
    chargeInRun: true,
    keepResult: (result) => result?.status === 'ok',
    async run(ctx, { imageUrl, pageUrl } = {}) {
      const finish = async (result) => {
        await ctx.metric('web_image', { status: result.status });
        return result;
      };
      const checked = validateImportUrl(imageUrl);
      if (!checked.ok) return finish({ status: 'invalid_url', code: checked.reason, reason: IMAGE_LINK });
      try {
        ctx.rateLimit();
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'rate_limited') throw error;
        return finish({ status: 'unavailable', reason: `${error.message} Save the item without the store's image.` });
      }
      const out = await ask(() => provider(ctx).fetchImage({ url: checked.url }));
      if (out?.status !== 'ok' || !isBlob(out.blob)) return finish(imageFailure(out));
      try {
        const stored = await storePhoto(ctx, { blob: out.blob, kind: 'web', source: { imageUrl: checked.url, pageUrl } });
        return finish({ status: 'ok', photoId: stored.photoId });
      } catch (error) {
        if (error instanceof ApiError && ['invalid', 'unsupported'].includes(error.code)) return finish({ status: error.code, reason: error.message });
        return finish({ status: 'unavailable', reason: IMAGE_UNAVAILABLE });
      }
    },
  },
};

