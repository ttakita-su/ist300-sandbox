// Real product lookup and photo search, data layer: the pure guessing helpers, WebSnapshot
// validation, money digits, the web operations against a scripted provider (no network ever),
// saving items from the web, and how store images follow the photo rules (display, deletion,
// export, stylist sharing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv, rejectsWith, fakeJpeg, waitForJob, ALEX, SAM, JORDAN, MORGAN, NOW } from '../helpers.mjs';
import { createTestProviders, fakeWebProvider } from '../../js/server/providers/test.js';
import { NOT_CONNECTED, NO_ANSWER, notConnectedWeb } from '../../js/server/providers/web.js';
import { cleanWebSnapshot } from '../../js/server/records.js';
import { DEFAULT_CONFIG, RATE_LIMITS } from '../../js/server/api.js';
import { draftFromWeb, guessBrand, guessCategory, guessColors, guessType } from '../../js/engine/web-guess.js';
import { date as formatDate, money } from '../../js/lib/format.js';

const NODE_HAS_NO_DOM = typeof globalThis.document === 'undefined';

// Synthetic store data in the shapes the local server returns (design 2.1). Nothing is fetched.
const PAGE = {
  url: 'https://www.nike.com/t/air-force-1-07-mens-shoes-DZejrQoC/CW2288-111',
  requestedUrl: 'https://www.nike.com/t/air-force-1-07-mens-shoes-jBrhbr/CW2288-111',
  host: 'evil.example',
  siteName: 'Nike.com',
  name: "Nike Air Force 1 '07 Men's Shoes",
  brand: 'Nike',
  description: 'The radiance lives on.',
  images: ['https://static.nike.com/a/images/af1.png', 'http://static.nike.com/insecure.png', 'javascript:alert(1)'],
  price: { amountMinor: 11500, currency: 'USD' },
  availability: 'in_stock',
  condition: 'new',
  color: 'White/White',
  sku: 'DZejrQoC',
  gtin: null,
  mpn: 'CW2288-111',
  sizes: ['8', '9', '10'],
  via: ['json-ld', 'made-up'],
  fetchedAt: '2026-10-14T11:58:00.000Z',
};
const LISTING = {
  id: 'shop_1',
  title: "Casio Men's Classic Resin Strap Sport Wristwatch F91w-1",
  price: { amountMinor: 2899, currency: 'USD' },
  priceText: '$28.99',
  seller: 'Walmart',
  imageUrl: 'https://th.bing.com/th?id=OPHS.f91w',
  url: 'https://www.bing.com/shop/productdetails?q=Casio+F-91W&goid=1',
  source: 'bing_shopping',
};
const RESULT = { id: 'web_1', title: 'F-91W | CASIO', url: 'https://www.casio.com/intl/watches/casio/products/f-91w/', host: 'casio.com', snippet: 'A classic digital watch.', productPage: true };
const SEARCH_OK = {
  status: 'ok',
  engine: 'bing',
  query: 'casio f-91w',
  shopping: [LISTING, { id: 'shop_2', title: 'No link here' }, { ...LISTING, id: 'shop_3', seller: 'Amazon', price: { amountMinor: 21.92, currency: 'USD' } }],
  results: [RESULT, { id: 'web_2', title: 'Bing images', url: 'https://www.bing.com/images/search?q=f91w' }, { id: 'web_3', title: 'No link' }],
};
const LENS_OK = { ...SEARCH_OK, query: 'Casio F-91W' };
// An empty scene: the on-device matcher finishes quickly with no catalog match.
const EMPTY_FEATURES = { v: 1, category: null, width: 256, height: 192, fgRatio: 0, bbox: { x: 0, y: 0, w: 1, h: 1 }, aspect: 1, palette: [], grid: { cols: 6, rows: 4, cells: [] }, stats: { brightness: 0.5, colorfulness: 0, edgeDensity: 0 } };

const storeImage = ({ url }) => ({ status: 'ok', blob: fakeJpeg(4096), mime: 'image/jpeg', finalUrl: url });

async function webEnv({ web, providers = {}, ...opts } = {}) {
  const env = await createTestEnv({ providers: { features: EMPTY_FEATURES, ...providers, web }, ...opts });
  const [alex, sam, jordan] = await Promise.all([ALEX, SAM, JORDAN].map((id) => env.as(id)));
  return { ...env, alex, sam, jordan };
}

/** Looks the page up, keeps its image and saves it to the collection, as the save view does. */
async function saveFromPage(api, call, { key = 'p1', page = PAGE, extra = {} } = {}) {
  const { draft } = await api.lookupProductPage(call, { url: page.requestedUrl ?? page.url });
  const image = await api.importWebImage(call, { imageUrl: draft.imageUrl, pageUrl: draft.web.url, idempotencyKey: `img-${key}` });
  const item = await api.createOwned(call, { source: 'web', category: draft.category, custom: draft.custom, web: draft.web, photos: { webId: image.photoId }, idempotencyKey: `own-${key}`, ...extra });
  return { draft, image, item };
}

/** A finished match job for an uploaded photo. */
async function finishedJob(api, call, { dest = 'owned', category = 'watch', rotate = 90 } = {}) {
  const upload = await api.uploadPhoto(call, { blob: fakeJpeg(3000), kind: 'original' });
  const created = await api.createMatchJob(call, { photoId: upload.photoId, processingId: upload.processingId, category, dest, crop: { x: 0, y: 0, w: 1, h: 1, rotate } });
  return { upload, job: await waitForJob(api, call, created.id) };
}

function withNoFetch(fn) {
  return async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('no network in unit tests');
    };
    try {
      await fn();
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(calls, 0, 'nothing was fetched');
  };
}

// ---------- Pure helpers ----------

test('web-guess and the web ops import in Node without a DOM', () => {
  assert.ok(NODE_HAS_NO_DOM);
  assert.equal(typeof draftFromWeb, 'function');
  assert.equal(createTestProviders().web, notConnectedWeb, 'tests get the not-connected provider unless they ask');
});

test('guessCategory reads the product word, a model name or a one-category brand', () => {
  assert.equal(guessCategory("Casio Men's Classic Resin Strap Sport Wristwatch F91w-1"), 'watch');
  assert.equal(guessCategory('Seiko 5 Sports SRPD55'), 'watch');
  assert.equal(guessCategory('Casio F-91W'), 'watch');
  assert.equal(guessCategory('G-Shock DW5600'), 'watch');
  assert.equal(guessCategory('Chronograph 42mm'), 'watch');
  assert.equal(guessCategory("Nike Air Force 1 '07 Men's Shoes"), 'sneaker');
  assert.equal(guessCategory('Nike Dunk Low Panda'), 'sneaker');
  assert.equal(guessCategory('Chuck Taylor All Star'), 'sneaker');
  assert.equal(guessCategory('New Balance 990v6'), 'sneaker');
  assert.equal(guessCategory("Levi's 501 Original Fit Jeans"), 'clothing');
  assert.equal(guessCategory('Supima Cotton Crew Neck T-Shirt'), 'clothing');
  assert.equal(guessCategory('Better Sweater Fleece Jacket'), 'clothing');
  // Not something Rotation keeps, or not enough to tell.
  assert.equal(guessCategory('Nike Shoe Bag'), null, 'the last product word decides');
  assert.equal(guessCategory('Apple iPhone 15 Pro'), null);
  assert.equal(guessCategory('Leather Backpack'), null);
  assert.equal(guessCategory('Crew Socks 6 Pack'), null);
  assert.equal(guessCategory('Gift card'), null);
  assert.equal(guessCategory(''), null);
});

test('guessType maps words to PRODUCT_TYPES ids, or null', () => {
  assert.equal(guessType('sneaker', "Nike Air Force 1 '07"), 'court');
  assert.equal(guessType('sneaker', 'Chuck Taylor All Star High Top'), 'high-top');
  assert.equal(guessType('sneaker', 'Air Jordan 1 Retro High OG'), 'high-top');
  assert.equal(guessType('sneaker', 'Pegasus 41 running shoe'), 'runner');
  assert.equal(guessType('sneaker', 'Salomon XT-6'), 'trail');
  assert.equal(guessType('sneaker', 'Old Skool'), 'skate');
  assert.equal(guessType('sneaker', 'Classic Slip-On'), 'slip-on');
  assert.equal(guessType('watch', 'Prospex Diver 200m'), 'diver');
  assert.equal(guessType('watch', 'Speedmaster Professional Chronograph'), 'chronograph');
  assert.equal(guessType('watch', 'Casio F-91W'), 'digital');
  assert.equal(guessType('watch', 'GMT Master II'), 'gmt');
  assert.equal(guessType('watch', '20mm Leather Watch Strap'), 'strap');
  assert.equal(guessType('watch', 'Marlin Leather Strap Watch'), null, 'a watch on a strap is not a strap');
  assert.equal(guessType('clothing', "Levi's 501 Jeans"), 'jeans');
  assert.equal(guessType('clothing', 'Pullover Hoodie'), 'hoodie');
  assert.equal(guessType('clothing', 'Crew Neck Short-Sleeve T-Shirt'), 'tee');
  assert.equal(guessType('clothing', 'Chino Pants'), 'chinos');
  assert.equal(guessType('clothing', 'Chino Shorts'), 'shorts');
  assert.equal(guessType('clothing', 'Better Sweater Fleece Jacket'), null, 'a fleece jacket is no catalog type');
  assert.equal(guessType(null, 'Air Force 1'), null);
});

test('guessColors keeps only Rotation color names, in order, at most four', () => {
  assert.deepEqual(guessColors('Triple White'), ['white']);
  assert.deepEqual(guessColors('White/White'), ['white']);
  assert.deepEqual(guessColors('Navy'), ['navy']);
  assert.deepEqual(guessColors('Black / White'), ['black', 'white']);
  assert.deepEqual(guessColors('Sail/Black-Gum'), ['off-white', 'black', 'gum']);
  assert.deepEqual(guessColors('Jet Black (White Sole)'), ['black', 'white']);
  assert.deepEqual(guessColors('Rose Gold Stainless Steel'), ['rose-gold', 'steel']);
  assert.deepEqual(guessColors('Light Grey Heather'), ['light-grey']);
  assert.deepEqual(guessColors('Red Blue Green Yellow Pink'), ['red', 'blue', 'green', 'yellow']);
  assert.deepEqual(guessColors('Old Growth'), []);
  assert.deepEqual(guessColors(null), []);
});

