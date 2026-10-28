// Inventory, photos and wishlist operations: the person's own collection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv, rejectsWith, fakeJpeg, ALEX, SAM, NOW } from '../helpers.mjs';
import { MAX_UPLOAD_BYTES, sniffImageType, validateUploadBlob } from '../../js/server/validate-image.js';

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
/** An ISO-BMFF ftyp box with the given brands, as HEIC/HEIF/AVIF files start. */
function ftyp(major, compatible = []) {
  const size = 16 + compatible.length * 4;
  return new Uint8Array([0, 0, 0, size, ...ascii('ftyp'), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii), 0, 0, 0, 0]);
}
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const blobOf = (bytes, type = 'image/jpeg', size = 4096) => {
  const data = new Uint8Array(Math.max(size, bytes.length));
  data.set(bytes);
  return new Blob([data], { type });
};

async function setup() {
  const env = await createTestEnv();
  const alex = await env.as(ALEX);
  const sam = await env.as(SAM);
  return { ...env, alex, sam };
}

const byVariant = (items, variantId) => items.find((i) => i.variantId === variantId);

// ---------- Upload validation ----------

test('sniffImageType reads the real format from the first bytes', () => {
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0])), 'image/jpeg');
  assert.equal(sniffImageType(new Uint8Array(PNG)), 'image/png');
  assert.equal(sniffImageType(new Uint8Array([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBPVP8 ')])), 'image/webp');
  assert.equal(sniffImageType(new Uint8Array(ascii('GIF89a......'))), 'image/gif');
  assert.equal(sniffImageType(ftyp('heic', ['mif1', 'heic'])), 'image/heic');
  assert.equal(sniffImageType(ftyp('heix')), 'image/heic');
  assert.equal(sniffImageType(ftyp('hevc')), 'image/heic');
  assert.equal(sniffImageType(ftyp('mif1', ['heic'])), 'image/heic');
  assert.equal(sniffImageType(ftyp('mif1', ['miaf'])), 'image/heif');
  assert.equal(sniffImageType(ftyp('msf1')), 'image/heif');
  assert.equal(sniffImageType(ftyp('heif')), 'image/heif');
  // AVIF uses the same container and the mif1 brand, but it is not an accepted format.
  assert.equal(sniffImageType(ftyp('avif', ['mif1', 'miaf'])), null);
  assert.equal(sniffImageType(ftyp('mif1', ['avif'])), null);
  assert.equal(sniffImageType(ftyp('isom', ['mp41'])), null, 'an MP4 video is not an image');
  assert.equal(sniffImageType(new Uint8Array(ascii('%PDF-1.7'))), null);
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8])), null, 'too short to tell');
});

test('validateUploadBlob never trusts the declared type', async () => {
  assert.deepEqual(await validateUploadBlob(blobOf(PNG, 'image/jpeg')), { mime: 'image/png' });
  assert.deepEqual(await validateUploadBlob(blobOf(ftyp('heic', ['mif1']), '')), { mime: 'image/heic' });

  const pdf = await rejectsWith(validateUploadBlob(blobOf(ascii('%PDF-1.7'), 'image/jpeg')), 'unsupported');
  assert.equal(pdf.message, 'Use a JPEG, PNG, WebP or HEIC photo.');
  await rejectsWith(validateUploadBlob(blobOf(ascii('GIF89a'), 'image/gif')), 'unsupported');
  await rejectsWith(validateUploadBlob(blobOf(ftyp('avif', ['mif1']), 'image/avif')), 'unsupported');

  const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  big.set([0xff, 0xd8, 0xff, 0xe0]);
  const tooBig = await rejectsWith(validateUploadBlob(new Blob([big], { type: 'image/jpeg' })), 'invalid');
  assert.equal(tooBig.message, 'This photo is larger than 15 MB. Choose a smaller one or retake it.');
  const exact = new Uint8Array(MAX_UPLOAD_BYTES);
  exact.set([0xff, 0xd8, 0xff, 0xe0]);
  assert.deepEqual(await validateUploadBlob(new Blob([exact])), { mime: 'image/jpeg' }, '15 MB exactly is allowed');

  await rejectsWith(validateUploadBlob(new Blob([])), 'invalid');
  await rejectsWith(validateUploadBlob('not a blob'), 'invalid');
});

test('uploadPhoto stores a private original and a processing copy linked both ways', async () => {
  const { api, db, alex } = await setup();
  const result = await api.uploadPhoto(alex, { blob: fakeJpeg(3000), kind: 'original' });
  assert.deepEqual(Object.keys(result).sort(), ['bytes', 'height', 'mime', 'photoId', 'processingId', 'width']);
  assert.equal(result.mime, 'image/jpeg');
  assert.equal(result.width, 1200);
  assert.equal(result.height, 900);
  assert.equal(result.bytes, 3000);

  const original = await db.get('photos', result.photoId);
  const processing = await db.get('photos', result.processingId);
  assert.equal(original.userId, ALEX);
  assert.equal(original.kind, 'original');
  assert.equal(original.processingId, result.processingId);
  assert.ok(original.blob instanceof Blob);
  assert.equal(processing.userId, ALEX);
  assert.equal(processing.kind, 'processing');
  assert.equal(processing.sourceId, result.photoId);
  // The processing size is unknown unless the provider reports it.
  assert.equal(processing.width, null);

  const label = await api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'label' });
  assert.equal((await db.get('photos', label.photoId)).kind, 'label');

  // The declared type is ignored: a PNG labeled as JPEG is stored as PNG.
  const png = await api.uploadPhoto(alex, { blob: blobOf(PNG, 'image/jpeg') });
  assert.equal(png.mime, 'image/png');

  await rejectsWith(api.uploadPhoto(alex, { blob: blobOf(ascii('GIF89a')) }), 'unsupported');
  await rejectsWith(api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'processing' }), 'invalid');
  await rejectsWith(api.uploadPhoto(alex, {}), 'invalid');
});

