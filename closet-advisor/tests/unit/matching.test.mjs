// Matching pipeline: feature extraction on synthetic pixels, the matcher's evidence rules and
// abstention, and the match-job operations (lifecycle, failures, access, confirmation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFeatures, analyzeImage, paletteDistance, gridDistance, mirrorGrid, resampleGrid, referenceBackdrop, STUDIO_TONES } from '../../js/engine/features.js';
import { buildIndex, match, findIdentifiers, isValidGtin, codeSkeleton, editDistance, normalizeText, visualDistance, MATCH_CONFIG } from '../../js/engine/matcher.js';
import { buildCatalog } from '../../js/data/catalog-index.js';
import { staticCatalog, loadCatalog } from '../../js/server/catalog-repo.js';
import { specFor, ILLUSTRATION_VERSION } from '../../js/data/illustrations.js';
import { hexToRgb } from '../../js/data/colors.js';
import { createApi } from '../../js/server/api.js';
import { createTestProviders } from '../../js/server/providers/test.js';
import { requeueMatchJob, MAX_ATTEMPTS, referenceKey } from '../../js/server/ops/matching.js';
import { createTestEnv, rejectsWith, waitForJob, ALEX, SAM, NOW } from '../helpers.mjs';
import { rng, image, studio, photo } from '../fixtures/scenes.mjs';

// ---------- Fixture catalog: named demo products only, so catalog growth can't move results ----------

const FULL = staticCatalog();
const FIXTURE_PRODUCTS = ['vela-court-low', 'kestrel-runner-2', 'arden-field', 'harbor-pine-deck-jacket', 'fieldhouse-wool-trouser'];

function fixtureCatalog({ extraVariants = [], dropVariants = [] } = {}) {
  const products = FIXTURE_PRODUCTS.map((id) => FULL.product(id));
  const variants = [...products.flatMap((p) => FULL.variantsOf(p.id)), ...extraVariants].filter((v) => !dropVariants.includes(v.id));
  const brands = [...new Set(products.map((p) => p.brandId))].map((id) => FULL.brand(id));
  return buildCatalog({ version: 'fixture', brands, products, variants, images: [], retailers: [], offers: [] });
}

function refsFor(catalog) {
  const map = new Map();
  for (const v of catalog.listVariants()) {
    const p = catalog.product(v.productId);
    map.set(v.id, extractFeatures(studio(specFor(p, v)), { category: p.category }));
  }
  return map;
}

const photoCache = new Map();
function photoFeatures(catalog, variantId, seed = 1) {
  const key = `${variantId}:${seed}`;
  if (!photoCache.has(key)) {
    const v = catalog.variant(variantId);
    const p = catalog.product(v.productId);
    photoCache.set(key, extractFeatures(photo(specFor(p, v), seed), { category: p.category }));
  }
  return photoCache.get(key);
}

const CATALOG = fixtureCatalog();
const REFS = refsFor(CATALOG);
const INDEX = buildIndex(CATALOG, REFS);
const OUT_SNEAKER = { kind: 'sneaker', shape: 'runner', palette: { upper: '#c0322e', sole: '#ecd04a', accent: '#2f5fa8', laces: '#ffffff' } };

// ---------- Features ----------

function rect(img, x0, y0, x1, y1, hex) {
  const c = hexToRgb(hex);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
    }
  }
}

function addNoise(img, sigma, seed = 3) {
  const r = rng(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    for (let k = 0; k < 3; k++) img.data[i + k] += (r() + r() + r() - 1.5) * 2 * sigma;
  }
}

const near = (actual, expected, tol, label) => assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} not within ${tol} of ${expected}`);

test('features find an item on a plain background', () => {
  const img = image(256, 192, '#f5f5f2');
  rect(img, 60, 50, 200, 140, '#c0322e');
  const f = extractFeatures(img, { category: 'sneaker' });
  assert.equal(f.v, 1);
  assert.equal(f.category, 'sneaker');
  assert.equal(f.width, 256);
  near(f.bbox.x, 60 / 256, 0.015, 'bbox.x');
  near(f.bbox.w, 140 / 256, 0.02, 'bbox.w');
  near(f.bbox.y, 50 / 192, 0.015, 'bbox.y');
  near(f.aspect, 140 / 90, 0.06, 'aspect');
  near(f.fgRatio, (140 * 90) / (256 * 192), 0.01, 'fgRatio');
  assert.equal(f.palette[0].name, 'red');
  near(f.palette.reduce((s, c) => s + c.weight, 0), 1, 1e-9, 'palette weights');
  assert.deepEqual(Object.keys(f.stats).sort(), ['brightness', 'colorfulness', 'edgeDensity']);
});

test('features separate an item from a gradient, noisy background', () => {
  const img = image(256, 192, (x, y) => {
    const v = 232 - y * 0.4 - x * 0.12;
    return [v, v, v - 5];
  });
  rect(img, 50, 60, 210, 120, '#5d6136');
  rect(img, 50, 120, 210, 145, '#ddd3bd');
  addNoise(img, 4);
  const f = extractFeatures(img, { category: 'sneaker' });
  near(f.bbox.x, 50 / 256, 0.02, 'bbox.x');
  near(f.bbox.y, 60 / 192, 0.02, 'bbox.y');
  near(f.bbox.h, 85 / 192, 0.03, 'bbox.h');
  const names = f.palette.map((c) => c.name);
  assert.ok(names.includes('olive') && names.includes('bone'), `palette ${names}`);
  const olive = f.palette.find((c) => c.name === 'olive');
  near(olive.weight, 60 / 85, 0.06, 'olive weight');
});

test('features handle textured backdrops and two-surface scenes', () => {
  // Wood-like grain on the top 60%, a darker floor below: two background clusters.
  const img = image(256, 192, (x, y) => {
    const grain = Math.sin((y + Math.sin(x * 0.07) * 5) * 0.5) * 9;
    return y < 115 ? [190 + grain, 150 + grain, 105 + grain] : [120, 118, 112];
  });
  rect(img, 70, 70, 190, 150, '#1f2a44');
  addNoise(img, 3);
  const f = extractFeatures(img, { category: 'clothing' });
  near(f.bbox.x, 70 / 256, 0.02, 'bbox.x');
  near(f.bbox.w, 120 / 256, 0.03, 'bbox.w');
  near(f.bbox.h, 80 / 192, 0.03, 'bbox.h');
  assert.equal(f.palette[0].name, 'navy');
});

test('a soft cast shadow is not part of the item, a grey item on grey is kept', () => {
  const shadowed = image(256, 192, '#d8d6d0');
  // Shadow: the backdrop darkened by 30% without changing hue, under and right of the item.
  const shadowRgb = hexToRgb('#d8d6d0').map((v) => Math.round(v * 0.7));
  const hex = `#${shadowRgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  rect(shadowed, 80, 120, 214, 150, hex);
  rect(shadowed, 60, 60, 200, 130, '#c0322e');
  const a = analyzeImage(shadowed, { category: 'sneaker' });
  near(a.features.bbox.h, 70 / 192, 0.03, 'shadow excluded from bbox height');
  assert.equal(a.mode, 'shadow_removed');

  const grey = image(256, 192, '#c4c6c4');
  rect(grey, 90, 30, 170, 170, '#8e9092');
  const b = analyzeImage(grey, { category: 'clothing' });
  near(b.features.bbox.h, 140 / 192, 0.03, 'grey item kept');
  assert.equal(b.features.palette[0].name, 'grey');
});