test('guessBrand prefers the page brand, then a leading brand, then the store host', () => {
  assert.equal(guessBrand({ title: 'anything', brand: 'TIMEX' }), 'Timex', 'known brands get their usual spelling');
  assert.equal(guessBrand({ title: 'Made in USA 990v6', brand: 'New Balance Classics' }), 'New Balance Classics');
  assert.equal(guessBrand({ title: "Men's Levi's® 501™ Original Fit Jeans" }), "Levi's");
  assert.equal(guessBrand({ title: '[Brand New] Casio F-91W-1JH Black' }), 'Casio');
  assert.equal(guessBrand({ title: 'NEW CASIO F91 DIGITAL WATCH' }), 'Casio');
  assert.equal(guessBrand({ title: 'Old Skool Shoe', host: 'vans.com' }), 'Vans');
  assert.equal(guessBrand({ title: 'SPB453J1', host: 'seikowatches.com' }), 'Seiko');
  assert.equal(guessBrand({ title: 'Chuck Taylor All Star High Top' }), 'Converse', 'a model line names its brand');
  assert.equal(guessBrand({ title: 'Kith Box Logo Hoodie' }), 'Kith');
  assert.equal(guessBrand({ title: 'Classic Logo Hoodie', host: 'zappos.com' }), null, 'a description word is not a brand');
  assert.equal(guessBrand({ title: 'Court Classic Low Leather Sneaker, White' }), null, 'nor is a type word');
});

test('draftFromWeb turns a store page into a custom draft with no size, condition or catalog id', () => {
  const now = NOW;
  const draft = draftFromWeb({ page: PAGE, via: 'page', now });
  assert.equal(draft.category, 'sneaker');
  assert.deepEqual(draft.custom, { brand: 'Nike', name: "Air Force 1 '07", variantName: 'White/White', type: 'court', colors: ['white'] });
  assert.equal(draft.imageUrl, 'https://static.nike.com/a/images/af1.png');
  assert.equal(draft.web.host, 'nike.com', 'the host comes from the URL, not from the page');
  assert.equal(draft.web.siteName, 'Nike.com');
  assert.equal(draft.web.via, 'page');
  assert.equal(draft.web.query, null);
  assert.deepEqual(draft.web.identifiers, { sku: 'DZejrQoC', gtin: null, mpn: 'CW2288-111' });
  assert.deepEqual(draft.web.price, { amountMinor: 11500, currency: 'USD' });
  assert.equal(draft.web.fetchedAt, '2026-10-14T11:58:00.000Z');
  const text = JSON.stringify(draft);
  for (const key of ['"size', '"sizes"', '"condition"', '"productId"', '"variantId"']) assert.ok(!text.includes(key), `no ${key} in a draft`);

  // A listing: the seller is where it was seen, not the brand; the job's category wins when set.
  const listing = draftFromWeb({ listing: LISTING, via: 'photo', query: 'Casio F-91W', category: 'watch', now });
  assert.equal(listing.category, 'watch');
  assert.deepEqual(listing.custom, { brand: 'Casio', name: 'Classic Resin Strap Sport Wristwatch F91w-1', variantName: null, type: 'digital', colors: [] });
  assert.equal(listing.web.siteName, 'Walmart');
  assert.equal(listing.web.host, 'bing.com');
  assert.equal(listing.web.query, 'Casio F-91W');
  assert.equal(listing.web.fetchedAt, new Date(now).toISOString());
  assert.equal(listing.imageUrl, LISTING.imageUrl);

  const sized = draftFromWeb({ listing: { ...LISTING, title: "Men's Levi's® 501™ Original Fit Jeans, Size: 32X34, Saturday At Noon" }, via: 'search', query: 'levis 501', now });
  assert.equal(sized.custom.name, '501 Original Fit Jeans, Saturday At Noon', 'a size in a title never reaches the draft');
  assert.equal(sized.custom.type, 'jeans');
  const named = (title) => draftFromWeb({ listing: { ...LISTING, title }, via: 'search', now }).custom.name;
  assert.equal(named("Nike Air Force 1 '07 Men\u2019s Shoes"), "Air Force 1 '07", 'curly apostrophes too');
  assert.equal(named('Champion Reverse Weave Hoodie (Size M)'), 'Reverse Weave Hoodie');
  assert.equal(named('Big Size Fit Hoodie'), 'Big Size Fit Hoodie', 'only a real size is dropped');
  assert.equal(named('Casio Men S Classic Resin Strap Sport Wristwatch F91W-1'), 'Classic Resin Strap Sport Wristwatch F91W-1');
  assert.equal(named('Oversize Hoodie'), 'Oversize Hoodie', 'a description word is not taken as the brand');
  assert.equal(named('White Air Force 1 Shoes - Nike'), 'White Air Force 1 Shoes', "a trailing '- Brand' goes");
  assert.equal(draftFromWeb({ listing: { ...LISTING, url: 'javascript:alert(1)' }, via: 'search', now }), null, 'no usable link, no draft');
  assert.equal(draftFromWeb({ page: { ...PAGE, name: 'x'.repeat(400) }, via: 'page', now }).custom.name.length, 120);
});

test('cleanWebSnapshot rebuilds a snapshot from untrusted input', () => {
  const now = NOW;
  const clean = cleanWebSnapshot(
    {
      url: ' https://www.Nike.com/t/af1?x=1 ',
      host: 'attacker.example',
      siteName: `  Nike\u0000.com${' '.repeat(3)}`,
      title: 't'.repeat(300),
      brand: 'b'.repeat(200),
      color: 'White\u200B/White',
      price: { amountMinor: 11500, currency: 'USD', extra: true },
      availability: 'in_stock',
      identifiers: { sku: 's'.repeat(80), gtin: 194366326499, mpn: '' },
      imageUrl: 'https://static.nike.com/a.png',
      via: 'search',
      query: 'q'.repeat(300),
      fetchedAt: '2026-10-14T11:00:00Z',
      secret: 'dropped',
    },
    now,
  );
  assert.equal(clean.url, 'https://www.nike.com/t/af1?x=1');
  assert.equal(clean.host, 'nike.com');
  assert.equal(clean.siteName, 'Nike .com');
  assert.equal(clean.title.length, 200);
  assert.equal(clean.brand.length, 120);
  assert.equal(clean.color, 'White /White');
  assert.deepEqual(clean.price, { amountMinor: 11500, currency: 'USD' });
  assert.deepEqual(clean.identifiers, { sku: 's'.repeat(64), gtin: '194366326499', mpn: null });
  assert.equal(clean.query.length, 200);
  assert.equal(clean.fetchedAt, '2026-10-14T11:00:00.000Z');
  assert.deepEqual(Object.keys(clean).sort(), ['availability', 'brand', 'color', 'fetchedAt', 'host', 'identifiers', 'imageUrl', 'price', 'query', 'siteName', 'title', 'url', 'via']);

  const base = { url: 'https://shop.example/p/1' };
  for (const price of [{ amountMinor: 19.99, currency: 'USD' }, { amountMinor: -1, currency: 'USD' }, { amountMinor: 2e9, currency: 'USD' }, { amountMinor: 100, currency: 'usd' }, { amountMinor: 100, currency: 'DOLLARS' }, '100']) {
    assert.equal(cleanWebSnapshot({ ...base, price }, now).price, null, JSON.stringify(price));
  }
  assert.deepEqual(cleanWebSnapshot({ ...base, price: { amountMinor: 15000, currency: 'JPY' } }, now).price, { amountMinor: 15000, currency: 'JPY' });
  const odd = cleanWebSnapshot({ ...base, availability: 'maybe', via: 'scrape', imageUrl: 'data:image/png;base64,AAAA', fetchedAt: '2027-01-01T00:00:00Z' }, now);
  assert.equal(odd.availability, null);
  assert.equal(odd.via, null);
  assert.equal(odd.imageUrl, null);
  assert.equal(odd.fetchedAt, new Date(now).toISOString(), 'a time in the future becomes now');
  assert.equal(cleanWebSnapshot({ ...base, fetchedAt: 'yesterday' }, now).fetchedAt, new Date(now).toISOString());
  for (const url of ['javascript:alert(1)', 'ftp://shop.example/x', 'https://user:pw@shop.example/', `https://shop.example/${'a'.repeat(2100)}`, '', null]) {
    assert.equal(cleanWebSnapshot({ url }, now), null, String(url).slice(0, 40));
  }
  assert.equal(cleanWebSnapshot('https://shop.example/p/1', now), null);
  assert.equal(cleanWebSnapshot([], now), null);
});

test('money uses each currency’s own minor digits, and USD output is unchanged', () => {
  assert.equal(money(11500), '$115');
  assert.equal(money(11599, 'USD'), '$115.99');
  assert.equal(money(11500, 'USD', { whole: false }), '$115.00');
  assert.equal(money(0), '$0');
  assert.equal(money(null), 'Unknown');
  assert.equal(money(15000, 'JPY'), '¥15,000');
  assert.equal(money(15000, 'JPY', { whole: false }), '¥15,000');
  assert.equal(money(1234, 'KWD').replace(/\s/g, ' '), 'KWD 1.234', 'three digits (Intl puts a no-break space after the code)');
  assert.equal(money(12345, 'EUR'), '€123.45');
  assert.equal(money(19995, 'GBP'), '£199.95');
});

// ---------- Provider stand-ins ----------

