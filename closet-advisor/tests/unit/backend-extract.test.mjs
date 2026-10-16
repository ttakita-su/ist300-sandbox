// The product page extractor (backend/extract.mjs) on small synthetic pages that reproduce the
// quirks seen on real store pages. No real page is copied here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractProduct, mergeShopifyProduct, shopifyProductJsonUrl, toPage, looksLikeProduct, toMinor, normCurrency, normAvailability, validGtin, stripTracking } from '../../backend/extract.mjs';
import { detectBlock } from '../../backend/net.mjs';

const ld = (value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const page = ({ head = '', body = '' } = {}) => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const usd = (amountMinor) => ({ amountMinor, currency: 'USD' });
const pageOf = (product, finalUrl, requestedUrl = finalUrl) => toPage(product, { requestedUrl, finalUrl, fetchedAt: '2026-10-15T12:00:00.000Z' });

// A GTIN-13 with a valid check digit.
function gtin13(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return `${first12}${(10 - (sum % 10)) % 10}`;
}

test('a ProductGroup of colorways uses the variant whose sku is in the URL; url-only stubs are dropped', () => {
  // Like a model page that lists every colorway at its own price.
  const html = page({
    head: ld({
      '@context': 'https://schema.org',
      '@type': 'ProductGroup',
      name: "Court Classic '07 - Men's",
      brand: { '@type': 'Brand', name: 'Fixture Athletics' },
      productGroupID: 'MODEL-333',
      url: 'https://www.shop.fixture.alt/product/model/court-classic-07/333.html',
      hasVariant: [
        { '@type': 'Product', sku: 'W1111111', color: 'Black/White', image: 'https://cdn.fixture.alt/black.jpg', offers: { '@type': 'Offer', price: '99.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } },
        { '@type': 'Product', sku: 'W2288111', color: 'White/White', image: 'https://cdn.fixture.alt/white.jpg', offers: { '@type': 'Offer', price: '115.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } },
        { '@type': 'Product', sku: 'W3333333', color: 'Red/White', offers: { '@type': 'Offer', price: '125.00', priceCurrency: 'USD', availability: 'https://schema.org/OutOfStock' } },
        { '@type': 'Product', url: 'https://www.shop.fixture.alt/product/~/W4444444.html' },
      ],
    }),
  });
  const url = 'https://www.shop.fixture.alt/product/~/W2288111.html?utm_source=newsletter';
  const p = extractProduct(html, url);
  assert.equal(p.name, "Court Classic '07 - Men's");
  assert.equal(p.brand, 'Fixture Athletics');
  assert.deepEqual(p.price, usd(11500));
  assert.equal(p.color, 'White/White');
  assert.equal(p.sku, 'W2288111');
  assert.equal(p.availability, 'in_stock');
  assert.equal(p.images[0], 'https://cdn.fixture.alt/white.jpg');
  assert.equal(p.variants.length, 1, 'the stub for another colorway is not a variant');
  assert.equal(p.source.price, 'jsonld');

  // The canonical points at the model page, which drops the colorway: keep the URL that was opened
  // (without its tracking parameter).
  const view = pageOf(p, url);
  assert.equal(view.url, 'https://www.shop.fixture.alt/product/~/W2288111.html');
  assert.equal(view.requestedUrl, url);
  assert.equal(view.host, 'shop.fixture.alt');
  assert.deepEqual(view.via, ['json-ld']);
});

test('per-size variants keep their GTINs; the product GTIN stays empty unless there is one variant', () => {
  const sizes = ['8', '8.5', '9'];
  const html = page({
    head: ld({
      '@context': 'https://schema.org',
      '@type': 'ProductGroup',
      name: 'Air Court Low',
      brand: 'Fixture Athletics',
      productGroupID: 'Gx81kQ',
      hasVariant: [
        ...sizes.map((size, i) => ({
          '@type': 'Product',
          size,
          color: 'White/White',
          gtin14: `0${gtin13(`01945008748${i}`)}`,
          offers: { '@type': 'Offer', price: 115, priceCurrency: 'USD', url: `https://shop.fixture.alt/t/air-court-low-Gx81kQ/CW2288-111?size=${size}` },
        })),
        { '@type': 'Product', url: 'https://shop.fixture.alt/t/air-court-low-Gx81kQ/CW2288-001' },
      ],
    }),
  });
  const url = 'https://shop.fixture.alt/t/air-court-low-Gx81kQ/CW2288-111';
  const p = extractProduct(html, url);
  assert.deepEqual(p.price, usd(11500), 'a number price is read without float drift');
  assert.equal(p.gtin, null);
  assert.equal(p.variants.length, 3);
  assert.ok(p.variants.every((v) => validGtin(v.gtin)));
  assert.equal(p.availability, null, 'no availability on the offers stays unknown');
  assert.deepEqual(pageOf(p, url).sizes, sizes);
});

test('@graph pages: a dangling brand @id stays null, a sibling Product fills sku and mpn, reviewed products are ignored', () => {
  const html = page({
    head: ld({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'ProductGroup',
          '@id': '#group',
          name: 'Old Court Shoe',
          brand: { '@id': '#brand-not-on-this-page' },
          hasVariant: [
            { '@type': 'Product', sku: 'VNX-08', size: '8', offers: { '@type': 'Offer', price: '75.00', priceCurrency: 'USD', availability: 'InStock' } },
            { '@type': 'Product', sku: 'VNX-09', size: '9', offers: { '@type': 'Offer', price: '75.00', priceCurrency: 'USD', availability: 'InStock' } },
          ],
        },
        { '@type': 'Product', name: 'Old Court Shoe', sku: 'VNX0D3HY28', mpn: 'VNX0D3HY28', color: 'Black / White', offers: { '@type': 'Offer', price: '75.00', priceCurrency: 'USD' } },
        { '@type': 'Review', itemReviewed: { '@type': 'Product', name: 'Something else', offers: { '@type': 'Offer', price: '1.00', priceCurrency: 'USD' } } },
      ],
    }),
  });
  const p = extractProduct(html, 'https://shop.fixture.alt/en-us/p/old-court-shoe-VNX0D3HY28');
  assert.equal(p.name, 'Old Court Shoe');
  assert.equal(p.brand, null);
  assert.equal(p.sku, 'VNX0D3HY28');
  assert.equal(p.mpn, 'VNX0D3HY28');
  assert.equal(p.color, 'Black / White');
  assert.deepEqual(p.price, usd(7500));
});

test('microdata-only pages: name, brand scope, price, availability, color and a relative image', () => {
  const html = page({
    head: '<title>Canvas High Top | Fixture Canvas</title>',
    body: `<div itemscope itemtype="https://schema.org/Product">
      <h1 itemprop="name">Canvas High Top</h1>
      <div itemprop="brand" itemscope itemtype="https://schema.org/Brand"><meta itemprop="name" content="Fixture Canvas"></div>
      <span itemprop="color">Black</span>
      <img itemprop="image" src="/images/canvas-high-top.jpg?sw=406" alt="">
      <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
        <meta itemprop="price" content="65.00"><meta itemprop="priceCurrency" content="USD">
        <link itemprop="availability" href="https://schema.org/InStock">
        <link itemprop="itemCondition" href="https://schema.org/NewCondition">
      </div></div>`,
  });
  const p = extractProduct(html, 'http://shop.fixture.alt/shop/p/canvas-high-top/M9006MP.html');
  assert.equal(p.name, 'Canvas High Top');
  assert.equal(p.brand, 'Fixture Canvas');
  assert.deepEqual(p.price, usd(6500));
  assert.equal(p.availability, 'in_stock');
  assert.equal(p.condition, 'new');
  assert.equal(p.color, 'Black');
  assert.deepEqual(p.images, ['https://shop.fixture.alt/images/canvas-high-top.jpg?sw=406']);
  assert.equal(p.source.price, 'microdata');
  assert.deepEqual(pageOf(p, 'http://shop.fixture.alt/shop/p/canvas-high-top/M9006MP.html').via, ['microdata']);
});

test('OpenGraph-only pages: the site suffix and zero-width spaces are removed, product:price is read', () => {
  const html = page({
    head: `<title>Something else entirely</title>
      <meta property="og:type" content="product">
      <meta property="og:title" content="​Runner Two – Fixture Store">
      <meta property="og:site_name" content="Fixture Store">
      <meta property="og:image" content="//cdn.fixture.alt/runner-two.jpg">
      <meta property="product:price:amount" content="1.299,95">
      <meta property="product:price:currency" content="EUR">
      <meta name="description" content="A light road runner.">`,
  });
  const p = extractProduct(html, 'https://www.shop.fixture.alt/runner-two');
  assert.equal(p.name, 'Runner Two');
  assert.equal(p.siteName, 'Fixture Store');
  assert.deepEqual(p.images, ['https://cdn.fixture.alt/runner-two.jpg']);
  assert.deepEqual(p.price, { amountMinor: 129995, currency: 'EUR' });
  assert.equal(p.description, 'A light road runner.');
  const view = pageOf(p, 'https://www.shop.fixture.alt/runner-two');
  assert.deepEqual(view.via, ['meta']);
  assert.equal(looksLikeProduct(p, view), true);
});

test('Shopify: the /products/<handle>.js answer (cents) and the .json answer (decimal strings) fill in variants', () => {
  assert.equal(shopifyProductJsonUrl('https://shop.fixture.alt/collections/men/products/tree-runner?variant=1'), 'https://shop.fixture.alt/collections/men/products/tree-runner.js');
  assert.equal(shopifyProductJsonUrl('https://shop.fixture.alt/pages/about'), null);

  const html = page({
    head: `<meta property="og:title" content="Tree Runner"><meta property="og:price:currency" content="USD"><script>Shopify.shop = "fixture.myshopify.com";</script>${ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'Tree Runner', brand: 'Fixture Wool' })}`,
  });
  const p = extractProduct(html, 'https://shop.fixture.alt/products/tree-runner');
  assert.equal(p.platform, 'shopify');
  assert.equal(p.price, null);
  assert.equal(p.currencyHint, 'USD');
  const js = {
    title: 'Tree Runner - Jet Black',
    vendor: 'Fixture Wool',
    price: 10000,
    options: [{ name: 'Size' }],
    images: ['//cdn.shopify.com/s/files/1/0001/files/tree-runner.png?v=1'],
    variants: [
      { sku: 'TR-08', barcode: gtin13('843416184850'), price: 10000, available: false, option1: '8' },
      { sku: 'TR-09', barcode: gtin13('843416184861'), price: 9500, available: true, option1: '9' },
    ],
  };
  const merged = mergeShopifyProduct(p, js, p.currencyHint);
  assert.deepEqual(merged.price, usd(9500), 'the lowest in-stock variant');
  assert.equal(merged.availability, 'in_stock');
  assert.deepEqual(
    merged.variants.map((v) => [v.size, v.availability]),
    [
      ['8', 'out_of_stock'],
      ['9', 'in_stock'],
    ],
  );
  assert.equal(merged.gtin, null, 'two variants: no single GTIN');
  assert.ok(merged.images.includes('https://cdn.shopify.com/s/files/1/0001/files/tree-runner.png?v=1'));
  const view = pageOf(merged, 'https://shop.fixture.alt/products/tree-runner');
  assert.deepEqual(view.via, ['json-ld', 'shopify']);
  assert.deepEqual(view.sizes, ['8', '9']);

  const json = { product: { title: 'Moon Watch', vendor: 'FIXTURE', variants: [{ sku: 'TW-1', barcode: '194366326499', price: '209.00' }] } };
  const single = mergeShopifyProduct(extractProduct(page({ head: '<title>Moon Watch</title>' }), 'https://watch.fixture.alt/products/moon-watch'), json, 'USD');
  assert.deepEqual(single.price, usd(20900));
  assert.equal(single.gtin, '194366326499');
  assert.equal(single.sku, 'TW-1');
  assert.equal(single.availability, null, 'the .json answer has no availability');

  // Shopify cents are hundredths whatever the currency: JPY has no minor digits.
  const yen = mergeShopifyProduct({ ...p, price: null }, { variants: [{ price: 1210000, available: true }] }, 'JPY');
  assert.deepEqual(yen.price, { amountMinor: 12100, currency: 'JPY' });
});

test('entity-encoded JSON-LD text is decoded, including double encoding', () => {
  const html = page({ head: ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'Men&#039;s Court &amp; Street', brand: { '@type': 'Brand', name: 'Fixture &amp;#39;s Lab' }, offers: { '@type': 'Offer', price: '80.0', priceCurrency: 'USD', itemCondition: 'https://schema.org/UsedCondition' } }) });
  const p = extractProduct(html, 'https://shop.fixture.alt/itm/1');
  assert.equal(p.name, "Men's Court & Street");
  assert.equal(p.brand, "Fixture 's Lab");
  assert.deepEqual(p.price, usd(8000));
  assert.equal(p.condition, 'used');
});

test('a relative canonical link is resolved, and it beats og:url', () => {
  const html = page({ head: `<link rel="canonical" href="/us-en/products/watch-spb453"><meta property="og:url" content="https://watch.fixture.alt/us-en/"><meta property="og:title" content="SPB453"><meta property="og:image" content="https://watch.fixture.alt/img/spb453.png">` });
  const p = extractProduct(html, 'https://watch.fixture.alt/us-en/products/watch-spb453?ref=home');
  assert.equal(p.canonicalUrl, 'https://watch.fixture.alt/us-en/products/watch-spb453');
  const view = pageOf(p, 'https://watch.fixture.alt/us-en/products/watch-spb453?ref=home');
  assert.equal(view.url, 'https://watch.fixture.alt/us-en/products/watch-spb453');
  assert.equal(looksLikeProduct(p, view), true, 'a name and an image on a /products/ URL');
});

test('an AggregateOffer gives the low price and a range', () => {
  const html = page({ head: ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'Dunk Low Fixture', offers: { '@type': 'AggregateOffer', lowPrice: 53, highPrice: '178', priceCurrency: 'USD', offerCount: 1311 }, itemCondition: 'NewCondition' }) });
  const p = extractProduct(html, 'https://market.fixture.alt/dunk-low-fixture');
  assert.deepEqual(p.price, usd(5300));
  assert.deepEqual(p.priceRange, { lowMinor: 5300, highMinor: 17800, currency: 'USD' });
  assert.equal(p.condition, 'new');
});