test('the grid records where colors are inside the item', () => {
  const img = image(256, 192, '#e6e8e3');
  rect(img, 40, 40, 216, 100, '#1f2a44');
  rect(img, 40, 100, 216, 160, '#f5f5f2');
  const f = extractFeatures(img, { category: 'sneaker' });
  assert.equal(f.grid.cols, 6);
  assert.equal(f.grid.rows, 4);
  const top = f.grid.cells.slice(0, 6);
  const bottom = f.grid.cells.slice(18, 24);
  assert.ok(top.every((c) => c && c[0] < 30), 'top row is dark');
  assert.ok(bottom.every((c) => c && c[0] > 85), 'bottom row is light');
  // Mirroring and resampling keep the layout.
  assert.deepEqual(mirrorGrid(mirrorGrid(f.grid)), f.grid);
  const coarse = resampleGrid(f.grid, 3, 2);
  assert.equal(coarse.cells.length, 6);
  assert.ok(coarse.cells[0][0] < 30 && coarse.cells[5][0] > 85);
  assert.equal(gridDistance(f.grid, f.grid).distance, 0);
});

test('an empty scene reports no item', () => {
  const img = image(256, 192, '#b8b5ae');
  addNoise(img, 5);
  const f = extractFeatures(img, { category: 'watch' });
  assert.equal(f.fgRatio, 0);
  assert.deepEqual(f.bbox, { x: 0, y: 0, w: 1, h: 1 });
});

test('features are deterministic and fast at analysis size', () => {
  const v = CATALOG.variant('kestrel-runner-2--olive-bone');
  const img = photo(specFor(CATALOG.product(v.productId), v), 11);
  const a = extractFeatures(img, { category: 'sneaker' });
  const b = extractFeatures(img, { category: 'sneaker' });
  assert.deepEqual(a, b);
  const square = photo(specFor(CATALOG.product(v.productId), v), 12);
  const big = image(256, 256, '#a9aca7');
  big.data.set(square.data.subarray(0, Math.min(square.data.length, big.data.length)));
  const times = [];
  for (let i = 0; i < 9; i++) {
    const t = performance.now();
    extractFeatures(big, { category: 'sneaker' });
    times.push(performance.now() - t);
  }
  times.sort((x, y) => x - y);
  assert.ok(times[4] < 30, `median ${times[4].toFixed(1)} ms`);
});

test('palette distance is small for the same item and large for different colors', () => {
  const same = paletteDistance(photoFeatures(CATALOG, 'harbor-pine-deck-jacket--navy', 2).palette, REFS.get('harbor-pine-deck-jacket--navy').palette);
  const other = paletteDistance(photoFeatures(CATALOG, 'harbor-pine-deck-jacket--navy', 2).palette, REFS.get('harbor-pine-deck-jacket--olive').palette);
  assert.ok(same < 5, `same ${same}`);
  assert.ok(other > 25, `other ${other}`);
});

test('reference backdrops contrast with the item', () => {
  assert.notEqual(referenceBackdrop(['#f4f3ee', '#b37a43']), STUDIO_TONES[0], 'white sneaker is not drawn on the light tone');
  assert.notEqual(referenceBackdrop(['#1f2022', '#222326']), STUDIO_TONES[2], 'black item is not drawn on the dark tone');
});

// ---------- Identifiers ----------

test('identifiers tolerate OCR confusions, dashes and spacing', () => {
  const read = (text, source = 'ocr') => findIdentifiers(INDEX, [{ text, source }]).hits.map((h) => `${h.variantId}:${h.exactness}`);
  assert.deepEqual(read('KR2-3O4'), ['kestrel-runner-2--olive-bone:confusable']);
  assert.deepEqual(read('kr2 – 304'), ['kestrel-runner-2--olive-bone:exact']);
  assert.deepEqual(read('VC LOW 1O1'), ['vela-court-low--white-gum:confusable']);
  assert.deepEqual(read('REF. AF38-SL-8K'), ['arden-field--af38-sl-bk:confusable']);
  assert.deepEqual(read('Kestrel\nUS 10  UK 9  EU 44\nKR2-304'), ['kestrel-runner-2--olive-bone:exact']);
  assert.deepEqual(read('STYLEFHWT330GRY'), ['fieldhouse-wool-trouser--grey:exact']);
  assert.equal(normalizeText(' kr2 — 304 '), 'KR2-304');
  assert.equal(codeSkeleton('BOSZ-1'), '80521');
});

test('one OCR slip is tolerated only for long codes with a single close match', () => {
  const hits = (text) => findIdentifiers(INDEX, [{ text, source: 'ocr' }]).hits;
  assert.deepEqual(hits('HP-FJ-210-NVV').map((h) => [h.variantId, h.exactness]), [['harbor-pine-deck-jacket--navy', 'near']]);
  // KR2-30A is one edit from both KR2-304 and KR2-305: no guess.
  assert.deepEqual(hits('KR2-30A'), []);
  // Short codes never get the edit tolerance.
  assert.equal(editDistance('KR230', 'KR2304'), 1);
  assert.deepEqual(hits('KR2-30'), []);
});