test('without the local server nothing is fetched and every call says so', withNoFetch(async () => {
  assert.deepEqual(await notConnectedWeb.status(), { live: false, reason: NOT_CONNECTED });
  for (const call of ['lookup', 'search', 'searchImage', 'fetchImage']) {
    assert.deepEqual(await notConnectedWeb[call]({}), { status: 'not_connected', reason: NOT_CONNECTED });
  }
  const { api, alex } = await webEnv();
  assert.deepEqual(await api.webStatus(alex, {}), { live: false, reason: NOT_CONNECTED });
  assert.deepEqual(await api.lookupProductPage(alex, { url: PAGE.url }), { status: 'not_connected', reason: NOT_CONNECTED });
  assert.deepEqual(await api.searchWebProducts(alex, { query: 'casio f-91w' }), { status: 'not_connected', reason: NOT_CONNECTED });
  assert.deepEqual(await api.importWebImage(alex, { imageUrl: LISTING.imageUrl }), { status: 'not_connected', reason: NOT_CONNECTED });
  const { job } = await finishedJob(api, alex);
  const searched = await api.searchWebForPhoto(alex, { jobId: job.id });
  assert.equal(searched.web.status, 'not_connected');
  assert.equal(searched.web.reason, NOT_CONNECTED);
  assert.deepEqual(searched.web.shopping, []);
}));

test('the browser provider reads status.json once and answers not_connected without the server', async () => {
  const real = { fetch: globalThis.fetch, document: globalThis.document };
  const seen = [];
  globalThis.document = { baseURI: 'http://127.0.0.1:8130/#/add/link' };
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method ?? 'GET' });
    return new Response(JSON.stringify({ live: false }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { webProvider } = await import('../../js/server/providers/web.browser.js?case=offline');
    assert.deepEqual(await webProvider.status(), { live: false, reason: NOT_CONNECTED });
    assert.deepEqual(await webProvider.lookup({ url: PAGE.url }), { status: 'not_connected', reason: NOT_CONNECTED });
    assert.deepEqual(await webProvider.searchImage({ blob: fakeJpeg() }), { status: 'not_connected', reason: NOT_CONNECTED });
    assert.deepEqual(await webProvider.fetchImage({ url: LISTING.imageUrl }), { status: 'not_connected', reason: NOT_CONNECTED });
    assert.deepEqual(seen, [{ url: 'http://127.0.0.1:8130/api/status.json', method: 'GET' }], 'one status read per page load, nothing else');

    // A missing file (python3 -m http.server without api/) or a dead server reads as not connected too.
    globalThis.fetch = async () => new Response('Not found', { status: 404 });
    const missing = (await import('../../js/server/providers/web.browser.js?case=missing')).webProvider;
    assert.equal((await missing.status()).live, false);
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    const dead = (await import('../../js/server/providers/web.browser.js?case=dead')).webProvider;
    assert.deepEqual(await dead.search({ query: 'af1' }), { status: 'not_connected', reason: NOT_CONNECTED });
  } finally {
    globalThis.fetch = real.fetch;
    globalThis.document = real.document;
  }
});

test('the browser provider posts same-origin JSON with X-Rotation and never throws for expected failures', async () => {
  const real = { fetch: globalThis.fetch, document: globalThis.document };
  const posts = [];
  let next = null;
  globalThis.document = { baseURI: 'http://127.0.0.1:8130/' };
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.endsWith('/api/status.json')) return Response.json({ live: true, version: 1 });
    posts.push({ href, method: init.method, headers: init.headers, body: init.body, signal: init.signal });
    return next(href, init);
  };
  try {
    const { webProvider } = await import('../../js/server/providers/web.browser.js?case=live');
    assert.deepEqual(await webProvider.status(), { live: true, reason: null });

    next = () => Response.json({ status: 'found', page: { name: 'AF1' } });
    const found = await webProvider.lookup({ url: PAGE.url });
    assert.equal(found.status, 'found');
    assert.equal(posts[0].href, 'http://127.0.0.1:8130/api/lookup');
    assert.equal(posts[0].method, 'POST');
    assert.deepEqual(posts[0].headers, { 'content-type': 'application/json', 'x-rotation': '1' });
    assert.deepEqual(JSON.parse(posts[0].body), { url: PAGE.url });
    assert.ok(posts[0].signal, 'every request has a timeout');

    next = () => Response.json({ status: 'forbidden', reason: 'This request came from another site, so it was refused.' }, { status: 403 });
    assert.deepEqual(await webProvider.search({ query: 'af1' }), { status: 'unavailable', reason: 'This request came from another site, so it was refused.' });
    next = () => new Response('<html>oops</html>', { status: 500 });
    assert.equal((await webProvider.lookup({ url: PAGE.url })).status, 'unavailable');
    next = () => {
      throw new TypeError('Failed to fetch');
    };
    assert.deepEqual(await webProvider.lookup({ url: PAGE.url }), { status: 'unavailable', reason: NO_ANSWER });

    // The processing copy is already a JPEG: with no rotation it is sent as it is.
    const photo = fakeJpeg(2048);
    next = () => Response.json({ status: 'no_match', reason: 'Bing found nothing.' });
    assert.deepEqual(await webProvider.searchImage({ blob: photo, rotate: 0 }), { status: 'no_match', reason: 'Bing found nothing.' });
    const lens = posts.at(-1);
    assert.equal(lens.href, 'http://127.0.0.1:8130/api/lens');
    assert.equal(lens.headers['content-type'], 'image/jpeg');
    assert.equal(lens.body, photo);
    // Rotating needs a canvas; without one the photo can't be prepared, which is reported, not thrown.
    const before = posts.length;
    assert.equal((await webProvider.searchImage({ blob: photo, rotate: 90 })).status, 'invalid');
    assert.equal(posts.length, before, 'nothing is sent when the photo could not be prepared');

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    next = () => new Response(png, { status: 200, headers: { 'content-type': 'image/png', 'x-final-url': 'https://cdn.example/af1.png' } });
    const image = await webProvider.fetchImage({ url: 'https://static.nike.com/a.png' });
    assert.equal(image.status, 'ok');
    assert.equal(image.mime, 'image/png');
    assert.equal(image.finalUrl, 'https://cdn.example/af1.png');
    assert.equal(image.blob.size, png.length);
    next = () => Response.json({ status: 'blocked', reason: 'That store refused the image download.' }, { status: 502 });
    assert.deepEqual(await webProvider.fetchImage({ url: 'https://static.nike.com/a.png' }), { status: 'blocked', reason: 'That store refused the image download.' });
    next = () => new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } });
    assert.equal((await webProvider.fetchImage({ url: 'https://static.nike.com/a.svg' })).status, 'unavailable', 'only raster types are taken');
  } finally {
    globalThis.fetch = real.fetch;
    globalThis.document = real.document;
  }
});

// ---------- Operations ----------

test('lookupProductPage returns the cleaned page and a draft, and checks the link before asking', async () => {
  const web = fakeWebProvider({ lookup: { status: 'found', page: PAGE } });
  const { api, db, alex, jordan } = await webEnv({ web });
  const out = await api.lookupProductPage(alex, { url: ` ${PAGE.requestedUrl} ` });
  assert.equal(out.status, 'found');
  assert.deepEqual(web.calls.lookup, [{ url: PAGE.requestedUrl }]);
  assert.equal(out.page.host, 'nike.com');
  assert.deepEqual(out.page.images, ['https://static.nike.com/a/images/af1.png'], 'https images only');
  assert.deepEqual(out.page.via, ['json-ld']);
  assert.equal(out.page.condition, 'new', 'shown as the page said it');
  assert.equal(out.draft.web.via, 'page');
  assert.equal(out.draft.custom.name, "Air Force 1 '07");
  assert.ok(!JSON.stringify(out.draft).includes('"condition"'), 'condition never reaches a draft');

  const unsafe = await api.lookupProductPage(alex, { url: 'http://169.254.169.254/latest/meta-data' });
  assert.deepEqual(unsafe, { status: 'invalid_url', code: 'private_address', reason: unsafe.reason });
  assert.match(unsafe.reason, /private or reserved network address/);
  assert.equal(web.calls.lookup.length, 1, 'an unsafe link never reaches the provider');

  const metrics = await db.where('events', 'type', 'web_lookup');
  assert.deepEqual(metrics.map((m) => m.data), [{ status: 'found' }, { status: 'invalid_url' }]);
  assert.ok(!JSON.stringify(metrics).includes('nike'), 'no URLs or hosts in metrics');
  await rejectsWith(api.lookupProductPage(jordan, { url: PAGE.url }), 'forbidden');
});

