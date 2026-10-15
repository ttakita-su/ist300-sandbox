// Commerce: offer comparison, affiliate links, clicks, conversion reporting and URL import safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../../js/data/catalog-index.js';
import { staticCatalog } from '../../js/server/catalog-repo.js';
import { listOffers } from '../../js/server/providers/offers.js';
import { compareOffers, orderRows, freshness, offerTotal, summarizeOffers, AFFILIATE_DISCLOSURE } from '../../js/engine/offers.js';
import { buildOutboundUrl, newClickRef } from '../../js/engine/affiliate.js';
import { reconcileConversions, summarize, demoConversionEvents } from '../../js/engine/conversions.js';
import { validateImportUrl, checkRedirectChain, resolveRetailerUrl, parseIPv6, isBlockedIPv6 } from '../../js/server/urlsafety.js';
import { ApiError } from '../../js/server/errors.js';
import { createTestEnv, rejectsWith, ALEX, JORDAN, NOW } from '../helpers.mjs';

// ---------- Fixtures ----------

const HOUR = 3600000;
const ago = (hours) => new Date(NOW - hours * HOUR).toISOString();
const US = (value) => ({ value, system: 'US-M' });
const RUNNER = 'fx-runner--black';
const WATCH = 'fx-watch--38';
const APPROVED = { networkId: 'demo-network', programId: 'fx-1', status: 'approved', allowedParams: ['aff_id', 'sub_id'], paramValues: { aff_id: 'rotation-demo' } };

const retailer = (id, overrides = {}) => ({
  id,
  name: `${id[0].toUpperCase()}${id.slice(1)} Goods`,
  domain: `${id}.example`,
  kind: 'retailer',
  categories: ['sneaker', 'watch'],
  affiliate: null,
  returnsPolicy: null,
  urlPattern: '/p/{listingId}',
  ...overrides,
});

const RETAILERS = [
  retailer('alpha', { affiliate: APPROVED }),
  retailer('beta'),
  retailer('gamma', { affiliate: { ...APPROVED, programId: 'fx-3', status: 'pending', allowedParams: ['aff'], paramValues: { aff: 'rotation' } } }),
  retailer('delta', { kind: 'marketplace', affiliate: { ...APPROVED, programId: 'fx-4', allowedParams: ['ref'], paramValues: { ref: 'rotation' } } }),
  retailer('epsilon'),
];

const sized = (values, priceMinor, { out = [], low = [] } = {}) =>
  values.map((value) => ({ value, system: 'US-M', priceMinor, stock: out.includes(value) ? 'out_of_stock' : low.includes(value) ? 'low_stock' : 'in_stock' }));

/** An unsized offer for the fixture watch unless overridden. Free shipping, no fees, tax unknown. */
function offer(id, overrides = {}) {
  const retailerId = overrides.retailerId ?? 'alpha';
  const listingId = overrides.listingId ?? id.toUpperCase();
  return {
    id,
    retailerId,
    listingId,
    variantId: WATCH,
    condition: 'new',
    sellerType: 'retailer',
    includedComponents: null,
    sizes: null,
    priceMinor: 10000,
    stock: 'in_stock',
    currency: 'USD',
    shipping: { kind: 'free' },
    fees: { kind: 'none' },
    tax: { kind: 'unknown' },
    delivery: { minDays: 3, maxDays: 5 },
    returns: 'Returns within 30 days',
    warranty: { kind: 'unknown' },
    url: `https://${retailerId}.example/p/${listingId}`,
    listingStatus: 'active',
    lastCheckedAt: ago(2),
    ...overrides,
  };
}

/** A sized offer for the fixture runner. */
const shoe = (id, overrides = {}) => offer(id, { variantId: RUNNER, ...overrides });

function fixtureCatalog(offers = []) {
  return buildCatalog({
    version: 'fixture',
    brands: [{ id: 'fx', name: 'Fixture', categories: ['sneaker', 'watch'] }],
    products: [
      { id: 'fx-runner', category: 'sneaker', type: 'runner', brandId: 'fx', name: 'Runner', styleTags: [], materials: [], features: [], description: '', sizing: { system: 'US-M', sizes: ['9', '9.5', '10', '10.5', '11'] }, attributes: { cut: 'low' }, sources: [], illustration: { kind: 'sneaker', shape: 'runner' } },
      { id: 'fx-watch', category: 'watch', type: 'field', brandId: 'fx', name: 'Field', styleTags: [], materials: [], features: [], description: '', sizing: null, attributes: {}, sources: [], illustration: { kind: 'watch', shape: 'round' } },
    ],
    variants: [
      { id: 'fx-runner--black', productId: 'fx-runner', name: 'Black', identifiers: { styleCode: 'FXR-001' }, colors: [], attributes: { colorway: 'Black' }, msrpMinor: 10000, currency: 'USD', release: null, illustration: { palette: {} } },
      { id: 'fx-runner--white', productId: 'fx-runner', name: 'White', identifiers: { styleCode: 'FXR-002' }, colors: [], attributes: { colorway: 'White' }, msrpMinor: 10000, currency: 'USD', release: null, illustration: { palette: {} } },
      { id: 'fx-watch--38', productId: 'fx-watch', name: '38 mm', identifiers: { reference: 'FW38-BK' }, colors: [], attributes: { diameterMm: 38 }, msrpMinor: 40000, currency: 'USD', release: null, illustration: { palette: {} } },
      { id: 'fx-watch--40', productId: 'fx-watch', name: '40 mm', identifiers: { reference: 'FW40-BK' }, colors: [], attributes: { diameterMm: 40 }, msrpMinor: 42000, currency: 'USD', release: null, illustration: { palette: {} } },
    ],
    images: [],
    retailers: RETAILERS,
    offers,
  });
}

function compare(offers, opts = {}) {
  const catalog = opts.catalog ?? fixtureCatalog(offers);
  return compareOffers({ catalog, offers, variantId: WATCH, now: NOW, freshnessHours: 24, ...opts });
}

const ids = (rows) => rows.map((r) => r.offerId);

// ---------- Grouping and separation ----------

test('rows are offers for exactly one reference: AF38 and AF40 never merge', () => {
  const watchOffers = [
    offer('w38-dealer', { priceMinor: 40000, sellerType: 'authorized_dealer', warranty: { kind: 'manufacturer', months: 24, provider: 'Fixture' } }),
    offer('w38-used', { retailerId: 'beta', condition: 'used_good', priceMinor: 30000 }),
    offer('w40-dealer', { variantId: 'fx-watch--40', retailerId: 'epsilon', priceMinor: 42000 }),
  ];
  const v38 = compare(watchOffers, { variantId: WATCH });
  const v40 = compare(watchOffers, { variantId: 'fx-watch--40' });
  assert.deepEqual(ids(v38.rows).sort(), ['w38-dealer', 'w38-used']);
  assert.deepEqual(ids(v40.rows), ['w40-dealer']);
  assert.equal(v38.retailersChecked, 2);
  assert.equal(v40.retailersChecked, 1);

  // The real catalog: even if both references' offers are passed together, rows stay per reference.
  const catalog = staticCatalog();
  const mixed = [...listOffers(catalog, 'arden-field--af38-sl-bk', NOW), ...listOffers(catalog, 'arden-field--af40-sl-bk', NOW)];
  for (const variantId of ['arden-field--af38-sl-bk', 'arden-field--af40-sl-bk']) {
    const view = compareOffers({ catalog, offers: mixed, variantId, now: NOW });
    for (const row of [...view.rows, ...view.unavailable]) assert.equal(catalog.offers.get(row.offerId).variantId, variantId);
  }
});

