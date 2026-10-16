// Structured product data from a store's product page, without a DOM or dependencies. Ported from
// the retailer probe that was checked on 16 real pages (Nike, Converse, Vans, Allbirds, Timex,
// Zappos, Foot Locker, END, Seiko, Amazon, Uniqlo, ...).
//
// Field precedence (per field, the first layer with a value wins; images are merged in this order):
//   1. JSON-LD schema.org Product / ProductGroup (+ hasVariant / isVariantOf), variant matched to the URL
//   2. Site adapters for known pages without usable JSON-LD (Amazon, GOAT __NEXT_DATA__, Seiko)
//   3. Microdata (itemprop inside an itemtype=schema.org/Product scope)
//   4. OpenGraph / product:* / twitter:* meta
//   5. <title>, meta description, <link rel=canonical>, hostname
// Money is integer minor units plus an ISO 4217 currency (minor digits from Intl). Unknown is null.
import { validateImportUrl } from '../js/server/urlsafety.js';

// prettier-ignore
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', deg: '°',
  times: '×', eacute: 'é', egrave: 'è', aacute: 'á', oacute: 'ó', uacute: 'ú', iacute: 'í', ntilde: 'ñ',
  uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß', euro: '€', pound: '£', yen: '¥', cent: '¢', frac12: '½',
};

/** Decodes named and numeric HTML entities. */
export function decodeEntities(s) {
  if (s == null) return s;
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

// Longer text is cut before cleaning (descriptions are capped at 1500 characters anyway).
const MAX_TEXT_CHARS = 100000;

function cleanText(s, max = 0) {
  if (s == null || typeof s === 'object') return null;
  // [^<>] keeps the tag strip linear: a "<" with no ">" is not searched to the end of the text.
  let t = decodeEntities(String(s).slice(0, MAX_TEXT_CHARS))
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^<>]*>/g, ' ');
  // A second pass catches double-encoded text (&amp;#39;); zero-width spaces start some og:titles.
  t = decodeEntities(t)
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (max && t.length > max) t = `${t.slice(0, max - 1).trimEnd()}…`;
  return t || null;
}

const isObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const typesOf = (o) => arr(o?.['@type']).map((t) => String(t).replace(/^.*[/#:]/, ''));
const PRODUCT_NODE_TYPES = /^(Product|ProductGroup|IndividualProduct|ProductModel|SomeProducts|Vehicle|Car|Motorcycle)$/;
const isProductNode = (o) => isObj(o) && typesOf(o).some((t) => PRODUCT_NODE_TYPES.test(t));

function absUrl(u, base, { https = false } = {}) {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const x = new URL(decodeEntities(u.trim()), base);
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return null;
    if (https) x.protocol = 'https:';
    x.hash = '';
    return x.href;
  } catch {
    return null;
  }
}

// ---------- tiny HTML helpers (regex based; good enough for <head> metadata) ----------
//
// Every scan here is linear in the page size: a fetched page is untrusted, and one regex that
// re-reads the rest of an 8 MB page for every "<meta" in it would freeze the whole server.

const MAX_TAG_CHARS = 4096;
// <meta>, <link> and <title> are read from the start of the page only.
const HEAD_SCAN_CHARS = 2 * 1024 * 1024;
const MAX_MICRODATA_PROPS = 1000;

/**
 * Opening tags named `name` (a regex source), in one pass: a tag runs from "<name" to the next
 * ">", and the scan resumes after that ">" as a browser's tokenizer does. Tags longer than
 * MAX_TAG_CHARS are skipped; text with no ">" left ends the scan.
 * @returns {Generator<{ index: number, end: number, name: string, tag: string }>} end is just after ">"
 */
function* openTags(html, name) {
  const re = new RegExp(`<(${name})\\b`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const close = html.indexOf('>', re.lastIndex);
    if (close < 0) return;
    if (close - m.index <= MAX_TAG_CHARS) yield { index: m.index, end: close + 1, name: m[1].toLowerCase(), tag: html.slice(m.index, close + 1) };
    re.lastIndex = close + 1;
  }
}

/** The first <title>'s raw text (at most 2000 characters away from the tag), or null. */
function firstTitle(html) {
  for (const { end } of openTags(html, 'title')) {
    const rest = html.slice(end, end + 2000);
    const close = rest.search(/<\/title\s*>/i);
    return close < 0 ? null : rest.slice(0, close);
  }
  return null;
}

function parseAttrs(tag) {
  const out = {};
  const inner = tag.replace(/^<\s*[^\s>/]+/, '').replace(/\/?\s*>$/, '');
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(inner))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

function collectMeta(html) {
  const meta = new Map();
  for (const { tag } of openTags(html.slice(0, HEAD_SCAN_CHARS), 'meta')) {
    const a = parseAttrs(tag);
    const key = (a.property || a.name || '').toLowerCase().trim();
    if (!key || a.content == null || a.content.trim() === '') continue;
    if (!meta.has(key)) meta.set(key, []);
    meta.get(key).push(a.content.trim());
  }
  return meta;
}

function collectLinks(html) {
  const links = [];
  for (const { tag } of openTags(html.slice(0, HEAD_SCAN_CHARS), 'link')) {
    const a = parseAttrs(tag);
    if (a.rel && a.href) links.push({ rel: a.rel.toLowerCase(), href: a.href });
  }
  return links;
}

// A flat microdata read, only when a schema.org Product scope exists on the page.
function collectMicrodata(html) {
  if (!/itemtype\s*=\s*["']?https?:\/\/schema\.org\/(Product|IndividualProduct|ProductModel|ProductGroup)\b/i.test(html)) return null;
  const entries = [];
  for (const { index, end, name: tag, tag: text } of openTags(html, '[a-z][a-z0-9]*')) {
    const m = /\bitemprop\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(text);
    if (!m) continue;
    if (entries.length >= MAX_MICRODATA_PROPS) break;
    const a = parseAttrs(text);
    let value = a.content ?? null;
    if (value == null && tag !== 'meta') {
      if (tag === 'a' || tag === 'link') value = a.href ?? null;
      else if (['img', 'source', 'video', 'audio', 'embed', 'iframe'].includes(tag)) value = a.src || a['data-src'] || null;
      else if (tag === 'time') value = a.datetime ?? null;
      else if (tag === 'data' || tag === 'meter') value = a.value ?? null;
      else if ('itemscope' in a) value = { scope: true };
      else {
        // The closing tag is looked for nearby only, so an unclosed tag costs a bounded scan.
        const close = html.slice(end, end + 65536).indexOf(`</${tag}`);
        value = close > 0 ? cleanText(html.slice(end, end + Math.min(close, 4000))) : null;
      }
    }
    for (const prop of (m[1] || m[2] || m[3]).split(/\s+/)) entries.push({ prop, value, index });
  }
  const first = (prop, ok = (v) => typeof v === 'string' && v.trim()) => entries.find((e) => e.prop === prop && ok(e.value))?.value ?? null;
  let brand = first('brand');
  const brandScope = entries.find((e) => e.prop === 'brand' && isObj(e.value));
  if (!brand && brandScope) brand = entries.find((e) => e.prop === 'name' && e.index > brandScope.index && typeof e.value === 'string')?.value ?? null;
  const brandNameIdx = brandScope ? entries.find((e) => e.prop === 'name' && e.index > brandScope.index)?.index : -1;
  return {
    name: entries.find((e) => e.prop === 'name' && typeof e.value === 'string' && e.index !== brandNameIdx)?.value ?? null,
    brand,
    price: first('price'),
    priceCurrency: first('priceCurrency'),
    availability: first('availability'),
    itemCondition: first('itemCondition'),
    images: entries.filter((e) => e.prop === 'image' && typeof e.value === 'string').map((e) => e.value),
    sku: first('sku'),
    mpn: first('mpn'),
    productID: first('productID'),
    color: first('color'),
    description: first('description'),
    gtin: first('gtin13') ?? first('gtin12') ?? first('gtin14') ?? first('gtin8') ?? first('gtin'),
  };
}

// ---------- JSON-LD ----------

function looseJson(txt) {
  let t = txt
    .trim()
    .replace(/^<!--/, '')
    .replace(/-->$/, '')
    .replace(/^\/\*\s*<!\[CDATA\[\s*\*\//, '')
    .replace(/\/\*\s*\]\]>\s*\*\/$/, '')
    .trim();
  // Raw newlines and tabs inside strings are invalid JSON; outside strings they are whitespace.
  t = t.replace(/[\u0000-\u001F]+/g, ' ');
  for (const attempt of [t, t.replace(/,\s*([}\]])/g, '$1'), `[${t.replace(/}\s*{/g, '},{')}]`]) {
    try {
      return JSON.parse(attempt);
    } catch {
      // try the next repair
    }
  }
  return undefined;
}

function readJsonLd(html) {
  const roots = [];
  // One pass: a script's text runs to its </script>, and the scan resumes after it.
  const open = /<script\b/gi;
  const close = /<\/script\s*>/gi;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const tagEnd = html.indexOf('>', open.lastIndex);
    if (tagEnd < 0) break;
    close.lastIndex = tagEnd + 1;
    const c = close.exec(html);
    if (!c) break;
    if (tagEnd - m.index <= MAX_TAG_CHARS && /\btype\s*=\s*["']?application\/ld\+json/i.test(html.slice(m.index, tagEnd))) {
      const v = looseJson(html.slice(tagEnd + 1, c.index));
      if (v !== undefined) roots.push(v);
    }
    open.lastIndex = c.index + c[0].length;
  }
  // Walk everything and remember under which property each node was found.
  const nodes = [];
  const byId = new Map();
  const walk = (v, parentKey, depth) => {
    if (depth > 14 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, parentKey, depth + 1);
      return;
    }
    nodes.push({ node: v, parentKey });
    if (typeof v['@id'] === 'string' && Object.keys(v).some((k) => k !== '@id' && k !== '@context')) {
      if (!byId.has(v['@id'])) byId.set(v['@id'], v);
    }
    for (const [k, x] of Object.entries(v)) if (x && typeof x === 'object') walk(x, k, depth + 1);
  };
  for (const r of roots) walk(r, null, 0);
  const deref = (x) => (isObj(x) && typeof x['@id'] === 'string' && Object.keys(x).every((k) => k === '@id' || k === '@type') ? (byId.get(x['@id']) ?? x) : x);
  return { roots, nodes, deref };
}

// ---------- money ----------

const SYMBOL_CCY = { $: 'USD', US$: 'USD', '€': 'EUR', '£': 'GBP', C$: 'CAD', A$: 'AUD', '¥': 'JPY', '₩': 'KRW', '₹': 'INR' };
const ISO_CCY = new Set(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : []);

/** An ISO 4217 code from a code or a common symbol, or null when it isn't a known currency. */
export function normCurrency(c) {
  if (c == null) return null;
  const s = String(c).trim();
  const up = s.toUpperCase();
  const code = /^[A-Z]{3}$/.test(up) ? up : (SYMBOL_CCY[s] ?? null);
  return code && (ISO_CCY.size === 0 || ISO_CCY.has(code)) ? code : null;
}

/** The currency's minor digits (USD 2, JPY 0, KWD 3) from Intl. */
export function minorDigits(currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

/**
 * Parses a price into integer minor units with string math (no float drift): "1,299.95",
 * "1.299,95", 115, "209.0", "USD 1,300.00". Zero, negative and unreadable prices are null.
 */
export function toMinor(value, currency) {
  if (value == null || value === '' || !currency) return null;
  let s = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(6) : '') : String(value);
  if (/^\s*-/.test(s)) return null;
  // The first number only ("100 - 200" -> "100"). A space, no-break space, narrow no-break space or
  // apostrophe followed by exactly three digits is a thousands separator ("1 299,95", "1'299.95").
  const tok = s.match(/\d(?:[\d.,]|[\s\u00a0\u202f'](?=\d{3}(?!\d)))*/);
  if (!tok) return null;
  // "1e3" and other text glued to the number is not a price.
  if (/^[eE][+-]?\d/.test(s.slice(tok.index + tok[0].length))) return null;
  s = tok[0].replace(/[\s\u00a0\u202f']/g, '').replace(/[.,]+$/, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart;
  let frac = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const i = s.lastIndexOf(dec);
    intPart = s.slice(0, i);
    frac = s.slice(i + 1);
  } else if (lastComma >= 0) {
    const tail = s.slice(lastComma + 1);
    if (s.split(',').length === 2 && tail.length !== 3) {
      intPart = s.slice(0, lastComma); // "19,90": decimal comma
      frac = tail;
    } else intPart = s; // "1,300": thousands
  } else if (lastDot >= 0) {
    const tail = s.slice(lastDot + 1);
    if (s.split('.').length === 2 && !(tail.length === 3 && minorDigits(currency) === 0)) {
      intPart = s.slice(0, lastDot);
      frac = tail;
    } else intPart = s; // "1.300.000": thousands
  } else intPart = s;
  intPart = intPart.replace(/[.,]/g, '') || '0';
  frac = frac.replace(/\D/g, '');
  const d = minorDigits(currency);
  let minor = BigInt(intPart) * 10n ** BigInt(d) + BigInt((frac + '0'.repeat(d)).slice(0, d) || '0');
  if (frac.length > d && Number(frac[d]) >= 5) minor += 1n; // round half up
  const n = Number(minor);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const money = (value, currency) => {
  const c = normCurrency(currency);
  const amountMinor = toMinor(value, c);
  return amountMinor == null ? null : { amountMinor, currency: c };
};

// ---------- normalizers ----------

/** schema.org availability (or Shopify's true/false) to in_stock | out_of_stock | preorder | backorder | discontinued | limited | null. */
export function normAvailability(v) {
  if (v == null) return null;
  const s = String(v)
    .replace(/^.*[/#:]/, '')
    .replace(/[\s_-]/g, '')
    .toLowerCase();
  if (/^(instock|instoreonly|onlineonly|available|true)$/.test(s)) return 'in_stock';
  if (s === 'limitedavailability') return 'limited';
  if (/^(outofstock|soldout|unavailable|false)$/.test(s)) return 'out_of_stock';
  if (s === 'discontinued') return 'discontinued';
  if (/^(preorder|presale)$/.test(s)) return 'preorder';
  if (s === 'backorder') return 'backorder';
  return null;
}

const normCondition = (v) => {
  const s = v == null ? '' : String(v).replace(/^.*[/#:]/, '').toLowerCase();
  return s.startsWith('new') ? 'new' : s.startsWith('used') ? 'used' : s.startsWith('refurb') ? 'refurbished' : null;
};

/** A GTIN-8/12/13/14 with a valid check digit, as digits, or null. */
export function validGtin(v) {
  const d = v == null ? '' : String(v).replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(d.length) || /^0+$/.test(d)) return null;
  let sum = 0;
  for (let i = d.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += Number(d[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(d[d.length - 1]) ? d : null;
}

const str = (v) => (v == null || typeof v === 'object' ? null : cleanText(String(v)));
const nameOf = (v) => (typeof v === 'string' ? cleanText(v) : isObj(v) ? cleanText(v.name ?? null) : null);
const gtinOf = (o) => validGtin(o?.gtin14 ?? o?.gtin13 ?? o?.gtin12 ?? o?.gtin8 ?? o?.gtin ?? o?.isbn);
const RESIZE_PARAMS = ['width', 'w', 'sw', 'wid', 'size', 'imwidth', 'height', 'h', 'sh', 'hei'];

function imageUrlsOf(v, base) {
  const out = [];
  for (const x of arr(v)) {
    if (typeof x === 'string') out.push(x);
    else if (isObj(x)) out.push(x.contentUrl ?? x.url ?? x['@id'] ?? null);
  }
  return out.map((u) => absUrl(u, base, { https: true })).filter(Boolean);
}

// Images that differ only by resize parameters are one image: keep the un-resized original, else
// the widest, in first-seen order.
function dedupeImages(urls, max = 12) {
  const best = new Map();
  for (const [order, u] of urls.entries()) {
    let key;
    let width = -1;
    try {
      const x = new URL(u);
      const resized = RESIZE_PARAMS.some((p) => x.searchParams.has(p));
      width = resized ? Number(x.searchParams.get('width') ?? x.searchParams.get('w') ?? x.searchParams.get('sw') ?? x.searchParams.get('wid') ?? 0) || 0 : Infinity;
      // The same Shopify file on the store host and on cdn.shopify.com.
      const shop = x.pathname.match(/\/(?:cdn\/shop|s\/files(?:\/\d+)+)\/(files|products)\/(.+)$/);
      key = shop ? `shopify:${shop[1]}/${shop[2]}` : x.host + x.pathname;
    } catch {
      key = u;
    }
    const prev = best.get(key);
    if (!prev) best.set(key, { u, width, order });
    else if (width > prev.width) best.set(key, { u, width, order: prev.order });
  }
  return [...best.values()]
    .sort((a, b) => a.order - b.order)
    .slice(0, max)
    .map((x) => x.u);
}

function urlParts(u) {
  try {
    const x = new URL(u);
    const path = (x.host + x.pathname).replace(/\/+$/, '').toLowerCase();
    return { full: path + x.search, path, search: x.search };
  } catch {
    return null;
  }
}

const alnum = (s) =>
  String(s ?? '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();

// ---------- JSON-LD product reading ----------

function offersOf(node, deref) {
  const out = [];
  for (const raw of arr(node?.offers)) {
    const o = deref(raw);
    if (!isObj(o)) continue;
    out.push(o);
    if (typesOf(o).includes('AggregateOffer')) {
      for (const sub of arr(o.offers)) {
        const s = deref(sub);
        if (isObj(s)) out.push(s);
      }
    }
  }
  return out;
}

function offerMoney(o, deref, fallbackCcy) {
  let price = o.price;
  let ccy = o.priceCurrency;
  if (price == null && o.priceSpecification != null) {
    const specs = arr(o.priceSpecification).map(deref).filter(isObj);
    const sale = specs.find((s) => s.price != null && !/ListPrice|Strikethrough|MSRP|SRP|Invoice/i.test(String(s.priceType ?? ''))) ?? specs.find((s) => s.price != null);
    if (sale) {
      price = sale.price;
      ccy = ccy ?? sale.priceCurrency;
    }
  }
  const isAgg = typesOf(o).includes('AggregateOffer');
  if (price == null && o.lowPrice != null) price = o.lowPrice;
  const m = money(price, ccy ?? fallbackCcy);
  const high = isAgg && o.highPrice != null ? money(o.highPrice, ccy ?? fallbackCcy) : null;
  return m ? { ...m, highMinor: high?.amountMinor ?? null, aggregate: isAgg } : null;
}

function shippingOf(o, deref, fallbackCcy) {
  for (const sd of arr(o?.shippingDetails).map(deref).filter(isObj)) {
    const rate = deref(sd.shippingRate);
    if (isObj(rate) && rate.value != null) {
      const c = normCurrency(rate.currency ?? fallbackCcy);
      if (Number(String(rate.value).replace(/[^\d.]/g, '')) === 0 && c) return { kind: 'free', amountMinor: 0, currency: c };
      const m = money(rate.value, c);
      if (m) return { kind: 'flat', ...m };
    }
  }
  return null;
}

function rankTopProducts(nodes, deref, pageUrl) {
  const variantObjs = new Set();
  for (const { node } of nodes) {
    for (const v of arr(node.hasVariant)) {
      const d = deref(v);
      if (isObj(d)) variantObjs.add(d);
    }
  }
  const page = urlParts(pageUrl);
  const ranked = [];
  for (const { node, parentKey } of nodes) {
    if (!isProductNode(node) || variantObjs.has(node) || node.isVariantOf || node.inProductGroupWithID) continue;
    // Products under isRelatedTo, itemReviewed, itemListElement and similar keys are other products.
    if (parentKey && !['@graph', 'mainEntity', 'about', 'mainEntityOfPage'].includes(parentKey)) continue;
    if (ranked.some((r) => r.node === node)) continue;
    let s = 0;
    if (typesOf(node).includes('ProductGroup')) s += 3 + (arr(node.hasVariant).map(deref).some((v) => isObj(v) && (v.offers || v.sku)) ? 2 : 0);
    if (node.offers) s += 2;
    if (node.name) s += 1;
    if (node.image) s += 1;
    if (node.brand) s += 1;
    const u = urlParts(absUrl(node.url ?? '', pageUrl) ?? '');
    if (u && page && u.path === page.path) s += 2;
    ranked.push({ node, s });
  }
  return ranked.sort((a, b) => b.s - a.s).map((r) => r.node);
}

const MAX_VARIANTS = 1000;

function variantsOf(primary, nodes, deref) {
  const out = new Set();
  for (const v of arr(primary.hasVariant)) {
    const d = deref(v);
    if (isProductNode(d)) out.add(d);
  }
  const gid = primary['@id'];
  const pgid = primary.productGroupID != null ? String(primary.productGroupID) : null;
  for (const { node } of nodes) {
    if (!isProductNode(node) || node === primary) continue;
    const of = deref(node.isVariantOf);
    if ((of && (of === primary || (gid && of['@id'] === gid))) || (pgid && String(node.inProductGroupWithID ?? '') === pgid)) out.add(node);
  }
  // Keep variants that carry data; url-only stubs point at other colorways. A page listing more than
  // MAX_VARIANTS is read for its first MAX_VARIANTS only.
  return [...out].filter((v) => v.offers || v.sku || v.gtin || v.gtin13 || v.gtin12 || v.color || v.size).slice(0, MAX_VARIANTS);
}

// Variant match score: the exact URL with its query 4, the sku/mpn inside the URL 3, the same path 2
// (1 when the variant URL has a query), plus 0.5 when its image is the og:image.
function matchVariants(variants, pageUrl, ogImage, deref) {
  if (!variants.length) return [];
  const page = urlParts(pageUrl);
  const pageTok = page ? alnum(page.path + page.search) : '';
  const ogPath = ogImage ? urlParts(ogImage)?.path : null;
  const scored = variants.map((v) => {
    let s = 0;
    const urls = [v.url, v['@id'], ...offersOf(v, deref).map((o) => o.url)].map((u) => absUrl(u ?? '', pageUrl)).filter(Boolean);
    for (const u of urls) {
      const p = urlParts(u);
      if (!p || !page) continue;
      if (p.full === page.full && page.search) s = Math.max(s, 4);
      else if (p.path === page.path) s = Math.max(s, p.search ? 1 : 2);
    }
    const toks = [v.sku, v.mpn, v.productID].map(alnum).filter((t) => t.length >= 5);
    if (toks.some((t) => pageTok.includes(t))) s = Math.max(s, 3);
    if (ogPath && imageUrlsOf(v.image, pageUrl).some((i) => urlParts(i)?.path === ogPath)) s += 0.5;
    return { v, s };
  });
  // A loop, not Math.max(...list): spreading a very long list overflows the call stack.
  const max = scored.reduce((best, x) => Math.max(best, x.s), -Infinity);
  return max > 0 ? scored.filter((x) => x.s === max).map((x) => x.v) : variants;
}

const common = (list, f) => {
  const vals = list.map(f).filter((x) => x != null && x !== '');
  return vals.length && vals.every((x) => x === vals[0]) ? vals[0] : null;
};

const AVAILABILITY_ORDER = ['in_stock', 'limited', 'preorder', 'backorder', 'out_of_stock', 'discontinued'];

function fromJsonLd(ld, pageUrl, ogImage, fallbackCcy) {
  const { nodes, deref } = ld;
  const ranked = rankTopProducts(nodes, deref, pageUrl);
  const primary = ranked[0];
  if (!primary) return null;
  // Siblings: other top-level Products describing the same item (same name or URL). Vans ships a
  // ProductGroup (variants) plus a Product (sku, mpn, offers) for one shoe.
  const page = urlParts(pageUrl);
  const siblings = ranked
    .slice(1)
    .filter((n) => (n.name && alnum(n.name) === alnum(primary.name)) || (n.url && urlParts(absUrl(n.url, pageUrl) ?? '')?.path === page?.path));
  const sib = (f) => {
    for (const n of siblings) {
      const v = f(n);
      if (v != null && v !== '') return v;
    }
    return null;
  };
  const all = variantsOf(primary, nodes, deref);
  const matched = matchVariants(all, pageUrl, ogImage, deref);
  const r = {};
  r.name = str(primary.name) ?? common(matched, (v) => str(v.name));
  const brandOf = (n) => nameOf(deref(arr(n.brand)[0])) ?? nameOf(deref(n.manufacturer));
  r.brand = brandOf(primary) ?? common(matched, brandOf) ?? sib(brandOf);
  r.description = cleanText(primary.description ?? common(matched, (v) => v.description) ?? sib((n) => n.description), 1500);
  r.color = common(matched, (v) => str(v.color)) ?? (arr(primary.color).length === 1 ? str(arr(primary.color)[0]) : null) ?? sib((n) => str(n.color));
  if (r.color && r.name && r.color.startsWith(`${r.name} - `)) r.color = r.color.slice(r.name.length + 3); // Shopify: "Title - Color"
  r.sku = str(primary.sku) ?? common(matched, (v) => str(v.sku)) ?? sib((n) => str(n.sku)) ?? str(primary.productGroupID) ?? str(primary.productID);
  r.mpn = str(primary.mpn) ?? common(matched, (v) => str(v.mpn)) ?? sib((n) => str(n.mpn));
  // Per-size GTINs stay on the variants; the product GTIN is set only when it is unambiguous.
  r.gtin = gtinOf(primary) ?? common(matched, gtinOf) ?? (matched.length === 1 ? gtinOf(matched[0]) : null) ?? sib(gtinOf);
  r.images = [...matched.flatMap((v) => imageUrlsOf(v.image, pageUrl)), ...imageUrlsOf(primary.image, pageUrl), ...siblings.flatMap((n) => imageUrlsOf(n.image, pageUrl))];
  r.canonicalUrl = absUrl(primary.url ?? '', pageUrl);
  r.condition = normCondition(primary.itemCondition);

  // Offers: matched variants first, then the primary's own, then the siblings'.
  const offerSets = [matched.flatMap((v) => offersOf(v, deref)), offersOf(primary, deref), siblings.flatMap((n) => offersOf(n, deref))];
  let priced = [];
  for (const set of offerSets) {
    priced = set
      .map((o) => ({
        o,
        m: offerMoney(o, deref, fallbackCcy),
        a: normAvailability(o.availability) ?? (typesOf(o).includes('AggregateOffer') && Number(o.offerCount) > 0 ? 'in_stock' : null),
      }))
      .filter((x) => x.m);
    if (priced.length) break;
  }
  const avails = offerSets
    .flat()
    .map((o) => normAvailability(o.availability))
    .filter(Boolean);
  r.availability = AVAILABILITY_ORDER.find((a) => avails.includes(a)) ?? null;
  if (priced.length) {
    // The lowest in-stock price among the matched variants, in the first offer's currency.
    const inStock = priced.filter((x) => x.a === 'in_stock' || x.a === 'limited');
    const pool = (inStock.length ? inStock : priced).filter((x) => x.m.currency === priced[0].m.currency);
    const lowest = pool.reduce((a, b) => (b.m.amountMinor < a.m.amountMinor ? b : a));
    r.price = { amountMinor: lowest.m.amountMinor, currency: lowest.m.currency };
    const hi = pool.reduce((best, x) => Math.max(best, x.m.highMinor ?? x.m.amountMinor), -Infinity);
    if (hi > lowest.m.amountMinor) r.priceRange = { lowMinor: lowest.m.amountMinor, highMinor: hi, currency: lowest.m.currency };
    r.condition = r.condition ?? normCondition(lowest.o.itemCondition);
    r.shipping = shippingOf(lowest.o, deref, lowest.m.currency);
    r.seller = nameOf(deref(lowest.o.seller));
  } else {
    // Patagonia: the group and variants have no price, a second (reviews widget) Product node does.
    // Use it only when every such node agrees on one price.
    const others = nodes
      .filter(({ node }) => isProductNode(node) && node !== primary)
      .flatMap(({ node }) => offersOf(node, deref))
      .map((o) => offerMoney(o, deref, fallbackCcy))
      .filter(Boolean);
    const distinct = new Set(others.map((m) => `${m.amountMinor}${m.currency}`));
    if (distinct.size === 1) r.price = { amountMinor: others[0].amountMinor, currency: others[0].currency };
  }
  r.variants =
    matched.length > 1 || all.length > 1
      ? matched.slice(0, 60).map((v) => {
          const o = offersOf(v, deref)[0];
          const m = o ? offerMoney(o, deref, fallbackCcy) : null;
          return {
            sku: str(v.sku),
            gtin: gtinOf(v),
            size: str(v.size),
            color: str(v.color),
            price: m && { amountMinor: m.amountMinor, currency: m.currency },
            availability: normAvailability(o?.availability),
          };
        })
      : null;
  return r;
}

// ---------- site adapters (pages with no usable JSON-LD) ----------

// The text from the first occurrence of `marker`, at most `len` characters, or ''. Adapters read
// only there, so a page full of half-written markers can't make a regex re-read it again and again.
const near = (html, marker, len) => {
  const at = html.indexOf(marker);
  return at < 0 ? '' : html.slice(at, at + len);
};

const AMAZON_CCY = { com: 'USD', ca: 'CAD', 'co.uk': 'GBP', de: 'EUR', fr: 'EUR', it: 'EUR', es: 'EUR', nl: 'EUR', 'co.jp': 'JPY', 'com.au': 'AUD', 'com.mx': 'MXN', in: 'INR' };

const ADAPTERS = [
  {
    name: 'amazon',
    test: (host) => /(^|\.)amazon\.[a-z.]+$/.test(host),
    run(html, url, host) {
      const ccy = AMAZON_CCY[host.replace(/^.*?amazon\./, '')] ?? null;
      const title = near(html, 'id="productTitle"', 4000).match(/^[^>]*>([\s\S]*?)<\/span>/)?.[1];
      const byline = near(html, 'id="bylineInfo"', 2000).match(/^[^>]*>([^<]*)</)?.[1];
      const buybox = near(html, 'twister-plus-buying-options-price-data">', 20000).match(/^[^>]*>\s*(\{[\s\S]*?\})\s*<\/div>/)?.[1];
      let amount = null;
      try {
        amount = JSON.parse(decodeEntities(buybox)).desktop_buybox_group_1?.[0]?.priceAmount ?? null;
      } catch {
        // no buy box data on this page
      }
      amount = amount ?? near(html, 'apex-pricetopay-value', 600).match(/^apex-pricetopay-value[\s\S]{0,200}?a-offscreen">\s*([^<\s][^<]*)</)?.[1] ?? null;
      const avail = near(html, 'primary-availability-message">', 1000).match(/^[^>]*>\s*([^<]+?)\s*</)?.[1];
      const asin = near(html, 'id="ASIN"', 1000).split('>')[0].match(/value="([A-Z0-9]{10})"/)?.[1] ?? url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)?.[1];
      return {
        name: cleanText(title),
        brand: cleanText(byline?.replace(/^\s*(Visit the|Brand:)\s*/i, '').replace(/\s*Store\s*$/i, '')),
        price: money(amount, ccy),
        availability: avail ? (/in stock|left in stock/i.test(avail) ? 'in_stock' : /unavailable|out of stock/i.test(avail) ? 'out_of_stock' : null) : null,
        sku: asin ?? null,
        images: [...html.matchAll(/"hiRes":"(https:[^"]+)"/g)].map((m) => m[1]),
      };
    },
  },
  {
    name: 'goat',
    test: (host) => /(^|\.)goat\.com$/.test(host),
    run(html) {
      const at = html.indexOf('id="__NEXT_DATA__"');
      const start = at < 0 ? -1 : html.indexOf('>', at) + 1;
      const end = start > 0 ? html.indexOf('</script>', start) : -1;
      const nd = end > 0 ? html.slice(start, end) : null;
      let pt;
      try {
        pt = JSON.parse(nd).props.pageProps.productTemplate;
      } catch {
        return null;
      }
      if (!pt) return null;
      // Live asks load client-side; 0 means "not in the server HTML".
      const low = pt.lowestPriceCents?.amount ?? pt.lowestPriceCents;
      return {
        name: cleanText(pt.name),
        brand: cleanText(pt.brandName),
        mpn: cleanText(pt.sku),
        color: cleanText(pt.details ?? pt.color),
        description: cleanText(pt.story, 1500),
        images: [pt.mainPictureUrl ?? pt.gridPictureUrl].filter(Boolean),
        price: typeof low === 'number' && low > 0 ? { amountMinor: low, currency: 'USD' } : null,
      };
    },
  },
  {
    name: 'seiko',
    test: (host) => /(^|\.)seikowatches\.com$/.test(host),
    run(html) {
      const box = html.match(/class="productInformation-detail"[\s\S]{0,3000}?class="_price">\s*([A-Z]{3})\s*([\d.,]+)/);
      // The favorite button's own tag (the first one only, read with a bounded scan).
      const at = html.indexOf('js-productDetail-favorite-dataLayer-add"');
      const tag = at < 0 ? '' : html.slice(at, at + MAX_TAG_CHARS).split('>')[0];
      const btn = tag.match(/data-dataLayer-name="([^"]+)"[^>]*?data-dataLayer-brand="([^"]+)"/);
      // Only a product page has the price box or the favorite button; home and collection pages
      // get no adapter layer, so they are not mistaken for products.
      if (!box && !btn) return null;
      // A brand-owned site.
      return { brand: 'Seiko', price: box ? money(box[2], box[1]) : null, sku: btn ? btn[1] : null };
    },
  },
];

// ---------- main ----------

/**
 * Reads a product page.
 * @param {string} html
 * @param {string} url the page's final URL (base for relative links and variant matching)
 * @returns {{ name, brand, images: string[], price: { amountMinor: number, currency: string } | null,
 *   availability, sku, gtin, mpn, color, description, siteName, canonicalUrl, condition, priceRange,
 *   shipping, variants, seller, platform, ogType, currencyHint, source: Record<string, string> }}
 *   source maps each field to the layer it came from: jsonld | adapter:<site> | microdata | meta | html
 */
export function extractProduct(html, url) {
  html = String(html ?? '');
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // keep host empty for an unreadable URL
  }
  const meta = collectMeta(html);
  const m1 = (k) => meta.get(k)?.[0] ?? null;
  const links = collectLinks(html);
  const ld = readJsonLd(html);
  const ogImage = absUrl(m1('og:image:secure_url') ?? m1('og:image') ?? '', url, { https: true });
  const metaCcy = m1('product:price:currency') ?? m1('og:price:currency') ?? null;

  const layers = [];
  const j = fromJsonLd(ld, url, ogImage, metaCcy);
  if (j) layers.push(['jsonld', j]);
  for (const a of ADAPTERS) {
    if (!a.test(host)) continue;
    try {
      const r = a.run(html, url, host);
      if (r) layers.push([`adapter:${a.name}`, r]);
    } catch {
      // a changed page layout just skips the adapter
    }
  }
  const md = collectMicrodata(html);
  if (md) {
    layers.push([
      'microdata',
      {
        name: cleanText(md.name),
        brand: cleanText(md.brand),
        price: money(md.price, md.priceCurrency ?? metaCcy),
        availability: normAvailability(md.availability),
        condition: normCondition(md.itemCondition),
        sku: cleanText(md.sku ?? md.productID),
        mpn: cleanText(md.mpn),
        gtin: validGtin(md.gtin),
        color: cleanText(md.color),
        description: cleanText(md.description, 1500),
        images: md.images.map((u) => absUrl(u, url, { https: true })).filter(Boolean),
      },
    ]);
  }
  const siteNameMeta = cleanText(m1('og:site_name') ?? m1('application-name'));
  // Drops trailing " | Site", " - Site" and ". Site.com" segments that name the site.
  const stripSuffix = (t) => {
    if (!t) return t;
    const site = alnum(siteNameMeta ?? '') || alnum(host.replace(/^www\./, '').split('.')[0]);
    let s = t;
    for (let i = 0; site && i < 3; i++) {
      const m = s.match(/^(.*\S)(?:\s+[|–—-]\s+|\.\s+)([^|–—]{2,40})$/);
      const seg = m ? alnum(m[2]) : '';
      if (seg && (seg.includes(site) || (seg.length >= 3 && site.includes(seg)))) s = m[1];
      else break;
    }
    return s.trim();
  };
  const salePrice = m1('product:sale_price:amount');
  layers.push([
    'meta',
    {
      name: stripSuffix(cleanText(m1('og:title') ?? m1('twitter:title'))),
      brand: cleanText(m1('product:brand') ?? m1('og:brand')),
      price: salePrice ? money(salePrice, m1('product:sale_price:currency') ?? metaCcy) : money(m1('product:price:amount') ?? m1('og:price:amount'), metaCcy),
      availability: normAvailability(m1('product:availability') ?? m1('og:availability')),
      condition: normCondition(m1('product:condition')),
      sku: cleanText(m1('product:retailer_item_id')),
      color: cleanText(m1('product:color')),
      gtin: validGtin(m1('product:gtin') ?? m1('product:upc') ?? m1('product:ean')),
      description: cleanText(m1('og:description') ?? m1('twitter:description') ?? m1('description'), 1500),
      images: [
        ...(meta.get('og:image:secure_url') ?? []),
        ...(meta.get('og:image') ?? []),
        ...(meta.get('twitter:image') ?? []),
        ...links.filter((l) => l.rel === 'image_src').map((l) => l.href),
      ]
        .map((u) => absUrl(u, url, { https: true }))
        .filter(Boolean),
    },
  ]);
  const titleTag = cleanText(firstTitle(html.slice(0, HEAD_SCAN_CHARS)));
  layers.push(['html', { name: stripSuffix(titleTag) }]);

  const out = {};
  const source = {};
  const fields = ['name', 'brand', 'price', 'availability', 'sku', 'gtin', 'mpn', 'color', 'description', 'condition', 'priceRange', 'shipping', 'variants', 'seller'];
  for (const f of fields) {
    out[f] = null;
    for (const [layer, r] of layers) {
      if (r[f] != null && r[f] !== '') {
        out[f] = r[f];
        source[f] = layer;
        break;
      }
    }
  }
  if (out.priceRange && source.priceRange !== source.price) out.priceRange = null;
  out.images = dedupeImages(layers.flatMap(([, r]) => r.images ?? []));
  source.images =
    layers
      .filter(([, r]) => r.images?.length)
      .map(([l]) => l)
      .join('+') || null;
  // <link rel=canonical> beats og:url (END's og:url points at its home page).
  const canonical = links.find((l) => l.rel.split(/\s+/).includes('canonical'))?.href;
  out.canonicalUrl = absUrl(canonical ?? '', url) ?? absUrl(m1('og:url') ?? '', url) ?? j?.canonicalUrl ?? absUrl(url, url);
  out.siteName = siteNameMeta ?? out.seller ?? (host ? host.replace(/^www\./, '') : null);
  out.platform = /cdn\.shopify\.com|\/cdn\/shop\/|Shopify\.shop\s*=/.test(html)
    ? 'shopify'
    : /demandware\.static|\/dw\/image\/v2\//.test(html)
      ? 'salesforce-commerce-cloud'
      : /id="__NEXT_DATA__"|self\.__next_f\.push/.test(html)
        ? 'nextjs'
        : /__NUXT__/.test(html)
          ? 'nuxt'
          : null;
  out.ogType = cleanText(m1('og:type'))?.toLowerCase() ?? null;
  out.currencyHint = normCurrency(metaCcy) ?? normCurrency(html.match(/Shopify\.currency\s*=\s*\{\s*"active"\s*:\s*"([A-Z]{3})"/)?.[1]);
  out.source = source;
  const { name, brand, images, price, availability, sku, gtin, mpn, color, description, siteName, canonicalUrl, ...extras } = out;
  return { name, brand, images, price, availability, sku, gtin, mpn, color, description, siteName, canonicalUrl, ...extras };
}

/** Shopify stores expose /products/<handle>.js (cents) next to the page; null for other URLs. */
export function shopifyProductJsonUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    const m = u.pathname.match(/^(.*\/products\/[^/?#]+)/);
    return m ? `${u.origin}${m[1].replace(/\.(js|json)$/, '')}.js` : null;
  } catch {
    return null;
  }
}

/**
 * Merges a Shopify /products/<handle>.js (integer cents) or .json (decimal strings) answer into an
 * extraction result. Page values win; Shopify fills the gaps and supplies the variants.
 */
export function mergeShopifyProduct(result, data, currency = result?.price?.currency ?? null) {
  const p = data?.product ?? data;
  if (!p || !Array.isArray(p.variants)) return result;
  const isJs = typeof p.price === 'number' || typeof p.variants[0]?.price === 'number';
  const toM = (v) => (v == null || !currency ? null : isJs ? Math.round((Number(v) * 10 ** minorDigits(currency)) / 100) : toMinor(v, currency));
  const optNames = arr(p.options).map((o) => String(typeof o === 'string' ? o : (o?.name ?? '')).toLowerCase());
  const opt = (v, re) => {
    const i = optNames.findIndex((n) => re.test(n));
    return i >= 0 ? (v[`option${i + 1}`] ?? null) : null;
  };
  const vars = p.variants.map((v) => {
    const minor = toM(v.price);
    return {
      sku: v.sku || null,
      gtin: validGtin(v.barcode),
      size: opt(v, /size/),
      color: opt(v, /colou?r/),
      price: minor != null && minor > 0 ? { amountMinor: minor, currency } : null,
      availability: v.available == null ? null : v.available ? 'in_stock' : 'out_of_stock',
    };
  });
  const avail = vars.filter((v) => v.availability === 'in_stock');
  const pool = (avail.length ? avail : vars).filter((v) => v.price);
  const low = pool.length ? pool.reduce((a, b) => (b.price.amountMinor < a.price.amountMinor ? b : a)).price : null;
  const merged = {
    ...result,
    name: result.name ?? cleanText(p.title),
    brand: result.brand ?? cleanText(p.vendor),
    price: result.price ?? low,
    availability: result.availability ?? (vars.some((v) => v.availability) ? (avail.length ? 'in_stock' : 'out_of_stock') : null),
    gtin: result.gtin ?? (vars.length === 1 ? vars[0].gtin : null),
    sku: result.sku ?? (vars.length === 1 ? vars[0].sku : null),
    images: dedupeImages(
      [...(result.images ?? []), ...arr(p.images).map((i) => absUrl(typeof i === 'string' ? i : i?.src, 'https://cdn.shopify.com/', { https: true }))].filter(Boolean),
    ),
    variants: vars,
  };
  const source = { ...result.source, variants: 'shopify' };
  for (const f of ['name', 'brand', 'price', 'availability', 'gtin', 'sku']) if (result[f] == null && merged[f] != null) source[f] = 'shopify';
  return { ...merged, source };
}

// ---------- the API's Page ----------

// Product-looking URLs on known stores, plus generic /product(s)/ and long numeric .html paths.
const PRODUCT_URL = [
  /amazon\.[a-z.]+\/(?:[^/]+\/)?(?:dp|gp\/product)\/[A-Z0-9]{10}/i,
  /walmart\.com\/ip\//i,
  /target\.com\/p\//i,
  /ebay\.[a-z.]+\/itm\//i,
  /nike\.com\/(?:[a-z]{2}\/)?t\//i,
  /footlocker\.com\/product\//i,
  /stockx\.com\/(?:[a-z]{2}-[a-z]{2}\/)?[a-z0-9]+(?:-[a-z0-9]+){2,}\/?(?:[?#]|$)/i,
  /goat\.com\/(?:sneakers|apparel)\/[^/?#]+/i,
  /nordstrom\.com\/s\/[^/?#]+/i,
  /macys\.com\/shop\/product\//i,
  /zappos\.com\/p\//i,
  /adidas\.com\/(?:[a-z]{2}\/)?[a-z0-9-]+\/[A-Z0-9]{6}\.html/i,
  /levi\.com\/.*\/p\/[0-9A-Z]+/i,
  /\/products?[/.][^/?#]+/i,
  /\d{6,}\.html(?:[?#]|$)/i,
];

/** True when a URL looks like a single product's page. */
export function isLikelyProductPage(url) {
  return PRODUCT_URL.some((re) => re.test(String(url ?? '')));
}

const TRACKING_PARAMS = /^(?:utm_[a-z_]+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|msockid|mc_cid|mc_eid|_ga|_gl|igshid|yclid|twclid|ttclid)$/i;

/** The URL without ad and analytics tracking parameters. */
export function stripTracking(url) {
  try {
    const u = new URL(url);
    for (const name of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(name)) u.searchParams.delete(name);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

const bareHost = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};

const VIA = { jsonld: 'json-ld', microdata: 'microdata', meta: 'meta', shopify: 'shopify', html: 'title' };
const VIA_ORDER = ['json-ld', 'adapter', 'microdata', 'meta', 'shopify', 'title'];

// The canonical URL, unless it is on another site or drops the style code the final URL carries
// (Nike's and Foot Locker's canonical is the model page, not the colorway that was opened).
function pickPageUrl(product, finalUrl) {
  const canonical = product.canonicalUrl ? stripTracking(product.canonicalUrl) : null;
  if (!canonical || !validateImportUrl(canonical).ok || bareHost(canonical) !== bareHost(finalUrl)) return finalUrl;
  const pathTokens = (u) => {
    const x = new URL(u);
    return alnum(x.pathname + x.search);
  };
  const codes = [product.sku, product.mpn].map(alnum).filter((t) => t.length >= 5);
  if (codes.some((code) => pathTokens(finalUrl).includes(code) && !pathTokens(canonical).includes(code))) return finalUrl;
  return canonical;
}

/**
 * Shapes an extraction result into the API's Page. Images are absolute https URLs on public hosts
 * (best first, at most 8); unknown values are null.
 * @param {ReturnType<typeof extractProduct>} product
 * @param {{ requestedUrl: string, finalUrl: string, fetchedAt: string }} context
 */
export function toPage(product, { requestedUrl, finalUrl, fetchedAt }) {
  const url = pickPageUrl(product, stripTracking(finalUrl));
  const host = bareHost(url);
  const via = new Set(Object.values(product.source ?? {}).flatMap((layers) => String(layers).split('+').map((l) => (l.startsWith('adapter:') ? 'adapter' : VIA[l]))));
  const sizes = [];
  for (const v of product.variants ?? []) {
    const size = cleanText(v.size, 40);
    if (size && !sizes.includes(size) && sizes.length < 40) sizes.push(size);
  }
  return {
    url,
    requestedUrl,
    host,
    siteName: cleanText(product.siteName, 120) ?? host,
    name: cleanText(product.name, 300),
    brand: cleanText(product.brand, 120),
    description: product.description ?? null,
    images: product.images.filter((u) => u.startsWith('https://') && validateImportUrl(u).ok).slice(0, 8),
    price: product.price ? { amountMinor: product.price.amountMinor, currency: product.price.currency } : null,
    availability: AVAILABILITY_ORDER.includes(product.availability) ? product.availability : null,
    condition: ['new', 'used', 'refurbished'].includes(product.condition) ? product.condition : null,
    color: cleanText(product.color, 120),
    sku: cleanText(product.sku, 64),
    gtin: product.gtin ?? null,
    mpn: cleanText(product.mpn, 64),
    sizes,
    via: VIA_ORDER.filter((v) => via.has(v)),
    fetchedAt,
  };
}

/**
 * True when a page is a single product rather than a home, category or article page: structured
 * product data, og:type product, a price, or a name and image on a product-looking URL.
 */
export function looksLikeProduct(product, page) {
  if (!page.name) return false;
  const layers = Object.values(product.source ?? {}).join('+');
  if (/jsonld|microdata|adapter:|shopify/.test(layers)) return true;
  if (product.ogType && /product/.test(product.ogType)) return true;
  if (page.price) return true;
  return page.images.length > 0 && isLikelyProductPage(page.url);
}
