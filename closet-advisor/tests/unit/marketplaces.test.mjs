import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketplaceUrl, MARKETPLACES, styleCodeFromTokens } from '../../js/server/marketplaces.js';
import { createTestEnv, rejectsWith, ALEX, JORDAN } from '../helpers.mjs';

test('reads StockX product links, including locale, size and a missing scheme', () => {
  const r = parseMarketplaceUrl('https://stockx.com/nike-dunk-low-retro-white-black-2021?size=10&country=US');
  assert.equal(r.ok, true);
  assert.equal(r.marketplace.id, 'stockx');
  assert.equal(r.brandGuess, 'Nike');
  assert.equal(r.nameGuess, 'Dunk Low Retro White Black');
  assert.equal(r.releaseYearGuess, 2021);
  assert.deepEqual(r.sizeGuess, { value: '10', system: 'US-M' });
  assert.equal(r.categoryGuess, 'sneaker');
  // Tracking and other query parameters are not kept.
  assert.equal(r.url, 'https://stockx.com/nike-dunk-low-retro-white-black-2021');

  const gb = parseMarketplaceUrl('www.stockx.com/en-gb/air-jordan-1-retro-high-og-chicago-lost-and-found/');
  assert.equal(gb.ok, true);
  assert.equal(gb.locale, 'en-gb');
  assert.equal(gb.brandGuess, 'Jordan');
  assert.match(gb.nameGuess, /^Air Jordan 1 Retro High OG Chicago Lost and Found$/);
  assert.equal(gb.url, 'https://stockx.com/en-gb/air-jordan-1-retro-high-og-chicago-lost-and-found');

  const httpUpgraded = parseMarketplaceUrl('http://stockx.com/nike-dunk-low-retro-white-black-2021');
  assert.equal(httpUpgraded.ok, true);
  assert.ok(httpUpgraded.url.startsWith('https://'));
});

test('reads GOAT links and their trailing style codes', () => {
  const panda = parseMarketplaceUrl('https://www.goat.com/sneakers/dunk-low-black-white-dd1391-100');
  assert.equal(panda.ok, true);
  assert.equal(panda.styleCodeGuess, 'DD1391-100');
  assert.equal(panda.brandGuess, 'Nike');
  assert.equal(panda.nameGuess, 'Dunk Low Black White');
  assert.equal(panda.categoryGuess, 'sneaker');

  const hoodie = parseMarketplaceUrl('https://goat.com/en-gb/apparel/fear-of-god-essentials-hoodie-black-192sp232050f');
  assert.equal(hoodie.ok, true);
  assert.equal(hoodie.brandGuess, 'Fear of God Essentials');
  assert.equal(hoodie.styleCodeGuess, '192SP232050F');
  assert.equal(hoodie.categoryGuess, 'clothing');
  assert.equal(hoodie.url, 'https://www.goat.com/en-gb/apparel/fear-of-god-essentials-hoodie-black-192sp232050f');

  assert.deepEqual(styleCodeFromTokens(['samba', 'og', 'white', 'b75806']), { code: 'B75806', used: 1 });
  assert.equal(styleCodeFromTokens(['new', 'balance', '990v6']), null, 'model names are not codes');
});

test('guesses watch and clothing categories from the link words', () => {
  assert.equal(parseMarketplaceUrl('https://stockx.com/rolex-submariner-date-41mm-126610ln-black').categoryGuess, 'watch');
  assert.equal(parseMarketplaceUrl('https://stockx.com/supreme-box-logo-hooded-sweatshirt-fw23-black').categoryGuess, 'clothing');
});

