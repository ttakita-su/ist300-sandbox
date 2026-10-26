// Outfits: create, list, read, update and delete, the rules for names and items, ownership,
// the cascade when an item is deleted, and outfits in export, account deletion and demo reset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv, rejectsWith, ALEX, SAM, JORDAN, MORGAN } from '../helpers.mjs';

async function setup() {
  const env = await createTestEnv();
  const [alex, sam] = await Promise.all([env.as(ALEX), env.as(SAM)]);
  const owned = (await env.api.listOwned(alex, {})).items;
  const byVariant = (id) => owned.find((i) => i.variantId === id);
  return {
    ...env,
    alex,
    sam,
    watch: byVariant('arden-field--af38-sl-bk'),
    sneaker: byVariant('vela-court-low--white-gum'),
    jacket: byVariant('harbor-pine-deck-jacket--navy'),
    trousers: byVariant('fieldhouse-wool-trouser--grey'),
  };
}

let keys = 0;
const key = () => `test-${(keys += 1)}`;

/** Creates an outfit for `call` with fresh idempotency. */
function make(api, call, args) {
  return api.createOutfit(call, { idempotencyKey: key(), ...args });
}

// ---------- Create ----------

test('an outfit is saved with a cleaned name, its items in order and an audit row without free text', async () => {
  const { api, db, alex, jacket, trousers, sneaker } = await setup();
  const outfit = await make(api, alex, { name: '  Weekend​   errands ', itemIds: [jacket.id, trousers.id, sneaker.id, jacket.id], notes: '  Rain is fine.  ' });
  assert.match(outfit.id, /^fit_/);
  assert.equal(outfit.name, 'Weekend errands');
  assert.equal(outfit.notes, 'Rain is fine.');
  assert.deepEqual(outfit.itemIds, [jacket.id, trousers.id, sneaker.id], 'duplicates are dropped, order is kept');
  assert.equal(outfit.itemCount, 3);
  assert.equal(outfit.incomplete, false);
  assert.equal(outfit.items[0].brandName, 'Harbor & Pine', 'items come back as collection views');
  assert.ok(outfit.items[0].image, 'with a display image');

  const stored = await db.get('outfits', outfit.id);
  assert.equal(stored.userId, ALEX);
  assert.equal(stored.createdAt, '2026-10-14T12:00:00.000Z');
  const audit = (await db.all('audit')).find((a) => a.targetId === outfit.id);
  assert.equal(audit.action, 'outfit.created');
  assert.deepEqual(audit.meta, { items: 3 });
  assert.ok(!JSON.stringify(await db.all('events')).includes('Weekend'), 'metrics never carry the name');
});

test('an empty form is refused with a message for each field and saves nothing', async () => {
  const { api, db, alex } = await setup();
  const bad = await rejectsWith(make(api, alex, { name: '', itemIds: [] }), 'invalid');
  assert.deepEqual(bad.details.fields, { name: 'Enter a name for this outfit', itemIds: 'Choose at least two items' });
  // Spaces, zero-width, bidi and other characters that draw nothing are not a name on their own.
  for (const name of ['   ', '​​', '‮', '‍', '­', 'ㅤ', '⠀', '️͏', '᠎', '　', undefined, 42]) {
    const blank = await rejectsWith(make(api, alex, { name, itemIds: [] }), 'invalid');
    assert.equal(blank.details.fields.name, 'Enter a name for this outfit', `name ${JSON.stringify(name)}`);
  }
  assert.deepEqual(await db.all('outfits'), []);
});