test('sizes and conditions are never merged, and used stays distinguishable from new', () => {
  const offers = [
    shoe('a-new', { sizes: sized(['9', '9.5', '10', '10.5', '11'], 10000, { out: ['11'] }) }),
    shoe('b-used', { retailerId: 'beta', condition: 'used_good', sizes: sized(['10'], 6000) }),
    shoe('c-used', { retailerId: 'delta', condition: 'used_like_new', sizes: sized(['9.5'], 7000) }),
    shoe('white', { variantId: 'fx-runner--white', retailerId: 'epsilon', sizes: sized(['10'], 5000) }),
  ];
  const both = compare(offers, { variantId: RUNNER, size: US('10'), condition: 'new_or_used' });
  assert.deepEqual(ids(both.rows).sort(), ['a-new', 'b-used']);
  assert.deepEqual(both.rows.map((r) => r.size), [US('10'), US('10')]);
  assert.deepEqual(both.rows.map((r) => r.condition).sort(), ['new', 'used_good']);
  assert.equal(both.rows.find((r) => r.offerId === 'b-used').priceMinor, 6000);

  const newOnly = compare(offers, { variantId: RUNNER, size: US('10'), condition: 'new_only' });
  assert.deepEqual(ids(newOnly.rows), ['a-new']);
  // c-used is hidden by condition too, but it isn't in size 10, so switching filters wouldn't show it.
  assert.equal(newOnly.hiddenByCondition, 1);

  const exact = compare(offers, { variantId: RUNNER, size: US('10'), condition: 'used_good' });
  assert.deepEqual(ids(exact.rows), ['b-used']);
  assert.equal(exact.hiddenByCondition, 1);

  const other = compare(offers, { variantId: RUNNER, size: US('9.5') });
  assert.deepEqual(ids(other.rows).sort(), ['a-new', 'c-used']);
  assert.equal(other.rows.find((r) => r.offerId === 'c-used').condition, 'used_like_new');
});

test('watch rows keep seller type, included components and the warranty as stated', () => {
  const offers = [
    offer('ad', { priceMinor: 40000, sellerType: 'authorized_dealer', includedComponents: ['box', 'papers', 'warranty card'], warranty: { kind: 'manufacturer', months: 24, provider: 'Fixture' } }),
    offer('indie', { retailerId: 'beta', condition: 'used_good', priceMinor: 30000, sellerType: 'independent_dealer', includedComponents: ['box'], warranty: { kind: 'seller', months: 12, provider: 'Dealer' } }),
    offer('private', { retailerId: 'delta', condition: 'used_fair', priceMinor: 25000, sellerType: 'private_seller', includedComponents: [], warranty: { kind: 'unknown' } }),
    offer('grey', { retailerId: 'epsilon', priceMinor: 36000, sellerType: 'marketplace_seller', includedComponents: null, warranty: { kind: 'manufacturer', months: 24 } }),
  ];
  const view = compare(offers);
  const row = (id) => view.rows.find((r) => r.offerId === id);
  assert.equal(view.needsSize, false);
  assert.deepEqual(view.sizeOptions, []);
  assert.equal(row('ad').sellerType, 'authorized_dealer');
  assert.deepEqual(row('ad').includedComponents, ['box', 'papers', 'warranty card']);
  assert.deepEqual(row('ad').warranty, { kind: 'manufacturer', months: 24, provider: 'Fixture' });
  assert.equal(row('ad').warrantyNote, null);
  assert.deepEqual(row('indie').warranty, { kind: 'seller', months: 12, provider: 'Dealer' });
  assert.deepEqual(row('indie').includedComponents, ['box']);
  // [] means "watch only" as stated; null means the listing doesn't say.
  assert.deepEqual(row('private').includedComponents, []);
  assert.equal(row('private').warranty.kind, 'unknown');
  assert.equal(row('grey').includedComponents, null);
  // Only authorized dealers carry a manufacturer warranty; a claim from anyone else isn't presented as one.
  assert.equal(row('grey').warranty.kind, 'unknown');
  assert.equal(row('grey').warranty.claimed, 'manufacturer');
  assert.match(row('grey').warrantyNote, /authorized dealer/);
  assert.notEqual(row('ad').includedComponents, offers[0].includedComponents, 'rows copy arrays');
});

// ---------- Totals ----------

test('unknown shipping, fees and tax are never treated as zero', () => {
  const view = compare([
    offer('unknowns', { shipping: { kind: 'unknown' }, fees: { kind: 'unknown' }, tax: { kind: 'unknown' } }),
    offer('checkout', { retailerId: 'beta', shipping: { kind: 'calculated_at_checkout' } }),
    offer('flat-no-amount', { retailerId: 'delta', shipping: { kind: 'flat' }, fees: { kind: 'known', label: 'Service fee' } }),
    offer('known', { retailerId: 'epsilon', shipping: { kind: 'flat', amountMinor: 800 }, fees: { kind: 'known', amountMinor: 400 }, tax: { kind: 'estimate', amountMinor: 700 } }),
  ]);
  const row = (id) => view.rows.find((r) => r.offerId === id);
  assert.deepEqual(row('unknowns').missing, ['shipping', 'fees', 'tax']);
  assert.equal(row('unknowns').totalComplete, false);
  assert.equal(row('unknowns').totalKnownMinor, 10000, 'only the known price is summed');
  assert.equal(row('unknowns').preTaxMinor, null);
  assert.equal(row('unknowns').totalLabel, 'Total before shipping, fees and tax');
  assert.deepEqual(row('unknowns').shipping, { kind: 'unknown' }, 'no amount is invented');
  assert.deepEqual(row('checkout').missing, ['shipping', 'tax']);
  assert.deepEqual(row('flat-no-amount').missing, ['shipping', 'fees', 'tax'], 'a flat rate or fee without an amount is unknown');
  assert.equal(row('known').totalComplete, true);
  assert.equal(row('known').totalKnownMinor, 10000 + 800 + 400 + 700);
  assert.equal(row('known').preTaxMinor, 11200);
  assert.equal(row('known').totalLabel, 'Total');

  assert.deepEqual(offerTotal(offer('x'), null), { totalKnownMinor: null, totalComplete: false, missing: ['price'] });
  assert.deepEqual(offerTotal(offer('x', { shipping: { kind: 'flat' } }), 5000), { totalKnownMinor: 5000, totalComplete: false, missing: ['shipping', 'tax'] });
  assert.deepEqual(offerTotal(offer('x', { tax: { kind: 'estimate', amountMinor: 400 } }), 5000), { totalKnownMinor: 5400, totalComplete: true, missing: [] });
});

test('lowest label compares totals before tax when any compared offer has no tax estimate', () => {
  const view = compare([
    offer('a', { priceMinor: 10000, shipping: { kind: 'flat', amountMinor: 900 } }),
    offer('b', { retailerId: 'beta', priceMinor: 10500, tax: { kind: 'estimate', amountMinor: 840 } }),
    offer('c', { retailerId: 'epsilon', priceMinor: 9900, shipping: { kind: 'flat', amountMinor: 1200 } }),
  ]);
  assert.deepEqual(view.lowest, { offerId: 'b', label: 'Lowest total before tax among 3 checked offers' });
  assert.equal(view.lowestNote, null);
  assert.deepEqual(ids(view.rows), ['b', 'a', 'c'], 'ordered by the same before-tax totals');
});

test('lowest label uses complete totals when every compared offer estimates tax', () => {
  const view = compare([
    offer('a', { priceMinor: 10000, tax: { kind: 'estimate', amountMinor: 900 } }),
    offer('b', { retailerId: 'beta', priceMinor: 10100, tax: { kind: 'estimate', amountMinor: 0 } }),
    offer('c', { retailerId: 'epsilon', priceMinor: 12000, tax: { kind: 'estimate', amountMinor: 960 } }),
  ]);
  // Before tax "a" is cheaper, but its complete total is higher.
  assert.deepEqual(view.lowest, { offerId: 'b', label: 'Lowest known total among 3 checked offers' });
  assert.deepEqual(ids(view.rows), ['b', 'a', 'c']);
});

