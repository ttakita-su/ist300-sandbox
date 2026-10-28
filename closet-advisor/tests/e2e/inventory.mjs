// The personal closet inventory in a real browser, for D08. Each pass signs up a new account,
// so the closet starts empty and the demo data is never touched. At phone size it drives the
// eight acceptance checks (AC1-AC8) through the screens, with page reloads to prove IndexedDB
// keeps each change, then two navigation checks (N1, N2) and two unexpected-user tests per
// action (C1-D2). A short pass repeats create and read at desktop size in the dark theme.
// Each check prints pass/FAIL with its ID (used in docs/D08_INVENTORY_REPORT.md), and "note"
// lines record what the screen showed. The run fails on any failed check, console error, page
// error, failed request or request that would leave this machine.
// Usage: node tests/e2e/inventory.mjs [screenshotDir]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startServer } from '../serve.mjs';
import { callApi, go, hasHorizontalScroll, PHONE, DESKTOP } from './helpers.mjs';

const shotDir = process.argv[2] ?? null;
if (shotDir) await mkdir(shotDir, { recursive: true });

const { server, url } = await startServer(0);
const browser = await chromium.launch();
const problems = [];
const results = [];

/** Runs one check and records the outcome without stopping the run. */
async function check(id, what, fn) {
  try {
    await fn();
    results.push({ id, ok: true });
    console.log(`pass  ${id}  ${what}`);
  } catch (error) {
    results.push({ id, ok: false });
    console.log(`FAIL  ${id}  ${what}\n      ${String(error?.message ?? error).split('\n').join('\n      ')}`);
  }
}

/** Records what the screen showed, for the report. */
const note = (id, text) => console.log(`note  ${id}  ${text}`);

/** A browser context with problems collected and every request off this machine refused. */
async function openContext({ viewport = PHONE, theme = 'light' } = {}) {
  const mobile = viewport.width < 600;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: theme });
  await context.route((u) => u.hostname !== '127.0.0.1', (route) => {
    problems.push(`would leave this machine: ${route.request().url()}`);
    return route.abort();
  });
  return context;
}

async function openPage(context) {
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()} (${page.url()})`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message} (${page.url()})`));
  page.on('requestfailed', (req) => problems.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));
  page.on('dialog', (dialog) => {
    problems.push(`unexpected browser dialog: ${dialog.message()}`);
    dialog.dismiss();
  });
  await page.goto(`${url}#/welcome`);
  await ready(page);
  return page;
}

