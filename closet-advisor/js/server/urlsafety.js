// Product-link import safety. The prototype never fetches an imported URL: it validates the
// link, then resolves it against the demo retailers' URL patterns. A server that does fetch
// must add the checks listed in docs/affiliate.md (DNS re-validation, pinning, limits).
//
// Host checks run on the WHATWG-parsed URL, which already normalizes decimal, hex and octal
// IPv4 forms (http://2130706433 -> 127.0.0.1) and compresses IPv6 (::ffff:127.0.0.1 ->
// ::ffff:7f00:1). Using the parser's own result avoids differences between checker and fetcher.

export const MAX_URL_LENGTH = 2048;

const MESSAGES = {
  empty: 'Paste a link to the product page.',
  too_long: 'That link is longer than 2,048 characters. Copy just the product page address.',
  malformed: "That isn't a web address. Copy the full link from the product page.",
  scheme: 'Only web links that start with http:// or https:// can be added.',
  credentials: "Links that contain a username or password can't be added. Copy the plain product link instead.",
  local_host: "That link points to this device or a local network, not a public store. Use the store's product page link.",
  private_address: "That link points to a private or reserved network address, not a public store. Use the store's product page link.",
  port: "Links with a port number, like :8080, can't be added. Use the store's regular product page link.",
  too_many_redirects: 'That link redirects too many times to follow safely.',
  redirect_loop: 'That link redirects in a loop, so it was not followed.',
  downgrade: 'That link redirects from a secure page to an insecure one, so it was not followed.',
};

const fail = (reason, extra = {}) => ({ ok: false, reason, message: MESSAGES[reason], ...extra });

// Names that only resolve inside a device or private network, never to a public store.
const LOCAL_SUFFIXES = ['localhost', 'localdomain', 'local', 'internal', 'arpa', 'lan', 'home', 'corp', 'intranet', 'test', 'invalid'];

// IPv4 ranges that are not public unicast (IANA special-purpose registry).
const V4_BLOCKED = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // shared address space (CGNAT)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata at 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation (TEST-NET-1)
  ['192.88.99.0', 24], // former 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation (TEST-NET-2)
  ['203.0.113.0', 24], // documentation (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including broadcast
];

// Inside global unicast (2000::/3), these blocks are special-purpose. Everything outside
// 2000::/3 (loopback, unspecified, IPv4-mapped, unique local, link-local, multicast...) is blocked.
const V6_BLOCKED_IN_GLOBAL = [
  ['2001::', 23], // IETF protocol assignments: Teredo, benchmarking, ORCHID
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4, which embeds an IPv4 address
  ['3fff::', 20], // documentation
];

