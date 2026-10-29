// Suggested outfits (js/engine/outfit-suggest.js): combinations of the person's own items, with
// grounded reasons and no catalog fill-ins. Test IDs E1-E12 are listed in ARCHITECTURE.md §8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticCatalog } from '../../js/server/catalog-repo.js';
import { suggestOutfits, OUTFIT_PARTS, SUGGEST_RULES } from '../../js/engine/outfit-suggest.js';
import { outfitPart } from '../../js/engine/recommend.js';

const catalog = staticCatalog();
let clock = 0;
const at = () => new Date(Date.UTC(2026, 0, 1) + (clock += 1) * 60000).toISOString();

/** An owned catalog item: the version's colors and the product's style tags come from the catalog. */
function cat(id, variantId, extra = {}) {
  const variant = catalog.variant(variantId);
  const product = catalog.product(variant.productId);
  return { id, userId: 'u', category: product.category, productId: product.id, variantId, custom: null, createdAt: at(), archivedAt: null, ...extra };
}

/** An owned custom item: only what the person typed. */
function custom(id, category, type, colors, extra = {}) {
  return { id, userId: 'u', category, productId: null, variantId: null, custom: { brand: 'Studio Nine', name: id, variantName: null, type, colors }, createdAt: at(), archivedAt: null, ...extra };
}

const alexCloset = () => [
  cat('s', 'vela-court-low--white-gum'),
  cat('j', 'harbor-pine-deck-jacket--navy'),
  cat('t', 'fieldhouse-wool-trouser--grey'),
  cat('w', 'arden-field--af38-sl-bk'),
];

const ALEX_REASONS = [
  'Navy and grey are a classic pairing, so your Harbor & Pine Deck Field Jacket and Fieldhouse Wool Trouser go well together.',
  'White and black are a classic pairing, so your Vela Court Low and Arden Field go well together.',
  'Every piece shares a classic style.',
];

const parts = (s) => s.itemIds.map((id) => {
  const record = closetById.get(id);
  const product = record.productId ? catalog.product(record.productId) : null;
  return outfitPart(record.category, product?.type ?? record.custom?.type);
});
let closetById = new Map();
const run = (owned, opts = {}) => {
  closetById = new Map(owned.map((r) => [r.id, r]));
  return suggestOutfits({ catalog, owned, ...opts });
};

test('E1: Alex\'s demo closet gives one outfit with the jacket standing in for a top', () => {
  const out = run(alexCloset());
  assert.equal(out.suggestions.length, 1);
  const [s] = out.suggestions;
  assert.equal(s.key, 'j+s+t');
  assert.deepEqual(s.itemIds, ['j', 't', 's', 'w']);
  assert.equal(s.name, 'Navy field jacket and grey trousers');
  assert.deepEqual(s.reasons, ALEX_REASONS);
  assert.equal(typeof s.score, 'number');
  assert.deepEqual([out.missing, out.emptyReason, out.leftOut], [[], null, { noType: 0, noColors: 0 }]);
  for (const reason of s.reasons) assert.doesNotMatch(reason, /\d|%|\boutfits?\b|\bwor[en]\b/i, 'no numbers, counts or wear claims');
});

test('E2: a closet missing a part says which part', () => {
  const sam = [cat('w', 'arden-field--af38-sl-cr'), cat('s', 'vela-court-low--black-white'), cat('t', 'fieldhouse-wool-trouser--charcoal')];
  assert.deepEqual(run(sam), { suggestions: [], missing: ['top'], emptyReason: 'missing', leftOut: { noType: 0, noColors: 0 } });
  assert.deepEqual(run([]).missing, ['top', 'bottom', 'feet']);
});

