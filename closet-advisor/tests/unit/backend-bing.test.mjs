// Bing parsers and the photo-search flow (backend/bing.mjs) on synthetic pages, over the fixture
// transport. Nothing here touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBing, parseBingSerp, parseBingShop, unwrapBing, rankForShopping, webResults, shopListings, shopPrice } from '../../backend/bing.mjs';
import { createUpstream } from '../../backend/net.mjs';
import { fixtureUpstream, fixtureTransport, fixtureImage, FIXTURE } from '../fixtures/web/upstream.mjs';
import { jpegSize } from '../fixtures/web/jpeg.mjs';

const wrap = (target) => `https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;ptn=3&amp;u=a1${Buffer.from(target).toString('base64url')}&amp;ntb=1`;
const algo = (target, title, snippet, { caption = false } = {}) =>
  `<li class="b_algo" data-id><h2><a href="${wrap(target)}">${title}</a></h2><div class="b_caption">${caption ? snippet : `<p class="b_lineclamp2"><span class="algoSlug_icon" data-priority="2">WEB</span>${snippet}</p>`}</div></li>`;

function fakeClock(start = Date.parse('2026-10-15T12:00:00Z')) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms), sleep: async (ms) => (t += ms) };
}

test('unwrapBing decodes /ck/a links without following them and drops tracking parameters', () => {
  assert.equal(unwrapBing(wrap('https://www.amazon.com/dp/B000GAWSDG?msockid=abc&utm_source=bing&th=1')), 'https://www.amazon.com/dp/B000GAWSDG?th=1');
  assert.equal(unwrapBing(wrap('/images/search?q=watch')), 'https://www.bing.com/images/search?q=watch');
  assert.equal(unwrapBing('https://www.casio.com/us/watches/'), 'https://www.casio.com/us/watches/');
});

test('parseBingSerp reads organic results only, with clean titles and snippets', () => {
  const html = `<ol id="b_results"><li class="b_ad"><h2><a href="https://www.bing.com/aclick?ld=1">Sponsored pick</a></h2></li>
    ${algo('https://www.casio.com/us/watches/casio/product.F-91W-1/', 'F91W-1 | <strong>Casio</strong> Classic Digital Watch', 'Timeless style &amp; reliable performance.')}
    ${algo('https://en.wikipedia.org/wiki/Casio_F-91W', 'Casio F-91W - Wikipedia', 'The F-91W is a digital watch.', { caption: true })}
    <li class="b_ans"><h2>People also ask</h2></li></ol>`;
  const raw = parseBingSerp(html);
  assert.deepEqual(raw, [
    { title: 'F91W-1 | Casio Classic Digital Watch', url: 'https://www.casio.com/us/watches/casio/product.F-91W-1/', snippet: 'Timeless style & reliable performance.', site: 'casio.com' },
    { title: 'Casio F-91W - Wikipedia', url: 'https://en.wikipedia.org/wiki/Casio_F-91W', snippet: 'The F-91W is a digital watch.', site: 'en.wikipedia.org' },
  ]);
  assert.deepEqual(parseBingSerp('<html><body>No results</body></html>'), []);
});