/** Dotted-quad IPv4 to a 32-bit number, or null. */
export function parseIPv4(text) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(text));
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** IPv6 text (with or without brackets, optionally ending in a dotted quad) to 8 hextets, or null. */
export function parseIPv6(text) {
  let s = String(text).replace(/^\[|\]$/g, '').toLowerCase();
  if (!s.includes(':') || s.includes('%')) return null;
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (dotted) {
    const v4 = parseIPv4(dotted[2]);
    if (v4 == null) return null;
    s = `${dotted[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => Number.parseInt(g, 16));
}

function inV4(ip, [base, bits]) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((parseIPv4(base) & mask) >>> 0);
}

function inV6(groups, [base, bits]) {
  const b = parseIPv6(base);
  for (let i = 0; i < 8 && bits > 0; i++, bits -= 16) {
    const take = Math.min(16, bits);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if ((groups[i] & mask) !== (b[i] & mask)) return false;
  }
  return true;
}

/** True when an IPv4 address (number) is outside public unicast space. */
export function isBlockedIPv4(ip) {
  return V4_BLOCKED.some((range) => inV4(ip, range));
}

/** True when an IPv6 address (8 hextets) is outside public unicast space. */
export function isBlockedIPv6(groups) {
  // NAT64 (64:ff9b::/96) reaches the embedded IPv4 address, so that address decides.
  if (inV6(groups, ['64:ff9b::', 96])) return isBlockedIPv4(((groups[6] << 16) | groups[7]) >>> 0);
  if (!inV6(groups, ['2000::', 3])) return true;
  return V6_BLOCKED_IN_GLOBAL.some((range) => inV6(groups, range));
}

/** Classifies a parsed URL's host. Returns a failure reason or null when it may be public. */
function hostProblem(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return 'malformed';
  if (host.startsWith('[')) {
    const groups = parseIPv6(host);
    if (!groups) return 'malformed';
    return isBlockedIPv6(groups) ? 'private_address' : null;
  }
  const v4 = parseIPv4(host);
  if (v4 != null) return isBlockedIPv4(v4) ? 'private_address' : null;
  // The parser turns numeric hosts into dotted quads; anything numeric left over is suspect.
  if (/^(?:0x[0-9a-f]*|\d+)$/i.test(host.split('.').pop())) return 'malformed';
  const labels = host.split('.');
  if (labels.some((l) => !l || l.length > 63) || host.length > 253) return 'malformed';
  if (labels.length < 2) return 'local_host';
  if (LOCAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return 'local_host';
  return null;
}

/**
 * Checks a pasted product link before anything uses it.
 * @param {unknown} input
 * @returns {{ ok: true, url: string } | { ok: false, reason: string, message: string }}
 *   reason: 'empty' | 'too_long' | 'malformed' | 'scheme' | 'credentials' | 'local_host'
 *   | 'private_address' | 'port'; url is the normalized href
 */
export function validateImportUrl(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return fail('empty');
  if (text.length > MAX_URL_LENGTH) return fail('too_long');
  // People often paste "store.example/p/1"; treat a missing scheme as https.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text.replace(/^\/\//, '')}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return fail('malformed');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail('scheme');
  if (url.username || url.password) return fail('credentials');
  const problem = hostProblem(url.hostname);
  if (problem) return fail(problem);
  if (url.port && url.port !== '80' && url.port !== '443') return fail('port');
  if (url.hostname.endsWith('.')) url.hostname = url.hostname.slice(0, -1);
  const href = url.href;
  if (href.length > MAX_URL_LENGTH) return fail('too_long');
  return { ok: true, url: href };
}

/**
 * Validates every hop of a redirect chain (the first URL plus each Location, which may be
 * relative to the previous hop). For server-side fetchers; the prototype never fetches.
 * @param {string[]} urls
 * @param {{ maxHops?: number }} [opts] maxHops: redirects allowed after the first URL
 * @returns {{ ok: true, url: string, hops: number } | { ok: false, reason: string, message: string, hop: number }}
 */
export function checkRedirectChain(urls, { maxHops = 5 } = {}) {
  const list = Array.isArray(urls) ? urls : [];
  if (!list.length) return fail('empty', { hop: 0 });
  if (list.length - 1 > maxHops) return fail('too_many_redirects', { hop: maxHops + 1 });
  const seen = new Set();
  let previous = null;
  for (let hop = 0; hop < list.length; hop++) {
    let candidate = String(list[hop] ?? '').trim();
    if (previous && candidate) {
      try {
        candidate = new URL(candidate, previous).href;
      } catch {
        return fail('malformed', { hop });
      }
    }
    const checked = validateImportUrl(candidate);
    if (!checked.ok) return { ...checked, hop };
    if (seen.has(checked.url)) return fail('redirect_loop', { hop });
    if (previous && new URL(previous).protocol === 'https:' && new URL(checked.url).protocol === 'http:') return fail('downgrade', { hop });
    seen.add(checked.url);
    previous = checked.url;
  }
  return { ok: true, url: previous, hops: list.length - 1 };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** '/p/{listingId}' -> /^\/p\/([^/]+)\/?$/ */
function patternRegex(pattern) {
  const parts = String(pattern ?? '').split('{listingId}');
  if (parts.length !== 2 || !parts[0].startsWith('/')) return null;
  return new RegExp(`^${escapeRe(parts[0])}([^/]+)${escapeRe(parts[1])}/?$`);
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The size named by ?size=, if the listing or the product comes in it. Never guessed. */
function sizeFromQuery(url, offer, product) {
  const raw = url.searchParams.get('size');
  if (raw == null || !raw.trim()) return { size: null, sizeNote: null };
  const known = [
    ...(offer.sizes ?? []).map((s) => ({ value: String(s.value), system: s.system })),
    ...(product?.sizing ? product.sizing.sizes.map((v) => ({ value: String(v), system: product.sizing.system })) : []),
  ];
  if (!known.length) return { size: null, sizeNote: "This product isn't sold in sizes, so the size in the link was ignored." };
  const wanted = raw.trim().toLowerCase().replace(/\s+/g, '');
  const hit = known.find((s) => s.value.toLowerCase() === wanted);
  if (hit) return { size: hit, sizeNote: null };
  return { size: null, sizeNote: "The size in the link isn't one this product comes in, so no size was set." };
}

const unsupported = (host, code, reason) => ({ status: 'unsupported_link', host, code, reason });

/**
 * Resolves a validated link to a demo retailer listing. The host must be a demo retailer's
 * domain (www. allowed) and the path must match its urlPattern with a known listing id.
 * The listing id identifies the offer; the product comes from the catalog's offer record, never
 * from parsing the id.
 * @param {string|URL} input
 * @param {any} catalog
 * @returns {{ status: 'resolved', retailerId, offerId, variantId, productId, size, listingStatus, sizeNote }
 *   | { status: 'unsupported_link', host: string|null, code: string, reason: string }}
 *   reason is a plain sentence that can be shown; code is for metrics and tests
 */
export function resolveRetailerUrl(input, catalog) {
  const checked = validateImportUrl(input instanceof URL ? input.href : input);
  if (!checked.ok) return unsupported(null, 'invalid_url', checked.message);
  const url = new URL(checked.url);
  const host = url.hostname.toLowerCase();
  const bare = host.startsWith('www.') ? host.slice(4) : host;
  const retailers = [...(catalog.retailers?.values?.() ?? [])];
  const retailer = retailers.find((r) => String(r.domain).toLowerCase() === bare);
  if (!retailer) {
    return unsupported(host, 'unknown_store', `Rotation can't read links from ${host} yet. Search the catalog for the item instead.`);
  }
  const match = patternRegex(retailer.urlPattern)?.exec(url.pathname);
  const listingId = match ? decodeSegment(match[1]) : null;
  if (!listingId) {
    return unsupported(host, 'not_a_product_page', `That ${retailer.name} link isn't a product page. Open the product and copy its link.`);
  }
  const offer = [...(catalog.offers?.values?.() ?? [])].find((o) => o.retailerId === retailer.id && o.listingId === listingId);
  const variant = offer ? catalog.variant(offer.variantId) : null;
  const product = variant ? catalog.product(variant.productId) : null;
  if (!offer || !variant || !product) {
    return unsupported(host, 'unknown_listing', `That ${retailer.name} listing isn't in the demo catalog. Search the catalog for the item instead.`);
  }
  const { size, sizeNote } = sizeFromQuery(url, offer, product);
  return {
    status: 'resolved',
    retailerId: retailer.id,
    offerId: offer.id,
    variantId: variant.id,
    productId: product.id,
    size,
    listingStatus: offer.listingStatus,
    sizeNote,
  };
}