test('E3: a fuller closet gives distinct head-to-toe outfits, never a strap or an archived item', () => {
  const closet = [
    cat('ox-w', 'wrenfield-oxford--white'),
    cat('ox-b', 'wrenfield-oxford--light-blue'),
    cat('chore', 'wrenfield-chore-jacket--navy'),
    cat('tr-g', 'fieldhouse-wool-trouser--grey'),
    cat('tr-c', 'fieldhouse-wool-trouser--charcoal'),
    cat('cl-w', 'vela-court-low--white-gum'),
    cat('cl-b', 'vela-court-low--black-white'),
    cat('af', 'arden-field--af38-sl-bk'),
    cat('od', 'ostrel-dive-200--od40-bl-st'),
    cat('strap', 'linwick-field-strap--brown-20'),
    cat('old', 'kestrel-runner-2--olive-bone', { archivedAt: at() }),
  ];
  const out = run(closet, { limit: 12 });
  assert.equal(out.suggestions.length, 12);
  assert.equal(new Set(out.suggestions.map((s) => s.key)).size, 12);
  for (const s of out.suggestions) {
    assert.ok(['top,bottom,feet,wrist', 'top,outer,bottom,feet,wrist'].includes(parts(s).join()), `${s.key}: ${parts(s)}`);
    assert.ok(!s.itemIds.includes('strap') && !s.itemIds.includes('old'));
  }
  assert.equal(out.suggestions[0].name, 'White oxford shirt and grey trousers');
  assert.equal(out.suggestions[0].reasons[0], 'White and grey are a classic pairing, so your Wrenfield Oxford Shirt, White and Fieldhouse Wool Trouser, Mid grey go well together.');
});

test('E4: a jacket is a layer over a top, and stands in for one only when there is no top', () => {
  const closet = [cat('ox', 'wrenfield-oxford--white'), cat('ch', 'wrenfield-chore-jacket--navy'), cat('tr', 'fieldhouse-wool-trouser--grey'), cat('sn', 'vela-court-low--white-gum')];
  const out = run(closet);
  assert.deepEqual(out.suggestions.map((s) => s.itemIds), [['ox', 'ch', 'tr', 'sn'], ['ox', 'tr', 'sn']]);
  assert.equal(out.suggestions[0].name, 'Navy chore jacket and grey trousers');
  assert.deepEqual(out.suggestions[0].reasons, [
    'White and navy are a classic pairing, so your Wrenfield Oxford Shirt and Wrenfield Chore Jacket go well together.',
    'Grey and white are a classic pairing, so your Fieldhouse Wool Trouser and Vela Court Low go well together.',
    'Every piece shares a minimal and classic style.',
  ]);
  assert.equal(out.suggestions[1].name, 'White oxford shirt and grey trousers');
  const noShirt = run(closet.filter((r) => r.id !== 'ox'));
  assert.deepEqual(noShirt.suggestions.map((s) => [s.itemIds, s.name]), [[['ch', 'tr', 'sn'], 'Navy chore jacket and grey trousers']]);
});

test('E5: clashing or unpaired combinations are left out, and so are items without a type or colors', () => {
  const base = [custom('bt', 'clothing', 'tee', ['black']), custom('nc', 'clothing', 'chinos', ['navy']), custom('s', 'sneaker', 'court', ['white'])];
  assert.deepEqual(run(base), { suggestions: [], missing: [], emptyReason: 'no_pairs', leftOut: { noType: 0, noColors: 0 } });
  assert.deepEqual(run([...base, custom('gt', 'clothing', 'trousers', ['grey'])]).suggestions.map((s) => s.itemIds), [['bt', 'gt', 's']]);

  const mixed = [
    custom('red', 'clothing', 'tee', ['red']),
    custom('navyshirt', 'clothing', 'oxford-shirt', ['navy']),
    custom('pink', 'clothing', 'chinos', ['pink']),
    custom('court', 'sneaker', 'court', ['white']),
    custom('cap', 'clothing', 'Cap', ['black']),
    custom('runner', 'sneaker', 'runner', []),
    custom('strap', 'watch', 'strap', ['brown']),
  ];
  const out = run(mixed);
  assert.deepEqual(out.suggestions.map((s) => s.itemIds), [['navyshirt', 'pink', 'court']]);
  assert.deepEqual(out.leftOut, { noType: 1, noColors: 1 });
  const used = JSON.stringify(out.suggestions);
  for (const id of ['"red"', '"cap"', '"runner"', '"strap"']) assert.ok(!used.includes(id), id);
});

test('E6: at most one watch, and only one that clashes with nothing', () => {
  const closet = [custom('bt', 'clothing', 'tee', ['black']), cat('gt', 'fieldhouse-wool-trouser--grey'), cat('cl', 'vela-court-low--white-gum'), custom('nw', 'watch', 'field', ['navy'])];
  const out = run(closet);
  assert.equal(out.suggestions.length, 1);
  assert.deepEqual(out.suggestions[0].itemIds, ['bt', 'gt', 'cl'], 'navy and black clash, so no watch');
  const more = run([...closet, cat('bk', 'arden-field--af38-sl-bk'), cat('cr', 'arden-field--af38-sl-cr')]);
  assert.equal(more.suggestions[0].itemIds.at(-1), 'bk');
  for (const s of more.suggestions) assert.ok(s.itemIds.filter((id) => ['nw', 'bk', 'cr'].includes(id)).length <= 1);
});

