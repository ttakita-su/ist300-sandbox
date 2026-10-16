// The guarded upstream. Every request the local server sends to another site goes through
// createUpstream(): the URL and every redirect hop are checked with js/server/urlsafety.js, every
// DNS answer is checked and the connection is pinned to the checked address, bytes are capped after
// decompression, only expected content types are accepted, no cookies are sent (Bing's own jar is
// the one exception), and the User-Agent says what this is. Requests to one host are queued and
// spaced, answers are cached for 15 minutes, identical in-flight requests are shared, and a host
// that blocks us goes on a 30-minute cooldown. Nothing is retried.
//
// The transport (DNS + one HTTP exchange) is injectable so tests never touch the network; every
// check above still runs with a fake transport.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { validateImportUrl, checkRedirectChain, parseIPv4, parseIPv6, isBlockedIPv4, isBlockedIPv6 } from '../js/server/urlsafety.js';

export const USER_AGENT = 'Mozilla/5.0 (compatible; RotationLookup/0.1; educational prototype)';

const MB = 1024 * 1024;

/** Request kinds: byte cap after decompression, allowed content types and the default Accept. */
export const KINDS = {
  page: {
    maxBytes: 8 * MB,
    types: ['text/html', 'application/xhtml+xml'],
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  },
  json: {
    maxBytes: 2 * MB,
    // Shopify serves /products/<handle>.js as text/javascript.
    types: ['application/json', 'text/json', 'text/javascript', 'application/javascript', 'application/x-javascript'],
    accept: 'application/json,text/javascript;q=0.9,*/*;q=0.1',
  },
  image: {
    maxBytes: 10 * MB,
    // Some CDNs label images as octet-stream; the bytes are sniffed afterwards either way.
    types: ['image/*', 'application/octet-stream', 'binary/octet-stream'],
    accept: 'image/webp,image/jpeg,image/png;q=0.9,*/*;q=0.5',
  },
};

/** Limits and politeness settings; createUpstream() options override them (tests use 0 ms spacing). */
export const DEFAULTS = {
  timeoutMs: 12000,
  maxRedirects: 5,
  minIntervalMs: 1000,
  cacheTtlMs: 15 * 60 * 1000,
  cacheMaxEntries: 200,
  cacheMaxBytes: 64 * MB,
  cooldownMs: 30 * 60 * 1000,
};

// Same wording as urlsafety.js uses for a private IP in the link itself.
const PRIVATE_DNS_MESSAGE = "That link points to a private or reserved network address, not a public store. Use the store's product page link.";

// Callers can add headers (Bing's token, Origin, Referer) but never these.
const RESERVED_HEADERS = new Set(['cookie', 'user-agent', 'host', 'accept-encoding', 'content-length', 'connection', 'transfer-encoding']);

const DNS_ERRORS = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NONAME', 'EAI_NODATA', 'ENODATA', 'ESERVFAIL', 'ENOTIMP', 'EREFUSED']);

