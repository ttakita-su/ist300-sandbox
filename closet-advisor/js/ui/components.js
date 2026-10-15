// Shared view components. Screens compose these so tiles, labels, stamps, offers and states look
// and read the same everywhere. All return SafeHtml.
import { html, raw, safeUrl, cx } from '../lib/html.js';
import { icon, categoryIcon } from '../lib/icons.js';
import * as fmt from '../lib/format.js';
import { colorHex, colorLabel } from '../data/colors.js';
import { CATEGORY_SINGULAR, OFFER_CONDITION_LABEL, SELLER_TYPE_LABEL } from '../data/schema.js';

// ---------- Images ----------

/**
 * Product image on the studio tile. Photos render with data-photo-id and are hydrated after
 * render with an expiring URL; catalog images carry a "Catalog image" tag.
 * @param {any} image DisplayImage or variant image { url, label }
 * @param {{ alt: string, category?: string, tag?: boolean, wide?: boolean, className?: string }} opts
 */
export function media(image, opts) {
  const kind = image?.kind ?? (image?.url ? 'catalog' : 'placeholder');
  const isPhoto = kind === 'original' || kind === 'cleaned';
  const showTag = opts.tag !== false && image?.label;
  let inner;
  if (isPhoto && image.photoId) {
    inner = html`<img data-photo-id="${image.photoId}" alt="${opts.alt}" decoding="async">`;
  } else if (image?.url) {
    inner = html`<img src="${safeUrl(image.url)}" alt="${opts.alt}" decoding="async" loading="lazy">`;
  } else {
    inner = html`<div class="media-placeholder" role="img" aria-label="${opts.alt}">${categoryIcon(opts.category)}</div>`;
  }
  return html`<div class="${cx('media', isPhoto && 'is-photo', opts.wide && 'media-wide', opts.className)}">
    ${inner}${showTag ? html`<span class="media-tag">${image.label}</span>` : ''}
  </div>`;
}

/** Small square thumbnail for lists and related-item chips. */
export function thumb(image, alt, category) {
  const isPhoto = image?.kind === 'original' || image?.kind === 'cleaned';
  if (isPhoto && image.photoId) return html`<img data-photo-id="${image.photoId}" alt="${alt}">`;
  if (image?.url) return html`<img src="${safeUrl(image.url)}" alt="${alt}" loading="lazy">`;
  return html`<span class="media-placeholder" role="img" aria-label="${alt}">${categoryIcon(category)}</span>`;
}

// ---------- Identity stamps ----------

const VARIANT_WORD = { sneaker: 'Colorway', clothing: 'Color', watch: 'Reference' };

/**
 * Stamps that say how an item's identity was established. A person's own confirmation is
 * labeled as theirs, never as verification.
 */
export function identityStamps(identity, category) {
  if (!identity) return '';
  const stamps = [];
  if (identity.resolution === 'identifier_supported') {
    stamps.push(html`<span class="stamp stamp-code" title="A style code or reference you provided matches this version">${icon('check')}Code matches</span>`);
  } else if (identity.resolution === 'user_confirmed') {
    stamps.push(html`<span class="stamp stamp-confirmed" title="You chose this match">Confirmed by you</span>`);
  } else if (identity.resolution === 'manual') {
    stamps.push(html`<span class="stamp stamp-custom" title="Saved without a catalog match">Custom item</span>`);
  } else if (identity.resolution === 'unconfirmed') {
    stamps.push(html`<span class="stamp stamp-unsure">Not confirmed</span>`);
  }
  if (identity.variant === 'incomplete') {
    stamps.push(html`<span class="stamp stamp-unsure">${VARIANT_WORD[category] ?? 'Version'} unsure</span>`);
  } else if (identity.variant === 'conflicting') {
    stamps.push(html`<span class="stamp stamp-review" title="Evidence points to a different version">Needs review</span>`);
  }
  return stamps;
}

// ---------- Label strip ----------

/**
 * The shoebox-style label under every product image.
 * @param {{ brand?: string, name: string, variant?: string|null, code?: string|null,
 *   block?: { top?: string, main: string }|null, state?: 'owned'|'wishlist'|'suggestion',
 *   stamps?: any, archived?: boolean }} data
 */