test('E7: a saved outfit with every clothing and shoe piece hides the suggestion; copies count as one', () => {
  const closet = alexCloset();
  assert.deepEqual([run(closet, { saved: [['j', 't', 's']] }).suggestions, run(closet, { saved: [['j', 't', 's']] }).emptyReason], [[], 'all_saved']);
  assert.equal(run(closet, { saved: [['j', 't', 's', 'w']] }).emptyReason, 'all_saved');
  assert.equal(run(closet, { saved: [['t', 's']] }).suggestions.length, 1, 'a saved subset does not hide it');
  assert.equal(run(closet, { saved: [['j', 't', 'gone']] }).suggestions.length, 1, 'dangling ids are ignored');
  const withCopy = [...closet, cat('s2', 'vela-court-low--white-gum')];
  const out = run(withCopy);
  assert.equal(out.suggestions.length, 1);
  assert.ok(out.suggestions[0].itemIds.includes('s') && !out.suggestions[0].itemIds.includes('s2'), 'the oldest copy is used');
  assert.equal(run(withCopy, { saved: [['j', 't', 's2']] }).emptyReason, 'all_saved');
});

test('E8: missing parts and left-out counts when items have no type or no colors', () => {
  assert.deepEqual(
    (({ missing, leftOut }) => ({ missing, leftOut }))(run([custom('x', 'clothing', null, ['grey']), custom('c', 'sneaker', 'court', ['white']), cat('j', 'harbor-pine-deck-jacket--navy')])),
    { missing: ['bottom'], leftOut: { noType: 1, noColors: 0 } },
  );
  const noColors = run([custom('tee', 'clothing', 'tee', []), cat('t', 'fieldhouse-wool-trouser--grey'), custom('c', 'sneaker', 'court', ['white'])]);
  assert.deepEqual([noColors.missing, noColors.leftOut], [['top'], { noType: 0, noColors: 1 }]);
  const unconfirmed = run([cat('j', 'harbor-pine-deck-jacket--navy', { variantId: null }), cat('t', 'fieldhouse-wool-trouser--grey'), custom('c', 'sneaker', 'court', ['white'])]);
  assert.deepEqual([unconfirmed.missing, unconfirmed.leftOut.noColors], [['top'], 1]);
  assert.deepEqual(run([cat('strap', 'linwick-field-strap--brown-20')]).leftOut, { noType: 0, noColors: 0 });
});

test('E9: variety cap, limits, and a big closet stays fast and bounded', () => {
  const closet = [
    custom('t1', 'clothing', 'tee', ['white']),
    custom('t2', 'clothing', 'tee', ['light-blue']),
    custom('t3', 'clothing', 'tee', ['grey']),
    custom('b1', 'clothing', 'chinos', ['navy']),
    custom('b2', 'clothing', 'trousers', ['charcoal']),
    custom('s1', 'sneaker', 'court', ['white']),
  ];
  const ids = (out) => out.suggestions.map((s) => s.itemIds.join());
  assert.deepEqual(ids(run(closet)), ['t2,b1,s1', 't3,b1,s1', 't2,b2,s1', 't1,b1,s1', 't1,b2,s1', 't3,b2,s1']);
  assert.deepEqual(ids(run(closet, { limit: 4 })), ['t2,b1,s1', 't3,b1,s1', 't2,b2,s1', 't1,b2,s1']);
  assert.equal(run(closet, { limit: 0 }).suggestions.length, 1);
  assert.ok(run(closet, { limit: 99 }).suggestions.length <= SUGGEST_RULES.maxLimit);
  assert.deepEqual(ids(run(closet, { limit: 'x' })), ids(run(closet)));

  const big = [];
  const tones = ['white', 'light-blue', 'grey', 'navy', 'olive', 'bone', 'charcoal', 'khaki'];
  for (let i = 0; i < 40; i += 1) big.push(custom(`top${i}`, 'clothing', 'tee', [tones[i % 8]]));
  for (let i = 0; i < 20; i += 1) big.push(custom(`jk${i}`, 'clothing', 'field-jacket', [tones[(i + 3) % 8]]));
  for (let i = 0; i < 40; i += 1) big.push(custom(`bt${i}`, 'clothing', 'trousers', [tones[(i + 5) % 8]]));
  for (let i = 0; i < 40; i += 1) big.push(custom(`sh${i}`, 'sneaker', 'court', [tones[(i + 1) % 8]]));
  for (let i = 0; i < 20; i += 1) big.push(custom(`wa${i}`, 'watch', 'field', [tones[(i + 2) % 8]]));
  const started = performance.now();
  const out = run(big, { limit: 12 });
  const took = performance.now() - started;
  assert.equal(out.suggestions.length, 12);
  assert.equal(new Set(out.suggestions.map((s) => s.key)).size, 12);
  const uses = new Map();
  for (const s of out.suggestions) for (const id of s.key.split('+')) uses.set(id, (uses.get(id) ?? 0) + 1);
  assert.ok(Math.max(...uses.values()) <= SUGGEST_RULES.maxRepeats, 'no core item in more than two suggestions');
  for (const prefix of ['top', 'jk', 'bt', 'sh']) assert.ok([...uses.keys()].filter((id) => id.startsWith(prefix)).length <= SUGGEST_RULES.perPart, prefix);
  assert.ok(took < 1000, `took ${Math.round(took)} ms`);
});