test('rejects lookalike hosts, unsafe links and non-product pages', () => {
  const cases = {
    'https://stockx.com.evil.example/nike-dunk-low-retro': 'unsupported_marketplace',
    'https://goat.co/sneakers/dunk-low-black-white-dd1391-100': 'unsupported_marketplace',
    'https://shop.stockx.com/nike-dunk-low-retro-white': 'unsupported_marketplace',
    'https://user:pw@stockx.com/nike-dunk-low-retro-white': 'credentials',
    'https://stockx.com:8443/nike-dunk-low-retro-white': 'port',
    'javascript:alert(1)': 'scheme',
    'data:text/html,hi': 'scheme',
    'ftp://stockx.com/nike-dunk-low-retro-white': 'scheme',
    'https://stockx.com/search?s=dunk': 'not_a_product_page',
    'https://stockx.com/': 'not_a_product_page',
    'https://stockx.com/nike': 'not_a_product_page',
    'https://www.goat.com/search?query=dunk': 'not_a_product_page',
    'https://www.goat.com/sneakers': 'not_a_product_page',
    '': 'empty',
    'not a link at all': 'malformed',
  };
  for (const [input, reason] of Object.entries(cases)) {
    const r = parseMarketplaceUrl(input);
    assert.equal(r.ok, false, input);
    assert.equal(r.reason, reason, input);
    assert.ok(r.message, `${input} has a message`);
  }
  assert.equal(parseMarketplaceUrl(`https://stockx.com/${'a-'.repeat(1100)}b`).reason, 'too_long');
});

test('search URLs point at each marketplace’s own search page', () => {
  assert.equal(MARKETPLACES.stockx.searchUrl('dunk low panda'), 'https://stockx.com/search?s=dunk%20low%20panda');
  assert.equal(MARKETPLACES.goat.searchUrl('dunk low panda'), 'https://www.goat.com/search?query=dunk+low+panda');
  assert.equal(MARKETPLACES.stockx.searchUrl('   '), null);
});

function withNoNetwork(fn) {
  return async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('network access is not allowed');
    };
    try {
      await fn();
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(calls, 0, 'no network requests');
  };
}

test('searchMarketplaces: demo results are catalog products; StockX and GOAT are not connected', withNoNetwork(async () => {
  const { api, as } = await createTestEnv();
  await rejectsWith(api.searchMarketplaces({}, { query: 'dunk' }), 'unauthenticated');
  await rejectsWith(api.searchMarketplaces(await as(JORDAN), { query: 'dunk' }), 'forbidden');
  const alex = await as(ALEX);
  await rejectsWith(api.searchMarketplaces(alex, { query: '  ' }), 'invalid');

  const out = await api.searchMarketplaces(alex, { query: 'olive runner' });
  const byId = Object.fromEntries(out.sources.map((s) => [s.id, s]));
  assert.equal(byId.demo.connected, true);
  assert.ok(byId.demo.results.some((r) => r.product.id === 'kestrel-runner-2'));
  for (const id of ['stockx', 'goat']) {
    assert.equal(byId[id].connected, false);
    assert.deepEqual(byId[id].results, []);
    assert.ok(byId[id].reason);
  }
  assert.equal(byId.stockx.searchUrl, 'https://stockx.com/search?s=olive%20runner');
  assert.equal(byId.goat.searchUrl, 'https://www.goat.com/search?query=olive+runner');

  const only = await api.searchMarketplaces(alex, { query: 'dunk', marketplaceId: 'goat' });
  assert.deepEqual(only.sources.map((s) => s.id), ['goat']);
  const list = await api.listMarketplaces(alex, {});
  assert.deepEqual(list.map((s) => [s.id, s.connected]), [['demo', true], ['stockx', false], ['goat', false]]);
}));

test('importMarketplaceLink returns a draft without a catalog identity', withNoNetwork(async () => {
  const { api, as } = await createTestEnv();
  const alex = await as(ALEX);
  const out = await api.importMarketplaceLink(alex, { url: 'https://www.goat.com/sneakers/dunk-low-black-white-dd1391-100' });
  assert.equal(out.ok, true);
  assert.equal(out.draft.category, 'sneaker');
  assert.deepEqual(out.draft.custom, { brand: 'Nike', name: 'Dunk Low Black White', variantName: null, type: null, colors: [] });
  assert.equal(out.draft.sourceUrl, 'https://www.goat.com/sneakers/dunk-low-black-white-dd1391-100');
  assert.match(out.draft.evidence.detail, /not checked with GOAT/);
  assert.equal(out.draft.productId, undefined);
  assert.deepEqual(out.catalogMatches, [], 'real products are not in the fictional catalog');

  await rejectsWith(api.importMarketplaceLink(alex, { url: 'javascript:alert(1)' }), 'invalid');
  const other = await api.importMarketplaceLink(alex, { url: 'https://northline.example/p/NL-48213' });
  assert.equal(other.ok, false);
  assert.equal(other.reason, 'unsupported_marketplace');
}));