test('GTIN check digits are validated and only catalog numbers match', () => {
  assert.equal(isValidGtin('4006381333931'), true);
  assert.equal(isValidGtin('4006381333932'), false);
  assert.equal(isValidGtin('036000291452'), true);
  assert.equal(isValidGtin('12345'), false);
  const gtin = CATALOG.variant('fieldhouse-wool-trouser--grey').identifiers.gtins[0];
  const spaced = `${gtin.slice(0, 1)} ${gtin.slice(1, 7)} ${gtin.slice(7)}`;
  const found = findIdentifiers(INDEX, [{ text: spaced, source: 'ocr' }]);
  assert.deepEqual(found.hits.map((h) => [h.variantId, h.kind]), [['fieldhouse-wool-trouser--grey', 'gtin']]);
  const unknown = findIdentifiers(INDEX, [{ text: '4006381333931', source: 'barcode' }]);
  assert.equal(unknown.hits.length, 0);
  assert.match(unknown.notes[0], /not in the demo catalog/);
  const misread = findIdentifiers(INDEX, [{ text: '4006381333932', source: 'ocr' }]);
  assert.match(misread.notes[0], /did not read cleanly/);
});

// ---------- Matcher ----------

const query = (variantId, seed, extra = {}) => {
  const v = CATALOG.variant(variantId);
  return { features: photoFeatures(CATALOG, variantId, seed), category: CATALOG.product(v.productId).category, texts: [], productUrl: null, ...extra };
};

test('an in-catalog photo is found, with evidence in plain words', () => {
  const r = match(INDEX, query('harbor-pine-deck-jacket--navy', 1));
  assert.equal(r.retrieval, 'candidate_found');
  const c = r.candidates[0];
  assert.equal(c.productId, 'harbor-pine-deck-jacket');
  assert.equal(c.kind, 'match');
  assert.equal(c.variantId, 'harbor-pine-deck-jacket--navy');
  assert.equal(c.variantAmbiguous, false);
  assert.ok(['strong', 'possible'].includes(c.strength));
  assert.ok(c.evidence.some((e) => e.kind === 'visual' && e.source === 'image_features'));
  assert.ok(c.evidence.some((e) => e.kind === 'color' && /^Main colors in your photo: .*navy/.test(e.detail)));
  assert.ok(r.candidates.length <= 5);
  assert.ok(r.features.colors.length > 0 && r.features.colors.every((x) => x.name && x.hex && x.weight > 0));
  assert.equal(r.features.category, 'clothing');
  // No percentages anywhere a person could read.
  assert.ok(!JSON.stringify([r.candidates.map((x) => [x.evidence, x.conflicts, x.variantOptions.map((o) => o.note)]), r.askFor]).includes('%'));
});

test('near-identical colorways are flagged, with the right questions per category', () => {
  const kestrel = match(INDEX, query('kestrel-runner-2--olive-bone', 2));
  assert.equal(kestrel.retrieval, 'candidate_found');
  assert.equal(kestrel.candidates[0].productId, 'kestrel-runner-2');
  assert.equal(kestrel.candidates[0].variantAmbiguous, true);
  assert.deepEqual(kestrel.askFor.map((a) => a.kind), ['size_tag_photo', 'style_code']);
  assert.ok(kestrel.askFor.every((a) => a.reason && !/[A-Z]{4,}/.test(a.reason)));

  const vela = match(INDEX, query('vela-court-low--white-gum', 3));
  assert.equal(vela.candidates[0].productId, 'vela-court-low');
  assert.equal(vela.candidates[0].variantAmbiguous, true, 'sole-only difference is a near-duplicate');
  assert.equal(vela.candidates[0].variantId, 'vela-court-low--white-gum', 'the best guess is kept and flagged');
  const natural = vela.candidates[0].variantOptions.find((o) => o.variantId === 'vela-court-low--white-natural');
  assert.match(natural.note, /Sole is off-white instead of gum/);

  // AF38 and AF40 render identically: no guess at all.
  const watch = match(INDEX, query('arden-field--af38-sl-bk', 4));
  assert.equal(watch.candidates[0].productId, 'arden-field');
  assert.equal(watch.candidates[0].variantAmbiguous, true);
  assert.equal(watch.candidates[0].variantId, null);
  assert.deepEqual(watch.askFor.map((a) => a.kind), ['reference', 'caseback_photo', 'product_link']);
  const af40 = watch.candidates[0].variantOptions.find((o) => o.variantId === 'arden-field--af40-sl-bk');
  assert.ok(af40, 'both sizes are offered');

  // Clothing: a heather version almost the same grey as the mid grey.
  const heather = { ...CATALOG.variant('fieldhouse-wool-trouser--grey'), id: 'fieldhouse-wool-trouser--grey-heather', name: 'Grey heather', identifiers: { styleCode: 'FH-WT-330-GRH' }, illustration: { palette: { main: '#8b8d90', secondary: '#7b7d80', trim: '#696b6e', stitching: '#7d7f82' }, options: { pattern: 'solid' } } };
  const withHeather = fixtureCatalog({ extraVariants: [heather] });
  const index = buildIndex(withHeather, refsFor(withHeather));
  const trousers = match(index, { features: photoFeatures(CATALOG, 'fieldhouse-wool-trouser--grey', 5), category: 'clothing', texts: [] });
  assert.equal(trousers.candidates[0].productId, 'fieldhouse-wool-trouser');
  assert.equal(trousers.candidates[0].variantAmbiguous, true);
  assert.deepEqual(trousers.askFor.map((a) => a.kind), ['brand_label', 'barcode']);
});

test('a code from the label resolves the exact version', () => {
  const r = match(INDEX, query('kestrel-runner-2--olive-bone', 2, { texts: [{ text: 'Kestrel US 10 KR2-3O4', source: 'ocr' }] }));
  assert.equal(r.retrieval, 'candidate_found');
  const c = r.candidates[0];
  assert.equal(c.variantId, 'kestrel-runner-2--olive-bone');
  assert.equal(c.variantAmbiguous, false);
  assert.equal(c.strength, 'strong');
  assert.ok(c.evidence.some((e) => e.kind === 'identifier' && e.source === 'ocr' && /KR2-304 read from your label photo/.test(e.detail)));
  assert.ok(c.evidence.some((e) => e.kind === 'brand_text' && /Kestrel/.test(e.detail)));
  assert.deepEqual(r.askFor, []);

  // A typed reference settles the 38 vs 40 mm question the photo can't.
  const w = match(INDEX, query('arden-field--af38-sl-bk', 4, { texts: [{ text: 'af40-sl-bk', source: 'user_entered' }] }));
  assert.equal(w.candidates[0].variantId, 'arden-field--af40-sl-bk');
  assert.ok(w.candidates[0].evidence.some((e) => e.kind === 'identifier' && /that you typed/.test(e.detail)));
});

