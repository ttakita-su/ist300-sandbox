import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv, fakeJpeg, fakeWebProvider, rejectsWith, ALEX, SAM } from '../helpers.mjs';

async function setup() {
  const web = fakeWebProvider({ searchImage: { status: 'no_match', reason: 'No suitable product found.' } });
  const env = await createTestEnv({ providers: { web }, config: { providerSimulation: { vision: 'error' } } });
  const alex = await env.as(ALEX);
  const sam = await env.as(SAM);
  const upload = await env.api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'original' });
  return { ...env, web, alex, sam, upload };
}

test('online photo jobs are ready without catalog analysis and search only on an explicit call', async () => {
  const { api, db, web, alex, upload } = await setup();
  const before = await api.listOwned(alex, {});
  const job = await api.createMatchJob(alex, { photoId: upload.photoId, mode: 'online', category: 'clothing' });
  assert.equal(job.status, 'done');
  assert.equal(job.mode, 'online');
  assert.equal(job.result.retrieval, 'not_run');
  assert.deepEqual(job.result.candidates, []);
  assert.equal(job.web, null);
  assert.equal(web.calls.searchImage.length, 0);
  assert.equal((await db.all('catalogFeatures')).length, 0);
  const searched = await api.searchWebForPhoto(alex, { jobId: job.id, idempotencyKey: 'photo-once' });
  assert.equal(searched.web.status, 'no_match');
  await api.searchWebForPhoto(alex, { jobId: job.id, idempotencyKey: 'photo-once' });
  assert.equal(web.calls.searchImage.length, 1);
  assert.deepEqual(await api.listOwned(alex, {}), before, 'search does not save an item');
});

test('online photo jobs validate mode, ownership, and store-image provenance', async () => {
  const { api, alex, sam, upload, db } = await setup();
  await rejectsWith(api.createMatchJob(alex, { photoId: upload.photoId, mode: 'invented' }), 'invalid');
  await rejectsWith(api.createMatchJob(sam, { photoId: upload.photoId, mode: 'online' }), 'not_found');
  const photo = await db.get('photos', upload.photoId);
  await db.put('photos', { ...photo, kind: 'web' });
  await rejectsWith(api.createMatchJob(alex, { photoId: upload.photoId, mode: 'online' }), 'not_found');
});

test('no online match can become an editable clothing label without inventing a brand', async () => {
  const { api, alex, upload } = await setup();
  const job = await api.createMatchJob(alex, { photoId: upload.photoId, mode: 'online', category: 'clothing' });
  const { item } = await api.confirmMatch(alex, {
    jobId: job.id, custom: { name: 'My blue shirt', brand: '', type: 'tee', colors: ['blue'] },
  });
  assert.equal(item.custom.brand, null);
  assert.equal(item.identity.resolution, 'manual');
  assert.equal(item.productId, null);
  assert.equal(item.photos.originalId, upload.photoId);
  await api.updateOwned(alex, { itemId: item.id, patch: { custom: { name: 'My red hoodie', type: 'hoodie', colors: ['red'] } } });
  const edited = await api.getOwned(alex, { itemId: item.id });
  assert.equal(edited.custom.brand, null);
  assert.deepEqual(edited.custom.colors, ['red']);
  assert.equal(edited.custom.type, 'hoodie');
  assert.equal(edited.photos.originalId, upload.photoId);
  await rejectsWith(api.updateOwned(alex, { itemId: item.id, patch: { custom: { name: '\u200b' } } }), 'invalid');
});

test('brandless clothing labels survive a wishlist purchase transfer', async () => {
  const { api, alex, upload } = await setup();
  const job = await api.createMatchJob(alex, { photoId: upload.photoId, mode: 'online', category: 'clothing', dest: 'wishlist' });
  const { item } = await api.confirmMatch(alex, { jobId: job.id, custom: { name: 'Blue shirt', type: 'tee', colors: ['blue'] } });
  assert.equal(item.custom.brand, null);
  const out = await api.markPurchased(alex, { itemId: item.id, idempotencyKey: 'buy-label' });
  assert.equal(out.owned.custom.brand, null);
  assert.equal(out.owned.photos.originalId, upload.photoId);
});