test('money: minor units come from the currency, unknown currencies and missing prices stay null', () => {
  assert.equal(toMinor('1,299.95', 'USD'), 129995);
  assert.equal(toMinor('19,90', 'EUR'), 1990);
  assert.equal(toMinor('USD 1,300.00', 'USD'), 130000);
  assert.equal(toMinor('209.0', 'USD'), 20900);
  assert.equal(toMinor(115, 'USD'), 11500);
  assert.equal(toMinor('12.100', 'JPY'), 12100);
  assert.equal(toMinor('12100', 'JPY'), 12100);
  assert.equal(toMinor('1.2345', 'KWD'), 1235);
  assert.equal(toMinor('0.00', 'USD'), null);
  assert.equal(toMinor('-5', 'USD'), null);
  assert.equal(toMinor('free', 'USD'), null);
  assert.equal(normCurrency('$'), 'USD');
  assert.equal(normCurrency('xyz'), null);

  const yen = extractProduct(page({ head: ld({ '@type': 'Product', name: 'Field Watch', offers: { '@type': 'Offer', price: '12100', priceCurrency: 'JPY' } }) }), 'https://watch.fixture.alt/products/field');
  assert.deepEqual(yen.price, { amountMinor: 12100, currency: 'JPY' });
  const unknown = extractProduct(page({ head: ld({ '@type': 'Product', name: 'Field Watch', offers: { '@type': 'Offer', price: '99', priceCurrency: 'XYZ' } }) }), 'https://watch.fixture.alt/products/field');
  assert.equal(unknown.price, null);

  const noPrice = extractProduct(page({ head: ld({ '@type': 'Product', name: 'Plain Tee', brand: 'Fixture Basics' }) }), 'https://shop.fixture.alt/products/plain-tee');
  assert.equal(noPrice.price, null, 'unknown is null, never 0');
  assert.equal(noPrice.availability, null);
  assert.equal(pageOf(noPrice, 'https://shop.fixture.alt/products/plain-tee').price, null);
});

