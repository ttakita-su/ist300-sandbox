// Admin operations: role checks, ranking weights, provider simulation, job retry, clicks and
// conversions, feed import, corrections, image source status, offer freshness, and the rule
// that admin views never expose a person's inventory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv, rejectsWith, waitForJob, fakeJpeg, ALEX, SAM, JORDAN, MORGAN } from '../helpers.mjs';
import { DEFAULT_WEIGHTS, WEIGHT_RANGES } from '../../js/engine/recommend.js';
import { staticCatalog } from '../../js/server/catalog-repo.js';

async function setup(opts) {
  const env = await createTestEnv(opts);
  return { ...env, alex: await env.as(ALEX), sam: await env.as(SAM), jordan: await env.as(JORDAN), morgan: await env.as(MORGAN) };
}

const NEW_PRODUCT = {
  brands: [{ id: 'tideline', name: 'Tideline', categories: ['sneaker'] }],
  products: [
    {
      id: 'tideline-deck-low',
      category: 'sneaker',
      type: 'slip-on',
      brandId: 'tideline',
      name: 'Deck Low',
      styleTags: ['minimal', 'classic'],
      materials: ['canvas'],
      sizing: { system: 'US-M', sizes: ['9', '10', '11'] },
      attributes: { cut: 'low', closure: 'slip-on' },
    },
  ],
  variants: [
    {
      id: 'tideline-deck-low--navy',
      productId: 'tideline-deck-low',
      name: 'Navy',
      identifiers: { styleCode: 'TD-LOW-NVY' },
      colors: [{ name: 'navy', role: 'upper', weight: 0.7 }, { name: 'white', role: 'sole', weight: 0.3 }],
      attributes: { colorway: 'Navy' },
      msrpMinor: 6500,
    },
  ],
  offers: [
    {
      id: 'offer-nl-tdlow',
      retailerId: 'northline',
      listingId: 'NL-TDLOW',
      variantId: 'tideline-deck-low--navy',
      condition: 'new',
      sellerType: 'retailer',
      sizes: [{ value: '10', system: 'US-M', priceMinor: 6500, stock: 'in_stock' }],
      url: 'https://northline.example/p/NL-TDLOW',
    },
  ],
};

test('admin operations need the admin role', async () => {
  const { api, alex, jordan } = await setup();
  for (const call of [alex, jordan]) {
    await rejectsWith(api.adminOverview(call, {}), 'forbidden');
    await rejectsWith(api.adminSetWeights(call, { weights: { style: 2 } }), 'forbidden');
    await rejectsWith(api.adminImportFeed(call, { feed: '{}' }), 'forbidden');
    await rejectsWith(api.adminListClicks(call, {}), 'forbidden');
  }
  await rejectsWith(api.adminOverview({}, {}), 'unauthenticated');
});

test('admin views are aggregates and accounts, never anyone’s items', async () => {
  const { api, db, alex, morgan } = await setup();
  await api.createClick(alex, { offerId: 'offer-nl-48213' });
  const overview = await api.adminOverview(morgan, {});
  const catalog = staticCatalog();
  assert.equal(overview.catalog.products, catalog.products.size);
  assert.equal(overview.catalog.variants, catalog.variants.size);
  assert.equal(overview.accounts.byRole.user, 2);
  assert.equal(overview.accounts.activeAssignments, 1);
  assert.equal(overview.clicks.total, 1);
  assert.equal(overview.offers.freshnessHours, 24);
  const accounts = await api.adminListAccounts(morgan, {});
  assert.ok(accounts.accounts.every((a) => Object.keys(a).sort().join() === 'createdAt,demo,displayName,id,role'), 'accounts are id, name and role only');

  const items = await db.all('ownedItems');
  const text = JSON.stringify([overview, accounts, await api.adminListClicks(morgan, {}), await api.adminListJobs(morgan, {}), await api.adminListCorrections(morgan, { status: 'all' })]);
  for (const item of items) assert.ok(!text.includes(item.id), 'no owned item id appears');
  for (const secret of ['A38-118204', 'Hemmed with no break.', 'alex@demo.rotation.example']) assert.ok(!text.includes(secret), `no ${secret}`);
});

