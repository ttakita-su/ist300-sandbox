// The guarded upstream (backend/net.mjs) with fake transports: no test here touches the network.
// The real transport is only exercised against a server on 127.0.0.1, with its address pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { createUpstream, nodeTransport, detectBlock, isPublicAddress, createCookieJar, siteKey, USER_AGENT } from '../../backend/net.mjs';

const PUBLIC_IP = '93.184.215.14';
const PAGE = '<!doctype html><html><head><title>Court Classic</title></head><body>A product page.</body></html>';
const SENTENCE = /^[A-Z][\s\S]*\.$/;

/** DNS answers from a map (one public address by default); HTTP answers from a handler. */
function fakeTransport(handler = () => ({ body: PAGE }), { dns = {} } = {}) {
  const calls = { resolve: [], send: [] };
  return {
    calls,
    async resolve(hostname) {
      calls.resolve.push(hostname);
      const answer = dns[hostname] ?? [PUBLIC_IP];
      if (answer instanceof Error) throw answer;
      return answer.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    },
    async send(req) {
      calls.send.push(req);
      const out = await handler(req);
      return { status: out.status ?? 200, headers: out.headers ?? { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(out.body ?? '') };
    },
  };
}

function fakeClock(start = Date.parse('2026-10-15T12:00:00Z')) {
  let t = start;
  const sleeps = [];
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    sleeps,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

const upstreamFor = (transport, extra = {}) => createUpstream({ transport, minIntervalMs: 0, ...extra });

test('refuses local, private and metadata addresses before any DNS lookup or request', async () => {
  const transport = fakeTransport();
  const upstream = upstreamFor(transport);
  const urls = [
    'http://127.0.0.1/',
    'http://localhost:3000/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://2130706433/',
    'http://10.0.0.5/',
    'http://192.168.1.1/admin',
    'file:///etc/passwd',
    'https://user:pw@shop.fixture.alt/p/1',
    'https://shop.fixture.test/p/1',
    'https://shop.fixture.alt:8443/p/1',
  ];
  for (const url of urls) {
    const result = await upstream.getText(url);
    assert.equal(result.ok, false, url);
    assert.equal(result.status, 'invalid_url', url);
    assert.match(result.reason, SENTENCE, url);
  }
  assert.equal(transport.calls.resolve.length, 0);
  assert.equal(transport.calls.send.length, 0);
});

test('refuses names whose DNS answers include a private address, and pins the connection to the checked addresses', async () => {
  const transport = fakeTransport(undefined, {
    dns: {
      'localtest.me': ['127.0.0.1'],
      'mixed.fixture.alt': [PUBLIC_IP, '10.0.0.1'],
      'loop6.fixture.alt': ['::1'],
      'metadata.fixture.alt': ['169.254.169.254'],
      'nat64.fixture.alt': ['64:ff9b::7f00:1'],
      'mapped.fixture.alt': ['::ffff:192.168.0.10'],
      'dual.fixture.alt': ['2606:4700::1111', PUBLIC_IP],
    },
  });
  const upstream = upstreamFor(transport);
  for (const host of ['localtest.me', 'mixed.fixture.alt', 'loop6.fixture.alt', 'metadata.fixture.alt', 'nat64.fixture.alt', 'mapped.fixture.alt']) {
    const result = await upstream.getText(`https://${host}/products/1`);
    assert.equal(result.status, 'invalid_url', host);
    assert.equal(result.code, 'private_address', host);
    assert.match(result.reason, SENTENCE);
  }
  assert.equal(transport.calls.send.length, 0, 'nothing is sent to a host with a private answer');

  const ok = await upstream.getText('https://dual.fixture.alt/products/1');
  assert.equal(ok.ok, true);
  assert.equal(ok.text, PAGE);
  assert.deepEqual(
    transport.calls.send[0].addresses.map((a) => a.address),
    ['2606:4700::1111', PUBLIC_IP],
  );

  assert.equal(isPublicAddress({ address: PUBLIC_IP, family: 4 }), true);
  assert.equal(isPublicAddress({ address: 'fe80::1%en0', family: 6 }), false);
  assert.equal(isPublicAddress({ address: 'not an ip', family: 4 }), false);
});

test('follows redirects by hand and checks every hop', async () => {
  const transport = fakeTransport(
    (req) => {
      const { hostname, pathname } = req.url;
      if (hostname === 'intranet.fixture.alt') return { body: 'secret' };
      const redirects = {
        '/a': '/b',
        '/to-loopback': 'http://127.0.0.1/admin',
        '/to-intranet': 'https://intranet.fixture.alt/',
        '/to-http': 'http://shop.fixture.alt/b',
        '/loop': '/loop',
      };
      if (redirects[pathname]) return { status: 301, headers: { location: redirects[pathname] } };
      const hop = /^\/hop(\d+)$/.exec(pathname);
      if (hop) return { status: 302, headers: { location: `/hop${Number(hop[1]) + 1}` } };
      return { body: PAGE };
    },
    { dns: { 'intranet.fixture.alt': ['10.1.2.3'] } },
  );
  const upstream = upstreamFor(transport);

  const relative = await upstream.getText('https://shop.fixture.alt/a');
  assert.equal(relative.ok, true);
  assert.equal(relative.url, 'https://shop.fixture.alt/b');

  const cases = { '/to-loopback': 'private_address', '/to-intranet': 'private_address', '/to-http': 'downgrade', '/loop': 'redirect_loop', '/hop1': 'too_many_redirects' };
  for (const [path, code] of Object.entries(cases)) {
    const before = transport.calls.send.length;
    const result = await upstream.getText(`https://shop.fixture.alt${path}`);
    assert.equal(result.status, 'invalid_url', path);
    assert.equal(result.code, code, path);
    assert.match(result.reason, SENTENCE);
    if (path !== '/hop1') assert.equal(transport.calls.send.length - before, 1, `${path}: the redirect target is never contacted`);
  }
  assert.ok(!transport.calls.send.some((r) => r.url.hostname === 'intranet.fixture.alt' || r.url.hostname === '127.0.0.1'));

  // Headers a caller adds go to the first host only, not to a redirect target elsewhere.
  const away = fakeTransport((req) => (req.url.hostname === 'shop.fixture.alt' ? { status: 302, headers: { location: 'https://cdn.fixture.alt/x' } } : { body: PAGE }));
  await upstreamFor(away).getText('https://shop.fixture.alt/moved', { headers: { Referer: 'https://shop.fixture.alt/', 'X-Token': 'secret' } });
  assert.equal(away.calls.send[0].headers['X-Token'], 'secret');
  assert.equal(away.calls.send[1].url.hostname, 'cdn.fixture.alt');
  assert.equal(away.calls.send[1].headers['X-Token'], undefined);
  assert.equal(away.calls.send[1].headers.Referer, undefined);

  // A POST that redirects is not followed.
  const post = await upstream.request('https://shop.fixture.alt/a', { method: 'POST', body: Buffer.from('x'), kind: 'json' });
  assert.equal(post.status, 'unavailable');
  assert.equal(post.code, 'redirect');
});

test('sends an honest User-Agent and no cookies, except a jar for its own site', async () => {
  const transport = fakeTransport((req) => {
    if (req.url.pathname === '/start') return { status: 302, headers: { location: '/next', 'set-cookie': ['session=abc; Path=/'] } };
    return { headers: { 'content-type': 'text/html', 'set-cookie': ['MUID=bing1; domain=.bing.com'] }, body: PAGE };
  });
  const upstream = upstreamFor(transport);
  await upstream.getText('https://shop.fixture.alt/start', { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/155', Cookie: 'injected=1', Referer: 'https://shop.fixture.alt/' } });
  for (const req of transport.calls.send) {
    assert.equal(req.headers['User-Agent'], USER_AGENT);
    assert.equal(USER_AGENT, 'Mozilla/5.0 (compatible; RotationLookup/0.1; educational prototype)');
    assert.ok(!Object.keys(req.headers).some((h) => h.toLowerCase() === 'cookie'), 'no cookies to stores, even after a Set-Cookie');
  }
  assert.equal(transport.calls.send[0].headers.Referer, 'https://shop.fixture.alt/');

  const jar = createCookieJar('bing.com');
  await upstream.getText('https://www.bing.com/images?FORM=HDRSC2', { jar });
  await upstream.getText('https://www.bing.com/search?q=x', { jar });
  assert.equal(transport.calls.send.at(-1).headers.Cookie, 'MUID=bing1');
  assert.equal(jar.header('https://shop.fixture.alt/'), null, 'the jar never sends Bing cookies elsewhere');
  jar.store('https://shop.fixture.alt/', ['tracker=1']);
  assert.equal(jar.size, 1);
});

test('a block (403, 429, 401 or a challenge page) puts that host on a 30-minute cooldown', async () => {
  const clock = fakeClock();
  const transport = fakeTransport((req) => {
    if (req.url.hostname.endsWith('limited.fixture.alt')) return { status: 429, body: 'Too many requests' };
    if (req.url.hostname.endsWith('wall.fixture.alt')) return { body: '<html><head><title>Just a moment...</title></head><body></body></html>' };
    return { status: 403, body: '<html><head><title>Access Denied</title></head></html>' };
  });
  const upstream = upstreamFor(transport, { now: clock.now, sleep: clock.sleep });

  const first = await upstream.getText('https://www.blocked.fixture.alt/products/1');
  assert.deepEqual([first.status, first.code, first.host], ['blocked', 'http_403', 'blocked.fixture.alt']);
  // Same site without www and another path: answered from the cooldown, not contacted.
  const again = await upstream.getText('https://blocked.fixture.alt/products/2');
  assert.deepEqual([again.status, again.code], ['blocked', 'cooldown']);
  assert.equal(transport.calls.send.length, 1);
  assert.ok(upstream.cooldownUntil('www.blocked.fixture.alt') > clock.now());

  clock.advance(30 * 60 * 1000 - 1);
  assert.equal((await upstream.getText('https://blocked.fixture.alt/products/3')).code, 'cooldown');
  clock.advance(2);
  await upstream.getText('https://blocked.fixture.alt/products/4');
  assert.equal(transport.calls.send.length, 2, 'contacted again only after 30 minutes');

  assert.equal((await upstream.getText('https://limited.fixture.alt/')).code, 'http_429');
  assert.equal((await upstream.getText('https://wall.fixture.alt/')).code, 'challenge');
  assert.equal((await upstream.getText('https://wall.fixture.alt/other')).code, 'cooldown');
  // Nothing is retried: one request per attempt.
  assert.equal(transport.calls.send.length, 4);
});

test('a request waiting in the queue is not sent once the request ahead of it was blocked', async () => {
  const clock = fakeClock();
  const transport = fakeTransport(() => ({ status: 429, body: 'Too many requests' }));
  const upstream = createUpstream({ transport, minIntervalMs: 1000, now: clock.now, sleep: clock.sleep });
  const [first, second] = await Promise.all([upstream.getText('https://www.bing.com/search?q=a'), upstream.getText('https://www.bing.com/shop?q=a')]);
  assert.deepEqual([first.code, second.code], ['http_429', 'cooldown']);
  assert.equal(transport.calls.send.length, 1);
});

test('detectBlock knows vendor block pages and leaves normal pages alone', () => {
  const blocks = [
    [403, 'text/html', 'anything'],
    [429, 'text/plain', ''],
    [401, 'application/json', '{}'],
    [200, 'text/html', '<html><body>Reference #18.4a2c1702.1792084604.1b2f3e</body></html>'],
    [503, 'text/html', '<html><head><title>Just a moment...</title></head></html>'],
    [200, 'text/html', '<p>Type the characters you see in this image:</p>'],
    [200, 'text/html', '<script src="https://geo.captcha-delivery.com/captcha/"></script>'],
    [200, 'text/html', '<div id="px-captcha"></div>'],
    [200, 'text/html', '<title>Hang Tight! Routing to checkout...</title>'],
    [200, 'text/html', '<html><body>Please verify you are human to continue.</body></html>'],
    [202, 'text/html', '<html><body>Unfortunately, bots use this site too. Please confirm this search was made by a human.</body></html>'],
    [200, '', '<html><head><title>Access Denied</title></head></html>'],
  ];
  for (const [status, type, body] of blocks) assert.ok(detectBlock(status, type, Buffer.from(body)), `${status} ${body.slice(0, 40)}`);

  const bigProductPage = `<html><head><title>Court Classic | Fixture Shoe Co.</title></head><body>${'<p>Leather upper.</p>'.repeat(3000)}<form><div class="g-recaptcha"></div><p>Complete the captcha to sign up.</p></form></body></html>`;
  const normal = [
    [200, 'text/html', bigProductPage],
    [200, 'text/html', '<html><head><title>Court Classic</title><script>var challenge = 1; // captcha settings</script></head><body>ok</body></html>'],
    [500, 'text/html', '<html><body>Internal error</body></html>'],
    [404, 'text/html', '<html><head><title>Not found</title></head></html>'],
    [200, 'image/jpeg', 'Access Denied captcha'],
  ];
  for (const [status, type, body] of normal) assert.equal(detectBlock(status, type, Buffer.from(body)), null, `${status} ${body.slice(0, 40)}`);
});

test('caches answers for 15 minutes and shares identical in-flight requests', async () => {
  const clock = fakeClock();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const transport = fakeTransport(async (req) => {
    await gate;
    return req.url.pathname === '/broken' ? { status: 500, body: 'oops' } : { body: PAGE };
  });
  const upstream = upstreamFor(transport, { now: clock.now, sleep: clock.sleep, cacheMaxEntries: 2 });
  const url = 'https://shop.fixture.alt/products/court-classic-white';
  const pending = [upstream.getText(url), upstream.getText(url)];
  release();
  const [a, b] = await Promise.all(pending);
  assert.equal(a.text, PAGE);
  assert.equal(b.text, PAGE);
  assert.equal(transport.calls.send.length, 1, 'two identical requests at once share one upstream request');

  await upstream.getText(url);
  assert.equal(transport.calls.send.length, 1, 'answered from the cache');
  clock.advance(15 * 60 * 1000 + 1);
  await upstream.getText(url);
  assert.equal(transport.calls.send.length, 2, 'fetched again after 15 minutes');

  // Failures, POSTs and jar requests are not cached.
  await upstream.getText('https://shop.fixture.alt/broken');
  await upstream.getText('https://shop.fixture.alt/broken');
  await upstream.request(url, { method: 'POST', kind: 'json', body: Buffer.from('{}') });
  await upstream.request(url, { method: 'POST', kind: 'json', body: Buffer.from('{}') });
  assert.equal(transport.calls.send.length, 6);

  // Oldest entries leave first once the entry limit is reached.
  await upstream.getText('https://shop.fixture.alt/one');
  await upstream.getText('https://shop.fixture.alt/two');
  const sent = transport.calls.send.length;
  await upstream.getText(url);
  assert.equal(transport.calls.send.length, sent + 1);
});

test('requests to one host wait in a queue at least 1 s apart; other hosts do not wait', async () => {
  const clock = fakeClock();
  const starts = [];
  const transport = fakeTransport((req) => {
    starts.push([req.url.hostname, clock.now()]);
    return { body: PAGE };
  });
  const upstream = createUpstream({ transport, now: clock.now, sleep: clock.sleep });
  await Promise.all([upstream.getText('https://www.bing.com/search?q=a'), upstream.getText('https://bing.com/search?q=b'), upstream.getText('https://www.bing.com/shop?q=c')]);
  const times = starts.map(([, t]) => t);
  assert.equal(times.length, 3);
  assert.ok(times[1] - times[0] >= 1000 && times[2] - times[1] >= 1000, `starts ${times.map((t) => t - times[0])}`);

  clock.sleeps.length = 0;
  clock.advance(5000);
  await Promise.all([upstream.getText('https://shop.fixture.alt/1'), upstream.getText('https://cdn.fixture.alt/1.jpg', { kind: 'page' })]);
  assert.deepEqual(clock.sleeps, [], 'different hosts are not delayed by each other');
});

test('checks content types, byte caps, HTTP errors, DNS failures and timeouts', async () => {
  const transport = fakeTransport(
    (req) => {
      switch (req.url.pathname) {
        case '/pdf':
          return { headers: { 'content-type': 'application/pdf' }, body: '%PDF-1.7' };
        case '/no-type-html':
          return { headers: {}, body: '<!doctype html><html><head><title>Plain</title></head></html>' };
        case '/no-type-text':
          return { headers: {}, body: 'just text' };
        case '/huge':
          return { body: 'x'.repeat(2048) };
        case '/error':
          return { status: 500, body: '<html><body>error</body></html>' };
        case '/gone':
          return { status: 404, body: '<html><body>gone</body></html>' };
        case '/slow':
          throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
        case '/reset':
          throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        case '/picture.jpg':
          return { headers: { 'content-type': 'image/jpeg' }, body: '\xff\xd8\xff' };
        default:
          return { body: PAGE };
      }
    },
    { dns: { 'missing.fixture.alt': Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) } },
  );
  const upstream = upstreamFor(transport);
  const code = async (url, opts) => {
    const r = await upstream.getText(url, opts);
    return r.ok ? 'ok' : `${r.status}:${r.code}${r.httpStatus ? `:${r.httpStatus}` : ''}`;
  };
  assert.equal(await code('https://shop.fixture.alt/pdf'), 'unavailable:wrong_type');
  assert.equal(await code('https://shop.fixture.alt/no-type-html'), 'ok');
  assert.equal(await code('https://shop.fixture.alt/no-type-text'), 'unavailable:wrong_type');
  assert.equal(await code('https://shop.fixture.alt/huge', { maxBytes: 1024 }), 'unavailable:too_large');
  assert.equal(await code('https://shop.fixture.alt/error'), 'unavailable:http_error:500');
  assert.equal(await code('https://shop.fixture.alt/gone'), 'unavailable:http_error:404');
  assert.equal(await code('https://shop.fixture.alt/slow'), 'unavailable:timeout');
  assert.equal(await code('https://shop.fixture.alt/reset'), 'unavailable:network');
  assert.equal(await code('https://missing.fixture.alt/'), 'unavailable:dns');
  assert.equal(await code('https://shop.fixture.alt/products/1', { kind: 'image' }), 'unavailable:wrong_type');
  assert.equal(await code('https://shop.fixture.alt/picture.jpg', { kind: 'image' }), 'ok');
  // The byte cap of a kind can be lowered but never raised.
  const sent = transport.calls.send.length;
  await upstream.getText('https://shop.fixture.alt/products/2', { maxBytes: 50 * 1024 * 1024 });
  assert.equal(transport.calls.send[sent].maxBytes, 8 * 1024 * 1024);
  assert.equal(transport.calls.send[sent].timeoutMs <= 12000, true, 'at most 12 s');
  assert.equal(siteKey('WWW.Nike.com.'), 'nike.com');
  // A route's deadline that has already passed: nothing is sent.
  const before = transport.calls.send.length;
  assert.equal(await code('https://shop.fixture.alt/products/3', { deadline: Date.now() - 1 }), 'unavailable:timeout');
  assert.equal(transport.calls.send.length, before);
});

// The real transport, against a server on 127.0.0.1. The URL names a host that has no DNS entry:
// the request still arrives because the connection is pinned to the address given.
test('the real transport connects to the pinned address, decompresses, caps bytes after decompression and times out', async (t) => {
  const page = Buffer.from(`<html>${'court classic '.repeat(1000)}</html>`);
  const server = http.createServer((req, res) => {
    if (req.url === '/gzip') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip', 'X-Host-Seen': req.headers.host });
      res.end(zlib.gzipSync(page));
    } else if (req.url === '/br') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'br' });
      res.end(zlib.brotliCompressSync(page));
    } else if (req.url === '/bomb') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
      res.end(zlib.gzipSync(Buffer.alloc(5 * 1024 * 1024)));
    } else if (req.url === '/declared') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': String(3 * 1024 * 1024) });
      res.write('<html>');
    } else if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/gzip' });
      res.end();
    } else {
      // /hang: never answers
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const transport = nodeTransport();
  const send = (path, { maxBytes = 1024 * 1024, timeoutMs = 3000 } = {}) =>
    transport.send({
      url: new URL(`http://pinned.fixture.alt:${port}${path}`),
      addresses: [{ address: '127.0.0.1', family: 4 }],
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate, br' },
      body: null,
      timeoutMs,
      maxBytes,
    });

  const gz = await send('/gzip');
  assert.equal(gz.status, 200);
  assert.equal(gz.body.toString(), page.toString());
  assert.equal(gz.headers['x-host-seen'], `pinned.fixture.alt:${port}`);
  assert.equal((await send('/br')).body.length, page.length);
  const redirect = await send('/redirect');
  assert.deepEqual([redirect.status, redirect.headers.location], [302, '/gzip']);
  await assert.rejects(send('/bomb'), { code: 'ETOOLARGE' }, '5 MB of zeros from a small gzip body stops at the 1 MB cap');
  await assert.rejects(send('/declared'), { code: 'ETOOLARGE' });
  await assert.rejects(send('/hang', { timeoutMs: 150 }), { code: 'ETIMEDOUT' });
});