test('names, notes and item counts outside the limits are refused', async () => {
  const { api, db, alex, jacket, trousers } = await setup();
  const two = [jacket.id, trousers.id];
  assert.equal((await rejectsWith(make(api, alex, { name: 'x'.repeat(61), itemIds: two }), 'invalid')).details.fields.name, 'Use 60 characters or fewer');
  assert.equal((await rejectsWith(make(api, alex, { name: 'Long notes', itemIds: two, notes: 'n'.repeat(501) }), 'invalid')).details.fields.notes, 'Use 500 characters or fewer');
  assert.equal((await rejectsWith(make(api, alex, { name: 'One piece', itemIds: [jacket.id, jacket.id] }), 'invalid')).details.fields.itemIds, 'Choose at least two items', 'the same item twice is one item');
  assert.equal((await rejectsWith(make(api, alex, { name: 'Not a list', itemIds: jacket.id }), 'invalid')).details.fields.itemIds, 'Choose items from your collection');
  assert.deepEqual(await db.all('outfits'), []);

  const exact = await make(api, alex, { name: 'x'.repeat(60), itemIds: two, notes: 'n'.repeat(500) });
  assert.equal(exact.name.length, 60, 'the limits themselves are allowed');
});

test('more than twelve items is refused', async () => {
  const { api, alex } = await setup();
  const ids = [];
  for (let i = 0; i < 13; i += 1) {
    ids.push((await api.createOwned(alex, { source: 'manual', category: 'clothing', custom: { brand: 'Studio Nine', name: `Tee ${i}` } })).id);
  }
  const bad = await rejectsWith(make(api, alex, { name: 'Everything', itemIds: ids }), 'invalid');
  assert.equal(bad.details.fields.itemIds, 'Choose up to 12 items');
  assert.equal((await make(api, alex, { name: 'Twelve', itemIds: ids.slice(0, 12) })).itemCount, 12);
});

test('a name already used, ignoring capitals and spacing, is refused', async () => {
  const { api, db, alex, sam, jacket, trousers, sneaker, watch } = await setup();
  await make(api, alex, { name: 'Weekend errands', itemIds: [jacket.id, trousers.id] });
  for (const name of ['weekend errands', '  WEEKEND   Errands ', 'Ｗｅｅｋｅｎｄ errands']) {
    const bad = await rejectsWith(make(api, alex, { name, itemIds: [sneaker.id, watch.id] }), 'invalid');
    assert.equal(bad.details.fields.name, 'You already have an outfit with this name', name);
  }
  assert.equal((await db.all('outfits')).length, 1);
  // Names only need to be unique per person.
  const samItems = (await api.listOwned(sam, {})).items;
  assert.equal((await make(api, sam, { name: 'Weekend errands', itemIds: [samItems[0].id, samItems[1].id] })).name, 'Weekend errands');
});

test('saving twice with the same key, even at the same moment, creates one outfit', async () => {
  const { api, db, alex, jacket, trousers } = await setup();
  const args = { name: 'Office', itemIds: [jacket.id, trousers.id], idempotencyKey: 'double-tap' };
  const [a, b] = await Promise.all([api.createOutfit(alex, args), api.createOutfit(alex, args)]);
  const c = await api.createOutfit(alex, args);
  assert.equal(a.id, b.id);
  assert.equal(a.id, c.id);
  assert.equal((await db.all('outfits')).length, 1);
});

test('a refused save does not use up its key', async () => {
  const { api, alex, jacket, trousers } = await setup();
  await rejectsWith(api.createOutfit(alex, { name: '', itemIds: [jacket.id, trousers.id], idempotencyKey: 'retry' }), 'invalid');
  const fixed = await api.createOutfit(alex, { name: 'Fixed', itemIds: [jacket.id, trousers.id], idempotencyKey: 'retry' });
  assert.equal(fixed.name, 'Fixed');
});

