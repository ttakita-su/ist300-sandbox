// Real product lookups in a phone-sized Chromium, through the local server (backend/server.mjs)
// with every store and Bing answered by the fixture upstream (tests/fixtures/web/upstream.mjs), so
// nothing leaves this machine. It drives a pasted store link to a saved item, an online store
// search to a wishlist item, a photo search to a confirmed match that keeps the person's photo, a
// store that blocks lookups, and the not-connected state on the static test server. Fails on wrong
// outcomes, console errors, page errors, failed requests, horizontal scroll at 360 px, or any
// request for a host other than the two local servers and the fixture stores.
// Usage: node tests/e2e/web.mjs [screenshotDir]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startAppServer } from '../../backend/server.mjs';
import { startServer } from '../serve.mjs';
import { FIXTURE, fixtureResponse, fixtureUpstream } from '../fixtures/web/upstream.mjs';
import { callApi, go, hasHorizontalScroll, signInAs } from './helpers.mjs';

const shotDir = process.argv[2] ?? null;
const PHONE = { width: 360, height: 780 };
const NOT_CONNECTED = 'Real store search needs the local server. In the closet-advisor folder, run npm start and open the address it prints.';
const CONSENT = "Sends this photo to Microsoft Bing to recognize it. Rotation's server doesn't keep it.";
const DEMO_LINK = 'https://northline.example/p/NL-48213';
const STOCKX_LINK = 'https://stockx.com/nike-dunk-low-retro-white-black-2021';

const upstream = fixtureUpstream();
const app = await startAppServer({ port: 0, upstream });
const plain = await startServer(0);
const browser = await chromium.launch();
const problems = [];
const lensPosts = [];

const isLocal = (url) => url.hostname === '127.0.0.1';
const isFixture = (url) => url.hostname.endsWith('.fixture.alt');

/** A signed-in phone page on `base`, with problems collected and the network fenced off. */
async function openPage(base) {
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // Routes run newest first: fixture store images (hot-linked by result lists) are answered from
  // memory, and anything else that isn't one of the two local servers is refused and reported.
  await context.route((url) => !isLocal(url) && !isFixture(url), (route) => {
    problems.push(`would leave this machine: ${route.request().url()}`);
    return route.abort();
  });
  await context.route((url) => isFixture(url), async (route) => route.fulfill(await fixtureResponse(route.request().url())));
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()} (${page.url()})`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message} (${page.url()})`));
  page.on('requestfailed', (req) => problems.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/lens') lensPosts.push(page.url());
  });
  await page.goto(`${base}#/welcome`);
  await page.waitForSelector('html[data-ready="true"]', { timeout: 20000 });
  await signInAs(page, 'usr_demo_alex');
  return { context, page };
}

async function shot(page, name) {
  if (shotDir) await page.screenshot({ path: `${shotDir}/web-${name}.png`, fullPage: true });
}

async function noSideScroll(page, where) {
  assert.equal(await hasHorizontalScroll(page), false, `no horizontal scroll at 360 px: ${where}`);
}

const sheet = (page) => page.locator('dialog.sheet[open]');
const itemId = (page, kind) => new URL(page.url()).hash.match(new RegExp(`^#/${kind}/([^/?]+)`))?.[1];

