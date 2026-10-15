// Access rules end to end: stylist sharing (grants, redaction, snapshots, revocation, ended
// assignments, unassigned stylists), the audit trail people see, data export, account deletion,
// accounts and catalog reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv, rejectsWith, fakeJpeg, ALEX, SAM, JORDAN, RILEY, MORGAN } from '../helpers.mjs';
import { issuedPhotoUrls } from '../../js/server/ops/photos.js';

async function setup() {
  const env = await createTestEnv();
  const [alex, sam, jordan, riley, morgan] = await Promise.all([ALEX, SAM, JORDAN, RILEY, MORGAN].map((id) => env.as(id)));
  const owned = (await env.api.listOwned(alex, {})).items;
  const byVariant = (id) => owned.find((i) => i.variantId === id);
  return {
    ...env,
    alex,
    sam,
    jordan,
    riley,
    morgan,
    watch: byVariant('arden-field--af38-sl-bk'),
    sneaker: byVariant('vela-court-low--white-gum'),
    trousers: byVariant('fieldhouse-wool-trouser--grey'),
  };
}

// Values from Alex's seeded items that are private: a serial number, a note, where it was bought.
const PRIVATE_VALUES = ['A38-118204', 'Daily pair.', 'Meridian Time', 'Northline Supply'];

// ---------- Stylist sharing ----------

test('a person shares chosen items with their assigned stylist, who sees redacted copies only', async () => {
  const { api, db, alex, jordan, watch, sneaker, trousers } = await setup();
  const stylists = await api.listMyStylists(alex, {});
  assert.deepEqual(stylists.map((s) => s.id), [JORDAN]);

  const request = await api.createStylistRequest(alex, { stylistId: JORDAN, itemIds: [watch.id, sneaker.id], message: 'What strap would suit this?', budgetMinor: 8000, category: 'watch', idempotencyKey: 'r1' });
  assert.equal(request.status, 'open');
  assert.equal(request.access, 'live');
  assert.equal(request.itemCount, 2);
  assert.equal(request.stylist.displayName, 'Jordan Blake');

  const list = await api.listStylistRequests(jordan, {});
  assert.equal(list.length, 1);
  assert.equal(list[0].client.displayName, 'Alex Rivera');
  assert.equal(list[0].itemCount, 2);

  const seen = await api.getStylistRequest(jordan, { requestId: request.id });
  assert.deepEqual(seen.items.map((i) => i.id).sort(), [watch.id, sneaker.id].sort());
  assert.ok(!seen.items.some((i) => i.id === trousers.id), 'unshared items stay private');
  const text = JSON.stringify(seen);
  for (const secret of PRIVATE_VALUES) assert.ok(!text.includes(secret), `the stylist never sees ${secret}`);
  for (const item of seen.items) {
    assert.equal(item.details.purchase, undefined, 'prices paid are never shared');
    assert.equal(item.details.serialNumber, undefined, 'serial numbers are never shared');
    assert.equal(item.identity.evidence, undefined, 'evidence stays private');
    assert.equal(item.photos, undefined, 'photo ids never leave the server');
    assert.equal(item.details.notes, null, 'notes are hidden unless shared');
    assert.ok(['catalog', 'placeholder'].includes(item.image.kind), 'no photo without includePhotos');
    assert.deepEqual(item.shared, { photos: false, notes: false });
    assert.ok(item.identity.resolution);
  }
  assert.equal(seen.items.find((i) => i.id === watch.id).identity.resolution, 'identifier_supported');
  const audit = await db.where('audit', 'targetId', request.id);
  assert.ok(audit.some((a) => a.action === 'stylist_request.viewed' && a.actorId === JORDAN), 'each stylist view is audited');

  // The stylist can't reach the person's collection in any other way.
  await rejectsWith(api.listOwned(jordan, {}), 'forbidden');
  await rejectsWith(api.getOwned(jordan, { itemId: watch.id }), 'forbidden');
});

test('requests only go to assigned stylists and only carry the person’s own items', async () => {
  const { api, alex, sam, riley, watch } = await setup();
  await rejectsWith(api.createStylistRequest(alex, { stylistId: RILEY, itemIds: [watch.id], message: 'Hi' }), 'not_found');
  await rejectsWith(api.createStylistRequest(sam, { stylistId: JORDAN, itemIds: [], message: 'Hi' }), 'not_found');
  const samItem = (await api.listOwned(sam, {})).items[0];
  await rejectsWith(api.createStylistRequest(alex, { stylistId: JORDAN, itemIds: [samItem.id], message: 'Hi' }), 'not_found');
  await rejectsWith(api.createStylistRequest(alex, { stylistId: JORDAN, itemIds: [], message: '' }), 'invalid');

  // An unassigned stylist sees nothing, even with a real request id.
  const request = await api.createStylistRequest(alex, { stylistId: JORDAN, itemIds: [watch.id], message: 'Hi' });
  assert.deepEqual(await api.listStylistRequests(riley, {}), []);
  await rejectsWith(api.getStylistRequest(riley, { requestId: request.id }), 'not_found');
  await rejectsWith(api.submitStylistRecs(riley, { requestId: request.id, items: [{ productId: 'arden-field' }], message: 'Try this' }), 'not_found');
  await rejectsWith(api.getStylistRequest(sam, { requestId: request.id }), 'not_found');
  await rejectsWith(api.revokeStylistRequest(sam, { requestId: request.id }), 'not_found');
});

