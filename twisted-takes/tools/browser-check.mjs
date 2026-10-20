// Twisted Takes: browser checks against the built site, served the way
// GitHub Pages serves it (under the base path, with 404.html for unknown URLs).
//
//   bundle exec jekyll build
//   cd tools && npm install && npx playwright install chromium
//   node browser-check.mjs                     # uses baseurl from _config.yml
//   node browser-check.mjs --baseurl ""        # after building with --baseurl ""
//   node browser-check.mjs --screenshots shots # also save page screenshots
//
// Checks navigation, direct article loads, search, combined filters, sorting,
// URL state, clear filters, the TV empty state, copy-link feedback, the mobile
// menu, keyboard skip link, no-JavaScript rendering, the 404 page, horizontal
// overflow at phone and desktop widths, console errors, and that no analytics
// request is made while no Measurement ID is configured.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, '..');
const siteDir = join(site, '_site');
const require = createRequire(process.env.PLAYWRIGHT_FROM || join(here, 'package.json'));
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const config = readFileSync(join(site, '_config.yml'), 'utf8');
const configBase = (config.match(/^baseurl:\s*"?([^"\n#]*)"?/m) || [])[1] || '';
const base = (arg('--baseurl') ?? configBase).trim().replace(/\/$/, '');
const shotDir = arg('--screenshots');
const expectAnalytics = args.includes('--expect-analytics');
if (shotDir) mkdirSync(resolve(process.cwd(), shotDir), { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain' };

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const send = (file, status = 200) => {
    res.writeHead(status, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  };
  const notFound = () => send(join(siteDir, '404.html'), 404);
  if (base && !(path === base || path.startsWith(base + '/'))) return notFound();
  let rel = path.slice(base.length) || '/';
  if (path === base) { res.writeHead(301, { location: base + '/' }); return res.end(); }
  let file = join(siteDir, rel);
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!rel.endsWith('/')) { res.writeHead(301, { location: path + '/' }); return res.end(); }
    file = join(file, 'index.html');
  }
  if (!existsSync(file) && existsSync(file + '.html')) file += '.html';
  if (!existsSync(file) || statSync(file).isDirectory()) return notFound();
  send(file);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const u = (p) => origin + base + p;

// Expected counts come from the built search index, so adding reviews later does not break the checks.
const index = JSON.parse(readFileSync(join(siteDir, 'search.json'), 'utf8'));
const reviewsIn = (genre, type) => index.filter((d) => d.kind === 'review' && (!genre || d.genre === genre) && (!type || d.media_type === type)).length;
const collectionCount = index.filter((d) => d.kind === 'collection').length;
const hex = ((readFileSync(join(site, 'assets/css/main.css'), 'utf8').match(/--color-bg:\s*#([0-9a-f]{6})/i) || [])[1] || 'FAF9F6');
const BG = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err.message.split('\n')[0] });
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const browser = await chromium.launch();
const consoleErrors = [];
const analyticsRequests = [];
async function newContext(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  ctx.on('request', (req) => { if (/google-analytics|googletagmanager/.test(req.url())) analyticsRequests.push(req.url()); });
  return ctx;
}
async function open(ctx, path, opts = {}) {
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // The 404 check requests a missing page on purpose; that one 404 is expected.
    if (opts.expect404 && /status of 404/.test(msg.text())) return;
    consoleErrors.push(`${path}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => consoleErrors.push(`${path}: ${err.message}`));
  const response = await page.goto(u(path), { waitUntil: 'networkidle' });
  return { page, response };
}
async function noOverflow(page, label) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert(scroll <= client, `${label}: horizontal overflow (${scroll}px content in ${client}px viewport)`);
}
async function shot(page, name) {
  if (shotDir) await page.screenshot({ path: resolve(process.cwd(), shotDir, name + '.png'), fullPage: true });
}

const desktop = await newContext({ permissions: ['clipboard-read', 'clipboard-write'] });

await check('Home: 5 genre sections with every movie, featured link and current nav', async () => {
  const { page, response } = await open(desktop, '/');
  assert(response.status() === 200, `status ${response.status()}`);
  assert(await page.locator('.home-genre').count() === 5, 'expected 5 genre sections');
  const cards = await page.locator('.home-genre .card').count();
  assert(cards === reviewsIn(null, 'movie'), `expected ${reviewsIn(null, 'movie')} movie cards, found ${cards}`);
  for (const section of await page.locator('.home-genre').all()) {
    const n = await section.locator('.card').count();
    assert(n >= 4, 'a genre section has fewer than 4 cards');
  }
  assert(await page.locator('.site-nav [aria-current="page"]').textContent() === 'Home', 'Home not marked current');
  const featured = page.locator('.featured__title a');
  assert(await featured.count() === 1, 'no featured article link');
  const href = await featured.getAttribute('href');
  assert(href.startsWith(base + '/'), `featured link misses base path: ${href}`);
  const r = await page.request.get(origin + href);
  assert(r.status() === 200, `featured article returned ${r.status()}`);
  assert(await page.locator('.recent .article-card').count() >= 2, 'recent articles missing');
  const css = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert(css === BG, `stylesheet not applied (body background ${css})`);
  await noOverflow(page, 'home');
  await shot(page, 'home-desktop');
  await page.close();
});

await check('Every card link on the home page loads its own review page', async () => {
  const { page } = await open(desktop, '/');
  const hrefs = await page.locator('.home-genre .card__link').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  assert(new Set(hrefs).size === hrefs.length, 'duplicate review links on home');
  for (const href of hrefs) {
    const r = await page.request.get(origin + href);
    assert(r.status() === 200, `${href} returned ${r.status()}`);
  }
  await page.close();
});

await check('Review page loads directly (refresh-safe) with labels, facts, related links and copy-link feedback', async () => {
  const { page, response } = await open(desktop, '/reviews/arrival/');
  assert(response.status() === 200, `status ${response.status()}`);
  assert(await page.locator('h1').count() === 1, 'expected one h1');
  assert(await page.locator('.site-nav [aria-current]').textContent() === 'Reviews', 'Reviews not marked current');
  const sample = page.locator('.sample-notice');
  if (await sample.count()) assert((await sample.innerText()).includes('Sample review'), 'sample notice text');
  assert(await page.locator('.spoiler-flag').count() === 1, 'spoiler label missing');
  assert(await page.locator('.facts').innerText().then((t) => /Our rating/i.test(t)), 'rating row missing');
  assert(await page.locator('.related .card').count() === 2, 'expected 2 related reviews');
  for (const h of ['Premise', 'The Take', 'What Works', 'What May Divide Viewers', 'Who Should Watch']) {
    assert(await page.locator('.review-body h2', { hasText: h }).count() === 1, `missing section ${h}`);
  }
  assert(await page.locator('.discuss__question').count() === 1, 'discussion question missing');
  await page.locator('[data-share-copy]').click();
  await page.waitForFunction(() => document.querySelector('[data-share-status]').textContent.includes('copied'));
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  assert(copied === canonical, `clipboard "${copied}" != canonical "${canonical}"`);
  await noOverflow(page, 'review');
  await shot(page, 'review-desktop');
  await page.close();
});

async function visibleCount(page) {
  return page.locator('[data-catalog-item]:not([hidden])').count();
}

await check('Reviews: search, combined filters, sorting, URL state, clear filters', async () => {
  const { page } = await open(desktop, '/reviews/');
  const total = await page.locator('[data-catalog-item]').count();
  assert(total >= 20, `expected 20+ reviews, found ${total}`);
  assert(await visibleCount(page) === total, 'not all reviews visible initially');
  assert(await page.locator('[data-catalog-controls]').isVisible(), 'controls hidden');

  await page.fill('#catalog-q', 'documentary');
  await page.waitForFunction(() => location.search.includes('q=documentary'));
  const docs = await visibleCount(page);
  assert(docs > 0 && docs < total, `search "documentary" showed ${docs}`);
  assert((await page.locator('#catalog-count').innerText()).includes('documentary'), 'count does not mention the query');

  await page.fill('#catalog-q', '');
  await page.check('input[name="genre"][value="horror"]');
  await page.check('input[name="genre"][value="sci-fi"]');
  await page.waitForFunction(() => location.search.includes('genre=horror') && location.search.includes('genre=sci-fi'));
  const expectHS = reviewsIn('horror') + reviewsIn('sci-fi');
  assert(await visibleCount(page) === expectHS, `horror + sci-fi should show ${expectHS}`);

  await page.selectOption('#catalog-sort', 'year-desc');
  const years = await page.locator('[data-catalog-item]:not([hidden])').evaluateAll((els) => els.map((e) => +e.dataset.year));
  assert(years.every((y, i) => i === 0 || years[i - 1] >= y), `not sorted newest first: ${years}`);
  assert(page.url().includes('sort=year-desc'), 'sort not in URL');

  await page.fill('#catalog-q', 'zzzz-nothing');
  await page.waitForTimeout(400);
  assert(await page.locator('[data-catalog-empty]').isVisible(), 'no-results state not shown');
  assert(await visibleCount(page) === 0, 'cards still visible with no results');

  await page.locator('[data-catalog-empty] [data-catalog-clear]').click();
  assert(await visibleCount(page) === total, 'clear filters did not restore all reviews');
  assert(!/[?&](q|genre|type)=/.test(page.url()), `URL not cleared: ${page.url()}`);
  await page.close();

  const direct = await open(desktop, '/reviews/?genre=fantasy&sort=year&q=');
  assert(await visibleCount(direct.page) === reviewsIn('fantasy'), 'direct URL ?genre=fantasy count mismatch');
  assert(await direct.page.isChecked('input[name="genre"][value="fantasy"]'), 'checkbox not restored from URL');
  await direct.page.close();
});

await check('Reviews: TV filter shows the TV empty state, and "Show movie reviews" recovers', async () => {
  const { page } = await open(desktop, '/reviews/?type=tv');
  const tvTotal = +(await page.locator('[data-catalog]').getAttribute('data-tv-total'));
  if (tvTotal === 0) {
    assert(await page.locator('[data-catalog-tv-empty]').isVisible(), 'TV empty state not visible');
    assert(!(await page.locator('[data-catalog-empty]').isVisible()), 'generic empty state shown instead');
    await page.locator('[data-catalog-show-movies]').click();
    assert(await visibleCount(page) > 0, 'movies not shown after recovery');
    assert(page.url().includes('type=movie'), 'type=movie not in URL');
  } else {
    assert(await visibleCount(page) === tvTotal, 'TV filter count mismatch');
  }
  await page.close();
});

await check('Header search from another page lands on filtered Reviews', async () => {
  const { page } = await open(desktop, '/genres/');
  await page.fill('#site-search-input', 'cozy');
  await Promise.all([page.waitForNavigation(), page.press('#site-search-input', 'Enter')]);
  assert(page.url().includes(base + '/reviews/?q=cozy'), `landed on ${page.url()}`);
  assert(await page.inputValue('#catalog-q') === 'cozy', 'catalog search not prefilled');
  const n = await visibleCount(page);
  assert(n > 0 && n < reviewsIn(), `cozy search showed ${n}`);
  await page.close();
});

await check('Genre hubs: five pages, four movies each, TV note, links to the other genres', async () => {
  for (const key of ['sci-fi', 'true-crime', 'fantasy', 'rom-com', 'horror']) {
    const { page, response } = await open(desktop, `/genres/${key}/`);
    assert(response.status() === 200, `${key}: status ${response.status()}`);
    assert(await page.locator('.genre-section').first().locator('.card').count() >= 4, `${key}: fewer than 4 movies`);
    assert(await page.locator('.genre-links__list li').count() === 4, `${key}: expected 4 other-genre links`);
    assert(await page.locator('.discuss__question').count() === 1, `${key}: discussion question missing`);
    assert(await page.locator('.site-nav [aria-current]').textContent() === 'Genres', `${key}: Genres not current`);
    await noOverflow(page, key);
    if (key === 'true-crime') await shot(page, 'genre-desktop');
    await page.close();
  }
});

await check('Watch Next: three collections with working pick links', async () => {
  const { page } = await open(desktop, '/watch-next/');
  const links = await page.locator('.collection-card .card__link').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  assert(links.length === collectionCount, `expected ${collectionCount} collections, found ${links.length}`);
  for (const href of links) {
    const p = await desktop.newPage();
    const r = await p.goto(origin + href);
    assert(r.status() === 200, `${href} returned ${r.status()}`);
    assert(await p.locator('.picks .card').count() >= 3, `${href}: fewer than 3 pick cards`);
    await p.close();
  }
  await page.close();
});

await check('Keyboard: first Tab reaches the skip link, which moves focus to main', async () => {
  const { page } = await open(desktop, '/');
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement.classList.contains('skip-link')), 'skip link not first');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => document.activeElement.id === 'main' || location.hash === '#main'), 'focus did not move to main');
  await page.close();
});

await check('404: unknown URL returns the 404 page with styles and recovery links', async () => {
  const { page, response } = await open(desktop, '/reviews/not-a-real-movie/', { expect404: true });
  assert(response.status() === 404, `status ${response.status()}`);
  assert((await page.locator('h1').innerText()).length > 0, 'no heading');
  const css = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert(css === BG, '404 page unstyled (asset paths broken at depth)');
  const href = await page.locator('.not-found .link-list a').first().getAttribute('href');
  assert(href === base + '/', `home link is ${href}`);
  await page.close();
});

const phone = await newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
await check('Phone (375px): menu toggle, no horizontal overflow on key pages', async () => {
  const { page } = await open(phone, '/');
  const toggle = page.locator('[data-menu-toggle]');
  assert(await toggle.isVisible(), 'menu button not visible');
  assert(!(await page.locator('#site-nav').isVisible()), 'nav should start collapsed');
  assert(await page.locator('#site-search-input').isVisible(), 'search not visible on phone');
  await toggle.click();
  assert(await page.locator('#site-nav').isVisible(), 'nav did not open');
  assert(await toggle.getAttribute('aria-expanded') === 'true', 'aria-expanded not true');
  await page.keyboard.press('Escape');
  assert(!(await page.locator('#site-nav').isVisible()), 'Escape did not close the menu');
  await noOverflow(page, 'home (phone)');
  await shot(page, 'home-phone');
  await page.close();
  for (const p of ['/reviews/', '/reviews/the-fellowship-of-the-ring/', '/reviews/the-hatchet-wielding-hitchhiker/', '/genres/', '/genres/true-crime/', '/watch-next/', '/watch-next/pick-your-next-movie-by-mood/', '/articles/', '/about/', '/community/', '/privacy/', '/404.html']) {
    const { page: pg } = await open(phone, p);
    await noOverflow(pg, `${p} (phone)`);
    if (p === '/reviews/the-fellowship-of-the-ring/') await shot(pg, 'review-phone');
    if (p === '/reviews/') await shot(pg, 'reviews-phone');
    await pg.close();
  }
});

const narrow = await newContext({ viewport: { width: 320, height: 640 } });
await check('Narrow phone (320px): no horizontal overflow', async () => {
  for (const p of ['/', '/reviews/', '/reviews/american-murder-the-family-next-door/', '/community/']) {
    const { page } = await open(narrow, p);
    await noOverflow(page, `${p} (320px)`);
    await page.close();
  }
});

const tablet = await newContext({ viewport: { width: 820, height: 1100 } });
await check('Tablet (820px): two cards per row', async () => {
  const { page } = await open(tablet, '/');
  const lefts = await page.locator('.home-genre').first().locator('.card').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  const firstRow = lefts.filter((t) => t === lefts[0]).length;
  assert(firstRow === 2, `expected 2 cards in the first row, found ${firstRow}`);
  await noOverflow(page, 'home (tablet)');
  await page.close();
});

await check('Desktop (1280px): four cards per row', async () => {
  const { page } = await open(desktop, '/');
  const tops = await page.locator('.home-genre').first().locator('.card').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  const firstRow = tops.filter((t) => t === tops[0]).length;
  assert(firstRow === 4, `expected 4 cards in the first row, found ${firstRow}`);
  await page.close();
});

const noJs = await newContext({ javaScriptEnabled: false });
await check('Without JavaScript: reviews listed, navigation visible, share link shown', async () => {
  const { page } = await open(noJs, '/reviews/');
  assert(await page.locator('[data-catalog-item]').count() >= 20, 'reviews not listed');
  assert(!(await page.locator('[data-catalog-controls]').isVisible()), 'non-working controls visible without JS');
  assert(await page.locator('#site-nav').isVisible(), 'nav hidden without JS');
  await page.close();
  const { page: review } = await open(noJs, '/reviews/get-out/');
  assert(await review.locator('.share__input').isVisible(), 'share fallback field not visible without JS');
  assert(!(await review.locator('[data-share-copy]').isVisible()), 'copy button visible without JS');
  await review.close();
});

await browser.close();
server.close();

await check('No analytics requests unless a Measurement ID is configured', async () => {
  if (expectAnalytics) assert(analyticsRequests.length > 0, 'expected analytics requests');
  else assert(analyticsRequests.length === 0, `unexpected analytics requests: ${analyticsRequests[0]}`);
});
await check('No JavaScript errors in the console', async () => {
  assert(consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.err}`}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (base path "${base}").`);
process.exit(failed.length ? 1 : 0);