test('availability and condition use the API values; anything else is null', () => {
  assert.equal(normAvailability('https://schema.org/InStock'), 'in_stock');
  assert.equal(normAvailability('LimitedAvailability'), 'limited');
  assert.equal(normAvailability('SoldOut'), 'out_of_stock');
  assert.equal(normAvailability('https://schema.org/Discontinued'), 'discontinued');
  assert.equal(normAvailability('PreOrder'), 'preorder');
  assert.equal(normAvailability('BackOrder'), 'backorder');
  assert.equal(normAvailability('MadeToOrder'), null);
  assert.equal(normAvailability('ask the shop'), null);
  const damaged = extractProduct(page({ head: ld({ '@type': 'Product', name: 'Worn Pair', itemCondition: 'DamagedCondition', offers: { price: '10', priceCurrency: 'USD' } }) }), 'https://shop.fixture.alt/products/worn');
  assert.equal(damaged.condition, null);
});

test('the Amazon adapter reads pages without JSON-LD', () => {
  const html = page({
    body: `<span id="productTitle" class="a-size-large"> Fixture F91 Digital Watch </span>
      <a id="bylineInfo" href="/stores/Fixture">Visit the Fixture Store</a>
      <div class="twister-plus-buying-options-price-data">{"desktop_buybox_group_1":[{"priceAmount":21.92,"currencySymbol":"$"}]}</div>
      <div id="availability"><span class="primary-availability-message"> In Stock </span></div>
      <input type="hidden" id="ASIN" value="B000FIXTUR">
      <script>var data = {"hiRes":"https://m.media-fixture.alt/images/I/71f91.jpg"};</script>`,
  });
  const p = extractProduct(html, 'https://www.amazon.com/dp/B000FIXTUR');
  assert.equal(p.name, 'Fixture F91 Digital Watch');
  assert.equal(p.brand, 'Fixture');
  assert.deepEqual(p.price, usd(2192));
  assert.equal(p.availability, 'in_stock');
  assert.equal(p.sku, 'B000FIXTUR');
  assert.deepEqual(pageOf(p, 'https://www.amazon.com/dp/B000FIXTUR').via, ['adapter']);
});