test('lookupProductPage passes blocked, not_product and unavailable through with a reason to show', async () => {
  const answers = [
    { status: 'blocked', host: 'nike.com', reason: "nike.com doesn't allow automated lookups. Enter the details yourself, or try another store's link." },
    { status: 'not_product', host: 'nike.com', reason: "That page doesn't look like a product.", page: { ...PAGE, name: 'Air Force 1 Collection' } },
    { status: 'not_product', host: 'nike.com', page: null },
    { status: 'teapot' },
  ];
  const web = fakeWebProvider({ lookup: () => answers.shift() });
  const { api, alex } = await webEnv({ web });
  const blocked = await api.lookupProductPage(alex, { url: PAGE.url });
  assert.deepEqual(blocked, { status: 'blocked', host: 'nike.com', reason: "nike.com doesn't allow automated lookups. Enter the details yourself, or try another store's link." });
  const listing = await api.lookupProductPage(alex, { url: PAGE.url });
  assert.equal(listing.status, 'not_product');
  assert.ok(listing.draft, 'a page with a name still gives a draft to start from');
  const empty = await api.lookupProductPage(alex, { url: PAGE.url });
  assert.equal(empty.status, 'not_product');
  assert.equal(empty.draft, undefined);
  assert.match(empty.reason, /^That page on nike\.com doesn't look like a single product\./);
  const odd = await api.lookupProductPage(alex, { url: PAGE.url });
  assert.equal(odd.status, 'unavailable');
  assert.match(odd.reason, /^[A-Z].*\.$/);

  const throwing = fakeWebProvider({ lookup: () => Promise.reject(new Error('boom')) });
  const env2 = await webEnv({ web: throwing });
  assert.equal((await env2.api.lookupProductPage(env2.alex, { url: PAGE.url })).status, 'unavailable', 'a provider failure is a status, not an error');
});

test('StockX and GOAT pages are never requested: their terms forbid it, so the link is read instead', async () => {
  const web = fakeWebProvider({});
  const { api, alex } = await webEnv({ web });
  for (const [url, name, host] of [
    ['https://stockx.com/nike-dunk-low-retro-white-black-2021', 'StockX', 'stockx.com'],
    ['https://www.goat.com/sneakers/dunk-low-black-white-dd1391-100', 'GOAT', 'goat.com'],
  ]) {
    const out = await api.lookupProductPage(alex, { url });
    assert.deepEqual(out, { status: 'blocked', host, reason: `${name} doesn't allow automated lookups, so Rotation reads the product from the link instead.` });
    const market = await api.importMarketplaceLink(alex, { url });
    assert.equal(market.ok, true, 'the screen falls back to reading the link');
  }
  assert.equal(web.calls.lookup.length, 0, 'the provider is never asked');
  // Nothing was sent, so nothing was charged: a full hour of lookups is still available.
  for (let i = 0; i < RATE_LIMITS.web.limit; i += 1) await api.lookupProductPage(alex, { url: PAGE.url });
  await rejectsWith(api.lookupProductPage(alex, { url: PAGE.url }), 'rate_limited');
});

test('admins see whether the local server is on, read-only, with the simulation unchanged', async () => {
  const offline = await webEnv();
  const morgan = await offline.as(MORGAN);
  const view = await offline.api.adminGetProviders(morgan, {});
  assert.deepEqual(view.simulation, { vision: 'ok', offers: 'ok', ocr: 'ok' });
  const entry = view.providers.find((p) => p.id === 'web');
  assert.deepEqual([entry.status, entry.simulation, entry.options], ['not_connected', null, []]);
  await rejectsWith(offline.api.adminSetProviderSimulation(morgan, { web: 'down' }), 'invalid');
  await rejectsWith(offline.api.webStatus(morgan, {}), 'forbidden');

  const live = await webEnv({ web: fakeWebProvider({}) });
  const overview = await live.api.adminOverview(await live.as(MORGAN), {});
  assert.equal(overview.providers.find((p) => p.id === 'web').status, 'connected');
  assert.deepEqual(await live.api.webStatus(live.alex, {}), { live: true, reason: null });
});

test('web operations share one hourly limit', async () => {
  const web = fakeWebProvider({ lookup: { status: 'found', page: PAGE }, search: SEARCH_OK });
  const { api, alex } = await webEnv({ web, rateLimits: { ...RATE_LIMITS, web: { limit: 2, windowMs: 3600000, label: 'web searches' } } });
  await api.lookupProductPage(alex, { url: PAGE.url });
  await api.searchWebProducts(alex, { query: 'casio f-91w' });
  const limited = await rejectsWith(api.lookupProductPage(alex, { url: PAGE.url }), 'rate_limited');
  assert.match(limited.message, /limit of 2 web searches an hour/);
  assert.ok(limited.details.retryAfterMs > 0);
  assert.deepEqual(RATE_LIMITS.web, { limit: 60, windowMs: 3600000, label: 'web searches' });
  assert.equal(DEFAULT_CONFIG.webSearchTimeoutMs, 45000);
});

test('searchWebProducts drafts every listing, leaves results to be opened, and validates the query', async () => {
  const web = fakeWebProvider({ search: SEARCH_OK });
  const { api, db, alex } = await webEnv({ web });
  const out = await api.searchWebProducts(alex, { query: '  casio\n f-91w ' });
  assert.equal(out.status, 'ok');
  assert.equal(out.engine, 'bing');
  assert.equal(out.query, 'casio f-91w');
  assert.deepEqual(web.calls.search, [{ query: 'casio f-91w' }]);
  assert.deepEqual(out.shopping.map((l) => l.id), ['shop_1', 'shop_3'], 'a listing without a link is dropped');
  assert.equal(out.shopping[1].price, null, 'a price that is not whole minor units is unknown');
  const first = out.shopping[0];
  assert.equal(first.source, 'bing_shopping');
  assert.equal(first.draft.web.via, 'search');
  assert.equal(first.draft.web.query, 'casio f-91w');
  assert.equal(first.draft.web.siteName, 'Walmart');
  assert.equal(first.draft.category, 'watch');
  assert.deepEqual(out.results.map((r) => r.id), ['web_1'], "Bing's own pages and links without a URL are dropped");
  assert.equal(out.results[0].host, 'casio.com');
  assert.equal(out.results[0].draft, undefined, 'results are opened with lookupProductPage');

  for (const query of ['x', '   ', 'q'.repeat(201), 42, undefined]) {
    const bad = await rejectsWith(api.searchWebProducts(alex, { query }), 'invalid');
    assert.ok(bad.details.fields.query);
  }
  assert.equal(web.calls.search.length, 1, 'a bad query never reaches the provider');
  const metrics = await db.where('events', 'type', 'web_search');
  assert.deepEqual(metrics.map((m) => m.data), [{ status: 'ok', kind: 'text', shopping: 2, results: 1 }]);
  assert.ok(!JSON.stringify(metrics).includes('casio'), 'no queries in metrics');

  const blocked = fakeWebProvider({ search: { status: 'blocked' } });
  const env2 = await webEnv({ web: blocked });
  const refused = await env2.api.searchWebProducts(env2.alex, { query: 'casio' });
  assert.equal(refused.status, 'blocked');
  assert.match(refused.reason, /^Bing isn't answering automated searches right now\./);
});

test('importWebImage keeps a store image on this device as a web photo, or says why not', async () => {
  let normalized = 0;
  const web = fakeWebProvider({
    fetchImage: ({ url }) => {
      if (url.includes('blocked')) return { status: 'blocked', reason: 'That store refused the image download.' };
      if (url.includes('gif')) return { status: 'ok', blob: new Blob([new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0])]), mime: 'image/gif', finalUrl: url };
      if (url.includes('pdf')) return { status: 'ok', blob: new Blob([new TextEncoder().encode('%PDF-1.7 not an image')]), mime: 'image/png', finalUrl: url };
      return storeImage({ url });
    },
  });
  const { api, db, alex } = await webEnv({ web, providers: { normalize: (blob) => ((normalized += 1), { original: blob, processing: blob, width: 1000, height: 1000, mime: blob.type }) } });
  const ok = await api.importWebImage(alex, { imageUrl: 'https://static.nike.com/a/af1.png', pageUrl: PAGE.url, idempotencyKey: 'img-a' });
  assert.equal(ok.status, 'ok');
  assert.deepEqual(Object.keys(ok).sort(), ['photoId', 'status']);
  const row = await db.get('photos', ok.photoId);
  assert.equal(row.userId, ALEX);
  assert.equal(row.kind, 'web');
  assert.equal(row.processingId, null, 'a store image needs no processing copy');
  assert.deepEqual(row.source, { imageUrl: 'https://static.nike.com/a/af1.png', pageUrl: PAGE.url, host: 'nike.com' });
  assert.equal(normalized, 1, 'it goes through the same normalize step as an upload');
  const again = await api.importWebImage(alex, { imageUrl: 'https://static.nike.com/a/af1.png', pageUrl: PAGE.url, idempotencyKey: 'img-a' });
  assert.equal(again.photoId, ok.photoId);
  assert.equal(web.calls.fetchImage.length, 1, 'a repeated key downloads nothing again');

  assert.deepEqual(await api.importWebImage(alex, { imageUrl: 'https://static.nike.com/blocked.png' }), { status: 'blocked', reason: 'That store refused the image download.' });
  const gif = await api.importWebImage(alex, { imageUrl: 'https://static.nike.com/a.gif' });
  assert.equal(gif.status, 'unsupported', 'a GIF is kept only when the browser re-encodes it');
  const pdf = await api.importWebImage(alex, { imageUrl: 'https://static.nike.com/a.pdf' });
  assert.equal(pdf.status, 'unsupported');
  assert.match(pdf.reason, /^The store's image isn't a JPEG, PNG, WebP, GIF or AVIF file/);
  const local = await api.importWebImage(alex, { imageUrl: 'http://localhost/a.png' });
  assert.equal(local.status, 'invalid_url');
  assert.equal(web.calls.fetchImage.length, 4, 'an unsafe image link is never sent to the server');
  assert.deepEqual((await db.where('photos', 'userId', ALEX)).filter((p) => p.kind === 'web').map((p) => p.id), [ok.photoId]);

  // Once the browser has re-encoded a GIF it is kept like any other store image.
  const reencoded = await webEnv({ web, providers: { normalize: () => ({ original: fakeJpeg(900), processing: fakeJpeg(300), width: 400, height: 400, mime: 'image/jpeg' }) } });
  const kept = await reencoded.api.importWebImage(reencoded.alex, { imageUrl: 'https://static.nike.com/a.gif' });
  assert.equal(kept.status, 'ok');
  assert.equal((await reencoded.db.get('photos', kept.photoId)).mime, 'image/jpeg');
  // uploadPhoto takes the same kind directly, and needs to know where the image came from.
  await rejectsWith(api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'web' }), 'invalid');
  const direct = await api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'web', source: { imageUrl: 'https://cdn.example/x.jpg' } });
  assert.equal(direct.processingId, null);
  assert.equal((await db.get('photos', direct.photoId)).source.host, 'cdn.example');
});