test('someone else’s item and a deleted item get the same answer and nothing is saved', async () => {
  const { api, db, alex, sam, jacket, trousers } = await setup();
  const samItem = (await api.listOwned(sam, {})).items[0];
  const foreign = await rejectsWith(make(api, alex, { name: 'Borrowed', itemIds: [jacket.id, samItem.id] }), 'invalid');
  const gone = await rejectsWith(make(api, alex, { name: 'Borrowed', itemIds: [jacket.id, 'own_doesnotexist000'] }), 'invalid');
  assert.equal(foreign.details.fields.itemIds, gone.details.fields.itemIds);
  assert.equal(foreign.message, gone.message);
  assert.deepEqual(foreign.details.missingItemIds, [samItem.id], 'only the ids the caller sent come back');
  assert.ok(!JSON.stringify(foreign).includes(samItem.title), 'nothing about the other item leaks');
  assert.deepEqual(await db.all('outfits'), []);
  // Archived items are still the person's own and may be used.
  await api.archiveOwned(alex, { itemId: trousers.id });
  assert.equal((await make(api, alex, { name: 'With archived', itemIds: [jacket.id, trousers.id] })).itemCount, 2);
});

test('names keep the joiners emoji and Persian need, and invisible characters don’t make a new name', async () => {
  const { api, alex, jacket, trousers, sneaker, watch } = await setup();
  const family = await make(api, alex, { name: 'Family 👨‍👩‍👧 day', itemIds: [jacket.id, trousers.id] });
  assert.equal(family.name, 'Family 👨‍👩‍👧 day', 'the zero-width joiners in the emoji stay');
  const persian = await make(api, alex, { name: 'می‌خواهم', itemIds: [sneaker.id, watch.id] });
  assert.equal(persian.name, 'می‌خواهم', 'the zero-width non-joiner stays');
  await make(api, alex, { name: 'Weekend', itemIds: [jacket.id, sneaker.id] });
  for (const name of ['Week​end', 'Week­end', 'Weekend️', 'Weekend‍', '‌Weekend', 'Weekend⠀']) {
    const hidden = await rejectsWith(make(api, alex, { name, itemIds: [trousers.id, watch.id] }), 'invalid');
    assert.equal(hidden.details.fields.name, 'You already have an outfit with this name', JSON.stringify(name));
  }
  // Combining marks change the word in many scripts, so they still make a different name.
  await make(api, alex, { name: 'क', itemIds: [jacket.id, watch.id] });
  assert.equal((await make(api, alex, { name: 'कि', itemIds: [trousers.id, watch.id] })).name, 'कि');
});

test('stylists and admins cannot use any outfit operation; signed-out calls are refused', async () => {
  const { api, as, alex, jacket, trousers } = await setup();
  const outfit = await make(api, alex, { name: 'Office', itemIds: [jacket.id, trousers.id] });
  for (const call of [await as(JORDAN), await as(MORGAN)]) {
    await rejectsWith(api.listOutfits(call, {}), 'forbidden');
    await rejectsWith(api.getOutfit(call, { outfitId: outfit.id }), 'forbidden');
    await rejectsWith(api.createOutfit(call, { name: 'X', itemIds: [] }), 'forbidden');
    await rejectsWith(api.updateOutfit(call, { outfitId: outfit.id, patch: { name: 'X' } }), 'forbidden');
    await rejectsWith(api.deleteOutfit(call, { outfitId: outfit.id }), 'forbidden');
  }
  await rejectsWith(api.listOutfits({}, {}), 'unauthenticated');
  assert.equal((await api.getOutfit(alex, { outfitId: outfit.id })).name, 'Office');
});

test('a stylist sees shared items but nothing about the outfits they are in', async () => {
  const { api, as, alex, jacket, trousers } = await setup();
  const outfit = await make(api, alex, { name: 'Interview look', itemIds: [jacket.id, trousers.id], notes: 'Iron the jacket' });
  const request = await api.createStylistRequest(alex, { stylistId: JORDAN, itemIds: [jacket.id], message: 'What goes with this?', idempotencyKey: 'share' });
  const jordan = await as(JORDAN);
  const text = JSON.stringify([await api.listStylistRequests(jordan, {}), await api.getStylistRequest(jordan, { requestId: request.id })]);
  for (const secret of [outfit.id, 'Interview look', 'Iron the jacket']) assert.ok(!text.includes(secret), `no ${secret}`);
});