/** Host key for spacing and cooldowns: lowercase, no trailing dot, no leading www. */
export function siteKey(hostname) {
  return String(hostname ?? '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

/** True when a resolved address is public unicast (not loopback, private, link-local, metadata...). */
export function isPublicAddress({ address, family } = {}) {
  const text = String(address ?? '');
  const fam = family === 6 || family === 'IPv6' ? 6 : family === 4 || family === 'IPv4' ? 4 : net.isIP(text);
  if (fam === 4) {
    const ip = parseIPv4(text);
    return ip != null && !isBlockedIPv4(ip);
  }
  if (fam === 6) {
    const groups = parseIPv6(text);
    return groups != null && !isBlockedIPv6(groups);
  }
  return false;
}

// Block and challenge pages seen live: Akamai (edgesuite, CPR, error code 0.x), DataDome,
// PerimeterX, Cloudflare challenge scripts, Amazon's robot check and a waiting room.
const CHALLENGE_MARKERS =
  /errors\.edgesuite\.net|Reference Error: 0\.[0-9a-f]+\.|error code: 0\.[0-9a-f]+\.\d+\.[0-9a-f]+|CPR 403 ERROR|captcha-delivery\.com|px-captcha|_pxCaptcha|cf_chl_opt|cf-browser-verification|Hang Tight! Routing to checkout|Type the characters you see in this image|\/errors\/validateCaptcha/i;
const CHALLENGE_TITLE =
  /^(?:access denied|just a moment|attention required|security check|robot check|are you a (?:human|robot)|verify(?:ing)? (?:you are|that you are|your request)|captcha|pardon our interruption|request blocked|(?:sorry, )?you have been blocked|bot (?:check|detection)|waiting room|you are (?:now )?in line)/i;
// Generic wording, a title phrase and Akamai's reference number only count on small pages: real
// product pages are far bigger, may mention a captcha in a sign-up form, may be named "Access
// Denied Hoodie", and watch pages quote reference numbers like "Reference #310.30.42.50.01.002".
const CHALLENGE_PHRASES =
  /verify (?:that )?you are (?:a )?human|are you a robot|unusual traffic|captcha|enable javascript and cookies to continue|checking your browser|verifying your (?:request|browser|connection)|(?:verify|confirm|prove)\b[^.<]{0,60}\b(?:a human|not a (?:ro)?bot)|Reference #\d{1,3}\.[0-9a-f]{6,8}\.\d{9,10}\.[0-9a-f]{4,8}\b|\b0\.[0-9a-f]{8}\.\d{10}\.[0-9a-f]{8}\b/i;
const SMALL_PAGE_BYTES = 40000;
const BLOCK_SCAN_CHARS = 300000;
const MAX_TAG_CHARS = 4096;

// The first <title>'s text, read with bounded scans (no regex runs to the end of the page once per
// "<title" in it).
function titleOf(html) {
  const open = /<title\b/i.exec(html);
  if (!open) return null;
  const end = html.indexOf('>', open.index);
  if (end < 0 || end - open.index > MAX_TAG_CHARS) return null;
  const rest = html.slice(end + 1, end + 1 + 2000);
  const close = rest.search(/<\/title\s*>/i);
  return close < 0 ? null : rest.slice(0, close).slice(0, 300).replace(/\s+/g, ' ').trim();
}

// The page without scripts, styles and tags, in one linear pass.
function visibleText(html) {
  const open = /<(script|style)\b/gi;
  const parts = [];
  let at = 0;
  let m;
  while ((m = open.exec(html))) {
    const close = new RegExp(`</${m[1]}\\s*>`, 'gi');
    close.lastIndex = open.lastIndex;
    const c = close.exec(html);
    // An unclosed script stays as text, like before; nothing after it is searched again.
    if (!c) break;
    parts.push(html.slice(at, m.index));
    at = open.lastIndex = c.index + c[0].length;
  }
  parts.push(html.slice(at));
  // [^<>] keeps this linear: a "<" with no ">" is not searched to the end of the page.
  return parts.join(' ').replace(/<[^<>]*>/g, ' ');
}

/**
 * Decides whether a response is a block: 401, 403 or 429, or a CAPTCHA, bot-check, block or
 * waiting-room page with any status. Every scan is bounded, so a hostile page can't stall it.
 * @param {number} status
 * @param {string} contentType media type without parameters ('' when missing)
 * @param {Buffer|string} body
 * @param {{ statusOnly?: boolean }} [options] statusOnly: only the HTTP status counts (Bing's own
 *   pages echo the typed query, so bing.mjs checks those itself)
 * @returns {string|null} 'http_403' | 'http_429' | 'http_401' | 'challenge' | null
 */
export function detectBlock(status, contentType, body, { statusOnly = false } = {}) {
  if (status === 401 || status === 403 || status === 429) return `http_${status}`;
  if (statusOnly) return null;
  const textual = !contentType || /^text\/|html|xml|json|javascript/.test(contentType);
  if (!textual || body == null || body.length === 0) return null;
  const head = typeof body === 'string' ? body.slice(0, BLOCK_SCAN_CHARS) : body.subarray(0, BLOCK_SCAN_CHARS).toString('utf8');
  if (CHALLENGE_MARKERS.test(head)) return 'challenge';
  if (body.length < SMALL_PAGE_BYTES) {
    const title = titleOf(head);
    if (title && CHALLENGE_TITLE.test(title)) return 'challenge';
    if (CHALLENGE_PHRASES.test(visibleText(head))) return 'challenge';
  }
  return null;
}

/** Media type without parameters, lowercase ('' when missing). */
export function mediaType(header) {
  return String(header ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function typeAllowed(type, types, body) {
  if (!type) {
    // A missing Content-Type is accepted for images (sniffed later), JSON (parsed later) and pages
    // that start like HTML.
    if (types.includes('text/html')) return /^\s*(?:<!doctype html|<html)/i.test(body.subarray(0, 512).toString('utf8'));
    return true;
  }
  return types.some((t) => (t.endsWith('/*') ? type.startsWith(t.slice(0, -1)) : t === type));
}

/** Decodes a text body with the charset from the header or a <meta charset>, else UTF-8. */
export function decodeText(body, contentTypeHeader) {
  const fromHeader = /charset=["']?([\w.:-]+)/i.exec(String(contentTypeHeader ?? ''))?.[1];
  const fromMeta = fromHeader ? null : /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(body.subarray(0, 4096).toString('latin1'))?.[1];
  try {
    return new TextDecoder(fromHeader ?? fromMeta ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/**
 * A small in-memory cache with a time limit, an entry limit and a byte budget (oldest out first).
 * @param {{ ttlMs: number, maxEntries: number, maxBytes?: number, now?: () => number }} options
 */
export function createCache({ ttlMs, maxEntries, maxBytes = Infinity, now = Date.now }) {
  const entries = new Map();
  let bytes = 0;
  const drop = (key) => {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    bytes -= entry.size;
  };
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires <= now()) {
        drop(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value, size = 0) {
      drop(key);
      // One huge answer must not push everything else out.
      if (size > maxBytes / 4) return;
      entries.set(key, { value, size, expires: now() + ttlMs });
      bytes += size;
      while (entries.size > maxEntries || bytes > maxBytes) drop(entries.keys().next().value);
    },
    clear() {
      entries.clear();
      bytes = 0;
    },
    get size() {
      return entries.size;
    },
  };
}

/**
 * A cookie jar for one site (Bing). Cookies are kept in memory by name only; attributes are ignored
 * and nothing is sent to any other host.
 * @param {string} domain e.g. 'bing.com'
 */
export function createCookieJar(domain) {
  const cookies = new Map();
  const matches = (url) => {
    const host = siteKey(new URL(url).hostname);
    return host === domain || host.endsWith(`.${domain}`);
  };
  return {
    domain,
    header(url) {
      if (!cookies.size || !matches(url)) return null;
      return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    },
    store(url, setCookie) {
      if (!setCookie || !matches(url)) return;
      for (const line of [].concat(setCookie)) {
        const pair = String(line).split(';')[0];
        const eq = pair.indexOf('=');
        const name = eq > 0 ? pair.slice(0, eq).trim() : '';
        if (!name || pair.length > 4096) continue;
        cookies.set(name, pair.slice(eq + 1).trim());
        if (cookies.size > 50) cookies.delete(cookies.keys().next().value);
      }
    },
    get size() {
      return cookies.size;
    },
  };
}

// One queue per host: a request starts only after the previous one to that host finished and at
// least minIntervalMs after it started.
function createLanes({ now, sleep, intervalMs }) {
  const lanes = new Map();
  const noop = () => {};
  return function run(host, task) {
    const lane = lanes.get(host) ?? { tail: Promise.resolve(), last: -Infinity };
    lanes.set(host, lane);
    const turn = lane.tail.then(async () => {
      // Checked again after waking: a timer can fire a millisecond early by the wall clock.
      for (let wait = lane.last + intervalMs - now(); wait > 0; wait = lane.last + intervalMs - now()) await sleep(wait);
      lane.last = now();
      return task();
    });
    lane.tail = turn.then(noop, noop);
    return turn;
  };
}

function errorCode(error) {
  if (error?.code === 'ETIMEDOUT' || error?.name === 'TimeoutError') return 'timeout';
  if (error?.code === 'ETOOLARGE') return 'too_large';
  if (DNS_ERRORS.has(error?.code)) return 'dns';
  return 'network';
}

// A promise that rejects with ETIMEDOUT after ms (real time), unless the work settles first.
function withTimeout(promise, ms) {
  let timer;
  const limit = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('The request timed out.'), { code: 'ETIMEDOUT' })), Math.max(0, ms));
    timer.unref?.();
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

function lowerHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers ?? {})) out[name.toLowerCase()] = value;
  return out;
}

/**
 * @typedef {{ address: string, family: 4 | 6 }} Address
 * @typedef {{
 *   resolve(hostname: string): Promise<Address[]>,
 *   send(request: { url: URL, addresses: Address[], method: string, headers: Record<string, string>,
 *     body: Buffer | null, timeoutMs: number, maxBytes: number }): Promise<{ status: number,
 *     headers: Record<string, string | string[]>, body: Buffer }>
 * }} Transport
 *
 * @typedef {{ ok: true, status: number, url: string, host: string, contentType: string,
 *     headers: Record<string, any>, body: Buffer, fetchedAt: number, text?: string }
 *   | { ok: false, status: 'invalid_url', code: string, reason: string, host: string | null }
 *   | { ok: false, status: 'blocked', code: string, host: string, httpStatus?: number }
 *   | { ok: false, status: 'unavailable', code: 'dns' | 'timeout' | 'network' | 'too_large' | 'wrong_type'
 *       | 'http_error' | 'redirect', host: string, httpStatus?: number }} UpstreamResult
 *   fetchedAt is when the answer arrived from the site (ms), so a cached answer keeps its own time.
 */

/**
 * The guarded upstream.
 * @param {{ transport?: Transport, now?: () => number, sleep?: (ms: number) => Promise<void>,
 *   timeoutMs?: number, maxRedirects?: number, minIntervalMs?: number, cacheTtlMs?: number,
 *   cacheMaxEntries?: number, cacheMaxBytes?: number, cooldownMs?: number }} [options]
 */
export function createUpstream(options = {}) {
  const transport = options.transport ?? nodeTransport();
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) if (Number.isFinite(options[key])) settings[key] = options[key];

  const cache = createCache({ ttlMs: settings.cacheTtlMs, maxEntries: settings.cacheMaxEntries, maxBytes: settings.cacheMaxBytes, now });
  const inflight = new Map();
  const cooldowns = new Map();
  const lane = createLanes({ now, sleep, intervalMs: settings.minIntervalMs });

  function cooldownUntil(hostname) {
    const host = siteKey(hostname);
    const until = cooldowns.get(host);
    if (until == null) return 0;
    if (until > now()) return until;
    cooldowns.delete(host);
    return 0;
  }

  function markBlocked(hostname) {
    cooldowns.set(siteKey(hostname), now() + settings.cooldownMs);
  }

  const unavailable = (host, code, httpStatus) => ({ ok: false, status: 'unavailable', code, host, ...(httpStatus ? { httpStatus } : {}) });
  const invalidUrl = (code, reason, host) => ({ ok: false, status: 'invalid_url', code, reason, host });

  function requestHeaders(url, accept, extra, jar) {
    const headers = { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9', 'Accept-Encoding': 'gzip, deflate, br' };
    for (const [name, value] of Object.entries(extra ?? {})) {
      if (!RESERVED_HEADERS.has(name.toLowerCase()) && value != null) headers[name] = String(value);
    }
    const cookie = jar?.header(url.href);
    if (cookie) headers.Cookie = cookie;
    return headers;
  }

  async function exchange(firstUrl, { method, accept, maxBytes, types, headers: extra, body, jar, timeoutMs, until, statusOnly }) {
    const chain = [firstUrl];
    const firstHost = siteKey(new URL(firstUrl).hostname);
    const cooling = (host) => ({ ok: false, status: 'blocked', code: 'cooldown', host });
    let deadline = null;
    for (;;) {
      const url = new URL(chain.at(-1));
      const host = siteKey(url.hostname);
      if (cooldownUntil(host)) return cooling(host);

      let addresses;
      try {
        // DNS is inside the time limits too: a hung resolver must not outlive the route.
        const dnsLeft = Math.min(timeoutMs, until - now(), deadline == null ? Infinity : deadline - now());
        if (dnsLeft <= 0) return unavailable(host, 'timeout');
        addresses = await withTimeout(Promise.resolve().then(() => transport.resolve(url.hostname.replace(/^\[|\]$/g, ''))), dnsLeft);
      } catch (error) {
        return unavailable(host, errorCode(error) === 'timeout' ? 'timeout' : 'dns');
      }
      if (!Array.isArray(addresses) || !addresses.length) return unavailable(host, 'dns');
      // Every answer must be public, so a mixed answer can't be used to reach a private one.
      if (!addresses.every(isPublicAddress)) return invalidUrl('private_address', PRIVATE_DNS_MESSAGE, host);

      // Caller headers (Referer, Bing's token) go to the first host only, never to a redirect target.
      const headers = requestHeaders(url, accept, host === firstHost ? extra : {}, jar);
      const response = await lane(host, async () => {
        // The request ahead in the queue may have been blocked while this one waited.
        if (cooldownUntil(host)) return { cooldown: true };
        // The time limit covers the whole redirect chain, starting when the first hop starts.
        deadline ??= Math.min(now() + timeoutMs, until);
        const left = deadline - now();
        if (left <= 0) return { error: 'timeout' };
        try {
          return await transport.send({ url, addresses, method, headers, body, timeoutMs: left, maxBytes });
        } catch (error) {
          return { error: errorCode(error) };
        }
      });
      if (response.cooldown) return cooling(host);
      if (response.error) return unavailable(host, response.error);

      const status = Number(response.status);
      const answer = lowerHeaders(response.headers);
      jar?.store(url.href, answer['set-cookie']);
      if (status >= 300 && status < 400 && answer.location) {
        if (method !== 'GET') return unavailable(host, 'redirect');
        chain.push(String(answer.location));
        const checked = checkRedirectChain(chain, { maxHops: settings.maxRedirects });
        if (!checked.ok) return invalidUrl(checked.reason, checked.message, host);
        chain[chain.length - 1] = checked.url;
        continue;
      }

      const bytes = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body ?? '');
      const contentType = mediaType(answer['content-type']);
      const block = detectBlock(status, contentType, bytes, { statusOnly });
      if (block) {
        markBlocked(host);
        return { ok: false, status: 'blocked', code: block, host, httpStatus: status };
      }
      if (status < 200 || status > 299) return unavailable(host, 'http_error', status);
      if (bytes.length > maxBytes) return unavailable(host, 'too_large');
      if (!typeAllowed(contentType, types, bytes)) return unavailable(host, 'wrong_type');
      return { ok: true, status, url: url.href, host, contentType, headers: answer, body: bytes, fetchedAt: now() };
    }
  }

  /**
   * One guarded request. GET answers are cached (unless a cookie jar is used or cache is false) and
   * identical in-flight GETs share one upstream request.
   * @param {string} input
   * @param {{ kind?: 'page' | 'json' | 'image', method?: string, accept?: string, maxBytes?: number,
   *   types?: string[], headers?: Record<string, string>, body?: Buffer | null,
   *   jar?: ReturnType<typeof createCookieJar> | null, cache?: boolean, timeoutMs?: number,
   *   deadline?: number, blockCheck?: 'page' | 'status' }} [opts] timeoutMs can only shorten the
   *   12 s limit; deadline is an absolute time (ms) for routes that make several requests;
   *   blockCheck 'status' trusts only 401/403/429 (for pages that echo what the person typed)
   * @returns {Promise<UpstreamResult>}
   */
  async function request(input, opts = {}) {
    const kindName = opts.kind ?? 'page';
    const kind = KINDS[kindName];
    if (!kind) throw new Error(`Unknown request kind ${kindName}`);
    const checked = validateImportUrl(input);
    if (!checked.ok) return invalidUrl(checked.reason, checked.message, null);
    const method = String(opts.method ?? 'GET').toUpperCase();
    const settingsForCall = {
      method,
      accept: opts.accept ?? kind.accept,
      maxBytes: Math.min(opts.maxBytes ?? kind.maxBytes, kind.maxBytes),
      types: opts.types ?? kind.types,
      headers: opts.headers ?? {},
      body: opts.body ?? null,
      jar: opts.jar ?? null,
      timeoutMs: Math.max(1, Math.min(opts.timeoutMs ?? settings.timeoutMs, settings.timeoutMs)),
      until: Number.isFinite(opts.deadline) ? opts.deadline : Infinity,
      statusOnly: opts.blockCheck === 'status',
    };
    const cacheable = method === 'GET' && !settingsForCall.jar && opts.cache !== false;
    const key = cacheable ? `${kindName} ${settingsForCall.statusOnly ? 'status' : 'page'} ${settingsForCall.accept} ${checked.url}` : null;
    if (key) {
      const hit = cache.get(key);
      if (hit) return hit;
      const pending = inflight.get(key);
      if (pending) return pending;
    }
    const run = exchange(checked.url, settingsForCall).then((result) => {
      if (key && result.ok) cache.set(key, result, result.body.length);
      return result;
    });
    if (!key) return run;
    inflight.set(key, run);
    try {
      return await run;
    } finally {
      inflight.delete(key);
    }
  }

  return {
    request,
    /** GET a page (or JSON with kind 'json') and decode its text. */
    async getText(url, opts = {}) {
      const result = await request(url, { kind: 'page', ...opts });
      return result.ok ? { ...result, text: decodeText(result.body, result.headers['content-type']) } : result;
    },
    /** GET bytes (an image by default). */
    getBytes(url, opts = {}) {
      return request(url, { kind: 'image', ...opts });
    },
    markBlocked,
    cooldownUntil,
    /** Forgets cached answers and cooldowns (tests). */
    reset() {
      cache.clear();
      cooldowns.clear();
    },
  };
}

/**
 * The real transport: OS DNS lookup, and node:http(s) connecting only to the addresses the
 * upstream already checked (pinned with a custom lookup, so DNS rebinding can't slip in).
 * Decompresses gzip, deflate and brotli and stops reading once maxBytes is passed.
 * @returns {Transport}
 */
export function nodeTransport() {
  return {
    async resolve(hostname) {
      const family = net.isIP(hostname);
      if (family) return [{ address: hostname, family }];
      return dns.promises.lookup(hostname, { all: true });
    },
    send: sendOnce,
  };
}

function sendOnce({ url, addresses, method, headers, body, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    // IPv4 first: one pinned address list, tried in order (Node's happy eyeballs uses all of them).
    const pinned = [...addresses].sort((a, b) => a.family - b.family);
    const lookup = (_hostname, options, callback) => {
      if (options?.all) callback(null, pinned);
      else callback(null, pinned[0].address, pinned[0].family);
    };
    const lib = url.protocol === 'https:' ? https : http;
    let settled = false;
    let response = null;
    let stream = null;
    // Stops everything: the socket, the response and the decompressor (a brotli bomb would
    // otherwise keep inflating what it already buffered long after the byte cap fired).
    const stop = () => {
      if (stream && stream !== response) stream.destroy();
      response?.destroy();
      req.destroy();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      reject(error);
    };
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers: body ? { ...headers, 'Content-Length': String(body.length) } : headers,
      lookup,
      agent: false,
    });
    const timer = setTimeout(() => fail(Object.assign(new Error('The request timed out.'), { code: 'ETIMEDOUT' })), timeoutMs);
    req.on('error', fail);
    req.on('response', (res) => {
      response = res;
      res.on('error', fail);
      if (res.statusCode >= 300 && res.statusCode < 400) {
        // The body of a redirect is never used: close the connection instead of draining it.
        settled = true;
        clearTimeout(timer);
        stop();
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.alloc(0) });
        return;
      }
      const encoding = String(res.headers['content-encoding'] ?? '')
        .trim()
        .toLowerCase();
      const declared = Number(res.headers['content-length']);
      if ((!encoding || encoding === 'identity') && declared > maxBytes) {
        fail(Object.assign(new Error('The response is too large.'), { code: 'ETOOLARGE' }));
        return;
      }
      stream = res;
      if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
      else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      else if (encoding && encoding !== 'identity') {
        fail(Object.assign(new Error(`Unsupported content encoding ${encoding}.`), { code: 'EENCODING' }));
        return;
      }
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > maxBytes) fail(Object.assign(new Error('The response is too large.'), { code: 'ETOOLARGE' }));
        else chunks.push(chunk);
      });
      stream.on('error', fail);
      stream.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
      });
    });
    req.end(body ?? undefined);
  });
}