/** Signs up a new account in this browser context; its closet starts empty. */
const signUp = (page, who) =>
  page.evaluate(async (name) => {
    const client = await import('./js/client.js');
    client.setSession(await client.api.signUp({ email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`, password: 'correct horse', displayName: name }));
  }, who);

const ready = (page) => page.waitForSelector('html[data-ready="true"]', { timeout: 20000 });
const hash = (page) => new URL(page.url()).hash;
const h1 = (page) => page.locator('main h1').first().innerText();
const mainText = (page) => page.locator('main').innerText();
const sheet = (page) => page.locator('dialog.sheet[open]');
const fieldError = (page, name) => page.locator(`.field-error[data-for="${name}"]`);
const owned = async (page) => (await callApi(page, 'listOwned', {})).items;
const getItem = (page, id) => callApi(page, 'getOwned', { itemId: id });
const tiles = (page) => page.$$eval('main .tile', (els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()));

/** The item page's "Your details" rows as { label: text }. */
const factsOf = (page) => page.$$eval('main dl.facts dt', (dts) => Object.fromEntries(dts.map((dt) => [dt.textContent.trim(), dt.nextElementSibling?.textContent.trim()])));

async function shot(page, name) {
  if (shotDir) await page.screenshot({ path: `${shotDir}/inventory-${name}.png`, fullPage: true });
}

/** Waits for a toast with this text. */
const toast = (page, text) => page.locator('#toasts .toast', { hasText: text }).first().waitFor({ timeout: 4000 });

/** Waits for the hash to match, then for the router to finish rendering. */
async function landed(page, pattern) {
  await page.waitForFunction((source) => new RegExp(source).test(location.hash), pattern.source, { timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"][aria-label="Loading"]'), null, { timeout: 8000 });
  await page.waitForTimeout(150);
}

async function reload(page) {
  await page.reload();
  await ready(page);
  await page.waitForTimeout(250);
}

/** Presses the browser's own Back button and waits for whatever it does. */
async function browserBack(page) {
  await page.evaluate(() => history.back());
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"][aria-label="Loading"]'), null, { timeout: 8000 });
}

/** Calls an operation from the page and returns its error ({ code, message, fields }) instead of throwing. */
const apiError = (page, op, args) =>
  page.evaluate(
    async ([name, a]) => {
      const client = await import('./js/client.js');
      try {
        await client.api[name](a);
        return null;
      } catch (error) {
        return { code: error.code, message: error.message, fields: error.details?.fields ?? null };
      }
    },
    [op, args],
  );

/**
 * Controls, headings and tiles in the main area that stick out past the viewport. body has
 * overflow-x: hidden, so scrollWidth alone can't see clipped content.
 */
const clipped = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('main a, main button, main input, main h1, main h2, main .tile, main dl.facts dd, main .label')) {
      const box = el.getBoundingClientRect();
      if (!box.width || el.closest('.visually-hidden')) continue;
      if (box.right > window.innerWidth + 1 || box.left < -1) out.push(`${el.tagName.toLowerCase()}.${el.className} "${el.textContent.trim().slice(0, 30)}" ${Math.round(box.left)}-${Math.round(box.right)}`);
    }
    return out;
  });

async function fitsScreen(page, where) {
  assert.equal(await hasHorizontalScroll(page), false, `no horizontal scroll: ${where}`);
  assert.deepEqual(await clipped(page), [], `nothing sticks out: ${where}`);
}

const CATEGORY_PILL = { sneaker: 'Sneaker', watch: 'Watch', clothing: 'Clothing item' };

/** Opens "Enter it yourself" and picks the category with its pill, the way a person does. */
async function openAddForm(page, category) {
  await go(page, '/add/manual?dest=owned');
  if (category && category !== 'sneaker') {
    await page.getByRole('link', { name: CATEGORY_PILL[category], exact: true }).click();
    await landed(page, new RegExp(`category=${category}`));
  }
}

async function fillItem(page, { brand, name, color }) {
  if (brand != null) await page.fill('#f-custom-brand', brand);
  if (name != null) await page.fill('#f-custom-name', name);
  if (color != null) await page.fill('#f-custom-variantName', color);
}

const addButton = (page) => page.locator('form[data-manual] [type="submit"]');

/** Adds an item through the form and returns its id from the item page's address. */
async function addItem(page, item) {
  await openAddForm(page, item.category);
  await fillItem(page, item);
  await addButton(page).click();
  await toast(page, 'Added to your collection');
  await landed(page, /^#\/collection\/[^/?]+$/);
  return decodeURIComponent(hash(page).split('/')[2]);
}

/** Opens the item from the collection list, the way a person does. */
async function openFromList(page, text) {
  await go(page, '/collection');
  await page.locator('main .tile a', { hasText: text }).first().click();
  await landed(page, /^#\/collection\/[^/?]+$/);
}

async function openEdit(page) {
  await page.locator('main a.link-btn', { hasText: 'Edit details' }).click();
  await landed(page, /^#\/collection\/[^/]+\/edit$/);
}

const save = (page) => page.locator('form[data-edit] [type="submit"]').click();
const cancel = (page) => page.locator('form[data-edit] a', { hasText: 'Cancel' }).click();
const headerBack = (page) => page.locator('header.back-head [data-back]').click();
const pick = (item) => ({ category: item.category, ...item.custom });

try {
  // ======================= Phone, light theme: the eight checks =======================
  const phone = await openContext();
  const page = await openPage(phone);
  await signUp(page, 'Casey Check');
  const ids = {};
  const SHIRT = { category: 'clothing', brand: 'Uniqlo', name: 'Oxford shirt', color: 'Light blue' };
  const WATCH = { category: 'watch', brand: 'Casio', name: 'F-91W', color: 'Black resin' };

  await check('AC6', 'An empty closet shows an empty-state message', async () => {
    await go(page, '/collection');
    assert.equal(await page.locator('section.state h2').innerText(), 'Your collection is empty');
    note('AC6', `empty state: "${(await page.locator('section.state').innerText()).replace(/\s+/g, ' ')}"`);
    assert.equal(await page.locator('main .tile').count(), 0);
    await fitsScreen(page, 'empty collection');
    await shot(page, 'empty');
  });

  await check('AC1', 'Creating a valid item makes it appear in the inventory', async () => {
    ids.shirt = await addItem(page, SHIRT);
    await go(page, '/collection');
    const shown = await tiles(page);
    assert.equal(shown.length, 1);
    for (const text of ['Uniqlo', 'Oxford shirt', 'Light blue']) assert.ok(shown[0].includes(text), `the tile shows ${text}: ${shown[0]}`);
    const items = await owned(page);
    assert.deepEqual(items.map((i) => [i.id, i.category, i.custom.brand, i.custom.name, i.custom.variantName]), [[ids.shirt, 'clothing', 'Uniqlo', 'Oxford shirt', 'Light blue']]);
    note('AC1', `tile text: "${shown[0]}"`);
  });

  await check('AC2', 'Reloading the page keeps saved items', async () => {
    ids.watch = await addItem(page, WATCH);
    await reload(page);
    await go(page, '/collection');
    const shown = await tiles(page);
    assert.equal(shown.length, 2, `two tiles after reload: ${shown.join(' | ')}`);
    assert.ok(shown.some((t) => t.includes('Oxford shirt')) && shown.some((t) => t.includes('F-91W')));
    assert.equal(await page.evaluate(async () => (await import('./js/client.js')).storageKind()), 'indexeddb', 'kept in IndexedDB, not the memory fallback');
  });

  await check('AC3', 'Each item displays its saved name, category, brand and color', async () => {
    for (const [id, item, category] of [[ids.shirt, SHIRT, 'Clothing'], [ids.watch, WATCH, 'Watches']]) {
      await go(page, `/collection/${id}`);
      const text = await mainText(page);
      for (const value of [item.brand, item.name, item.color]) assert.ok(text.includes(value), `the item page shows ${value}`);
      const facts = await factsOf(page);
      note('AC3', `${item.name} details: ${JSON.stringify(facts)}`);
      assert.equal(facts.Category, category, 'a Category row names the category');
      await fitsScreen(page, `${item.name} page`);
    }
    await shot(page, 'details');
  });

  await check('AC4', 'Editing an item updates that record without duplicating it', async () => {
    await openFromList(page, 'F-91W');
    await openEdit(page);
    await page.fill('#f-custom-name', 'F-91W-1');
    await page.fill('#f-custom-variantName', 'Gold');
    await save(page);
    await toast(page, 'Saved');
    await landed(page, new RegExp(`^#/collection/${ids.watch}$`));
    await reload(page);
    const text = await mainText(page);
    assert.ok(text.includes('F-91W-1') && text.includes('Gold'), 'the new name and color show after reload');
    const items = await owned(page);
    assert.equal(items.length, 2, 'still two items');
    const watch = items.find((i) => i.id === ids.watch);
    assert.deepEqual(pick(watch), { category: 'watch', brand: 'Casio', name: 'F-91W-1', variantName: 'Gold', type: watch.custom.type, colors: [] });
    assert.equal(items.find((i) => i.id === ids.shirt).custom.name, 'Oxford shirt', 'the other item is unchanged');
  });

  await check('N1', 'After saving an edit, one press of Back returns to the collection', async () => {
    await openFromList(page, 'F-91W-1');
    await openEdit(page);
    await page.fill('#f-custom-variantName', 'Gold tone');
    await save(page);
    await toast(page, 'Saved');
    await landed(page, new RegExp(`^#/collection/${ids.watch}$`));
    await headerBack(page);
    await page.waitForTimeout(400);
    note('N1', `after Save then Back: ${hash(page)} "${await h1(page)}"`);
    assert.equal(hash(page), '#/collection');
  });

  await check('AC7', 'Blank or spaces-only names are rejected on create and on edit', async () => {
    const before = await owned(page);
    for (const name of ['', '     ']) {
      await openAddForm(page, 'clothing');
      await fillItem(page, { brand: 'Uniqlo', name, color: 'Navy' });
      await addButton(page).click();
      await fieldError(page, 'custom.name').waitFor({ timeout: 4000 });
      assert.equal(await fieldError(page, 'custom.name').innerText(), 'Enter a name');
      assert.equal(hash(page), '#/add/manual?dest=owned&category=clothing&type=', 'still on the form');
    }
    await shot(page, 'blank-name');
    await go(page, `/collection/${ids.shirt}/edit`);
    for (const name of ['', '   ']) {
      await page.fill('#f-custom-name', name);
      await save(page);
      await fieldError(page, 'custom.name').waitFor({ timeout: 4000 });
      assert.equal(await fieldError(page, 'custom.name').innerText(), 'Enter a name');
    }
    await reload(page);
    assert.equal(await page.inputValue('#f-custom-name'), 'Oxford shirt', 'the saved name is unchanged after reload');
    assert.deepEqual(await owned(page), before, 'nothing was saved or changed');
  });

  await check('AC8', 'Cancelling an edit or a deletion leaves the data unchanged', async () => {
    const before = await getItem(page, ids.shirt);
    await openFromList(page, 'Oxford shirt');
    await openEdit(page);
    await page.fill('#f-custom-name', 'Changed my mind');
    await page.fill('#f-custom-variantName', 'Red');
    await cancel(page);
    await landed(page, new RegExp(`^#/collection/${ids.shirt}$`));
    assert.ok((await mainText(page)).includes('Oxford shirt'), 'the item page shows the old name');
    await page.click('[data-delete]');
    await sheet(page).waitFor();
    note('AC8', `delete dialog: "${(await sheet(page).innerText()).replace(/\s+/g, ' ')}"`);
    await sheet(page).locator('button', { hasText: 'Cancel' }).click();
    await sheet(page).waitFor({ state: 'detached', timeout: 4000 }).catch(() => sheet(page).waitFor({ state: 'hidden', timeout: 4000 }));
    await reload(page);
    assert.deepEqual(await getItem(page, ids.shirt), before, 'the record is exactly as it was');
    await go(page, '/collection');
    assert.equal((await tiles(page)).length, 2, 'both items are still listed');
  });

  await check('N2', 'After cancelling an edit, Back does not reopen the edit form', async () => {
    await openFromList(page, 'Oxford shirt');
    await openEdit(page);
    await cancel(page);
    await landed(page, new RegExp(`^#/collection/${ids.shirt}$`));
    await headerBack(page);
    await page.waitForTimeout(400);
    note('N2', `after Cancel then Back: ${hash(page)} "${await h1(page)}"`);
    assert.equal(hash(page), '#/collection');
  });

  await check('AC5', 'Deleting an item removes only that item', async () => {
    const shirtBefore = await getItem(page, ids.shirt);
    await openFromList(page, 'F-91W-1');
    await page.click('[data-delete]');
    await sheet(page).locator('[data-confirm]').click();
    await toast(page, 'Deleted');
    await landed(page, /^#\/collection$/);
    const shown = await tiles(page);
    assert.equal(shown.length, 1);
    assert.ok(shown[0].includes('Oxford shirt'));
    assert.equal((await apiError(page, 'getOwned', { itemId: ids.watch }))?.code, 'not_found', 'the deleted item is gone');
    await reload(page);
    assert.deepEqual(await getItem(page, ids.shirt), shirtBefore, 'the other item is untouched');
    assert.equal((await owned(page)).length, 1);
  });
  await page.close();
  await phone.close();

  // ======================= Phone: two unexpected-user tests per action =======================
  const breaks = await openContext();
  const b = await openPage(breaks);
  await signUp(b, 'Bailey Break');
  const keep = await addItem(b, SHIRT);

  await check('C1', 'Create: a name that is only a pasted zero-width space', async () => {
    const before = (await owned(b)).length;
    await openAddForm(b, 'clothing');
    await fillItem(b, { brand: 'Uniqlo', name: '​', color: 'Navy' });
    await addButton(b).click();
    await b.waitForTimeout(800);
    const error = (await fieldError(b, 'custom.name').count()) ? await fieldError(b, 'custom.name').innerText() : null;
    const after = await owned(b);
    note('C1', `field error: ${JSON.stringify(error)}; now at ${hash(b)}; items ${before} -> ${after.length}${after.length > before ? `; saved name ${JSON.stringify(after[0].custom.name)}, page title "${await h1(b)}"` : ''}`);
    // A saved item would throw off the counts below, so it is removed before failing.
    for (const extra of after.filter((i) => i.id !== keep)) await callApi(b, 'deleteOwned', { itemId: extra.id });
    assert.equal(error, 'Enter a name');
    assert.equal(after.length, before, 'nothing was saved');
  });

  await check('C2', 'Create: type brand, name and color first, then change the category', async () => {
    await openAddForm(b, 'sneaker');
    await fillItem(b, { brand: 'Seiko', name: 'Presage', color: 'Blue dial' });
    await b.getByRole('link', { name: 'Watch', exact: true }).click();
    await landed(b, /category=watch/);
    const values = { brand: await b.inputValue('#f-custom-brand'), name: await b.inputValue('#f-custom-name'), color: await b.inputValue('#f-custom-variantName') };
    note('C2', `after picking Watch the fields hold ${JSON.stringify(values)}`);
    assert.deepEqual(values, { brand: 'Seiko', name: 'Presage', color: 'Blue dial' }, 'typed text survives the category change');
    await addButton(b).click();
    await toast(b, 'Added to your collection');
    await landed(b, /^#\/collection\/[^/?]+$/);
    const saved = await getItem(b, decodeURIComponent(hash(b).split('/')[2]));
    assert.deepEqual([saved.category, saved.custom.brand, saved.custom.name, saved.custom.variantName], ['watch', 'Seiko', 'Presage', 'Blue dial']);
  });

  await check('R1', 'Read: open a link to an item that does not exist, and to one just deleted', async () => {
    const gone = await callApi(b, 'createOwned', { source: 'manual', category: 'sneaker', custom: { brand: 'Vans', name: 'Old Skool' } });
    await callApi(b, 'deleteOwned', { itemId: gone.id });
    for (const id of ['own_missing', gone.id]) {
      const problemsBefore = problems.length;
      await go(b, `/collection/${id}`);
      const state = (await b.locator('main section.state').count()) ? (await b.locator('main section.state').innerText()).replace(/\s+/g, ' ') : null;
      const logged = problems.slice(problemsBefore);
      note('R1', `${id}: message ${JSON.stringify(state)}; console errors ${logged.length}${logged.length ? `: ${logged[0].slice(0, 120)}` : ''}`);
      assert.ok(state, 'a message says the item is not there');
      assert.ok(await b.locator('main a[href="#/collection"]').count(), 'there is a way back to the collection');
    }
    await fitsScreen(b, 'missing item');
    await shot(b, 'missing');
  });

  await check('R2', 'Read: a 120-character name with no spaces and HTML in it, on a phone', async () => {
    const name = `<b>HTML</b>${'x'.repeat(109)}`;
    const id = await addItem(b, { category: 'clothing', brand: 'Tag<i>s</i>', name, color: 'Ecru' });
    const saved = await getItem(b, id);
    note('R2', `typed ${name.length} characters, saved ${saved.custom.name.length}`);
    assert.equal(saved.custom.name, name);
    assert.ok((await mainText(b)).includes('<b>HTML</b>'), 'the item page shows the tags as text');
    assert.equal(await b.locator('main b, main i').count(), 0, 'no tag from the name became markup');
    await fitsScreen(b, 'long-name item page');
    await go(b, '/collection');
    assert.ok((await tiles(b)).some((t) => t.includes('<b>HTML</b>')));
    await fitsScreen(b, 'long-name tile');
    await shot(b, 'long-name');
  });

  await check('U1', 'Update: clear the name and change the color, press Save, then reload', async () => {
    const before = await getItem(b, keep);
    await go(b, `/collection/${keep}/edit`);
    await b.fill('#f-custom-name', '');
    await b.fill('#f-custom-variantName', 'Changed color');
    await save(b);
    await fieldError(b, 'custom.name').waitFor({ timeout: 4000 });
    note('U1', `field error "${await fieldError(b, 'custom.name').innerText()}"; focus on ${await b.evaluate(() => document.activeElement?.id)}`);
    await reload(b);
    const after = await getItem(b, keep);
    note('U1', `after reload the form shows name "${await b.inputValue('#f-custom-name')}", color "${await b.inputValue('#f-custom-variantName')}"`);
    assert.deepEqual(after, before, 'neither the name nor the color was saved');
  });

  await check('U2', 'Update: edit the same item in two tabs; the stale tab saves last', async () => {
    const tabB = await openPage(breaks);
    await go(b, `/collection/${keep}/edit`);
    await go(tabB, `/collection/${keep}/edit`);
    await tabB.fill('#f-custom-name', 'Name from tab B');
    await save(tabB);
    await toast(tabB, 'Saved');
    await b.fill('#f-custom-variantName', 'Color from tab A');
    await save(b);
    await b.waitForTimeout(800);
    const items = await owned(b);
    const final = await getItem(b, keep);
    note('U2', `tab A saved without an error: ${(await b.locator('#toasts .toast', { hasText: 'Saved' }).count()) > 0}; final name "${final.custom.name}", color "${final.custom.variantName}"; items with this id ${items.filter((i) => i.id === keep).length}, total ${items.length}`);
    assert.equal(items.filter((i) => i.id === keep).length, 1, 'still one record');
    assert.deepEqual([final.custom.name, final.custom.variantName], ['Name from tab B', 'Color from tab A'], "each tab's change is kept");
    await tabB.close();
  });

  await check('D1', 'Delete: delete an item, then press the browser Back button', async () => {
    const id = await addItem(b, { category: 'sneaker', brand: 'Adidas', name: 'Samba', color: 'White' });
    await openFromList(b, 'Samba');
    await b.click('[data-delete]');
    await sheet(b).locator('[data-confirm]').click();
    await toast(b, 'Deleted');
    await landed(b, /^#\/collection$/);
    for (const press of [1, 2]) {
      await browserBack(b);
      note('D1', `Back press ${press}: ${hash(b)} "${await h1(b).catch(() => '')}"`);
      assert.ok(!(await mainText(b)).includes('Samba') || (await b.locator('main section.state').count()) > 0, 'the deleted item never shows as if it still existed');
    }
    assert.equal((await apiError(b, 'getOwned', { itemId: id }))?.code, 'not_found');
  });

  await check('D2', 'Delete: add the same item twice ("Add another copy"), then delete one copy', async () => {
    const SHOE = { category: 'sneaker', brand: 'Nike', name: 'Air Force 1', color: 'White' };
    const first = await addItem(b, SHOE);
    await openAddForm(b, 'sneaker');
    await fillItem(b, SHOE);
    await addButton(b).click();
    await sheet(b).waitFor();
    note('D2', `duplicate warning: "${(await sheet(b).locator('h2').first().innerText())}"`);
    await sheet(b).locator('[data-dup-add]').click();
    await toast(b, 'Added to your collection');
    await landed(b, /^#\/collection\/[^/?]+$/);
    const second = decodeURIComponent(hash(b).split('/')[2]);
    assert.notEqual(second, first);
    const firstBefore = await getItem(b, first);
    const total = (await owned(b)).length;
    await b.click('[data-delete]');
    await sheet(b).locator('[data-confirm]').click();
    await toast(b, 'Deleted');
    await landed(b, /^#\/collection$/);
    assert.equal((await apiError(b, 'getOwned', { itemId: second }))?.code, 'not_found', 'the copy that was deleted is gone');
    assert.deepEqual(await getItem(b, first), firstBefore, 'the other copy is untouched');
    assert.equal((await owned(b)).length, total - 1);
    assert.equal((await tiles(b)).filter((t) => t.includes('Air Force 1')).length, 1);
  });
  await b.close();
  await breaks.close();

  // ======================= Desktop, dark theme: create and read =======================
  const desk = await openContext({ viewport: DESKTOP, theme: 'dark' });
  const d = await openPage(desk);
  await signUp(d, 'Dana Desktop');

  await check('AC1d', 'Desktop: create a watch and see it in the inventory', async () => {
    ids.desk = await addItem(d, { category: 'watch', brand: 'Timex', name: 'Marlin', color: 'Silver' });
    await go(d, '/collection');
    const shown = await tiles(d);
    assert.equal(shown.length, 1);
    assert.ok(shown[0].includes('Marlin') && shown[0].includes('Timex'));
    await fitsScreen(d, 'desktop collection');
  });

  await check('AC3d', 'Desktop: the item page shows name, category, brand and color', async () => {
    await go(d, `/collection/${ids.desk}`);
    const text = await mainText(d);
    for (const value of ['Timex', 'Marlin', 'Silver']) assert.ok(text.includes(value), value);
    assert.equal((await factsOf(d)).Category, 'Watches');
    await fitsScreen(d, 'desktop item page');
    await shot(d, 'desktop-details');
  });
  await d.close();
  await desk.close();

  assert.deepEqual(problems, [], 'no console errors, page errors, failed requests or outside requests');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
if (problems.length) console.error(`Problems:\n${problems.join('\n')}`);
if (failed.length || problems.length) {
  console.error(`Inventory checks failed: ${failed.map((r) => r.id).join(', ') || 'none'}${problems.length ? `; ${problems.length} problem(s)` : ''}.`);
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log(`Inventory checks passed: ${results.length} checks, no console errors, page errors, failed requests or outside requests.`);
}