test('ranking weights: the engine’s ranges are enforced, partial changes merge, and reset restores defaults', async () => {
  const { api, morgan } = await setup();
  const initial = await api.adminGetWeights(morgan, {});
  assert.deepEqual(initial.weights, { ...DEFAULT_WEIGHTS });
  assert.equal(initial.custom, false);
  assert.deepEqual(Object.keys(initial.ranges), Object.keys(DEFAULT_WEIGHTS));
  assert.equal(initial.ranges.diversity.max, WEIGHT_RANGES.diversity.max);
  assert.equal(initial.ranges.style.label, 'Style match', 'the editor gets the labels and help text');
  assert.ok(initial.ranges.style.help.length > 10);

  const changed = await api.adminSetWeights(morgan, { weights: { style: 2.5, diversity: 0.5 } });
  assert.equal(changed.weights.style, 2.5);
  assert.equal(changed.weights.diversity, 0.5);
  assert.equal(changed.weights.color, DEFAULT_WEIGHTS.color, 'other weights keep their values');
  assert.equal(changed.custom, true);
  assert.equal((await api.adminSetWeights(morgan, { weights: { color: 1 } })).weights.style, 2.5, 'a later change keeps earlier ones');

  const tooHigh = await rejectsWith(api.adminSetWeights(morgan, { weights: { diversity: 2 } }), 'invalid');
  assert.match(tooHigh.details.fields['weights.diversity'], /between 0 and 0.9/);
  const unknown = await rejectsWith(api.adminSetWeights(morgan, { weights: { popularity: 1 } }), 'invalid');
  assert.equal(unknown.details.fields['weights.popularity'], 'Unknown weight');
  await rejectsWith(api.adminSetWeights(morgan, { weights: { style: 'high' } }), 'invalid');
  await rejectsWith(api.adminSetWeights(morgan, { weights: {} }), 'invalid');

  const reset = await api.adminSetWeights(morgan, { reset: true });
  assert.deepEqual(reset.weights, { ...DEFAULT_WEIGHTS });
  assert.equal(reset.custom, false);
});

test('provider simulation shows the failure states, and a failed job can be retried by the admin', async () => {
  const features = { v: 1, category: 'sneaker', width: 256, height: 192, fgRatio: 0, bbox: { x: 0, y: 0, w: 1, h: 1 }, aspect: 1, palette: [], grid: { cols: 6, rows: 4, cells: [] }, stats: { brightness: 0.5, colorfulness: 0, edgeDensity: 0 } };
  const { api, alex, morgan } = await setup({ providers: { features } });
  await rejectsWith(api.adminSetProviderSimulation(morgan, { offers: 'broken' }), 'invalid');
  const view = await api.adminSetProviderSimulation(morgan, { offers: 'down', vision: 'error' });
  assert.deepEqual(view.simulation, { vision: 'error', offers: 'down', ocr: 'ok' });
  assert.equal(view.providers.find((p) => p.id === 'offers').status, 'simulated');
  assert.equal(view.providers.find((p) => p.id === 'conversions').status, 'not_connected');

  const down = await rejectsWith(api.getOffers(alex, { variantId: 'vela-court-low--white-gum' }), 'unavailable');
  assert.equal(down.message, 'Retailer prices could not be checked right now. Try again shortly.');
  await rejectsWith(api.recommend(alex, { mode: 'feed' }), 'unavailable');
  await rejectsWith(api.adminRefreshOffer(morgan, { offerId: 'offer-nl-48213' }), 'unavailable');

  const upload = await api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'original' });
  const created = await api.createMatchJob(alex, { photoId: upload.photoId, category: 'sneaker', dest: 'owned' });
  const failed = await waitForJob(api, alex, created.id);
  assert.equal(failed.status, 'error');
  assert.equal(failed.error.message, 'Photo analysis failed. Try again.');
  await rejectsWith(api.adminRetryJob(morgan, { jobId: 'job_missing' }), 'not_found');

  await api.adminSetProviderSimulation(morgan, { vision: 'ok', offers: 'ok' });
  const retried = await api.adminRetryJob(morgan, { jobId: created.id });
  assert.equal(retried.id, created.id);
  assert.ok(!('userId' in retried), 'job views carry a person hash, not the account');
  const after = await waitForJob(api, alex, created.id);
  assert.equal(after.status, 'done');
  assert.equal(after.result.retrieval, 'no_match', 'an empty scene abstains rather than guessing');
  await rejectsWith(api.adminRetryJob(morgan, { jobId: created.id }), 'conflict');
});