test('uploadPhoto passes provider errors through and repeats nothing under one key', async () => {
  const env = await createTestEnv({
    providers: {
      normalize: () => {
        throw Object.assign(new Error('decode'), { name: 'ApiError' });
      },
    },
  });
  const alex = await env.as(ALEX);
  // A non-ApiError from the provider becomes a safe 'unavailable' message.
  await rejectsWith(env.api.uploadPhoto(alex, { blob: fakeJpeg() }), 'unavailable');

  const { api, db, alex: a } = await setup();
  const first = await api.uploadPhoto(a, { blob: fakeJpeg(), idempotencyKey: 'photo-1' });
  const again = await api.uploadPhoto(a, { blob: fakeJpeg(), idempotencyKey: 'photo-1' });
  assert.equal(again.photoId, first.photoId);
  assert.equal((await db.where('photos', 'userId', ALEX)).length, 2, 'one original and one processing copy');
});

test('photo URLs expire after 10 minutes and are reused until then', async () => {
  const { api, clock, providers, alex } = await setup();
  const revoked = [];
  let n = 0;
  providers.urls = { objectUrl: (blob, id) => `blob:test/${id}/${(n += 1)}`, revoke: (url) => revoked.push(url) };
  const { photoId } = await api.uploadPhoto(alex, { blob: fakeJpeg() });
  const first = await api.getPhotoUrl(alex, { photoId });
  assert.equal(first.expiresAt, new Date(NOW + 10 * 60000).toISOString());
  assert.equal((await api.getPhotoUrl(alex, { photoId })).url, first.url, 'a live URL is handed out again');
  clock.advance(10 * 60000);
  const next = await api.getPhotoUrl(alex, { photoId });
  assert.notEqual(next.url, first.url);
  assert.ok(revoked.includes(first.url), 'the expired URL was revoked');
  await rejectsWith(api.getPhotoUrl(alex, { photoId: 'pho_missing' }), 'not_found');
});

// ---------- Collection ----------

test('create from catalog search, then list, filter, facet and sort', async () => {
  const { api, clock, alex, sam } = await setup();
  const created = await api.createOwned(alex, {
    category: 'sneaker',
    productId: 'kestrel-runner-2',
    variantId: 'kestrel-runner-2--olive-sail',
    details: { size: { value: '10', system: 'US-M' }, condition: 'new', notes: 'Weekend pair' },
  });
  assert.equal(created.userId, ALEX);
  assert.equal(created.identity.resolution, 'user_confirmed');
  assert.equal(created.identity.variant, 'confirmed');
  assert.deepEqual(created.identity.evidence.map((e) => [e.kind, e.source]), [['catalog_search', 'catalog']]);
  assert.equal(created.identity.confirmedBy, ALEX);
  assert.equal(created.title, 'Runner 2');
  assert.equal(created.subtitle, 'Olive / Sail');
  assert.equal(created.code, 'KR2-305');
  assert.equal(created.image.kind, 'catalog');
  assert.equal(created.copies, 1);

  const list = await api.listOwned(alex, {});
  assert.equal(list.total, 5);
  assert.equal(list.collectionTotal, 5);
  assert.equal(list.items[0].id, created.id, 'recent sort puts the newest first');
  assert.ok(list.items.every((i) => i.userId === ALEX));
  assert.deepEqual(list.facets.categories, { sneaker: 2, watch: 1, clothing: 2 });
  assert.deepEqual(list.facets.brands.map((b) => [b.id, b.count]), [['arden', 1], ['fieldhouse', 1], ['harbor-pine', 1], ['kestrel', 1], ['vela', 1]]);
  assert.equal(list.facets.colors.find((c) => c.name === 'white').count, 2, 'white gum sneakers and the watch indices');

  const sneakers = await api.listOwned(alex, { category: 'sneaker' });
  assert.deepEqual(sneakers.items.map((i) => i.variantId).sort(), ['kestrel-runner-2--olive-sail', 'vela-court-low--white-gum']);
  assert.deepEqual(sneakers.facets.categories, { sneaker: 2, watch: 1, clothing: 2 }, 'the category facet ignores the category filter');
  assert.deepEqual(sneakers.facets.brands.map((b) => b.id), ['kestrel', 'vela']);

  assert.deepEqual((await api.listOwned(alex, { q: 'daily' })).items.map((i) => i.variantId), ['vela-court-low--white-gum'], 'own notes are searchable');
  assert.deepEqual((await api.listOwned(alex, { q: 'af38' })).items.map((i) => i.variantId), ['arden-field--af38-sl-bk'], 'codes are searchable');
  assert.deepEqual((await api.listOwned(alex, { q: 'harbor jacket' })).items.map((i) => i.variantId), ['harbor-pine-deck-jacket--navy']);
  assert.equal((await api.listOwned(alex, { q: 'anniversary' })).total, 0, "Sam's notes never match Alex's search");
  assert.deepEqual((await api.listOwned(alex, { brandId: 'vela' })).items.map((i) => i.productId), ['vela-court-low']);
  assert.deepEqual((await api.listOwned(alex, { color: 'navy' })).items.map((i) => i.variantId), ['harbor-pine-deck-jacket--navy']);
  const none = await api.listOwned(alex, { color: 'burgundy' });
  assert.equal(none.total, 0);
  assert.deepEqual(none.facets.colors.find((c) => c.name === 'burgundy'), { name: 'burgundy', label: 'Burgundy', count: 0 }, 'a selected color stays listed');

  const brands = (await api.listOwned(alex, { sort: 'brand' })).items.map((i) => i.brandName);
  assert.deepEqual(brands, ['Arden', 'Fieldhouse', 'Harbor & Pine', 'Kestrel', 'Vela']);
  const names = (await api.listOwned(alex, { sort: 'name' })).items.map((i) => i.title);
  assert.deepEqual(names, ['Court Low', 'Deck Field Jacket', 'Field', 'Runner 2', 'Wool Trouser']);
  const colors = (await api.listOwned(alex, { sort: 'color' })).items.map((i) => i.variantId);
  assert.deepEqual(colors, ['vela-court-low--white-gum', 'fieldhouse-wool-trouser--grey', 'arden-field--af38-sl-bk', 'harbor-pine-deck-jacket--navy', 'kestrel-runner-2--olive-sail']);

  clock.advance(1000);
  const samList = await api.listOwned(sam, {});
  assert.equal(samList.total, 3);
  assert.ok(samList.items.every((i) => i.userId === SAM));
  assert.ok(!samList.items.some((i) => i.id === created.id));
});