test('outfit names and notes never reach the audit log or metrics', async () => {
  const { api, db, alex, jacket, trousers, sneaker } = await setup();
  const outfit = await make(api, alex, { name: 'Zebra party', itemIds: [jacket.id, trousers.id], notes: 'Secret note' });
  await api.updateOutfit(alex, { outfitId: outfit.id, patch: { name: 'Zebra party two', itemIds: [jacket.id, sneaker.id], notes: 'Another secret' } });
  await api.deleteOutfit(alex, { outfitId: outfit.id });
  const text = JSON.stringify([await db.all('audit'), await db.all('events')]);
  for (const secret of ['Zebra', 'Secret note', 'Another secret']) assert.ok(!text.includes(secret), `no ${secret}`);
});

// ---------- Read ----------

test('the list is empty at first, then shows the person’s own outfits, most recently changed first', async () => {
  const { api, clock, alex, sam, jacket, trousers, sneaker, watch } = await setup();
  assert.deepEqual(await api.listOutfits(alex, {}), { outfits: [], total: 0 });
  const office = await make(api, alex, { name: 'Office', itemIds: [jacket.id, trousers.id] });
  clock.advance(60000);
  const weekend = await make(api, alex, { name: 'Weekend', itemIds: [sneaker.id, watch.id, jacket.id] });
  assert.deepEqual((await api.listOutfits(alex, {})).outfits.map((o) => o.name), ['Weekend', 'Office']);
  clock.advance(60000);
  await api.updateOutfit(alex, { outfitId: office.id, patch: { notes: 'Mondays' } });
  assert.deepEqual((await api.listOutfits(alex, {})).outfits.map((o) => o.name), ['Office', 'Weekend']);

  const withJacket = await api.listOutfits(alex, { itemId: jacket.id });
  assert.equal(withJacket.outfits.length, 2);
  assert.equal(withJacket.total, 2);
  assert.deepEqual((await api.listOutfits(alex, { itemId: sneaker.id })).outfits.map((o) => o.id), [weekend.id]);
  assert.deepEqual(await api.listOutfits(sam, {}), { outfits: [], total: 0 }, 'Sam sees none of them');
});

test('someone else’s outfit and a missing one are both not found', async () => {
  const { api, alex, sam, jacket, trousers } = await setup();
  const outfit = await make(api, alex, { name: 'Office', itemIds: [jacket.id, trousers.id] });
  assert.equal((await api.getOutfit(alex, { outfitId: outfit.id })).name, 'Office');
  const theirs = await rejectsWith(api.getOutfit(sam, { outfitId: outfit.id }), 'not_found');
  const missing = await rejectsWith(api.getOutfit(alex, { outfitId: 'fit_doesnotexist000' }), 'not_found');
  assert.equal(theirs.message, missing.message);
  for (const outfitId of [undefined, '', 42, { id: outfit.id }]) await rejectsWith(api.getOutfit(alex, { outfitId }), 'not_found');
  await rejectsWith(api.updateOutfit(sam, { outfitId: outfit.id, patch: { name: 'Mine now' } }), 'not_found');
  await rejectsWith(api.deleteOutfit(sam, { outfitId: outfit.id }), 'not_found');
  assert.equal((await api.getOutfit(alex, { outfitId: outfit.id })).name, 'Office', 'untouched');
});

// ---------- Update ----------