test('webResults: product pages and known stores first, no Bing or MSN pages, no local links, at most 10', () => {
  const raw = [
    { title: 'Casio F-91W - Wikipedia', url: 'https://en.wikipedia.org/wiki/Casio_F-91W', snippet: 'Encyclopedia', site: 'en.wikipedia.org' },
    { title: 'Images of Casio F-91W', url: 'https://www.bing.com/images/search?q=casio', snippet: '', site: 'bing.com' },
    { title: 'Casio on MSN', url: 'https://www.msn.com/en-us/news/casio', snippet: '', site: 'msn.com' },
    { title: 'Amazon search', url: 'https://www.amazon.com/s?k=casio+f91w', snippet: 'Results', site: 'amazon.com' },
    { title: 'Casio F91W on Amazon', url: 'https://www.amazon.com/Casio-F91W-1/dp/B000GAWSDG', snippet: 'Buy it', site: 'amazon.com' },
    { title: 'Router page', url: 'http://192.168.1.1/', snippet: '', site: '192.168.1.1' },
    { title: 'Casio F91W on Amazon', url: 'https://www.amazon.com/Casio-F91W-1/dp/B000GAWSDG', snippet: 'Duplicate', site: 'amazon.com' },
    { title: 'A watch blog', url: 'https://watchblog.example/products/f91w-review', snippet: 'Review', site: 'watchblog.example' },
    ...Array.from({ length: 10 }, (_, i) => ({ title: `Forum ${i}`, url: `https://forum${i}.example/thread`, snippet: '', site: `forum${i}.example` })),
  ];
  const results = webResults(raw);
  assert.equal(results.length, 10);
  assert.deepEqual(
    results.slice(0, 4).map((r) => [r.id, r.host, r.productPage]),
    [
      ['web_1', 'amazon.com', true],
      ['web_2', 'amazon.com', false],
      ['web_3', 'watchblog.example', true],
      ['web_4', 'en.wikipedia.org', false],
    ],
  );
  assert.ok(!results.some((r) => /bing\.com|msn\.com|192\.168/.test(r.url)));
  assert.equal(new Set(results.map((r) => r.url)).size, results.length);
  assert.deepEqual(Object.keys(results[0]), ['id', 'title', 'url', 'host', 'snippet', 'productPage']);
  // Ties keep Bing's order.
  assert.deepEqual(
    rankForShopping([{ site: 'a.example', url: 'https://a.example/' }, { site: 'b.example', url: 'https://b.example/' }]).map((r) => r.site),
    ['a.example', 'b.example'],
  );
});

test('parseBingShop reads free listings only; ads and sponsored offers are never read', () => {
  const item = (goid, title, price, seller, free = true) =>
    `<li class="br-item" data-url="/shop/entitydetails?q=x&amp;filters=gGlobalOfferIds%3a%22${goid}%22+NonSponsoredOffer%3a%22${free}%22"><div class="cico br-pdMainImg"><img src="https://th.bing.com/th?id=OPHS.${goid}&amp;w=220" alt=""></div><a class="br-titlelink" href="/shop/productdetails?q=x&amp;goid=${goid}&amp;FORM=SHPPDP"><div class="br-title"><span title="${title}">${title.slice(0, 20)}…</span></div></a><div class="br-price"><div class="pd-price br-standardPrice"><div class="resp-one-line">${price}</div></div></div><div class="resp-one-line br-seller">${seller}</div></li>`;
  const html = `<div class="br-gOffCard"><a rel="sponsored" href="https://www.bing.com/aclick?ld=1">Ad shoe $10.00</a></div>
    <ul>${item('101', 'Levi&#39;s 501 Original Fit Jeans', '$77.00', 'Department Fixture')}${item('102', 'Promoted 501', '$5.00', 'Ad Seller', false)}${item('103', 'Jeans 501 EU', '€19,90', 'Fixture EU')}</ul>
    <li class="br-item" data-url="/shop/entitydetails?filters=NonSponsoredOffer%3a%22true%22"><div class="br-title"><span title="No product page">x</span></div></li>`;
  const raw = parseBingShop(html);
  assert.equal(raw.length, 3, 'the sponsored listing is skipped');
  const listings = shopListings(raw);
  assert.deepEqual(listings[0], {
    id: 'shop_1',
    title: "Levi's 501 Original Fit Jeans",
    price: { amountMinor: 7700, currency: 'USD' },
    priceText: '$77.00',
    seller: 'Department Fixture',
    imageUrl: 'https://th.bing.com/th?id=OPHS.101&w=220',
    url: 'https://www.bing.com/shop/productdetails?q=x&goid=101&FORM=SHPPDP',
    source: 'bing_shopping',
  });
  assert.deepEqual(listings[1].price, { amountMinor: 1990, currency: 'EUR' });
  assert.equal(listings.length, 2, 'a listing without a Bing product page is dropped');
  assert.ok(!listings.some((l) => /Promoted|Ad shoe/.test(l.title)));

  const many = shopListings(Array.from({ length: 30 }, (_, i) => ({ title: `Item ${i}`, priceText: null, seller: null, image: null, url: `https://www.bing.com/shop/productdetails?goid=${i}` })));
  assert.equal(many.length, 24);
  assert.equal(many[0].price, null);
  assert.deepEqual(shopPrice('$1,299.99'), { amountMinor: 129999, currency: 'USD' });
  assert.deepEqual(shopPrice('£45'), { amountMinor: 4500, currency: 'GBP' });
  assert.equal(shopPrice('Free'), null);
});