test('searchWebForPhoto stores Bing results on the job, for its owner only, after matching ends', async () => {
  const web = fakeWebProvider({ searchImage: LENS_OK });
  const { api, db, alex, sam } = await webEnv({ web });
  const { upload, job } = await finishedJob(api, alex, { category: 'watch', rotate: 90 });
  assert.equal(job.web, null, 'nothing is searched until the person asks');
  assert.equal(web.calls.searchImage.length, 0);

  const searched = await api.searchWebForPhoto(alex, { jobId: job.id, idempotencyKey: 'lens-1' });
  const sent = web.calls.searchImage[0];
  assert.equal(sent.rotate, 90, 'the photo goes as the person rotated it');
  assert.equal(sent.blob.size, (await db.get('photos', upload.processingId)).blob.size, 'the processing copy is sent');
  assert.equal(searched.web.status, 'ok');
  assert.equal(searched.web.query, 'Casio F-91W');
  assert.equal(searched.web.engine, 'bing');
  assert.equal(searched.web.searchedAt, new Date(NOW).toISOString());
  assert.equal(searched.web.reason, null);
  const draft = searched.web.shopping[0].draft;
  assert.equal(draft.web.via, 'photo');
  assert.equal(draft.web.query, 'Casio F-91W');
  assert.equal(draft.category, 'watch', "the job's category is the draft's");
  assert.deepEqual(searched.web.results.map((r) => r.id), ['web_1']);
  assert.equal(searched.status, 'done', 'the match itself is untouched');
  assert.deepEqual((await api.getMatchJob(alex, { jobId: job.id })).web, searched.web);
  const replay = await api.searchWebForPhoto(alex, { jobId: job.id, idempotencyKey: 'lens-1' });
  assert.equal(replay.web.searchedAt, searched.web.searchedAt);
  assert.equal(web.calls.searchImage.length, 1, 'the same key does not upload again');

  await rejectsWith(api.searchWebForPhoto(sam, { jobId: job.id }), 'not_found');
  await rejectsWith(api.searchWebForPhoto(alex, { jobId: 'job_missing' }), 'not_found');
  const metrics = await db.where('events', 'type', 'web_search');
  assert.deepEqual(metrics.map((m) => m.data), [{ status: 'ok', kind: 'photo', shopping: 2, results: 1 }]);
  assert.ok(!JSON.stringify(metrics).includes(ALEX) && !JSON.stringify(metrics).includes('Casio'));

  // Results stay through a re-run with new evidence.
  await api.addMatchEvidence(alex, { jobId: job.id, code: 'F-91W' });
  const rerun = await waitForJob(api, alex, job.id);
  assert.equal(rerun.web.query, 'Casio F-91W');
});

test('searchWebForPhoto is refused while matching runs and once the job is saved', async () => {
  const web = fakeWebProvider({ searchImage: LENS_OK });
  const { api, alex } = await webEnv({ web, providers: { visionDelayMs: 150 } });
  const upload = await api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'original' });
  const running = await api.createMatchJob(alex, { photoId: upload.photoId, category: 'watch' });
  const refused = await rejectsWith(api.searchWebForPhoto(alex, { jobId: running.id }), 'conflict');
  assert.match(refused.message, /^Matching is still running/);
  await waitForJob(api, alex, running.id);
  await api.confirmMatch(alex, { jobId: running.id, candidateId: null, variantId: null, custom: { brand: 'Casio', name: 'F-91W' } });
  await rejectsWith(api.searchWebForPhoto(alex, { jobId: running.id }), 'conflict');
  assert.equal(web.calls.searchImage.length, 0);
});

test('a photo search that hangs or fails is stored as unavailable with a reason, and survives a retry', async () => {
  const web = fakeWebProvider({ searchImage: () => new Promise(() => {}) });
  const { api, alex } = await webEnv({ web, config: { webSearchTimeoutMs: 30 } });
  const { job } = await finishedJob(api, alex);
  const slow = await api.searchWebForPhoto(alex, { jobId: job.id });
  assert.equal(slow.web.status, 'unavailable');
  assert.equal(slow.web.reason, 'Searching online stores took too long. Try again in a moment.');

  const odd = fakeWebProvider({ searchImage: { status: 'invalid', reason: 'This photo could not be read.' } });
  const env2 = await webEnv({ web: odd, config: { providerSimulation: { vision: 'error', offers: 'ok', ocr: 'ok' } } });
  const upload = await env2.api.uploadPhoto(env2.alex, { blob: fakeJpeg(), kind: 'original' });
  const created = await env2.api.createMatchJob(env2.alex, { photoId: upload.photoId, category: 'watch' });
  const failed = await waitForJob(env2.api, env2.alex, created.id);
  assert.equal(failed.status, 'error');
  const searched = await env2.api.searchWebForPhoto(env2.alex, { jobId: created.id });
  assert.deepEqual([searched.web.status, searched.web.reason], ['unavailable', 'This photo could not be read.']);
  const retried = await env2.api.retryMatchJob(env2.alex, { jobId: created.id });
  assert.equal(retried.web.status, 'unavailable', 'a retry keeps the online results');
  await waitForJob(env2.api, env2.alex, created.id);
});

// ---------- Saving from the web ----------

test('an item saved from a store page is a custom item that carries the snapshot and the store image', async () => {
  const web = fakeWebProvider({ lookup: { status: 'found', page: PAGE }, fetchImage: storeImage });
  const { api, db, alex } = await webEnv({ web });
  const { draft, image, item } = await saveFromPage(api, alex);
  assert.equal(item.productId, null);
  assert.equal(item.variantId, null);
  assert.equal(item.identity.resolution, 'manual');
  assert.equal(item.identity.variant, 'not_applicable');
  assert.deepEqual(item.identity.evidence, [{ kind: 'product_link', source: 'url', detail: `Details from nike.com on ${formatDate(PAGE.fetchedAt)}; not checked by Rotation.` }]);
  assert.match(item.identity.evidence[0].detail, /^Details from nike\.com on Oct 1[45], 2026; not checked by Rotation\.$/);
  assert.equal(item.sourceUrl, PAGE.url, 'the link defaults to the page');
  assert.deepEqual(item.web, draft.web);
  assert.deepEqual(item.web.price, { amountMinor: 11500, currency: 'USD' });
  assert.equal(item.details.purchase, null, 'a store price is never a price paid');
  assert.equal(item.details.size, null);
  assert.equal(item.details.condition, null);
  assert.equal(item.photos.webId, image.photoId);
  assert.equal(item.display, 'web');
  assert.deepEqual(item.image, { kind: 'web', url: null, photoId: image.photoId, label: 'Image from nike.com', attribution: null, fallbackReason: null, options: ['web'] });
  assert.equal(item.code, 'CW2288-111', 'the style code from the page labels it');
  assert.equal(item.subtitle, 'White/White');
  assert.deepEqual((await db.get('ownedItems', item.id)).web, draft.web, 'stored on the record');
  assert.ok((await api.listOwned(alex, { q: 'cw2288-111' })).items.some((i) => i.id === item.id), 'searchable by the store code');
  assert.equal((await api.getPhotoUrl(alex, { photoId: image.photoId })).url, `blob:test/${image.photoId}`);

  // Without a store image it still saves, showing the placeholder until a photo is added.
  const bare = await api.createOwned(alex, { source: 'web', category: 'sneaker', custom: { ...draft.custom, name: 'Air Force 1 Low' }, web: draft.web });
  assert.equal(bare.display, 'original');
  assert.equal(bare.image.kind, 'placeholder');
  await rejectsWith(api.setDisplayImage(alex, { itemId: bare.id, display: 'web' }), 'invalid');
});

test('saving from the web needs the snapshot and a custom item, never a catalog product', async () => {
  const { api, alex } = await webEnv();
  const web = draftFromWeb({ page: PAGE, via: 'page', now: NOW }).web;
  const custom = { brand: 'Nike', name: "Air Force 1 '07" };
  const missing = await rejectsWith(api.createOwned(alex, { source: 'web', category: 'sneaker', custom }), 'invalid');
  assert.ok(missing.details.fields.web);
  await rejectsWith(api.createOwned(alex, { source: 'web', category: 'sneaker', custom, web: { ...web, url: 'javascript:alert(1)' } }), 'invalid');
  await rejectsWith(api.createOwned(alex, { source: 'web', category: 'sneaker', productId: 'vela-court-low', custom, web }), 'invalid');
  const noName = await rejectsWith(api.createOwned(alex, { source: 'web', category: 'sneaker', custom: { brand: '' }, web }), 'invalid');
  assert.ok(noName.details.fields['custom.brand'] && noName.details.fields['custom.name']);
  await rejectsWith(api.createOwned(alex, { source: 'web', category: 'bag', custom, web }), 'invalid');
  // Someone else's photo, or a photo of the wrong kind, can't be the store image.
  const own = await api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'original' });
  await rejectsWith(api.createOwned(alex, { source: 'web', category: 'sneaker', custom, web, photos: { webId: own.photoId } }), 'not_found');
  const item = await api.createOwned(alex, { source: 'web', category: 'sneaker', custom, web, sourceUrl: 'https://www.nike.com/other', identity: { resolution: 'identifier_supported' } });
  assert.equal(item.sourceUrl, 'https://www.nike.com/other');
  assert.equal(item.identity.resolution, 'manual', 'callers cannot supply an identity');
  const manual = await api.createOwned(alex, { source: 'manual', category: 'clothing', custom: { brand: 'Studio Nine', name: 'Tote' }, web });
  assert.equal(manual.web, null, 'only web saves keep a snapshot');
});

test('a wishlist item saved from a listing keeps the snapshot but not the price as its target', async () => {
  const web = fakeWebProvider({ search: SEARCH_OK, fetchImage: storeImage });
  const { api, alex } = await webEnv({ web });
  const { shopping } = await api.searchWebProducts(alex, { query: 'casio f-91w' });
  const { draft } = shopping[0];
  const image = await api.importWebImage(alex, { imageUrl: draft.imageUrl, pageUrl: draft.web.url });
  const wish = await api.createWishlist(alex, { source: 'web', category: draft.category, custom: draft.custom, web: draft.web, photos: { webId: image.photoId }, reason: 'want_exact', desired: { condition: 'new_only' } });
  assert.equal(wish.identity.resolution, 'manual');
  assert.deepEqual(wish.identity.evidence, [{ kind: 'product_link', source: 'url', detail: `Picked from a Bing Shopping listing (Walmart) on ${formatDate(draft.web.fetchedAt)}; not checked by Rotation.` }]);
  assert.equal(wish.sourceUrl, LISTING.url);
  assert.equal(wish.targetPriceMinor, null, 'the listing price is not the person’s target');
  assert.deepEqual(wish.web.price, { amountMinor: 2899, currency: 'USD' });
  assert.equal(wish.photos.webId, image.photoId);
  assert.equal(wish.image.kind, 'web');
  assert.equal(wish.image.label, 'Image from bing.com');
  assert.deepEqual(wish.web, draft.web);
  // updateWishlist rebuilds the record and keeps both.
  const updated = await api.updateWishlist(alex, { itemId: wish.id, patch: { reasonNote: 'For travel' } });
  assert.equal(updated.photos.webId, image.photoId);
  assert.deepEqual(updated.web, draft.web);
  await rejectsWith(api.createWishlist(alex, { source: 'web', category: 'watch', custom: draft.custom, reason: 'want_exact' }), 'invalid');
  await rejectsWith(api.createWishlist(alex, { source: 'web', category: 'watch', web: draft.web, reason: 'want_exact', allowDuplicate: true }), 'invalid');
});