test('name, items and notes can each be changed, and every edit is kept', async () => {
  const { api, db, clock, alex, jacket, trousers, sneaker, watch } = await setup();
  const outfit = await make(api, alex, { name: 'Office', itemIds: [jacket.id, trousers.id] });
  clock.advance(1000);
  const renamed = await api.updateOutfit(alex, { outfitId: outfit.id, patch: { name: 'Office, winter' } });
  assert.equal(renamed.name, 'Office, winter');
  assert.deepEqual(renamed.itemIds, [jacket.id, trousers.id], 'items are untouched by a rename');
  clock.advance(1000);
  await api.updateOutfit(alex, { outfitId: outfit.id, patch: { itemIds: [jacket.id, trousers.id, sneaker.id, watch.id] } });
  clock.advance(1000);
  const last = await api.updateOutfit(alex, { outfitId: outfit.id, patch: { name: 'Office, rainy', itemIds: [trousers.id, sneaker.id], notes: 'Umbrella' } });

  const stored = await db.get('outfits', outfit.id);
  assert.equal(stored.name, 'Office, rainy');
  assert.deepEqual(stored.itemIds, [trousers.id, sneaker.id]);
  assert.equal(stored.notes, 'Umbrella');
  assert.equal(stored.createdAt, outfit.createdAt);
  assert.equal(stored.updatedAt, '2026-10-14T12:00:03.000Z');
  assert.equal(last.itemCount, 2);
  const actions = (await db.all('audit')).filter((a) => a.targetId === outfit.id).map((a) => [a.action, a.meta.fields ?? null]);
  assert.deepEqual(actions, [
    ['outfit.created', null],
    ['outfit.updated', ['name']],
    ['outfit.updated', ['itemIds']],
    ['outfit.updated', ['name', 'itemIds', 'notes']],
  ]);
});

test('an invalid edit is refused and leaves the stored outfit as it was', async () => {
  const { api, db, alex, jacket, trousers } = await setup();
  const outfit = await make(api, alex, { name: 'Office', itemIds: [jacket.id, trousers.id], notes: 'Mondays' });
  const before = await db.get('outfits', outfit.id);
  const bad = await rejectsWith(api.updateOutfit(alex, { outfitId: outfit.id, patch: { name: '  ', itemIds: [jacket.id], notes: 'Changed' } }), 'invalid');
  assert.deepEqual(bad.details.fields, { name: 'Enter a name for this outfit', itemIds: 'Choose at least two items' });
  assert.deepEqual(await db.get('outfits', outfit.id), before, 'notes were not saved either');
  await rejectsWith(api.updateOutfit(alex, { outfitId: outfit.id, patch: {} }), 'invalid');
  await rejectsWith(api.updateOutfit(alex, { outfitId: outfit.id, patch: { colour: 'blue' } }), 'invalid');
  await rejectsWith(api.updateOutfit(alex, { outfitId: outfit.id }), 'invalid');
  assert.deepEqual(await db.get('outfits', outfit.id), before);
});

test('an outfit may keep its own name or change its capitals, but not take another outfit’s name', async () => {
  const { api, clock, alex, jacket, trousers, sneaker, watch } = await setup();
  const office = await make(api, alex, { name: 'Office', itemIds: [jacket.id, trousers.id] });
  await make(api, alex, { name: 'Weekend', itemIds: [sneaker.id, watch.id] });
  const same = await api.updateOutfit(alex, { outfitId: office.id, patch: { name: 'Office', notes: 'New note' } });
  assert.equal(same.notes, 'New note');
  assert.equal((await api.updateOutfit(alex, { outfitId: office.id, patch: { name: 'OFFICE' } })).name, 'OFFICE');
  const clash = await rejectsWith(api.updateOutfit(alex, { outfitId: office.id, patch: { name: 'weekend' } }), 'invalid');
  assert.equal(clash.details.fields.name, 'You already have an outfit with this name');

  // Saving without a change keeps the record (and its place in the list) as it was.
  clock.advance(60000);
  const before = (await api.getOutfit(alex, { outfitId: office.id })).updatedAt;
  const unchanged = await api.updateOutfit(alex, { outfitId: office.id, patch: { name: 'OFFICE', itemIds: [jacket.id, trousers.id], notes: 'New note' } });
  assert.equal(unchanged.updatedAt, before);
});

test('an outfit down to one item can still be renamed and have its notes changed', async () => {
  const { api, alex, jacket, trousers } = await setup();
  const outfit = await make(api, alex, { name: 'Pair', itemIds: [jacket.id, trousers.id] });
  await api.deleteOwned(alex, { itemId: trousers.id });
  const renamed = await api.updateOutfit(alex, { outfitId: outfit.id, patch: { name: 'Single', notes: 'Find trousers' } });
  assert.equal(renamed.name, 'Single');
  assert.equal(renamed.incomplete, true);
  // Changing its items still needs two.
  await rejectsWith(api.updateOutfit(alex, { outfitId: outfit.id, patch: { itemIds: [jacket.id] } }), 'invalid');
});

