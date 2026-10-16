// Bing web search, Bing Shopping and Bing visual search, read from Bing's own pages through the
// guarded upstream (same honest User-Agent, spacing, cache and cooldown as every other request).
// Ported from the search and photo-search probes, which ran live.
//
// Photo search follows Bing's own upload flow: GET /images (a session token and cookies, reused for
// 10 minutes) -> POST /images/kblob with the photo as base64 -> { redirectUrl: '/search?q=<name>' }
// where q is the name Bing recognized -> that results page plus Bing Shopping for the name. A failed
// upload is not retried, and only Bing gets the session cookies. Google is never contacted.
import { createCookieJar } from './net.mjs';
import { decodeEntities, isLikelyProductPage, normCurrency, toMinor } from './extract.mjs';
import { validateImportUrl } from '../js/server/urlsafety.js';

export const BING_ORIGIN = 'https://www.bing.com';
const SESSION_URL = `${BING_ORIGIN}/images?FORM=HDRSC2&setlang=en-us`;
const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_RESULTS = 10;
const MAX_LISTINGS = 24;
const UPLOAD_TYPES = ['application/json', 'text/json', 'text/plain', 'text/html', 'text/javascript', 'application/javascript'];

const text = (h = '') =>
  decodeEntities(String(h).replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
const siteOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const cap = (s, max) => (s && s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function cleanUrl(u) {
  try {
    const x = new URL(u);
    for (const p of ['msockid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) x.searchParams.delete(p);
    return x.href;
  } catch {
    return u;
  }
}

/** Collapses whitespace; '' for anything that isn't a string. */
export function cleanQuery(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Bing wraps outbound links as https://www.bing.com/ck/a?...&u=a1<base64url(target)>; this returns
 * the target (decoded, never followed). Other links are returned as they are.
 */
export function unwrapBing(href) {
  const h = decodeEntities(href);
  try {
    const u = new URL(h, BING_ORIGIN);
    if (/(^|\.)bing\.com$/.test(u.hostname) && u.pathname === '/ck/a') {
      const raw = u.searchParams.get('u') || '';
      if (raw.startsWith('a1')) {
        const target = Buffer.from(raw.slice(2), 'base64url').toString('utf8');
        // A relative target is a Bing page.
        return cleanUrl(new URL(target, BING_ORIGIN).href);
      }
    }
    return cleanUrl(u.href);
  } catch {
    return h;
  }
}

/**
 * Organic results of a Bing results page (li.b_algo), in page order.
 * @returns {{ title: string, url: string, snippet: string, site: string }[]}
 */
export function parseBingSerp(html) {
  const out = [];
  for (let block of String(html ?? '').split('<li class="b_algo"').slice(1)) {
    block = block.split(/<li class="b_(?:pag|ans|ad|msg)|<\/ol>/)[0];
    const h2 = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (!h2) continue;
    const a = h2[1].match(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const sn = block.match(/<p class="b_(?:lineclamp\d|algoSlug|paractl)[^"]*"[^>]*>([\s\S]*?)<\/p>/) || block.match(/<div class="b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const url = unwrapBing(a[1]);
    out.push({
      title: text(a[2]),
      url,
      snippet: sn ? text(sn[1].replace(/<span class="algoSlug_icon"[\s\S]*?<\/span>/, '')) : '',
      site: siteOf(url),
    });
  }
  return out;
}

/**
 * Free listings on a Bing Shopping page (li.br-item marked NonSponsoredOffer "true"). Ad cards
 * (br-gOffCard, rel="sponsored", aclick links) are never read.
 * @returns {{ title: string, priceText: string | null, seller: string | null, image: string | null, url: string | null }[]}
 */
export function parseBingShop(html) {
  const out = [];
  for (const chunk of String(html ?? '').split('<li class="br-item').slice(1)) {
    const block = chunk.split('</li>')[0];
    const openTag = block.slice(0, block.indexOf('>') + 1);
    if (!/NonSponsoredOffer(?:%3a%22|:"|&quot;:&quot;|:&quot;)true/i.test(decodeEntities(openTag))) continue;
    if (/rel="sponsored"|\/aclick\?/i.test(block)) continue;
    const b = block.replace(/<svg[\s\S]*?<\/svg>/g, '');
    const t = b.match(/class="br-title[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!t) continue;
    const full = t[1].match(/title="([^"]+)"/);
    const price = b.match(/class="(?:pd-price|br-price)[^"]*"[^>]*>(?:\s*<[^>]+>)*\s*([$€£][\d.,]+)/);
    const seller = b.match(/class="resp-one-line br-seller"[^>]*>([^<]+)</);
    // The main image box only (up to the end of its link): Bing lazy-loads most thumbnails from
    // data-src on a placeholder <div>, and later <img>s in the card are icons, not the product.
    const at = b.indexOf('br-pdMainImg');
    const end = at < 0 ? -1 : b.indexOf('</a>', at);
    const box = at < 0 ? '' : b.slice(at, end < 0 ? at + 3000 : end);
    const img = box.match(/\sdata-src-hq="([^"]+)"/) ?? box.match(/\sdata-src="([^"]+)"/) ?? box.match(/<img\b[^>]*?\ssrc="([^"]+)"/);
    const pd = b.match(/href="(\/shop\/productdetails[^"]+)"/);
    out.push({
      title: full ? text(full[1]) : text(t[1]),
      priceText: price ? price[1] : null,
      seller: seller ? text(seller[1]) : null,
      image: img ? decodeEntities(img[1]) : null,
      url: pd ? BING_ORIGIN + decodeEntities(pd[1]) : null,
    });
  }
  return out;
}

const SHOP_SYMBOL_CCY = { $: 'USD', '€': 'EUR', '£': 'GBP' };

/** "$1,299.99" -> { amountMinor: 129999, currency: 'USD' }; null when unreadable. */
export function shopPrice(priceText) {
  const m = /^\s*([$€£])\s*([\d.,]+)/.exec(String(priceText ?? ''));
  const currency = m ? normCurrency(SHOP_SYMBOL_CCY[m[1]]) : null;
  const amountMinor = currency ? toMinor(m[2], currency) : null;
  return amountMinor == null ? null : { amountMinor, currency };
}

// Results on these stores rank first (with product pages before other pages).
export const RETAILERS = ['amazon.com', 'walmart.com', 'target.com', 'nordstrom.com', 'macys.com', 'zappos.com', 'ebay.com', 'stockx.com', 'goat.com', 'footlocker.com', 'nike.com', 'adidas.com', 'levi.com', 'casio.com', 'seikowatches.com'];

/**
 * Puts results on known stores and product-looking URLs first; otherwise keeps Bing's order. A live
 * test showed site: operators in the query are ignored by Bing, so ranking happens here instead.
 */
export function rankForShopping(results, sites = RETAILERS) {
  const score = (r) => (sites.some((s) => r.site === s || r.site.endsWith(`.${s}`)) ? 2 : 0) + (isLikelyProductPage(r.url) ? 1 : 0);
  return [...results].map((r) => ({ ...r, productPage: isLikelyProductPage(r.url), score: score(r) })).sort((a, b) => b.score - a.score);
}

const INTERNAL_HOSTS = /(^|\.)(bing\.com|msn\.com|microsoft\.com|bing\.net)$/i;

/** API WebResults: public http(s) pages only, no Bing/MSN pages, deduplicated, ranked, at most 10. */
export function webResults(raw) {
  const seen = new Set();
  const usable = [];
  for (const r of raw) {
    const checked = validateImportUrl(r.url);
    if (!checked.ok || INTERNAL_HOSTS.test(new URL(checked.url).hostname) || seen.has(checked.url) || !r.title) continue;
    seen.add(checked.url);
    usable.push({ ...r, url: checked.url, site: siteOf(checked.url) });
  }
  return rankForShopping(usable)
    .slice(0, MAX_RESULTS)
    .map((r, i) => ({ id: `web_${i + 1}`, title: cap(r.title, 200), url: r.url, host: r.site, snippet: cap(r.snippet, 400), productPage: r.productPage }));
}

/** API Listings: free Bing Shopping listings with a title and a Bing product page, at most 24. */
export function shopListings(raw) {
  const out = [];
  for (const r of raw) {
    const page = r.url ? validateImportUrl(r.url) : null;
    if (!r.title || !page?.ok || siteOf(page.url) !== 'bing.com') continue;
    const image = r.image ? validateImportUrl(r.image) : null;
    out.push({
      id: `shop_${out.length + 1}`,
      title: cap(r.title, 200),
      price: shopPrice(r.priceText),
      priceText: r.priceText,
      seller: r.seller ? cap(r.seller, 120) : null,
      imageUrl: image?.ok && image.url.startsWith('https://') ? image.url : null,
      url: page.url,
      source: 'bing_shopping',
    });
    if (out.length >= MAX_LISTINGS) break;
  }
  return out;
}

// Bing's own challenge page wording. "challenge" alone is not used: normal Bing pages contain it.
const BING_CHALLENGE = /captcha|verify you are (?:a )?human|unusual traffic/gi;
// Bing's pages repeat the typed query (title, search box, "no results for ..."), so the generic
// block check in net.mjs is off for them (only 401/403/429 count there) and this file decides.
const BING_REQUEST = { blockCheck: 'status' };

async function multipart(fields) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const encoded = new Response(form);
  return { body: Buffer.from(await encoded.arrayBuffer()), type: encoded.headers.get('content-type') };
}

/**
 * Bing search and photo search over the guarded upstream. Holds the photo-search session (token
 * and cookies) in memory only.
 * @param {{ upstream: ReturnType<typeof import('./net.mjs').createUpstream>, now?: () => number }} deps
 * @returns {{ webSearch(query: string, opts?: { deadline?: number }): Promise<object>,
 *   shopping(query: string, opts?: { deadline?: number }): Promise<object>,
 *   visualSearch(bytes: Uint8Array, mime: string, opts?: { deadline?: number }): Promise<object> }}
 */
export function createBing({ upstream, now = Date.now }) {
  let session = null;
  let opening = null;

  const blockedResult = () => ({ ok: false, status: 'blocked', code: 'challenge', host: 'bing.com' });

  // A results page with no results and Bing's challenge wording is a block, even with status 200.
  // Wording that is part of what the person typed is Bing echoing the query, not a challenge.
  function challenged(html, count, query = '') {
    if (count > 0) return false;
    const typed = query.toLowerCase();
    for (const m of html.matchAll(BING_CHALLENGE)) {
      if (typed.includes(m[0].toLowerCase())) continue;
      upstream.markBlocked('bing.com');
      return true;
    }
    return false;
  }

  async function openSession() {
    const jar = createCookieJar('bing.com');
    const page = await upstream.getText(SESSION_URL, { kind: 'page', jar, cache: false, ...BING_REQUEST });
    if (!page.ok) return page;
    const header = page.text.match(/data-kblobstheader="([^"]+)"/)?.[1];
    const token = decodeEntities(page.text.match(/data-kblobsttoken="([^"]+)"/)?.[1] ?? '');
    if (!header || !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(header) || !/^[\x21-\x7e]{1,2048}$/.test(token)) {
      if (challenged(page.text, 0)) return blockedResult();
      return { ok: false, status: 'unavailable', code: 'session', host: 'bing.com' };
    }
    session = { jar, header, token, at: now() };
    return { ok: true, session };
  }

  // The token and cookies are reused for 10 minutes; a new one is fetched only after that.
  function getSession() {
    if (session && now() - session.at < SESSION_TTL_MS) return Promise.resolve({ ok: true, session });
    opening ??= openSession().finally(() => {
      opening = null;
    });
    return opening;
  }

  async function readSerp(url, query, opts) {
    const page = await upstream.getText(url, { kind: 'page', ...opts, ...BING_REQUEST });
    if (!page.ok) return page;
    const raw = parseBingSerp(page.text);
    if (challenged(page.text, raw.length, query)) return blockedResult();
    return { ok: true, results: webResults(raw) };
  }

  /** Bing web results for a query. */
  function webSearch(query, { deadline } = {}) {
    const url = `${BING_ORIGIN}/search?q=${encodeURIComponent(query)}&setlang=en-US&cc=US`;
    return readSerp(url, query, { deadline });
  }

  /** Free Bing Shopping listings for a query. */
  async function shopping(query, { deadline } = {}) {
    const page = await upstream.getText(`${BING_ORIGIN}/shop?q=${encodeURIComponent(query)}&setlang=en-US`, { kind: 'page', deadline, ...BING_REQUEST });
    if (!page.ok) return page;
    const raw = parseBingShop(page.text);
    if (challenged(page.text, raw.length, query)) return blockedResult();
    return { ok: true, listings: shopListings(raw) };
  }

  /**
   * Identifies the item in a photo, then reads Bing's results page and Bing Shopping for the name.
   * @param {Uint8Array} bytes JPEG, PNG or WebP (the app sends its 768 px copy)
   * @param {string} mime
   * @param {{ deadline?: number }} [opts] results and listings are skipped when the time runs out
   * @returns {Promise<{ ok: true, query: string, results: object[], shopping: object[] }
   *   | { ok: false, status: 'no_match' | 'blocked' | 'unavailable' | 'invalid_url', code: string }>}
   */
  async function visualSearch(bytes, mime, { deadline = now() + 36000 } = {}) {
    const opened = await getSession();
    if (!opened.ok) return opened;
    const { jar, header, token } = opened.session;
    const imageBin = Buffer.from(bytes).toString('base64');
    const form = await multipart({ imgurl: '', cbir: 'sbi', imageBin });
    const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const qs = new URLSearchParams({ iss: 'sbiupload', FORM: 'SBIIRP', sbisrc: 'ImgPicker', sbifnm: `photo.${extension}`, ptime: '15', dlen: String(imageBin.length) });
    const upload = await upstream.request(`${BING_ORIGIN}/images/kblob?${qs}`, {
      method: 'POST',
      kind: 'json',
      types: UPLOAD_TYPES,
      accept: '*/*',
      body: form.body,
      jar,
      headers: { 'Content-Type': form.type, Origin: BING_ORIGIN, Referer: SESSION_URL, [header]: token },
      deadline,
      ...BING_REQUEST,
    });
    // Not retried, and the session is kept: it is refreshed only when it is 10 minutes old.
    if (!upload.ok) return upload;
    let redirectUrl = null;
    try {
      redirectUrl = JSON.parse(upload.body.toString('utf8'))?.redirectUrl ?? null;
    } catch {
      return { ok: false, status: 'unavailable', code: 'bad_response', host: 'bing.com' };
    }
    let serpUrl = null;
    try {
      serpUrl = typeof redirectUrl === 'string' ? new URL(redirectUrl, BING_ORIGIN) : null;
    } catch {
      serpUrl = null;
    }
    // The answer must stay on Bing; anything else is treated as "no match", never followed.
    if (!serpUrl || serpUrl.origin !== BING_ORIGIN) return { ok: false, status: 'no_match', code: 'no_redirect' };
    const query = cleanQuery(serpUrl.searchParams.get('q')).slice(0, 200);
    if (query.length < 2) return { ok: false, status: 'no_match', code: 'no_query' };
    serpUrl.searchParams.set('setlang', 'en-us');

    // With the name known, results and listings are a bonus: they are skipped when time runs out.
    const enoughTime = deadline - now() > 1000;
    const [serp, shop] = await Promise.all([
      enoughTime ? readSerp(serpUrl.href, query, { jar, cache: false, headers: { Referer: SESSION_URL }, deadline }) : null,
      enoughTime ? shopping(query, { deadline }) : null,
    ]);
    return { ok: true, query, results: serp?.ok ? serp.results : [], shopping: shop?.ok ? shop.listings : [] };
  }

  return { webSearch, shopping, visualSearch };
}
