// Uploaded-photo online search and manual fallback, with local HTTP fixtures only.
import assert from 'node:assert/strict';
import { openApp, go, callApi, hasHorizontalScroll } from './helpers.mjs';

const app = await openApp({ user: 'usr_demo_alex', route: '/add/photo?category=clothing' });
const { page, context, problems, url } = app;
let posts = 0;
let reply = {
  status: 'ok', engine: 'bing', query: 'Blue Oxford Shirt',
  shopping: [{ id: 'shirt_1', title: 'Blue Oxford Shirt', seller: 'Fixture Store', source: 'bing_shopping', url: 'https://www.bing.com/shop/productdetails?q=blue+shirt&goid=1', imageUrl: null, price: null }],
  results: [],
};
let releaseSearch = null;
let delayed = false;
const sheet = page.locator('dialog.sheet[open]');
const savedId = () => decodeURIComponent(new URL(page.url()).hash.split('/')[2]);

try {
  await context.route((u) => u.origin !== new URL(url).origin, (route) => {
    problems.push(`outside request: ${route.request().url()}`);
    return route.abort();
  });
  await page.route('**/api/status.json', (route) => route.fulfill({ json: { live: true } }));
  await page.route('**/api/lens', async (route) => {
    posts += 1;
    if (delayed) await new Promise((resolve) => { releaseSearch = resolve; });
    await route.fulfill({ json: reply });
  });
  // The photo screen reads status.json once per page load, so load it again behind the fake.
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  const bytes = await page.evaluate(async () => {
    const { renderSample } = await import('./js/engine/samples.js');
    return Array.from(new Uint8Array(await (await renderSample('field-jacket')).arrayBuffer()));
  });
  const upload = async () => {
    await go(page, '/add/photo?category=clothing');
    await page.locator('[data-file]').setInputFiles({ name: 'my-shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(bytes) });
    await page.locator('[data-photo-search]').waitFor({ timeout: 2000 });
  };

  await upload();
  assert.equal(posts, 0, 'selecting a photo does not upload it to a search provider');
  assert.match(await page.locator('[data-preview]').innerText(), /Microsoft Bing/);
  await page.locator('[data-photo-search]').click();
  await page.waitForSelector('[data-web-listing]');
  assert.equal(posts, 1);
  assert.equal(await page.locator('[data-candidate-card]').count(), 0, 'no fictional catalog candidates in online mode');
  assert.equal(await hasHorizontalScroll(page), false);
  await page.screenshot({ path: '/tmp/rotation-photo-search-results.png', fullPage: true });
  await page.reload();
  await page.waitForSelector('[data-web-listing]');
  assert.equal(posts, 1, 'reloading results does not search again');
  await page.locator('[data-web-listing]').click();
  await sheet.locator('[data-web-save]').waitFor();
  assert.equal(await sheet.locator('#f-web-brand').getAttribute('required'), null, 'unknown clothing brands do not block an online result');
  await sheet.locator('[data-web-save] [type="submit"]').click();
  await page.waitForURL(/#\/collection\/own_/);
  const online = await callApi(page, 'getOwned', { itemId: savedId() });
  assert.equal(online.custom.name, 'Blue Oxford Shirt');
  assert.equal(online.custom.brand, null);
  assert.equal(online.productId, null);
  assert.equal(online.web.via, 'photo');
  assert.ok(online.photos.originalId);

  reply = { status: 'no_match', reason: 'No product was recognized.' };
  await upload();
  await page.locator('[data-photo-search]').click();
  await page.waitForSelector('[data-custom]');
  assert.match(await page.locator('main').innerText(), /No product match found/);
  await page.getByRole('button', { name: 'Label it myself', exact: true }).click();
  await sheet.getByLabel('Name', { exact: true }).fill('My blue shirt');
  await sheet.locator('select[name="custom.type"]').selectOption('tee');
  await sheet.getByText('Blue', { exact: true }).click();
  await sheet.locator('[type="submit"]').click();
  await page.waitForURL(/#\/collection\/own_/);
  const manualId = savedId();
  const manual = await callApi(page, 'getOwned', { itemId: manualId });
  assert.equal(manual.custom.brand, null);
  assert.deepEqual(manual.custom.colors, ['blue']);
  assert.equal(manual.custom.type, 'tee');
  assert.ok(manual.photos.originalId);
  assert.equal(manual.web, null);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  await page.getByRole('link', { name: 'Edit details', exact: true }).first().click();
  await page.getByLabel('Name', { exact: true }).fill('My red hoodie');
  await page.locator('select[name="custom.type"]').selectOption('hoodie');
  await page.getByText('Blue', { exact: true }).click();
  await page.getByText('Red', { exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.waitForURL(new RegExp(`#/collection/${manualId}$`));
  const edited = await callApi(page, 'getOwned', { itemId: manualId });
  assert.equal(edited.custom.name, 'My red hoodie');
  assert.equal(edited.custom.type, 'hoodie');
  assert.deepEqual(edited.custom.colors, ['red']);
  assert.equal(edited.photos.originalId, manual.photos.originalId);

  reply = { status: 'unavailable', reason: 'Bing now requires browser verification for photo uploads. Automatic photo search is unavailable. Open Bing Visual Search in your browser, or label the item yourself.' };
  await upload();
  await page.locator('[data-photo-search]').click();
  await page.waitForSelector('[data-custom]');
  const browserSearch = page.getByRole('link', { name: 'Open Bing Visual Search', exact: true });
  assert.equal(await browserSearch.getAttribute('href'), 'https://www.bing.com/images');
  assert.equal(await browserSearch.getAttribute('target'), '_blank');
  assert.equal(await page.getByRole('button', { name: 'Label it myself', exact: true }).isVisible(), true);
  await page.waitForFunction(() => !document.querySelector('.toast'));
  await page.screenshot({ path: '/tmp/rotation-bing-verification-fallback.png', fullPage: true });

  // With a Claude key the server says so, and the app says where the photo goes before it's sent.
  await page.unroute('**/api/status.json');
  await page.route('**/api/status.json', (route) => route.fulfill({ json: { live: true, version: 1, engines: { lookup: 'page', search: 'bing', photo: 'claude' } } }));
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  const beforeClaude = posts;
  await upload();
  assert.equal(posts, beforeClaude, 'selecting a photo does not send it to Claude');
  assert.match(await page.locator('[data-preview]').innerText(), /Anthropic's Claude/);
  assert.doesNotMatch(await page.locator('[data-preview]').innerText(), /Microsoft Bing/);
  reply = { ...reply, status: 'ok', engine: 'claude', query: 'Blue Oxford Shirt', reason: null, shopping: [{ id: 'shirt_2', title: 'Blue Oxford Shirt', seller: 'Fixture Store', source: 'bing_shopping', url: 'https://www.bing.com/shop/productdetails?q=blue+shirt&goid=2', imageUrl: null, price: null }], results: [] };
  await page.locator('[data-photo-search]').click();
  await page.waitForSelector('[data-web-listing]');
  assert.equal(posts, beforeClaude + 1);
  const claudePanel = await page.locator('[data-web-panel]').innerText();
  assert.match(claudePanel, /Possible products for:\s*Blue Oxford Shirt/);
  assert.match(claudePanel, /Sends this photo to Anthropic's Claude/);
  assert.equal(await hasHorizontalScroll(page), false);
  await page.screenshot({ path: '/tmp/rotation-claude-photo-results.png', fullPage: true });

  // With a model in Ollama on the server's computer, the app says the photo goes to no online service.
  await page.unroute('**/api/status.json');
  await page.route('**/api/status.json', (route) => route.fulfill({ json: { live: true, version: 1, engines: { lookup: 'page', search: 'bing', photo: 'local' } } }));
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  const beforeLocal = posts;
  let shownEngine = null;
  await page.unroute('**/api/lens');
  await page.route('**/api/lens', async (route) => {
    posts += 1;
    shownEngine = route.request().headers()['x-rotation-photo-engine'];
    await route.fulfill({ json: reply });
  });
  await upload();
  assert.equal(posts, beforeLocal, 'selecting a photo does not send it to the model');
  const localPreview = await page.locator('[data-preview]').innerText();
  assert.match(localPreview, /vision model on the computer running Rotation/);
  assert.match(localPreview, /goes to no online service/);
  assert.doesNotMatch(localPreview, /Anthropic|Microsoft Bing to find/);
  reply = { ...reply, engine: 'local', query: 'navy field jacket' };
  await page.locator('[data-photo-search]').click();
  await page.waitForSelector('[data-web-listing]');
  assert.equal(posts, beforeLocal + 1);
  assert.equal(shownEngine, 'local', 'the page tells the server where it said the photo goes');
  const localPanel = await page.locator('[data-web-panel]').innerText();
  assert.match(localPanel, /Possible products for:\s*navy field jacket/);
  assert.match(localPanel, /Sends this photo to a vision model on the computer running Rotation/);
  assert.equal(await hasHorizontalScroll(page), false);
  await page.screenshot({ path: '/tmp/rotation-local-photo-results.png', fullPage: true });
  await page.unroute('**/api/lens');
  await page.route('**/api/lens', async (route) => {
    posts += 1;
    if (delayed) await new Promise((resolve) => { releaseSearch = resolve; });
    await route.fulfill({ json: reply });
  });
  await page.unroute('**/api/status.json');
  await page.route('**/api/status.json', (route) => route.fulfill({ json: { live: true } }));
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');

  const beforeManual = posts;
  await upload();
  await page.locator('[data-photo-label]').click();
  await sheet.getByLabel('Name', { exact: true }).waitFor();
  assert.equal(posts, beforeManual, 'direct manual labeling makes no search request');
  await sheet.locator('[data-sheet-close]').click();

  delayed = true;
  await upload();
  await page.locator('[data-photo-search]').click();
  await page.waitForFunction(() => document.querySelector('[data-photo-search]')?.disabled);
  while (!releaseSearch) await new Promise((resolve) => setTimeout(resolve, 10));
  await go(page, '/collection');
  releaseSearch();
  await page.waitForTimeout(300);
  assert.match(page.url(), /#\/collection$/, 'a late result does not navigate back');
  delayed = false;

  // A fresh page reads the real static status, so search falls back without a POST.
  await page.unroute('**/api/status.json');
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  const beforeOffline = posts;
  await upload();
  await page.locator('[data-photo-search]').click();
  await page.waitForSelector('[data-custom]');
  assert.match(await page.locator('main').innerText(), /Real store search is off/);
  assert.equal(posts, beforeOffline);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await hasHorizontalScroll(page), false);
  await page.getByRole('button', { name: 'Label it myself', exact: true }).focus();
  await page.keyboard.press('Enter');
  await sheet.getByLabel('Name', { exact: true }).waitFor();
  await sheet.evaluate(async (el) => { await Promise.all(el.getAnimations().map((animation) => animation.finished)); });
  await page.screenshot({ path: '/tmp/rotation-photo-search-manual-desktop.png', fullPage: true });
  assert.deepEqual(problems, []);
  console.log('Photo search passed: explicit upload, online save, manual fallback/editing, direct manual, cancellation and offline states.');
} finally {
  releaseSearch?.();
  await app.close();
}