try {
  if (shotDir) await mkdir(shotDir, { recursive: true });
  const { context, page } = await openPage(app.url);

  // (a) A store link without https:// (the browser mustn't block it) -> the save form -> collection.
  await go(page, '/add/link?dest=owned');
  await page.fill('#f-url', FIXTURE.productShortUrl.replace('https://', ''));
  await page.click('[data-link-form] [type="submit"]');
  const form = page.locator('[data-web-link] form[data-web-save]');
  await form.waitFor({ timeout: 20000 });
  const preview = await page.locator('.web-preview').innerText();
  assert.match(preview, /Court Classic Leather Sneaker/, 'the preview shows the page title');
  assert.match(preview, /Seen at Fixture Shoe Co\. for \$89, checked just now/, 'and what the store showed');
  assert.match(preview, /In stock/, 'and its availability');
  const previewImg = page.locator('.web-preview img[data-remote-img]');
  assert.equal(await previewImg.getAttribute('referrerpolicy'), 'no-referrer', 'the hot-linked image sends no referrer');
  assert.equal(await previewImg.getAttribute('loading'), 'lazy');
  assert.equal(await previewImg.getAttribute('src'), FIXTURE.productImageUrl);
  assert.equal(await page.isChecked('input[name="category"][value="sneaker"]'), true, 'the category guess is chosen');
  assert.equal(await page.inputValue('#f-web-brand'), FIXTURE.product.brand);
  assert.equal(await page.inputValue('#f-web-variant'), FIXTURE.product.color);
  assert.equal(await page.inputValue('#f-web-type'), 'court');
  assert.equal(await page.isChecked('input[name="saveImage"]'), true, 'keeping the store image is the default');
  assert.equal(await page.inputValue('select[name="size.value"]'), '', 'the size is never taken from the page');
  await noSideScroll(page, 'link save form');
  await shot(page, 'link-found');
  await form.locator('[type="submit"]').click();
  await page.waitForURL(/#\/collection\/own_/, { timeout: 20000 });
  await page.waitForSelector('.media img[data-photo-id][data-hydrated="yes"]', { timeout: 10000 });
  const linked = await callApi(page, 'getOwned', { itemId: itemId(page, 'collection') });
  assert.equal(linked.productId, null, 'web data never becomes a catalog identity');
  assert.equal(linked.identity.resolution, 'manual');
  assert.equal(linked.web.via, 'page');
  assert.equal(linked.web.price.amountMinor, FIXTURE.product.price.amountMinor);
  assert.equal(linked.details.purchase, null, "the store's price isn't a price paid");
  assert.equal(linked.sourceUrl, FIXTURE.productUrl);
  assert.equal(linked.image.kind, 'web', 'the saved store image is shown');
  assert.ok(linked.photos.webId);
  const detail = await page.locator('main').innerText();
  assert.match(detail, /Image from shop\.fixture\.alt/, 'the image says where it came from');
  assert.match(detail, /Seen at Fixture Shoe Co\. for \$89, checked just now/);
  const view = page.locator('.web-seen a');
  assert.equal(await view.innerText(), 'View on shop.fixture.alt');
  assert.equal(await view.getAttribute('target'), '_blank');
  assert.equal(await view.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await view.getAttribute('href'), FIXTURE.productUrl);
  await noSideScroll(page, 'item detail');
  await shot(page, 'link-saved');

  // A page that isn't a product, and a StockX link the server can't read (read as text instead).
  await go(page, `/add/link?dest=owned&url=${encodeURIComponent(FIXTURE.homeUrl)}`);
  await page.waitForSelector('[data-web-link] .notice', { timeout: 20000 });
  assert.match(await page.locator('[data-web-link]').innerText(), /That isn't a single product[\s\S]*doesn't look like a single product/);
  await go(page, `/add/link?dest=owned&url=${encodeURIComponent(STOCKX_LINK)}`);
  await page.waitForSelector('[data-web-link] .notice', { timeout: 20000 });
  const market = await page.locator('[data-web-link]').innerText();
  assert.match(market, /A StockX link/, 'the marketplace is named, not "[object Object]"');
  assert.ok(!market.includes('[object Object]'));
  assert.match(await page.locator('[data-web-link] a', { hasText: 'Continue' }).getAttribute('href'), /^#\/add\/manual\?.*sourceUrl=https%3A%2F%2Fstockx\.com/);

  // (b) Search online stores -> a store page that blocks lookups, then a listing -> the wishlist.
  await go(page, '/add/web?dest=wishlist');
  await page.fill('#f-web-q', FIXTURE.query);
  await page.click('[data-web-form] [type="submit"]');
  await page.waitForSelector('[data-web-listing]', { timeout: 20000 });
  assert.match(page.url(), /#\/add\/web\?dest=wishlist&q=Court/, 'the search is in the address, for back and forward');
  assert.equal(await page.locator('[data-web-listing]').count(), 2, 'free listings only, no ads');
  const pages = await page.locator('[data-web-result]').allInnerTexts();
  assert.ok(pages.some((t) => t.includes('shop.fixture.alt')) && !pages.some((t) => t.includes('bing.com')), 'store pages, without Bing pages');
  const thumb = page.locator('[data-web-listing] img[data-remote-img]').first();
  assert.equal(await thumb.getAttribute('referrerpolicy'), 'no-referrer');
  await noSideScroll(page, 'search results');
  await shot(page, 'search-results');
  await page.locator('[data-web-result]', { hasText: 'Blocked Outfitters' }).click();
  await sheet(page).locator('.notice').waitFor({ timeout: 20000 });
  assert.match(await sheet(page).innerText(), /This store can't be read[\s\S]*Automated lookups aren't allowed on blocked\.fixture\.alt/);
  await sheet(page).locator('[data-sheet-close]').first().click();
  await page.locator('[data-web-listing]').first().click();
  const wishForm = sheet(page).locator('form[data-web-save]');
  await wishForm.waitFor();
  assert.equal(await page.inputValue('#f-web-brand'), '', "the listing doesn't name a brand");
  await wishForm.locator('[type="submit"]').click();
  await sheet(page).locator('.field-error[data-for="custom.brand"]').waitFor();
  await page.fill('#f-web-brand', FIXTURE.product.brand);
  await noSideScroll(page, 'save sheet');
  await shot(page, 'search-save-sheet');
  await wishForm.locator('[type="submit"]').click();
  await page.waitForURL(/#\/wishlist\/wish_/, { timeout: 20000 });
  await page.waitForSelector('.media img[data-photo-id][data-hydrated="yes"]', { timeout: 10000 });
  const wish = await callApi(page, 'getWishlistItem', { itemId: itemId(page, 'wishlist') });
  assert.equal(wish.productId, null);
  assert.equal(wish.web.via, 'search');
  assert.equal(wish.web.query, FIXTURE.query);
  assert.equal(wish.targetPriceMinor, null, "the store's price isn't a target price");
  assert.equal(wish.image.kind, 'web');
  assert.match(wish.identity.evidence[0].detail, /^Picked from a Bing Shopping listing \(Fixture Shoe Co\.\)/);
  assert.match(await page.locator('.web-seen').innerText(), /Seen at Fixture Shoe Co\. for \$89, checked just now[\s\S]*View on Bing Shopping/);
  await shot(page, 'search-saved');

  // (c) A photo of something the demo catalog doesn't have (the usual case for a real photo):
  // on-device match -> Search online stores (only on the tap) -> saved.
  await go(page, '/add/photo?dest=owned');
  await page.click('[data-sample="red-runner"]');
  await page.click('[data-start]');
  await page.waitForURL(/#\/match\//);
  const jobId = decodeURIComponent(page.url().split('#/match/')[1]);
  await page.waitForSelector('[data-web-panel]', { timeout: 90000 });
  assert.equal(lensPosts.length, 0, 'nothing is sent while matching runs or when the results show');
  await noSideScroll(page, 'match without a confident catalog match');
  assert.match(await page.locator('[data-web-panel]').innerText(), new RegExp(CONSENT.replace(/[.']/g, '.')), 'the button says where the photo goes');
  await page.click('[data-web-search]');
  await page.waitForSelector('[data-web-panel] [data-web-listing]', { timeout: 45000 });
  assert.equal(lensPosts.length, 1, 'one photo search for one tap');
  assert.match(await page.locator('[data-web-panel]').innerText(), /Bing recognized this as: Court Classic White/);
  await noSideScroll(page, 'match with store results');
  await shot(page, 'photo-results');
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await page.waitForSelector('[data-web-panel] [data-web-listing]', { timeout: 20000 });
  assert.equal(lensPosts.length, 1, 'reloading shows the last results without searching again');
  await page.locator('[data-web-panel] [data-web-listing]').nth(1).click();
  const photoForm = sheet(page).locator('form[data-web-save]');
  await photoForm.waitFor();
  assert.equal(await page.isChecked('input[name="category"][value="sneaker"]'), true, "the job's category is kept");
  await page.fill('#f-web-brand', 'Second Street');
  await photoForm.locator('[type="submit"]').click();
  await page.waitForURL(/#\/collection\/own_/, { timeout: 20000 });
  await page.waitForSelector('.media img[data-photo-id][data-hydrated="yes"]', { timeout: 10000 });
  const found = await callApi(page, 'getOwned', { itemId: itemId(page, 'collection') });
  const job = await callApi(page, 'getMatchJob', { jobId });
  assert.equal(job.status, 'confirmed', 'the job is marked saved');
  assert.equal(job.confirmedItemId, found.id);
  assert.equal(found.image.kind, 'original', "the person's own photo stays the item's photo");
  assert.equal(found.photos.originalId, job.photoId);
  assert.ok(found.photos.webId, "and the store's image is kept as an option");
  assert.deepEqual(found.image.options, ['original', 'web']);
  assert.equal(found.web.via, 'photo');
  assert.match(found.identity.evidence[0].detail, /^Found with Bing visual search from your photo/);
  assert.match(await page.locator('.media .media-tag').first().innerText(), /Your photo/);
  assert.deepEqual(await page.locator('.segmented label').allInnerTexts(), ['Your photo', 'Store image'], 'the store image is a display option');
  await page.locator('.segmented label', { hasText: 'Store image' }).click();
  await page.waitForFunction(() => document.querySelector('.media .media-tag')?.textContent.includes('Image from'));
  await shot(page, 'photo-saved');

  // (d) A store that blocks automated lookups says so, and offers to enter it by hand.
  await go(page, `/add/link?dest=owned&url=${encodeURIComponent(FIXTURE.blockedUrl)}`);
  await page.waitForSelector('[data-web-link] .notice', { timeout: 20000 });
  assert.match(await page.locator('[data-web-link]').innerText(), /This store can't be read[\s\S]*Automated lookups aren't allowed on blocked\.fixture\.alt\. Enter the details yourself, or try another store's link\./);
  assert.match(await page.locator('[data-web-link] a', { hasText: 'Enter it yourself' }).getAttribute('href'), /^#\/add\/manual\?dest=owned&sourceUrl=https%3A%2F%2Fblocked\.fixture\.alt%2F/);
  await shot(page, 'link-blocked');
  await context.close();

  // (e) The static test server: api/status.json says live: false, so real lookups say they need
  // the local server, demo store links still resolve, and nothing else is requested.
  const offline = await openPage(plain.url);
  await go(offline.page, '/add/web?dest=owned&q=court%20classic');
  assert.match(await offline.page.locator('main').innerText(), new RegExp(`Real store search is off[\\s\\S]*${NOT_CONNECTED.replace(/[.]/g, '.')}`));
  assert.equal(await offline.page.locator('a', { hasText: 'Search the demo catalog' }).getAttribute('href'), '#/add/search?dest=owned');
  await shot(offline.page, 'static-search');
  await go(offline.page, `/add/link?dest=owned&url=${encodeURIComponent(FIXTURE.productUrl)}`);
  await offline.page.waitForSelector('[data-web-link] .notice');
  assert.match(await offline.page.locator('[data-web-link]').innerText(), /Real store lookups are off[\s\S]*npm start/);
  await go(offline.page, `/add/link?dest=owned&url=${encodeURIComponent(DEMO_LINK)}`);
  assert.match(await offline.page.locator('main').innerText(), /Found it/, 'demo store links keep working');
  await offline.context.close();

  const toPlain = upstream.requests.filter((r) => !new URL(r.url).hostname.endsWith('.fixture.alt') && new URL(r.url).hostname !== 'www.bing.com');
  assert.deepEqual(toPlain, [], 'the server only contacted fixture hosts');
  assert.deepEqual(problems, [], 'no console errors, page errors, failed requests or outside requests');
  console.log('Web lookups passed: link, search, photo search, blocked store and not-connected states, no network.');
} catch (error) {
  console.error(error);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  await app.close();
  plain.server.close();
}
