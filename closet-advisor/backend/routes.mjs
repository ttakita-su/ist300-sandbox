// The local server's /api: a store's product page (lookup), Bing web and Shopping search (search),
// Bing visual search for a photo (lens) and a guarded store-image download (image).
//
// Every request except GET /api/status.json must be a POST from the Rotation page this server
// opened: X-Rotation: 1, the server's own Host (so DNS rebinding can't reach it), no Origin or our
// own, and not Sec-Fetch-Site: cross-site. There are no CORS headers anywhere, so another site's
// page can neither send the custom header nor read an answer. Every `reason` is a sentence that
// can be shown to the person. Photos stay in memory for their request only; the photo-search cache
// is keyed by a SHA-256 of the bytes and keeps answers, never the bytes.
import { createHash } from 'node:crypto';
import { validateImportUrl } from '../js/server/urlsafety.js';
import { sniffImageType, sniffStoreImageType, STORE_IMAGE_TYPES } from '../js/server/validate-image.js';
import { createCache } from './net.mjs';
import { extractProduct, looksLikeProduct, mergeShopifyProduct, shopifyProductJsonUrl, toPage } from './extract.mjs';
import { cleanQuery, createBing } from './bing.mjs';

export const JSON_BODY_LIMIT = 16 * 1024;
export const IMAGE_BODY_LIMIT = 6 * 1024 * 1024;

/** What GET /api/status.json says when this server answers (the committed file says { live: false }). */
export const LIVE_STATUS = { live: true, version: 1, engines: { lookup: 'page', search: 'bing', photo: 'bing' } };

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// Each route answers before the browser gives up (25 s for lookups and searches, 40 s for photos).
const LOOKUP_BUDGET_MS = 22000;
const SEARCH_BUDGET_MS = 22000;
const PHOTO_BUDGET_MS = 36000;

const START_HINT = 'Open Rotation at the address npm start printed, then try again.';

const REFUSALS = {
  method: `This address only takes POST requests from the Rotation app. ${START_HINT}`,
  getOnly: `This address only answers GET requests. ${START_HINT}`,
  host: `This server only answers at its own address. ${START_HINT}`,
  origin: `Requests from other websites aren't accepted. ${START_HINT}`,
  header: "This request didn't come from the Rotation app. Reload Rotation and try again.",
};

// What went wrong talking to Bing, in words: only a failed connection asks to check the internet.
function bingTrouble(code, who) {
  if (code === 'timeout') return `${who} took too long to answer. Try again in a minute.`;
  if (code === 'dns' || code === 'network') return `${who} couldn't be reached. Check the internet connection, then try again.`;
  if (code === 'http_error') return `${who} answered with an error. Try again in a few minutes.`;
  if (code === 'too_large') return `${who} sent an answer too large to read. Try again in a few minutes.`;
  return `${who} answered in a way Rotation doesn't understand; its page may have changed. Try again later.`;
}