test('getOwned, update details, archive and restore', async () => {
  const { api, alex } = await setup();
  const { items } = await api.listOwned(alex, {});
  const jacket = byVariant(items, 'harbor-pine-deck-jacket--navy');

  const got = await api.getOwned(alex, { itemId: jacket.id });
  assert.equal(got.id, jacket.id);
  assert.equal(got.details.size.value, 'M');

  const updated = await api.updateOwned(alex, { itemId: jacket.id, patch: { details: { notes: 'Dry clean only', purchase: { priceMinor: 18000, date: '2025-09-01', from: 'Fieldhouse Outfitters' } } } });
  assert.equal(updated.details.notes, 'Dry clean only');
  assert.equal(updated.details.size.value, 'M', 'details merge rather than replace');
  assert.deepEqual(updated.details.purchase, { priceMinor: 18000, currency: 'USD', date: '2025-09-01', from: 'Fieldhouse Outfitters' });
  const bad = await rejectsWith(api.updateOwned(alex, { itemId: jacket.id, patch: { details: { size: { value: '10', system: 'WAIST-INSEAM' } } } }), 'invalid');
  assert.ok(bad.details.fields['details.size']);
  await rejectsWith(api.updateOwned(alex, { itemId: jacket.id, patch: { details: { serialNumber: 'X1' } } }), 'invalid');
  await rejectsWith(api.updateOwned(alex, { itemId: jacket.id, patch: {} }), 'invalid');
  // Identity is not part of the patch: it changes only through correctMatch.
  const sneaky = await api.updateOwned(alex, { itemId: jacket.id, patch: { details: { condition: 'good' }, identity: { resolution: 'identifier_supported' }, productId: 'arden-field' } });
  assert.equal(sneaky.identity.resolution, 'user_confirmed');
  assert.equal(sneaky.productId, 'harbor-pine-deck-jacket');

  const archived = await api.archiveOwned(alex, { itemId: jacket.id });
  assert.ok(archived.archivedAt);
  const active = await api.listOwned(alex, {});
  assert.ok(!active.items.some((i) => i.id === jacket.id));
  assert.equal(active.archivedCount, 1);
  assert.equal(active.collectionTotal, 3);
  const withArchived = await api.listOwned(alex, { includeArchived: true });
  assert.ok(withArchived.items.some((i) => i.id === jacket.id));
  const restored = await api.restoreOwned(alex, { itemId: jacket.id });
  assert.equal(restored.archivedAt, null);
  assert.equal((await api.listOwned(alex, {})).total, 4);
});

test('deleting an item removes it and its private photos', async () => {
  const { api, db, alex } = await setup();
  const original = await api.uploadPhoto(alex, { blob: fakeJpeg() });
  const label = await api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'label' });
  const item = await api.createOwned(alex, {
    source: 'manual',
    category: 'clothing',
    custom: { brand: 'Studio Nine', name: 'Canvas tote', colors: ['khaki'] },
    photos: { originalId: original.photoId, labelIds: [label.photoId] },
  });
  const { photoId: cleanedId } = await api.cleanupPhoto(alex, { itemId: item.id });
  assert.equal((await db.where('photos', 'userId', ALEX)).length, 5, 'original, label, two processing copies, cleaned');

  assert.deepEqual(await api.deleteOwned(alex, { itemId: item.id }), { ok: true });
  assert.equal((await db.where('photos', 'userId', ALEX)).length, 0);
  for (const id of [original.photoId, original.processingId, label.photoId, label.processingId, cleanedId]) assert.equal(await db.get('photos', id), null);
  await rejectsWith(api.getOwned(alex, { itemId: item.id }), 'not_found');
  await rejectsWith(api.getPhotoUrl(alex, { photoId: original.photoId }), 'not_found');
  await rejectsWith(api.deleteOwned(alex, { itemId: item.id }), 'not_found');
});

test('a photo two items share is kept until the last of them is deleted', async () => {
  const { api, db, alex } = await setup();
  const shared = await api.uploadPhoto(alex, { blob: fakeJpeg() });
  const tote = await api.createOwned(alex, { source: 'manual', category: 'clothing', custom: { brand: 'Studio Nine', name: 'Tote' }, photos: { originalId: shared.photoId } });
  const cap = await api.createOwned(alex, { source: 'manual', category: 'clothing', custom: { brand: 'Studio Nine', name: 'Cap' }, photos: { originalId: shared.photoId } });
  await api.deleteOwned(alex, { itemId: tote.id });
  assert.ok(await db.get('photos', shared.photoId), 'the cap still uses the photo');
  await api.deleteOwned(alex, { itemId: cap.id });
  assert.equal(await db.get('photos', shared.photoId), null);
  assert.equal(await db.get('photos', shared.processingId), null);
});