export function label(data) {
  const state = data.state ?? 'suggestion';
  const block = data.block;
  const main = block?.main ?? '';
  return html`<div class="${cx('label', state === 'wishlist' && 'is-wishlist', state === 'suggestion' && 'is-suggestion', data.archived && 'is-archived')}">
    <div class="label-text">
      ${data.brand ? html`<span class="label-brand">${data.brand}</span>` : ''}
      <span class="label-name">${data.name}</span>
      ${data.variant ? html`<span class="label-variant">${data.variant}</span>` : ''}
      ${data.code ? html`<span class="label-code">${data.code}</span>` : ''}
      ${data.stamps && data.stamps.length ? html`<span class="label-stamps">${data.stamps}</span>` : ''}
    </div>
    ${block
      ? html`<div class="${cx('label-block', !main && 'is-empty')}">
          ${block.top ? html`<span class="label-block-top">${block.top}</span>` : ''}
          <span class="${cx('label-block-main', String(main).length > 4 && 'is-long')}">${main || '–'}</span>
        </div>`
      : ''}
  </div>`;
}

/** Label block for an owned item: size, or copy count when there is no size. */
export function ownedBlock(view) {
  const parts = fmt.sizeParts(view.details?.size);
  if (parts) return parts;
  if (view.copies > 1) return { top: 'Copies', main: `×${view.copies}` };
  if (view.category === 'watch' && view.variant?.attributes?.diameterMm) return { top: 'Case', main: `${view.variant.attributes.diameterMm}` };
  return null;
}

/** Label block for a wishlist item: target price if set. */
export function wishBlock(view) {
  if (view.targetPriceMinor != null) return { top: 'Target', main: fmt.money(view.targetPriceMinor, view.currency) };
  const parts = fmt.sizeParts(view.desired?.size);
  return parts ?? null;
}

/**
 * A product tile for an owned or wishlist view.
 * @param {any} view OwnedView or WishlistView
 * @param {{ state: 'owned'|'wishlist', href: string }} opts
 */
export function itemTile(view, opts) {
  const alt = `${view.brandName} ${view.title}${view.subtitle ? `, ${view.subtitle}` : ''}`;
  const block = opts.state === 'owned' ? ownedBlock(view) : wishBlock(view);
  return html`<article class="tile">
    <a class="tile-link" href="${opts.href}">
      ${media(view.image, { alt, category: view.category })}
      ${label({
        brand: view.brandName,
        name: view.title,
        variant: view.subtitle,
        code: view.code,
        block,
        state: opts.state,
        stamps: identityStamps(view.identity, view.category),
        archived: Boolean(view.archivedAt),
      })}
    </a>
  </article>`;
}

/** A catalog product tile (search results, stylist picks). */
export function productTile({ product, variant, href, block, kindTag }) {
  const alt = `${product.brand?.name ?? ''} ${product.name}, ${variant?.name ?? ''}`.trim();
  return html`<article class="tile">
    <a class="tile-link" href="${href}">
      ${media(variant?.image ?? null, { alt, category: product.category })}
      ${label({ brand: product.brand?.name, name: product.name, variant: variant?.name, code: variant?.code, block, state: 'suggestion' })}
    </a>
    ${kindTag ?? ''}
  </article>`;
}

// ---------- Recommendations ----------

const KIND_COPY = {
  similar: { icon: 'layers', text: 'Similar' },
  complementary: { icon: 'sparkle', text: 'Goes with what you own' },
  wishlist_alternative: { icon: 'swap', text: 'Wishlist alternative' },
  potential_duplicate: { icon: 'copy', text: 'Close to something you own' },
  stylist: { icon: 'stylist', text: 'From your stylist' },
};

export function kindTag(kind) {
  const k = KIND_COPY[kind] ?? KIND_COPY.similar;
  return html`<span class="kind-tag">${icon(k.icon)}${k.text}</span>`;
}

/** Chips naming the specific owned or wishlist items a result relates to. */
export function relatedChips(related = []) {
  if (!related.length) return '';
  return html`<div class="rec-related">${related.map(
    (r) => html`<a class="related-chip" href="#/${r.itemType === 'wishlist' ? 'wishlist' : 'collection'}/${encodeURIComponent(r.itemId)}" title="${r.detail ?? ''}">
      ${r.imageUrl ? html`<img src="${safeUrl(r.imageUrl)}" alt="">` : r.photoId ? html`<img data-photo-id="${r.photoId}" alt="">` : html`<span class="dot"></span>`}
      <span>${r.title}</span>
    </a>`,
  )}</div>`;
}