test('clicks and revenue stay apart: no network means revenue is unknown, and demo events are labeled demo', async () => {
  const { api, db, alex, morgan } = await setup();
  await api.createClick(alex, { offerId: 'offer-nl-50877' });
  await api.createClick(alex, { offerId: 'offer-cs-7781' });
  const clicks = await api.adminListClicks(morgan, {});
  assert.equal(clicks.summary.total, 2);
  assert.equal(clicks.summary.tracked, 1, 'Courtside has no affiliate program, so its link is plain');
  assert.ok(clicks.clicks.every((c) => !('userId' in c) && c.analyticsId));

  const before = await api.adminConversions(morgan, {});
  assert.equal(before.connected, false);
  assert.equal(before.report, null);
  assert.equal(before.summary.revenue, null, 'revenue is unknown, never zero');
  assert.equal(before.summary.clicks.total, 2);
  assert.equal(before.demo, null);

  const loaded = await api.adminLoadDemoConversions(morgan, {});
  assert.equal(loaded.summary.revenue, null, 'demo events never count as real revenue');
  assert.equal(loaded.demo.label, 'Demo data');
  assert.ok(loaded.demo.events.every((e) => e.demo === true));
  assert.equal(loaded.demo.summary.demo, true);
  assert.ok(Number.isInteger(loaded.demo.summary.revenue.earnedMinor));
  const tracked = (await db.all('clicks')).find((c) => c.tracked);
  assert.ok(loaded.demo.events.some((e) => e.clickRef === tracked.clickRef), 'demo events attach to tracked clicks first');

  const count = (await db.all('conversions')).length;
  await api.adminLoadDemoConversions(morgan, {});
  assert.equal((await db.all('conversions')).length, count, 'loading again replaces rather than adds');
  await rejectsWith(api.adminLoadDemoConversions(morgan, { seed: 0 }), 'invalid');
  const other = await api.adminLoadDemoConversions(morgan, { seed: 7 });
  assert.ok(other.demo.events.every((e) => e.id.startsWith('conv_demo_7_')));
});

test('a feed import validates every record, keeps unknown costs unknown and makes the product searchable', async () => {
  const { api, alex, morgan } = await setup();
  const bad = {
    products: [{ ...NEW_PRODUCT.products[0], id: 'Bad Id', type: 'boat' }],
    variants: [{ ...NEW_PRODUCT.variants[0], id: 'vela-court-low--navy', productId: 'vela-court-low', identifiers: { styleCode: 'KR2-304' } }],
    offers: [{ ...NEW_PRODUCT.offers[0], id: 'offer-real-store', url: 'https://www.realstore.com/p/1' }],
  };
  const rejected = await api.adminImportFeed(morgan, { feed: JSON.stringify(bad) });
  assert.equal(rejected.accepted, 0);
  const problems = rejected.rejected.flatMap((r) => r.problems).join(' | ');
  assert.match(problems, /lowercase slug/);
  assert.match(problems, /type must be one of/);
  assert.match(problems, /KR2-304 already belongs to kestrel-runner-2--olive-bone/);
  assert.match(problems, /https link on a \.example demo domain/);
  await rejectsWith(api.adminImportFeed(morgan, { feed: 'not json' }), 'invalid');
  await rejectsWith(api.adminImportFeed(morgan, { feed: JSON.stringify({ retailers: [] }) }), 'invalid');

  const ok = await api.adminImportFeed(morgan, { feed: JSON.stringify(NEW_PRODUCT) });
  assert.equal(ok.rejected.length, 0, JSON.stringify(ok.rejected));
  assert.equal(ok.created, 5, 'brand, product, version and offer, plus the generated image record');
  assert.equal(ok.generatedImages, 1, 'a new version gets a generated illustration record');
  const found = await api.searchCatalog(alex, { q: 'TD-LOW-NVY' });
  assert.equal(found[0].product.id, 'tideline-deck-low');
  assert.ok(found[0].variants[0].image.url);
  const offers = await api.getOffers(alex, { variantId: 'tideline-deck-low--navy', size: '10', condition: 'new_only' });
  const row = offers.rows[0];
  assert.deepEqual(row.shipping, { kind: 'unknown' }, 'shipping the feed did not state is unknown');
  assert.equal(row.totalComplete, false);
  assert.ok(row.missing.includes('shipping'));
  assert.equal(row.retailer.domain, 'northline.example');
});

test('corrections: a person proposes, the admin decides, and the reporter stays a hash', async () => {
  const { api, db, alex, morgan } = await setup();
  const correction = await api.reportCatalogIssue(alex, { productId: 'arden-field', variantId: 'arden-field--af38-sl-bk', field: 'variant.attributes.thicknessMm', proposedValue: '11.4', note: 'Measured' });
  const before = await db.get('catalogVariants', 'arden-field--af38-sl-bk');
  assert.equal(before.attributes.thicknessMm, 11.2, 'reporting never edits the catalog');

  const [row] = await api.adminListCorrections(morgan, {});
  assert.equal(row.id, correction.id);
  assert.match(row.reporter, /^p-[0-9a-z]{7}$/);
  assert.ok(!JSON.stringify(row).includes(ALEX));
  assert.equal(row.currentValue, 11.2);
  assert.equal(row.proposedValue, 11.4);

  const accepted = await api.adminResolveCorrection(morgan, { correctionId: correction.id, decision: 'accepted' });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.applied, true);
  assert.equal((await db.get('catalogVariants', 'arden-field--af38-sl-bk')).attributes.thicknessMm, 11.4);
  assert.equal((await api.getVariant(alex, { variantId: 'arden-field--af38-sl-bk' })).variant.attributes.thicknessMm, 11.4, 'the change reaches the catalog everyone reads');
  await rejectsWith(api.adminResolveCorrection(morgan, { correctionId: correction.id, decision: 'rejected' }), 'conflict');
  assert.deepEqual(await api.adminListCorrections(morgan, {}), []);
  const audit = (await db.all('audit')).find((a) => a.action === 'correction.accepted');
  assert.deepEqual([audit.meta.from, audit.meta.to], [11.2, 11.4]);
});