test('conflicting evidence is reported, not hidden', () => {
  // The typed code is for White / Natural but the photo clearly shows a gum sole.
  const r = match(INDEX, query('vela-court-low--white-gum', 3, { texts: [{ text: 'VC-LOW-102', source: 'user_entered' }] }));
  const c = r.candidates[0];
  assert.equal(c.variantId, 'vela-court-low--white-natural', 'the identifier decides');
  assert.equal(c.strength, 'possible');
  assert.ok(c.conflicts.some((x) => x.detail === 'The code on your label belongs to White / Natural, but the colors look like White / Gum'), JSON.stringify(c.conflicts));

  // A brand on the label that isn't this product's brand.
  const b = match(INDEX, query('vela-court-low--white-gum', 3, { texts: [{ text: 'KESTREL', source: 'ocr' }] }));
  const vela = b.candidates.find((x) => x.productId === 'vela-court-low');
  assert.ok(vela.conflicts.some((x) => /Your label says Kestrel, but this is a Vela product/.test(x.detail)));

  // A main photo color the catalog version doesn't have.
  const red = { kind: 'clothing', shape: 'field-jacket', palette: { main: '#c0322e', secondary: '#6b4a32', trim: '#55595e' } };
  const f = extractFeatures(photo(red, 8), { category: 'clothing' });
  const j = match(INDEX, { features: f, category: 'clothing', texts: [{ text: 'HP-FJ-210-NVY', source: 'user_entered' }] });
  assert.equal(j.candidates[0].productId, 'harbor-pine-deck-jacket');
  assert.ok(j.candidates[0].conflicts.some((x) => /Red is a main color in your photo/.test(x.detail)), JSON.stringify(j.candidates[0].conflicts));
});

test('out-of-catalog items and non-products abstain', () => {
  for (const seed of [21, 22, 23]) {
    const r = match(INDEX, { features: extractFeatures(photo(OUT_SNEAKER, seed), { category: 'sneaker' }), category: 'sneaker', texts: [] });
    assert.notEqual(r.retrieval, 'candidate_found', `seed ${seed}`);
    assert.ok(r.candidates.every((c) => c.kind === 'similar'));
    assert.equal(r.askFor[0].kind, 'product_link');
  }
  const empty = image(256, 192, '#9b8f80');
  addNoise(empty, 6);
  const none = match(INDEX, { features: extractFeatures(empty, { category: 'watch' }), category: 'watch', texts: [] });
  assert.equal(none.retrieval, 'no_match');
  assert.deepEqual(none.candidates, []);
  assert.equal(none.askFor[0].kind, 'product_link');
  assert.ok(none.notes.some((n) => /couldn't separate an item/.test(n)));
});

test('a lookalike without its own catalog entry is only similar', () => {
  // Remove the navy runner: a navy runner photo should not become another product's match.
  const catalog = fixtureCatalog({ dropVariants: ['kestrel-runner-2--navy-white'] });
  const index = buildIndex(catalog, refsFor(catalog));
  const f = photoFeatures(CATALOG, 'kestrel-runner-2--navy-white', 6);
  const r = match(index, { features: f, category: 'sneaker', texts: [] });
  assert.notEqual(r.retrieval, 'candidate_found');
  assert.ok(r.candidates.every((c) => c.kind === 'similar' && c.strength !== 'strong'));
});

test('close colors with a plainly different layout are only similar, never a match', () => {
  // The reference's own palette with its grid turned upside down: colors agree, layout doesn't.
  const ref = REFS.get('harbor-pine-deck-jacket--navy');
  const cells = [];
  for (let r = ref.grid.rows - 1; r >= 0; r--) cells.push(...ref.grid.cells.slice(r * ref.grid.cols, (r + 1) * ref.grid.cols));
  const features = { ...ref, grid: { ...ref.grid, cells } };
  const parts = visualDistance(features, ref);
  assert.ok(parts.total <= MATCH_CONFIG.thresholds.accept && parts.grid > MATCH_CONFIG.thresholds.layout, 'close enough overall that only the layout rule refuses it');
  const r = match(INDEX, { features, category: 'clothing', texts: [] });
  assert.notEqual(r.retrieval, 'candidate_found');
  assert.ok(r.candidates.every((c) => c.kind === 'similar'));
  assert.ok(r.notes.some((n) => /shape in the photo doesn't match/.test(n)), JSON.stringify(r.notes));
  // The same palette with the real layout is a match.
  assert.equal(match(INDEX, { features: ref, category: 'clothing', texts: [] }).retrieval, 'candidate_found');
});

test('category is a hard filter and foreign codes are explained', () => {
  const r = match(INDEX, query('kestrel-runner-2--olive-bone', 2, { texts: [{ text: 'AF38-SL-BK', source: 'user_entered' }] }));
  assert.ok(r.candidates.every((c) => c.productId !== 'arden-field'));
  assert.ok(r.notes.some((n) => /belongs to the Arden Field, which is not in this category/.test(n)));
});

test('match config keeps every threshold in one documented object', () => {
  for (const key of ['strong', 'accept', 'margin', 'similar', 'weak']) assert.equal(typeof MATCH_CONFIG.thresholds[key], 'number');
  assert.ok(MATCH_CONFIG.thresholds.strong < MATCH_CONFIG.thresholds.accept && MATCH_CONFIG.thresholds.accept < MATCH_CONFIG.thresholds.similar);
  assert.equal(MATCH_CONFIG.identifiers.fuzzyMinLength, 6);
  assert.equal(MATCH_CONFIG.identifiers.maxEdits, 1);
});

// ---------- Operations ----------

const FIXTURE_VARIANTS = CATALOG.listVariants().map((v) => v.id);
const PHOTO_SIZES = { kestrel: 1101, vela: 1102, arden: 1103, jacket: 1104, nothing: 1105 };
const PHOTO_VARIANT = { 1101: 'kestrel-runner-2--olive-bone', 1102: 'vela-court-low--white-gum', 1103: 'arden-field--af38-sl-bk', 1104: 'harbor-pine-deck-jacket--navy' };

function visionFor(blob) {
  const variantId = PHOTO_VARIANT[blob.size];
  if (variantId) return photoFeatures(CATALOG, variantId, 7);
  const empty = image(256, 192, '#9b8f80');
  return extractFeatures(empty, { category: null });
}

async function matchEnv(opts = {}) {
  const calls = { reference: [] };
  const providers = {
    features: (args) => visionFor(args.blob),
    referenceFeatures: (catalog) => {
      calls.reference.push(catalog.version);
      return opts.refs ?? new Map(FIXTURE_VARIANTS.map((id) => [id, REFS.get(id)]));
    },
    ocrText: opts.ocrText,
    ...(opts.providers ?? {}),
  };
  const env = await createTestEnv({ providers, config: { matchTimeoutMs: 400, ...(opts.config ?? {}) }, rateLimits: opts.rateLimits });
  return { ...env, calls };
}

async function putPhoto(db, userId, size, kind = 'original') {
  const id = `pho_${userId.slice(-4)}_${kind}_${size}_${Math.random().toString(36).slice(2, 8)}`;
  const blob = new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
  await db.put('photos', { id, userId, kind, blob, mime: 'image/jpeg', width: 1200, height: 900, bytes: size, createdAt: new Date(NOW).toISOString() });
  return id;
}

/** Stores an original and its processing copy the way uploadPhoto does. */
async function uploaded(db, userId, size) {
  const photoId = await putPhoto(db, userId, size, 'original');
  const processingId = await putPhoto(db, userId, size, 'processing');
  const processing = await db.get('photos', processingId);
  await db.put('photos', { ...processing, originalId: photoId });
  return { photoId, processingId };
}

test('a match job runs in the background and returns what the confirmation screen needs', async () => {
  const { api, db, as } = await matchEnv();
  const alex = await as(ALEX);
  const { photoId, processingId } = await uploaded(db, ALEX, PHOTO_SIZES.jacket);
  const created = await api.createMatchJob(alex, { photoId, category: 'clothing', dest: 'owned', idempotencyKey: 'k1' });
  assert.equal(created.status, 'queued');
  assert.equal(created.processingId, processingId, 'the processing copy is found from the original');
  assert.equal(created.runId, undefined);
  const job = await waitForJob(api, alex, created.id);
  assert.equal(job.status, 'done');
  assert.equal(job.attempts, 1);
  assert.equal(job.progress, null);
  assert.equal(typeof job.latencyMs, 'number');
  assert.equal(job.result.retrieval, 'candidate_found');
  const c = job.result.candidates[0];
  assert.equal(c.productId, 'harbor-pine-deck-jacket');
  assert.equal(c.product.brand.name, 'Harbor & Pine');
  assert.equal(c.variants.length, c.variantOptions.length);
  assert.ok(c.variants.every((v, i) => v.id === c.variantOptions[i].variantId));
  assert.match(c.variants[0].image.url, /^data:image\/svg\+xml/);
  assert.ok(job.result.features.colors.some((x) => x.name === 'navy'));
});

test('reference features are computed once and cached per variant and illustration version', async () => {
  // Every catalog version gets features here, so nothing is left to render on a later start.
  const { api, db, as, calls, clock, providers } = await matchEnv({ refs: refsFor(FULL) });
  const alex = await as(ALEX);
  const first = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.kestrel)), category: 'sneaker' });
  await waitForJob(api, alex, first.id);
  const second = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.vela)), category: 'sneaker' });
  await waitForJob(api, alex, second.id);
  assert.equal(calls.reference.length, 1, 'built once');
  const rows = await db.all('catalogFeatures');
  const row = rows.find((r) => r.variantId === 'kestrel-runner-2--olive-bone');
  assert.equal(row.id, `kestrel-runner-2--olive-bone:${ILLUSTRATION_VERSION}`);
  assert.equal(row.id, referenceKey('kestrel-runner-2--olive-bone'));
  assert.equal(row.features.v, 1);

  // A fresh server over the same store reads the cache instead of rendering again.
  const again = createApi({ db, clock, providers });
  const third = await again.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.arden)), category: 'watch' });
  const done = await waitForJob(again, alex, third.id);
  assert.equal(done.status, 'done');
  assert.equal(calls.reference.length, 1, 'served from catalogFeatures');
});