/** Price line for a recommendation, with source freshness. Unknown stays unknown. */
export function priceLine(price) {
  if (!price || price.status === 'unknown' || price.fromMinor == null) {
    return html`<p class="rec-price">Price unknown at the retailers we check</p>`;
  }
  const from = html`<strong>${fmt.money(price.fromMinor, price.currency)}</strong>`;
  const where = price.offerCount > 1 ? `from ${price.offerCount} offers` : price.retailerName ? `at ${price.retailerName}` : '';
  if (price.status === 'stale') {
    return html`<p class="rec-price">${from} ${where}, checked ${fmt.relative(price.checkedAt)}; may have changed</p>`;
  }
  return html`<p class="rec-price">${from} ${where}, checked ${fmt.relative(price.checkedAt)}</p>`;
}

const AVAILABILITY_COPY = {
  in_stock_in_size: (size) => `In stock in ${fmt.size(size) ?? 'your size'}`,
  in_stock: () => 'In stock',
  size_unavailable: (size) => `Not in stock in ${fmt.size(size) ?? 'your size'}`,
  out_of_stock: () => 'Out of stock everywhere we check',
  no_offers: () => 'No retailer offers yet',
};

export function availabilityBadge(availability, size) {
  const text = (AVAILABILITY_COPY[availability] ?? AVAILABILITY_COPY.no_offers)(size);
  const tone = availability === 'in_stock_in_size' || availability === 'in_stock' ? 'badge-ok' : availability === 'no_offers' ? 'badge-muted' : 'badge-warn';
  return html`<span class="badge ${tone}">${text}</span>`;
}

/**
 * Recommendation card. `actions` is markup for the action row (screens decide which apply).
 * @param {any} item RecItem (ARCHITECTURE.md 6.1)
 */
export function recCard(item, { actions = '', headingLevel = 3 } = {}) {
  const alt = `${item.product.brand?.name ?? ''} ${item.product.name}, ${item.variant?.name ?? ''}`.trim();
  const href = `#/product/${encodeURIComponent(item.productId)}?variant=${encodeURIComponent(item.variantId)}`;
  const h = raw(`h${headingLevel}`);
  return html`<article class="rec" data-rec-key="${item.key}">
    <a href="${href}" tabindex="-1" aria-hidden="true">${media(item.variant?.image, { alt, category: item.product.category })}</a>
    <div class="rec-body">
      ${kindTag(item.kind)}
      <${h} class="visually-hidden">${alt}</${h}>
      <a class="tile-link" href="${href}">${label({ brand: item.product.brand?.name, name: item.product.name, variant: item.variant?.name, code: item.variant?.code, state: 'suggestion' })}</a>
      ${item.explanation ? html`<p class="rec-why">${item.explanation}</p>` : ''}
      ${relatedChips(item.related)}
      ${priceLine(item.price)}
      <div class="cluster">${availabilityBadge(item.availability, item.size)}${item.flags?.onWishlist ? html`<span class="badge badge-wish">${icon('heart')}On your wishlist</span>` : ''}</div>
    </div>
    ${actions ? html`<div class="rec-actions">${actions}</div>` : ''}
  </article>`;
}

// ---------- Offers ----------

function shippingText(shipping, currency) {
  switch (shipping?.kind) {
    case 'free':
      return html`Free`;
    case 'flat':
      return html`${fmt.money(shipping.amountMinor, currency)}`;
    case 'calculated_at_checkout':
      return html`<span class="unknown">Calculated at checkout</span>`;
    default:
      return html`<span class="unknown">Not listed</span>`;
  }
}

function feesText(fees, currency) {
  if (!fees || fees.kind === 'none') return html`None listed`;
  if (fees.kind === 'known') return html`${fmt.money(fees.amountMinor, currency)}${fees.label ? ` (${fees.label})` : ''}`;
  return html`<span class="unknown">Unknown</span>`;
}

function taxText(tax, currency) {
  if (tax?.kind === 'estimate' && tax.amountMinor != null) return html`About ${fmt.money(tax.amountMinor, currency)} (estimate)`;
  return html`<span class="unknown">Not estimated</span>`;
}

function warrantyText(w, note) {
  if (note) return html`<span class="unknown">${note}</span>`;
  if (!w || w.kind === 'unknown') return html`<span class="unknown">Not stated</span>`;
  if (w.kind === 'none') return html`None`;
  const who = w.kind === 'manufacturer' ? `Manufacturer${w.provider ? ` (${w.provider})` : ''}` : `Seller${w.provider ? ` (${w.provider})` : ''}`;
  return html`${who}${w.months ? `, ${w.months} months` : ''}`;
}