const REASONS = {
  storeBlocked: (host) => `Automated lookups aren't allowed on ${host}. Enter the details yourself, or try another store's link.`,
  storeGone: (host) => `There's no page at that link on ${host}. Check the link, or search for the item by name.`,
  notProduct: (host) => `That page on ${host} doesn't look like a single product. Open the product itself and copy its link, or enter the details yourself.`,
  storeUnavailable(code, host, httpStatus) {
    if (code === 'dns') return `Rotation couldn't find a website at ${host}. Check the link for typos, then try again.`;
    if (code === 'timeout') return `The store at ${host} took too long to answer. Try again in a minute, or enter the details yourself.`;
    if (code === 'too_large') return `That page on ${host} is too large to read. Enter the details yourself.`;
    if (code === 'wrong_type') return `That link on ${host} isn't a web page. Copy the address of the product page itself.`;
    if (code === 'http_error' && httpStatus >= 500) return `The store at ${host} had a problem showing that page. Try again later, or enter the details yourself.`;
    if (code === 'http_error') return `The store at ${host} wouldn't show that page (error ${httpStatus}). Check the link, or enter the details yourself.`;
    return `Rotation couldn't connect to ${host}. Check the internet connection, then try again.`;
  },
  searchShort: 'Type at least 2 characters to search.',
  searchLong: 'Shorten the search to 200 characters or fewer.',
  searchBlocked: "Bing isn't accepting automated searches from this computer right now. Try again in about 30 minutes, or add the item yourself.",
  searchUnavailable: (code) => bingTrouble(code, 'Bing'),
  photoType: 'Send the photo as a JPEG, PNG or WebP image.',
  photoEmpty: 'The photo was empty. Take or choose the photo again.',
  photoLarge: 'The photo is larger than 6 MB. Choose a smaller photo, then try again.',
  photoNoMatch: "Bing couldn't name the item in this photo. Try a closer photo with the item filling the frame, or search by name.",
  photoBlocked: "Bing isn't accepting automated photo searches from this computer right now. Try again in about 30 minutes, or search by name.",
  photoSession: "Bing's photo search page has changed, so the photo couldn't be sent. Search by name instead.",
  photoUnavailable: (code) => bingTrouble(code, "Bing's photo search"),
  imageBlocked: (host) => `Automated downloads aren't allowed on ${host}. Save the item without the store's image.`,
  imageType: "That link isn't a JPEG, PNG, WebP, GIF or AVIF image.",
  imageLarge: "The store's image is larger than 10 MB, so it wasn't downloaded. Save the item without it.",
  imageUnavailable: (code, host) =>
    code === 'timeout' ? `The image from ${host} took too long to download. Try again, or save the item without it.` : `The image couldn't be downloaded from ${host}. Try again, or save the item without it.`,
  json: 'The request body must be JSON. Reload Rotation and try again.',
  jsonLarge: 'The request is too large. Reload Rotation and try again.',
  notFound: "That address isn't part of the Rotation server.",
  failed: 'Something went wrong in the local server. Try again, and restart npm start if it keeps happening.',
};

/**
 * POST /api/lookup: one product page (plus at most one Shopify .js follow-up on the same host).
 * @returns {Promise<{ status: 'found', page } | { status: 'not_product', host, reason, page }
 *   | { status: 'blocked', host, reason } | { status: 'invalid_url', code, reason }
 *   | { status: 'unavailable', host, reason }>}
 */
export async function lookupProduct(upstream, input, { now = Date.now } = {}) {
  const checked = validateImportUrl(input);
  if (!checked.ok) return { status: 'invalid_url', code: checked.reason, reason: checked.message };
  const deadline = now() + LOOKUP_BUDGET_MS;
  const res = await upstream.getText(checked.url, { kind: 'page', deadline });
  if (!res.ok) {
    if (res.status === 'invalid_url') return { status: 'invalid_url', code: res.code, reason: res.reason };
    if (res.status === 'blocked') return { status: 'blocked', host: res.host, reason: REASONS.storeBlocked(res.host) };
    if (res.code === 'http_error' && (res.httpStatus === 404 || res.httpStatus === 410)) {
      return { status: 'not_product', host: res.host, reason: REASONS.storeGone(res.host), page: null };
    }
    return { status: 'unavailable', host: res.host, reason: REASONS.storeUnavailable(res.code, res.host, res.httpStatus) };
  }
  let product = extractProduct(res.text, res.url);
  const shopifyUrl = product.platform === 'shopify' ? shopifyProductJsonUrl(res.url) : null;
  if (shopifyUrl) {
    // Shopify keeps prices in cents and lists every variant there; a failed follow-up keeps the page data.
    const js = await upstream.getText(shopifyUrl, { kind: 'json', deadline });
    if (js.ok) {
      try {
        product = mergeShopifyProduct(product, JSON.parse(js.text), product.price?.currency ?? product.currencyHint);
      } catch {
        // not JSON after all
      }
    }
  }
  // The time the store's page was fetched: an answer from the 15-minute cache keeps its own time.
  const page = toPage(product, { requestedUrl: checked.url, finalUrl: res.url, fetchedAt: new Date(res.fetchedAt ?? now()).toISOString() });
  if (!looksLikeProduct(product, page)) return { status: 'not_product', host: page.host, reason: REASONS.notProduct(page.host), page: page.name ? page : null };
  return { status: 'found', page };
}

function searchFailure(failures, reasons) {
  if (failures.some((f) => f.status === 'blocked')) return { status: 'blocked', reason: reasons.blocked };
  return { status: 'unavailable', reason: reasons.unavailable(failures.some((f) => f.code === 'timeout') ? 'timeout' : failures[0]?.code) };
}

