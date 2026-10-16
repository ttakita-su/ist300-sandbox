// Deterministic stand-ins for store pages, store images and Bing, for the backend unit tests and
// the browser web-flow test. fixtureUpstream() returns a real guarded upstream (backend/net.mjs)
// whose transport answers the URLs below from memory: URL validation, DNS checks, redirects, block
// detection, cooldowns and caching all run as they do live, and nothing leaves the machine. Any
// other host fails DNS like a site that doesn't exist. Everything here is made up; no real store
// or Bing page is copied.
//
// Hosts use the special-use .alt top-level domain (RFC 9476): it never resolves on the internet,
// and unlike .test (which the app's link check treats as a local name) it passes validateImportUrl.
// They resolve to the public-looking fake address FIXTURE_IP.
//
// Use: startAppServer({ port: 0, upstream: fixtureUpstream() }) from backend/server.mjs. The browser
// hot-links store images, so a Playwright test also routes the fixture hosts:
//   await context.route(/^https:\/\/[a-z]+\.fixture\.alt\//, async (route) => route.fulfill(await fixtureResponse(route.request().url())));
//
// Store pages (POST /api/lookup { url })
//   https://shop.fixture.alt/products/court-classic-white    found: JSON-LD ProductGroup "Court Classic Leather Sneaker",
//                                                             brand Fixture Athletics, $89.00 USD, White/White, sizes 8-11
//   https://shop.fixture.alt/p/court-classic-white           301 to the page above (found)
//   https://shop.fixture.alt/products/canvas-high-top        found: a Shopify page plus its /products/canvas-high-top.js
//   https://shop.fixture.alt/                                not_product (the store's home page)
//   https://shop.fixture.alt/products/discontinued-runner    not_product (404)
//   https://blocked.fixture.alt/products/court-classic-white blocked (403 Access Denied; that host then cools down)
//   https://shop.fixture.alt/go/private                      invalid_url: redirects to http://127.0.0.1/admin
//   https://private.fixture.alt/products/court-classic-white invalid_url: DNS answers 10.0.0.8
//   http://localtest.me/                                     invalid_url: DNS answers 127.0.0.1
// Images (POST /api/image { url }): 480x480 baseline JPEGs that browsers decode and re-encode
//   https://cdn.fixture.alt/court-classic-white.jpg          the product image
//   https://cdn.fixture.alt/listings/court-classic-low.jpg   Bing Shopping listing 1
//   https://cdn.fixture.alt/listings/court-classic-mid.jpg   Bing Shopping listing 2
//   https://cdn.fixture.alt/not-an-image.jpg                 an HTML page (image -> unsupported)
// Bing (www.bing.com resolves to the fake address too)
//   GET  /images?FORM=HDRSC2&setlang=en-us   the photo-search page: token attributes and a session cookie
//   POST /images/kblob?...                   needs the token header, the cookie and an imageBin image; answers
//                                            {"redirectUrl":"/search?q=Court%20Classic%20White&..."}
//                                            (fixtureUpstream({ lensQuery: null }) answers without q: no_match)
//   GET  /search?q=...                       queries with "court classic": the store page, the blocked store
//                                            page, a wiki page and a Bing page (filtered out); others: none
//   GET  /shop?q=...                         queries with "court classic": 2 free listings, plus one ad card
//                                            and one sponsored listing that are never read; others: none
//   A query containing "bing wall" gets Bing's challenge page (search -> blocked; Bing then cools
//   down for 30 minutes on that upstream). Pages with no results repeat the query, as Bing's do.
import { createUpstream } from '../../../backend/net.mjs';
import { sneakerJpeg } from './jpeg.mjs';

export const FIXTURE_IP = '93.184.215.14';
const FIXTURE_HOSTS = new Set(['shop.fixture.alt', 'cdn.fixture.alt', 'blocked.fixture.alt', 'wiki.fixture.alt', 'www.bing.com']);
const DNS_OVERRIDES = { 'localtest.me': '127.0.0.1', 'private.fixture.alt': '10.0.0.8' };

const TOKEN_HEADER = 'X-SNR-SignedToken-Kblob';
const TOKEN = 'fixture-kblob-token-0f3c9a';
const BING_COOKIE = 'MUID=FIXTURE0MUID';