/** "Total $131", "$131 before tax", or "Total unknown" when shipping or fees are missing. */
function totalText(row) {
  // The offers engine names what the sum covers ('Total before tax', ...); prefer its label.
  if (row.totalLabel && row.totalKnownMinor != null) return html`${row.totalLabel} ${fmt.money(row.totalKnownMinor, row.currency)}`;
  if (row.totalComplete && row.totalKnownMinor != null) return html`Total ${fmt.money(row.totalKnownMinor, row.currency)}`;
  const onlyTax = row.missing?.length === 1 && row.missing[0] === 'tax';
  if (onlyTax && row.totalKnownMinor != null) return html`${fmt.money(row.totalKnownMinor, row.currency)} before tax`;
  return html`Total unknown`;
}

/**
 * One offer. `row` is an OfferRow (ARCHITECTURE.md 6.1). The Visit action goes through the
 * in-app redirect (#/go/:offerId) so the click is recorded and disclosed.
 * @param {{ lowest?: boolean, lowestLabel?: string, now?: number }} [opts] lowestLabel comes from OffersView.lowest.label
 */
export function offerCard(row, { lowest = false, lowestLabel, now = Date.now() } = {}) {
  const stale = row.freshness === 'stale';
  const unavailable = row.listingStatus !== 'active' || row.stock === 'out_of_stock';
  const components = row.includedComponents;
  const lowestBadge = /before tax/i.test(lowestLabel ?? '') ? 'Lowest before tax' : 'Lowest known total';
  return html`<article class="${cx('offer', lowest && 'is-lowest', stale && 'is-stale', unavailable && 'is-unavailable')}" data-offer-id="${row.offerId}">
    <div class="offer-head">
      <div class="stack stack-xs">
        <span class="offer-retailer">${row.retailer.name}</span>
        <span class="cluster">
          <span class="badge badge-muted">${OFFER_CONDITION_LABEL[row.condition] ?? fmt.humanize(row.condition)}</span>
          <span class="badge badge-muted">${SELLER_TYPE_LABEL[row.sellerType] ?? fmt.humanize(row.sellerType)}</span>
          ${row.affiliate ? html`<span class="badge badge-affiliate" title="We may earn a commission if you buy through this link">Affiliate</span>` : ''}
          ${lowest ? html`<span class="badge badge-owned" title="${lowestLabel ?? ''}">${icon('check')}${lowestBadge}</span>` : ''}
        </span>
      </div>
      <div>
        <div class="offer-price">${unavailable && row.listingStatus !== 'active' ? 'Unavailable' : fmt.money(row.priceMinor, row.currency)}</div>
        <div class="offer-total">${totalText(row)}</div>
      </div>
    </div>
    <dl class="offer-lines">
      ${row.size ? html`<dt>Size</dt><dd>${fmt.size(row.size)}${row.stock === 'low_stock' ? ', low stock' : row.stock === 'out_of_stock' ? ', out of stock' : ''}</dd>` : ''}
      ${row.stock == null ? html`<dt>Stock</dt><dd><span class="unknown">Not stated</span></dd>` : ''}
      <dt>Shipping</dt><dd>${shippingText(row.shipping, row.currency)}</dd>
      <dt>Fees</dt><dd>${feesText(row.fees, row.currency)}</dd>
      <dt>Tax</dt><dd>${taxText(row.tax, row.currency)}</dd>
      ${row.delivery ? html`<dt>Delivery</dt><dd>${row.delivery.minDays}–${row.delivery.maxDays} days</dd>` : html`<dt>Delivery</dt><dd><span class="unknown">Not stated</span></dd>`}
      <dt>Returns</dt><dd>${row.returns ?? html`<span class="unknown">Not stated</span>`}</dd>
      <dt>Warranty</dt><dd>${warrantyText(row.warranty, row.warrantyNote)}</dd>
      ${components ? html`<dt>Includes</dt><dd>${components.length ? fmt.listJoin(components) : 'Watch only'}</dd>` : ''}
      <dt>Checked</dt><dd>${fmt.relative(row.lastCheckedAt, now)}${stale ? html` <span class="unknown">(price may have changed)</span>` : ''}</dd>
    </dl>
    ${row.missing?.length ? html`<p class="small muted">Not included in the total: ${fmt.listJoin(row.missing.map((m) => (m === 'tax' ? 'tax' : m)))}.</p>` : ''}
    ${row.listingStatus === 'active'
      ? html`<a class="btn btn-primary btn-block" href="#/go/${encodeURIComponent(row.offerId)}">Visit ${row.retailer.name}${icon('external')}</a>`
      : html`<p class="small muted">${row.reason ?? 'This listing is no longer available.'}</p>`}
    ${row.listingStatus === 'active' && unavailable && row.reason ? html`<p class="small muted">${row.reason}</p>` : ''}
  </article>`;
}