test('repeated taps with the same idempotency key return the same job', async () => {
  const { api, db, as } = await matchEnv();
  const alex = await as(ALEX);
  const photo = await uploaded(db, ALEX, PHOTO_SIZES.kestrel);
  const [a, b] = await Promise.all([
    api.createMatchJob(alex, { ...photo, category: 'sneaker', idempotencyKey: 'same-tap' }),
    api.createMatchJob(alex, { ...photo, category: 'sneaker', idempotencyKey: 'same-tap' }),
  ]);
  const c = await api.createMatchJob(alex, { ...photo, category: 'sneaker', idempotencyKey: 'same-tap' });
  assert.equal(a.id, b.id);
  assert.equal(a.id, c.id);
  assert.equal((await db.where('matchJobs', 'userId', ALEX)).length, 1);
  await waitForJob(api, alex, a.id);
});

test("another person can't read, change or confirm a job, or use someone else's photo", async () => {
  const { api, db, as } = await matchEnv();
  const alex = await as(ALEX);
  const sam = await as(SAM);
  const photo = await uploaded(db, ALEX, PHOTO_SIZES.kestrel);
  const job = await api.createMatchJob(alex, { ...photo, category: 'sneaker' });
  const done = await waitForJob(api, alex, job.id);
  const cand = done.result.candidates[0];
  await rejectsWith(api.getMatchJob(sam, { jobId: job.id }), 'not_found');
  await rejectsWith(api.confirmMatch(sam, { jobId: job.id, candidateId: cand.id, variantId: cand.variantOptions[0].variantId }), 'not_found');
  await rejectsWith(api.addMatchEvidence(sam, { jobId: job.id, code: 'KR2-304' }), 'not_found');
  await rejectsWith(api.retryMatchJob(sam, { jobId: job.id }), 'not_found');
  await rejectsWith(api.rejectMatch(sam, { jobId: job.id }), 'not_found');
  await rejectsWith(api.createMatchJob(sam, { photoId: photo.photoId, category: 'sneaker' }), 'not_found');
  const samPhoto = await uploaded(db, SAM, PHOTO_SIZES.vela);
  await rejectsWith(api.addMatchEvidence(alex, { jobId: job.id, labelPhotoId: samPhoto.photoId }), 'not_found');
  // A missing id looks the same as someone else's.
  await rejectsWith(api.getMatchJob(alex, { jobId: 'job_does_not_exist' }), 'not_found');
  assert.equal((await db.where('ownedItems', 'userId', SAM)).length, 3);
});