test('ids that are not the person’s items never show in an outfit, even if a record holds them', async () => {
  const { api, db, alex, sam, jacket, trousers } = await setup();
  const outfit = await make(api, alex, { name: 'Office', itemIds: [jacket.id, trousers.id] });
  // A record left holding a deleted item's id (for example, a cleanup that didn't finish).
  await db.put('outfits', { ...(await db.get('outfits', outfit.id)), itemIds: [jacket.id, 'own_gone000000000000', trousers.id] });
  const view = await api.getOutfit(alex, { outfitId: outfit.id });
  assert.deepEqual(view.itemIds, [jacket.id, trousers.id]);
  assert.equal(view.incomplete, false);
  assert.equal((await api.updateOutfit(alex, { outfitId: outfit.id, patch: { itemIds: view.itemIds, name: 'Office 2' } })).name, 'Office 2', 'saving the shown items works');

  // Sam's outfit record holding Alex's item id: Sam's view leaves it out, so nothing private shows.
  const samItems = (await api.listOwned(sam, {})).items;
  const samOutfit = await make(api, sam, { name: 'Sam', itemIds: [samItems[0].id, samItems[1].id] });
  await db.put('outfits', { ...(await db.get('outfits', samOutfit.id)), itemIds: [samItems[0].id, jacket.id] });
  const samView = await api.getOutfit(sam, { outfitId: samOutfit.id });
  assert.deepEqual(samView.itemIds, [samItems[0].id]);
  assert.ok(!JSON.stringify(samView).includes(jacket.id));
});

test('an edit that lists a deleted item names it so the form can drop it', async () => {
  const { api, alex, jacket, trousers, sneaker } = await setup();
  const outfit = await make(api, alex, { name: 'Office', itemIds: [jacket.id, trousers.id] });
  await api.deleteOwned(alex, { itemId: sneaker.id });
  const bad = await rejectsWith(api.updateOutfit(alex, { outfitId: outfit.id, patch: { itemIds: [jacket.id, trousers.id, sneaker.id] } }), 'invalid');
  assert.deepEqual(bad.details.missingItemIds, [sneaker.id]);
});

// ---------- Delete ----------

test('deleting an outfit removes only the outfit; its items stay in the collection', async () => {
  const { api, db, alex, jacket, trousers } = await setup();
  const outfit = await make(api, alex, { name: 'Office', itemIds: [jacket.id, trousers.id] });
  assert.deepEqual(await api.deleteOutfit(alex, { outfitId: outfit.id }), { ok: true });
  assert.equal(await db.get('outfits', outfit.id), null);
  await rejectsWith(api.getOutfit(alex, { outfitId: outfit.id }), 'not_found');
  await rejectsWith(api.deleteOutfit(alex, { outfitId: outfit.id }), 'not_found');
  assert.equal((await api.listOwned(alex, {})).items.length, 4, 'all four items are still there');
  assert.deepEqual(await api.listOutfits(alex, {}), { outfits: [], total: 0 });
});

