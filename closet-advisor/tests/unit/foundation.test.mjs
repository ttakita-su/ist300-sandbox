import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, safeUrl } from '../../js/lib/html.js';
import { createMemoryDb } from '../../js/server/db.js';
import { redactForStylist, stylistCanReadRequest } from '../../js/server/policy.js';
import { ownedView } from '../../js/server/views.js';
import { searchProducts } from '../../js/server/ops/catalog.js';
import { staticCatalog } from '../../js/server/catalog-repo.js';
import { validateAttributes } from '../../js/data/schema.js';
import { createTestEnv, rejectsWith, ALEX, SAM, JORDAN, RILEY, NOW } from '../helpers.mjs';

test('html escapes interpolated values and keeps nested templates', () => {
  const name = '<img src=x onerror=alert(1)>';
  const out = html`<p title="${'"quoted"'}">${name}${html`<b>${'&'}</b>`}${[1, 2]}${null}${false}</p>`.toString();
  assert.equal(out, '<p title="&quot;quoted&quot;">&lt;img src=x onerror=alert(1)&gt;<b>&amp;</b>12</p>');
  assert.equal(html`${raw('<i>ok</i>')}`.toString(), '<i>ok</i>');
});

test('safeUrl blocks script and non-image data URLs', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl(' JaVaScRiPt:alert(1)'), '#');
  assert.equal(safeUrl('java\nscript:alert(1)'), '#');
  assert.equal(safeUrl('data:text/html,<script>'), '#');
  assert.equal(safeUrl('data:image/svg+xml;charset=utf-8,%3Csvg'), 'data:image/svg+xml;charset=utf-8,%3Csvg');
  assert.equal(safeUrl('https://northline.example/p/1'), 'https://northline.example/p/1');
  assert.equal(safeUrl('#/collection/own_1'), '#/collection/own_1');
});

test('memory db clones records in and out', async () => {
  const db = createMemoryDb();
  const record = { id: 'a', userId: 'u', nested: { n: 1 } };
  await db.put('ownedItems', record);
  record.nested.n = 2;
  const read = await db.get('ownedItems', 'a');
  assert.equal(read.nested.n, 1);
  read.nested.n = 3;
  assert.equal((await db.get('ownedItems', 'a')).nested.n, 1);
  assert.deepEqual((await db.where('ownedItems', 'userId', 'u')).map((r) => r.id), ['a']);
  assert.equal(await db.get('ownedItems', 'missing'), null);
});

test('catalog attributes validate against category rules', () => {
  const catalog = staticCatalog();
  for (const product of catalog.listProducts()) {
    assert.deepEqual(validateAttributes(product.category, 'product', product.attributes), [], product.id);
    for (const variant of catalog.variantsOf(product.id)) {
      assert.deepEqual(validateAttributes(product.category, 'variant', variant.attributes), [], variant.id);
    }
  }
  assert.ok(validateAttributes('watch', 'variant', { secretField: 1 }).length > 0, 'unknown fields are rejected');
});

test('operations enforce sign-in and roles', async () => {
  const { api, as } = await createTestEnv();
  await rejectsWith(api.getProfile({}, {}), 'unauthenticated');
  await rejectsWith(api.getProfile({ token: 'not-a-token' }, {}), 'unauthenticated');
  const jordan = await as(JORDAN);
  await rejectsWith(api.getProfile(jordan, {}), 'forbidden');
  const alex = await as(ALEX);
  const profile = await api.getProfile(alex, {});
  assert.equal(profile.userId, ALEX);
  assert.equal(profile.sizes.shoe.value, '10');
});

test('sign up, sign in, wrong password and duplicate email', async () => {
  const { api } = await createTestEnv();
  const created = await api.signUp({}, { email: 'Pat@Example.com', password: 'correct horse', displayName: 'Pat' });
  assert.equal(created.session.role, 'user');
  assert.equal((await api.me({ token: created.token }, {})).email, 'pat@example.com');
  await rejectsWith(api.signUp({}, { email: 'pat@example.com', password: 'another one', displayName: 'Pat 2' }), 'invalid');
  await rejectsWith(api.signIn({}, { email: 'pat@example.com', password: 'wrong password' }), 'invalid');
  const again = await api.signIn({}, { email: 'pat@example.com', password: 'correct horse' });
  assert.ok(again.token);
  await api.signOut({ token: again.token }, {});
  await rejectsWith(api.me({ token: again.token }, {}), 'unauthenticated');
  // Demo accounts have no password and can't be signed into with one.
  await rejectsWith(api.signIn({}, { email: 'alex@demo.rotation.example', password: 'anything at all' }), 'invalid');
});

test('sessions expire', async () => {
  const { api, as, clock } = await createTestEnv();
  const alex = await as(ALEX);
  clock.advance(31 * 86400000);
  await rejectsWith(api.me(alex, {}), 'unauthenticated');
});

test('profile validation rejects contradictory colors and bad sizes', async () => {
  const { api, as } = await createTestEnv();
  const alex = await as(ALEX);
  await rejectsWith(api.updateProfile(alex, { colorsLiked: ['olive'], colorsAvoided: ['olive'] }), 'invalid');
  await rejectsWith(api.updateProfile(alex, { sizes: { bottom: { value: '32', system: 'WAIST-INSEAM' } } }), 'invalid');
  const next = await api.updateProfile(alex, { budgets: { sneaker: 12000 }, styles: ['street'] });
  assert.equal(next.budgets.sneaker, 12000);
  assert.deepEqual(next.styles, ['street']);
});