test('block detection: Bing pages count only by status, and title phrases and reference numbers only on small pages', () => {
  // Bing's results title starts with whatever the person typed.
  const serp = (query) => `<!doctype html><html><head><title>${query} - Search</title></head><body>${'<li class="b_algo"><h2><a href="https://shop.fixture.alt/">Result</a></h2></li>'.repeat(10)}</body></html>`;
  for (const query of ['Access Denied hoodie', 'Captcha t-shirt', 'Just a moment watch', 'Bot check sneakers']) {
    assert.equal(detectBlock(200, 'text/html', Buffer.from(serp(query)), { statusOnly: true }), null, query);
  }
  assert.equal(detectBlock(403, 'text/html', Buffer.from(serp('court classic')), { statusOnly: true }), 'http_403');
  assert.equal(detectBlock(429, 'text/html', Buffer.from(''), { statusOnly: true }), 'http_429');

  // A real-sized store page named like a block page is a product page.
  const filler = '<p>Heavyweight cotton, ribbed cuffs, kangaroo pocket.</p>'.repeat(1500);
  const hoodie = `<html><head><title>Access Denied Hoodie | Fixture Merch</title></head><body>${filler}</body></html>`;
  assert.equal(detectBlock(200, 'text/html', Buffer.from(hoodie)), null);
  // A watch page quoting a reference number is not an Akamai block page, at any size.
  const watch = (body) => `<html><head><title>Speedmaster | Fixture Watches</title></head><body><p>Reference #310.30.42.50.01.002</p>${body}</body></html>`;
  assert.equal(detectBlock(200, 'text/html', Buffer.from(watch(filler))), null);
  assert.equal(detectBlock(200, 'text/html', Buffer.from(watch(''))), null);
  // The real small block pages still count.
  assert.equal(detectBlock(200, 'text/html', Buffer.from('<html><head><title>Access Denied</title></head><body>Reference #18.4a2c1702.1792084604.1b2f3e</body></html>')), 'challenge');
  assert.equal(detectBlock(200, 'text/html', Buffer.from('<html><head><title>Just a moment...</title></head><body></body></html>')), 'challenge');
});

