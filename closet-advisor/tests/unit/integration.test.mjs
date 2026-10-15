// The core journey across modules, server side: photo -> match job -> candidates -> confirm with
// a typed code -> collection (original photo kept, catalog image shown) -> matching
// recommendations -> offers in the profile size -> outbound click -> explicit purchase. A second
// person, an unassigned stylist and the admin see none of it.
//
// Vision runs the real feature extractor on synthetic scenes (tests/fixtures/scenes.mjs), and
// the reference features are measured the same way from every variant in the real demo catalog,
// so matching runs against the whole catalog rather than a fixture subset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv, rejectsWith, waitForJob, fakeJpeg, ALEX, SAM, RILEY, MORGAN } from '../helpers.mjs';
import { studio, photo } from '../fixtures/scenes.mjs';
import { extractFeatures } from '../../js/engine/features.js';
import { specFor } from '../../js/data/illustrations.js';
import { staticCatalog } from '../../js/server/catalog-repo.js';

const CATALOG = staticCatalog();
const TARGET = 'kestrel-runner-2--navy-white';
const TARGET_CODE = 'KR2-410';
const WISHED = 'kestrel-runner-2--olive-bone';

function featuresOf(variantId, render) {
  const variant = CATALOG.variant(variantId);
  const product = CATALOG.product(variant.productId);
  return extractFeatures(render(specFor(product, variant)), { category: product.category });
}

const REFERENCES = new Map(CATALOG.listVariants().map((v) => [v.id, featuresOf(v.id, studio)]));
const PHOTO = featuresOf(TARGET, (spec) => photo(spec, 5));

async function journeyEnv() {
  const env = await createTestEnv({ providers: { features: () => PHOTO, referenceFeatures: () => REFERENCES } });
  return { ...env, alex: await env.as(ALEX), sam: await env.as(SAM) };
}

/** Every recommended item is a real catalog variant, and every named item is the person's own. */
async function assertGrounded(env, items, ownerId) {
  for (const item of items) {
    const variant = CATALOG.variant(item.variantId);
    assert.ok(variant, `${item.variantId} is a catalog variant`);
    assert.equal(variant.productId, item.productId);
    for (const rel of item.related) {
      const store = rel.itemType === 'owned' ? 'ownedItems' : 'wishlistItems';
      const record = await env.db.get(store, rel.itemId);
      assert.equal(record?.userId, ownerId, `${rel.itemId} belongs to the person`);
    }
    if (item.price.status === 'unknown') assert.equal(item.price.fromMinor, null, 'an unknown price is null, never 0');
  }
}

