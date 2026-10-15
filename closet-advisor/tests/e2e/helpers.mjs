// Browser helpers for checks and end-to-end tests. Each session gets a fresh browser context,
// so IndexedDB starts empty and the demo seed runs again.
import { chromium, webkit } from 'playwright';
import { startServer } from '../serve.mjs';

export const PHONE = { width: 390, height: 844 };
export const DESKTOP = { width: 1280, height: 860 };

/**
 * Starts the static server and a browser page with console/page errors collected.
 * @param {{ browser?: 'chromium'|'webkit', viewport?: {width:number,height:number}, theme?: 'light'|'dark',
 *   user?: string, route?: string, mobile?: boolean, permissions?: string[] }} [opts]
 */
export async function openApp(opts = {}) {
  const { server, url } = await startServer(0);
  const engine = opts.browser === 'webkit' ? webkit : chromium;
  const browser = await engine.launch();
  const viewport = opts.viewport ?? PHONE;
  const mobile = opts.mobile ?? viewport.width < 600;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: mobile && opts.browser !== 'webkit' ? true : undefined,
    hasTouch: mobile,
    colorScheme: opts.theme ?? 'light',
    permissions: opts.permissions ?? [],
  });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()} (${page.url()})`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message} (${page.url()})`));
  page.on('requestfailed', (req) => {
    // The OCR engine loads from jsDelivr on demand; offline runs may fail it on purpose.
    if (!req.url().includes('cdn.jsdelivr.net')) problems.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`);
  });

  await page.goto(`${url}#${opts.route ?? '/welcome'}`);
  await page.waitForSelector('html[data-ready="true"]', { timeout: 20000 });
  if (opts.user) await signInAs(page, opts.user, opts.route);

  const close = async () => {
    await context.close();
    await browser.close();
    server.close();
  };
  return { page, context, browser, server, url, problems, close };
}

/** Signs in a demo account through the same client the screens use, then opens a route. */
export async function signInAs(page, userId, route) {
  await page.evaluate(async (id) => {
    const client = await import('./js/client.js');
    const result = await client.api.signInDemo({ userId: id });
    client.setSession(result);
  }, userId);
  if (route) await go(page, route);
}

/** Navigates by hash and waits for the router to settle. */
export async function go(page, route) {
  await page.evaluate((r) => {
    location.hash = `#${r}`;
  }, route);
  await page.waitForTimeout(250);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"][aria-label="Loading"]'), null, { timeout: 15000 });
}

/** Calls an API operation as the signed-in user from inside the page. */
export function callApi(page, op, args = {}) {
  return page.evaluate(
    async ([name, a]) => {
      const client = await import('./js/client.js');
      return client.api[name](a);
    },
    [op, args],
  );
}

/** True when the document is wider than the viewport (horizontal page scroll). */
export function hasHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}
