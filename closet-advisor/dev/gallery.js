// Developer gallery for the illustration generator: every catalog variant on both studio tiles,
// plus spec samples for each product type. Query parameters keep screenshots reproducible:
//   ?section=types|dupes|catalog   ?kind=sneaker|watch|clothing   ?size=170   ?bg=both|light|dark
//   ?product=<productId>
import * as catalog from '../js/data/catalog.js';
import { offers } from '../js/data/retailers.js';
import { renderSpecSvg, renderVariantSvg, ILLUSTRATION_VERSION } from '../js/data/illustrations.js';
import { TYPE_LABEL, CATEGORY_LABEL } from '../js/data/schema.js';
import { escapeHtml as esc } from '../js/lib/html.js';

const LIGHT = '#e6e8e3';
const DARK = '#272b49';

const params = new URLSearchParams(location.search);
const section = params.get('section') ?? 'all';
const kind = params.get('kind');
const bg = params.get('bg') ?? 'both';
const productFilter = params.get('product');
const size = Number(params.get('size')) || 170;
document.documentElement.style.setProperty('--tile', `${size}px`);

const timings = [];
const sizes = [];

function svgUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function measure(render) {
  const t0 = performance.now();
  const svg = render();
  timings.push(performance.now() - t0);
  sizes.push(svg.length);
  return svg;
}

function tiles(svg, alt) {
  const url = esc(svgUrl(svg));
  const one = (tone) => `<div class="studio ${tone}"><img src="${url}" alt="${esc(alt)}" width="${size}" height="${size}"></div>`;
  if (bg === 'light') return `<div class="pair">${one('light')}</div>`;
  if (bg === 'dark') return `<div class="pair">${one('dark')}</div>`;
  return `<div class="pair">${one('light')}${one('dark')}</div>`;
}

// ---------- Spec samples per product type ----------

const S = (shape, details, palette, options = {}) => ({ kind: 'sneaker', shape, details, palette, options });
const W = (spec, palette, options = {}) => ({ kind: 'watch', ...spec, palette, options });
const C = (shape, palette, options = {}, details = {}) => ({ kind: 'clothing', shape, details, palette, options });

const WHITE_SHOE = { upper: '#f4f3ee', overlay: '#e9e6dc', sole: '#f2f1ec', midsole: '#f2f1ec', laces: '#efeae0', accent: '#c4c6c4', lining: '#e2ddd0' };
const BLACK_SHOE = { upper: '#222326', overlay: '#2e2f33', sole: '#f2f1ec', midsole: '#f2f1ec', laces: '#1d1e20', accent: '#45484c', lining: '#2a2b2e' };
const OLIVE_SHOE = { upper: '#5d6136', overlay: '#4b4f2b', sole: '#b37a43', midsole: '#ddd3bd', laces: '#e8e1cf', accent: '#c09a6b', lining: '#4f532e' };
const NAVY_SHOE = { upper: '#1f2a44', overlay: '#2b3757', sole: '#f2f1ec', midsole: '#f2f1ec', laces: '#f2f1ec', accent: '#c0322e', lining: '#1a2238' };
const TAN_SHOE = { upper: '#c09a6b', overlay: '#a87a4c', sole: '#b37a43', midsole: '#ece6d6', laces: '#ece6d6', accent: '#6b4a32', lining: '#d9c7a8' };