test('marking a web wish as bought carries the snapshot and the store image to the collection', async () => {
  const web = fakeWebProvider({ lookup: { status: 'found', page: PAGE }, fetchImage: storeImage });
  const { api, db, alex } = await webEnv({ web });
  const { draft } = await api.lookupProductPage(alex, { url: PAGE.url });
  const image = await api.importWebImage(alex, { imageUrl: draft.imageUrl, pageUrl: draft.web.url });
  const wish = await api.createWishlist(alex, { source: 'web', category: draft.category, custom: draft.custom, web: draft.web, photos: { webId: image.photoId }, reason: 'want_exact', desired: { condition: 'new_only' } });
  const { owned } = await api.markPurchased(alex, { itemId: wish.id, details: { size: { value: '10', system: 'US-M' }, condition: 'new' }, idempotencyKey: 'buy-1' });
  assert.deepEqual(owned.web, draft.web);
  assert.equal(owned.photos.webId, image.photoId);
  assert.equal(owned.display, 'web');
  assert.equal(owned.image.kind, 'web');
  assert.equal(owned.identity.resolution, 'manual');
  assert.equal(owned.sourceUrl, PAGE.url);
  assert.deepEqual(owned.details.size, { value: '10', system: 'US-M' }, 'the size is the one the person entered');
  assert.equal(owned.details.purchase, null);
  // The store image now belongs to both records, so deleting one keeps it.
  await api.deleteOwned(alex, { itemId: owned.id });
  assert.ok(await db.get('photos', image.photoId), 'still used by the wishlist item');
});

test('the store image can be switched, replaced and removed like a photo, and goes when the item goes', async () => {
  const web = fakeWebProvider({ lookup: { status: 'found', page: PAGE }, fetchImage: storeImage });
  const { api, db, alex } = await webEnv({ web });
  const { image, item } = await saveFromPage(api, alex);
  const photo = await api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'original' });
  const withPhoto = await api.updateOwned(alex, { itemId: item.id, patch: { photos: { originalId: photo.photoId } } });
  assert.equal(withPhoto.photos.webId, image.photoId, 'adding a photo keeps the store image');
  assert.equal(withPhoto.image.kind, 'web', 'and the display choice');
  assert.deepEqual(withPhoto.image.options, ['original', 'web']);
  const mine = await api.setDisplayImage(alex, { itemId: item.id, display: 'original' });
  assert.equal(mine.image.label, 'Your photo');
  const store = await api.setDisplayImage(alex, { itemId: item.id, display: 'web' });
  assert.equal(store.image.label, 'Image from nike.com');
  await rejectsWith(api.setDisplayImage(alex, { itemId: item.id, display: 'catalog' }), 'invalid');

  const removed = await api.updateOwned(alex, { itemId: item.id, patch: { photos: { webId: null } } });
  assert.equal(removed.photos.webId, null);
  assert.equal(removed.display, 'original', 'without the store image the person’s photo shows');
  assert.equal(await db.get('photos', image.photoId), null, 'the removed store image is deleted');
  const second = await api.importWebImage(alex, { imageUrl: 'https://static.nike.com/b.png' });
  const replaced = await api.updateOwned(alex, { itemId: item.id, patch: { photos: { webId: second.photoId } } });
  assert.equal(replaced.photos.webId, second.photoId);
  await rejectsWith(api.updateOwned(alex, { itemId: item.id, patch: { photos: { webId: photo.photoId } } }), 'not_found');

  await api.deleteOwned(alex, { itemId: item.id });
  assert.equal(await db.get('photos', second.photoId), null);
  assert.equal(await db.get('photos', photo.photoId), null);
});

test('confirmMatch can save an online result: the person’s photo stays, the store image is an option', async () => {
  const web = fakeWebProvider({ searchImage: LENS_OK, fetchImage: storeImage });
  const { api, db, alex, sam } = await webEnv({ web });
  const { upload, job } = await finishedJob(api, alex, { category: 'watch' });
  const searched = await api.searchWebForPhoto(alex, { jobId: job.id });
  const { draft } = searched.web.shopping[0];
  const image = await api.importWebImage(alex, { imageUrl: draft.imageUrl, pageUrl: draft.web.url });
  const samImage = await api.importWebImage(sam, { imageUrl: draft.imageUrl });
  const args = { jobId: job.id, candidateId: null, variantId: null, custom: draft.custom, category: draft.category, web: draft.web };
  await rejectsWith(api.confirmMatch(alex, { ...args, webPhotoId: samImage.photoId }), 'not_found');
  await rejectsWith(api.confirmMatch(alex, { ...args, webPhotoId: upload.photoId }), 'not_found');
  await rejectsWith(api.confirmMatch(alex, { ...args, web: { url: 'ftp://x' } }), 'invalid');

  const { item, job: saved } = await api.confirmMatch(alex, { ...args, webPhotoId: image.photoId, idempotencyKey: 'c1' });
  assert.equal(saved.status, 'confirmed');
  assert.equal(saved.confirmedItemId, item.id);
  assert.equal(item.photos.originalId, upload.photoId);
  assert.equal(item.photos.webId, image.photoId);
  assert.equal(item.display, 'original');
  assert.equal(item.image.kind, 'original');
  assert.deepEqual(item.image.options, ['original', 'web']);
  assert.deepEqual(item.web, draft.web);
  assert.equal(item.web.via, 'photo');
  assert.equal(item.sourceUrl, draft.web.url);
  assert.equal(item.identity.resolution, 'manual');
  assert.equal(item.identity.matchJobId, job.id);
  assert.deepEqual(item.identity.evidence.map((e) => e.kind), ['product_link', 'user_selection']);
  assert.equal(item.identity.evidence[0].detail, `Found with Bing visual search from your photo on ${formatDate(draft.web.fetchedAt)}; you chose it.`);
  assert.equal((await db.get('ownedItems', item.id)).sourceUrl, draft.web.url);
  const event = (await db.where('events', 'type', 'match_confirmed')).at(-1);
  assert.equal(event.data.pick, 'web');

  // The wishlist path does the same.
  const wishJob = await finishedJob(api, alex, { dest: 'wishlist', category: 'watch' });
  const wishSearch = await api.searchWebForPhoto(alex, { jobId: wishJob.job.id });
  const pick = wishSearch.web.shopping[1].draft;
  const { item: wish } = await api.confirmMatch(alex, { jobId: wishJob.job.id, candidateId: null, variantId: null, custom: { ...pick.custom, name: 'F-91W' }, web: pick.web, webPhotoId: image.photoId, wish: { reason: 'want_exact' } });
  assert.equal(wish.photos.originalId, wishJob.upload.photoId);
  assert.equal(wish.photos.webId, image.photoId);
  assert.equal(wish.sourceUrl, pick.web.url);
  assert.equal(wish.image.kind, 'original');
  assert.deepEqual(wish.web, pick.web);
});

test('store images follow the photo rules for stylists, export and deletion', async () => {
  const web = fakeWebProvider({ lookup: { status: 'found', page: PAGE }, fetchImage: storeImage });
  const { api, db, alex, jordan } = await webEnv({ web });
  const { image, item } = await saveFromPage(api, alex);

  const hidden = await api.createStylistRequest(alex, { stylistId: JORDAN, itemIds: [item.id], message: 'Does this go with my jacket?' });
  const seen = await api.getStylistRequest(jordan, { requestId: hidden.id });
  assert.equal(seen.items[0].image.kind, 'placeholder', 'without shared photos the store image stays private too');
  assert.ok(!JSON.stringify(seen).includes(image.photoId));
  assert.equal(seen.items[0].web, undefined, 'the snapshot is not on the allowlist');
  await rejectsWith(api.getPhotoUrl(jordan, { photoId: image.photoId }), 'not_found');

  const shared = await api.createStylistRequest(alex, { stylistId: JORDAN, itemIds: [item.id], includePhotos: true, message: 'Photos too' });
  const withPhotos = await api.getStylistRequest(jordan, { requestId: shared.id });
  assert.equal(withPhotos.items[0].image.kind, 'web');
  assert.equal(withPhotos.items[0].image.photoId, image.photoId);
  assert.ok((await api.getPhotoUrl(jordan, { photoId: image.photoId })).url);
  assert.ok((await db.where('audit', 'targetId', shared.id)).some((a) => a.action === 'stylist_request.photo_viewed'));

  const data = await api.exportMyData(alex, {});
  const row = data.photos.find((p) => p.id === image.photoId);
  assert.equal(row.kind, 'web');
  assert.equal(row.source.host, 'nike.com');
  assert.match(row.dataUrl, /^data:image\/jpeg;base64,/);
  assert.deepEqual(data.owned.find((o) => o.id === item.id).web, item.web);

  const signed = await api.signUp({}, { email: 'casey@example.com', password: 'correct horse', displayName: 'Casey' });
  const casey = { token: signed.token };
  const caseyItem = await saveFromPage(api, casey, { key: 'casey' });
  await api.deleteMyAccount(casey, { confirm: 'DELETE' });
  assert.equal(await db.get('photos', caseyItem.image.photoId), null, 'account deletion removes store images');
  assert.equal(await db.get('ownedItems', caseyItem.item.id), null);
});

test('recommendation chips show a store image by photo id', async () => {
  const web = fakeWebProvider({ lookup: { status: 'found', page: { ...PAGE, name: 'Casio F91W Digital Watch', brand: 'Casio', color: 'Black', mpn: 'F91W-1', url: 'https://www.casio.com/us/f91w' } }, fetchImage: storeImage });
  const { api, alex } = await webEnv({ web });
  const { image, item } = await saveFromPage(api, alex);
  assert.equal(item.custom.type, 'digital');
  const parsed = await api.parseRequest(alex, { text: 'a strap to go with my casio watch' });
  const seed = parsed.seeds.find((s) => s.itemId === item.id);
  assert.ok(seed, 'the casio is read as the seed');
  assert.equal(seed.photoId, image.photoId);
  assert.equal(seed.imageUrl, null);
});