test('shared notes and photos are visible only when chosen, and revoking ends access at once', async () => {
  const { api, providers, alex, jordan, watch } = await setup();
  const upload = await api.uploadPhoto(alex, { blob: fakeJpeg(), kind: 'original' });
  await api.updateOwned(alex, { itemId: watch.id, patch: { photos: { originalId: upload.photoId }, display: 'original', details: { notes: 'Bracelet sized to my wrist.' } } });

  const request = await api.createStylistRequest(alex, { stylistId: JORDAN, itemIds: [watch.id], includePhotos: true, includeNotes: true, message: 'Thoughts?' });
  const seen = await api.getStylistRequest(jordan, { requestId: request.id });
  const item = seen.items[0];
  assert.equal(item.details.notes, 'Bracelet sized to my wrist.');
  assert.equal(item.image.kind, 'original');
  assert.equal(item.image.photoId, upload.photoId);
  const url = await api.getPhotoUrl(jordan, { photoId: upload.photoId });
  assert.ok(issuedPhotoUrls(providers.urls).some((u) => u.url === url.url && u.actorId === JORDAN));

  const revoked = await api.revokeStylistRequest(alex, { requestId: request.id });
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.access, 'revoked');
  assert.ok(!issuedPhotoUrls(providers.urls).some((u) => u.actorId === JORDAN), 'photo URLs already handed out are withdrawn');
  await rejectsWith(api.getStylistRequest(jordan, { requestId: request.id }), 'not_found');
  await rejectsWith(api.getPhotoUrl(jordan, { photoId: upload.photoId }), 'not_found');
  await rejectsWith(api.submitStylistRecs(jordan, { requestId: request.id, items: [{ productId: 'arden-field' }] }), 'not_found');
  assert.deepEqual(await api.listStylistRequests(jordan, {}), []);
});

test('a snapshot share keeps what was shared at the time', async () => {
  const { api, alex, jordan, sneaker } = await setup();
  const live = await api.createStylistRequest(alex, { stylistId: JORDAN, itemIds: [sneaker.id], includeNotes: true, message: 'Live' });
  const snap = await api.createStylistRequest(alex, { stylistId: JORDAN, itemIds: [sneaker.id], includeNotes: true, snapshot: true, message: 'Snapshot' });
  assert.equal(snap.snapshotTaken, true);
  await api.updateOwned(alex, { itemId: sneaker.id, patch: { details: { notes: 'Resoled in October.' } } });
  assert.equal((await api.getStylistRequest(jordan, { requestId: live.id })).items[0].details.notes, 'Resoled in October.');
  assert.equal((await api.getStylistRequest(jordan, { requestId: snap.id })).items[0].details.notes, 'Daily pair.');

  // Deleting the item removes it from both shares, snapshot included.
  await api.deleteOwned(alex, { itemId: sneaker.id });
  assert.deepEqual((await api.getStylistRequest(jordan, { requestId: snap.id })).items, []);
  assert.deepEqual((await api.getStylistRequest(jordan, { requestId: live.id })).items, []);
});

