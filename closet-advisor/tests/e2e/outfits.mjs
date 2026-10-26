// Outfits in a real browser. At phone size (light theme) it drives create, read, update and
// delete through the screens, with page reloads to prove IndexedDB keeps each change, plus the
// unexpected things people do (empty forms, duplicate names, double taps, two tabs, archived
// and deleted items, stale addresses, Back while a dialog is open, a big closet). A shorter
// pass runs at desktop size in the dark theme, and one opens a version 1 database to check the
// upgrade keeps what was stored. Each check prints pass/FAIL with its ID (used in
// docs/D08_CRUD_REPORT.md); the run fails on any failed check, console error, page error,
// failed request or request that would leave this machine.
// Usage: node tests/e2e/outfits.mjs [screenshotDir]
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startServer } from '../serve.mjs';
import { STORES } from '../../js/server/db.js';
import { callApi, go, hasHorizontalScroll, signInAs, PHONE, DESKTOP } from './helpers.mjs';

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

/** A browser context with problems collected and every request off this machine refused. */
async function openContext({ viewport = PHONE, theme = 'light' } = {}) {
  const mobile = viewport.width < 600;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: theme, acceptDownloads: true });
  await context.route((u) => u.hostname !== '127.0.0.1', (route) => {
    problems.push(`would leave this machine: ${route.request().url()}`);
    return route.abort();
  });
  return context;
}

async function openPage(context, user = 'usr_demo_alex') {
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
  if (user) await signInAs(page, user);
  return page;
}

const ready = (page) => page.waitForSelector('html[data-ready="true"]', { timeout: 20000 });
const hash = (page) => new URL(page.url()).hash;
const h1 = (page) => page.locator('main h1').first().innerText();
const mainText = (page) => page.locator('main').innerText();
const sheet = (page) => page.locator('dialog.sheet[open]');
const submit = (page) => page.locator('[data-outfit-form] [type="submit"]');
const choice = (page, text) => page.locator('[data-outfit-form] .choice', { hasText: text });
const checkedIds = (page) => page.$$eval('[data-outfit-form] input[name="itemIds"]:checked', (els) => els.map((el) => el.value));
const fieldError = (page, name) => page.locator(`.field-error[data-for="${name}"]`);
const listOutfits = async (page, args = {}) => callApi(page, 'listOutfits', args);
const byName = async (page, name) => (await listOutfits(page)).outfits.find((o) => o.name === name);