test('the API Page: public https images only (at most 8), enums checked, home pages are not products', () => {
  const images = ['https://cdn.fixture.alt/1.jpg', 'https://192.168.0.10/2.jpg', 'https://localhost/3.jpg', ...Array.from({ length: 10 }, (_, i) => `https://cdn.fixture.alt/extra-${i}.jpg`)];
  const html = page({ head: ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'Court Classic', image: images, offers: { '@type': 'Offer', price: '89.00', priceCurrency: 'USD', availability: 'LimitedAvailability' } }) });
  const opened = 'https://shop.fixture.alt/products/court-classic?gclid=abc&color=white';
  const p = extractProduct(html, opened);
  const view = pageOf(p, opened);
  assert.equal(view.images.length, 8);
  assert.ok(view.images.every((u) => u.startsWith('https://cdn.fixture.alt/')));
  assert.equal(view.availability, 'limited');
  assert.equal(view.url, 'https://shop.fixture.alt/products/court-classic?color=white');
  assert.deepEqual(Object.keys(view), ['url', 'requestedUrl', 'host', 'siteName', 'name', 'brand', 'description', 'images', 'price', 'availability', 'condition', 'color', 'sku', 'gtin', 'mpn', 'sizes', 'via', 'fetchedAt']);
  assert.equal(stripTracking('https://shop.fixture.alt/p?utm_campaign=x&fbclid=y&size=10#reviews'), 'https://shop.fixture.alt/p?size=10');

  const home = page({ head: '<title>Fixture Shoe Co. | Shoes for every day</title><meta property="og:type" content="website"><meta property="og:image" content="https://cdn.fixture.alt/banner.jpg">' });
  const h = extractProduct(home, 'https://shop.fixture.alt/');
  assert.equal(looksLikeProduct(h, pageOf(h, 'https://shop.fixture.alt/')), false);
  // A canonical on another site is not trusted.
  const elsewhere = extractProduct(page({ head: '<link rel="canonical" href="https://other.fixture.alt/p/1"><meta property="og:title" content="Thing">' }), 'https://shop.fixture.alt/p/1');
  assert.equal(pageOf(elsewhere, 'https://shop.fixture.alt/p/1').url, 'https://shop.fixture.alt/p/1');
});