export const FIXTURE = {
  ip: FIXTURE_IP,
  productUrl: 'https://shop.fixture.alt/products/court-classic-white',
  productShortUrl: 'https://shop.fixture.alt/p/court-classic-white',
  productImageUrl: 'https://cdn.fixture.alt/court-classic-white.jpg',
  shopifyUrl: 'https://shop.fixture.alt/products/canvas-high-top',
  homeUrl: 'https://shop.fixture.alt/',
  missingUrl: 'https://shop.fixture.alt/products/discontinued-runner',
  blockedUrl: 'https://blocked.fixture.alt/products/court-classic-white',
  privateRedirectUrl: 'https://shop.fixture.alt/go/private',
  privateDnsUrl: 'https://private.fixture.alt/products/court-classic-white',
  localDnsUrl: 'http://localtest.me/',
  notImageUrl: 'https://cdn.fixture.alt/not-an-image.jpg',
  listingImageUrls: ['https://cdn.fixture.alt/listings/court-classic-low.jpg', 'https://cdn.fixture.alt/listings/court-classic-mid.jpg'],
  query: 'Court Classic White',
  lensQuery: 'Court Classic White',
  product: {
    name: 'Court Classic Leather Sneaker',
    brand: 'Fixture Athletics',
    siteName: 'Fixture Shoe Co.',
    price: { amountMinor: 8900, currency: 'USD' },
    color: 'White/White',
    sizes: ['8', '9', '10', '11'],
  },
};

// GTIN-13 check digit, so the fixture identifiers are valid.
function gtin13(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return `${first12}${(10 - (sum % 10)) % 10}`;
}

let imageCache = null;
function images() {
  imageCache ??= {
    '/court-classic-white.jpg': sneakerJpeg(),
    '/listings/court-classic-low.jpg': sneakerJpeg({ background: '#e9eef1', accent: '#c9cdd2' }),
    '/listings/court-classic-mid.jpg': sneakerJpeg({ background: '#f1ece6', accent: '#1f3a5f', sole: '#d8c3a5' }),
  };
  return imageCache;
}