test('no lowest claim when a compared offer lacks shipping or fee information', () => {
  const shippingGaps = compare([
    offer('a', { priceMinor: 12000 }),
    offer('b', { retailerId: 'beta', priceMinor: 9000, shipping: { kind: 'unknown' } }),
    offer('c', { retailerId: 'epsilon', priceMinor: 9500, shipping: { kind: 'calculated_at_checkout' } }),
  ]);
  assert.equal(shippingGaps.lowest, null);
  assert.equal(shippingGaps.lowestNote, "2 offers don't list shipping, so totals can't be compared.");

  const feeGap = compare([offer('a'), offer('b', { retailerId: 'beta', fees: { kind: 'unknown' } })]);
  assert.equal(feeGap.lowest, null);
  assert.equal(feeGap.lowestNote, "1 offer doesn't list fees, so totals can't be compared.");

  const both = compare([offer('a'), offer('b', { retailerId: 'beta', fees: { kind: 'unknown' } }), offer('c', { retailerId: 'epsilon', shipping: { kind: 'unknown' } })]);
  assert.equal(both.lowestNote, "2 offers don't list shipping or fees, so totals can't be compared.");
});

test('a single offer, a tie or mixed currencies make no lowest claim', () => {
  const single = compare([offer('a')]);
  assert.equal(single.lowest, null);
  assert.match(single.lowestNote, /^Only 1 offer is listed as in stock/);

  const tie = compare([offer('a', { priceMinor: 10000 }), offer('b', { retailerId: 'beta', priceMinor: 10000 })]);
  assert.equal(tie.lowest, null);
  assert.equal(tie.lowestNote, '2 offers tie for the lowest total before tax.');

  const currencies = compare([offer('a'), offer('b', { retailerId: 'beta', currency: 'EUR', priceMinor: 9000 })]);
  assert.equal(currencies.lowest, null);
  assert.match(currencies.lowestNote, /different currencies/);
});

test('stale offers are flagged, ranked after fresh ones and excluded from price claims', () => {
  const view = compare([
    offer('fresh-a', { priceMinor: 11000, lastCheckedAt: ago(1) }),
    offer('stale-cheap', { retailerId: 'beta', priceMinor: 8000, lastCheckedAt: ago(30) }),
    offer('aging-c', { retailerId: 'epsilon', priceMinor: 12000, lastCheckedAt: ago(15) }),
  ]);
  assert.deepEqual(ids(view.rows), ['fresh-a', 'aging-c', 'stale-cheap']);
  assert.deepEqual(view.rows.map((r) => r.freshness), ['fresh', 'aging', 'stale']);
  assert.deepEqual(view.lowest, { offerId: 'fresh-a', label: 'Lowest total before tax among 2 checked offers' });
  assert.equal(view.notice, '1 offer was last checked more than 24 hours ago, so its price may have changed.');

  const allStale = compare([offer('a', { lastCheckedAt: ago(30) }), offer('b', { retailerId: 'beta', lastCheckedAt: ago(40) })]);
  assert.equal(allStale.lowest, null);
  assert.match(allStale.lowestNote, /checked in the last 24 hours/);

  const shortWindow = compare([offer('a', { lastCheckedAt: ago(1) }), offer('b', { retailerId: 'beta', lastCheckedAt: ago(8), priceMinor: 5000 })], { freshnessHours: 6 });
  assert.equal(shortWindow.rows.find((r) => r.offerId === 'b').freshness, 'stale', 'a window under 12 hours still applies');
  assert.equal(shortWindow.lowest, null);

  assert.equal(freshness(ago(8), NOW, 24), 'fresh');
  assert.equal(freshness(ago(13), NOW, 24), 'aging');
  assert.equal(freshness(ago(24), NOW, 24), 'stale');
  assert.equal(freshness(null, NOW), 'stale');
  assert.equal(freshness('not a date', NOW), 'stale');
});

test('removed listings and out-of-stock offers move to unavailable with a reason', () => {
  const offers = [
    shoe('live', { sizes: sized(['10', '11'], 10000) }),
    shoe('oos-11', { retailerId: 'beta', sizes: sized(['10', '11'], 9000, { out: ['11'] }) }),
    shoe('removed', { retailerId: 'epsilon', sizes: sized(['10', '11'], 8000), listingStatus: 'removed' }),
  ];
  const view = compare(offers, { variantId: RUNNER, size: US('11') });
  assert.deepEqual(ids(view.rows), ['live']);
  assert.deepEqual(ids(view.unavailable), ['oos-11', 'removed'], 'listings that may restock come before removed ones');
  assert.equal(view.unavailable[0].reason, 'Out of stock in US M 11.');
  assert.equal(view.unavailable[1].reason, 'The retailer removed this listing.');
  assert.equal(view.rows[0].reason, null);

  const watch = compare([offer('w-oos', { stock: 'out_of_stock' })]);
  assert.equal(watch.unavailable[0].reason, 'Out of stock.');
  assert.equal(watch.rows.length, 0);
  assert.equal(watch.notice, 'No checked offer is in stock right now.');

  const everySize = compare([shoe('gone', { sizes: sized(['10', '11'], 9000, { out: ['10', '11'] }) })], { variantId: RUNNER });
  assert.equal(everySize.unavailable[0].reason, 'Out of stock in every size.');
});

test('rows are ordered by benefit to the person, never by commission', () => {
  const offers = [
    offer('affiliate-pricier', { retailerId: 'alpha', priceMinor: 12000 }),
    offer('plain-cheaper', { retailerId: 'beta', priceMinor: 11000 }),
    offer('cheapest-unknown-shipping', { retailerId: 'epsilon', priceMinor: 9000, shipping: { kind: 'unknown' } }),
    offer('low-stock', { retailerId: 'delta', priceMinor: 11500, stock: 'low_stock' }),
  ];
  const view = compare(offers);
  assert.equal(view.rows.find((r) => r.offerId === 'affiliate-pricier').affiliate, true);
  assert.equal(view.rows.find((r) => r.offerId === 'plain-cheaper').affiliate, false);
  assert.deepEqual(ids(view.rows), ['plain-cheaper', 'low-stock', 'affiliate-pricier', 'cheapest-unknown-shipping']);

  // Same offers with every affiliate program removed: identical order.
  const plainRetailers = RETAILERS.map((r) => ({ ...r, affiliate: null }));
  const plainCatalog = buildCatalog({ ...fixtureData(offers), retailers: plainRetailers });
  assert.deepEqual(ids(compare(offers, { catalog: plainCatalog }).rows), ids(view.rows));

  // Input order doesn't matter.
  assert.deepEqual(ids(compare([...offers].reverse()).rows), ids(view.rows));
  assert.deepEqual(ids(orderRows([...view.rows].reverse())), ids(view.rows));

  // Same price: faster delivery first, then new before used.
  const ties = compare([
    offer('slow', { delivery: { minDays: 5, maxDays: 9 } }),
    offer('fast', { retailerId: 'beta', delivery: { minDays: 1, maxDays: 2 } }),
    offer('used', { retailerId: 'epsilon', condition: 'used_like_new', delivery: { minDays: 1, maxDays: 2 } }),
  ]);
  assert.deepEqual(ids(ties.rows), ['fast', 'used', 'slow']);
});

function fixtureData(offers) {
  const c = fixtureCatalog(offers);
  return { version: 'fixture', brands: [...c.brands.values()], products: [...c.products.values()], variants: [...c.variants.values()], images: [], retailers: [...c.retailers.values()], offers };
}

// ---------- Sizes ----------

test('a sized product with no size chosen asks for one and lists the sizes', () => {
  const offers = [
    shoe('a', { sizes: sized(['9', '10', '11'], 10000, { out: ['11'] }) }),
    shoe('b', { retailerId: 'beta', sizes: sized(['10', '10.5'], 9500) }),
  ];
  const view = compare(offers, { variantId: RUNNER, size: null });
  assert.equal(view.needsSize, true);
  assert.equal(view.size, null);
  assert.deepEqual(
    view.sizeOptions.map((o) => [o.size.value, o.offerCount, o.inStock]),
    [['9', 1, true], ['9.5', 0, false], ['10', 2, true], ['10.5', 1, true], ['11', 0, false]],
  );
  assert.ok(view.sizeOptions.every((o) => o.size.system === 'US-M'));
  assert.ok(view.rows.every((r) => r.size === null), 'rows show "from" prices, not a size');
  assert.equal(view.lowest, null);
  assert.equal(view.lowestNote, 'Choose a size to compare totals.');
  assert.match(view.notice, /Choose a size/);
  assert.deepEqual(view.otherSizes, []);

  const chosen = compare(offers, { variantId: RUNNER, size: { value: ' 10 ', system: 'US-M' } });
  assert.equal(chosen.needsSize, false);
  assert.deepEqual(chosen.size, US('10'));
});