test('several physical copies are allowed after a duplicate warning', async () => {
  const { api, alex } = await setup();
  const err = await rejectsWith(api.createOwned(alex, { category: 'sneaker', productId: 'vela-court-low', variantId: 'vela-court-low--white-gum' }), 'duplicate');
  assert.equal(err.message, 'You already have this in your collection.');
  assert.equal(err.details.duplicates.length, 1);
  assert.equal(err.details.duplicates[0].variantId, 'vela-court-low--white-gum');
  assert.equal(err.details.duplicates[0].title, 'Court Low', 'duplicates come back as views');

  const second = await api.createOwned(alex, { category: 'sneaker', productId: 'vela-court-low', variantId: 'vela-court-low--white-gum', allowDuplicate: true, details: { size: { value: '10', system: 'US-M' } } });
  assert.equal(second.copies, 2);
  const copies = (await api.listOwned(alex, {})).items.filter((i) => i.variantId === 'vela-court-low--white-gum');
  assert.deepEqual(copies.map((i) => i.copies), [2, 2]);
  assert.equal((await api.checkDuplicates(alex, { productId: 'vela-court-low', variantId: 'vela-court-low--white-gum' })).duplicates.length, 2);

  // Same product with the version unknown is a possible duplicate too.
  await rejectsWith(api.createOwned(alex, { category: 'sneaker', productId: 'vela-court-low' }), 'duplicate');
  // A different colorway of the same model is not.
  const black = await api.createOwned(alex, { category: 'sneaker', productId: 'vela-court-low', variantId: 'vela-court-low--black-white' });
  assert.equal(black.copies, 1);

  await api.archiveOwned(alex, { itemId: second.id });
  const after = (await api.listOwned(alex, {})).items.find((i) => i.variantId === 'vela-court-low--white-gum');
  assert.equal(after.copies, 1, 'archived copies do not count');
  assert.equal((await api.checkDuplicates(alex, { category: 'clothing', custom: { brand: 'Nobody', name: 'Nothing' } })).duplicates.length, 0);
});

test('manual items carry no catalog identity, and callers cannot supply one', async () => {
  const { api, alex } = await setup();
  const item = await api.createOwned(alex, {
    source: 'manual',
    category: 'clothing',
    custom: { brand: 'Studio Nine', name: 'Canvas tote', variantName: 'Natural', colors: ['khaki', 'not-a-color'] },
    identity: { resolution: 'identifier_supported', variant: 'confirmed' },
  });
  assert.equal(item.productId, null);
  assert.equal(item.variantId, null);
  assert.equal(item.identity.resolution, 'manual');
  assert.equal(item.identity.variant, 'not_applicable');
  assert.deepEqual(item.identity.evidence, []);
  assert.equal(item.identity.confirmedBy, null);
  assert.equal(item.product, null);
  assert.equal(item.variant, null);
  assert.equal(item.code, null);
  assert.equal(item.subtitle, 'Natural');
  assert.deepEqual(item.custom.colors, ['khaki']);
  assert.equal(item.image.kind, 'placeholder', 'no catalog image is borrowed for a custom item');
  assert.equal(item.image.url, null);

  await rejectsWith(api.createOwned(alex, { source: 'manual', category: 'clothing', productId: 'harbor-pine-deck-jacket', custom: { brand: 'A', name: 'B' } }), 'invalid');
  const missing = await rejectsWith(api.createOwned(alex, { source: 'manual', category: 'clothing', custom: { brand: '' } }), 'invalid');
  assert.ok(missing.details.fields['custom.brand'] && missing.details.fields['custom.name']);
  await rejectsWith(api.createOwned(alex, { source: 'catalog_search', category: 'watch' }), 'invalid');
  await rejectsWith(api.createOwned(alex, { category: 'sneaker', productId: 'not-a-product' }), 'invalid');
  await rejectsWith(api.createOwned(alex, { category: 'watch', productId: 'kestrel-runner-2' }), 'invalid');
  await rejectsWith(api.createOwned(alex, { category: 'sneaker', productId: 'kestrel-runner-2', variantId: 'vela-court-low--white-gum' }), 'invalid');
});

test('a manual item needs a visible name and brand, on create and on edit', async () => {
  const { api, alex } = await setup();
  const before = (await api.listOwned(alex, {})).total;
  for (const name of ['', '   ', '​', ' ​‍﻿ ']) {
    const error = await rejectsWith(api.createOwned(alex, { source: 'manual', category: 'clothing', custom: { brand: 'Uniqlo', name } }), 'invalid');
    assert.equal(error.details.fields['custom.name'], 'Enter a name', JSON.stringify(name));
  }
  const brandless = await rejectsWith(api.createOwned(alex, { source: 'manual', category: 'clothing', custom: { brand: '​', name: 'Oxford shirt' } }), 'invalid');
  assert.equal(brandless.details.fields['custom.brand'], 'Enter the brand');
  assert.equal((await api.listOwned(alex, {})).total, before, 'nothing was saved');

  const item = await api.createOwned(alex, { source: 'manual', category: 'clothing', custom: { brand: 'Uniqlo', name: 'Oxford shirt', variantName: 'Light blue' } });
  for (const name of ['', '   ', '​']) {
    const error = await rejectsWith(api.updateOwned(alex, { itemId: item.id, patch: { custom: { name, variantName: 'Changed' } } }), 'invalid');
    assert.equal(error.details.fields['custom.name'], 'Enter a name', JSON.stringify(name));
  }
  const kept = await api.getOwned(alex, { itemId: item.id });
  assert.equal(kept.custom.name, 'Oxford shirt');
  assert.equal(kept.custom.variantName, 'Light blue', 'a refused edit writes nothing');

  // A joiner inside a visible name (an emoji sequence) is still a name.
  const emoji = await api.createOwned(alex, { source: 'manual', category: 'clothing', custom: { brand: 'Studio', name: '\u{1F469}‍\u{1F4BB} tee' } });
  assert.equal(emoji.custom.name, '\u{1F469}‍\u{1F4BB} tee');
});