/** The fixture JPEG served at a cdn.fixture.alt path (e.g. '/court-classic-white.jpg'). */
export function fixtureImage(path) {
  return images()[path] ?? null;
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function productPage() {
  const variant = (size, digits, availability) => ({
    '@type': 'Product',
    sku: `FXCC100-WHT-${size.padStart(2, '0')}`,
    gtin13: gtin13(`0840000${digits}`),
    size,
    color: 'White/White',
    image: FIXTURE.productImageUrl,
    offers: { '@type': 'Offer', price: '89.00', priceCurrency: 'USD', availability: `https://schema.org/${availability}`, url: `${FIXTURE.productUrl}?size=${size}` },
  });
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    name: 'Court Classic Leather Sneaker',
    brand: { '@type': 'Brand', name: 'Fixture Athletics' },
    description: 'A clean leather court sneaker with a cupsole and a padded collar.',
    productGroupID: 'FXCC100',
    mpn: 'FXCC100-WHT',
    color: 'White/White',
    url: FIXTURE.productUrl,
    image: [FIXTURE.productImageUrl],
    hasVariant: [
      variant('8', '10008', 'InStock'),
      variant('9', '10009', 'InStock'),
      variant('10', '10010', 'InStock'),
      variant('11', '10011', 'OutOfStock'),
      // Another colorway, linked by URL only (the extractor drops it).
      { '@type': 'Product', url: 'https://shop.fixture.alt/products/court-classic-navy' },
    ],
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Court Classic Leather Sneaker - White | Fixture Shoe Co.</title>
<link rel="canonical" href="${FIXTURE.productUrl}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Fixture Shoe Co.">
<meta property="og:title" content="Court Classic Leather Sneaker - White">
<meta property="og:image" content="${FIXTURE.productImageUrl}">
<meta property="product:price:amount" content="89.00">
<meta property="product:price:currency" content="USD">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head><body><h1>Court Classic Leather Sneaker</h1><p>$89.00</p><img src="${FIXTURE.productImageUrl}" alt=""></body></html>`;
}

function shopifyPage() {
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: 'Canvas High Top', brand: 'Fixture Canvas Co.', image: 'https://cdn.fixture.alt/court-classic-white.jpg', url: FIXTURE.shopifyUrl };
  return `<!doctype html><html><head><meta charset="utf-8"><title>Canvas High Top – Fixture Canvas Co.</title>
<meta property="og:type" content="product"><meta property="og:site_name" content="Fixture Canvas Co.">
<meta property="og:price:currency" content="USD">
<script>Shopify.shop = "fixture-canvas.myshopify.com";</script>
<script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
}

const SHOPIFY_JS = {
  title: 'Canvas High Top',
  vendor: 'Fixture Canvas Co.',
  price: 6500,
  options: [{ name: 'Size' }],
  images: ['//cdn.fixture.alt/court-classic-white.jpg'],
  variants: [
    { sku: 'FXCH-09', barcode: gtin13('084000020009'), price: 6500, available: true, option1: '9' },
    { sku: 'FXCH-10', barcode: gtin13('084000020010'), price: 6500, available: false, option1: '10' },
  ],
};

const HOME_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Fixture Shoe Co. | Shoes for every day</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="Fixture Shoe Co."></head>
<body><h1>New arrivals</h1><a href="/products/court-classic-white">Court Classic</a></body></html>`;

const NOT_FOUND_PAGE = '<!doctype html><html><head><title>Page not found | Fixture Shoe Co.</title></head><body>Not found</body></html>';

// A synthetic block page in the shape of a CDN bot wall (short, 403, "Access Denied").
const BLOCK_PAGE = '<!doctype html><html><head><title>Access Denied</title></head><body><h1>Access Denied</h1><p>You don\'t have permission to access this page on this server.</p></body></html>';

const BING_SESSION_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bing Images</title></head><body>
<div id="sb_sbi_form_ph" style="display:none" method="POST" action="/images/kblob" enctype="multipart/form-data" data-kblobstheader="${TOKEN_HEADER}" data-kblobsttoken="${TOKEN}">
<input name="imgurl" type="search"></div></body></html>`;

const BING_CHALLENGE_PAGE = '<!doctype html><html><head><title>Bing</title></head><body><p>One last step. Please solve the captcha to continue.</p></body></html>';

// Bing wraps outbound links as /ck/a?...&u=a1<base64url(target)>.
const wrap = (target) => `https://www.bing.com/ck/a?!&amp;&amp;p=fixture&amp;ptn=3&amp;u=a1${Buffer.from(target).toString('base64url')}&amp;ntb=1`;

function serpPage(query) {
  const results = /court classic/i.test(query)
    ? [
        { url: FIXTURE.productUrl, title: 'Court Classic Leather Sneaker - <strong>White</strong> | Fixture Shoe Co.', snippet: 'Clean white leather court sneaker with a cupsole. Sizes 8 to 11, $89.00.' },
        { url: 'https://wiki.fixture.alt/wiki/Court_shoe', title: 'Court shoe - Fixture Wiki', snippet: 'A court shoe is a low athletic shoe first made for tennis &amp; basketball courts.' },
        { url: FIXTURE.blockedUrl, title: 'Court Classic White | Blocked Outfitters', snippet: 'Shop the Court Classic in white.' },
        { url: '/images/search?q=court+classic+white&FORM=IRPRST', title: 'Images of Court Classic White', snippet: 'See all images' },
      ]
    : [];
  const blocks = results.map(
    (r) =>
      `<li class="b_algo" data-id><div class="b_tpcn"><a class="tilk" href="${wrap(r.url)}"><div class="tptt">${escapeHtml(new URL(r.url, 'https://www.bing.com').hostname)}</div></a></div><h2><a target="_blank" href="${wrap(r.url)}">${r.title}</a></h2><div class="b_caption"><p class="b_lineclamp2">${r.snippet}</p></div></li>`,
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(query)} - Search</title></head><body>
<ol id="b_results"><li class="b_ad"><h2><a href="https://www.bing.com/aclick?ld=fixture">Sponsored: Fixture Ads</a></h2></li>${blocks.join('')}${blocks.length ? '' : `<li class="b_no"><p>There are no results for <strong>${escapeHtml(query)}</strong></p></li>`}<li class="b_pag"></li></ol></body></html>`;
}

function shopPage(query) {
  const listings = /court classic/i.test(query)
    ? [
        { goid: '9001', title: 'Court Classic Low Leather Sneaker, White', price: '$89.00', seller: 'Fixture Shoe Co.', image: FIXTURE.listingImageUrls[0], free: true },
        { goid: '9002', title: 'Court Classic Mid Sneaker - White/Navy', price: '$74.99', seller: 'Second Street Fixture', image: FIXTURE.listingImageUrls[1], free: true },
        { goid: '9003', title: 'Court Classic Promoted Pair', price: '$59.00', seller: 'Promoted Fixture', image: FIXTURE.listingImageUrls[0], free: false },
      ]
    : [];
  const item = (l) =>
    `<li class="br-item" data-url="/shop/entitydetails?q=${encodeURIComponent(query)}&amp;filters=gGlobalOfferIds%3a%22${l.goid}%22+NonSponsoredOffer%3a%22${l.free}%22" data-offerId="${l.goid}"><div class="br-card"><div class="br-slideshow"><div class="cico br-pdMainImg"><img src="${l.image}" alt="${escapeHtml(l.title)}"></div></div><a class="br-titlelink" href="/shop/productdetails?q=${encodeURIComponent(query).replace(/%20/g, '+')}&amp;goid=${l.goid}&amp;FORM=SHPPDP"><div class="br-title"><span title="${escapeHtml(l.title)}">${escapeHtml(l.title.slice(0, 30))}…</span></div></a><div class="br-price"><div class="pd-price br-standardPrice"><div class="resp-one-line">${l.price}</div></div></div><div class="br-sellerName"><div class="resp-one-line br-seller">${escapeHtml(l.seller)}</div></div></div></li>`;
  const ad = `<div class="br-gOffCard"><a class="br-offLink" rel="sponsored" href="https://www.bing.com/aclick?ld=fixture&amp;u=aHR0cHM6Ly9zaG9wLmZpeHR1cmUuYWx0Lw"><div class="br-offTtl">Court Classic Sponsored</div><div class="br-price">$49.00</div></a></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(query)} - Shopping</title></head><body>
<div class="br-adsCarousel">${listings.length ? ad : ''}</div><ul class="br-grid">${listings.map(item).join('')}</ul></body></html>`;
}

const html = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, body: Buffer.from(body) });
const json = (status, value) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from(JSON.stringify(value)) });

async function bingResponse(url, method, headers, body, lensQuery) {
  const query = url.searchParams.get('q') ?? '';
  if (method === 'GET' && url.pathname === '/images' && url.searchParams.get('FORM') === 'HDRSC2') {
    return html(200, BING_SESSION_PAGE, { 'set-cookie': [`${BING_COOKIE}; domain=.bing.com; path=/; secure`] });
  }
  if (method === 'POST' && url.pathname === '/images/kblob') {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (lower[TOKEN_HEADER.toLowerCase()] !== TOKEN || !String(lower.cookie ?? '').includes(BING_COOKIE)) return html(400, '<html><body>Bad request</body></html>');
    let form;
    try {
      form = await new Response(body, { headers: { 'Content-Type': lower['content-type'] } }).formData();
    } catch {
      return html(400, '<html><body>Bad request</body></html>');
    }
    const image = Buffer.from(String(form.get('imageBin') ?? ''), 'base64');
    const isImage = (image[0] === 0xff && image[1] === 0xd8) || image.subarray(1, 4).toString() === 'PNG' || image.subarray(8, 12).toString() === 'WEBP';
    if (form.get('cbir') !== 'sbi' || form.get('imgurl') !== '' || !isImage) return html(400, '<html><body>Bad request</body></html>');
    if (!lensQuery) return json(200, { redirectUrl: '/images/search?view=detailv2&iss=sbiupload&FORM=SBIIRP' });
    return json(200, { redirectUrl: `/search?q=${encodeURIComponent(lensQuery)}&bcid=FixtureBcid&FORM=SBIIRP&fq=1&hq=1&qt=shop` });
  }
  if (method === 'GET' && (url.pathname === '/search' || url.pathname === '/shop')) {
    if (/bing wall/i.test(query)) return html(200, BING_CHALLENGE_PAGE);
    return html(200, url.pathname === '/search' ? serpPage(query) : shopPage(query));
  }
  return html(404, NOT_FOUND_PAGE);
}

function storeResponse(url, method) {
  if (method !== 'GET') return html(405, NOT_FOUND_PAGE);
  const cookie = { 'set-cookie': ['fixture_session=1; path=/; HttpOnly'] };
  if (url.hostname === 'blocked.fixture.alt') return html(403, BLOCK_PAGE);
  if (url.hostname === 'wiki.fixture.alt') return html(200, '<!doctype html><html><head><title>Court shoe - Fixture Wiki</title><meta property="og:type" content="article"></head><body>Court shoes</body></html>');
  if (url.hostname === 'cdn.fixture.alt') {
    if (url.pathname === '/not-an-image.jpg') return html(200, '<!doctype html><html><body>Not an image</body></html>');
    const image = fixtureImage(url.pathname);
    return image ? { status: 200, headers: { 'content-type': 'image/jpeg' }, body: image } : html(404, NOT_FOUND_PAGE);
  }
  switch (url.pathname) {
    case '/':
      return html(200, HOME_PAGE, cookie);
    case '/products/court-classic-white':
      return html(200, productPage(), cookie);
    case '/p/court-classic-white':
      return { status: 301, headers: { location: '/products/court-classic-white', ...cookie }, body: Buffer.alloc(0) };
    case '/products/canvas-high-top':
      return html(200, shopifyPage(), cookie);
    case '/products/canvas-high-top.js':
      return { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' }, body: Buffer.from(JSON.stringify(SHOPIFY_JS)) };
    case '/go/private':
      return { status: 302, headers: { location: 'http://127.0.0.1/admin' }, body: Buffer.alloc(0) };
    default:
      return html(404, NOT_FOUND_PAGE);
  }
}

async function fixtureAnswer(href, { method = 'GET', headers = {}, body = null, lensQuery = FIXTURE.lensQuery } = {}) {
  const url = new URL(href);
  if (!FIXTURE_HOSTS.has(url.hostname)) return html(404, NOT_FOUND_PAGE);
  return url.hostname === 'www.bing.com' ? bingResponse(url, method, headers, body, lensQuery) : storeResponse(url, method);
}

/**
 * The fixture answer for a URL, shaped for Playwright's route.fulfill(): { status, contentType,
 * headers, body }. Headers are plain strings and no cookies are set. Unknown hosts get a 404.
 * @param {string} href
 * @param {{ method?: string, headers?: Record<string, string>, body?: Buffer | null, lensQuery?: string | null }} [init]
 */
export async function fixtureResponse(href, init = {}) {
  const answer = await fixtureAnswer(href, init);
  const headers = Object.fromEntries(Object.entries(answer.headers).filter(([name, value]) => name !== 'set-cookie' && typeof value === 'string'));
  return { status: answer.status, contentType: headers['content-type'] ?? 'application/octet-stream', headers, body: answer.body };
}

/**
 * A transport (DNS + HTTP) that answers the fixture URLs and records every request.
 * @param {{ lensQuery?: string | null }} [options]
 */
export function fixtureTransport({ lensQuery = FIXTURE.lensQuery } = {}) {
  const requests = [];
  return {
    requests,
    async resolve(hostname) {
      if (DNS_OVERRIDES[hostname]) return [{ address: DNS_OVERRIDES[hostname], family: 4 }];
      if (FIXTURE_HOSTS.has(hostname)) return [{ address: FIXTURE_IP, family: 4 }];
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    },
    async send({ url, addresses, method, headers, body }) {
      requests.push({ method, url: url.href, address: addresses[0]?.address ?? null, headers: { ...headers } });
      if (!addresses.every((a) => a.address === FIXTURE_IP)) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      const answer = await fixtureAnswer(url.href, { method, headers, body, lensQuery });
      return { status: answer.status, headers: answer.headers, body: answer.body };
    },
  };
}

/**
 * A guarded upstream over the fixture transport, for startAppServer({ upstream }). Requests are
 * not spaced unless minIntervalMs is given; every other guard runs as in production.
 * @param {{ lensQuery?: string | null } & Parameters<typeof createUpstream>[0]} [options]
 * @returns {ReturnType<typeof createUpstream> & { requests: { method: string, url: string, address: string, headers: Record<string, string> }[] }}
 */
export function fixtureUpstream(options = {}) {
  const transport = fixtureTransport(options);
  const upstream = createUpstream({ minIntervalMs: 0, ...options, transport });
  return Object.assign(upstream, { requests: transport.requests });
}