test('otherSizes lists in-stock sizes when the chosen size has no stock', () => {
  const offers = [
    shoe('a', { sizes: sized(['9', '10', '11'], 10000, { out: ['11'] }) }),
    shoe('b', { retailerId: 'beta', sizes: sized(['10', '10.5'], 9500) }),
  ];
  const view = compare(offers, { variantId: RUNNER, size: US('11') });
  assert.deepEqual(view.rows, []);
  assert.deepEqual(ids(view.unavailable), ['a']);
  assert.deepEqual(view.otherSizes.map((o) => [o.size.value, o.offerCount, o.inStock]), [['9', 1, true], ['10', 2, true], ['10.5', 1, true]]);
  assert.equal(view.notice, 'No checked offer has US M 11 in stock. Other sizes are in stock.');
  assert.equal(view.lowest, null);

  assert.deepEqual(compare(offers, { variantId: RUNNER, size: US('10') }).otherSizes, [], 'only when the chosen size has no stock');
  assert.deepEqual(compare([offer('w')]).otherSizes, []);
});

// ---------- Disclosure ----------

test('the disclosure names the retailers checked and any affiliate relationship', () => {
  const withAffiliate = compare([offer('a'), offer('b', { retailerId: 'beta' }), offer('c', { retailerId: 'gamma' })]);
  assert.equal(withAffiliate.retailersChecked, 3);
  assert.equal(
    withAffiliate.disclosure,
    `Rotation checked 3 retailers for this version. Other stores may have different prices or stock. ${AFFILIATE_DISCLOSURE}`,
  );
  assert.equal(AFFILIATE_DISCLOSURE, "Rotation may earn a commission from links marked Affiliate. It doesn't change your price or the order of offers.");
  // A pending program is not an affiliate link yet.
  assert.equal(withAffiliate.rows.find((r) => r.offerId === 'c').affiliate, false);

  const plain = compare([offer('b', { retailerId: 'beta' }), offer('c', { retailerId: 'gamma' })]);
  assert.match(plain.disclosure, /^Rotation checked 2 retailers for this version\. Other stores may have different prices or stock\. None of these links earn Rotation a commission\.$/);

  const none = compare([], { variantId: 'fx-runner--white' });
  assert.equal(none.retailersChecked, 0);
  assert.equal(none.disclosure, 'Rotation checks 5 retailers. Other stores may still sell this version.');
  assert.equal(none.notice, 'None of the retailers Rotation checks list this version right now.');
});

// ---------- Real catalog invariants ----------

test('real catalog: every variant, size and condition gives an honest OffersView', () => {
  const catalog = staticCatalog();
  const plainCatalog = buildCatalog({
    version: catalog.version,
    brands: [...catalog.brands.values()],
    products: [...catalog.products.values()],
    variants: [...catalog.variants.values()],
    images: [...catalog.images.values()],
    retailers: [...catalog.retailers.values()].map((r) => ({ ...r, affiliate: null })),
    offers: [...catalog.offers.values()],
  });
  let views = 0;
  for (const variant of catalog.variants.values()) {
    const product = catalog.product(variant.productId);
    const sizes = [null, ...(product.sizing?.sizes ?? []).map((value) => ({ value, system: product.sizing.system }))];
    const offers = listOffers(catalog, variant.id, NOW);
    for (const size of sizes) {
      for (const condition of ['new_only', 'new_or_used', 'used_good']) {
        const view = compareOffers({ catalog, offers, variantId: variant.id, size, condition, now: NOW, freshnessHours: 24 });
        views += 1;
        const where = `${variant.id} ${size?.value ?? 'no size'} ${condition}`;
        for (const row of [...view.rows, ...view.unavailable]) {
          const source = catalog.offers.get(row.offerId);
          assert.equal(source.variantId, variant.id, where);
          assert.ok(['new', 'used_like_new', 'used_good', 'used_fair'].includes(row.condition), where);
          if (condition === 'new_only') assert.equal(row.condition, 'new', where);
          if (size && row.size) assert.deepEqual(row.size, size, where);
          // Unknown parts never add to the known total.
          const known = (row.priceMinor ?? 0) + (row.shipping.kind === 'flat' ? row.shipping.amountMinor ?? 0 : 0) + (row.fees.kind === 'known' ? row.fees.amountMinor ?? 0 : 0) + (row.tax.kind === 'estimate' ? row.tax.amountMinor ?? 0 : 0);
          if (row.priceMinor != null) assert.equal(row.totalKnownMinor, known, where);
          assert.equal(row.totalComplete, row.missing.length === 0, where);
        }
        for (const row of view.rows) {
          assert.equal(row.listingStatus, 'active', where);
          assert.notEqual(row.stock, 'out_of_stock', where);
        }
        for (const row of view.unavailable) assert.ok(row.reason, where);
        assert.deepEqual(ids(orderRows(view.rows)), ids(view.rows), where);
        if (view.lowest) {
          const row = view.rows.find((r) => r.offerId === view.lowest.offerId);
          assert.ok(row && row.freshness !== 'stale' && ['in_stock', 'low_stock'].includes(row.stock), where);
          assert.match(view.lowest.label, /^Lowest (known total|total before tax) among \d+ checked offers$/, where);
          for (const r of view.rows.filter((x) => x.freshness !== 'stale')) assert.ok(!r.missing.includes('shipping') && !r.missing.includes('fees'), where);
        }
        assert.ok(view.disclosure.includes(view.retailersChecked ? `checked ${view.retailersChecked} retailer` : 'Other stores may still sell'), where);
        // Ordering and claims don't change when no affiliate program exists at all.
        const plain = compareOffers({ catalog: plainCatalog, offers, variantId: variant.id, size, condition, now: NOW, freshnessHours: 24 });
        assert.deepEqual(ids(plain.rows), ids(view.rows), where);
        assert.deepEqual(plain.lowest, view.lowest, where);
      }
    }
  }
  assert.ok(views > 50);
});

test('summarizeOffers keeps its contract for recommendations', () => {
  const catalog = staticCatalog();
  const summary = summarizeOffers({ offers: listOffers(catalog, 'vela-court-low--white-gum', NOW), retailers: catalog.retailers, size: US('12'), condition: 'new_only', now: NOW });
  assert.equal(summary.availability, 'in_stock_in_size');
  assert.equal(summary.status, 'known');
  assert.equal(typeof summary.fromMinor, 'number');
  assert.equal(summarizeOffers({ offers: [], retailers: catalog.retailers, now: NOW }).availability, 'no_offers');
});

// ---------- Affiliate links ----------