test('a 1 MB hostile page (unclosed <meta, <link, <title, itemprop, ld+json) is read in well under 500 ms', () => {
  const MB = 1024 * 1024;
  const fill = (unit, tail = '') => unit.repeat(Math.ceil(MB / unit.length)) + tail;
  const scope = '<div itemscope itemtype="https://schema.org/Product">';
  const pages = {
    meta: fill('<meta '),
    metaOneGt: fill('<meta ', '>'),
    metaGtEvery8k: fill(`${'<meta '.repeat(1400)}>`),
    link: fill('<link '),
    title: fill('<title'),
    lt: fill('<'),
    itemprop: scope + fill('<b itemprop=name>'),
    itempropOneClose: scope + fill('<b itemprop=name>', '</b>'),
    itempropNoGt: scope + fill('<b itemprop=name '),
    ldJson: fill('<script type=application/ld+json>'),
    ldJsonOneClose: fill('<script type=application/ld+json>', '</script>'),
    ldDescription: ld({ '@type': 'Product', name: 'Court Classic', description: '<'.repeat(MB) }),
    amazonTitle: fill('id="productTitle" '),
    amazonAsin: fill('<input id="ASIN" '),
    nextData: fill('<script id="__NEXT_DATA__" '),
    seikoButton: fill('js-productDetail-favorite-dataLayer-add" data-dataLayer-name="x" '),
  };
  const urls = ['https://shop.fixture.alt/products/court-classic', 'https://www.amazon.com/dp/B000GAWSDG', 'https://www.goat.com/sneakers/x', 'https://www.seikowatches.com/us-en/products/x'];
  for (const [name, html] of Object.entries(pages)) {
    const bytes = Buffer.from(html);
    for (const url of urls) {
      const started = performance.now();
      extractProduct(html, url);
      detectBlock(200, 'text/html', bytes);
      detectBlock(200, 'text/html', bytes.subarray(0, 39000));
      const ms = performance.now() - started;
      assert.ok(ms < 500, `${name} on ${url}: ${ms.toFixed(0)} ms`);
    }
  }
});

