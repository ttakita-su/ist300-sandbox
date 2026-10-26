// The local app server (backend/server.mjs and backend/routes.mjs) on 127.0.0.1 with the fixture
// upstream: static allowlist, request checks, body limits and every /api route. No network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { startAppServer, staticFile, allowedHostsFor, portBusyMessage, DEFAULT_PORT, PORT_FALLBACKS } from '../../backend/server.mjs';
import { lookupProduct } from '../../backend/routes.mjs';
import { createUpstream } from '../../backend/net.mjs';
import { fixtureUpstream, fixtureTransport, fixtureImage, FIXTURE } from '../fixtures/web/upstream.mjs';

const SENTENCE = /^[A-Z][\s\S]*\.$/;
let app;
let upstream;
const reasons = [];

before(async () => {
  upstream = fixtureUpstream();
  app = await startAppServer({ port: 0, upstream });
});
after(() => app.close());

/**
 * A raw request, so tests can set Host, Origin and Sec-Fetch-Site themselves. Headers set to
 * undefined are left out; Host: null sends no Host header at all.
 */
function send({ method = 'GET', path = '/', headers = {}, body = null, port = app.port } = {}) {
  const all = Object.fromEntries(Object.entries({ Host: `127.0.0.1:${port}`, ...headers }).filter(([, v]) => v !== undefined && v !== null));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: all, setHost: headers.Host !== null }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const json = /json/.test(res.headers['content-type'] ?? '') && buffer.length ? JSON.parse(buffer.toString('utf8')) : null;
        if (json?.reason) reasons.push(json.reason);
        resolve({ status: res.statusCode, headers: res.headers, body: buffer, json });
      });
    });
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}

const api = (path, value, headers = {}) =>
  send({ method: 'POST', path, headers: { 'Content-Type': 'application/json', 'X-Rotation': '1', Origin: `http://127.0.0.1:${app.port}`, ...headers }, body: Buffer.from(JSON.stringify(value)) });