test('outbound links carry only allowed parameters, with the click reference in the sub id', () => {
  const clickRef = newClickRef();
  const program = { ...APPROVED, paramValues: { aff_id: 'rotation-demo', campaign: 'not-allowed', sub_id: '' } };
  const r = { ...RETAILERS[0], affiliate: program };
  const out = buildOutboundUrl({ offer: offer('a', { url: 'https://alpha.example/p/A?color=black&note=x%20y#reviews' }), retailer: r, clickRef });
  const url = new URL(out.url);
  assert.equal(out.tracked, true);
  assert.equal(out.network, 'demo-network');
  assert.deepEqual([...url.searchParams.keys()], ['color', 'note', 'aff_id', 'sub_id']);
  assert.equal(url.searchParams.get('aff_id'), 'rotation-demo');
  assert.equal(url.searchParams.get('sub_id'), clickRef);
  assert.equal(url.searchParams.get('campaign'), null, 'values for parameters the program does not allow are dropped');
  assert.ok(out.url.startsWith('https://alpha.example/p/A?color=black&note=x%20y&'), "the listing's own query is kept as is");
  assert.equal(url.hash, '#reviews');

  // A stale tracking value in the stored link is replaced, not duplicated.
  const replaced = new URL(buildOutboundUrl({ offer: offer('a', { url: 'https://alpha.example/p/A?aff_id=someone-else' }), retailer: r, clickRef }).url);
  assert.deepEqual(replaced.searchParams.getAll('aff_id'), ['rotation-demo']);

  // A program without a sub-id parameter never receives the click reference.
  const delta = buildOutboundUrl({ offer: offer('d', { retailerId: 'delta' }), retailer: RETAILERS[3], clickRef });
  assert.equal(delta.url, 'https://delta.example/p/D?ref=rotation');
  assert.ok(!delta.url.includes(clickRef));

  assert.match(clickRef, /^c_[a-z0-9]{16}$/);
  assert.equal(new Set(Array.from({ length: 500 }, newClickRef)).size, 500);
});

test('pending or missing programs get the plain listing URL', () => {
  const clickRef = newClickRef();
  const pending = buildOutboundUrl({ offer: offer('g', { retailerId: 'gamma', url: 'https://gamma.example/p/G?aff=rotation&color=red' }), retailer: RETAILERS[2], clickRef });
  assert.deepEqual(pending, { url: 'https://gamma.example/p/G?color=red', tracked: false, network: null });
  const none = buildOutboundUrl({ offer: offer('b', { retailerId: 'beta' }), retailer: RETAILERS[1], clickRef });
  assert.deepEqual(none, { url: 'https://beta.example/p/B', tracked: false, network: null });
});

test('an outbound link whose host is not the retailer is rejected', () => {
  const alpha = RETAILERS[0];
  const bad = [
    'https://evil.example/p/A',
    'https://alpha.example.evil.example/p/A',
    'https://alpha.example@evil.example/p/A',
    'https://shop.alpha.example/p/A',
    'https://alpha.example:8443/p/A',
    'javascript:alert(1)',
    'not a url',
  ];
  for (const url of bad) {
    assert.throws(() => buildOutboundUrl({ offer: offer('a', { url }), retailer: alpha, clickRef: newClickRef() }), (e) => e instanceof ApiError && e.code === 'invalid', url);
  }
  assert.throws(() => buildOutboundUrl({ offer: offer('a', { retailerId: 'beta' }), retailer: alpha }), (e) => e.code === 'invalid', 'offer from another retailer');
  assert.equal(buildOutboundUrl({ offer: offer('a', { url: 'https://www.alpha.example/p/A' }), retailer: alpha, clickRef: null }).url, 'https://www.alpha.example/p/A?aff_id=rotation-demo');
});

test('real catalog: every listing links to its own retailer and resolves back to its offer', () => {
  const catalog = staticCatalog();
  const clickRef = newClickRef();
  for (const o of catalog.offers.values()) {
    const r = catalog.retailer(o.retailerId);
    assert.ok(r, `${o.id} has a retailer`);
    const out = buildOutboundUrl({ offer: o, retailer: r, clickRef });
    assert.equal(new URL(out.url).hostname.replace(/^www\./, ''), r.domain, o.id);
    if (r.affiliate?.status !== 'approved') assert.equal(out.tracked, false, o.id);
    const resolved = resolveRetailerUrl(o.url, catalog);
    assert.equal(resolved.status, 'resolved', `${o.id}: ${resolved.reason}`);
    assert.equal(resolved.offerId, o.id);
    assert.equal(resolved.variantId, o.variantId);
  }
});

// ---------- Clicks (operations) ----------

test('a click does not mark anything purchased and is not revenue', async () => {
  const { api, db, as } = await createTestEnv();
  const alex = await as(ALEX);
  const wishBefore = await db.where('wishlistItems', 'userId', ALEX);
  const ownedBefore = await db.where('ownedItems', 'userId', ALEX);
  const target = wishBefore.find((w) => w.variantId === 'kestrel-runner-2--olive-bone');
  assert.ok(target);

  const result = await api.createClick(alex, { offerId: 'offer-nl-50877', idempotencyKey: 'tap-1' });
  assert.equal(result.tracked, true);
  assert.deepEqual(result.retailer, { id: 'northline', name: 'Northline Supply', domain: 'northline.example' });
  assert.deepEqual(result.affiliate, { network: 'demo-network', status: 'approved' });
  assert.equal(result.variantId, 'kestrel-runner-2--olive-bone');
  assert.equal(new URL(result.destination).searchParams.get('sub_id'), result.clickRef);
  assert.equal(result.disclosure, AFFILIATE_DISCLOSURE);

  const clicks = await db.all('clicks');
  assert.equal(clicks.length, 1);
  const user = await db.get('users', ALEX);
  assert.deepEqual(Object.keys(clicks[0]).sort(), ['analyticsId', 'clickRef', 'createdAt', 'destination', 'id', 'networkId', 'offerId', 'retailerId', 'tracked']);
  assert.equal(clicks[0].analyticsId, user.analyticsId);
  assert.ok(!JSON.stringify(clicks[0]).includes(ALEX), 'no user id in the click record');

  const wishAfter = await db.get('wishlistItems', target.id);
  assert.equal(wishAfter.status, 'active');
  assert.equal(wishAfter.purchasedOwnedId, null);
  assert.deepEqual(await db.where('ownedItems', 'userId', ALEX), ownedBefore);
  assert.equal(await db.count('conversions'), 0);

  const events = await db.where('events', 'type', 'outbound_click');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { retailerId: 'northline', tracked: true, condition: 'new' });

  const notConnected = summarize({ clicks, report: null });
  assert.equal(notConnected.clicks.total, 1);
  assert.equal(notConnected.revenue, null, 'without a report, revenue is unknown, not zero');
  assert.equal(notConnected.connected, false);
  const emptyReport = summarize({ clicks, report: reconcileConversions([]) });
  assert.equal(emptyReport.revenue.earnedMinor, 0);
  assert.equal(emptyReport.conversions.total, 0);
  assert.equal(emptyReport.clicks.tracked, 1);
});

test('createClick is idempotent per key and only opens active listings', async () => {
  const { api, db, as } = await createTestEnv();
  const alex = await as(ALEX);
  const first = await api.createClick(alex, { offerId: 'offer-cs-7781', idempotencyKey: 'same' });
  const again = await api.createClick(alex, { offerId: 'offer-cs-7781', idempotencyKey: 'same' });
  assert.deepEqual(again, first);
  assert.equal(await db.count('clicks'), 1);
  assert.equal(first.tracked, false, 'no affiliate program: plain link');
  assert.equal(first.destination, 'https://courtside.example/shop/7781-VCL101');
  assert.equal(first.affiliate, null);
  await api.createClick(alex, { offerId: 'offer-cs-7781', idempotencyKey: 'other' });
  assert.equal(await db.count('clicks'), 2);

  // A pending program's listing is a plain link with no network.
  const pending = await api.createClick(alex, { offerId: 'offer-hh-55102', idempotencyKey: 'p' });
  assert.equal(pending.tracked, false);
  assert.deepEqual(pending.affiliate, { network: 'demo-network', status: 'pending' });
  assert.equal((await db.all('clicks')).find((c) => c.clickRef === pending.clickRef).networkId, null);

  const removed = { ...(await db.get('offers', 'offer-nl-48213')), listingStatus: 'removed' };
  await db.put('offers', removed);
  api.invalidateCatalog();
  const error = await rejectsWith(api.createClick(alex, { offerId: 'offer-nl-48213', idempotencyKey: 'r' }), 'unavailable');
  assert.equal(error.message, 'This listing is no longer available.');
  await rejectsWith(api.createClick(alex, { offerId: 'offer-missing', idempotencyKey: 'm' }), 'not_found');
  await rejectsWith(api.createClick({}, { offerId: 'offer-cs-7781' }), 'unauthenticated');

  const jordan = await as(JORDAN);
  const stylistClick = await api.createClick(jordan, { offerId: 'offer-cs-7781', idempotencyKey: 's' });
  const record = (await db.all('clicks')).find((c) => c.clickRef === stylistClick.clickRef);
  assert.equal(record.analyticsId, (await db.get('users', JORDAN)).analyticsId);
});