test('Bing requests are checked by status only: a typed query echoed in the title cools nothing down', async () => {
  const transport = fakeTransport((req) => ({ body: `<html><head><title>${req.url.searchParams.get('q')} - Search</title></head><body></body></html>` }));
  const upstream = upstreamFor(transport);
  const echoed = await upstream.getText('https://www.bing.com/search?q=Access+Denied+hoodie', { blockCheck: 'status' });
  assert.equal(echoed.ok, true);
  assert.equal(upstream.cooldownUntil('www.bing.com'), 0);
  // The same page from a store, without the option, is still judged by its content (small page).
  const store = await upstream.getText('https://shop.fixture.alt/search?q=Access+Denied');
  assert.deepEqual([store.status, store.code], ['blocked', 'challenge']);
});

test('DNS is inside the time limit: a hung resolver ends as a timeout', async () => {
  const transport = fakeTransport();
  transport.resolve = () => new Promise(() => {});
  const upstream = upstreamFor(transport, { timeoutMs: 150 });
  const started = Date.now();
  const result = await upstream.getText('https://slow-dns.fixture.alt/products/1');
  assert.deepEqual([result.ok, result.status, result.code], [false, 'unavailable', 'timeout']);
  assert.ok(Date.now() - started < 1000, `answered after ${Date.now() - started} ms`);
  // A route deadline that is shorter than the 12 s limit applies too.
  const viaDeadline = await upstreamFor(transport).getText('https://slow-dns.fixture.alt/products/2', { deadline: Date.now() + 100 });
  assert.equal(viaDeadline.code, 'timeout');
  assert.equal(transport.calls.send.length, 0);
});