test('deleting an item takes it out of every outfit; an outfit left with one item is kept and flagged', async () => {
  const { api, db, alex, jacket, trousers, sneaker } = await setup();
  const pair = await make(api, alex, { name: 'Pair', itemIds: [jacket.id, trousers.id] });
  const trio = await make(api, alex, { name: 'Trio', itemIds: [jacket.id, trousers.id, sneaker.id] });
  const other = await make(api, alex, { name: 'Other', itemIds: [trousers.id, sneaker.id] });
  await api.deleteOwned(alex, { itemId: jacket.id });

  const pairNow = await api.getOutfit(alex, { outfitId: pair.id });
  assert.deepEqual(pairNow.itemIds, [trousers.id]);
  assert.equal(pairNow.incomplete, true);
  assert.deepEqual((await db.get('outfits', trio.id)).itemIds, [trousers.id, sneaker.id]);
  assert.equal((await api.getOutfit(alex, { outfitId: trio.id })).incomplete, false);
  assert.equal((await db.get('outfits', other.id)).updatedAt, other.updatedAt, 'outfits without the item are untouched');

  // An archived item stays in the outfit and says so.
  await api.archiveOwned(alex, { itemId: sneaker.id });
  const archived = (await api.getOutfit(alex, { outfitId: trio.id })).items.find((i) => i.id === sneaker.id);
  assert.ok(archived.archivedAt);
});

// ---------- Export, account deletion, demo reset ----------

test('export includes the person’s outfits and their activity, and nothing of anyone else’s', async () => {
  const { api, alex, sam, jacket, trousers } = await setup();
  const outfit = await make(api, alex, { name: 'Office', itemIds: [jacket.id, trousers.id] });
  const samItems = (await api.listOwned(sam, {})).items;
  const samOutfit = await make(api, sam, { name: 'Sam only', itemIds: [samItems[0].id, samItems[1].id] });
  const data = await api.exportMyData(alex, {});
  assert.deepEqual(data.outfits.map((o) => o.id), [outfit.id]);
  assert.equal(data.outfits[0].name, 'Office');
  assert.ok(data.activity.some((a) => a.action === 'outfit.created' && a.targetId === outfit.id), 'audit rows about outfits keep their target');
  const text = JSON.stringify(data);
  assert.ok(!text.includes(samOutfit.id) && !text.includes('Sam only'));
});

test('deleting an account removes its outfits; resetting a demo account clears them', async () => {
  const env = await createTestEnv();
  const { api, db } = env;
  const signed = await api.signUp({}, { email: 'casey@example.com', password: 'correct horse', displayName: 'Casey' });
  const casey = { token: signed.token };
  const tee = await api.createOwned(casey, { source: 'manual', category: 'clothing', custom: { brand: 'Studio Nine', name: 'Tee' } });
  const cap = await api.createOwned(casey, { source: 'manual', category: 'clothing', custom: { brand: 'Studio Nine', name: 'Cap' } });
  const outfit = await make(api, casey, { name: 'Casual', itemIds: [tee.id, cap.id] });
  await api.deleteMyAccount(casey, { confirm: 'DELETE' });
  assert.equal(await db.get('outfits', outfit.id), null);
  assert.ok(!(await db.all('audit')).some((a) => a.targetId === outfit.id), 'audit rows about the outfit go too');

  const alex = await env.as(ALEX);
  const items = (await api.listOwned(alex, {})).items;
  await make(api, alex, { name: 'Demo outfit', itemIds: [items[0].id, items[1].id] });
  // Deleting a demo account re-seeds every demo account, so Sam's outfits go too: their item ids
  // are replaced by the re-seed (seed.js USER_STORES).
  const sam = await env.as(SAM);
  const samItems = (await api.listOwned(sam, {})).items;
  await make(api, sam, { name: 'Sam demo outfit', itemIds: [samItems[0].id, samItems[1].id] });
  await api.deleteMyAccount(alex, { confirm: 'DELETE' });
  assert.deepEqual(await db.where('outfits', 'userId', ALEX), [], 'the reset demo starts without outfits');
  assert.deepEqual(await db.where('outfits', 'userId', SAM), [], 'no outfit is left pointing at replaced item ids');
});

test('admin views never show outfits', async () => {
  const { api, as, alex, jacket, trousers } = await setup();
  const outfit = await make(api, alex, { name: 'Secret combo', itemIds: [jacket.id, trousers.id] });
  const morgan = await as(MORGAN);
  const text = JSON.stringify([await api.adminOverview(morgan, {}), await api.adminListAccounts(morgan, {})]);
  assert.ok(!text.includes(outfit.id) && !text.includes('Secret combo'));
});
