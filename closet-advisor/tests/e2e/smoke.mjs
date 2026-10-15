// Loads every route in a phone-sized Chromium as each demo role and fails on console errors,
// uncaught exceptions or failed requests. Screenshots go to the directory given as argv[2].
// Usage: node tests/e2e/smoke.mjs [screenshotDir]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { startServer } from '../serve.mjs';

const shotDir = process.argv[2] ?? null;
const ROUTES = {
  usr_demo_alex: ['/discover', '/collection', '/wishlist', '/profile', '/add', '/add/photo', '/add/search', '/add/manual', '/add/link', '/profile/preferences', '/profile/feedback', '/profile/privacy', '/profile/stylist', '/wishlist/compare', '/product/kestrel-runner-2', '/recs?mode=matching'],
  usr_demo_jordan: ['/stylist'],
  usr_demo_morgan: ['/admin'],
};

const { server, url } = await startServer(0);
const browser = await chromium.launch();
const problems = [];
try {
  if (shotDir) await mkdir(shotDir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()} @ ${page.url()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message} @ ${page.url()}`));
  page.on('requestfailed', (req) => problems.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));

  await page.goto(`${url}#/welcome`);
  await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
  if (shotDir) await page.screenshot({ path: `${shotDir}/welcome.png`, fullPage: true });

  for (const [userId, routes] of Object.entries(ROUTES)) {
    // Sign in through the API the screens use, then visit each route.
    await page.evaluate(async (id) => {
      const client = await import('./js/client.js');
      const result = await client.api.signInDemo({ userId: id });
      client.setSession(result);
    }, userId);
    for (const route of routes) {
      await page.evaluate((r) => (location.hash = `#${r}`), route);
      await page.waitForTimeout(350);
      if (shotDir) await page.screenshot({ path: `${shotDir}/${userId.replace('usr_demo_', '')}${route.replace(/[/?=&]+/g, '_')}.png`, fullPage: true });
    }
  }
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.error(`Smoke test found ${problems.length} problem(s):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('Smoke test passed: no console errors, page errors or failed requests.');