/**
 * POST /api/search: Bing web results and Bing Shopping listings for a typed query.
 * @returns {Promise<{ status: 'ok', engine: 'bing', query, shopping, results } | { status: 'blocked' | 'unavailable' | 'invalid', reason }>}
 */
export async function searchStores(bing, input, { now = Date.now } = {}) {
  const query = cleanQuery(input);
  if (query.length < 2) return { status: 'invalid', reason: REASONS.searchShort };
  if (query.length > 200) return { status: 'invalid', reason: REASONS.searchLong };
  const deadline = now() + SEARCH_BUDGET_MS;
  const [web, shop] = await Promise.all([bing.webSearch(query, { deadline }), bing.shopping(query, { deadline })]);
  if (!web.ok && !shop.ok) return searchFailure([web, shop], { blocked: REASONS.searchBlocked, unavailable: REASONS.searchUnavailable });
  return { status: 'ok', engine: 'bing', query, shopping: shop.ok ? shop.listings : [], results: web.ok ? web.results : [] };
}

/**
 * POST /api/image: a store image through the guard, sniffed. Errors carry an HTTP status.
 * @returns {Promise<{ ok: true, type: string, finalUrl: string, body: Buffer } | { ok: false, httpStatus: number, json: { status, reason, code? } }>}
 */
export async function downloadImage(upstream, input) {
  const checked = validateImportUrl(input);
  if (!checked.ok) return { ok: false, httpStatus: 400, json: { status: 'invalid_url', code: checked.reason, reason: checked.message } };
  const res = await upstream.getBytes(checked.url, { kind: 'image' });
  if (!res.ok) {
    if (res.status === 'invalid_url') return { ok: false, httpStatus: 400, json: { status: 'invalid_url', code: res.code, reason: res.reason } };
    if (res.status === 'blocked') return { ok: false, httpStatus: 502, json: { status: 'blocked', reason: REASONS.imageBlocked(res.host) } };
    if (res.code === 'wrong_type') return { ok: false, httpStatus: 415, json: { status: 'unsupported', reason: REASONS.imageType } };
    if (res.code === 'too_large') return { ok: false, httpStatus: 502, json: { status: 'unavailable', reason: REASONS.imageLarge } };
    return { ok: false, httpStatus: res.code === 'timeout' ? 504 : 502, json: { status: 'unavailable', reason: REASONS.imageUnavailable(res.code, res.host) } };
  }
  const type = sniffStoreImageType(res.body.subarray(0, 64));
  if (!STORE_IMAGE_TYPES.includes(type)) return { ok: false, httpStatus: 415, json: { status: 'unsupported', reason: REASONS.imageType } };
  return { ok: true, type, finalUrl: res.url, body: res.body };
}

/**
 * The /api request handler.
 * @param {{ upstream: ReturnType<typeof import('./net.mjs').createUpstream>, allowedHosts: Set<string>, now?: () => number }} deps
 *   allowedHosts: lowercase Host header values this server answers to (filled once the port is known)
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, pathname: string) => Promise<void>}
 */