// ---------- getOffers (operation) ----------

test('getOffers returns an OffersView and fails honestly when the offers provider is down', async () => {
  const { api, db, as, providers } = await createTestEnv();
  const alex = await as(ALEX);
  const view = await api.getOffers(alex, { variantId: 'vela-court-low--white-gum', size: { value: '10', system: 'US-M' }, condition: 'new_or_used' });
  assert.equal(view.variantId, 'vela-court-low--white-gum');
  assert.deepEqual(view.size, US('10'));
  assert.ok(view.rows.length >= 2);
  assert.ok(view.rows.every((r) => r.size?.value === '10'));
  assert.match(view.disclosure, /Other stores may have different prices or stock/);
  assert.equal(view.needsSize, false);

  const bare = await api.getOffers(alex, { variantId: 'vela-court-low--white-gum', size: '10' });
  assert.deepEqual(bare.size, US('10'), 'a bare value takes the product sizing system');
  const watch = await api.getOffers(alex, { variantId: 'arden-field--af38-sl-bk', size: US('10') });
  assert.equal(watch.size, null, 'watches are not sized');

  await rejectsWith(api.getOffers(alex, { variantId: 'no-such-variant' }), 'not_found');
  await rejectsWith(api.getOffers(alex, { variantId: 'vela-court-low--white-gum', condition: 'like_new' }), 'invalid');
  await rejectsWith(api.getOffers(alex, { variantId: 'vela-court-low--white-gum', size: { value: 'ten', system: 'US-M' } }), 'invalid');
  await rejectsWith(api.getOffers({}, { variantId: 'vela-court-low--white-gum' }), 'unauthenticated');
  assert.ok((await api.getOffers(await as(JORDAN), { variantId: 'vela-court-low--white-gum' })).rows.length > 0, 'stylists can compare offers');

  // Freshness window comes from config: the 7-hour-old Courtside offer is stale under a 4-hour window.
  await db.put('config', { key: 'offerFreshnessHours', value: 4 });
  const strict = await api.getOffers(alex, { variantId: 'vela-court-low--white-gum', size: US('10') });
  assert.equal(strict.rows.find((r) => r.offerId === 'offer-cs-7781').freshness, 'stale');
  assert.equal(strict.freshnessHours, 4);

  await db.put('config', { key: 'providerSimulation', value: { vision: 'ok', offers: 'down', ocr: 'ok' } });
  const down = await rejectsWith(api.getOffers(alex, { variantId: 'vela-court-low--white-gum' }), 'unavailable');
  assert.equal(down.message, 'Retailer prices could not be checked right now. Try again shortly.');
  assert.equal((await db.where('events', 'type', 'provider_unavailable')).length, 1);

  // A provider failure that isn't an ApiError reads the same way, not as a crash.
  await db.put('config', { key: 'providerSimulation', value: { vision: 'ok', offers: 'ok', ocr: 'ok' } });
  providers.offers = {
    list() {
      throw new Error('feed timed out');
    },
  };
  const failed = await rejectsWith(api.getOffers(alex, { variantId: 'vela-court-low--white-gum' }), 'unavailable');
  assert.equal(failed.message, 'Retailer prices could not be checked right now. Try again shortly.');
});

// ---------- Conversions ----------

test('conversion reports dedupe updates, follow the lifecycle, and handle reversals and refunds', () => {
  const at = (day) => new Date(NOW - (30 - day) * 86400000).toISOString();
  const base = { network: 'demo-network', currency: 'USD', occurredAt: at(0), demo: true };
  const events = [
    // e1: pending -> approved -> paid, with the approved update delivered twice.
    { ...base, id: '1', eventId: 'e1', clickRef: 'c_aaaaaaaaaaaaaaaa', status: 'pending', orderAmountMinor: 11000, commissionMinor: 660, updatedAt: at(0) },
    { ...base, id: '2', eventId: 'e1', clickRef: 'c_aaaaaaaaaaaaaaaa', status: 'approved', orderAmountMinor: 11000, commissionMinor: 660, updatedAt: at(7) },
    { ...base, id: '3', eventId: 'e1', clickRef: 'c_aaaaaaaaaaaaaaaa', status: 'approved', orderAmountMinor: 11000, commissionMinor: 660, updatedAt: at(7) },
    { ...base, id: '4', eventId: 'e1', clickRef: 'c_aaaaaaaaaaaaaaaa', status: 'paid', orderAmountMinor: 11000, commissionMinor: 660, updatedAt: at(20) },
    // e2: refunded before approval -> reversed.
    { ...base, id: '5', eventId: 'e2', clickRef: 'c_bbbbbbbbbbbbbbbb', status: 'pending', orderAmountMinor: 13000, commissionMinor: 780, updatedAt: at(1) },
    { ...base, id: '6', eventId: 'e2', clickRef: 'c_bbbbbbbbbbbbbbbb', status: 'reversed', reason: 'refund', orderAmountMinor: 13000, commissionMinor: 780, updatedAt: at(9) },
    // e3: approved, then a partial refund halves the order and the commission.
    { ...base, id: '7', eventId: 'e3', clickRef: 'c_cccccccccccccccc', status: 'approved', orderAmountMinor: 20000, commissionMinor: 1200, updatedAt: at(5) },
    { ...base, id: '8', eventId: 'e3', clickRef: 'c_cccccccccccccccc', status: 'approved', reason: 'partial_refund', orderAmountMinor: 10000, commissionMinor: 600, updatedAt: at(12) },
    // e4: still pending.
    { ...base, id: '9', eventId: 'e4', clickRef: 'c_dddddddddddddddd', status: 'pending', orderAmountMinor: 9000, commissionMinor: 540, updatedAt: at(2) },
    // e5: updates arrive out of order; the later timestamp wins, not the later array position.
    { ...base, id: '10', eventId: 'e5', clickRef: 'c_eeeeeeeeeeeeeeee', status: 'paid', orderAmountMinor: 5000, commissionMinor: 300, updatedAt: at(25) },
    { ...base, id: '11', eventId: 'e5', clickRef: 'c_eeeeeeeeeeeeeeee', status: 'pending', orderAmountMinor: 5000, commissionMinor: 300, updatedAt: at(3) },
    // Same event id from another network is a different conversion.
    { ...base, id: '12', network: 'other-network', eventId: 'e4', clickRef: null, status: 'approved', orderAmountMinor: 1000, commissionMinor: 50, updatedAt: at(4) },
    { id: 'junk', eventId: null, status: 'pending' },
    { id: 'junk2', eventId: 'e9', status: 'refunded' },
  ];
  const report = reconcileConversions(events);
  assert.equal(report.count, 6);
  assert.equal(report.duplicates, 1);
  assert.equal(report.ignored, 2);
  const byId = (id, network = 'demo-network') => report.conversions.find((c) => c.eventId === id && c.network === network);
  assert.equal(byId('e1').status, 'paid');
  assert.equal(byId('e1').updates, 3);
  assert.equal(byId('e2').status, 'reversed');
  assert.equal(byId('e2').refunded, true);
  assert.equal(byId('e3').status, 'approved');
  assert.equal(byId('e3').commissionMinor, 600);
  assert.equal(byId('e3').refunded, true);
  assert.equal(byId('e5').status, 'paid');
  assert.deepEqual(report.anomalies, []);

  assert.deepEqual(report.totals.pending, { count: 1, orderAmountMinor: 9000, commissionMinor: 540, unknownAmounts: 0 });
  assert.deepEqual(report.totals.approved, { count: 2, orderAmountMinor: 11000, commissionMinor: 650, unknownAmounts: 0 });
  assert.deepEqual(report.totals.paid, { count: 2, orderAmountMinor: 16000, commissionMinor: 960, unknownAmounts: 0 });
  assert.deepEqual(report.totals.reversed, { count: 1, orderAmountMinor: 13000, commissionMinor: 780, unknownAmounts: 0 });
  assert.equal(report.earnedMinor, 650 + 960, 'approved and paid only; pending and reversed are not earned');
  assert.equal(report.refunds, 2);
  assert.equal(report.currency, 'USD');

  // A later update that moves backwards is kept as the latest but flagged.
  const regress = reconcileConversions([
    { ...base, eventId: 'r1', status: 'paid', orderAmountMinor: 100, commissionMinor: 6, updatedAt: at(10) },
    { ...base, eventId: 'r1', status: 'pending', orderAmountMinor: 100, commissionMinor: 6, updatedAt: at(11) },
  ]);
  assert.equal(regress.conversions[0].status, 'pending');
  assert.deepEqual(regress.anomalies.map((a) => [a.from, a.to]), [['paid', 'pending']]);

  // Mixed currencies can't be summed; amounts become unknown rather than a wrong number.
  const mixed = reconcileConversions([
    { ...base, eventId: 'm1', status: 'approved', orderAmountMinor: 100, commissionMinor: 6 },
    { ...base, eventId: 'm2', status: 'approved', currency: 'EUR', orderAmountMinor: 100, commissionMinor: 6 },
  ]);
  assert.equal(mixed.mixedCurrencies, true);
  assert.equal(mixed.earnedMinor, null);
  assert.equal(mixed.totals.approved.commissionMinor, null);
  assert.equal(mixed.totals.approved.count, 2);

  // Clicks and revenue stay separate in the summary.
  const clicks = [
    { clickRef: 'c_aaaaaaaaaaaaaaaa', retailerId: 'northline', tracked: true },
    { clickRef: 'c_zzzzzzzzzzzzzzzz', retailerId: 'courtside', tracked: false },
  ];
  const summary = summarize({ clicks, report });
  assert.deepEqual(summary.clicks, { total: 2, tracked: 1, untracked: 1, byRetailer: [{ retailerId: 'courtside', count: 1 }, { retailerId: 'northline', count: 1 }] });
  assert.equal(summary.conversions.attributed, 1);
  assert.equal(summary.conversions.unattributed, 5);
  assert.equal(summary.revenue.earnedMinor, 1610);
  assert.equal(summary.revenue.pendingMinor, 540);
  assert.equal(summary.revenue.reversedMinor, 780);
  assert.equal(summarize({ clicks, report: { connected: false } }).revenue, null);
});