// ---------- Review fixes ----------

const draftOf = (title, { host = 'shop.example', brand = null, via = 'search' } = {}) => {
  const url = `https://${host}/p/1`;
  return via === 'page'
    ? draftFromWeb({ page: { url, name: title, brand, images: [] }, via, now: NOW })
    : draftFromWeb({ listing: { title, url }, via, now: NOW });
};

test('New Balance and other brands that start with "New" keep their whole name', () => {
  assert.equal(guessBrand({ title: 'New Balance 574 Core' }), 'New Balance');
  assert.equal(guessBrand({ title: "New Balance Men's Performance Crew Socks" }), 'New Balance');
  assert.equal(guessBrand({ title: 'New Era 59FIFTY Cap' }), 'New Era');
  assert.equal(guessBrand({ title: 'NEW Casio F-91W' }), 'Casio', '"NEW" alone is still listing noise');
  for (const via of ['search', 'photo']) {
    const draft = draftOf('New Balance 550 White Green', { via });
    assert.equal(draft.custom.brand, 'New Balance', via);
    assert.equal(draft.custom.name, '550 White Green', via);
    assert.equal(draft.custom.type, 'court', 'the 550 is a court shoe');
  }
  const page = draftOf("New Balance 990v6 Made in USA Men's Sneakers", { via: 'page', brand: 'New Balance', host: 'newbalance.com' });
  assert.deepEqual([page.custom.brand, page.custom.name, page.category, page.custom.type], ['New Balance', '990v6 Made in USA', 'sneaker', 'runner']);
  assert.equal(draftOf('New Balance 480 Low White Navy').custom.type, 'court');
});

test('a watch "with a bracelet" is a watch, and a bracelet alone is not kept', () => {
  assert.equal(guessCategory("Seiko Prospex SPB143 Diver's Watch with Stainless Steel Bracelet"), 'watch');
  assert.equal(guessCategory('Tissot PRX Powermatic 80 Stainless Steel Watch with Integrated Bracelet'), 'watch');
  assert.equal(guessCategory("Bulova Men's Classic Sutton Automatic Watch, Stainless Steel Bracelet"), 'watch');
  assert.equal(draftOf("Seiko Prospex SPB143 Diver's Watch with Stainless Steel Bracelet").custom.type, 'diver');
  assert.equal(guessCategory('Silver Bracelet'), null);
  assert.equal(guessCategory('Citizen Promaster Diver Watch with Black Rubber Strap'), 'watch');
});

test('clocks, instruments and accessories are not drafted into a category', () => {
  for (const title of ['Timex Indiglo Travel Alarm Clock', 'Seiko Wall Clock QXA521', 'Casio Privia PX-S1100 Digital Piano',
    'Watch Box for Men, 12 Slot Watch Case Organizer', 'Watch Winder for Automatic Watches', 'Shoe Rack Organizer 4 Tier',
    'Crep Protect Shoe Protector Spray 200ml', 'Sneaker Shields Toe Box Crease Protector', 'T-Shirt Folding Board',
    'Jeans Button Replacement Kit', 'Hoodie Drawstring Replacement', 'Casio G-Shock Watch Bumper Protector']) {
    const draft = draftOf(title);
    assert.deepEqual([draft.category, draft.custom.type], [null, null], title);
  }
  assert.equal(guessCategory('Samsung Galaxy Watch6 Classic 47mm'), 'watch', '"Watch6" is a watch');
});

test('type and color guesses ignore colorway, model and brand words', () => {
  assert.equal(guessType('sneaker', 'Converse Run Star Hike Platform'), null, 'a bare "run" is no running shoe');
  assert.equal(guessType('sneaker', 'New Balance 990v6'), 'runner');
  assert.equal(guessType('clothing', 'Champion Reverse Weave Hoodie, Oxford Gray'), 'hoodie');
  assert.equal(guessType('clothing', 'Uniqlo Oxford Slim-Fit Shirt'), 'oxford-shirt');
  assert.deepEqual(draftOf('Hamilton Khaki Field Mechanical 38mm').custom.colors, []);
  assert.deepEqual(draftOf('Tudor Black Bay 58').custom.colors, []);
  const navy = draftOf("Old Navy Men's Crew-Neck T-Shirt", { host: 'oldnavy.gap.com' });
  assert.deepEqual([navy.custom.brand, navy.custom.colors], ['Old Navy', []]);
  assert.equal(guessBrand({ title: 'Crew-Neck T-Shirt', host: 'oldnavy.gap.com' }), 'Old Navy', "a brand's own part of a group store");
  assert.equal(guessBrand({ title: 'Crew-Neck T-Shirt', host: 'gap.com' }), 'Gap');
});

test('a size in a listing title is dropped from the drafted name, and model numbers stay', () => {
  const cases = [
    ["Nike Air Force 1 '07 White/White CW2288-111 Men's 10.5", "Air Force 1 '07 White/White CW2288-111"],
    ['Nike Dunk Low Retro Panda DD1391-100 Mens US 9', 'Dunk Low Retro Panda DD1391-100'],
    ['Vans Old Skool Black White Skate Shoe 10 M US', 'Old Skool Black White Skate Shoe'],
    ["Levi's 501 Original Fit Jeans 32x30 Dark Stonewash", '501 Original Fit Jeans Dark Stonewash'],
    ["Levi's 505 Regular Fit Jeans Size 32x34", '505 Regular Fit Jeans'],
    ['Champion Reverse Weave Hoodie XL Oxford Gray', 'Reverse Weave Hoodie Oxford Gray'],
    ['Uniqlo Heattech Crew Neck T-Shirt (L) Black', 'Heattech Crew Neck T-Shirt Black'],
    ['Converse Chuck Taylor All Star Low Top Unisex Sneaker Men / 11 Women', 'Chuck Taylor All Star Low Top'],
    ["Nike Air Force 1 '07 Men's Shoes, White/White, 10", "Air Force 1 '07 Men's Shoes, White/White"],
    ['NEW Nike Dunk Low Panda Size 10', 'Dunk Low Panda'],
    ['Kith Hoodie Size 10.5 M US', 'Hoodie'],
    ['Nike Air Max 90', 'Air Max 90'],
    ['Converse Chuck 70 Hi', 'Chuck 70 Hi'],
    ['Seiko 5 Sports SRPD55', '5 Sports SRPD55'],
    ['Casio A168WA-1 Steel 36x33mm', 'A168WA-1 Steel 36x33mm'],
  ];
  for (const [title, name] of cases) assert.equal(draftOf(title).custom.name, name, title);
});

test('page text loses C1, bidi and zero-width controls; fetchedAt must be an ISO time; query only for searches', () => {
  const clean = cleanWebSnapshot({ url: 'https://shop.example/p', title: 'A\u0085B\u009BC‮D⁦E‎F؜G', siteName: 'Safe‮gnp.exe' }, NOW);
  assert.equal(clean.title, 'A B C D E F G');
  assert.ok(![...clean.siteName].some((c) => /[‪-‮⁦-⁩]/.test(c)));
  const at = (fetchedAt) => cleanWebSnapshot({ url: 'https://shop.example/p', fetchedAt }, NOW).fetchedAt;
  const now = new Date(NOW).toISOString();
  for (const bad of ['0', 'Oct 14 2026', '2026-10-14', '2026-10-14 11:00:00', 1760000000000, '2026-10-14T11:00:00']) assert.equal(at(bad), now, String(bad));
  assert.equal(at('2026-10-14T11:00:00Z'), '2026-10-14T11:00:00.000Z');
  assert.equal(at('2026-10-14T07:00:00.250-04:00'), '2026-10-14T11:00:00.250Z');
  for (const via of ['page', null, 'scrape']) assert.equal(cleanWebSnapshot({ url: 'https://shop.example/p', via, query: 'casio' }, NOW).query, null, String(via));
  for (const via of ['search', 'photo']) assert.equal(cleanWebSnapshot({ url: 'https://shop.example/p', via, query: 'casio' }, NOW).query, 'casio');
});

test('a lookup reports an unreadable page time as now', async () => {
  const web = fakeWebProvider({ lookup: { status: 'found', page: { ...PAGE, fetchedAt: 'Oct 14 2026' } } });
  const { api, alex } = await webEnv({ web });
  const out = await api.lookupProductPage(alex, { url: PAGE.url });
  assert.equal(out.page.fetchedAt, new Date(NOW).toISOString());
  assert.equal(out.draft.web.fetchedAt, new Date(NOW).toISOString());
});

test('requests refused before any provider call cost nothing from the web limit', async () => {
  const web = fakeWebProvider({ lookup: { status: 'found', page: PAGE }, search: SEARCH_OK, searchImage: LENS_OK });
  const { api, alex } = await webEnv({ web, rateLimits: { ...RATE_LIMITS, web: { limit: 2, windowMs: 3600000, label: 'web searches' } } });
  await rejectsWith(api.searchWebProducts(alex, { query: 'x' }), 'invalid');
  assert.equal((await api.lookupProductPage(alex, { url: 'http://localhost/p' })).status, 'invalid_url');
  await rejectsWith(api.searchWebForPhoto(alex, { jobId: 'job_missing' }), 'not_found');
  for (let i = 0; i < 3; i += 1) await api.importWebImage(alex, { imageUrl: 'javascript:alert(1)' });
  await api.searchWebProducts(alex, { query: 'casio f-91w' });
  await api.lookupProductPage(alex, { url: PAGE.url });
  await rejectsWith(api.searchWebProducts(alex, { query: 'casio f-91w' }), 'rate_limited');
  assert.equal(api.describe('searchWebProducts').rateLimit, 'web');
  assert.equal(api.describe('searchWebForPhoto').rateLimit, 'web');
});