export function createApiHandler({ upstream, allowedHosts, now = Date.now }) {
  const bing = createBing({ upstream, now });
  const photoCache = createCache({ ttlMs: 15 * 60 * 1000, maxEntries: 200, now });
  const photoRuns = new Map();

  async function photoSearch(bytes, mime) {
    const key = createHash('sha256').update(bytes).digest('hex');
    const hit = photoCache.get(key);
    if (hit) return hit;
    if (photoRuns.has(key)) return photoRuns.get(key);
    const run = (async () => {
      const found = await bing.visualSearch(bytes, mime, { deadline: now() + PHOTO_BUDGET_MS });
      if (found.ok) return { status: 'ok', engine: 'bing', query: found.query, shopping: found.shopping, results: found.results };
      if (found.status === 'no_match') return { status: 'no_match', reason: REASONS.photoNoMatch };
      if (found.status === 'blocked') return { status: 'blocked', reason: REASONS.photoBlocked };
      return { status: 'unavailable', reason: found.code === 'session' ? REASONS.photoSession : REASONS.photoUnavailable(found.code) };
    })();
    photoRuns.set(key, run);
    try {
      const result = await run;
      if (result.status === 'ok' || result.status === 'no_match') photoCache.set(key, result);
      return result;
    } finally {
      photoRuns.delete(key);
    }
  }

  const routes = {
    '/api/lookup': { body: 'json', run: (args) => lookupProduct(upstream, args.url, { now }) },
    '/api/search': { body: 'json', run: (args) => searchStores(bing, args.query, { now }) },
    '/api/image': { body: 'json', run: (args) => downloadImage(upstream, args.url) },
    '/api/lens': { body: 'photo', run: (bytes, mime) => photoSearch(bytes, mime) },
  };

  function refusal(req) {
    if (req.method !== 'POST') return REFUSALS.method;
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!allowedHosts.has(host)) return REFUSALS.host;
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) return REFUSALS.origin;
    if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return REFUSALS.origin;
    if (req.headers['x-rotation'] !== '1') return REFUSALS.header;
    return null;
  }

  return async function handleApi(req, res, pathname) {
    try {
      if (pathname === '/api/status.json') {
        if (req.method === 'GET' || req.method === 'HEAD') return sendJson(res, 200, LIVE_STATUS, { head: req.method === 'HEAD' });
        return sendJson(res, 405, { status: 'method_not_allowed', reason: REFUSALS.getOnly }, { headers: { Allow: 'GET, HEAD' } });
      }
      // No CORS anywhere: a preflight from another site's page gets nothing it could use.
      if (req.method === 'OPTIONS') return sendJson(res, 405, { status: 'method_not_allowed', reason: REFUSALS.method }, { headers: { Allow: 'POST' } });
      const refused = refusal(req);
      if (refused) return sendJson(res, 403, { status: 'forbidden', reason: refused });
      const route = routes[pathname];
      if (!route) return sendJson(res, 404, { status: 'not_found', reason: REASONS.notFound });
      const type = mediaTypeOf(req.headers['content-type']);
      if (route.body === 'photo') {
        if (!PHOTO_TYPES.includes(type)) return sendJson(res, 415, { status: 'invalid', reason: REASONS.photoType });
        const bytes = await readBody(req, IMAGE_BODY_LIMIT);
        if (bytes === null) return sendJson(res, 413, { status: 'invalid', reason: REASONS.photoLarge });
        if (!bytes.length) return sendJson(res, 400, { status: 'invalid', reason: REASONS.photoEmpty });
        // The declared type is not trusted: the bytes must be a JPEG, PNG or WebP too.
        const sniffed = sniffImageType(bytes.subarray(0, 64));
        if (!PHOTO_TYPES.includes(sniffed)) return sendJson(res, 415, { status: 'invalid', reason: REASONS.photoType });
        return sendJson(res, 200, await route.run(bytes, sniffed));
      }
      if (type !== 'application/json') return sendJson(res, 415, { status: 'invalid', reason: REASONS.json });
      const raw = await readBody(req, JSON_BODY_LIMIT);
      if (raw === null) return sendJson(res, 413, { status: 'invalid', reason: REASONS.jsonLarge });
      let args;
      try {
        args = JSON.parse(raw.toString('utf8'));
      } catch {
        args = null;
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) return sendJson(res, 400, { status: 'invalid', reason: REASONS.json });
      const result = await route.run(args);
      if (pathname !== '/api/image') return sendJson(res, 200, result);
      if (!result.ok) return sendJson(res, result.httpStatus, result.json);
      return sendBytes(res, result);
    } catch (error) {
      // A request the browser gave up on needs no answer and no log line.
      if (!error?.aborted) console.error('Rotation server error:', error?.stack ?? error);
      sendJson(res, 500, { status: 'unavailable', reason: REASONS.failed });
    }
  };
}

function mediaTypeOf(header) {
  return String(header ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

// Resolves with the body, or null when it is larger than the limit (the rest is discarded by Node).
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      resolve(null);
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        chunks.length = 0;
        resolve(null);
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    const abort = (error) => {
      if (done) return;
      done = true;
      reject(Object.assign(error ?? new Error('The request was aborted.'), { aborted: true }));
    };
    req.on('error', abort);
    req.on('close', () => abort());
  });
}

const BASE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function sendJson(res, status, value, { head = false, headers = {} } = {}) {
  if (res.headersSent || res.destroyed) return;
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, ...headers });
  res.end(head ? undefined : body);
}

function sendBytes(res, { type, finalUrl, body }) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': body.length, 'X-Final-Url': finalUrl });
  res.end(body);
}