test('catalog search finds style codes, references and colors', () => {
  const catalog = staticCatalog();
  const byCode = searchProducts(catalog, { q: 'KR2-304' });
  assert.equal(byCode[0].product.id, 'kestrel-runner-2');
  assert.deepEqual(byCode[0].matchedVariantIds, ['kestrel-runner-2--olive-bone']);
  const byRef = searchProducts(catalog, { q: 'af40-sl-bk' });
  assert.equal(byRef[0].product.id, 'arden-field');
  const olive = searchProducts(catalog, { q: 'olive' }).map((r) => r.product.id);
  assert.ok(olive.includes('kestrel-runner-2') && olive.includes('harbor-pine-deck-jacket'));
  assert.deepEqual(searchProducts(catalog, { q: 'olive', category: 'watch' }).map((r) => r.product.id), ['linwick-field-strap'], 'only the olive strap among watch products');
  assert.equal(searchProducts(catalog, { q: 'gum', category: 'watch' }).length, 0);
});

test('demo seed creates the brief scenario and an assignment', async () => {
  const { db } = await createTestEnv();
  const alexItems = await db.where('ownedItems', 'userId', ALEX);
  assert.deepEqual(
    alexItems.map((i) => i.variantId).sort(),
    ['arden-field--af38-sl-bk', 'fieldhouse-wool-trouser--grey', 'harbor-pine-deck-jacket--navy', 'vela-court-low--white-gum'],
  );
  const wish = await db.where('wishlistItems', 'userId', ALEX);
  assert.equal(wish[0].variantId, 'kestrel-runner-2--olive-bone');
  const assignments = await db.all('stylistAssignments');
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].stylistId, JORDAN);
  assert.equal(assignments[0].userId, ALEX);
  assert.equal((await db.where('stylistAssignments', 'stylistId', RILEY)).length, 0);
});

test('display image falls back when source terms forbid inventory display', async () => {
  const { db } = await createTestEnv();
  const catalog = staticCatalog();
  const [samTrousers] = (await db.where('ownedItems', 'userId', SAM)).filter((i) => i.variantId === 'fieldhouse-wool-trouser--charcoal');
  const view = ownedView(catalog, samTrousers, { now: NOW });
  assert.equal(view.image.kind, 'placeholder');
  assert.match(view.image.fallbackReason, /live offer/);
  const withPhoto = ownedView(catalog, { ...samTrousers, photos: { originalId: 'pho_1', cleanedId: null, labelIds: [] } }, { now: NOW });
  assert.equal(withPhoto.image.kind, 'original');
  assert.equal(withPhoto.image.label, 'Your photo');
  assert.ok(withPhoto.image.fallbackReason);

  const [alexTrousers] = (await db.where('ownedItems', 'userId', ALEX)).filter((i) => i.variantId === 'fieldhouse-wool-trouser--grey');
  const alexView = ownedView(catalog, alexTrousers, { now: NOW });
  assert.equal(alexView.image.kind, 'catalog');
  assert.equal(alexView.image.label, 'Catalog image');
  assert.match(alexView.image.url, /^data:image\/svg\+xml/);
});

test('stylist redaction is an allowlist and access needs a live assignment', () => {
  const view = {
    id: 'own_1',
    userId: ALEX,
    category: 'watch',
    title: 'Field',
    brandName: 'Arden',
    details: { size: null, condition: 'good', purchase: { priceMinor: 45000 }, notes: 'secret', serialNumber: 'A38-1' },
    identity: { resolution: 'user_confirmed', variant: 'confirmed', evidence: [{ detail: 'x' }] },
    image: { kind: 'original', photoId: 'pho_1', label: 'Your photo' },
    photos: { originalId: 'pho_1' },
  };
  const redacted = redactForStylist(view, { includePhotos: false, includeNotes: false });
  assert.equal(redacted.details.purchase, undefined);
  assert.equal(redacted.details.serialNumber, undefined);
  assert.equal(redacted.details.notes, null);
  assert.equal(redacted.photos, undefined);
  assert.equal(redacted.image.kind, 'placeholder');
  assert.equal(redacted.identity.evidence, undefined);
  assert.equal(redactForStylist(view, { includePhotos: true, includeNotes: true }).details.notes, 'secret');

  const request = { id: 'req', userId: ALEX, stylistId: JORDAN, status: 'open', revokedAt: null };
  const jordan = { id: JORDAN, role: 'stylist' };
  const live = [{ stylistId: JORDAN, userId: ALEX, endedAt: null }];
  assert.equal(stylistCanReadRequest(jordan, request, live), true);
  assert.equal(stylistCanReadRequest(jordan, { ...request, status: 'revoked', revokedAt: 'x' }, live), false);
  assert.equal(stylistCanReadRequest(jordan, request, [{ ...live[0], endedAt: 'x' }]), false);
  assert.equal(stylistCanReadRequest({ id: RILEY, role: 'stylist' }, request, live), false);
});