test('the core journey: photo to collection to recommendations, offers, a click and an explicit purchase', async () => {
  const env = await journeyEnv();
  const { api, db, alex } = env;
  const ownedBefore = (await db.where('ownedItems', 'userId', ALEX)).length;

  // 1. Upload: the original and its processing copy are private rows linked both ways.
  const upload = await api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'original', idempotencyKey: 'upload-1' });
  const original = await db.get('photos', upload.photoId);
  const processing = await db.get('photos', upload.processingId);
  assert.equal(original.userId, ALEX);
  assert.equal(original.processingId, processing.id);
  assert.equal(processing.kind, 'processing');
  assert.equal(processing.sourceId, original.id);

  // 2. Match job: runs in the background and finds the runner from the photo alone.
  const created = await api.createMatchJob(alex, { photoId: upload.photoId, category: 'sneaker', dest: 'owned', idempotencyKey: 'job-1' });
  assert.equal(created.status, 'queued');
  assert.equal(created.processingId, upload.processingId, 'the job reads the processing copy, not the original');
  let job = await waitForJob(api, alex, created.id);
  assert.equal(job.status, 'done');
  assert.equal(job.result.retrieval, 'candidate_found');
  const lead = job.result.candidates[0];
  assert.equal(lead.productId, 'kestrel-runner-2');
  assert.equal(lead.kind, 'match');
  assert.equal(lead.product.name, 'Runner 2', 'candidates carry product views for the confirmation screen');
  assert.deepEqual(lead.variants.map((v) => v.id), lead.variantOptions.map((o) => o.variantId), 'one version view per option, same order');
  assert.ok(lead.variants.every((v) => v.image.url?.startsWith('data:image/svg+xml')), 'each version shows its catalog image');
  assert.ok(lead.evidence.some((e) => e.kind === 'visual'));
  assert.ok(!lead.evidence.some((e) => e.kind === 'identifier'), 'no identifier evidence before a code is given');
  assert.ok(job.result.candidates.slice(1).every((c) => c.kind === 'similar'), 'other products are only lookalikes');
  assert.equal((await db.where('ownedItems', 'userId', ALEX)).length, ownedBefore, 'a candidate is not an item until confirmed');

  // 3. A typed style code re-runs matching and becomes identifier evidence.
  await api.addMatchEvidence(alex, { jobId: job.id, code: 'kr2 - 410', idempotencyKey: 'code-1' });
  job = await waitForJob(api, alex, job.id);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.texts.map((t) => [t.text, t.source]), [['kr2 - 410', 'user_entered']]);
  const matched = job.result.candidates[0];
  assert.equal(matched.variantId, TARGET);
  assert.ok(matched.evidence.some((e) => e.kind === 'identifier' && e.source === 'user_entered' && e.detail.includes(TARGET_CODE)));

  // 4. Confirm: the person's choice plus a matching code is identifier_supported, and saying so
  // names where the code came from. The original photo stays attached; the catalog image shows.
  const { item, job: confirmedJob } = await api.confirmMatch(alex, {
    jobId: job.id,
    candidateId: matched.id,
    variantId: TARGET,
    details: { size: { value: '10', system: 'US-M' }, condition: 'good' },
    idempotencyKey: 'confirm-1',
  });
  assert.equal(confirmedJob.status, 'confirmed');
  assert.equal(confirmedJob.confirmedItemId, item.id);
  assert.equal(item.variantId, TARGET);
  assert.equal(item.identity.resolution, 'identifier_supported');
  assert.equal(item.identity.variant, 'confirmed');
  assert.equal(item.identity.retrieval, 'candidate_found');
  assert.equal(item.identity.confirmedBy, ALEX);
  assert.equal(item.identity.matchJobId, job.id);
  assert.ok(item.identity.evidence.some((e) => e.kind === 'identifier' && e.source === 'user_entered' && /KR2-410 that you typed matches this version/.test(e.detail)));
  assert.ok(item.identity.evidence.some((e) => e.kind === 'user_selection' && /You confirmed this match/.test(e.detail)));
  assert.deepEqual(item.details.size, { value: '10', system: 'US-M' }, 'the size is what the person entered');
  assert.equal(item.photos.originalId, upload.photoId);
  assert.equal(item.display, 'catalog');
  assert.equal(item.image.kind, 'catalog');
  assert.equal(item.image.label, 'Catalog image');
  assert.deepEqual(item.image.options, ['catalog', 'original'], 'the person can switch back to their photo');
  assert.equal(item.code, TARGET_CODE);
  assert.ok(await db.get('photos', upload.photoId), 'the original photo is kept');
  const photoUrl = await api.getPhotoUrl(alex, { photoId: upload.photoId });
  assert.match(photoUrl.url, /^blob:test\//);

  // Confirming again is refused: one job, one item. The same idempotency key replays the result.
  await rejectsWith(api.confirmMatch(alex, { jobId: job.id, candidateId: matched.id, variantId: TARGET, idempotencyKey: 'confirm-2' }), 'conflict');
  const replay = await api.confirmMatch(alex, { jobId: job.id, candidateId: matched.id, variantId: TARGET, idempotencyKey: 'confirm-1' });
  assert.equal(replay.item.id, item.id);
  assert.equal((await db.where('ownedItems', 'userId', ALEX)).length, ownedBefore + 1);

  const listed = await api.listOwned(alex, {});
  assert.ok(listed.items.some((i) => i.id === item.id && i.title === 'Runner 2' && i.brandName === 'Kestrel'));

  // 5. Matching recommendations: real catalog variants, explained by the person's own items.
  const recs = await api.recommend(alex, { mode: 'matching', seedIds: [item.id] });
  assert.equal(recs.mode, 'matching');
  assert.ok(recs.items.length > 0, 'something pairs with the runner');
  assert.ok(recs.items.every((i) => i.kind === 'complementary'));
  assert.ok(recs.items.every((i) => !['vela-court-low--white-gum', 'harbor-pine-deck-jacket--navy', 'fieldhouse-wool-trouser--grey', 'arden-field--af38-sl-bk', TARGET].includes(i.variantId)), 'versions Alex owns are not recommended');
  assert.ok(recs.excluded.owned > 0, 'and leaving them out is counted');
  await assertGrounded(env, recs.items, ALEX);
  const named = recs.items.filter((i) => i.related.some((r) => r.itemId === item.id));
  assert.ok(named.length > 0, 'results relate to the new runner');
  for (const rec of named) {
    assert.match(rec.explanation, /your Kestrel Runner 2/, 'the explanation names the owned item');
    assert.ok(rec.related.every((r) => r.detail && typeof r.detail === 'string'));
  }
  assert.ok(recs.applied.hard.some((h) => h.kind === 'size' && /32 × 32, from your profile/.test(h.label)), 'profile sizes are applied and said');

  // 6. Offers for a recommended clothing variant in the profile size for its slot.
  const profile = await api.getProfile(alex, {});
  const priced = recs.items.find((i) => i.price.status !== 'unknown' && i.size);
  assert.ok(priced, 'at least one sized recommendation has a known price');
  const pricedProduct = CATALOG.product(priced.productId);
  const slot = pricedProduct.category === 'sneaker' ? 'shoe' : ['chinos', 'trousers', 'jeans', 'shorts'].includes(pricedProduct.type) ? 'bottom' : 'top';
  assert.deepEqual(priced.size, profile.sizes[slot], 'the size is the profile size for that kind of item');
  const offers = await api.getOffers(alex, { variantId: priced.variantId, size: priced.size, condition: 'new_only' });
  assert.equal(offers.variantId, priced.variantId);
  assert.deepEqual(offers.size, priced.size);
  assert.ok(offers.rows.length > 0);
  for (const row of offers.rows) {
    const offer = CATALOG.offers.get(row.offerId);
    assert.equal(offer.variantId, priced.variantId, 'rows are for exactly this version');
    assert.equal(row.condition, 'new');
    assert.equal(row.priceMinor, offer.sizes.find((s) => s.value === priced.size.value).priceMinor, 'the price is the listing price in that size');
    if (row.tax.kind === 'unknown') assert.ok(row.missing.includes('tax'), 'unknown tax stays unknown');
  }
  assert.equal(priced.price.fromMinor, Math.min(...offers.rows.map((r) => r.priceMinor)), 'the card price is a real offer price');
  assert.ok(offers.disclosure.length > 0);

  // 7. Outbound click: recorded under the pseudonymous analytics id, and nothing is purchased.
  const wishBefore = await db.where('wishlistItems', 'userId', ALEX);
  const click = await api.createClick(alex, { offerId: offers.rows[0].offerId, idempotencyKey: 'click-1' });
  const again = await api.createClick(alex, { offerId: offers.rows[0].offerId, idempotencyKey: 'click-1' });
  assert.equal(again.clickRef, click.clickRef, 'a retried click is one click');
  assert.equal(new URL(click.destination).hostname, offers.rows[0].retailer.domain, 'the link goes to that retailer');
  const clicks = await db.all('clicks');
  assert.equal(clicks.length, 1);
  const user = await db.get('users', ALEX);
  assert.equal(clicks[0].analyticsId, user.analyticsId);
  assert.ok(!JSON.stringify(clicks[0]).includes(ALEX), 'click records never hold the user id');
  assert.deepEqual(await db.where('wishlistItems', 'userId', ALEX), wishBefore, 'a click changes no wishlist item');
  assert.equal((await db.where('ownedItems', 'userId', ALEX)).length, ownedBefore + 1, 'a click adds nothing to the collection');
  assert.equal((await db.all('conversions')).length, 0, 'a click is not a conversion');

  // 8. Marking a wishlist item bought is explicit and is the only way it becomes owned.
  const wish = wishBefore.find((w) => w.variantId === WISHED);
  assert.equal(wish.status, 'active');
  const bought = await api.markPurchased(alex, {
    itemId: wish.id,
    details: { size: { value: '10', system: 'US-M' }, condition: 'new', purchase: { priceMinor: 13000, date: '2026-10-14', from: 'Northline Supply' } },
    idempotencyKey: 'bought-1',
  });
  assert.equal(bought.wish.status, 'purchased');
  assert.equal(bought.wish.purchasedOwnedId, bought.owned.id);
  assert.equal(bought.owned.variantId, WISHED);
  assert.equal(bought.owned.identity.resolution, wish.identity.resolution, 'the wishlist identity carries over unchanged');
  assert.equal(bought.owned.fromWishlistId, wish.id);
  assert.deepEqual(bought.owned.details.purchase, { priceMinor: 13000, currency: 'USD', date: '2026-10-14', from: 'Northline Supply' });
  assert.equal((await db.where('ownedItems', 'userId', ALEX)).length, ownedBefore + 2);
  await rejectsWith(api.markPurchased(alex, { itemId: wish.id, idempotencyKey: 'bought-2' }), 'conflict');
  assert.equal((await api.listWishlist(alex, {})).items.some((w) => w.id === wish.id), false, 'it leaves the active wishlist');
  assert.equal((await api.listWishlist(alex, { status: 'purchased' })).items[0].id, wish.id);
});