test('demo conversion events are labeled, deterministic and include a duplicate and a reversal', async () => {
  const { api, db, as } = await createTestEnv();
  const alex = await as(ALEX);
  await api.createClick(alex, { offerId: 'offer-nl-48213', idempotencyKey: 'a' });
  await api.createClick(alex, { offerId: 'offer-cs-7781', idempotencyKey: 'b' });
  await api.createClick(alex, { offerId: 'offer-mt-af38bk', idempotencyKey: 'c' });
  const clicks = await db.all('clicks');
  const catalog = staticCatalog();

  const events = demoConversionEvents(clicks, { seed: 7, now: NOW, catalog });
  assert.deepEqual(demoConversionEvents(clicks, { seed: 7, now: NOW, catalog }), events, 'same seed, same events');
  assert.ok(events.every((e) => e.demo === true));
  assert.equal(new Set(events.map((e) => e.id)).size, events.length, 'record ids are unique');
  assert.ok(events.every((e) => Date.parse(e.updatedAt) <= NOW), 'nothing is dated in the future');
  assert.ok(events.some((e) => e.status === 'reversed'));
  const signature = (e) => `${e.eventId}|${e.status}|${e.updatedAt}`;
  assert.ok(events.some((e, i) => events.findIndex((x) => signature(x) === signature(e)) !== i), 'includes a duplicated update');

  const trackedRefs = new Set(clicks.filter((c) => c.tracked).map((c) => c.clickRef));
  const untrackedRefs = new Set(clicks.filter((c) => !c.tracked).map((c) => c.clickRef));
  assert.equal(trackedRefs.size, 2);
  assert.ok(events.some((e) => trackedRefs.has(e.clickRef)), 'tracked clicks are used');
  assert.ok(events.every((e) => !untrackedRefs.has(e.clickRef)), 'untracked clicks cannot convert');
  const watchOrder = events.find((e) => e.clickRef === clicks.find((c) => c.offerId === 'offer-mt-af38bk').clickRef);
  assert.equal(watchOrder.orderAmountMinor, 49500, 'demo orders use the clicked offer price');

  const report = reconcileConversions(events);
  assert.equal(report.demo, true);
  assert.ok(report.duplicates >= 1);
  assert.ok(report.totals.reversed.count >= 1);
  assert.ok(report.totals.paid.count >= 1);
  assert.equal(report.earnedMinor, report.totals.approved.commissionMinor + report.totals.paid.commissionMinor);
  assert.ok(report.refunds >= 2, 'a full and a partial refund');
  const summary = summarize({ clicks, report });
  assert.equal(summary.demo, true);
  assert.equal(summary.conversions.attributed, 2);

  // Without clicks there is still a full, clearly synthetic report.
  const synthetic = reconcileConversions(demoConversionEvents([], { seed: 3, now: NOW }));
  assert.equal(synthetic.count, 5);
  assert.ok(synthetic.conversions.every((c) => c.clickRef.startsWith('c_demo')));
});

// ---------- URL import safety ----------