test('the bounded scans still read normal pages: meta, link, title, microdata and JSON-LD', () => {
  const html = page({
    head: `<title>Court Classic | Fixture Shoe Co.</title><meta property="og:title" content="Court Classic"><meta property="og:site_name" content="Fixture Shoe Co."><link rel="canonical" href="https://shop.fixture.alt/products/court-classic">${ld({ '@type': 'Product', name: 'Court Classic', offers: { price: '89.00', priceCurrency: 'USD' } })}`,
    body: '<div itemscope itemtype="https://schema.org/Product"><span itemprop="brand">Fixture Athletics</span><span itemprop="color">White</span></div>',
  });
  const p = extractProduct(html, 'https://shop.fixture.alt/products/court-classic?utm_source=x');
  assert.equal(p.name, 'Court Classic');
  assert.equal(p.brand, 'Fixture Athletics');
  assert.equal(p.color, 'White');
  assert.deepEqual(p.price, usd(8900));
  assert.equal(p.canonicalUrl, 'https://shop.fixture.alt/products/court-classic');
  assert.equal(p.siteName, 'Fixture Shoe Co.');
  const titled = extractProduct(page({ head: '<title>\n  Canvas High Top | Fixture Shoe Co.\n</title>' }), 'https://shop.fixture.alt/products/canvas');
  assert.equal(titled.name, 'Canvas High Top | Fixture Shoe Co.');
});