test('photo search: session page, upload with the token and cookie, then results and listings for the recognized name', async () => {
  const upstream = fixtureUpstream();
  const bing = createBing({ upstream });
  const photo = fixtureImage('/court-classic-white.jpg');
  const found = await bing.visualSearch(photo, 'image/jpeg');
  assert.equal(found.ok, true);
  assert.equal(found.query, 'Court Classic White');
  assert.deepEqual(
    found.results.map((r) => r.url),
    [FIXTURE.productUrl, FIXTURE.blockedUrl, 'https://wiki.fixture.alt/wiki/Court_shoe'],
  );
  assert.deepEqual(
    found.shopping.map((l) => [l.title, l.price.amountMinor, l.imageUrl]),
    [
      ['Court Classic Low Leather Sneaker, White', 8900, FIXTURE.listingImageUrls[0]],
      ['Court Classic Mid Sneaker - White/Navy', 7499, FIXTURE.listingImageUrls[1]],
    ],
  );
  const [session, upload, serp, shop] = upstream.requests;
  assert.equal(session.url, 'https://www.bing.com/images?FORM=HDRSC2&setlang=en-us');
  assert.equal(upload.method, 'POST');
  assert.match(upload.url, /^https:\/\/www\.bing\.com\/images\/kblob\?iss=sbiupload/);
  assert.equal(upload.headers['X-SNR-SignedToken-Kblob'], 'fixture-kblob-token-0f3c9a');
  assert.match(upload.headers.Cookie, /MUID=/);
  assert.match(upload.headers['Content-Type'], /^multipart\/form-data; boundary=/);
  assert.match(serp.url, /^https:\/\/www\.bing\.com\/search\?q=Court\+Classic\+White&bcid=/);
  assert.equal(shop.url, 'https://www.bing.com/shop?q=Court%20Classic%20White&setlang=en-US');
  assert.ok(upstream.requests.every((r) => r.headers['User-Agent'] === 'Mozilla/5.0 (compatible; RotationLookup/0.1; educational prototype)'));
  assert.ok(!upstream.requests.some((r) => /google\./.test(r.url)), 'Google is never contacted');
  const size = jpegSize(photo);
  assert.ok(size.width >= 400 && size.height >= 400, 'the fixture photo is a real JPEG of at least 400 px');
});

