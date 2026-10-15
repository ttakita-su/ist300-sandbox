// StockX and GOAT: the host allowlist, each marketplace's own public search page, and what can
// be read from the text of a product link. Nothing in this module fetches anything. Rotation has
// no approved StockX or GOAT API or feed access (docs/marketplaces.md), so a pasted link is
// parsed as text, never opened, and every value read from it is a guess the person confirms.
import { MAX_URL_LENGTH } from './urlsafety.js';
import { ALPHA_SIZES } from '../data/schema.js';

export const MAX_QUERY_LENGTH = 100;

/**
 * Marketplace descriptors. `hosts` is an exact allowlist (no subdomain matching), and
 * `canonicalHost` is the host stored in a cleaned link. `searchUrl(query)` builds a link to the
 * marketplace's own public search page for the person to open; Rotation never requests it.
 * @type {Readonly<Record<'stockx'|'goat', {
 *   id: string, name: string, hosts: readonly string[], canonicalHost: string,
 *   searchUrlTemplate: string, searchUrl: (query: string) => string | null,
 *   access: 'not_connected', accessNote: string }>>}
 */
export const MARKETPLACES = Object.freeze({
  stockx: Object.freeze({
    id: 'stockx',
    name: 'StockX',
    hosts: Object.freeze(['stockx.com', 'www.stockx.com']),
    canonicalHost: 'stockx.com',
    searchUrlTemplate: 'https://stockx.com/search?s={query}',
    // StockX's own search links encode spaces as %20 (stockx.com/search?s=bearbrick%20other%20brands).
    searchUrl: (query) => {
      const q = cleanQuery(query);
      return q ? `https://stockx.com/search?s=${encodeURIComponent(q)}` : null;
    },
    access: 'not_connected',
    accessNote: "StockX shares its catalog API only with approved high-volume sellers, for their own internal use, so Rotation can't search StockX for you.",
  }),
  goat: Object.freeze({
    id: 'goat',
    name: 'GOAT',
    hosts: Object.freeze(['goat.com', 'www.goat.com']),
    canonicalHost: 'www.goat.com',
    searchUrlTemplate: 'https://www.goat.com/search?query={query}',
    // GOAT's search links use form encoding (goat.com/search?query=travis+scott).
    searchUrl: (query) => {
      const q = cleanQuery(query);
      return q ? `https://www.goat.com/search?${new URLSearchParams({ query: q })}` : null;
    },
    access: 'not_connected',
    accessNote: "GOAT has no public product API and its terms don't allow automated access, so Rotation can't search GOAT for you.",
  }),
});

export const MARKETPLACE_IDS = Object.freeze(Object.keys(MARKETPLACES));

const SUPPORTED_NAMES = 'StockX and GOAT';

const MESSAGES = {
  empty: 'Paste a link to a StockX or GOAT product page.',
  too_long: 'That link is longer than 2,048 characters. Copy just the product page address.',
  malformed: "That isn't a web address. Copy the full link from the product page.",
  scheme: 'Only web links that start with https:// can be added.',
  credentials: "Links that contain a username or password can't be added. Copy the plain product link instead.",
  port: "Links with a port number, like :8080, can't be added. Copy the product link from StockX or GOAT.",
  unsupported_marketplace: `Only ${SUPPORTED_NAMES} product links can be read here. Search the catalog or enter the item yourself instead.`,
};

/** Reasons that mean the text isn't a usable link at all (shown as a field error). */
export const INVALID_LINK_REASONS = Object.freeze(['empty', 'too_long', 'malformed', 'scheme', 'credentials', 'port']);

const fail = (reason, extra = {}) => ({ ok: false, reason, message: MESSAGES[reason], marketplace: null, ...extra });

/** Trims, collapses whitespace and caps a search query. Returns '' when nothing is left. */
export function cleanQuery(query) {
  if (typeof query !== 'string') return '';
  return query
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
}

/** The marketplace whose allowlist contains this exact host, or null. */
export function marketplaceForHost(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  return Object.values(MARKETPLACES).find((m) => m.hosts.includes(host)) ?? null;
}

// ---------- Reading a product link ----------