test('editing a manual item rewrites only that record, and deleting one of two copies keeps the other', async () => {
  const { api, alex } = await setup();
  const shoe = { source: 'manual', category: 'sneaker', custom: { brand: 'Nike', name: 'Air Force 1', variantName: 'White' } };
  const first = await api.createOwned(alex, shoe);
  const copy = await api.createOwned(alex, { ...shoe, allowDuplicate: true });
  const watch = await api.createOwned(alex, { source: 'manual', category: 'watch', custom: { brand: 'Casio', name: 'F-91W', variantName: 'Black' } });
  const total = (await api.listOwned(alex, {})).total;

  const edited = await api.updateOwned(alex, { itemId: watch.id, patch: { custom: { name: 'F-91W-1', variantName: 'Gold' } } });
  assert.equal(edited.id, watch.id);
  assert.equal(edited.category, 'watch');
  assert.deepEqual([edited.custom.brand, edited.custom.name, edited.custom.variantName], ['Casio', 'F-91W-1', 'Gold']);
  assert.equal((await api.listOwned(alex, {})).total, total, 'the edit added no record');
  assert.equal((await api.getOwned(alex, { itemId: first.id })).custom.name, 'Air Force 1', 'other items are untouched');

  await api.deleteOwned(alex, { itemId: copy.id });
  await rejectsWith(api.getOwned(alex, { itemId: copy.id }), 'not_found');
  const left = await api.getOwned(alex, { itemId: first.id });
  assert.deepEqual([left.custom.name, left.updatedAt], ['Air Force 1', first.updatedAt], 'the identical copy is still there, unchanged');
  assert.equal((await api.getOwned(alex, { itemId: watch.id })).custom.name, 'F-91W-1');
  assert.equal((await api.listOwned(alex, {})).total, total - 1);
});

test('items added from a product link record the link as their evidence', async () => {
  const { api, alex } = await setup();
  const item = await api.createOwned(alex, {
    source: 'product_link',
    sourceUrl: 'https://northline.example/p/NL-50877',
    category: 'sneaker',
    productId: 'kestrel-runner-2',
    variantId: 'kestrel-runner-2--olive-bone',
  });
  assert.equal(item.sourceUrl, 'https://northline.example/p/NL-50877');
  assert.equal(item.identity.resolution, 'user_confirmed', "the person's choice, not verification");
  assert.deepEqual(item.identity.evidence, [{ kind: 'product_link', source: 'url', detail: 'Added from a link on northline.example' }]);
  await rejectsWith(api.createOwned(alex, { source: 'product_link', category: 'sneaker', productId: 'kestrel-runner-2', allowDuplicate: true }), 'invalid');
  await rejectsWith(api.createOwned(alex, { source: 'product_link', sourceUrl: 'javascript:alert(1)', category: 'sneaker', productId: 'kestrel-runner-2', allowDuplicate: true }), 'invalid');
  await rejectsWith(api.createOwned(alex, { source: 'product_link', sourceUrl: 'https://user:pw@northline.example/p/1', category: 'sneaker', productId: 'kestrel-runner-2', allowDuplicate: true }), 'invalid');
});

test('correcting a match changes only the person’s record, never the catalog', async () => {
  const { api, db, alex, sam } = await setup();
  const catalogBefore = JSON.stringify([await db.all('catalogProducts'), await db.all('catalogVariants')]);
  const samBefore = JSON.stringify(await db.where('ownedItems', 'userId', SAM));
  const watch = byVariant((await api.listOwned(alex, {})).items, 'arden-field--af38-sl-bk');
  assert.equal(watch.identity.resolution, 'identifier_supported');

  const corrected = await api.correctMatch(alex, { itemId: watch.id, productId: 'arden-field', variantId: 'arden-field--af40-sl-bk' });
  assert.equal(corrected.variantId, 'arden-field--af40-sl-bk');
  assert.equal(corrected.subtitle, '40 mm, steel, black dial');
  assert.equal(corrected.identity.resolution, 'user_confirmed', 'the old code evidence no longer supports the new choice');
  assert.equal(corrected.identity.variant, 'confirmed');
  assert.equal(corrected.identity.retrieval, 'candidate_found', 'what matching found is kept');
  assert.deepEqual(corrected.identity.evidence.map((e) => [e.kind, e.source]), [['user_selection', 'catalog']]);
  assert.match(corrected.identity.evidence[0].detail, /40 mm/);
  assert.equal(corrected.identity.confirmedBy, ALEX);
  assert.equal(corrected.details.serialNumber, 'A38-118204', 'private details stay with the item');

  const unsure = await api.correctMatch(alex, { itemId: watch.id, productId: 'arden-field', variantId: null });
  assert.equal(unsure.variantId, null);
  assert.equal(unsure.identity.variant, 'incomplete');
  assert.equal(unsure.subtitle, 'Reference not confirmed', 'a watch names the reference, as the label strip does');

  const custom = await api.correctMatch(alex, { itemId: watch.id, productId: null, custom: { brand: 'Old Town', name: 'Field watch', colors: ['black'] } });
  assert.equal(custom.productId, null);
  assert.equal(custom.variantId, null);
  assert.equal(custom.identity.resolution, 'manual');
  assert.equal(custom.identity.variant, 'not_applicable');
  assert.equal(custom.title, 'Field watch');
  assert.equal(custom.image.kind, 'placeholder');

  await rejectsWith(api.correctMatch(alex, { itemId: watch.id, productId: 'kestrel-runner-2', variantId: 'kestrel-runner-2--olive-bone' }), 'invalid');
  await rejectsWith(api.correctMatch(alex, { itemId: watch.id, productId: 'arden-field', variantId: 'kestrel-runner-2--olive-bone' }), 'invalid');
  await rejectsWith(api.correctMatch(alex, { itemId: watch.id, productId: null, custom: { brand: '', name: '' } }), 'invalid');
  await rejectsWith(api.correctMatch(sam, { itemId: watch.id, productId: 'arden-field', variantId: 'arden-field--af38-sl-bk' }), 'not_found');

  assert.equal(JSON.stringify([await db.all('catalogProducts'), await db.all('catalogVariants')]), catalogBefore);
  assert.equal(JSON.stringify(await db.where('ownedItems', 'userId', SAM)), samBefore);
});