test('vision timeouts and errors leave a job that can be retried, up to the attempt limit', async () => {
  const { api, db, as } = await matchEnv({ config: { matchTimeoutMs: 40, providerSimulation: { vision: 'timeout', offers: 'ok', ocr: 'ok' } } });
  const alex = await as(ALEX);
  const job = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.kestrel)), category: 'sneaker' });
  const timedOut = await waitForJob(api, alex, job.id);
  assert.equal(timedOut.status, 'timeout');
  assert.equal(timedOut.error.code, 'timeout');
  assert.equal(timedOut.canRetry, true);
  await rejectsWith(api.confirmMatch(alex, { jobId: job.id, candidateId: 'cand_kestrel-runner-2', variantId: null }), 'invalid');

  await db.put('config', { key: 'providerSimulation', value: { vision: 'error', offers: 'ok', ocr: 'ok' } });
  await api.retryMatchJob(alex, { jobId: job.id, idempotencyKey: 'r1' });
  const failed = await waitForJob(api, alex, job.id);
  assert.equal(failed.status, 'error');
  assert.equal(failed.attempts, 2);
  assert.match(failed.error.message, /Try again/);

  await db.put('config', { key: 'providerSimulation', value: { vision: 'ok', offers: 'ok', ocr: 'ok' } });
  await api.retryMatchJob(alex, { jobId: job.id, idempotencyKey: 'r2' });
  const ok = await waitForJob(api, alex, job.id);
  assert.equal(ok.status, 'done');
  assert.equal(ok.attempts, 3);
  await rejectsWith(api.retryMatchJob(alex, { jobId: job.id, idempotencyKey: 'r3' }), 'conflict');

  // The limit holds even when every run fails.
  await db.put('config', { key: 'providerSimulation', value: { vision: 'error', offers: 'ok', ocr: 'ok' } });
  const other = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.vela)), category: 'sneaker' });
  await waitForJob(api, alex, other.id);
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    await api.retryMatchJob(alex, { jobId: other.id, idempotencyKey: `x${i}` });
    await waitForJob(api, alex, other.id);
  }
  const last = await api.getMatchJob(alex, { jobId: other.id });
  assert.equal(last.attempts, MAX_ATTEMPTS);
  assert.equal(last.canRetry, false);
  await rejectsWith(api.retryMatchJob(alex, { jobId: other.id, idempotencyKey: 'x9' }), 'conflict');
  const events = await db.where('events', 'type', 'match_failed');
  assert.ok(events.length >= 4);
});

test('the admin retry re-queues a failed job through requeueMatchJob', async () => {
  const { api, db, as, clock, providers } = await matchEnv({ config: { providerSimulation: { vision: 'error', offers: 'ok', ocr: 'ok' } } });
  const alex = await as(ALEX);
  const job = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.jacket)), category: 'clothing' });
  await waitForJob(api, alex, job.id);
  await db.put('config', { key: 'providerSimulation', value: { vision: 'ok', offers: 'ok', ocr: 'ok' } });
  const config = { get: async (key) => (await db.get('config', key))?.value ?? { matchTimeoutMs: 400 }[key] ?? null, set: async () => {} };
  const ctx = { db, providers, config, clock, catalog: () => loadCatalog(db), metric: async () => {} };
  const out = await requeueMatchJob(ctx, job.id);
  assert.deepEqual(Object.keys(out).sort(), ['attempts', 'id', 'status']);
  assert.equal(out.status, 'queued');
  assert.equal((await waitForJob(api, alex, job.id)).status, 'done');
  await rejectsWith(requeueMatchJob(ctx, job.id), 'conflict');
});

test('nothing is saved until the person confirms; a rejected match creates no item', async () => {
  const { api, db, as } = await matchEnv();
  const alex = await as(ALEX);
  const before = (await db.where('ownedItems', 'userId', ALEX)).length;
  const job = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.kestrel)), category: 'sneaker' });
  const done = await waitForJob(api, alex, job.id);
  assert.equal((await db.where('ownedItems', 'userId', ALEX)).length, before, 'a finished match saves nothing');
  const rejected = await api.rejectMatch(alex, { jobId: job.id });
  assert.equal(rejected.status, 'rejected');
  assert.equal((await db.where('ownedItems', 'userId', ALEX)).length, before);
  await rejectsWith(api.confirmMatch(alex, { jobId: job.id, candidateId: done.result.candidates[0].id, variantId: 'kestrel-runner-2--olive-bone' }), 'conflict');
});

test('confirming while matching is still running is refused', async () => {
  const { api, db, as } = await matchEnv({ providers: { visionDelayMs: 150 } });
  const alex = await as(ALEX);
  const job = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.kestrel)), category: 'sneaker' });
  await rejectsWith(api.confirmMatch(alex, { jobId: job.id, candidateId: 'cand_kestrel-runner-2', variantId: null }), 'conflict');
  await waitForJob(api, alex, job.id);
});

test('identity on confirm: a matching code is identifier_supported, the choice alone is the person’s', async () => {
  const { api, db, as } = await matchEnv();
  const alex = await as(ALEX);
  const job = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.kestrel)), category: 'sneaker' });
  await waitForJob(api, alex, job.id);
  const requeued = await api.addMatchEvidence(alex, { jobId: job.id, code: 'kr2 304', idempotencyKey: 'e1' });
  assert.equal(requeued.status, 'queued');
  assert.equal(requeued.attempts, 0);
  const done = await waitForJob(api, alex, job.id);
  assert.deepEqual(done.texts.map((t) => [t.text, t.source]), [['kr2 304', 'user_entered']]);
  const cand = done.result.candidates[0];
  assert.equal(cand.variantId, 'kestrel-runner-2--olive-bone');
  assert.equal(cand.variantAmbiguous, false);
  const { item, job: confirmed } = await api.confirmMatch(alex, { jobId: job.id, candidateId: cand.id, variantId: 'kestrel-runner-2--olive-bone', idempotencyKey: 'c1' });
  assert.equal(item.identity.resolution, 'identifier_supported');
  assert.equal(item.identity.variant, 'confirmed');
  assert.equal(item.identity.retrieval, 'candidate_found');
  assert.equal(item.identity.confirmedBy, ALEX);
  assert.equal(item.identity.confirmedAt, new Date(NOW).toISOString());
  assert.equal(item.identity.matchJobId, job.id);
  assert.ok(item.identity.evidence.some((e) => e.kind === 'identifier' && e.source === 'user_entered' && /KR2-304 that you typed matches this version/.test(e.detail)));
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.confirmedItemId, item.id);
  // The same tap again returns the same result.
  const repeat = await api.confirmMatch(alex, { jobId: job.id, candidateId: cand.id, variantId: 'kestrel-runner-2--olive-bone', idempotencyKey: 'c1' });
  assert.equal(repeat.item.id, item.id);
  await rejectsWith(api.confirmMatch(alex, { jobId: job.id, candidateId: cand.id, variantId: 'kestrel-runner-2--olive-bone', idempotencyKey: 'c2' }), 'conflict');

  // Without a code the confirmation is the person's own, and says so.
  const plain = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.jacket)), category: 'clothing' });
  const plainDone = await waitForJob(api, alex, plain.id);
  const pc = plainDone.result.candidates[0];
  const own = await api.confirmMatch(alex, { jobId: plain.id, candidateId: pc.id, variantId: 'harbor-pine-deck-jacket--olive', allowDuplicate: true });
  assert.equal(own.item.identity.resolution, 'user_confirmed');
  assert.equal(own.item.identity.variant, 'confirmed');
  assert.ok(own.item.identity.evidence.some((e) => e.kind === 'user_selection' && /You confirmed this match, and you chose Olive/.test(e.detail)));
});