test('stylist suggestions are labeled human, and ending the assignment ends access', async () => {
  const { api, alex, jordan, morgan, watch } = await setup();
  const request = await api.createStylistRequest(alex, { stylistId: JORDAN, itemIds: [watch.id], message: 'Something for weekends?' });
  await api.getStylistRequest(jordan, { requestId: request.id });
  await rejectsWith(api.submitStylistRecs(jordan, { requestId: request.id, items: [{ productId: 'not-a-product' }] }), 'invalid');
  await rejectsWith(api.submitStylistRecs(jordan, { requestId: request.id, items: [{ productId: 'arden-field', variantId: 'kestrel-runner-2--olive-bone' }] }), 'invalid');
  const rec = await api.submitStylistRecs(jordan, {
    requestId: request.id,
    items: [{ productId: 'harbor-pine-deck-jacket', variantId: 'harbor-pine-deck-jacket--olive', note: 'Olive works with the steel watch.' }],
    message: 'One idea to start.',
    idempotencyKey: 'rec-1',
  });
  assert.equal(rec.source, 'human');
  assert.equal(rec.kind, 'stylist');
  assert.equal(rec.label, 'From your stylist');
  assert.equal(rec.items[0].variant.id, 'harbor-pine-deck-jacket--olive');

  const mine = await api.listStylistRecs(alex, {});
  assert.equal(mine.length, 1);
  assert.equal(mine[0].stylist.displayName, 'Jordan Blake');
  assert.equal((await api.getStylistRequest(alex, { requestId: request.id })).request.status, 'answered');

  const { assignments } = await api.adminListAccounts(morgan, {});
  const live = assignments.find((a) => a.stylistId === JORDAN && a.userId === ALEX && a.active);
  const ended = await api.adminEndAssignment(morgan, { assignmentId: live.id });
  assert.equal(ended.active, false);
  await rejectsWith(api.getStylistRequest(jordan, { requestId: request.id }), 'not_found');
  assert.deepEqual(await api.listStylistRequests(jordan, {}), []);
  const own = (await api.listStylistRequests(alex, {})).find((r) => r.id === request.id);
  assert.equal(own.access, 'ended');
  assert.deepEqual(await api.listMyStylists(alex, {}), []);

  // Assigning again later does not reopen the old share.
  await api.adminAssignStylist(morgan, { stylistId: JORDAN, userId: ALEX });
  await rejectsWith(api.getStylistRequest(jordan, { requestId: request.id }), 'not_found');
  assert.equal(mine[0].items[0].note, 'Olive works with the steel watch.', 'suggestions already sent stay with the person');

  // The person's audit log tells the story in plain sentences.
  const log = await api.getAuditLog(alex, {});
  const summaries = log.map((e) => e.summary);
  assert.ok(summaries.includes('You shared 1 item with Jordan Blake'));
  assert.ok(summaries.includes('Jordan Blake opened your request'));
  assert.ok(summaries.includes('Jordan Blake sent 1 suggestion'));
  assert.ok(summaries.some((s) => /access to this request ended with their assignment/.test(s)));
});

// ---------- Export and deletion ----------