test('reporting a catalog issue files a correction without touching the catalog', async () => {
  const { api, db, alex } = await setup();
  const before = await db.get('catalogVariants', 'arden-field--af38-sl-bk');
  const correction = await api.reportCatalogIssue(alex, { productId: 'arden-field', variantId: 'arden-field--af38-sl-bk', field: 'variant.attributes.lugWidthMm', proposedValue: '19', note: 'Measured with calipers' });
  assert.equal(correction.status, 'open');
  assert.equal(correction.userId, ALEX);
  assert.equal(correction.proposedValue, 19);
  assert.equal(correction.currentValue, 20);
  assert.deepEqual(await db.get('catalogVariants', 'arden-field--af38-sl-bk'), before);

  await rejectsWith(api.reportCatalogIssue(alex, { productId: 'arden-field', variantId: 'arden-field--af38-sl-bk', field: 'variant.attributes.secret', proposedValue: 1 }), 'invalid');
  await rejectsWith(api.reportCatalogIssue(alex, { productId: 'arden-field', variantId: 'arden-field--af38-sl-bk', field: 'variant.attributes.lugWidthMm', proposedValue: 20 }), 'invalid');
  await rejectsWith(api.reportCatalogIssue(alex, { productId: 'arden-field', field: 'variant.attributes.lugWidthMm', proposedValue: 19 }), 'invalid');
  await rejectsWith(api.reportCatalogIssue(alex, { productId: 'arden-field', variantId: 'arden-field--af38-sl-bk', field: 'variant.identifiers.styleCode', proposedValue: 'X-1' }), 'invalid');
  await rejectsWith(api.reportCatalogIssue(alex, { productId: 'nope', field: 'product.name', proposedValue: 'X' }), 'invalid');
  await rejectsWith(api.reportCatalogIssue(alex, { productId: 'arden-field', field: 'other', note: '' }), 'invalid');
  const other = await api.reportCatalogIssue(alex, { productId: 'arden-field', field: 'other', note: 'The date window is at 3, not 6.' });
  assert.equal(other.proposedValue, null);
});

test('switching the display image keeps the original photo', async () => {
  const { api, db, alex, sam } = await setup();
  const photo = await api.uploadPhoto(alex, { blob: fakeJpeg() });
  const item = await api.createOwned(alex, { category: 'sneaker', productId: 'kestrel-runner-2', variantId: 'kestrel-runner-2--navy-white', photos: { originalId: photo.photoId } });
  assert.equal(item.display, 'catalog');
  assert.equal(item.image.kind, 'catalog');
  assert.equal(item.image.label, 'Catalog image');
  assert.deepEqual(item.image.options, ['catalog', 'original']);

  const mine = await api.setDisplayImage(alex, { itemId: item.id, display: 'original' });
  assert.equal(mine.image.kind, 'original');
  assert.equal(mine.image.photoId, photo.photoId);
  assert.equal(mine.image.label, 'Your photo');
  await rejectsWith(api.setDisplayImage(alex, { itemId: item.id, display: 'cleaned' }), 'invalid');

  const { photoId: cleanedId } = await api.cleanupPhoto(alex, { itemId: item.id });
  const cleaned = await api.setDisplayImage(alex, { itemId: item.id, display: 'cleaned' });
  assert.equal(cleaned.image.kind, 'cleaned');
  assert.equal(cleaned.image.photoId, cleanedId);
  assert.equal(cleaned.image.label, 'Your photo, cleaned up');
  assert.deepEqual(cleaned.image.options, ['catalog', 'original', 'cleaned']);

  const back = await api.setDisplayImage(alex, { itemId: item.id, display: 'catalog' });
  assert.equal(back.image.kind, 'catalog');
  assert.equal(back.photos.originalId, photo.photoId);
  assert.ok(await db.get('photos', photo.photoId), 'the original is never deleted by a display change');
  assert.ok(await db.get('photos', cleanedId));
  assert.ok((await api.getPhotoUrl(alex, { photoId: photo.photoId })).url);
  await rejectsWith(api.setDisplayImage(alex, { itemId: item.id, display: 'poster' }), 'invalid');

  // Source terms forbid this catalog image in a collection, so the choice is refused with the reason.
  const charcoal = byVariant((await api.listOwned(sam, {})).items, 'fieldhouse-wool-trouser--charcoal');
  const refused = await rejectsWith(api.setDisplayImage(sam, { itemId: charcoal.id, display: 'catalog' }), 'invalid');
  assert.match(refused.message, /live offer/);
  await rejectsWith(api.setDisplayImage(sam, { itemId: charcoal.id, display: 'original' }), 'invalid');
});