test('identity on confirm: codes for another version conflict, an unsure version is incomplete', async () => {
  const { api, db, as } = await matchEnv();
  const alex = await as(ALEX);
  const job = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.kestrel)), category: 'sneaker', texts: [{ text: 'KR2-305', source: 'user_entered' }] });
  const done = await waitForJob(api, alex, job.id);
  const cand = done.result.candidates[0];
  assert.equal(cand.variantId, 'kestrel-runner-2--olive-sail');
  const conflicted = await api.confirmMatch(alex, { jobId: job.id, candidateId: cand.id, variantId: 'kestrel-runner-2--olive-bone' });
  assert.equal(conflicted.item.identity.variant, 'conflicting');
  assert.equal(conflicted.item.identity.resolution, 'user_confirmed');
  assert.ok(conflicted.item.identity.conflicts.some((c) => /KR2-305 that you typed belongs to Olive \/ Sail, not the version you chose/.test(c.detail)));

  const unsure = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.arden)), category: 'watch' });
  const unsureDone = await waitForJob(api, alex, unsure.id);
  const watch = unsureDone.result.candidates[0];
  assert.equal(watch.variantId, null);
  const saved = await api.confirmMatch(alex, { jobId: unsure.id, candidateId: watch.id, variantId: 'arden-field--af40-sl-bk', variantUnsure: true });
  assert.equal(saved.item.identity.variant, 'incomplete');
  assert.ok(saved.item.identity.evidence.some((e) => /you weren't sure which version it is/.test(e.detail)));
  const none = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.arden)), category: 'watch' });
  await waitForJob(api, alex, none.id);
  const noVersion = await api.confirmMatch(alex, { jobId: none.id, candidateId: watch.id, variantId: null, allowDuplicate: true });
  assert.equal(noVersion.item.variantId, null);
  assert.equal(noVersion.item.identity.variant, 'incomplete');
});

test('a manual save has no catalog identity', async () => {
  const { api, db, as } = await matchEnv();
  const alex = await as(ALEX);
  const photo = await uploaded(db, ALEX, PHOTO_SIZES.nothing);
  const job = await api.createMatchJob(alex, { ...photo, category: 'sneaker' });
  const done = await waitForJob(api, alex, job.id);
  assert.equal(done.result.retrieval, 'no_match');
  assert.equal(done.result.askFor[0].kind, 'product_link');
  const { item } = await api.confirmMatch(alex, { jobId: job.id, candidateId: null, variantId: null, custom: { brand: 'Unlisted', name: 'Canvas trail shoe', colors: ['olive'] } });
  assert.equal(item.productId, null);
  assert.equal(item.variantId, null);
  assert.equal(item.identity.resolution, 'manual');
  assert.equal(item.identity.variant, 'not_applicable');
  assert.equal(item.identity.retrieval, 'no_match');
  assert.equal(item.photos.originalId, photo.photoId);
  assert.equal(item.image.kind, 'original');
  assert.equal(item.subtitle, 'Custom item');
  // A custom item can't smuggle in a catalog id.
  const job2 = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.nothing)), category: 'sneaker' });
  await waitForJob(api, alex, job2.id);
  await rejectsWith(api.confirmMatch(alex, { jobId: job2.id, candidateId: 'cand_vela-court-low', variantId: null, custom: { brand: 'X', name: 'Y' } }), 'invalid');
});

test('the original photo stays attached when the catalog image is displayed', async () => {
  const { api, db, as } = await matchEnv();
  const alex = await as(ALEX);
  const photo = await uploaded(db, ALEX, PHOTO_SIZES.jacket);
  const job = await api.createMatchJob(alex, { ...photo, category: 'clothing' });
  const done = await waitForJob(api, alex, job.id);
  const c = done.result.candidates[0];
  const { item } = await api.confirmMatch(alex, { jobId: job.id, candidateId: c.id, variantId: 'harbor-pine-deck-jacket--olive', display: 'catalog' });
  assert.equal(item.display, 'catalog');
  assert.equal(item.image.kind, 'catalog');
  assert.equal(item.image.label, 'Catalog image');
  assert.equal(item.photos.originalId, photo.photoId);
  assert.ok(item.image.options.includes('original'));
  const stored = await db.get('ownedItems', item.id);
  assert.equal(stored.photos.originalId, photo.photoId);
  assert.ok(await db.get('photos', photo.photoId), 'the photo itself is kept');
});

test('confirming something already owned warns first, and multiple copies are allowed', async () => {
  const { api, db, as } = await matchEnv();
  const alex = await as(ALEX);
  const job = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.vela)), category: 'sneaker' });
  const done = await waitForJob(api, alex, job.id);
  const c = done.result.candidates.find((x) => x.productId === 'vela-court-low');
  const err = await rejectsWith(api.confirmMatch(alex, { jobId: job.id, candidateId: c.id, variantId: 'vela-court-low--white-gum', idempotencyKey: 'd1' }), 'duplicate');
  assert.equal(err.message, 'You already have this in your collection.');
  assert.equal(err.details.duplicates[0].variantId, 'vela-court-low--white-gum');
  assert.ok(err.details.duplicates[0].title, 'duplicates are OwnedViews');
  const { item } = await api.confirmMatch(alex, { jobId: job.id, candidateId: c.id, variantId: 'vela-court-low--white-gum', allowDuplicate: true, idempotencyKey: 'd2' });
  assert.equal(item.copies, 2);
});