test('nobody else can see or touch any of the journey', async () => {
  const env = await journeyEnv();
  const { api, db, alex, sam } = env;
  const upload = await api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'original', idempotencyKey: 'u' });
  const created = await api.createMatchJob(alex, { photoId: upload.photoId, category: 'sneaker', dest: 'owned', idempotencyKey: 'j' });
  const job = await waitForJob(api, alex, created.id);
  const { item } = await api.confirmMatch(alex, { jobId: job.id, candidateId: job.result.candidates[0].id, variantId: TARGET, idempotencyKey: 'c' });
  const wish = (await api.listWishlist(alex, {})).items[0];
  const alexIds = [upload.photoId, upload.processingId, job.id, item.id, wish.id];

  // Sam: every id behaves like one that doesn't exist.
  await rejectsWith(api.getOwned(sam, { itemId: item.id }), 'not_found');
  await rejectsWith(api.updateOwned(sam, { itemId: item.id, patch: { details: { notes: 'mine now' } } }), 'not_found');
  await rejectsWith(api.deleteOwned(sam, { itemId: item.id }), 'not_found');
  await rejectsWith(api.setDisplayImage(sam, { itemId: item.id, display: 'original' }), 'not_found');
  await rejectsWith(api.getMatchJob(sam, { jobId: job.id }), 'not_found');
  await rejectsWith(api.addMatchEvidence(sam, { jobId: job.id, code: TARGET_CODE, idempotencyKey: 's1' }), 'not_found');
  await rejectsWith(api.confirmMatch(sam, { jobId: job.id, candidateId: job.result.candidates[0].id, variantId: TARGET, idempotencyKey: 's2' }), 'not_found');
  await rejectsWith(api.createMatchJob(sam, { photoId: upload.photoId, category: 'sneaker', dest: 'owned', idempotencyKey: 's3' }), 'not_found');
  await rejectsWith(api.getPhotoUrl(sam, { photoId: upload.photoId }), 'not_found');
  await rejectsWith(api.cleanupPhoto(sam, { itemId: item.id, idempotencyKey: 's4' }), 'not_found');
  await rejectsWith(api.getWishlistItem(sam, { itemId: wish.id }), 'not_found');
  await rejectsWith(api.markPurchased(sam, { itemId: wish.id, idempotencyKey: 's5' }), 'not_found');
  await rejectsWith(api.recommend(sam, { mode: 'matching', seedIds: [item.id] }), 'not_found');
  await rejectsWith(api.helpMeChoose(sam, { wishlistIds: [wish.id] }), 'not_found');
  await rejectsWith(api.giveFeedback(sam, { productId: 'kestrel-runner-2', type: 'saved', contextItemId: item.id }), 'not_found');
  await rejectsWith(api.createOwned(sam, { category: 'sneaker', productId: 'kestrel-runner-2', variantId: TARGET, photos: { originalId: upload.photoId } }), 'not_found');

  // Sam's own reads and export hold nothing of Alex's.
  const samOwned = await api.listOwned(sam, {});
  assert.ok(samOwned.items.every((i) => i.userId === SAM));
  const samFeed = await api.recommend(sam, { mode: 'feed' });
  const samText = JSON.stringify([samOwned, await api.listWishlist(sam, {}), samFeed, await api.exportMyData(sam, {})]);
  for (const id of alexIds) assert.ok(!samText.includes(id), `Sam never sees ${id}`);
  assert.ok(!samText.includes(ALEX), "Sam never sees Alex's account id");

  // An unassigned stylist can't open the photo either.
  const riley = await env.as(RILEY);
  await rejectsWith(api.getPhotoUrl(riley, { photoId: upload.photoId }), 'not_found');
  await rejectsWith(api.listOwned(riley, {}), 'forbidden');

  // The admin manages operations but can't read inventories; job health never shows the person.
  const morgan = await env.as(MORGAN);
  await rejectsWith(api.listOwned(morgan, {}), 'forbidden');
  await rejectsWith(api.getMatchJob(morgan, { jobId: job.id }), 'forbidden');
  await rejectsWith(api.getPhotoUrl(morgan, { photoId: upload.photoId }), 'not_found');
  const jobs = await api.adminListJobs(morgan, {});
  const row = jobs.jobs.find((j) => j.id === job.id);
  assert.equal(row.status, 'confirmed');
  assert.match(row.person, /^p-[0-9a-z]{7}$/);
  const adminText = JSON.stringify([jobs, await api.adminOverview(morgan, {}), await api.adminListAccounts(morgan, {})]);
  for (const id of [upload.photoId, item.id, wish.id]) assert.ok(!adminText.includes(id), `admin views never include ${id}`);
  assert.ok(!JSON.stringify(jobs).includes(ALEX), 'job health is not tied to the account id');

  // Alex's own records are untouched by all of the above.
  const still = await api.getOwned(alex, { itemId: item.id });
  assert.equal(still.details.notes, '');
  assert.ok(await db.get('photos', upload.photoId));
});
