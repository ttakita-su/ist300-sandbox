// Renders every shared component with demo data, for visual review in light and dark themes.
// Open /dev/components.html (append ?theme=dark for the dark theme).
import { html, render } from '../js/lib/html.js';
import { icon } from '../js/lib/icons.js';
import { staticCatalog } from '../js/server/catalog-repo.js';
import { ownedView, wishlistView, productSummary, variantView } from '../js/server/views.js';
import { makeIdentity, catalogIdentity } from '../js/server/records.js';
import * as c from '../js/ui/components.js';
import { ownedDetailsFields, wishFields } from '../js/ui/item-forms.js';

const theme = new URLSearchParams(location.search).get('theme');
if (theme) document.documentElement.setAttribute('data-theme', theme);

const catalog = staticCatalog();
const now = Date.now();
const user = 'usr_gallery';

function owned(variantId, extra = {}) {
  const v = catalog.variant(variantId);
  const p = catalog.product(v.productId);
  return ownedView(catalog, {
    id: `own_${variantId}`,
    userId: user,
    createdAt: new Date(now - 86400000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    archivedAt: null,
    category: p.category,
    productId: p.id,
    variantId,
    custom: null,
    identity: catalogIdentity({ userId: user, now, variantId }),
    details: { size: null, condition: 'good', purchase: null, notes: '', serialNumber: null },
    ownerChanges: [],
    photos: { originalId: null, cleanedId: null, labelIds: [] },
    display: 'catalog',
    ...extra,
  }, { now });
}

const tiles = [
  owned('vela-court-low--white-gum', { details: { size: { value: '10', system: 'US-M' }, condition: 'good' } }),
  owned('harbor-pine-deck-jacket--navy', { details: { size: { value: 'M', system: 'ALPHA' } } }),
  owned('fieldhouse-wool-trouser--grey', { details: { size: { value: '32x32', system: 'WAIST-INSEAM' } } }),
  owned('arden-field--af38-sl-bk', { identity: makeIdentity({ retrieval: 'candidate_found', resolution: 'identifier_supported', variant: 'confirmed' }) }),
  owned('kestrel-runner-2--olive-sail', { identity: makeIdentity({ retrieval: 'candidate_found', resolution: 'user_confirmed', variant: 'incomplete' }), variantId: null }),
  owned('fieldhouse-wool-trouser--charcoal', { identity: makeIdentity({ retrieval: 'candidate_found', resolution: 'user_confirmed', variant: 'conflicting' }) }),
  ownedView(catalog, { id: 'own_custom', userId: user, category: 'sneaker', productId: null, variantId: null, custom: { brand: 'Unknown maker', name: 'Canvas high-top', variantName: 'Red', colors: ['red'] }, identity: makeIdentity(), details: { size: { value: '9.5', system: 'US-M' } }, photos: { originalId: null }, display: 'original', createdAt: new Date(now).toISOString() }, { now }),
];

const wish = wishlistView(catalog, {
  id: 'wish_1',
  userId: user,
  status: 'active',
  category: 'sneaker',
  productId: 'kestrel-runner-2',
  variantId: 'kestrel-runner-2--olive-bone',
  custom: null,
  identity: catalogIdentity({ userId: user, now, variantId: 'kestrel-runner-2--olive-bone' }),
  reason: 'like_style',
  intent: 'inspiration',
  desired: { size: { value: '10', system: 'US-M' }, condition: 'new_only', variantFlexible: true },
  targetPriceMinor: 15000,
  currency: 'USD',
  photos: { originalId: null },
}, { now });

const recVariant = catalog.variant('kestrel-runner-2--olive-bone');
const recItem = {
  key: 'r1',
  productId: 'kestrel-runner-2',
  variantId: recVariant.id,
  kind: 'complementary',
  product: productSummary(catalog, catalog.product('kestrel-runner-2')),
  variant: variantView(catalog, recVariant, { now }),
  related: [
    { itemId: 'own_harbor-pine-deck-jacket--navy', itemType: 'owned', title: 'Deck Field Jacket', brandName: 'Harbor & Pine', imageUrl: tiles[1].image.url, relation: 'color_pairing', detail: 'Olive and navy are a classic pairing.' },
    { itemId: 'own_fieldhouse-wool-trouser--grey', itemType: 'owned', title: 'Wool Trouser', brandName: 'Fieldhouse', imageUrl: tiles[2].image.url, relation: 'color_pairing', detail: 'Olive sits well with mid grey.' },
  ],
  explanation: 'Olive and navy are a classic pairing, so this would sit well with your Harbor & Pine Deck Field Jacket and Fieldhouse Wool Trouser.',
  price: { status: 'known', fromMinor: 12400, currency: 'USD', offerCount: 2, checkedAt: new Date(now - 4 * 3600000).toISOString(), retailerName: 'Courtside Goods' },
  availability: 'in_stock_in_size',
  size: { value: '10', system: 'US-M' },
  flags: { owned: false, onWishlist: true },
};

const retailer = (id) => {
  const r = catalog.retailer(id);
  return { id: r.id, name: r.name, domain: r.domain, kind: r.kind };
};
const offerRows = [
  { offerId: 'o1', retailer: retailer('courtside'), affiliate: false, sellerType: 'retailer', condition: 'new', includedComponents: null, size: { value: '10', system: 'US-M' }, stock: 'in_stock', priceMinor: 12400, currency: 'USD', shipping: { kind: 'flat', amountMinor: 700 }, fees: { kind: 'none' }, tax: { kind: 'unknown' }, totalKnownMinor: 13100, totalComplete: false, missing: ['tax'], delivery: { minDays: 2, maxDays: 4 }, returns: 'Returns within 14 days, buyer pays return shipping', warranty: { kind: 'unknown' }, lastCheckedAt: new Date(now - 4 * 3600000).toISOString(), freshness: 'fresh', listingStatus: 'active', url: 'https://courtside.example/shop/8120-KR2304' },
  { offerId: 'o2', retailer: retailer('northline'), affiliate: true, sellerType: 'retailer', condition: 'new', includedComponents: null, size: { value: '10', system: 'US-M' }, stock: 'low_stock', priceMinor: 13000, currency: 'USD', shipping: { kind: 'free' }, fees: { kind: 'none' }, tax: { kind: 'unknown' }, totalKnownMinor: 13000, totalComplete: false, missing: ['tax'], delivery: { minDays: 3, maxDays: 5 }, returns: 'Free returns within 30 days', warranty: { kind: 'unknown' }, lastCheckedAt: new Date(now - 2 * 3600000).toISOString(), freshness: 'fresh', listingStatus: 'active', url: 'https://northline.example/p/NL-50877' },
  { offerId: 'o3', retailer: retailer('hourhand'), affiliate: false, sellerType: 'private_seller', condition: 'used_fair', includedComponents: [], size: null, stock: 'in_stock', priceMinor: 31000, currency: 'USD', shipping: { kind: 'calculated_at_checkout' }, fees: { kind: 'unknown' }, tax: { kind: 'unknown' }, totalKnownMinor: null, totalComplete: false, missing: ['shipping', 'fees', 'tax'], delivery: null, returns: null, warranty: { kind: 'none' }, lastCheckedAt: new Date(now - 52 * 3600000).toISOString(), freshness: 'stale', listingStatus: 'active', url: 'https://hourhand.example/l/55380' },
];

const sections = [
  ['Buttons and chips', html`<div class="demo-row">
    <button class="btn btn-primary">Save to collection</button>
    <button class="btn btn-secondary">${icon('camera')}Take a photo</button>
    <button class="btn btn-accent">${icon('heart')}Save to wishlist</button>
    <button class="btn btn-ghost">Cancel</button>
    <button class="btn btn-danger">Delete item</button>
    <button class="btn btn-primary" aria-busy="true">Saving</button>
    <button class="btn btn-secondary btn-sm">Small</button>
    <button class="icon-btn" aria-label="More">${icon('more')}</button>
  </div>
  <div class="demo-row" style="margin-top:12px">
    <button class="chip" aria-pressed="true">All <span class="count">12</span></button>
    <button class="chip">Sneakers <span class="count">4</span></button>
    <button class="chip">Watches <span class="count">2</span></button>
    <span class="badge badge-owned">${icon('check')}Owned</span>
    <span class="badge badge-wish">${icon('heart')}Wishlist</span>
    <span class="badge badge-demo">Demo data</span>
    <span class="badge badge-affiliate">Affiliate</span>
    <span class="badge badge-ok">In stock in US M 10</span>
    <span class="badge badge-warn">Price may have changed</span>
    <span class="badge badge-human">${icon('stylist')}From your stylist</span>
  </div>
  <div style="margin-top:12px">${c.segmented({ name: 'img', options: [{ value: 'catalog', label: 'Catalog image' }, { value: 'original', label: 'Your photo' }], value: 'catalog', label: 'Image' })}</div>`],
  ['Collection tiles (owned)', html`<div class="tile-grid">${tiles.map((t) => c.itemTile(t, { state: 'owned', href: '#' }))}</div>`],
  ['Wishlist tile and product tile', html`<div class="tile-grid">${c.itemTile(wish, { state: 'wishlist', href: '#' })}${c.productTile({ product: recItem.product, variant: recItem.variant, href: '#', block: { top: 'From', main: '$124' } })}</div>`],
  ['Recommendation card', html`<div class="narrow" style="max-width:720px">${c.recCard(recItem, { actions: html`<button class="btn btn-secondary btn-sm">${icon('heart')}Save</button><a class="btn btn-secondary btn-sm" href="#">View offers</a><button class="btn btn-ghost btn-sm">Too expensive</button><button class="btn btn-ghost btn-sm">Not my style</button>` })}</div>`],
  ['Offers', html`<div class="stack narrow">${c.offerCard(offerRows[0], { lowest: true, now })}${c.offerCard(offerRows[1], { now })}${c.offerCard(offerRows[2], { now })}${c.affiliateDisclosure()}</div>`],
  ['Evidence and facts', html`<div class="stack narrow">
    ${c.evidenceList([{ kind: 'identifier', source: 'ocr', detail: 'Style code KR2-304 read from your label photo' }, { kind: 'color', source: 'image_features', detail: 'Main colors in your photo: olive, bone' }], [{ kind: 'color', detail: 'Your photo shows a darker sole than this version' }])}
    ${c.facts([['Case diameter', '38 mm'], ['Lug width', '20 mm'], ['Movement', 'Automatic'], ['Thickness', null]], { showUnknown: true })}
    ${c.swatches([{ name: 'olive' }, { name: 'bone' }, { name: 'tan' }])}
  </div>`],
  ['Notices and states', html`<div class="stack narrow">
    ${c.notice({ tone: 'info', title: 'These versions look the same in photos', body: 'Add the reference from the case back to be sure.' })}
    ${c.notice({ tone: 'warn', body: 'Prices checked over a day ago may have changed.' })}
    ${c.notice({ tone: 'danger', title: 'Matching took too long', body: 'Try again, or save it manually.' })}
    ${c.notice({ tone: 'ok', body: 'Saved to your collection.' })}
    ${c.demoNote()}
    ${c.emptyState({ title: 'Your collection is empty', body: 'Photograph something you own, or add it from the catalog.', actions: html`<a class="btn btn-primary" href="#">${icon('plus')}Add your first item</a>` })}
    ${c.errorState({ code: 'not_found' })}
  </div>`],
  ['Forms', html`<form class="stack narrow" onsubmit="return false">
    ${c.field({ label: 'Brand', name: 'brand', required: true })}
    ${ownedDetailsFields({ category: 'watch', type: 'field', values: { condition: 'good' } })}
    ${wishFields({ category: 'sneaker', type: 'runner', usual: { value: '10', system: 'US-M' }, values: { reason: 'like_style', targetPriceMinor: 15000 } })}
    ${c.chipGroup({ name: 'styles', legend: 'Styles you like', options: [{ value: 'minimal', label: 'Minimal' }, { value: 'classic', label: 'Classic' }, { value: 'street', label: 'Streetwear' }], selected: ['minimal'] })}
    <label class="switch"><span>Include my photos</span><input type="checkbox" checked></label>
    <label class="check"><input type="checkbox"> Show archived</label>
  </form>`],
  ['Progress and lists', html`<div class="stack narrow">
    <ol class="steps"><li class="is-done"><span class="step-dot">${icon('check')}</span>Checking your photo</li><li class="is-active"><span class="step-dot"></span>Searching the catalog</li><li><span class="step-dot"></span>Comparing versions</li></ol>
    <div class="progress"><span style="width:60%"></span></div>
    <ul class="list"><li><a class="list-item" href="#">${icon('sliders')}<span class="grow"><span>Preferences</span><span>Sizes, style, colors and budgets</span></span>${icon('chevron-right')}</a></li><li><a class="list-item" href="#">${icon('shield')}<span class="grow"><span>Privacy and data</span><span>Export or delete everything</span></span>${icon('chevron-right')}</a></li></ul>
    <div class="tabs" role="tablist"><button role="tab" aria-selected="true">Overview</button><button role="tab">Catalog</button><button role="tab">Offers</button></div>
  </div>`],
];

render(
  document.getElementById('gallery'),
  html`${c.screenHead({ title: 'Components', lede: 'Shared components with demo data.' })}${sections.map(([title, body]) => html`<section><h2>${title}</h2>${body}</section>`)}`,
);
document.documentElement.dataset.ready = 'true';