test('photos can be attached to an item later, replaced and removed', async () => {
  const { api, db, alex, sam } = await setup();
  const jacket = byVariant((await api.listOwned(alex, {})).items, 'harbor-pine-deck-jacket--navy');
  const first = await api.uploadPhoto(alex, { blob: fakeJpeg() });
  const attached = await api.updateOwned(alex, { itemId: jacket.id, patch: { photos: { originalId: first.photoId } } });
  assert.equal(attached.photos.originalId, first.photoId);
  assert.equal(attached.image.kind, 'catalog', 'attaching a photo does not change the display choice');
  await api.cleanupPhoto(alex, { itemId: jacket.id });
  await api.setDisplayImage(alex, { itemId: jacket.id, display: 'cleaned' });

  const second = await api.uploadPhoto(alex, { blob: fakeJpeg() });
  const replaced = await api.updateOwned(alex, { itemId: jacket.id, patch: { photos: { originalId: second.photoId } } });
  assert.equal(replaced.photos.originalId, second.photoId);
  assert.equal(replaced.photos.cleanedId, null, 'the cleaned copy belonged to the old photo');
  assert.equal(replaced.display, 'original');
  assert.equal(await db.get('photos', first.photoId), null, 'the replaced photo is deleted');

  const removed = await api.updateOwned(alex, { itemId: jacket.id, patch: { photos: { originalId: null } } });
  assert.equal(removed.photos.originalId, null);
  assert.equal(removed.display, 'catalog');
  assert.equal(await db.get('photos', second.photoId), null);

  const samPhoto = await api.uploadPhoto(sam, { blob: fakeJpeg() });
  await rejectsWith(api.updateOwned(alex, { itemId: jacket.id, patch: { photos: { originalId: samPhoto.photoId } } }), 'not_found');
  await rejectsWith(api.createOwned(alex, { source: 'manual', category: 'clothing', custom: { brand: 'A', name: 'B' }, photos: { originalId: samPhoto.photoId } }), 'not_found');
  await rejectsWith(api.updateOwned(alex, { itemId: jacket.id, patch: { photos: { originalId: second.processingId } } }), 'not_found');
});

test('createOwned is idempotent for repeated keys and concurrent double taps', async () => {
  const { api, db, alex } = await setup();
  const args = { category: 'sneaker', productId: 'kestrel-runner-2', variantId: 'kestrel-runner-2--navy-white', idempotencyKey: 'idem_form_1' };
  const first = await api.createOwned(alex, args);
  const retry = await api.createOwned(alex, args);
  assert.equal(retry.id, first.id);
  // Even a retry that would now be a duplicate returns the first result instead of a warning.
  assert.equal((await db.where('ownedItems', 'userId', ALEX)).filter((i) => i.variantId === 'kestrel-runner-2--navy-white').length, 1);

  const tapArgs = { source: 'manual', category: 'clothing', custom: { brand: 'Studio Nine', name: 'Overshirt' }, idempotencyKey: 'idem_tap_1' };
  const [a, b] = await Promise.all([api.createOwned(alex, tapArgs), api.createOwned(alex, tapArgs)]);
  assert.equal(a.id, b.id);
  assert.equal((await db.where('ownedItems', 'userId', ALEX)).filter((i) => i.custom?.name === 'Overshirt').length, 1);

  // A failed attempt stores nothing, so the same key can be used once the person confirms.
  const dupArgs = { category: 'watch', productId: 'arden-field', variantId: 'arden-field--af38-sl-bk', idempotencyKey: 'idem_dup_1' };
  await rejectsWith(api.createOwned(alex, dupArgs), 'duplicate');
  const confirmed = await api.createOwned(alex, { ...dupArgs, allowDuplicate: true });
  assert.equal(confirmed.copies, 2);
  assert.equal((await api.createOwned(alex, { ...dupArgs, allowDuplicate: true })).id, confirmed.id);
});

// ---------- Wishlist ----------

test('wishlist create, duplicate warning, update and remove', async () => {
  const { api, alex, sam } = await setup();
  const list = await api.listWishlist(alex, {});
  assert.deepEqual(list.items.map((w) => w.variantId), ['kestrel-runner-2--olive-bone']);
  assert.deepEqual(list.counts, { active: 1, purchased: 0 });

  const dup = await rejectsWith(api.createWishlist(alex, { category: 'sneaker', productId: 'kestrel-runner-2', variantId: 'kestrel-runner-2--olive-bone', reason: 'want_exact' }), 'duplicate');
  assert.equal(dup.message, 'This is already on your wishlist.');
  assert.equal(dup.details.duplicates[0].variantId, 'kestrel-runner-2--olive-bone');

  const jacket = byVariant((await api.listOwned(alex, {})).items, 'harbor-pine-deck-jacket--navy');
  const wish = await api.createWishlist(alex, {
    category: 'watch',
    productId: 'arden-field',
    variantId: 'arden-field--af38-sl-cr',
    reason: 'match_owned',
    linkedOwnedIds: [jacket.id],
    desired: { condition: 'new_or_used' },
    targetPriceMinor: 40000,
    sourceUrl: 'https://meridiantime.example/watch/AF38-SL-CR',
  });
  assert.equal(wish.intent, 'complement', 'intent defaults from the reason');
  assert.equal(wish.desired.variantFlexible, true);
  assert.deepEqual(wish.identity.evidence.map((e) => e.kind), ['product_link']);
  assert.deepEqual(wish.linkedOwned.map((l) => l.id), [jacket.id]);
  assert.equal(wish.linkedOwned[0].title, 'Deck Field Jacket');
  assert.equal(wish.ownedCopies, 0);

  const samItem = (await api.listOwned(sam, {})).items[0];
  await rejectsWith(api.createWishlist(alex, { category: 'watch', productId: 'arden-field', reason: 'match_owned', linkedOwnedIds: [samItem.id], allowDuplicate: true }), 'not_found');
  await rejectsWith(api.createWishlist(alex, { category: 'watch', reason: 'like_style' }), 'invalid');
  await rejectsWith(api.createWishlist(alex, { category: 'watch', productId: 'arden-field', reason: 'because', allowDuplicate: true }), 'invalid');
  await rejectsWith(api.createWishlist(alex, { category: 'watch', productId: 'arden-field', reason: 'like_style', targetPriceMinor: 0, allowDuplicate: true }), 'invalid');

  const updated = await api.updateWishlist(alex, { itemId: wish.id, patch: { reason: 'want_exact', targetPriceMinor: null, reasonNote: 'For the office' } });
  assert.equal(updated.intent, 'exact', 'a new reason brings its default intent');
  assert.equal(updated.desired.variantFlexible, false);
  assert.equal(updated.targetPriceMinor, null);
  assert.equal(updated.reasonNote, 'For the office');
  assert.equal(updated.desired.condition, 'new_or_used', 'other preferences are kept');
  const reIntent = await api.updateWishlist(alex, { itemId: wish.id, patch: { intent: 'inspiration', desired: { size: null } } });
  assert.equal(reIntent.intent, 'inspiration');
  assert.equal(reIntent.reason, 'want_exact');
  await rejectsWith(api.updateWishlist(alex, { itemId: wish.id, patch: { desired: { condition: 'any' } } }), 'invalid');
  await rejectsWith(api.updateWishlist(alex, { itemId: wish.id, patch: { linkedOwnedIds: [samItem.id] } }), 'not_found');

  assert.deepEqual(await api.removeWishlist(alex, { itemId: wish.id }), { ok: true });
  assert.ok(!(await api.listWishlist(alex, {})).items.some((w) => w.id === wish.id));
  assert.ok((await api.listWishlist(alex, { status: 'removed' })).items.some((w) => w.id === wish.id));
  assert.equal((await api.getWishlistItem(alex, { itemId: wish.id })).status, 'removed');
  await rejectsWith(api.updateWishlist(alex, { itemId: wish.id, patch: { reasonNote: 'x' } }), 'conflict');
  // Once removed, the same version can be saved again without a warning.
  assert.ok(await api.createWishlist(alex, { category: 'watch', productId: 'arden-field', variantId: 'arden-field--af38-sl-cr', reason: 'like_style' }));
});