test('the Bing session is reused for 10 minutes and refreshed only after that; a failed upload is not retried', async () => {
  const clock = fakeClock();
  const transport = fixtureTransport();
  let failUploads = false;
  const send = transport.send;
  transport.send = async (req) => {
    if (failUploads && req.url.pathname === '/images/kblob') {
      transport.requests.push({ method: req.method, url: req.url.href, headers: req.headers });
      return { status: 500, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html><body>Server error</body></html>') };
    }
    return send(req);
  };
  const upstream = createUpstream({ transport, now: clock.now, sleep: clock.sleep, minIntervalMs: 0 });
  const bing = createBing({ upstream, now: clock.now });
  const photo = fixtureImage('/court-classic-white.jpg');
  const count = (pattern) => transport.requests.filter((r) => pattern.test(r.url)).length;

  assert.equal((await bing.visualSearch(photo, 'image/jpeg')).ok, true);
  clock.advance(9 * 60 * 1000);
  assert.equal((await bing.visualSearch(fixtureImage('/listings/court-classic-low.jpg'), 'image/jpeg')).ok, true);
  assert.equal(count(/\/images\?FORM=HDRSC2/), 1, 'one session page for both searches');

  failUploads = true;
  const failed = await bing.visualSearch(photo, 'image/jpeg');
  assert.deepEqual([failed.ok, failed.status, failed.code], [false, 'unavailable', 'http_error']);
  assert.equal(count(/\/images\/kblob/), 3, 'the failed upload was sent once');
  assert.equal(count(/\/images\?FORM=HDRSC2/), 1, 'and the session was not refreshed because of it');

  failUploads = false;
  clock.advance(60 * 1000 + 1);
  assert.equal((await bing.visualSearch(photo, 'image/jpeg')).ok, true);
  assert.equal(count(/\/images\?FORM=HDRSC2/), 2, 'refreshed once the session is older than 10 minutes');
});

test('photo search: no name means no_match; a blocked upload cools Bing down for every Bing request', async () => {
  const noName = createBing({ upstream: fixtureUpstream({ lensQuery: null }) });
  const none = await noName.visualSearch(fixtureImage('/court-classic-white.jpg'), 'image/jpeg');
  assert.deepEqual([none.ok, none.status], [false, 'no_match']);

  const transport = fixtureTransport();
  const send = transport.send;
  transport.send = async (req) => (req.url.pathname === '/images/kblob' ? { status: 403, headers: { 'content-type': 'text/html' }, body: Buffer.from('Forbidden') } : send(req));
  const upstream = createUpstream({ transport, minIntervalMs: 0 });
  const bing = createBing({ upstream });
  const blocked = await bing.visualSearch(fixtureImage('/court-classic-white.jpg'), 'image/jpeg');
  assert.deepEqual([blocked.status, blocked.code], ['blocked', 'http_403']);
  const before = transport.requests.length;
  const search = await bing.webSearch('Court Classic White');
  assert.deepEqual([search.status, search.code], ['blocked', 'cooldown']);
  assert.equal(transport.requests.length, before, 'Bing is not contacted during the cooldown');
});

test("a Bing page with no results and Bing's challenge wording is a block", async () => {
  const upstream = fixtureUpstream();
  const bing = createBing({ upstream });
  const walled = await bing.webSearch('bing wall court classic');
  assert.deepEqual([walled.status, walled.code], ['blocked', 'challenge']);
  const after = await bing.shopping('Court Classic White');
  assert.deepEqual([after.status, after.code], ['blocked', 'cooldown']);

  const empty = await createBing({ upstream: fixtureUpstream() }).webSearch('nothing like this exists');
  assert.deepEqual(empty, { ok: true, results: [] });
});

test('parseBingShop reads lazy thumbnails from data-src inside the main image box, never a later icon', () => {
  // The shapes seen on Bing Shopping: an eager <img src>, and a lazy placeholder <div data-src>
  // followed (outside the image link) by a delivery-truck icon.
  const card = (goid, imageBox) =>
    `<li class="br-item" data-url="/shop/entitydetails?filters=NonSponsoredOffer%3a%22true%22"><div class="br-slideshow"><a class="br-voidlink br-imgClickWrap" href="javascript:void(0)"><div class="cico br-pdMainImg single-image-zoom">${imageBox}</div></a></div><a class="br-titlelink" href="/shop/productdetails?q=x&amp;goid=${goid}&amp;FORM=SHPPDP"><div class="br-title"><span title="Item ${goid}">Item</span></div></a><div class="br-price"><div class="pd-price"><div class="resp-one-line">$10.00</div></div></div><div class="br-delivery"><img src="data:image/svg+xml;base64,PHN2Zy8+" alt="delivery truck"></div></li>`;
  const html = [
    card('1', '<img height="210" width="220" src="https://th.bing.com/th?id=OPHS.eager&amp;w=220" loading="lazy"/>'),
    card('2', '<div class="rms_iac" data-height="210" data-alt="Item 2" data-class="rms_img" data-src="https://th.bing.com/th?id=OPHS.lazy%2b2&amp;w=220&amp;h=210"></div>'),
    card('3', '<div class="rms_iac" data-src-hq="https://th.bing.com/th?id=OPHS.hq3" data-src="https://th.bing.com/th?id=OPHS.lq3"></div>'),
    card('4', ''),
  ].join('');
  const listings = shopListings(parseBingShop(html));
  assert.deepEqual(
    listings.map((l) => l.imageUrl),
    ['https://th.bing.com/th?id=OPHS.eager&w=220', 'https://th.bing.com/th?id=OPHS.lazy%2b2&w=220&h=210', 'https://th.bing.com/th?id=OPHS.hq3', null],
  );
});

test('a typed query that Bing echoes back never counts as a block', async () => {
  const upstream = fixtureUpstream();
  const bing = createBing({ upstream });
  // The fixture's no-results pages repeat the query in the title and in "no results for ...".
  for (const query of ['Access Denied hoodie', 'Captcha t-shirt', 'Just a moment watch', 'verify you are human tee', 'unusual traffic sign']) {
    assert.deepEqual(await bing.webSearch(query), { ok: true, results: [] }, query);
    assert.deepEqual(await bing.shopping(query), { ok: true, listings: [] }, query);
  }
  assert.equal(upstream.cooldownUntil('www.bing.com'), 0, 'Bing was never put on a cooldown');
  const after = await bing.webSearch('Court Classic White');
  assert.equal(after.ok, true);
  assert.ok(after.results.length > 0);
});