test('unsafe product links are rejected in plain words', () => {
  const cases = [
    ['javascript:alert(1)', 'scheme'],
    ['data:text/html,<script>alert(1)</script>', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['ftp://northline.example/p/NL-48213', 'scheme'],
    ['http://localhost', 'local_host'],
    ['http://localhost.:80/p/1', 'local_host'],
    ['http://shop.localhost/p/1', 'local_host'],
    ['http://printer.local/p/1', 'local_host'],
    ['http://metadata.google.internal/x', 'local_host'],
    ['http://nas.home.arpa/x', 'local_host'],
    ['http://127.0.0.1', 'private_address'],
    ['http://[::1]', 'private_address'],
    ['http://2130706433', 'private_address'],
    ['http://0x7f000001', 'private_address'],
    ['http://017700000001', 'private_address'],
    ['http://127.1', 'private_address'],
    ['http://10.0.0.5', 'private_address'],
    ['http://172.16.4.2', 'private_address'],
    ['http://192.168.1.1', 'private_address'],
    ['http://169.254.169.254/latest/meta-data', 'private_address'],
    ['http://100.64.0.1', 'private_address'],
    ['http://0.0.0.0', 'private_address'],
    ['http://224.0.0.251', 'private_address'],
    ['http://198.51.100.7', 'private_address'],
    ['http://[::ffff:127.0.0.1]', 'private_address'],
    ['http://[::ffff:10.0.0.5]', 'private_address'],
    ['http://[fd00:ec2::254]', 'private_address'],
    ['http://[fe80::1]', 'private_address'],
    ['http://[ff02::1]', 'private_address'],
    ['http://[2001:db8::1]', 'private_address'],
    ['http://[64:ff9b::a9fe:a9fe]', 'private_address'],
    ['http://user:pass@northline.example/p/NL-48213', 'credentials'],
    ['http://northline.example:8080/p/1', 'port'],
    [`https://northline.example/p/${'a'.repeat(3000)}`, 'too_long'],
    ['http://intranet/p/1', 'local_host'],
    ['', 'empty'],
    ['   ', 'empty'],
    [null, 'empty'],
    ['http://exa mple.example/p/1', 'malformed'],
  ];
  for (const [input, reason] of cases) {
    const result = validateImportUrl(input);
    assert.equal(result.ok, false, String(input));
    assert.equal(result.reason, reason, String(input));
    assert.match(result.message, /^[A-Z].*\.$/, 'a plain sentence');
    assert.doesNotMatch(result.message, /sorry|oops/i);
  }
  for (const input of [
    'https://northline.example/p/NL-48213',
    '  https://northline.example/p/NL-48213?size=10  ',
    'northline.example/p/NL-48213',
    'https://northline.example:443/p/NL-48213',
    'http://northline.example:80/p/NL-48213',
    'https://www.example.com/products/court-low',
    'http://8.8.8.8/p/1',
    'http://[2606:4700::1111]/p/1',
  ]) {
    assert.equal(validateImportUrl(input).ok, true, input);
  }
  assert.equal(validateImportUrl('https://Northline.EXAMPLE./p/NL-48213').url, 'https://northline.example/p/NL-48213');
  assert.equal(validateImportUrl('northline.example/p/NL-48213').url, 'https://northline.example/p/NL-48213');
});

test('IPv6 literals are parsed and checked by range', () => {
  assert.deepEqual(parseIPv6('[::ffff:7f00:1]'), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  assert.deepEqual(parseIPv6('::ffff:127.0.0.1'), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  assert.equal(parseIPv6('1::2::3'), null);
  assert.equal(parseIPv6('fe80::1%eth0'), null);
  assert.equal(isBlockedIPv6(parseIPv6('::1')), true);
  assert.equal(isBlockedIPv6(parseIPv6('::')), true);
  assert.equal(isBlockedIPv6(parseIPv6('2606:4700::1111')), false);
  assert.equal(isBlockedIPv6(parseIPv6('64:ff9b::808:808')), false, 'NAT64 to a public address');
  assert.equal(isBlockedIPv6(parseIPv6('64:ff9b::a00:5')), true, 'NAT64 to 10.0.0.5');
  assert.equal(isBlockedIPv6(parseIPv6('2002:7f00:1::')), true, '6to4');
  assert.equal(isBlockedIPv6(parseIPv6('2001::1')), true, 'Teredo');
});

test('redirect chains are validated hop by hop', () => {
  assert.deepEqual(checkRedirectChain(['https://northline.example/go/1', '/p/NL-48213']), { ok: true, url: 'https://northline.example/p/NL-48213', hops: 1 });
  const metadata = checkRedirectChain(['https://northline.example/go/1', 'http://169.254.169.254/latest/meta-data']);
  assert.deepEqual([metadata.ok, metadata.reason, metadata.hop], [false, 'private_address', 1]);
  const many = checkRedirectChain(Array.from({ length: 7 }, (_, i) => `https://a.example/${i}`));
  assert.deepEqual([many.ok, many.reason], [false, 'too_many_redirects']);
  assert.equal(checkRedirectChain(Array.from({ length: 6 }, (_, i) => `https://a.example/${i}`)).ok, true, 'five redirects are allowed');
  assert.equal(checkRedirectChain(['https://a.example/1', 'https://a.example/2', 'https://a.example/1']).reason, 'redirect_loop');
  assert.equal(checkRedirectChain(['https://a.example/1', 'http://a.example/2']).reason, 'downgrade');
  assert.equal(checkRedirectChain(['https://a.example/1', 'javascript:alert(1)']).reason, 'scheme');
  assert.equal(checkRedirectChain(['https://a.example/1', 'https://a.example/2'], { maxHops: 0 }).reason, 'too_many_redirects');
});

test('demo retailer links resolve to the right offer and size; other stores are unsupported', () => {
  const catalog = staticCatalog();
  const resolved = resolveRetailerUrl('https://northline.example/p/NL-48213?size=10', catalog);
  assert.deepEqual(resolved, {
    status: 'resolved',
    retailerId: 'northline',
    offerId: 'offer-nl-48213',
    variantId: 'vela-court-low--white-gum',
    productId: 'vela-court-low',
    size: { value: '10', system: 'US-M' },
    listingStatus: 'active',
    sizeNote: null,
  });
  const www = resolveRetailerUrl('https://www.northline.example/p/NL-48213/?utm_source=x', catalog);
  assert.equal(www.offerId, 'offer-nl-48213');
  assert.equal(www.size, null);

  const unknownStore = resolveRetailerUrl('https://www.example.com/products/court-low-white-gum', catalog);
  assert.equal(unknownStore.status, 'unsupported_link');
  assert.equal(unknownStore.host, 'www.example.com');
  assert.equal(unknownStore.code, 'unknown_store');
  assert.match(unknownStore.reason, /^Rotation can't read links from www\.example\.com yet\./);
  assert.equal(resolveRetailerUrl('https://northline.example.evil.example/p/NL-48213', catalog).code, 'unknown_store');
  assert.equal(resolveRetailerUrl('https://northline.example/catalog/NL-48213', catalog).code, 'not_a_product_page');
  assert.equal(resolveRetailerUrl('https://northline.example/p/NL-00000', catalog).code, 'unknown_listing');
  assert.equal(resolveRetailerUrl('http://127.0.0.1/p/NL-48213', catalog).code, 'invalid_url');

  const badSize = resolveRetailerUrl('https://northline.example/p/NL-48213?size=15', catalog);
  assert.equal(badSize.status, 'resolved');
  assert.equal(badSize.size, null);
  assert.match(badSize.sizeNote, /isn't one this product comes in/);
  const watch = resolveRetailerUrl('https://meridiantime.example/watch/AF38-SL-BK-NEW?size=10', catalog);
  assert.equal(watch.variantId, 'arden-field--af38-sl-bk');
  assert.equal(watch.size, null);
  assert.ok(watch.sizeNote);
  const alpha = resolveRetailerUrl('https://fieldhouse-outfitters.example/item/21017?size=m', catalog);
  assert.deepEqual(alpha.size, { value: 'M', system: 'ALPHA' });
});

test('a listing id identifies an offer, never the product', () => {
  // The listing id looks like the white colorway's style code, but the offer is for black.
  const offers = [shoe('tricky', { retailerId: 'beta', listingId: 'FXR-002' })];
  const resolved = resolveRetailerUrl('https://beta.example/p/FXR-002', fixtureCatalog(offers));
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.variantId, 'fx-runner--black');
  assert.equal(resolved.offerId, 'tricky');
});

test('importFromUrl validates and resolves without fetching anything', async () => {
  const { api, db, as } = await createTestEnv();
  const alex = await as(ALEX);
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => {
    fetched += 1;
    throw new Error('importFromUrl must not fetch');
  };
  try {
    const invalidUrl = await api.importFromUrl(alex, { url: 'http://169.254.169.254/latest/meta-data' });
    assert.deepEqual(Object.keys(invalidUrl).sort(), ['code', 'reason', 'status']);
    assert.equal(invalidUrl.status, 'invalid_url');
    assert.equal(invalidUrl.code, 'private_address');
    assert.match(invalidUrl.reason, /private or reserved network address/);

    const unknown = await api.importFromUrl(alex, { url: 'https://www.example.com/products/court-low' });
    assert.equal(unknown.status, 'unsupported_link');
    assert.equal(unknown.host, 'www.example.com');
    assert.match(unknown.reason, /^Rotation can't read links/);

    const ok = await api.importFromUrl(alex, { url: ' https://northline.example/p/NL-48213?size=10 ' });
    assert.equal(ok.status, 'resolved');
    assert.equal(ok.offerId, 'offer-nl-48213');
    assert.deepEqual(ok.size, US('10'));
    assert.equal(ok.url, 'https://northline.example/p/NL-48213?size=10');
    assert.equal(ok.product.id, 'vela-court-low');
    assert.equal(ok.variant.id, 'vela-court-low--white-gum');
    assert.equal(ok.variant.image.label, 'Catalog image');
    assert.deepEqual(ok.retailer, { id: 'northline', name: 'Northline Supply', domain: 'northline.example' });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(fetched, 0);
  const metrics = await db.where('events', 'type', 'url_import');
  assert.equal(metrics.length, 3);
  for (const m of metrics) assert.ok(!JSON.stringify(m.data).includes('example'), 'no URLs or hosts in metrics');
  await rejectsWith(api.importFromUrl(await as(JORDAN), { url: 'https://northline.example/p/NL-48213' }), 'forbidden');
});