const LOCALE = /^[a-z]{2}-[a-z]{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// GOAT puts product pages under a section; the section is the best category evidence there is.
const GOAT_SECTIONS = { sneakers: 'sneaker', apparel: 'clothing' };
// Hyphenated StockX pages that are listings or info, not products. Single words never pass the
// three-word minimum, and brand landing pages are caught by the brand dictionary.
const STOCKX_NOT_PRODUCTS = new Set(['how-it-works', 'new-releases', 'trading-cards', 'retro-jordans', 'most-popular', 'below-retail', 'price-drops']);

// Brand slugs, longest first when matched. `keep`: the words name a model line ("Air Jordan 1",
// "Dunk Low"), so they stay in the item name. `category` is a hint for watch-only brands. The
// last group are model lines GOAT slugs often start with, without the brand.
const BRANDS = [
  ['air-jordan', 'Jordan', { keep: true }],
  ['jordan', 'Jordan', { keep: true }],
  ['nike', 'Nike'],
  ['adidas', 'adidas'],
  ['new-balance', 'New Balance'],
  ['asics', 'ASICS'],
  ['hoka', 'HOKA'],
  ['ugg', 'UGG'],
  ['bape', 'BAPE'],
  ['a-bathing-ape', 'A Bathing Ape'],
  ['fear-of-god-essentials', 'Fear of God Essentials'],
  ['fear-of-god', 'Fear of God'],
  ['off-white', 'Off-White'],
  ['the-north-face', 'The North Face'],
  ['comme-des-garcons', 'Comme des Garçons'],
  ['stone-island', 'Stone Island'],
  ['louis-vuitton', 'Louis Vuitton'],
  ['onitsuka-tiger', 'Onitsuka Tiger'],
  ['under-armour', 'Under Armour'],
  ['rolex', 'Rolex', { category: 'watch' }],
  ['omega', 'Omega', { category: 'watch' }],
  ['tudor', 'Tudor', { category: 'watch' }],
  ['seiko', 'Seiko', { category: 'watch' }],
  ['casio', 'Casio', { category: 'watch' }],
  ['audemars-piguet', 'Audemars Piguet', { category: 'watch' }],
  ['patek-philippe', 'Patek Philippe', { category: 'watch' }],
  ['tag-heuer', 'TAG Heuer', { category: 'watch' }],
  ['sb-dunk', 'Nike', { keep: true }],
  ['dunk', 'Nike', { keep: true }],
  ['air-force-1', 'Nike', { keep: true }],
  ['air-max', 'Nike', { keep: true }],
  ['yeezy', 'adidas', { keep: true }],
]
  .map(([slug, name, opts = {}]) => ({ slug, tokens: slug.split('-'), name, keep: Boolean(opts.keep), category: opts.category ?? null }))
  .sort((a, b) => b.tokens.length - a.tokens.length);

const BRAND_SLUGS = new Set(BRANDS.map((b) => b.slug));

const CLOTHING_WORDS = new Set([
  'hoodie', 'hoodies', 'hooded', 'sweatshirt', 'sweater', 'crewneck', 'cardigan', 'tee', 'shirt', 'longsleeve',
  'jacket', 'coat', 'parka', 'puffer', 'vest', 'fleece', 'jersey', 'polo', 'overshirt', 'bomber', 'anorak',
  'windbreaker', 'pants', 'pant', 'trousers', 'sweatpants', 'joggers', 'jeans', 'denim', 'shorts',
]);
const WATCH_WORDS = new Set(['watch', 'watches', 'chronograph']);

const SMALL_WORDS = new Set(['a', 'an', 'and', 'by', 'de', 'des', 'for', 'in', 'of', 'on', 'the', 'to', 'with']);
const ACRONYMS = new Set(['og', 'sb', 'gs', 'ps', 'td', 'qs', 'sp', 'se', 'nrg', 'prm', 'pk', 'usa', 'uk', 'us', 'eu', 'gtx', 'wmns', 'ii', 'iii', 'iv']);

function wordCase(token, index) {
  if (token === 'x') return 'x'; // collaborations: "Travis Scott x Fragment"
  if (index > 0 && SMALL_WORDS.has(token)) return token;
  if (ACRONYMS.has(token)) return token.toUpperCase();
  if (/^\d+mm$/.test(token)) return token; // case sizes: 41mm
  if (/\d/.test(token) && /[a-z]/.test(token)) return token.toUpperCase(); // V2, FW23, 990V6
  return token.charAt(0).toUpperCase() + token.slice(1);
}

const titleCase = (tokens) => tokens.map(wordCase).join(' ');

// A code mixes letters and digits (gy0420, 192sp232050f, 126610ln); long enough not to be a
// model name such as 990v6 or 2002r.
const SINGLE_CODE = /^(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{6,16}$/;
// Two-part Nike/Jordan/ASICS style codes: dd1391-100, 555088-134, 1201a789-020.
const CODE_HEAD = /^(?=[a-z0-9]*\d)[a-z0-9]{5,10}$/;
const CODE_TAIL = /^\d{3}$/;

/** Trailing style code in slug tokens. Returns { code, used } (tokens consumed) or null. */
export function styleCodeFromTokens(tokens) {
  const n = tokens.length;
  if (n >= 3 && CODE_TAIL.test(tokens[n - 1]) && CODE_HEAD.test(tokens[n - 2])) {
    return { code: `${tokens[n - 2]}-${tokens[n - 1]}`.toUpperCase(), used: 2 };
  }
  if (n >= 2 && SINGLE_CODE.test(tokens[n - 1])) return { code: tokens[n - 1].toUpperCase(), used: 1 };
  return null;
}

/** Longest dictionary brand at the start of the tokens (a leading "wmns" is skipped). */
export function brandFromTokens(tokens) {
  const start = tokens[0] === 'wmns' ? 1 : 0;
  for (const brand of BRANDS) {
    if (brand.tokens.every((t, i) => tokens[start + i] === t)) return { ...brand, start, length: brand.tokens.length };
  }
  return null;
}

function guessCategory(tokens, { section, brand }) {
  if (section) return GOAT_SECTIONS[section];
  if (brand?.category) return brand.category;
  if (tokens.some((t) => WATCH_WORDS.has(t) || /^\d{2}mm$/.test(t))) return 'watch';
  if (tokens.some((t) => CLOTHING_WORDS.has(t))) return 'clothing';
  return 'sneaker';
}

/**
 * Size from ?size= (StockX uses it; GOAT's is unconfirmed but read the same way). Only sizes the
 * schema can record are kept: US men's or women's shoe sizes, alpha and waist x inseam.
 */
function guessSize(url, category) {
  const raw = url.searchParams.get('size');
  if (raw == null || !raw.trim()) return { sizeGuess: null, sizeNote: null };
  const text = raw.trim().toUpperCase().replace(/\s+/g, '');
  let size = null;
  if (category === 'sneaker') {
    const m = /^(\d{1,2}(?:\.5)?)(W)?$/.exec(text);
    if (m) size = { value: m[1], system: m[2] ? 'US-W' : 'US-M' };
  } else if (category === 'clothing') {
    if (ALPHA_SIZES.includes(text)) size = { value: text, system: 'ALPHA' };
    else if (/^\d{2}X\d{2}$/.test(text)) size = { value: text.toLowerCase(), system: 'WAIST-INSEAM' };
  }
  if (size) return { sizeGuess: size, sizeNote: null };
  return { sizeGuess: null, sizeNote: "The size in the link isn't one Rotation can record, so no size was set." };
}

/** Splits a pathname into lowercase segments; null when it has empty segments. */
function pathSegments(pathname) {
  const trimmed = pathname.replace(/^\/+/, '').replace(/\/$/, '');
  if (!trimmed) return [];
  const segments = trimmed.toLowerCase().split('/');
  return segments.every(Boolean) ? segments : null;
}

/** The product slug, section and locale for a marketplace path, or null if it isn't a product page. */
function productPath(marketplace, pathname) {
  const segments = pathSegments(pathname);
  if (!segments || !segments.length) return null;
  const locale = LOCALE.test(segments[0]) ? segments.shift() : null;
  let section = null;
  if (marketplace.id === 'goat') {
    if (segments.length !== 2 || !GOAT_SECTIONS[segments[0]]) return null;
    section = segments.shift();
  } else if (segments.length !== 1) {
    return null;
  }
  const slug = segments[0];
  if (!SLUG.test(slug) || slug.length > 200 || BRAND_SLUGS.has(slug)) return null;
  if (marketplace.id === 'stockx' && STOCKX_NOT_PRODUCTS.has(slug)) return null;
  const tokens = slug.split('-');
  // Product slugs name at least a brand or model and a colorway; GOAT ones end in a style code.
  if (tokens.length < 3 && !(section && styleCodeFromTokens(tokens))) return null;
  return { locale, section, slug, tokens };
}

/**
 * Reads a pasted StockX or GOAT product link as text. Never fetches it.
 *
 * Rules: https only (http is upgraded only for an allowlisted host); the host must be in a
 * marketplace's allowlist exactly; no username or password; default port only; at most 2,048
 * characters; the path must look like a product page (StockX `/{locale}?/{slug}`, GOAT
 * `/{locale}?/{sneakers|apparel}/{slug}`). The cleaned `url` drops the query and fragment, so
 * tracking parameters aren't stored, and uses the marketplace's canonical host.
 *
 * @param {unknown} input
 * @returns {{ ok: true, marketplace: { id: string, name: string }, url: string, slug: string,
 *     locale: string | null, nameGuess: string | null, brandGuess: string | null,
 *     styleCodeGuess: string | null, releaseYearGuess: number | null, categoryGuess: 'sneaker' | 'watch' | 'clothing',
 *     sizeGuess: { value: string, system: string } | null, sizeNote: string | null }
 *   | { ok: false, reason: 'empty' | 'too_long' | 'malformed' | 'scheme' | 'credentials' | 'port'
 *     | 'unsupported_marketplace' | 'not_a_product_page', message: string,
 *     marketplace: { id: string, name: string } | null }}
 */
export function parseMarketplaceUrl(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return fail('empty');
  if (text.length > MAX_URL_LENGTH) return fail('too_long');
  // People often paste "stockx.com/…" without a scheme; treat that as https.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text.replace(/^\/\//, '')}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return fail('malformed');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fail('scheme');
  if (url.username || url.password) return fail('credentials');
  const marketplace = marketplaceForHost(url.hostname);
  if (!marketplace) return fail('unsupported_marketplace');
  // The parser already drops a port that is the scheme's default (:443 on https, :80 on http).
  if (url.port) return fail('port');

  const ref = { id: marketplace.id, name: marketplace.name };
  const path = productPath(marketplace, url.pathname);
  if (!path) {
    return {
      ok: false,
      reason: 'not_a_product_page',
      message: `That ${marketplace.name} link isn't a product page. Open the product on ${marketplace.name} and copy its link.`,
      marketplace: ref,
    };
  }

  const { locale, section, slug, tokens } = path;
  const code = styleCodeFromTokens(tokens);
  const words = code ? tokens.slice(0, tokens.length - code.used) : [...tokens];
  // StockX slugs often end in the release year (…-white-black-2021); keep it out of the name.
  let releaseYearGuess = null;
  if (words.length > 2 && /^(19|20)\d{2}$/.test(words[words.length - 1])) releaseYearGuess = Number(words.pop());
  const brand = brandFromTokens(words);
  let brandGuess = null;
  let nameWords = words;
  if (brand) {
    brandGuess = brand.name;
    if (!brand.keep) nameWords = [...words.slice(0, brand.start), ...words.slice(brand.start + brand.length)];
  } else if (words.length) {
    brandGuess = wordCase(words[0], 0);
    // StockX slugs start with the brand; GOAT slugs often start with the model, so keep it there.
    if (marketplace.id === 'stockx') nameWords = words.slice(1);
  }
  const categoryGuess = guessCategory(tokens, { section, brand });
  const { sizeGuess, sizeNote } = guessSize(url, categoryGuess);
  const cleaned = `https://${marketplace.canonicalHost}/${[locale, section, slug].filter(Boolean).join('/')}`;
  if (cleaned.length > MAX_URL_LENGTH) return fail('too_long');

  return {
    ok: true,
    marketplace: ref,
    url: cleaned,
    slug,
    locale,
    nameGuess: nameWords.length ? titleCase(nameWords).slice(0, 120) : null,
    brandGuess: brandGuess ? brandGuess.slice(0, 120) : null,
    styleCodeGuess: code?.code ?? null,
    releaseYearGuess,
    categoryGuess,
    sizeGuess,
    sizeNote,
  };
}