const SAMPLES = {
  sneaker: [
    ['Runner, stripes', S('runner', { panels: 'stripes', heelTab: true }, { ...WHITE_SHOE, overlay: '#c4c6c4', accent: '#2f5fa8' })],
    ['Runner, mudguard', S('runner', { panels: 'mudguard', heelTab: true, mark: 'bar' }, NAVY_SHOE)],
    ['Court, plain', S('court', { panels: 'plain', heelTab: true }, { ...WHITE_SHOE, sole: '#b37a43', midsole: '#b37a43' })],
    ['Court, toe cap', S('court', { panels: 'plain', heelTab: true, toeCap: true, mark: 'tab' }, BLACK_SHOE)],
    ['Court, wing', S('court', { panels: 'wing', heelTab: true }, TAN_SHOE)],
    ['Court, dots', S('court', { panels: 'dots', heelTab: true, mark: 'dot' }, { ...WHITE_SHOE, accent: '#1f2a44' })],
    ['Trail, mudguard', S('trail', { panels: 'mudguard', heelTab: true, toeCap: true, mark: 'dot' }, { ...OLIVE_SHOE, sole: '#1e1f21', midsole: '#45484c' })],
    ['Trail, stripes', S('trail', { panels: 'stripes', heelTab: true }, { upper: '#8e9092', overlay: '#45484c', sole: '#1e1f21', midsole: '#c4c6c4', laces: '#e2742c', accent: '#e2742c', lining: '#45484c' })],
    ['Skate, toe cap', S('skate', { panels: 'plain', toeCap: true, heelTab: true, mark: 'bar' }, { ...TAN_SHOE, midsole: '#f2f1ec' })],
    ['Skate, mudguard', S('skate', { panels: 'mudguard', heelTab: true }, { ...BLACK_SHOE, overlay: '#3a3b40' })],
    ['High-top, plain', S('high-top', { panels: 'plain', heelTab: true }, WHITE_SHOE)],
    ['High-top, lug sole', S('high-top', { panels: 'mudguard', toeCap: true, sole: 'lug', mark: 'dot' }, { upper: '#6b4a32', overlay: '#5a3d29', sole: '#1e1f21', midsole: '#c09a6b', laces: '#c0322e', accent: '#c09a6b', lining: '#a87a4c' })],
    ['Slip-on, plain', S('slip-on', { panels: 'plain', heelTab: true }, { ...NAVY_SHOE, accent: '#f2f1ec' })],
    ['Slip-on, lug sole', S('slip-on', { panels: 'mudguard', heelTab: true, sole: 'lug' }, OLIVE_SHOE)],
  ],
  watch: [
    ['Field, leather', W({ shape: 'round', bezel: 'plain', hands: 'sword', indices: 'arabic', complications: ['date'] }, { case: '#b9bcc0', dial: '#ece6d6', hands: '#1f2022', indices: '#1f2022', strap: '#6b4a32', strapStitch: '#e3d9c3', accent: '#1f2a44' }, { strapKind: 'leather' })],
    ['Diver, bracelet', W({ shape: 'round', bezel: 'diver', hands: 'mercedes', indices: 'dot', complications: ['date'] }, { case: '#b9bcc0', dial: '#1f2022', bezelInsert: '#1f2022', hands: '#f1f1ee', indices: '#f1f1ee', strap: '#a9adb2', accent: '#c0322e' }, { strapKind: 'bracelet' })],
    ['Dress, small seconds', W({ shape: 'round', bezel: 'plain', hands: 'dauphine', indices: 'roman', complications: ['small-seconds'] }, { case: '#c7a254', dial: '#f5f5f2', hands: '#1f2022', indices: '#1f2022', strap: '#1e1f21', strapStitch: '#45484c', accent: '#1f2022' }, { strapKind: 'leather' })],
    ['Chronograph, tachymeter', W({ shape: 'round', bezel: 'tachymeter', hands: 'baton', indices: 'baton', complications: ['chronograph'] }, { case: '#b9bcc0', dial: '#f5f5f2', bezelInsert: '#1e1f21', hands: '#1e1f21', indices: '#1e1f21', subdial: '#1e1f21', strap: '#1e1f21', accent: '#c0322e' }, { strapKind: 'rubber' })],
    ['GMT, two-tone bezel', W({ shape: 'round', bezel: 'gmt', hands: 'sword', indices: 'dot', complications: ['date', 'gmt'] }, { case: '#b9bcc0', dial: '#1f2022', bezelInsert: '#1f2a44', bezel: '#6d2333', hands: '#f1f1ee', indices: '#f1f1ee', strap: '#a9adb2', accent: '#e2742c' }, { strapKind: 'bracelet' })],
    ['Fluted bezel', W({ shape: 'round', bezel: 'fluted', hands: 'baton', indices: 'baton', complications: ['date'] }, { case: '#c7a254', dial: '#2f5fa8', hands: '#f1f1ee', indices: '#f1f1ee', strap: '#c7a254', accent: '#f1f1ee' }, { strapKind: 'bracelet' })],
    ['Cushion, NATO', W({ shape: 'cushion', bezel: 'plain', hands: 'sword', indices: 'arabic', complications: [] }, { case: '#9ca1a6', dial: '#5d6136', hands: '#f1f1ee', indices: '#f1f1ee', strap: '#5d6136', accent: '#c09a6b' }, { strapKind: 'nato', stripes: 1 })],
    ['Tonneau, integrated', W({ shape: 'tonneau', bezel: 'plain', hands: 'baton', indices: 'baton', complications: ['date'], integrated: true }, { case: '#b9bcc0', dial: '#1f2a44', hands: '#f1f1ee', indices: '#f1f1ee', strap: '#b9bcc0', accent: '#f1f1ee' }, { strapKind: 'bracelet' })],
    ['Digital', W({ shape: 'square', display: 'digital' }, { case: '#1e1f21', dial: '#a9b0a0', bezel: '#2a2b2e', hands: '#1e1f21', indices: '#8e9092', strap: '#1e1f21', accent: '#e2742c' }, { strapKind: 'rubber' })],
    ['Strap, leather', W({ shape: 'strap', pins: 'spring_bar' }, { case: '#b9bcc0', strap: '#6b4a32', strapStitch: '#e3d9c3' }, { strapKind: 'leather' })],
    ['Strap, NATO', W({ shape: 'strap' }, { case: '#b9bcc0', strap: '#1f2a44', accent: '#8e9092' }, { strapKind: 'nato', stripes: 2 })],
    ['Strap, rubber quick release', W({ shape: 'strap', pins: 'quick_release' }, { case: '#b9bcc0', strap: '#1e1f21' }, { strapKind: 'rubber' })],
    ['Strap, mesh', W({ shape: 'strap', pins: 'spring_bar' }, { case: '#b9bcc0', strap: '#b9bcc0' }, { strapKind: 'mesh' })],
  ],
  clothing: [
    ['Tee, solid', C('tee', { main: '#f5f5f2', trim: '#e9e6dc', stitching: '#d9d5ca' })],
    ['Tee, stripe', C('tee', { main: '#ece6d6', secondary: '#1f2a44', trim: '#1f2a44' }, { pattern: 'stripe' })],
    ['Oxford shirt', C('oxford-shirt', { main: '#9dbbdb', buttons: '#f5f5f2', stitching: '#86a6c8' })],
    ['Oxford, check', C('oxford-shirt', { main: '#f5f5f2', secondary: '#2f5fa8', trim: '#1f2a44', buttons: '#f5f5f2' }, { pattern: 'check' })],
    ['Overshirt, check', C('overshirt', { main: '#6b4a32', secondary: '#b6a77c', trim: '#1e1f21', buttons: '#1e1f21' }, { pattern: 'check' })],
    ['Chore jacket', C('chore-jacket', { main: '#1f2a44', buttons: '#c4c6c4', stitching: '#c09a6b' })],
    ['Field jacket', C('field-jacket', { main: '#5d6136', secondary: '#6b4a32', trim: '#94714a', stitching: '#6f7343' }, {}, { pockets: 4, collar: 'corduroy' })],
    ['Bomber', C('bomber', { main: '#5d6136', trim: '#1e1f21', buttons: '#b9bcc0' })],
    ['Hoodie, heather', C('hoodie', { main: '#8e9092', trim: '#7d7f81', buttons: '#f5f5f2' }, { pattern: 'heather' })],
    ['Crewneck', C('crewneck', { main: '#6d2333', trim: '#5e1d2b' })],
    ['Chinos', C('chinos', { main: '#b6a77c', buttons: '#6b4a32', stitching: '#a39467' })],
    ['Trousers, heather', C('trousers', { main: '#45484c', buttons: '#1e1f21' }, { pattern: 'heather' })],
    ['Jeans', C('jeans', { main: '#1f2a44', trim: '#c69078', buttons: '#94714a', stitching: '#c9a032' })],
    ['Shorts', C('shorts', { main: '#1f2a44', buttons: '#c4c6c4' })],
  ],
};