test('E10: the result does not depend on the order items come in', () => {
  const closet = [
    cat('ox-w', 'wrenfield-oxford--white'),
    cat('ox-b', 'wrenfield-oxford--light-blue'),
    cat('chore', 'wrenfield-chore-jacket--navy'),
    cat('tr-g', 'fieldhouse-wool-trouser--grey'),
    cat('tr-c', 'fieldhouse-wool-trouser--charcoal'),
    cat('cl-w', 'vela-court-low--white-gum'),
    cat('cl-b', 'vela-court-low--black-white'),
    cat('af', 'arden-field--af38-sl-bk'),
  ];
  const once = run(closet, { limit: 12 });
  const shuffled = [...closet].reverse();
  [shuffled[1], shuffled[4]] = [shuffled[4], shuffled[1]];
  assert.deepEqual(run(shuffled, { limit: 12 }), once);
  assert.deepEqual(run([...closet].reverse(), { limit: 12 }), once);
});

test('E11: outfitPart maps categories and types (keys or labels) to outfit parts', () => {
  const cases = [
    [['sneaker', null], 'feet'], [['sneaker', 'court'], 'feet'],
    [['watch', 'field'], 'wrist'], [['watch', null], 'wrist'],
    [['watch', 'strap'], 'strap'], [['watch', 'Strap'], 'strap'],
    [['clothing', 'tee'], 'top'], [['clothing', 'T-shirt'], 'top'], [['clothing', 'hoodie'], 'top'],
    [['clothing', 'field-jacket'], 'outer'], [['clothing', 'Bomber jacket'], 'outer'],
    [['clothing', 'chinos'], 'bottom'], [['clothing', 'Jeans'], 'bottom'],
    [['clothing', null], null], [['clothing', 'Cap'], null],
  ];
  for (const [args, want] of cases) assert.equal(outfitPart(...args), want, JSON.stringify(args));
});

test('E12: every name and reason reads as a sentence; the rules are fixed', () => {
  const closets = [
    alexCloset(),
    [cat('ox', 'wrenfield-oxford--white'), cat('ch', 'wrenfield-chore-jacket--navy'), cat('tr', 'fieldhouse-wool-trouser--grey'), cat('sn', 'vela-court-low--white-gum')],
    [custom('t1', 'clothing', 'tee', ['white']), custom('b1', 'clothing', 'chinos', ['navy']), custom('s1', 'sneaker', 'court', ['white'])],
  ];
  for (const closet of closets) {
    for (const s of run(closet, { limit: 12 }).suggestions) {
      assert.ok(s.name.length > 0 && s.name.length <= 60 && /^[A-Z]/.test(s.name), s.name);
      assert.ok(s.reasons.length >= 1 && s.reasons.length <= 3);
      for (const r of s.reasons) assert.ok(r.endsWith('.'), r);
    }
  }
  assert.ok(Object.isFrozen(SUGGEST_RULES));
  assert.deepEqual(OUTFIT_PARTS, ['top', 'outer', 'bottom', 'feet', 'wrist']);
});