test('prices with space or apostrophe thousands separators are read whole; exponent forms are null', () => {
  assert.equal(toMinor('1 299,95', 'EUR'), 129995);
  assert.equal(toMinor('1 299,95 €', 'EUR'), 129995);
  assert.equal(toMinor('1 299,95 €', 'EUR'), 129995);
  assert.equal(toMinor('12 500', 'JPY'), 12500);
  assert.equal(toMinor("CHF 1'299.95", 'CHF'), 129995);
  assert.equal(toMinor('1e3', 'USD'), null);
  assert.equal(toMinor(1e21, 'USD'), null);
  // Unchanged: the first number only, and plain prices.
  assert.equal(toMinor('100 - 200', 'USD'), 10000);
  assert.equal(toMinor('2 for 30', 'USD'), 200);
  assert.equal(toMinor('1,299.95', 'USD'), 129995);
  const p = extractProduct(page({ head: ld({ '@type': 'Product', name: 'Montre', offers: { price: '1 299,95', priceCurrency: 'EUR' } }) }), 'https://shop.fixture.alt/products/montre');
  assert.deepEqual(p.price, { amountMinor: 129995, currency: 'EUR' });
});

test('the Seiko adapter applies to product pages only, so home and collection pages are not products', () => {
  const home = page({ head: '<title>Seiko Watch Corporation</title><meta property="og:image" content="https://www.seikowatches.com/hero.jpg">', body: '<h1>Seiko</h1>' });
  for (const url of ['https://www.seikowatches.com/us-en', 'https://www.seikowatches.com/us-en/collections/prospex']) {
    const p = extractProduct(home, url);
    assert.equal(p.brand, null, url);
    assert.equal(looksLikeProduct(p, pageOf(p, url)), false, url);
  }
  const product = page({
    head: '<title>SPB143 | Seiko Watch Corporation</title>',
    body: '<div class="productInformation-detail"><p class="_price"> USD 1,200.00</p></div><button class="js-productDetail-favorite-dataLayer-add" data-dataLayer-name="SPB143" data-dataLayer-brand="Prospex">Favorite</button>',
  });
  const url = 'https://www.seikowatches.com/us-en/products/prospex/spb143';
  const p = extractProduct(product, url);
  assert.deepEqual([p.brand, p.sku, p.source.brand], ['Seiko', 'SPB143', 'adapter:seiko']);
  assert.deepEqual(p.price, usd(120000));
  assert.equal(looksLikeProduct(p, pageOf(p, url)), true);
});

test('a product group with 150,000 variants is read without overflowing the stack', () => {
  const variants = Array.from({ length: 150000 }, (_, i) => ({ '@type': 'Product', sku: `V${i}`, offers: { '@type': 'Offer', price: '89.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } }));
  const html = page({ head: ld({ '@type': 'ProductGroup', name: 'Court Classic', hasVariant: variants }) });
  const p = extractProduct(html, 'https://shop.fixture.alt/products/court-classic');
  assert.equal(p.name, 'Court Classic');
  assert.deepEqual(p.price, usd(8900));
  assert.ok(p.variants.length <= 60);
});