test('label photos are read on the device and their text becomes evidence', async () => {
  const { api, db, as } = await matchEnv({ ocrText: 'Kestrel\nUS 10  UK 9  EU 44\nKR2-3O4' });
  const alex = await as(ALEX);
  const job = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.kestrel)), category: 'sneaker' });
  await waitForJob(api, alex, job.id);
  const label = await putPhoto(db, ALEX, 777, 'label');
  await api.addMatchEvidence(alex, { jobId: job.id, labelPhotoId: label, idempotencyKey: 'l1' });
  const done = await waitForJob(api, alex, job.id);
  assert.deepEqual(done.labelPhotoIds, [label]);
  assert.equal(done.labelReads[0].status, 'read');
  const ocr = done.texts.find((t) => t.source === 'ocr');
  assert.equal(ocr.photoId, label);
  const c = done.result.candidates[0];
  assert.equal(c.variantId, 'kestrel-runner-2--olive-bone');
  assert.ok(c.evidence.some((e) => e.kind === 'identifier' && e.source === 'ocr'));
  const { item } = await api.confirmMatch(alex, { jobId: job.id, candidateId: c.id, variantId: c.variantId });
  assert.equal(item.identity.resolution, 'identifier_supported');
  assert.ok(item.identity.evidence.some((e) => e.source === 'ocr'));
  assert.deepEqual(item.photos.labelIds, [label]);
});

test('with label reading switched off the match still finishes and says why', async () => {
  const { api, db, as } = await matchEnv({ ocrText: 'KR2-304', config: { providerSimulation: { vision: 'ok', offers: 'ok', ocr: 'off' } } });
  const alex = await as(ALEX);
  const job = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.kestrel)), category: 'sneaker' });
  await waitForJob(api, alex, job.id);
  await api.addMatchEvidence(alex, { jobId: job.id, labelPhotoId: await putPhoto(db, ALEX, 778, 'label') });
  const done = await waitForJob(api, alex, job.id);
  assert.equal(done.status, 'done');
  assert.equal(done.labelReads[0].status, 'unavailable');
  assert.ok(done.result.notes.some((n) => /Type the code instead/.test(n)));
  assert.equal(done.texts.length, 0);
});

test('a product link is resolved when the commerce operation exists, and tolerated when it does not', async () => {
  const { api, db, as } = await matchEnv();
  const alex = await as(ALEX);
  const job = await api.createMatchJob(alex, { ...(await uploaded(db, ALEX, PHOTO_SIZES.kestrel)), category: 'sneaker' });
  await waitForJob(api, alex, job.id);
  await api.addMatchEvidence(alex, { jobId: job.id, productUrl: 'https://northline.example/p/NL-50877' });
  const done = await waitForJob(api, alex, job.id);
  assert.equal(done.status, 'done');
  assert.equal(done.productUrl, 'https://northline.example/p/NL-50877');
  assert.ok(['resolved', 'unavailable', 'unsupported_link', 'unresolved', 'invalid_url'].includes(done.link.status));
  if (done.link.status === 'resolved') {
    assert.equal(done.link.variantId, 'kestrel-runner-2--olive-bone');
    assert.ok(done.result.candidates[0].evidence.some((e) => e.kind === 'product_link' && e.source === 'url'));
  } else {
    assert.ok(done.result.notes.some((n) => /link/.test(n)));
  }
  await rejectsWith(api.addMatchEvidence(alex, { jobId: job.id }), 'invalid');
});

test('wishlist matches save a wishlist item with the photo', async () => {
  const { api, db, as } = await matchEnv();
  const alex = await as(ALEX);
  const photo = await uploaded(db, ALEX, PHOTO_SIZES.arden);
  const job = await api.createMatchJob(alex, { ...photo, category: 'watch', dest: 'wishlist' });
  const done = await waitForJob(api, alex, job.id);
  const c = done.result.candidates[0];
  const { item } = await api.confirmMatch(alex, { jobId: job.id, candidateId: c.id, variantId: 'arden-field--af38-sl-cr', wish: { reason: 'want_exact', desired: { condition: 'new_or_used' }, targetPriceMinor: 40000 } });
  assert.equal(item.status, 'active');
  assert.equal(item.reason, 'want_exact');
  assert.equal(item.photos.originalId, photo.photoId);
  assert.equal(item.identity.resolution, 'user_confirmed');
  assert.ok(await db.get('wishlistItems', item.id));
});

test('inputs are validated and metrics never carry user ids', async () => {
  const { api, db, as } = await matchEnv();
  const alex = await as(ALEX);
  const photo = await uploaded(db, ALEX, PHOTO_SIZES.kestrel);
  await rejectsWith(api.createMatchJob(alex, { ...photo, category: 'hat' }), 'invalid');
  await rejectsWith(api.createMatchJob(alex, { ...photo, category: 'sneaker', dest: 'closet' }), 'invalid');
  await rejectsWith(api.createMatchJob(alex, { ...photo, category: 'sneaker', crop: { x: 0.8, y: 0, w: 0.5, h: 1, rotate: 0 } }), 'invalid');
  await rejectsWith(api.createMatchJob(alex, { ...photo, category: 'sneaker', crop: { x: 0, y: 0, w: 1, h: 1, rotate: 45 } }), 'invalid');
  const job = await api.createMatchJob(alex, { ...photo, category: 'sneaker', crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8, rotate: 90 } });
  assert.deepEqual(job.crop, { x: 0.1, y: 0.1, w: 0.8, h: 0.8, rotate: 90 });
  await waitForJob(api, alex, job.id);
  const events = await db.all('events');
  const types = new Set(events.map((e) => e.type));
  assert.ok(types.has('match_started') && types.has('match_done'));
  const doneEvent = events.find((e) => e.type === 'match_done');
  assert.equal(doneEvent.data.category, 'sneaker');
  assert.equal(typeof doneEvent.data.latencyMs, 'number');
  assert.ok(doneEvent.data.retrieval);
  assert.ok(!JSON.stringify(events).includes(ALEX), 'no user ids in metrics');
});

test('test providers stay the only thing ops depend on (no DOM)', () => {
  const providers = createTestProviders();
  assert.equal(typeof providers.vision.analyze, 'function');
  assert.equal(typeof globalThis.document, 'undefined');
});