test('markPurchased is the only path from wishlist to collection', async () => {
  const { api, db, alex } = await setup();
  const [wish] = (await api.listWishlist(alex, {})).items;
  const ownedBefore = (await db.where('ownedItems', 'userId', ALEX)).length;

  // Visiting a retailer is a click, never a purchase.
  try {
    await api.createClick(alex, { offerId: 'offer-nl-50877', idempotencyKey: 'click-1' });
  } catch (error) {
    if (error.code !== 'not_implemented') throw error;
  }
  await api.updateWishlist(alex, { itemId: wish.id, patch: { reasonNote: 'Seen at Northline' } });
  assert.equal((await api.getWishlistItem(alex, { itemId: wish.id })).status, 'active');
  assert.equal((await db.where('ownedItems', 'userId', ALEX)).length, ownedBefore);

  const { owned, wish: purchased } = await api.markPurchased(alex, {
    itemId: wish.id,
    details: { size: { value: '10', system: 'US-M' }, condition: 'new', purchase: { priceMinor: 12400, date: '2026-10-10', from: 'Courtside Goods' } },
    idempotencyKey: 'buy-1',
  });
  assert.equal(owned.variantId, 'kestrel-runner-2--olive-bone');
  assert.deepEqual(owned.identity, wish.identity, 'the owned item carries the same catalog identity');
  assert.equal(owned.details.purchase.priceMinor, 12400);
  assert.equal(owned.fromWishlistId, wish.id);
  assert.equal(owned.image.kind, 'catalog');
  assert.equal(purchased.status, 'purchased');
  assert.equal(purchased.purchasedOwnedId, owned.id);
  assert.deepEqual(purchased.purchasedOwned, { id: owned.id });
  assert.equal((await db.where('ownedItems', 'userId', ALEX)).length, ownedBefore + 1);

  const repeat = await api.markPurchased(alex, { itemId: wish.id, details: {}, idempotencyKey: 'buy-1' });
  assert.equal(repeat.owned.id, owned.id, 'a retried tap returns the first result');
  await rejectsWith(api.markPurchased(alex, { itemId: wish.id, details: {} }), 'conflict');
  assert.equal((await api.listWishlist(alex, {})).items.length, 0);
  assert.deepEqual((await api.listWishlist(alex, { status: 'purchased' })).items.map((w) => w.id), [wish.id]);
  assert.deepEqual((await api.listWishlist(alex, { status: 'all' })).items.map((w) => w.id), [wish.id]);
});

test('markPurchased warns about duplicates and records a different version when chosen', async () => {
  const { api, alex } = await setup();
  const wish = await api.createWishlist(alex, { category: 'sneaker', productId: 'vela-court-low', variantId: 'vela-court-low--white-gum', reason: 'want_exact' });
  await rejectsWith(api.markPurchased(alex, { itemId: wish.id, details: {} }), 'duplicate');
  assert.equal((await api.getWishlistItem(alex, { itemId: wish.id })).status, 'active', 'nothing changes when the warning is shown');
  const sizeless = await api.markPurchased(alex, { itemId: wish.id, details: {}, allowDuplicate: true });
  assert.equal(sizeless.owned.details.size, null, 'the size is never assumed');

  const flexible = await api.createWishlist(alex, { category: 'sneaker', productId: 'kestrel-runner-2', reason: 'like_style', allowDuplicate: true });
  assert.equal(flexible.variantId, null);
  await rejectsWith(api.markPurchased(alex, { itemId: flexible.id, variantId: 'vela-court-low--black-white', details: {} }), 'invalid');
  const bought = await api.markPurchased(alex, { itemId: flexible.id, variantId: 'kestrel-runner-2--navy-white', details: { size: { value: '10', system: 'US-M' } } });
  assert.equal(bought.owned.variantId, 'kestrel-runner-2--navy-white');
  assert.equal(bought.owned.identity.resolution, 'user_confirmed');
  assert.equal(bought.owned.identity.variant, 'confirmed');
  assert.equal(bought.owned.identity.evidence[0].kind, 'user_selection');

  const pending = await api.createWishlist(alex, { category: 'watch', matchPending: true, reason: 'like_style' });
  assert.equal(pending.identity.resolution, 'unconfirmed');
  assert.equal(pending.subtitle, 'Matching in progress');
  await rejectsWith(api.markPurchased(alex, { itemId: pending.id, details: {} }), 'invalid');
});