/** Disclosure shown next to every set of buying options. */
export function affiliateDisclosure(text) {
  return html`<p class="disclosure">${text ?? 'Rotation may earn a commission when you buy through links marked Affiliate. It does not change the price you pay, and offers are ordered by known total, not by commission.'}</p>`;
}

// ---------- Matching evidence ----------

/** Evidence and conflicts for a match candidate or a saved item's provenance. */
export function evidenceList(evidence = [], conflicts = []) {
  if (!evidence.length && !conflicts.length) return '';
  return html`<ul class="evidence">
    ${evidence.map((e) => html`<li class="is-support">${icon('check')}<span>${e.detail}${e.source === 'user_entered' ? html` <span class="muted">(you entered this)</span>` : e.source === 'ocr' ? html` <span class="muted">(read from your label photo)</span>` : ''}</span></li>`)}
    ${conflicts.map((c) => html`<li class="is-conflict">${icon('warning')}<span>${c.detail}</span></li>`)}
  </ul>`;
}

// ---------- Facts ----------

/**
 * Definition list of facts. Rows with null values say "Not sourced" rather than disappearing,
 * when `showUnknown` is set.
 * @param {Array<[string, any]>} rows
 */
export function facts(rows, { showUnknown = false } = {}) {
  const visible = rows.filter(([, v]) => showUnknown || (v != null && v !== ''));
  if (!visible.length) return '';
  return html`<dl class="facts">${visible.map(
    ([k, v]) => html`<dt>${k}</dt><dd>${v == null || v === '' ? html`<span class="unknown">Not sourced</span>` : v}</dd>`,
  )}</dl>`;
}

export function swatches(colors = []) {
  return html`<span class="cluster" style="--gap: 6px">${colors.map(
    (c) => html`<span class="row" style="--gap: 4px"><span class="swatch" style="background:${colorHex(c.name ?? c)}"></span><span class="small">${colorLabel(c.name ?? c)}</span></span>`,
  )}</span>`;
}

// ---------- Page structure ----------

export function screenHead({ title, lede, actions }) {
  return html`<header class="screen-head">
    <div><h1>${title}</h1>${lede ? html`<p class="lede">${lede}</p>` : ''}</div>
    ${actions ?? ''}
  </header>`;
}

export function backHead({ title, back = '#/discover', actions }) {
  return html`<header class="back-head">
    <a class="icon-btn" href="${back}" data-back aria-label="Back">${icon('chevron-left')}</a>
    <h1>${title}</h1>
    ${actions ?? ''}
  </header>`;
}

export function notice({ tone = 'info', title, body, iconName }) {
  const name = iconName ?? (tone === 'warn' ? 'warning' : tone === 'danger' ? 'warning' : tone === 'ok' ? 'check' : 'info');
  return html`<div class="notice notice-${tone}" role="${tone === 'danger' ? 'alert' : 'note'}">
    ${icon(name)}
    <div class="stack stack-xs">${title ? html`<strong>${title}</strong>` : ''}${body ? html`<span>${body}</span>` : ''}</div>
  </div>`;
}

export function demoNote(text = 'Demo catalog: fictional brands, retailers and prices.') {
  return html`<p class="demo-note">${icon('info')}${text}</p>`;
}

export function emptyState({ iconName = 'hanger', title, body, actions }) {
  return html`<section class="state">
    <span class="state-icon">${icon(iconName)}</span>
    <h2>${title}</h2>
    ${body ? html`<p>${body}</p>` : ''}
    ${actions ? html`<div class="button-row">${actions}</div>` : ''}
  </section>`;
}

const ERROR_COPY = {
  not_found: ['Not found', "This item doesn't exist or isn't shared with you."],
  forbidden: ['Not available to your account', "Your account can't open this page."],
  unavailable: ['Something went wrong', 'Try again in a moment.'],
  timeout: ['That took too long', 'Try again. If it keeps happening, check your connection.'],
  rate_limited: ['Slow down a little', null],
  not_implemented: ['Not built yet', 'This part of the prototype is still being put together.'],
};