test('export holds everything about the person and nothing about anyone else', async () => {
  const { api, alex, sam } = await setup();
  const upload = await api.uploadPhoto(alex, { blob: fakeJpeg(64), kind: 'original' });
  const data = await api.exportMyData(alex, {});
  assert.equal(data.format, 'rotation-data-export');
  assert.equal(data.account.id, ALEX);
  assert.equal(data.account.passwordHash, undefined);
  assert.equal(data.owned.length, 4);
  assert.equal(data.wishlist.length, 1);
  const photo = data.photos.find((p) => p.id === upload.photoId);
  assert.match(photo.dataUrl, /^data:image\/jpeg;base64,\/9j\//, 'photos are included as data URLs');
  assert.ok(data.sessions.every((s) => !('token' in s)), 'session tokens are never exported');
  assert.ok(data.owned.some((i) => i.details.serialNumber === 'A38-118204'), 'the person gets their own private details back');

  const samIds = (await api.listOwned(sam, {})).items.map((i) => i.id);
  const text = JSON.stringify(data);
  for (const id of [SAM, ...samIds]) assert.ok(!text.includes(id), `no trace of ${id}`);
});

test('deleting an account removes every private record and signs out everywhere', async () => {
  const env = await createTestEnv();
  const { api, db } = env;
  const signed = await api.signUp({}, { email: 'casey@example.com', password: 'correct horse', displayName: 'Casey' });
  const casey = { token: signed.token };
  const second = await api.signIn({}, { email: 'casey@example.com', password: 'correct horse' });
  const upload = await api.uploadPhoto(casey, { blob: fakeJpeg(), kind: 'original' });
  const item = await api.createOwned(casey, { category: 'sneaker', productId: 'vela-court-low', variantId: 'vela-court-low--black-white', photos: { originalId: upload.photoId } });
  await api.createWishlist(casey, { category: 'watch', productId: 'arden-field', variantId: 'arden-field--af40-sl-bk', reason: 'want_exact', desired: { condition: 'new_or_used' } });
  await api.createClick(casey, { offerId: 'offer-nl-48213' });
  const analyticsId = (await db.get('users', signed.session.id)).analyticsId;

  await rejectsWith(api.deleteMyAccount(casey, { confirm: 'delete' }), 'invalid');
  const result = await api.deleteMyAccount(casey, { confirm: 'DELETE' });
  assert.equal(result.ok, true);
  assert.equal(result.reset, false);
  assert.equal(await db.get('users', signed.session.id), null);
  assert.equal(await db.get('profiles', signed.session.id), null);
  assert.equal(await db.get('ownedItems', item.id), null);
  assert.equal(await db.get('photos', upload.photoId), null);
  assert.equal(await db.get('photos', upload.processingId), null);
  assert.deepEqual(await db.where('wishlistItems', 'userId', signed.session.id), []);
  assert.deepEqual(await db.where('clicks', 'analyticsId', analyticsId), []);
  assert.deepEqual(await db.where('sessions', 'userId', signed.session.id), []);
  await rejectsWith(api.me(casey, {}), 'unauthenticated');
  await rejectsWith(api.me({ token: second.token }, {}), 'unauthenticated');
  await rejectsWith(api.signIn({}, { email: 'casey@example.com', password: 'correct horse' }), 'invalid');
  // Demo accounts are untouched.
  assert.equal((await db.where('ownedItems', 'userId', ALEX)).length, 4);
});

test('deleting a demo account resets the demo instead', async () => {
  const { api, db, alex, sneaker } = await setup();
  await api.deleteOwned(alex, { itemId: sneaker.id });
  assert.equal((await db.where('ownedItems', 'userId', ALEX)).length, 3);
  const result = await api.deleteMyAccount(alex, { confirm: 'DELETE' });
  assert.equal(result.reset, true);
  await rejectsWith(api.me(alex, {}), 'unauthenticated');
  const fresh = await api.signInDemo({}, { userId: ALEX });
  const items = (await api.listOwned({ token: fresh.token }, {})).items;
  assert.equal(items.length, 4);
  assert.ok(items.some((i) => i.variantId === 'vela-court-low--white-gum'));
});

// ---------- Accounts and catalog ----------

test('accounts: sign-up makes a user with a default profile, and sign-in checks the password', async () => {
  const { api } = await createTestEnv();
  const demo = await api.listDemoAccounts({}, {});
  assert.deepEqual(demo.map((a) => a.role), ['user', 'user', 'stylist', 'stylist', 'admin']);
  await rejectsWith(api.signUp({}, { email: 'not-an-email', password: 'short', displayName: '' }), 'invalid');
  const signed = await api.signUp({}, { email: ' Drew@Example.com ', password: 'long enough', displayName: 'Drew', role: 'admin' });
  assert.equal(signed.session.role, 'user', 'sign-up can never pick a role');
  assert.equal(signed.session.email, 'drew@example.com');
  const profile = await api.getProfile({ token: signed.token }, {});
  assert.equal(profile.onboardedAt, null);
  assert.deepEqual(profile.categories, ['sneaker', 'watch', 'clothing']);
  await rejectsWith(api.signUp({}, { email: 'drew@example.com', password: 'another one', displayName: 'Drew 2' }), 'invalid');
  await rejectsWith(api.signIn({}, { email: 'drew@example.com', password: 'wrong password' }), 'invalid');
  await rejectsWith(api.signIn({}, { email: 'alex@demo.rotation.example', password: '' }), 'invalid');
  const again = await api.signIn({}, { email: 'DREW@example.com', password: 'long enough' });
  assert.equal((await api.me({ token: again.token }, {})).id, signed.session.id);
  await api.signOut({ token: again.token }, {});
  await rejectsWith(api.me({ token: again.token }, {}), 'unauthenticated');
  await rejectsWith(api.signInDemo({}, { userId: signed.session.id }), 'not_found');
});

test('catalog reads: a typed code finds its version, and unknown ids are not found', async () => {
  const { api, alex } = await setup();
  const byCode = await api.searchCatalog(alex, { q: 'KR2-304' });
  assert.equal(byCode[0].product.id, 'kestrel-runner-2');
  assert.deepEqual(byCode[0].matchedVariantIds, ['kestrel-runner-2--olive-bone']);
  const watches = await api.searchCatalog(alex, { category: 'watch' });
  assert.ok(watches.length > 0 && watches.every((r) => r.product.category === 'watch'));
  assert.ok(watches[0].variants.every((v) => v.image.url), 'search results carry catalog images');
  assert.deepEqual(await api.searchCatalog(alex, { q: 'no such thing anywhere' }), []);

  const product = await api.getProduct(alex, { productId: 'arden-field' });
  assert.equal(product.product.attributes.attachment, 'spring_bar');
  assert.equal(product.variants.length, 3);
  const variant = await api.getVariant(alex, { variantId: 'arden-field--af40-sl-bk' });
  assert.equal(variant.variant.code, 'AF40-SL-BK');
  await rejectsWith(api.getProduct(alex, { productId: 'nope' }), 'not_found');
  await rejectsWith(api.getVariant(alex, { variantId: 'nope' }), 'not_found');
  const brands = await api.listBrands(alex, { category: 'watch' });
  assert.deepEqual(brands.map((b) => b.id), ['arden', 'linwick', 'ostrel'], 'watch brands, sorted by name');
  assert.ok(brands.every((b) => b.categories.includes('watch')));
  await rejectsWith(api.searchCatalog({}, { q: 'vela' }), 'unauthenticated');
});