async function shot(page, name) {
  if (shotDir) await page.screenshot({ path: `${shotDir}/outfits-${name}.png`, fullPage: true });
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
 * Controls and headings in the main area that stick out past the viewport. body has
 * overflow-x: hidden, so scrollWidth alone can't see clipped content.
 */
const clipped = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('main a, main button, main input, main textarea, main h1, main h2, main .outfit-card, main .choice, main .tile, main .tabs, main .notice')) {
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

/** The open dialog and its text fit inside the viewport. */
async function dialogFits(page, where) {
  const out = await page.evaluate(() => {
    const dialog = document.querySelector('dialog.sheet[open]');
    const box = dialog.getBoundingClientRect();
    const wide = [...dialog.querySelectorAll('p, h2, button')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.slice(0, 30));
    return { inside: box.left >= -1 && box.right <= window.innerWidth + 1, wide };
  });
  assert.deepEqual(out, { inside: true, wide: [] }, `the dialog fits: ${where}`);
}

/** Fills the outfit form: name, then clicks each item row by its text. */
async function fillOutfit(page, { name, items = [] }) {
  if (name != null) await page.fill('#f-name', name);
  for (const text of items) await choice(page, text).click();
}

// Item rows are matched by their label text; these are Alex's demo items.
const JACKET = 'Deck Field Jacket';
const TROUSERS = 'Wool Trouser';
const SNEAKER = 'Vela Court Low';
const WATCH = 'Arden Field';

try {
  // ======================= Phone, light theme =======================
  const phone = await openContext();
  const page = await openPage(phone);
  const owned = (await callApi(page, 'listOwned', {})).items;
  const item = (title) => owned.find((i) => `${i.brandName} ${i.title}`.includes(title));
  const ids = {};

  // ---------- Read: nothing saved yet ----------
  await check('BR1', 'Open Outfits with no outfits saved: empty state with a next step', async () => {
    await go(page, '/collection');
    await page.click('nav.tabs a[href="#/outfits"]');
    await landed(page, /^#\/outfits$/);
    assert.equal(await h1(page), 'Outfits');
    assert.match(await page.locator('nav.tabs a[aria-current="page"]').innerText(), /Outfits\s*0/);
    assert.equal(await page.locator('[data-tab="collection"][aria-current="page"]').count(), 1, 'the Collection tab stays current');
    assert.equal(await page.locator('section.state h2').innerText(), 'No outfits yet');
    assert.equal(await page.locator('section.state a[href="#/outfits/new"]').innerText(), 'Build an outfit');
    await fitsScreen(page, 'empty outfits');
    await shot(page, 'empty');
  });

  await check('BR2', 'A brand-new account with no items: told to add items first, no form', async () => {
    const fresh = await openPage(phone, null);
    await fresh.evaluate(async () => {
      const client = await import('./js/client.js');
      client.setSession(await client.api.signUp({ email: 'new.person@example.com', password: 'correct horse', displayName: 'New Person' }));
    });
    await go(fresh, '/outfits');
    assert.equal(await fresh.locator('section.state h2').innerText(), 'Add a few items first');
    assert.equal(await fresh.locator('a[href="#/outfits/new"]').count(), 0, 'no New outfit button');
    await go(fresh, '/outfits/new');
    assert.equal(await fresh.locator('[data-outfit-form]').count(), 0, 'no form that cannot succeed');
    assert.equal(await fresh.locator('section.state a[href^="#/add"]').count(), 1);
    await fresh.close();
    // The new account's session replaced Alex's in this browser; sign Alex back in.
    await signInAs(page, 'usr_demo_alex', '/outfits');
  });

  // ---------- Create ----------
  await check('BC1', 'Submit the empty form: an error on each field, nothing saved', async () => {
    await go(page, '/outfits/new');
    await submit(page).click();
    await fieldError(page, 'name').waitFor();
    assert.equal(await fieldError(page, 'name').innerText(), 'Enter a name for this outfit');
    assert.equal(await page.getAttribute('#f-name', 'aria-invalid'), 'true');
    assert.equal(await page.getAttribute('#f-name', 'aria-describedby'), 'err-name');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'f-name', 'focus moves to the first problem');
    assert.equal(await fieldError(page, 'itemIds').innerText(), 'Choose at least two items');
    const placement = await page.$eval('.field-error[data-for="itemIds"]', (el) => ({
      inChoice: Boolean(el.closest('.choice')),
      afterHint: el.previousElementSibling?.matches('[data-outfit-hint]'),
      describes: el.closest('fieldset').getAttribute('aria-describedby'),
    }));
    assert.deepEqual(placement, { inChoice: false, afterHint: true, describes: 'err-itemIds' });
    // The first error must be on screen, not under the sticky header or below the fold.
    await page.waitForTimeout(200);
    const first = await page.evaluate(() => {
      const head = document.querySelector('.back-head').getBoundingClientRect().bottom;
      const box = document.querySelector('.field-error').getBoundingClientRect();
      return { belowHeader: box.top >= head, aboveFold: box.bottom <= window.innerHeight - 64 };
    });
    assert.deepEqual(first, { belowHeader: true, aboveFold: true }, 'the first error is visible');
    assert.equal((await listOutfits(page)).total, 0);
    await shot(page, 'empty-form-errors');
  });

  await check('BC2', 'Type a name and press Enter before choosing items: only the items error, nothing saved', async () => {
    await page.fill('#f-name', 'Weekend errands');
    await page.press('#f-name', 'Enter');
    await page.waitForFunction(() => !document.querySelector('.field-error[data-for="name"]'));
    assert.equal(await fieldError(page, 'itemIds').innerText(), 'Choose at least two items');
    assert.equal((await listOutfits(page)).total, 0);
  });

  await check('C3', 'Create a valid outfit: saved, confirmed and opened', async () => {
    await fillOutfit(page, { items: [JACKET, TROUSERS, SNEAKER] });
    assert.equal(await page.locator('[data-outfit-count]').innerText(), '3 chosen');
    await submit(page).click();
    await toast(page, 'Outfit saved');
    await landed(page, /^#\/outfits\/fit_[a-z0-9]+$/);
    assert.equal(await h1(page), 'Weekend errands');
    assert.equal(await page.locator('main .tile').count(), 3);
    ids.weekend = hash(page).split('/')[2];
    const stored = await callApi(page, 'getOutfit', { outfitId: ids.weekend });
    assert.deepEqual([...stored.itemIds].sort(), [item(JACKET).id, item(TROUSERS).id, item(SNEAKER).id].sort());
    assert.equal(stored.itemIds[2], item(SNEAKER).id, 'saved head to toe: clothes, then shoes');
    await shot(page, 'created');
  });

  await check('BC3', 'Reuse that name with different capitals and spaces: refused, nothing saved', async () => {
    await go(page, '/outfits/new');
    await fillOutfit(page, { name: '  WEEKEND   errands ', items: [SNEAKER, WATCH] });
    await submit(page).click();
    await fieldError(page, 'name').waitFor();
    assert.equal(await fieldError(page, 'name').innerText(), 'You already have an outfit with this name');
    assert.equal((await listOutfits(page)).total, 1);
  });

  await check('BC4', 'Double-click Save: exactly one outfit, no error', async () => {
    await go(page, '/outfits/new');
    await fillOutfit(page, { name: 'Office', items: [TROUSERS, WATCH] });
    await submit(page).dblclick();
    await landed(page, /^#\/outfits\/fit_[a-z0-9]+$/);
    await page.waitForTimeout(500);
    assert.equal((await listOutfits(page)).outfits.filter((o) => o.name === 'Office').length, 1);
    assert.equal(await fieldError(page, 'name').count(), 0);
    ids.office = hash(page).split('/')[2];
  });

  await check('BC5', 'Put HTML in the name: saved and shown as plain text, nothing runs', async () => {
    const name = '<img src=x onerror=alert(1)>';
    await go(page, '/outfits/new');
    await fillOutfit(page, { name, items: [JACKET, SNEAKER] });
    await submit(page).click();
    await landed(page, /^#\/outfits\/fit_[a-z0-9]+$/);
    assert.equal(await h1(page), name);
    ids.html = hash(page).split('/')[2];
    await go(page, '/outfits');
    assert.ok((await mainText(page)).includes(name));
    assert.equal(await page.locator('main img[src="x"]').count(), 0, 'no image element was created from the name');
  });

  await check('BC6', 'Type past the 60-character limit, with no spaces: stops at 60 and the screens still fit', async () => {
    await go(page, '/outfits/new');
    await page.locator('#f-name').pressSequentially('W'.repeat(61), { delay: 0 });
    assert.equal((await page.inputValue('#f-name')).length, 60, 'the field stops at 60 characters');
    await fillOutfit(page, { items: [JACKET, WATCH] });
    await submit(page).click();
    await landed(page, /^#\/outfits\/fit_[a-z0-9]+$/);
    ids.long = hash(page).split('/')[2];
    await fitsScreen(page, 'detail with a 60-character name');
    await page.click('[data-delete-outfit]');
    await sheet(page).waitFor();
    await dialogFits(page, 'delete confirmation quoting a 60-character name');
    await sheet(page).locator('button', { hasText: 'Cancel' }).click();
    await sheet(page).waitFor({ state: 'detached' });
    await go(page, '/outfits');
    await fitsScreen(page, 'list with a 60-character name');
    await go(page, `/collection/${item(JACKET).id}`);
    await fitsScreen(page, 'item page listing a 60-character outfit name');
    // The limit holds when the screen is skipped, too.
    const error = await apiError(page, 'createOutfit', { name: 'X'.repeat(61), itemIds: [item(JACKET).id, item(WATCH).id], idempotencyKey: 'too-long' });
    assert.deepEqual([error.code, error.fields.name], ['invalid', 'Use 60 characters or fewer']);
  });

  // ---------- Read ----------
  await check('BR3', 'Refresh after adding outfits: all four are still there, newest change first', async () => {
    await reload(page);
    await go(page, '/outfits');
    assert.equal(await page.evaluate(async () => (await import('./js/client.js')).storageKind()), 'indexeddb');
    const names = await page.locator('.outfit-card-name').allInnerTexts();
    assert.deepEqual(names, ['W'.repeat(60), '<img src=x onerror=alert(1)>', 'Office', 'Weekend errands']);
    assert.match(await page.locator('.outfit-card').last().innerText(), /3 items/);
    assert.equal(await page.locator('.outfit-card').last().locator('.outfit-mosaic > span').count(), 3, 'one thumbnail per item');
    await shot(page, 'list');
  });

  await check('BR4', 'An item page lists its outfits and starts a new one with that item chosen', async () => {
    await go(page, `/collection/${item(JACKET).id}`);
    const section = page.locator('main section', { has: page.locator('h2', { hasText: /^Outfits$/ }) });
    assert.match(await section.innerText(), /Weekend errands/);
    await section.locator('a', { hasText: 'Build an outfit with this' }).click();
    await landed(page, /^#\/outfits\/new\?item=/);
    assert.deepEqual(await checkedIds(page), [item(JACKET).id]);
    assert.equal(await page.locator('[data-outfit-count]').innerText(), '1 chosen. Choose one more.');
  });

  await check('BR5', "Open another person's outfit address: not found, nothing of it shown", async () => {
    await signInAs(page, 'usr_demo_sam', `/outfits/${ids.weekend}`);
    assert.equal(await h1(page), 'Outfit not found');
    assert.ok(!(await mainText(page)).includes('Weekend errands'));
    await go(page, '/outfits');
    assert.equal(await page.locator('section.state h2').innerText(), 'No outfits yet', "Sam sees none of Alex's outfits");
    await signInAs(page, 'usr_demo_alex', '/outfits');
  });

  await check('BR6', 'Open a bookmarked outfit while signed out: sign in, then land on it', async () => {
    await page.evaluate(async () => (await import('./js/client.js')).signOut());
    await go(page, `/outfits/${ids.weekend}`);
    assert.match(hash(page), /^#\/welcome\?next=/);
    await page.click('[data-demo="usr_demo_alex"]');
    await landed(page, new RegExp(`^#/outfits/${ids.weekend}$`));
    assert.equal(await h1(page), 'Weekend errands');
  });

  await check('BR7', 'Hand-edit the address with a stray % sign: the not-found screen, no crash', async () => {
    const before = problems.length;
    await go(page, '/outfits/%');
    assert.equal(await h1(page), 'Outfit not found');
    assert.deepEqual(problems.slice(before), [], 'no page error');
  });

  await check('BR8', 'A stylist opens the Outfits address: sent to the stylist workspace', async () => {
    await signInAs(page, 'usr_demo_jordan', '/outfits');
    assert.equal(hash(page), '#/stylist');
    await signInAs(page, 'usr_demo_alex', '/outfits');
  });

  // ---------- Update ----------
  await check('BU1', 'Open Edit: the form shows the current name, items and notes', async () => {
    await go(page, `/outfits/${ids.weekend}`);
    await page.click('main a[aria-label="Edit outfit"]');
    await landed(page, /\/edit$/);
    assert.equal(await page.inputValue('#f-name'), 'Weekend errands');
    assert.deepEqual((await checkedIds(page)).sort(), [item(JACKET).id, item(TROUSERS).id, item(SNEAKER).id].sort());
    assert.equal(await page.inputValue('#f-notes'), '');
  });

  await check('BU2', 'Change it to invalid data (blank name, one item): errors, and after a refresh nothing changed', async () => {
    const before = await callApi(page, 'getOutfit', { outfitId: ids.weekend });
    await page.fill('#f-name', '   ');
    await choice(page, TROUSERS).click();
    await choice(page, SNEAKER).click();
    await submit(page).click();
    await fieldError(page, 'name').waitFor();
    assert.equal(await fieldError(page, 'name').innerText(), 'Enter a name for this outfit');
    assert.equal(await fieldError(page, 'itemIds').innerText(), 'Choose at least two items');
    await reload(page);
    assert.deepEqual(await callApi(page, 'getOutfit', { outfitId: ids.weekend }), before);
    await go(page, `/outfits/${ids.weekend}`);
    assert.equal(await h1(page), 'Weekend errands');
  });

  await check('BU3', 'Edit the same outfit three times in a row, then refresh: the last edit stays', async () => {
    const edit = async (fn) => {
      await go(page, `/outfits/${ids.weekend}/edit`);
      await fn();
      await submit(page).click();
      await toast(page, 'Saved');
      await landed(page, new RegExp(`^#/outfits/${ids.weekend}$`));
    };
    await edit(() => page.fill('#f-name', 'Weekend errands, rain'));
    assert.equal(await h1(page), 'Weekend errands, rain');
    await edit(async () => {
      await choice(page, WATCH).click();
      await page.fill('#f-notes', 'Bring the umbrella');
    });
    assert.equal(await page.locator('main .tile').count(), 4);
    await edit(async () => {
      await page.fill('#f-name', 'Rainy weekend');
      await choice(page, SNEAKER).click();
    });
    await reload(page);
    assert.equal(await h1(page), 'Rainy weekend');
    assert.equal(await page.locator('main .tile').count(), 3);
    assert.match(await mainText(page), /Bring the umbrella/);
    await go(page, '/outfits');
    assert.equal(await page.locator('.outfit-card-name').first().innerText(), 'Rainy weekend', 'the edited outfit moves to the top');
  });

  await check('BU4', "Rename to another outfit's name (refused), then change only the capitals (saved)", async () => {
    await go(page, `/outfits/${ids.weekend}/edit`);
    await page.fill('#f-name', 'office');
    await submit(page).click();
    await fieldError(page, 'name').waitFor();
    assert.equal(await fieldError(page, 'name').innerText(), 'You already have an outfit with this name');
    await page.fill('#f-name', 'RAINY WEEKEND');
    await submit(page).click();
    await toast(page, 'Saved');
    await landed(page, new RegExp(`^#/outfits/${ids.weekend}$`));
    assert.equal(await h1(page), 'RAINY WEEKEND');
  });

  await check('BU5', 'Cancel an edit, and press Back after saving: nothing reopens the form', async () => {
    await go(page, '/outfits');
    await page.locator('.outfit-card', { hasText: 'RAINY WEEKEND' }).click();
    await landed(page, new RegExp(`^#/outfits/${ids.weekend}$`));
    await page.click('main a[aria-label="Edit outfit"]');
    await landed(page, /\/edit$/);
    await page.fill('#f-name', 'Should not be saved');
    await page.click('[data-outfit-form] a', { hasText: 'Cancel' });
    await landed(page, new RegExp(`^#/outfits/${ids.weekend}$`));
    assert.equal(await h1(page), 'RAINY WEEKEND');
    await page.click('main a[aria-label="Edit outfit"]');
    await landed(page, /\/edit$/);
    await page.fill('#f-notes', 'Bring the umbrella and boots');
    await submit(page).click();
    await toast(page, 'Saved');
    await landed(page, new RegExp(`^#/outfits/${ids.weekend}$`));
    await page.goBack();
    await landed(page, /^#\/outfits$/);
  });

  await check('BU11', 'Open the edit form from a bookmark, Cancel, press Back into the form and save: lands on the outfit, stays in the app', async () => {
    // Like a bookmark: the history entry behind the form is some other page, not the outfit.
    await go(page, '/collection');
    await go(page, '/wishlist');
    await page.evaluate((id) => history.replaceState(null, '', `#/outfits/${id}/edit`), ids.weekend);
    await reload(page);
    await page.click('[data-outfit-form] a', { hasText: 'Cancel' });
    await landed(page, new RegExp(`^#/outfits/${ids.weekend}$`));
    await page.goBack();
    await landed(page, /\/edit$/);
    await page.fill('#f-notes', 'Bookmarked edit');
    await submit(page).click();
    await toast(page, 'Saved');
    await landed(page, new RegExp(`^#/outfits/${ids.weekend}$`));
    assert.ok(page.url().startsWith(url), 'still in the app');
    assert.match(await mainText(page), /Bookmarked edit/);
  });

  await check('BU9', "Two tabs: one changes an outfit's items while the other renames it; the rename keeps those items", async () => {
    await go(page, `/outfits/${ids.office}/edit`);
    const other = await openPage(phone, null);
    await go(other, '/outfits');
    await callApi(other, 'updateOutfit', { outfitId: ids.office, patch: { itemIds: [item(TROUSERS).id, item(WATCH).id, item(JACKET).id] } });
    await other.close();
    await page.fill('#f-name', 'Office, Mondays');
    await submit(page).click();
    await toast(page, 'Saved');
    await landed(page, new RegExp(`^#/outfits/${ids.office}$`));
    const now = await callApi(page, 'getOutfit', { outfitId: ids.office });
    assert.equal(now.name, 'Office, Mondays');
    assert.deepEqual([...now.itemIds].sort(), [item(TROUSERS).id, item(WATCH).id, item(JACKET).id].sort(), "the other tab's item change was not overwritten");
  });

  await check('BU6', 'Two tabs: an item is deleted in one while the other is adding to the outfit', async () => {
    await go(page, `/outfits/${ids.weekend}/edit`);
    const other = await openPage(phone, null);
    await go(other, '/collection');
    await callApi(other, 'deleteOwned', { itemId: item(TROUSERS).id });
    await other.close();
    await choice(page, SNEAKER).click();
    await submit(page).click();
    await fieldError(page, 'itemIds').waitFor();
    assert.equal(await fieldError(page, 'itemIds').innerText(), 'Choose again: some of these items are no longer in your collection');
    assert.equal(await choice(page, TROUSERS).count(), 0, 'the deleted item is taken off the list');
    assert.equal(await page.locator('[data-outfit-count]').innerText(), '3 chosen');
    await submit(page).click();
    await toast(page, 'Saved');
    const now = await callApi(page, 'getOutfit', { outfitId: ids.weekend });
    assert.deepEqual(now.itemIds.sort(), [item(JACKET).id, item(SNEAKER).id, item(WATCH).id].sort());
  });

  await check('BU7', 'Archive an item in an outfit, then rename the outfit: the item stays in it', async () => {
    await callApi(page, 'archiveOwned', { itemId: item(WATCH).id });
    await go(page, `/outfits/${ids.weekend}/edit`);
    assert.match(await choice(page, WATCH).innerText(), /archived/);
    assert.ok(await choice(page, WATCH).locator('input').isChecked());
    await page.fill('#f-name', 'Rainy weekend, archived watch');
    await submit(page).click();
    await toast(page, 'Saved');
    await landed(page, new RegExp(`^#/outfits/${ids.weekend}$`));
    await reload(page);
    const now = await callApi(page, 'getOutfit', { outfitId: ids.weekend });
    assert.ok(now.itemIds.includes(item(WATCH).id));
    assert.equal(await page.locator('main .tile .label.is-archived').count(), 1);
  });

  await check('BU8', 'A big closet: the filter narrows the list, Enter there does not save, and a 13th item is refused', async () => {
    for (let i = 1; i <= 11; i += 1) {
      await callApi(page, 'createOwned', { source: 'manual', category: 'clothing', custom: { brand: 'Studio Nine', name: `Tee ${i}` }, idempotencyKey: `tee-${i}` });
    }
    await go(page, '/outfits/new');
    await page.fill('#f-name', 'Everything');
    await page.fill('[data-outfit-find]', 'tee 1');
    assert.equal(await page.locator('[data-outfit-form] .choice:not([hidden])').count(), 3, 'Tee 1, Tee 10 and Tee 11');
    await choice(page, 'Tee 10').click();
    await page.press('[data-outfit-find]', 'Enter');
    await page.waitForTimeout(300);
    assert.match(hash(page), /^#\/outfits\/new$/, 'Enter in the filter did not save');
    // An item error while the filter hides the first item: focus stays in the list.
    await page.fill('[data-outfit-find]', 'jacket');
    await submit(page).click();
    await fieldError(page, 'itemIds').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.choice')?.textContent.includes('Deck Field Jacket') ?? false), true, 'focus moved to the first item still shown');
    await page.fill('[data-outfit-find]', 'zzz');
    assert.equal(await page.locator('[data-outfit-none]').isVisible(), true);
    await page.fill('[data-outfit-find]', '');
    assert.equal(await page.locator('[data-outfit-form] .choice:not([hidden])').count(), 13);
    assert.ok(await choice(page, 'Tee 10').locator('input').isChecked(), 'a hidden choice stayed chosen');
    for (const row of await page.locator('[data-outfit-form] .choice').all()) {
      const box = row.locator('input');
      if (!(await box.isChecked())) await row.click();
    }
    await toast(page, 'Choose up to 12 items');
    assert.equal((await checkedIds(page)).length, 12);
    await submit(page).click();
    await landed(page, /^#\/outfits\/fit_[a-z0-9]+$/);
    assert.equal(await page.locator('main h2').first().innerText(), '12 items');
    ids.everything = hash(page).split('/')[2];
    await go(page, '/outfits');
    const card = page.locator('.outfit-card', { hasText: 'Everything' });
    assert.equal(await card.locator('.outfit-mosaic > span').count(), 4, 'at most four thumbnails');
    assert.equal(await card.locator('.outfit-more').innerText(), '+8', 'the last one counts the rest');
  });

  await check('X2', 'Build an outfit with the keyboard only', async () => {
    await go(page, '/outfits/new');
    await page.focus('#f-name');
    await page.keyboard.type('Keyboard only');
    await page.keyboard.press('Tab'); // the filter box
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    assert.equal((await checkedIds(page)).length, 2);
    for (let i = 0; i < 40 && !(await page.evaluate(() => document.activeElement?.matches('[data-outfit-form] [type="submit"]'))); i += 1) await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await landed(page, /^#\/outfits\/fit_[a-z0-9]+$/);
    assert.equal(await h1(page), 'Keyboard only');
  });

  // ---------- Delete ----------
  await check('BD1', 'Cancel a deletion three ways (Cancel, Escape, tapping outside): the outfit stays', async () => {
    await go(page, `/outfits/${ids.office}`);
    for (const how of ['button', 'escape', 'backdrop']) {
      await page.click('[data-delete-outfit]');
      await sheet(page).waitFor();
      assert.match(await sheet(page).innerText(), /The items in it stay in your collection/);
      assert.ok(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog'))), 'focus is inside the dialog');
      if (how === 'button') await sheet(page).locator('button', { hasText: 'Cancel' }).click();
      if (how === 'escape') await page.keyboard.press('Escape');
      if (how === 'backdrop') await page.mouse.click(10, 10);
      await sheet(page).waitFor({ state: 'detached' });
      assert.equal((await callApi(page, 'getOutfit', { outfitId: ids.office })).name, 'Office, Mondays', `still there after cancelling by ${how}`);
    }
  });

  await check('BD2', 'Confirm a deletion: gone from the list, its items stay', async () => {
    const itemsBefore = (await callApi(page, 'listOwned', {})).collectionTotal;
    await go(page, '/outfits');
    assert.ok((await page.locator('.outfit-card-name').allInnerTexts()).includes('Office, Mondays'), 'listed before deleting');
    await go(page, `/outfits/${ids.office}`);
    await page.click('[data-delete-outfit]');
    await sheet(page).locator('[data-confirm]').click();
    await toast(page, 'Outfit deleted');
    await landed(page, /^#\/outfits$/);
    assert.ok(!(await page.locator('.outfit-card-name').allInnerTexts()).includes('Office, Mondays'), 'gone from the list');
    assert.equal((await apiError(page, 'getOutfit', { outfitId: ids.office })).code, 'not_found');
    assert.equal((await callApi(page, 'listOwned', {})).collectionTotal, itemsBefore);
  });

  await check('BD3', 'Refresh after deleting, then open its old address and its edit address: stays gone', async () => {
    await reload(page);
    assert.equal(await byName(page, 'Office, Mondays'), undefined);
    await go(page, `/outfits/${ids.office}`);
    assert.equal(await h1(page), 'Outfit not found');
    await go(page, `/outfits/${ids.office}/edit`);
    assert.equal(await h1(page), 'Outfit not found');
    assert.equal(await page.locator('[data-outfit-form]').count(), 0);
  });

  await check('BD4', 'Delete a closet item that is in outfits: the warning says so, and an outfit left with one item is flagged', async () => {
    const holding = (await listOutfits(page, { itemId: item(SNEAKER).id })).outfits.length;
    await go(page, `/collection/${item(SNEAKER).id}`);
    await page.click('[data-delete]');
    await sheet(page).waitFor();
    assert.ok(holding >= 2, `the sneaker is in ${holding} outfits`);
    assert.match(await sheet(page).innerText(), new RegExp(`taken out of ${holding} outfits\\.`));
    await sheet(page).locator('[data-confirm]').click();
    await landed(page, /^#\/collection$/);
    await go(page, `/outfits/${ids.html}`);
    assert.match(await mainText(page), /Only one item is left in this outfit/);
    await go(page, '/outfits');
    assert.match(await page.locator('.outfit-card', { hasText: '<img src=x' }).innerText(), /Needs another item/);
  });

  await check('BU10', 'Rename an outfit that is down to one item: saved, and it keeps its one item', async () => {
    await go(page, `/outfits/${ids.html}/edit`);
    await page.fill('#f-name', 'Jacket only for now');
    await submit(page).click();
    await toast(page, 'Saved');
    await landed(page, new RegExp(`^#/outfits/${ids.html}$`));
    const now = await callApi(page, 'getOutfit', { outfitId: ids.html });
    assert.deepEqual([now.name, now.itemCount, now.incomplete], ['Jacket only for now', 1, true]);
  });

  await check('BD5', 'Press Back while the delete confirmation is open: the dialog closes and nothing is deleted', async () => {
    const cameFrom = hash(page);
    await go(page, `/outfits/${ids.long}`);
    await page.click('[data-delete-outfit]');
    await sheet(page).waitFor();
    await page.goBack();
    await page.waitForFunction((h) => location.hash === h, cameFrom, { timeout: 8000 });
    await page.waitForTimeout(300);
    assert.equal(await sheet(page).count(), 0, 'the dialog closed with the page it belonged to');
    assert.ok(await callApi(page, 'getOutfit', { outfitId: ids.long }));
  });

  await check('BD6', 'Delete in one tab, then press Edit in the other: not found, no crash', async () => {
    await go(page, `/outfits/${ids.long}`);
    const other = await openPage(phone, null);
    await callApi(other, 'deleteOutfit', { outfitId: ids.long });
    await other.close();
    await page.click('main a[aria-label="Edit outfit"]');
    await landed(page, /\/edit$/);
    assert.equal(await h1(page), 'Outfit not found');
  });

  // ---------- Across all four ----------
  await check('X1', 'Every outfit screen fits a 390 px phone', async () => {
    for (const route of ['/outfits', '/outfits/new', `/outfits/${ids.everything}`, `/outfits/${ids.everything}/edit`, '/collection', `/collection/${item(JACKET).id}`]) {
      await go(page, route);
      await fitsScreen(page, route);
    }
    await go(page, `/outfits/${ids.everything}`);
    await shot(page, 'detail');
  });

  await check('X3', 'Export my data includes the outfits; Reset demo data clears them', async () => {
    await go(page, '/profile/privacy');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-export]')]);
    const data = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(data.outfits.length, (await listOutfits(page)).total);
    assert.ok(data.outfits.some((o) => o.name === 'Everything'));
    await go(page, '/profile');
    await page.click('[data-reset]');
    await Promise.all([page.waitForEvent('load'), sheet(page).locator('[data-confirm]').click()]);
    await ready(page);
    await signInAs(page, 'usr_demo_alex', '/outfits');
    assert.equal((await listOutfits(page)).total, 0);
  });
  await phone.close();

  // ======================= Desktop, dark theme =======================
  const desk = await openContext({ viewport: DESKTOP, theme: 'dark' });
  const dpage = await openPage(desk);
  await check('X1d', 'Desktop, dark theme: build, view and delete an outfit; the screens fit and use the dark colors', async () => {
    await go(dpage, '/outfits/new');
    await fillOutfit(dpage, { name: 'Desk check', items: [JACKET, TROUSERS] });
    await submit(dpage).click();
    await landed(dpage, /^#\/outfits\/fit_[a-z0-9]+$/);
    await fitsScreen(dpage, 'desktop detail');
    const id = hash(dpage).split('/')[2];
    await go(dpage, '/outfits');
    await fitsScreen(dpage, 'desktop list');
    const background = await dpage.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const [r, g, b] = background.match(/\d+/g).map(Number);
    assert.ok(r + g + b < 200, `dark page background, got ${background}`);
    await shot(dpage, 'desktop-dark');
    await go(dpage, `/outfits/${id}`);
    await dpage.click('[data-delete-outfit]');
    await sheet(dpage).locator('[data-confirm]').click();
    await landed(dpage, /^#\/outfits$/);
    assert.equal((await listOutfits(dpage)).total, 0);
  });
  await desk.close();

  // ======================= Upgrade from a version 1 database =======================
  await check('X6', 'A browser with a version 1 database upgrades to version 2 and keeps what it had', async () => {
    const old = await openContext();
    const page1 = await old.newPage();
    page1.on('pageerror', (err) => problems.push(`pageerror: ${err.message} (${page1.url()})`));
    // Any same-origin page will do to create the old database before the app ever runs.
    await page1.goto(`${url}api/status.json`);
    const v1Stores = Object.entries(STORES).filter(([name]) => name !== 'outfits');
    await page1.evaluate(
      (stores) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('rotation-prototype', 1);
          request.onupgradeneeded = () => {
            for (const [name, def] of stores) {
              const os = request.result.createObjectStore(name, { keyPath: def.key });
              for (const index of def.indexes) os.createIndex(index, index, { unique: false });
            }
          };
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('ownedItems', 'readwrite');
            // A non-demo person's item: the demo seed never touches it.
            tx.objectStore('ownedItems').put({ id: 'own_kept_through_upgrade', userId: 'usr_someone', category: 'clothing', createdAt: '2026-10-01T00:00:00.000Z' });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          request.onerror = () => reject(request.error);
        }),
      v1Stores,
    );
    await page1.goto(`${url}#/welcome`);
    await ready(page1);
    const after = await page1.evaluate(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.open('rotation-prototype');
          request.onsuccess = () => {
            const db = request.result;
            const get = db.transaction('ownedItems').objectStore('ownedItems').get('own_kept_through_upgrade');
            get.onsuccess = () => {
              resolve({ version: db.version, hasOutfits: db.objectStoreNames.contains('outfits'), kept: Boolean(get.result) });
              db.close();
            };
          };
        }),
    );
    assert.deepEqual(after, { version: 2, hasOutfits: true, kept: true });
    assert.equal(await page1.evaluate(async () => (await import('./js/client.js')).storageKind()), 'indexeddb', 'no fallback to memory');
    await old.close();
  });

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
  console.error(`Outfit checks failed: ${failed.map((r) => r.id).join(', ') || 'none'}${problems.length ? `; ${problems.length} problem(s)` : ''}.`);
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log(`Outfit checks passed: ${results.length} checks, no console errors, page errors, failed requests or outside requests.`);
}