test('image source status: a withdrawn catalog image falls back to the person’s photo, with the reason', async () => {
  const { api, alex, morgan } = await setup();
  const watch = (await api.listOwned(alex, {})).items.find((i) => i.variantId === 'arden-field--af38-sl-bk');
  assert.equal(watch.image.kind, 'catalog');
  const upload = await api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'original' });
  await api.updateOwned(alex, { itemId: watch.id, patch: { photos: { originalId: upload.photoId } } });

  const images = await api.adminListImages(morgan, { variantId: 'arden-field--af38-sl-bk' });
  assert.equal(images.length, 1);
  assert.equal(images[0].inCollections.ok, true);
  const down = await api.adminSetImageStatus(morgan, { imageId: images[0].id, status: 'taken_down' });
  assert.equal(down.inCollections.ok, false);

  const after = await api.getOwned(alex, { itemId: watch.id });
  assert.equal(after.display, 'catalog', 'the person’s choice is kept');
  assert.equal(after.image.kind, 'original');
  assert.equal(after.image.photoId, upload.photoId);
  assert.equal(after.image.fallbackReason, 'The catalog image was withdrawn by its source.');
  const others = (await api.listOwned(alex, {})).items.filter((i) => i.variantId !== 'arden-field--af38-sl-bk');
  assert.ok(others.every((i) => i.image.kind === 'catalog'), 'only that version is affected');

  // Feed-terms images only show next to a live offer, never in a collection.
  const charcoal = await api.adminListImages(morgan, { variantId: 'fieldhouse-wool-trouser--charcoal' });
  assert.equal(charcoal[0].inCollections.ok, false);
  assert.equal(charcoal[0].onProductPages.ok, true);
  await api.adminSetImageStatus(morgan, { imageId: images[0].id, status: 'active' });
  assert.equal((await api.getOwned(alex, { itemId: watch.id })).image.kind, 'catalog');
});

test('offer freshness: listing by freshness and refreshing a demo offer', async () => {
  const { api, morgan } = await setup();
  const stale = await api.adminListOffers(morgan, { freshness: 'stale' });
  assert.deepEqual(stale.map((o) => o.id), ['offer-hh-55380'], 'the 52-hour-old listing is stale');
  assert.equal(stale[0].price.fromMinor, 31000);
  const refreshed = await api.adminRefreshOffer(morgan, { offerId: 'offer-hh-55380' });
  assert.equal(refreshed.freshness, 'fresh');
  assert.equal(refreshed.refreshedByAdmin, true);
  assert.deepEqual(await api.adminListOffers(morgan, { freshness: 'stale' }), []);
  await rejectsWith(api.adminRefreshOffer(morgan, { offerId: 'offer-none' }), 'not_found');
});

test('stylist assignments: one live assignment per pair, roles are checked', async () => {
  const { api, morgan } = await setup();
  await rejectsWith(api.adminAssignStylist(morgan, { stylistId: JORDAN, userId: ALEX }), 'conflict');
  await rejectsWith(api.adminAssignStylist(morgan, { stylistId: ALEX, userId: SAM }), 'invalid');
  await rejectsWith(api.adminAssignStylist(morgan, { stylistId: JORDAN, userId: MORGAN }), 'invalid');
  const created = await api.adminAssignStylist(morgan, { stylistId: JORDAN, userId: SAM });
  assert.equal(created.active, true);
  assert.equal(created.userName, 'Sam Okafor');
});

test('evaluation reports: only synthetic reports are stored', async () => {
  const { api, morgan } = await setup();
  assert.equal(await api.adminGetEvalReport(morgan, {}), null);
  await rejectsWith(api.adminSaveEvalReport(morgan, { report: { synthetic: false } }), 'invalid');
  const report = { generatedAt: '2026-10-14T11:00:00Z', synthetic: true, seed: 1, counts: { inCatalog: 10, outOfCatalog: 4 }, overall: { top1: 8, top3: 9 } };
  const saved = await api.adminSaveEvalReport(morgan, { report });
  assert.equal(saved.ok, true);
  assert.equal((await api.adminGetEvalReport(morgan, {})).overall.top1, 8);
  assert.equal((await api.adminOverview(morgan, {})).evaluation.synthetic, true);
});