test('a cached answer keeps the time it was fetched', async () => {
  const clock = fakeClock();
  const transport = fakeTransport();
  const upstream = upstreamFor(transport, { now: clock.now, sleep: clock.sleep });
  const first = await upstream.getText('https://shop.fixture.alt/products/1');
  clock.advance(14 * 60 * 1000);
  const second = await upstream.getText('https://shop.fixture.alt/products/1');
  assert.equal(transport.calls.send.length, 1);
  assert.equal(first.fetchedAt, Date.parse('2026-10-15T12:00:00Z'));
  assert.equal(second.fetchedAt, first.fetchedAt);
});

test('the real transport stops the decompressor on a bomb and closes redirects instead of draining them', async (t) => {
  // 32 MB of zeros, compressed to a few kilobytes.
  const zeros = Buffer.alloc(32 * 1024 * 1024);
  const brBomb = zlib.brotliCompressSync(zeros, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
  const gzBomb = zlib.gzipSync(zeros, { level: 1 });
  const closed = {};
  const server = http.createServer((req, res) => {
    res.on('close', () => (closed[req.url] = Date.now()));
    if (req.url === '/br-bomb') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'br' });
      res.end(brBomb);
    } else if (req.url === '/gz-bomb') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
      res.end(gzBomb);
    } else {
      // A redirect with an endless body.
      res.writeHead(302, { Location: '/next', 'Content-Type': 'text/html' });
      const chunk = Buffer.alloc(64 * 1024, 120);
      const pump = setInterval(() => res.write(chunk), 5);
      res.on('close', () => clearInterval(pump));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();

  // Records every decompressor the transport reads from (node:zlib's exports are read-only, its
  // classes' prototypes are not).
  const made = [];
  for (const Kind of [zlib.BrotliDecompress, zlib.Gunzip]) {
    const on = Kind.prototype.on;
    Kind.prototype.on = function (event, listener) {
      if (event === 'data') made.push(this);
      return on.call(this, event, listener);
    };
    t.after(() => delete Kind.prototype.on);
  }

  const transport = nodeTransport();
  const send = (path) =>
    transport.send({
      url: new URL(`http://pinned.fixture.alt:${port}${path}`),
      addresses: [{ address: '127.0.0.1', family: 4 }],
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate, br' },
      body: null,
      timeoutMs: 3000,
      maxBytes: 1024 * 1024,
    });
  await assert.rejects(send('/br-bomb'), { code: 'ETOOLARGE' });
  await assert.rejects(send('/gz-bomb'), { code: 'ETOOLARGE' });
  assert.equal(made.length, 2);
  for (const stream of made) assert.equal(stream.destroyed, true, 'the decompressor is destroyed when the cap fires');

  const redirect = await send('/redirect');
  assert.deepEqual([redirect.status, redirect.headers.location], [302, '/next']);
  const resolvedAt = Date.now();
  for (let i = 0; i < 100 && !closed['/redirect']; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(closed['/redirect'], 'the redirect connection is closed, not drained');
  assert.ok(closed['/redirect'] - resolvedAt < 1000);
});