export function errorState(error, { retry = true } = {}) {
  const [title, body] = ERROR_COPY[error?.code] ?? ['Something went wrong', null];
  return html`<section class="state state-danger" role="alert">
    <span class="state-icon">${icon('warning')}</span>
    <h2>${title}</h2>
    <p>${body ?? error?.message ?? 'Try again.'}</p>
    ${retry ? html`<div class="button-row"><button type="button" class="btn btn-secondary" data-router-retry>${icon('refresh')}Try again</button></div>` : ''}
  </section>`;
}

export function loadingState({ tiles = 6 } = {}) {
  return html`<div class="stack" aria-busy="true" aria-label="Loading">
    <div class="skeleton-line" style="width: 40%; height: 28px"></div>
    <div class="tile-grid">${Array.from({ length: tiles }, () => html`<div class="stack stack-sm"><div class="skeleton" style="aspect-ratio:1"></div><div class="skeleton-line" style="width:70%"></div></div>`)}</div>
  </div>`;
}

// ---------- Form controls ----------

/**
 * Text-like field. `attrs` is trusted markup for extra attributes (min, step, inputmode...).
 */
export function field({ label: text, name, type = 'text', value = '', hint, required, optional, placeholder, attrs = '', id }) {
  const fid = id ?? `f-${name.replace(/[^a-zA-Z0-9]/g, '-')}`;
  return html`<div class="field">
    <label class="field-label" for="${fid}">${text}${optional ? html` <span class="optional">(optional)</span>` : ''}</label>
    ${type === 'textarea'
      ? html`<textarea class="textarea" id="${fid}" name="${name}" placeholder="${placeholder ?? ''}" ${required ? raw('required') : ''} ${raw(attrs)}>${value ?? ''}</textarea>`
      : html`<input class="input" id="${fid}" name="${name}" type="${type}" value="${value ?? ''}" placeholder="${placeholder ?? ''}" ${required ? raw('required') : ''} ${raw(attrs)}>`}
    ${hint ? html`<p class="field-hint">${hint}</p>` : ''}
  </div>`;
}

/** @param {{ options: Array<{ value: string, label: string }> }} opts */
export function selectField({ label: text, name, options, value, hint, optional, id, placeholder }) {
  const fid = id ?? `f-${name.replace(/[^a-zA-Z0-9]/g, '-')}`;
  return html`<div class="field">
    <label class="field-label" for="${fid}">${text}${optional ? html` <span class="optional">(optional)</span>` : ''}</label>
    <select class="select" id="${fid}" name="${name}">
      ${placeholder != null ? html`<option value="">${placeholder}</option>` : ''}
      ${options.map((o) => html`<option value="${o.value}" ${String(o.value) === String(value ?? '') ? raw('selected') : ''}>${o.label}</option>`)}
    </select>
    ${hint ? html`<p class="field-hint">${hint}</p>` : ''}
  </div>`;
}

/**
 * Chip-style checkboxes (multiple) or radios (single).
 * @param {{ name: string, options: Array<{ value: string, label: string }>, selected: string[]|string, multiple?: boolean, legend?: string }} opts
 */
export function chipGroup({ name, options, selected, multiple = true, legend }) {
  const chosen = new Set(Array.isArray(selected) ? selected : selected != null ? [selected] : []);
  return html`<fieldset class="stack stack-sm">
    ${legend ? html`<legend class="field-label">${legend}</legend>` : ''}
    <div class="cluster">${options.map(
      (o) => html`<label style="position:relative">
        <input class="visually-hidden" type="${multiple ? 'checkbox' : 'radio'}" name="${name}" value="${o.value}" ${chosen.has(o.value) ? raw('checked') : ''}>
        <span class="chip">${o.label}</span>
      </label>`,
    )}</div>
  </fieldset>`;
}

export function segmented({ name, options, value, label: text }) {
  return html`<div class="segmented" role="radiogroup" aria-label="${text ?? name}">${options.map(
    (o) => html`<label><input type="radio" name="${name}" value="${o.value}" ${String(o.value) === String(value) ? raw('checked') : ''}>${o.label}</label>`,
  )}</div>`;
}

export function categoryLabel(category) {
  return CATEGORY_SINGULAR[category] ?? 'Item';
}