test('serves only the app: allowlisted files with their types, everything else 404', async () => {
  const ok = {
    '/': 'text/html; charset=utf-8',
    '/index.html': 'text/html; charset=utf-8',
    '/sw.js': 'text/javascript; charset=utf-8',
    '/manifest.webmanifest': 'application/manifest+json; charset=utf-8',
    '/css/tokens.css': 'text/css; charset=utf-8',
    '/js/app.js': 'text/javascript; charset=utf-8',
    '/js/server/urlsafety.js': 'text/javascript; charset=utf-8',
    '/icons/icon.svg': 'image/svg+xml',
    '/dev/components.html': 'text/html; charset=utf-8',
  };
  for (const [path, type] of Object.entries(ok)) {
    const res = await send({ path });
    assert.equal(res.status, 200, path);
    assert.equal(res.headers['content-type'], type, path);
    assert.equal(res.headers['cache-control'], 'no-store', path);
  }
  const head = await send({ method: 'HEAD', path: '/index.html' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);

  const hidden = [
    '/package.json',
    '/package-lock.json',
    '/ARCHITECTURE.md',
    '/.env.example',
    '/.git/config',
    '/node_modules/playwright/package.json',
    '/tests/helpers.mjs',
    '/tests/fixtures/web/upstream.mjs',
    '/backend/server.mjs',
    '/supabase/schema.sql',
    '/docs/PLAN.md',
    '/api/status.json.bak',
    '/js/',
    '/css',
    '/favicon.ico',
    '/js/../package.json',
    '/js/%2e%2e/package.json',
    '/js/..%2fpackage.json',
    '/js/%2e%2e%2f%2e%2e%2f..%2fetc%2fpasswd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '//etc/passwd',
    '/js/\\..\\package.json',
    '/js/.hidden.js',
    '/js/app.js%00.png',
    '/js/%E0%A4%A.js',
  ];
  for (const path of hidden) {
    const res = await send({ path });
    assert.ok(res.status === 404 || (path.startsWith('/api/') && res.status === 403), `${path} -> ${res.status}`);
    assert.ok(!res.body.toString().includes('"devDependencies"'), path);
  }
  assert.equal((await send({ method: 'POST', path: '/index.html' })).status, 405);
  assert.equal(staticFile('/js/../../etc/passwd'), null);
  assert.ok(staticFile('/js/app.js').endsWith('/js/app.js'));
});

test('GET /api/status.json says live, while the committed file says demo mode', async () => {
  const res = await send({ path: '/api/status.json' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.json, { live: true, version: 1, engines: { lookup: 'page', search: 'bing', photo: 'bing' } });
  const committed = JSON.parse(await readFile(new URL('../../api/status.json', import.meta.url), 'utf8'));
  assert.deepEqual(committed, { live: false });
});

test('API requests need POST, X-Rotation: 1, our own Host and Origin, and not a cross-site fetch', async () => {
  const body = { url: FIXTURE.productUrl };
  assert.equal((await api('/api/lookup', body)).json.status, 'found');
  assert.equal((await api('/api/lookup', body, { Origin: undefined })).json.status, 'found', 'no Origin is fine');
  assert.equal((await api('/api/lookup', body, { Host: `localhost:${app.port}`, Origin: `http://localhost:${app.port}` })).json.status, 'found');
  assert.equal((await api('/api/lookup', body, { 'Sec-Fetch-Site': 'same-origin' })).json.status, 'found');

  const refused = [
    { 'X-Rotation': undefined },
    { 'X-Rotation': '0' },
    { Origin: 'https://evil.example' },
    { Origin: 'null' },
    { Origin: `http://localhost:${app.port}` },
    { Host: `evil.example:${app.port}` },
    { Host: `127.0.0.1:${app.port + 1}`, Origin: undefined },
    { 'Sec-Fetch-Site': 'cross-site' },
  ];
  for (const headers of refused) {
    const res = await send({
      method: 'POST',
      path: '/api/lookup',
      headers: { 'Content-Type': 'application/json', 'X-Rotation': '1', Origin: `http://127.0.0.1:${app.port}`, ...headers },
      body: Buffer.from(JSON.stringify(body)),
    });
    assert.equal(res.status, 403, JSON.stringify(headers));
    assert.equal(res.json.status, 'forbidden');
    assert.match(res.json.reason, SENTENCE);
  }
  // Node itself answers 400 to an HTTP/1.1 request without a Host header.
  const noHost = await send({ method: 'POST', path: '/api/lookup', headers: { Host: null, 'Content-Type': 'application/json', 'X-Rotation': '1' }, body: Buffer.from(JSON.stringify(body)) });
  assert.equal(noHost.status, 400);
  const get = await send({ path: '/api/lookup', headers: { 'X-Rotation': '1' } });
  assert.equal(get.status, 403);

  const options = await send({ method: 'OPTIONS', path: '/api/lookup', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-rotation' } });
  assert.equal(options.status, 405);
  assert.ok(!Object.keys(options.headers).some((h) => h.startsWith('access-control-')), 'no CORS headers');
  const missing = await api('/api/nope', {});
  assert.deepEqual([missing.status, missing.json.status], [404, 'not_found']);
});

test('body limits and types: JSON up to 16 KB, photos up to 6 MB and sniffed', async () => {
  const big = await api('/api/lookup', { url: `https://shop.fixture.alt/?q=${'x'.repeat(17 * 1024)}` });
  assert.deepEqual([big.status, big.json.status], [413, 'invalid']);
  const headers = { 'X-Rotation': '1', Host: `127.0.0.1:${app.port}` };
  const text = await send({ method: 'POST', path: '/api/lookup', headers: { ...headers, 'Content-Type': 'text/plain' }, body: Buffer.from('{"url":"x"}') });
  assert.equal(text.status, 415);
  const broken = await send({ method: 'POST', path: '/api/search', headers: { ...headers, 'Content-Type': 'application/json' }, body: Buffer.from('{"query":') });
  assert.equal(broken.status, 400);
  const list = await send({ method: 'POST', path: '/api/search', headers: { ...headers, 'Content-Type': 'application/json' }, body: Buffer.from('["Court Classic"]') });
  assert.equal(list.status, 400);

  const photo = (body, type = 'image/jpeg') => send({ method: 'POST', path: '/api/lens', headers: { ...headers, 'Content-Type': type }, body });
  const tooBig = Buffer.alloc(6 * 1024 * 1024 + 1);
  tooBig.set([0xff, 0xd8, 0xff]);
  assert.deepEqual([(await photo(tooBig)).status, (await photo(tooBig)).json.status], [413, 'invalid']);
  assert.equal((await photo(Buffer.alloc(0))).status, 400);
  const pdf = await photo(Buffer.from('%PDF-1.7 not a photo'));
  assert.deepEqual([pdf.status, pdf.json.status], [415, 'invalid']);
  assert.equal((await photo(fixtureImage('/court-classic-white.jpg'), 'application/octet-stream')).status, 415);
  assert.equal((await photo(fixtureImage('/court-classic-white.jpg'), 'image/heic')).status, 415);
});

test('POST /api/lookup: found, blocked with a cooldown, not a product, and unsafe links refused', async () => {
  const found = await api('/api/lookup', { url: FIXTURE.productShortUrl });
  assert.equal(found.status, 200);
  assert.equal(found.json.status, 'found');
  const { page } = found.json;
  assert.deepEqual(Object.keys(page), ['url', 'requestedUrl', 'host', 'siteName', 'name', 'brand', 'description', 'images', 'price', 'availability', 'condition', 'color', 'sku', 'gtin', 'mpn', 'sizes', 'via', 'fetchedAt']);
  assert.equal(page.url, FIXTURE.productUrl, 'the canonical URL after the redirect');
  assert.equal(page.requestedUrl, FIXTURE.productShortUrl);
  assert.equal(page.host, 'shop.fixture.alt');
  assert.equal(page.name, FIXTURE.product.name);
  assert.equal(page.brand, FIXTURE.product.brand);
  assert.equal(page.siteName, FIXTURE.product.siteName);
  assert.deepEqual(page.price, FIXTURE.product.price);
  assert.equal(page.availability, 'in_stock');
  assert.equal(page.color, FIXTURE.product.color);
  assert.deepEqual(page.sizes, FIXTURE.product.sizes);
  assert.deepEqual(page.images, [FIXTURE.productImageUrl]);
  assert.deepEqual(page.via, ['json-ld', 'meta']);
  assert.ok(!Number.isNaN(Date.parse(page.fetchedAt)));

  const shopify = await api('/api/lookup', { url: FIXTURE.shopifyUrl });
  assert.deepEqual([shopify.json.status, shopify.json.page.price.amountMinor, shopify.json.page.sizes.join(',')], ['found', 6500, '9,10']);
  assert.ok(upstream.requests.some((r) => r.url === `${FIXTURE.shopifyUrl}.js`), 'one Shopify follow-up');

  const blocked = await api('/api/lookup', { url: FIXTURE.blockedUrl });
  assert.deepEqual(blocked.json, { status: 'blocked', host: 'blocked.fixture.alt', reason: blocked.json.reason });
  assert.match(blocked.json.reason, /^Automated lookups aren't allowed on blocked\.fixture\.alt\./);
  const sent = upstream.requests.length;
  assert.equal((await api('/api/lookup', { url: 'https://blocked.fixture.alt/products/other' })).json.status, 'blocked');
  assert.equal(upstream.requests.length, sent, 'the blocked store is not contacted again during its cooldown');

  const home = await api('/api/lookup', { url: FIXTURE.homeUrl });
  assert.deepEqual([home.json.status, home.json.host, home.json.page.name], ['not_product', 'shop.fixture.alt', 'Fixture Shoe Co. | Shoes for every day']);
  const missing = await api('/api/lookup', { url: FIXTURE.missingUrl });
  assert.deepEqual([missing.json.status, missing.json.page], ['not_product', null]);
  const unknown = await api('/api/lookup', { url: 'https://nowhere.fixture.alt/products/1' });
  assert.deepEqual([unknown.json.status, unknown.json.host], ['unavailable', 'nowhere.fixture.alt']);

  const before = upstream.requests.length;
  const unsafe = {
    'http://127.0.0.1/': 'private_address',
    'http://localtest.me/': 'private_address',
    [FIXTURE.privateDnsUrl]: 'private_address',
    [FIXTURE.privateRedirectUrl]: 'private_address',
    'http://169.254.169.254/latest/meta-data/': 'private_address',
    'http://localhost:8130/api/status.json': 'local_host',
    'ftp://shop.fixture.alt/file': 'scheme',
    '': 'empty',
  };
  for (const [url, code] of Object.entries(unsafe)) {
    const res = await api('/api/lookup', { url });
    assert.deepEqual([res.json.status, res.json.code], ['invalid_url', code], url);
  }
  assert.equal(upstream.requests.length - before, 1, 'only the redirecting fixture page was contacted; its private target never was');
});

test('POST /api/search: Bing web results and free Shopping listings; short queries are invalid', async () => {
  const res = await api('/api/search', { query: '  Court   Classic White ' });
  assert.equal(res.json.status, 'ok');
  assert.equal(res.json.engine, 'bing');
  assert.equal(res.json.query, 'Court Classic White');
  assert.deepEqual(
    res.json.shopping.map((l) => [l.id, l.seller, l.price, l.source]),
    [
      ['shop_1', 'Fixture Shoe Co.', { amountMinor: 8900, currency: 'USD' }, 'bing_shopping'],
      ['shop_2', 'Second Street Fixture', { amountMinor: 7499, currency: 'USD' }, 'bing_shopping'],
    ],
  );
  assert.deepEqual(
    res.json.results.map((r) => [r.id, r.host, r.productPage]),
    [
      ['web_1', 'shop.fixture.alt', true],
      ['web_2', 'blocked.fixture.alt', true],
      ['web_3', 'wiki.fixture.alt', false],
    ],
  );
  assert.equal((await api('/api/search', { query: 'a' })).json.status, 'invalid');
  assert.equal((await api('/api/search', { query: 'x'.repeat(201) })).json.status, 'invalid');
  assert.equal((await api('/api/search', {})).json.status, 'invalid');
});

test('POST /api/lens: Bing visual search for the photo, cached by its hash; no name is no_match', async () => {
  const photo = fixtureImage('/court-classic-white.jpg');
  const lens = (body, port = app.port) => send({ method: 'POST', path: '/api/lens', port, headers: { 'Content-Type': 'image/jpeg', 'X-Rotation': '1', Host: `127.0.0.1:${port}` }, body });
  const first = await lens(photo);
  assert.equal(first.status, 200);
  assert.equal(first.json.status, 'ok');
  assert.equal(first.json.query, FIXTURE.lensQuery);
  assert.equal(first.json.shopping.length, 2);
  assert.equal(first.json.results[0].url, FIXTURE.productUrl);
  const uploads = upstream.requests.filter((r) => r.url.includes('/images/kblob')).length;
  assert.deepEqual((await lens(photo)).json, first.json);
  assert.equal(upstream.requests.filter((r) => r.url.includes('/images/kblob')).length, uploads, 'the same photo is answered from the cache');

  const other = await startAppServer({ port: 0, upstream: fixtureUpstream({ lensQuery: null }) });
  try {
    const none = await lens(photo, other.port);
    assert.equal(none.json.status, 'no_match');
    assert.match(none.json.reason, SENTENCE);
  } finally {
    await other.close();
  }
});

test('POST /api/image: the image bytes with their sniffed type, or a JSON error', async () => {
  const image = await api('/api/image', { url: FIXTURE.productImageUrl });
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/jpeg');
  assert.equal(image.headers['x-final-url'], FIXTURE.productImageUrl);
  assert.equal(image.headers['cache-control'], 'no-store');
  assert.ok(image.body.equals(fixtureImage('/court-classic-white.jpg')));

  const notImage = await api('/api/image', { url: FIXTURE.notImageUrl });
  assert.deepEqual([notImage.status, notImage.json.status], [415, 'unsupported']);
  const local = await api('/api/image', { url: 'http://127.0.0.1/secret.png' });
  assert.deepEqual([local.status, local.json.status, local.json.code], [400, 'invalid_url', 'private_address']);
  const gone = await api('/api/image', { url: 'https://cdn.fixture.alt/missing.jpg' });
  assert.deepEqual([gone.status, gone.json.status], [502, 'unavailable']);
  const blocked = await api('/api/image', { url: 'https://blocked.fixture.alt/image.jpg' });
  assert.deepEqual([blocked.status, blocked.json.status], [502, 'blocked']);
});

test('every reason the API gave is a sentence that can be shown, with no apology', () => {
  assert.ok(reasons.length > 20);
  for (const reason of reasons) {
    assert.match(reason, SENTENCE, reason);
    assert.doesNotMatch(reason, /sorry|apolog/i, reason);
  }
});

test('LAN binding adds the bound address to the allowed Host values', () => {
  assert.deepEqual([...allowedHostsFor('127.0.0.1', 8130)], ['127.0.0.1:8130', 'localhost:8130']);
  assert.ok(allowedHostsFor('192.168.1.20', 8130).has('192.168.1.20:8130'));
  assert.ok(allowedHostsFor('::1', 8130).has('[::1]:8130'));
  assert.ok(allowedHostsFor('0.0.0.0', 8130).has('127.0.0.1:8130'));
});

test('the service worker leaves api/ to the network and uses a new cache name', async () => {
  const source = await readFile(new URL('../../sw.js', import.meta.url), 'utf8');
  const listeners = {};
  const self = { location: new URL('https://ttakita.example/ist300-sandbox/closet-advisor/sw.js'), addEventListener: (type, fn) => (listeners[type] = fn), skipWaiting() {}, clients: { claim() {} } };
  const opened = [];
  const added = [];
  const fetchInits = [];
  const caches = { open: async (name) => (opened.push(name), { match: async () => undefined, put: async () => {}, addAll: async (requests) => added.push(...requests) }), keys: async () => [] };
  // A worker resolves relative URLs against its own location.
  const WorkerRequest = class extends Request {
    constructor(url, init) {
      super(new URL(url, self.location), init);
    }
  };
  vm.runInNewContext(source, { self, caches, URL, Request: WorkerRequest, fetch: async (request, init) => (fetchInits.push(init), new Response('ok')) });
  const handled = (url, method = 'GET') => {
    let responded = false;
    listeners.fetch({ request: { url, method, mode: 'cors' }, respondWith: () => (responded = true) });
    return responded;
  };
  assert.equal(handled('https://ttakita.example/ist300-sandbox/closet-advisor/api/status.json'), false);
  assert.equal(handled('https://ttakita.example/ist300-sandbox/closet-advisor/api/lookup', 'POST'), false);
  assert.equal(handled('https://ttakita.example/ist300-sandbox/closet-advisor/js/app.js'), true);
  assert.equal(handled('https://cdn.jsdelivr.net/npm/tesseract.js'), false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(opened, ['rotation-v3']);
  // Refreshes and the install skip the browser's HTTP cache, so old and new modules can't mix.
  assert.deepEqual(fetchInits.map((init) => init?.cache), ['no-cache']);
  let installed;
  listeners.install({ waitUntil: (promise) => (installed = promise) });
  await installed;
  assert.ok(added.length > 5 && added.every((r) => r instanceof Request && r.cache === 'reload'));
});

test('the port: a busy one falls back to the next free port only when fallbacks are allowed', async (t) => {
  // The test picks its own base port (a free one from the OS, then held), never 8130.
  const blocker = http.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => blocker.close());
  const base = blocker.address().port;

  const moved = await startAppServer({ port: base, portFallbacks: 9, upstream: fixtureUpstream() });
  try {
    assert.ok(moved.port > base && moved.port <= base + 9, `bound ${moved.port} for base ${base}`);
    assert.equal(moved.requestedPort, base);
    assert.equal(moved.url, `http://127.0.0.1:${moved.port}/`);
    const status = await send({ path: '/api/status.json', port: moved.port });
    assert.equal(status.json.live, true, 'the Host check uses the port that was bound');
  } finally {
    await moved.close();
  }
  // A port that was asked for is used or nothing is.
  await assert.rejects(startAppServer({ port: base, upstream: fixtureUpstream() }), { code: 'EADDRINUSE' });
  await assert.rejects(startAppServer({ port: base, portFallbacks: 0, upstream: fixtureUpstream() }), { code: 'EADDRINUSE' });

  assert.deepEqual([DEFAULT_PORT, PORT_FALLBACKS], [8130, 9]);
  assert.equal(portBusyMessage(8130), 'Port 8130 is already in use. Pick another port: PORT=8140 npm start, or npm start -- --port 8140.');
  assert.equal(portBusyMessage(8130, 9), 'Ports 8130 to 8139 are all in use. Pick another port: PORT=8140 npm start, or npm start -- --port 8140.');
  assert.equal(portBusyMessage(9000), 'Port 9000 is already in use. Pick another port: PORT=9001 npm start, or npm start -- --port 9001.');
});

test('reasons say what happened when Bing answers unexpectedly; OPTIONS on status.json names GET', async () => {
  const base = fixtureTransport();
  const transport = {
    resolve: base.resolve,
    async send(req) {
      if (req.url.pathname === '/search' || req.url.pathname === '/shop') return { status: 500, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html><body>Server error</body></html>') };
      if (req.url.pathname === '/images/kblob') return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html><body>A new upload page</body></html>') };
      return base.send(req);
    },
  };
  const odd = await startAppServer({ port: 0, upstream: createUpstream({ transport, minIntervalMs: 0 }) });
  try {
    const search = await send({ method: 'POST', path: '/api/search', port: odd.port, headers: { 'Content-Type': 'application/json', 'X-Rotation': '1' }, body: Buffer.from(JSON.stringify({ query: FIXTURE.query })) });
    assert.equal(search.json.status, 'unavailable');
    assert.match(search.json.reason, /^Bing answered with an error\./);
    const lens = await send({ method: 'POST', path: '/api/lens', port: odd.port, headers: { 'Content-Type': 'image/jpeg', 'X-Rotation': '1' }, body: fixtureImage('/court-classic-white.jpg') });
    assert.equal(lens.json.status, 'unavailable');
    assert.match(lens.json.reason, /doesn't understand/);
    for (const reason of [search.json.reason, lens.json.reason]) {
      assert.match(reason, SENTENCE);
      assert.doesNotMatch(reason, /internet connection/, reason);
    }
    const options = await send({ method: 'OPTIONS', path: '/api/status.json', port: odd.port });
    assert.deepEqual([options.status, options.headers.allow], [405, 'GET, HEAD']);
    assert.match(options.json.reason, /only answers GET requests/);
    assert.equal((await send({ method: 'PUT', path: '/api/status.json', port: odd.port })).status, 405);
  } finally {
    await odd.close();
  }
});

test('a lookup answered from the cache reports when the page was really fetched', async () => {
  let t = Date.parse('2026-10-15T12:00:00Z');
  const now = () => t;
  const cached = fixtureUpstream({ now });
  const first = await lookupProduct(cached, FIXTURE.productUrl, { now });
  t += 14 * 60 * 1000;
  const second = await lookupProduct(cached, FIXTURE.productUrl, { now });
  assert.equal(first.status, 'found');
  assert.equal(first.page.fetchedAt, '2026-10-15T12:00:00.000Z');
  assert.equal(second.page.fetchedAt, '2026-10-15T12:00:00.000Z', 'not "checked just now" for a 14-minute-old answer');
  assert.equal(cached.requests.filter((r) => r.url === FIXTURE.productUrl).length, 1);
});