function typesSection() {
  const kinds = kind ? [kind] : ['sneaker', 'watch', 'clothing'];
  return kinds.map((k) => `<h2>${esc(CATEGORY_LABEL[k])}: spec samples</h2><div class="grid">${SAMPLES[k]
    .map(([label, spec]) => `<figure>${tiles(measure(() => renderSpecSvg(spec)), label)}<figcaption><strong>${esc(label)}</strong><span class="id">${esc(spec.shape)}</span></figcaption></figure>`)
    .join('')}</div>`).join('');
}

// ---------- Catalog variants ----------

const productById = new Map(catalog.products.map((p) => [p.id, p]));
const brandById = new Map(catalog.brands.map((b) => [b.id, b]));
const imagesByVariant = new Map();
for (const image of catalog.images) {
  if (!imagesByVariant.has(image.variantId)) imagesByVariant.set(image.variantId, []);
  imagesByVariant.get(image.variantId).push(image);
}
const offersByVariant = new Map();
for (const offer of offers) {
  if (!offersByVariant.has(offer.variantId)) offersByVariant.set(offer.variantId, []);
  offersByVariant.get(offer.variantId).push(offer);
}

function variantFlags(variant) {
  const flags = [];
  for (const image of imagesByVariant.get(variant.id) ?? []) {
    if (image.license !== 'owned') flags.push(['info', 'Feed image terms']);
    if (image.status !== 'active') flags.push(['warn', `Image ${image.status.replace('_', ' ')}`]);
    if (image.permissions?.requiresActiveOffer) flags.push(['info', 'Needs a live offer']);
  }
  const list = offersByVariant.get(variant.id) ?? [];
  const live = list.filter((o) => o.listingStatus === 'active');
  if (!list.length) flags.push(['warn', 'No offers']);
  else flags.push(['', `${live.length} live of ${list.length} offers`]);
  return flags.map(([tone, text]) => `<span class="flag ${tone}">${esc(text)}</span>`).join('');
}