test('importWebImage has its own limit and reports it as a result, so a save goes on', async () => {
  const web = fakeWebProvider({ lookup: { status: 'found', page: PAGE }, fetchImage: storeImage });
  const limits = { ...RATE_LIMITS, web: { limit: 1, windowMs: 3600000, label: 'web searches' }, webImage: { limit: 1, windowMs: 3600000, label: 'store images' } };
  const { api, alex } = await webEnv({ web, rateLimits: limits });
  const { draft } = await api.lookupProductPage(alex, { url: PAGE.url });
  const first = await api.importWebImage(alex, { imageUrl: draft.imageUrl, idempotencyKey: 'i1' });
  assert.equal(first.status, 'ok', 'searches used up do not stop a store image');
  const second = await api.importWebImage(alex, { imageUrl: draft.imageUrl, idempotencyKey: 'i2' });
  assert.equal(second.status, 'unavailable');
  assert.match(second.reason, /limit of 1 store images an hour/);
  assert.match(second.reason, /Save the item without the store's image\.$/);
  assert.equal(web.calls.fetchImage.length, 1, 'nothing is downloaded over the limit');
  assert.equal((await api.importWebImage(alex, { imageUrl: draft.imageUrl, idempotencyKey: 'i1' })).photoId, first.photoId, 'a replay costs nothing');
  const item = await api.createOwned(alex, { source: 'web', category: draft.category, custom: draft.custom, web: draft.web, photos: { webId: null } });
  assert.equal(item.web.url, draft.web.url, 'the save itself still works');
  assert.deepEqual(RATE_LIMITS.webImage, { limit: 240, windowMs: 3600000, label: 'store images' });
  assert.equal(api.describe('importWebImage').rateLimit, 'webImage');
});

test('a failure a retry could fix is not replayed under the same idempotency key', async () => {
  let up = false;
  const web = fakeWebProvider({
    fetchImage: (args) => (up ? storeImage(args) : { status: 'unavailable', reason: 'The store did not answer.' }),
    searchImage: () => (up ? LENS_OK : new Promise(() => {})),
  });
  const { api, alex } = await webEnv({ web, config: { webSearchTimeoutMs: 30 } });
  const imageUrl = 'https://static.nike.com/a/af1.png';
  assert.equal((await api.importWebImage(alex, { imageUrl, idempotencyKey: 'k' })).status, 'unavailable');
  const { job } = await finishedJob(api, alex);
  assert.equal((await api.searchWebForPhoto(alex, { jobId: job.id, idempotencyKey: 'k' })).web.status, 'unavailable');
  up = true;
  const image = await api.importWebImage(alex, { imageUrl, idempotencyKey: 'k' });
  assert.equal(image.status, 'ok');
  assert.equal(web.calls.fetchImage.length, 2, 'the retry asked again');
  const searched = await api.searchWebForPhoto(alex, { jobId: job.id, idempotencyKey: 'k' });
  assert.equal(searched.web.status, 'ok');
  assert.equal(web.calls.searchImage.length, 2);
  // Once it worked, the key replays it.
  assert.equal((await api.importWebImage(alex, { imageUrl, idempotencyKey: 'k' })).photoId, image.photoId);
  assert.equal((await api.searchWebForPhoto(alex, { jobId: job.id, idempotencyKey: 'k' })).web.searchedAt, searched.web.searchedAt);
  assert.deepEqual([web.calls.fetchImage.length, web.calls.searchImage.length], [2, 2]);
});

test('a store image is never matched, read as a label or kept as the person’s photo', async () => {
  const web = fakeWebProvider({ fetchImage: storeImage });
  const { api, db, alex } = await webEnv({ web });
  const store = await api.importWebImage(alex, { imageUrl: 'https://static.nike.com/a/af1.png' });
  await rejectsWith(api.createMatchJob(alex, { photoId: store.photoId, category: 'watch' }), 'not_found');
  const upload = await api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'original' });
  await rejectsWith(api.createMatchJob(alex, { photoId: upload.photoId, processingId: store.photoId, category: 'watch' }), 'not_found');
  const { job } = await finishedJob(api, alex);
  await rejectsWith(api.addMatchEvidence(alex, { jobId: job.id, labelPhotoId: store.photoId }), 'not_found');

  // A job from before the check that points at a store image saves without it as "Your photo".
  await db.put('matchJobs', { ...(await db.get('matchJobs', job.id)), photoId: store.photoId, processingId: null });
  await rejectsWith(api.searchWebForPhoto(alex, { jobId: job.id }), 'not_found');
  const { item } = await api.confirmMatch(alex, { jobId: job.id, candidateId: null, variantId: null, custom: { brand: 'Casio', name: 'F-91W' } });
  assert.equal(item.photos.originalId, null);
  assert.notEqual(item.image.label, 'Your photo');
});

test('marking a photo-flow wish as bought keeps the person’s photo and the store image', async () => {
  const web = fakeWebProvider({ searchImage: LENS_OK, fetchImage: storeImage });
  const { api, db, alex } = await webEnv({ web });
  const { upload, job } = await finishedJob(api, alex, { dest: 'wishlist', category: 'watch' });
  const { draft } = (await api.searchWebForPhoto(alex, { jobId: job.id })).web.shopping[0];
  const image = await api.importWebImage(alex, { imageUrl: draft.imageUrl, pageUrl: draft.web.url });
  const { item: wish } = await api.confirmMatch(alex, { jobId: job.id, candidateId: null, variantId: null, custom: draft.custom, web: draft.web, webPhotoId: image.photoId, wish: { reason: 'want_exact' } });
  const { owned } = await api.markPurchased(alex, { itemId: wish.id, details: {} });
  assert.equal(owned.photos.originalId, upload.photoId);
  assert.equal(owned.photos.webId, image.photoId);
  assert.equal(owned.display, 'original');
  assert.equal(owned.image.kind, 'original');
  assert.deepEqual(owned.image.options, ['original', 'web']);
  await api.deleteOwned(alex, { itemId: owned.id });
  assert.ok(await db.get('photos', upload.photoId), 'the wish still uses the photo');
});

test('searchWebForPhoto and addMatchEvidence at the same time lose neither write', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const web = fakeWebProvider({ searchImage: () => gate.then(() => LENS_OK) });
  const { api, alex } = await webEnv({ web });
  const { job } = await finishedJob(api, alex);
  const searching = api.searchWebForPhoto(alex, { jobId: job.id });
  while (web.calls.searchImage.length === 0) await new Promise((r) => setTimeout(r, 2));
  await api.addMatchEvidence(alex, { jobId: job.id, code: 'F-91W' });
  release();
  await searching;
  const done = await waitForJob(api, alex, job.id);
  assert.deepEqual(done.texts.map((t) => t.text), ['F-91W']);
  assert.equal(done.web.query, 'Casio F-91W');
});

test('the photo search sends the part of the photo the person framed, turned as they turned it', async () => {
  const web = fakeWebProvider({ searchImage: LENS_OK });
  const { api, alex } = await webEnv({ web });
  const upload = await api.uploadPhoto(alex, { blob: fakeJpeg(3000), kind: 'original' });
  const crop = { x: 0.25, y: 0.5, w: 0.5, h: 0.5, rotate: 90 };
  const created = await api.createMatchJob(alex, { photoId: upload.photoId, processingId: upload.processingId, category: 'watch', crop });
  await waitForJob(api, alex, created.id);
  await api.searchWebForPhoto(alex, { jobId: created.id });
  assert.deepEqual(web.calls.searchImage[0].crop, crop);
  assert.equal(web.calls.searchImage[0].rotate, 90);

  const real = { fetch: globalThis.fetch, document: globalThis.document, OffscreenCanvas: globalThis.OffscreenCanvas, createImageBitmap: globalThis.createImageBitmap };
  const canvases = [];
  const posts = [];
  globalThis.document = { baseURI: 'http://127.0.0.1:8130/' };
  globalThis.createImageBitmap = async () => ({ width: 1024, height: 768, close() {} });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      Object.assign(this, { width, height, ops: [] });
      canvases.push(this);
    }
    getContext() {
      const ops = this.ops;
      return { fillRect() {}, translate() {}, rotate: (r) => ops.push(['rotate', Math.round((r * 180) / Math.PI)]), drawImage: (_s, ...a) => ops.push(['drawImage', ...a]), set fillStyle(v) {} };
    }
    async convertToBlob({ type }) {
      return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], { type });
    }
  };
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/api/status.json')) return Response.json({ live: true });
    posts.push(init);
    return Response.json({ status: 'no_match' });
  };
  try {
    const { webProvider, searchFrame } = await import('../../js/server/providers/web.browser.js?case=crop');
    const photo = fakeJpeg(2048);
    assert.equal((await webProvider.searchImage({ blob: photo, crop })).status, 'no_match');
    const cut = canvases.at(-1);
    assert.deepEqual([cut.width, cut.height], [384, 512], 'a 512x384 crop, turned a quarter');
    assert.deepEqual(cut.ops.find((o) => o[0] === 'drawImage').slice(1, 5), [256, 384, 512, 384], 'only the framed part is drawn');
    assert.deepEqual(cut.ops.find((o) => o[0] === 'rotate'), ['rotate', 90]);
    assert.equal(posts.at(-1).headers['content-type'], 'image/jpeg');
    for (const rotate of [90, 270]) {
      await webProvider.searchImage({ blob: photo, rotate });
      assert.deepEqual([canvases.at(-1).width, canvases.at(-1).height], [576, 768], `rotate ${rotate}`);
    }
    const sent = posts.length;
    await webProvider.searchImage({ blob: photo, crop: { x: 0, y: 0, w: 1, h: 1, rotate: 0 } });
    assert.equal(posts.at(-1).body, photo, 'a whole, upright JPEG goes as it is');
    assert.equal(posts.length, sent + 1);
    assert.deepEqual(searchFrame({ x: 0.9, y: 0, w: 0.5, h: 1, rotate: -90 }), { x: 0.9, y: 0, w: 0.09999999999999998, h: 1, rotate: 270 });
    assert.deepEqual(searchFrame({ x: 0.5, y: 0.5, w: 0, h: 0 }, 180), { x: 0, y: 0, w: 1, h: 1, rotate: 180 }, 'a sliver sends the whole frame');
    assert.deepEqual(searchFrame(null, '90'), { x: 0, y: 0, w: 1, h: 1, rotate: 90 });
  } finally {
    Object.assign(globalThis, real);
    for (const key of ['OffscreenCanvas', 'createImageBitmap', 'document']) if (real[key] === undefined) delete globalThis[key];
  }
});