function variantFigure(variant) {
  const product = productById.get(variant.productId);
  const code = variant.identifiers?.styleCode ?? variant.identifiers?.reference ?? '';
  const svg = measure(() => renderVariantSvg(product, variant));
  return `<figure data-variant="${esc(variant.id)}">${tiles(svg, `${product.name}, ${variant.name}`)}
    <figcaption>
      <strong>${esc(variant.name)}</strong>
      <span class="code">${esc(code)}</span>
      <span class="id">${esc(variant.id)}</span>
      <span class="flags">${variantFlags(variant)}</span>
    </figcaption>
  </figure>`;
}

function catalogSection() {
  const kinds = kind ? [kind] : ['sneaker', 'watch', 'clothing'];
  return kinds.map((k) => {
    const list = catalog.products.filter((p) => p.category === k && (!productFilter || p.id === productFilter));
    const count = catalog.variants.filter((v) => list.some((p) => p.id === v.productId)).length;
    return `<h2>${esc(CATEGORY_LABEL[k])}: ${list.length} products, ${count} variants</h2>${list.map((p) => {
      const brand = brandById.get(p.brandId)?.name ?? p.brandId;
      return `<h3>${esc(brand)} ${esc(p.name)} <span class="meta">${esc(TYPE_LABEL[p.type] ?? p.type)} · ${esc(p.id)}</span></h3>
        <div class="grid">${catalog.variants.filter((v) => v.productId === p.id).map(variantFigure).join('')}</div>`;
    }).join('')}`;
  }).join('');
}

function dupesSection() {
  const sets = (catalog.NEAR_DUPLICATES ?? []).filter((set) => !kind || set.category === kind);
  if (!sets.length) return '';
  const byId = new Map(catalog.variants.map((v) => [v.id, v]));
  return `<h2>Near-duplicate sets</h2><p class="note">Each set should look almost the same; only the noted detail differs.</p><div class="dupes">${sets.map((set) => `<section class="dupe">
      <h3>${esc(set.label)}</h3><p class="note">${esc(set.differs)}</p>
      <div class="row">${set.variantIds.map((id) => byId.get(id)).filter(Boolean).map(variantFigure).join('')}</div>
    </section>`).join('')}</div>`;
}

function filtersNav() {
  const link = (label, patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k);
      else next.set(k, v);
    }
    const current = Object.entries(patch).every(([k, v]) => (params.get(k) ?? null) === v);
    return `<a href="?${esc(next.toString())}" aria-current="${current}">${esc(label)}</a>`;
  };
  return [
    link('All sections', { section: null }),
    link('Types', { section: 'types' }),
    link('Near-duplicates', { section: 'dupes' }),
    link('Catalog', { section: 'catalog' }),
    link('All kinds', { kind: null }),
    link('Sneakers', { kind: 'sneaker' }),
    link('Watches', { kind: 'watch' }),
    link('Clothing', { kind: 'clothing' }),
    link('Tile size', { size: null }),
    link('1x', { size: '400' }),
  ].join('');
}

const main = document.getElementById('main');
let body = '';
if (section === 'all' || section === 'types') body += typesSection();
if (section === 'all' || section === 'dupes') body += dupesSection();
if (section === 'all' || section === 'catalog') body += catalogSection();
main.insertAdjacentHTML('beforeend', body);
document.getElementById('filters').innerHTML = filtersNav();

const avg = timings.reduce((a, b) => a + b, 0) / (timings.length || 1);
const maxMs = Math.max(0, ...timings);
const maxKb = Math.max(0, ...sizes) / 1024;
document.getElementById('stats').textContent =
  `Generator ${ILLUSTRATION_VERSION} · catalog ${catalog.CATALOG_VERSION} · ${timings.length} renders · ${avg.toFixed(2)} ms average, ${maxMs.toFixed(2)} ms slowest · largest ${maxKb.toFixed(1)} KB`;
document.documentElement.dataset.ready = 'true';
