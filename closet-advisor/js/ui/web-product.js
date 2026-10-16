// Real products found online through Rotation's local server (backend/, `npm start`): the store
// listing and store page lists, the form that saves one as the person's own item, and the
// "Seen at" line on item details. Everything a store page or Bing said is untrusted: its text
// goes through `html` (escaped) and every link and image through safeUrl(). Store images are
// hot-linked only in result lists and previews, lazily and without a referrer; a saved item shows
// the copy kept on this device (photo kind 'web'), hydrated like the person's own photos.
import { html, raw, render, safeUrl } from '../lib/html.js';
import { icon, categoryIcon } from '../lib/icons.js';
import * as fmt from '../lib/format.js';
import { CATEGORIES, CATEGORY_SINGULAR, PRODUCT_TYPES, TYPE_LABEL } from '../data/schema.js';
import { PICKABLE_COLORS, colorLabel } from '../data/colors.js';
import { guessType } from '../engine/web-guess.js';
import { field, selectField, chipGroup, notice } from './components.js';
import {
  ownedDetailsFields,
  readOwnedDetails,
  wishFields,
  readWish,
  bindWishFields,
  bindUsualSize,
  profileSizeFor,
  createWithDuplicateCheck,
} from './item-forms.js';
import { hydratePhotos } from './hydrate.js';
import { openSheet, toast, toastError, withBusy, showFieldErrors } from '../lib/ui.js';

/** Shown after saving when the store's image was asked for but couldn't be kept. */
export const IMAGE_NOT_KEPT = "The store's image couldn't be kept, so the item was saved without it.";

// What a store page said about stock, as read; never an offer Rotation checked.
const AVAILABILITY = {
  in_stock: ['In stock', 'badge-ok'],
  limited: ['Limited stock', 'badge-warn'],
  preorder: ['Preorder', 'badge-muted'],
  backorder: ['Backordered', 'badge-warn'],
  out_of_stock: ['Out of stock', 'badge-warn'],
  discontinued: ['Discontinued', 'badge-warn'],
};

const PROBLEM_TITLE = {
  blocked: "This store can't be read",
  not_product: "That isn't a single product",
  unavailable: "The store page couldn't be read",
  not_connected: 'Real store lookups are off',
  invalid_url: "That link can't be used",
};

const isHttp = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

// ---------- Prices and snapshot lines ----------

/**
 * A price as the store showed it: "$115" from { amountMinor, currency }, else the listing's own
 * text ("£49.99"), else null. Unknown stays unknown.
 * @param {{ amountMinor: number, currency: string } | null} price
 * @param {string|null} [priceText]
 */
export function webPriceText(price, priceText = null) {
  if (price && Number.isInteger(price.amountMinor) && typeof price.currency === 'string') {
    try {
      return fmt.money(price.amountMinor, price.currency);
    } catch {
      // A code Intl can't format: fall back to the store's own text.
    }
  }
  return priceText || null;
}

/** The store's own name, else its host. */
export function webSite(web) {
  return web?.siteName || web?.host || 'the store';
}

// A Bing Shopping listing's link is Bing's page, but its seller is the store people know.
const isBing = (web) => /(^|\.)bing\.com$/.test(web?.host ?? '');

function sourceLabel(web) {
  if (!web.host) return webSite(web);
  return isBing(web) && web.siteName ? `${web.siteName} via Bing Shopping` : web.host;
}

/**
 * "Seen at Nike for $115" and "checked 2 hours ago", from a WebSnapshot.
 * @returns {{ seen: string, checked: string }}
 */
export function seenParts(web, { priceText = null, now = Date.now() } = {}) {
  const price = webPriceText(web?.price ?? null, priceText);
  return { seen: `Seen at ${webSite(web)}${price ? ` for ${price}` : ''}`, checked: `checked ${fmt.relative(web?.fetchedAt, now)}` };
}

// ---------- Images ----------

/** A store image hot-linked from its site: lazy, no referrer, with a placeholder behind it. */
function remoteImage(url, { alt = '', category = null } = {}) {
  return html`<span class="web-img">${category ? categoryIcon(category) : icon('image')}${isHttp(url)
    ? html`<img src="${safeUrl(url)}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-remote-img>`
    : ''}</span>`;
}

/**
 * Hides store images that fail to load (gone, blocked, not an image) so the placeholder behind
 * them shows. Image errors don't bubble, so this listens in the capture phase.
 * @param {HTMLElement} root
 * @returns {() => void} cleanup
 */
export function bindRemoteImages(root) {
  const onError = (event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.hasAttribute('data-remote-img')) img.hidden = true;
  };
  root.addEventListener('error', onError, true);
  return () => root.removeEventListener('error', onError, true);
}

// ---------- Result lists ----------

// List thumbnails are decorative (alt=""): the row's title, right next to them, names the product.
function listingRow(listing) {
  const price = webPriceText(listing.price, listing.priceText);
  return html`<li><button type="button" class="list-item web-row" data-web-listing="${listing.id}">
    <span class="list-thumb web-thumb">${remoteImage(listing.imageUrl, { category: listing.draft?.category })}</span>
    <span class="grow">
      <span class="web-row-title">${listing.title}</span>
      <span class="web-row-meta">${price ? html`<span class="web-price">${price}</span>` : html`<span>No price shown</span>`}${listing.seller ? html`<span>${listing.seller}</span>` : ''}</span>
    </span>
    ${icon('chevron-right')}
  </button></li>`;
}

function resultRow(result) {
  return html`<li><button type="button" class="list-item web-row" data-web-result="${result.id}">
    <span class="list-thumb web-thumb">${icon('globe')}</span>
    <span class="grow">
      <span class="web-row-title">${result.title}</span>
      <span class="web-row-meta"><span class="web-host">${result.host}</span>${result.productPage ? html`<span class="badge badge-muted">Product page</span>` : ''}</span>
      ${result.snippet ? html`<span class="web-snippet">${result.snippet}</span>` : ''}
    </span>
    ${icon('chevron-right')}
  </button></li>`;
}

/**
 * Store listings (Bing Shopping: thumbnail, title, price, seller) and store pages (Bing web
 * results: title, host, snippet). Rows are buttons with data-web-listing / data-web-result ids.
 * @param {{ shopping?: any[], results?: any[] }} lists
 * @param {{ headingLevel?: 2|3, empty?: string }} [opts]
 */
export function webResultLists({ shopping = [], results = [] } = {}, { headingLevel = 2, empty } = {}) {
  if (!shopping.length && !results.length) {
    return html`<p class="muted">${empty ?? 'No store results. Try the brand and model, or a style code.'}</p>`;
  }
  const h = raw(headingLevel === 3 ? 'h3' : 'h2');
  return html`<div class="stack stack-lg web-lists">
    ${shopping.length
      ? html`<section class="stack stack-sm">
          <div class="web-list-head"><${h}>Store listings</${h}><p class="small muted">From Bing Shopping. Prices are what each listing showed; Rotation doesn't check them.</p></div>
          <ul class="list">${shopping.map(listingRow)}</ul>
        </section>`
      : ''}
    ${results.length
      ? html`<section class="stack stack-sm">
          <div class="web-list-head"><${h}>Store pages</${h}><p class="small muted">From Bing web search. Opening one reads the page for its details.</p></div>
          <ul class="list">${results.map(resultRow)}</ul>
        </section>`
      : ''}
  </div>`;
}

/** A status line while a store page is read or online stores are searched. */
export function webLoading(text) {
  return html`<div class="web-loading" role="status"><span class="web-spinner" aria-hidden="true"></span><span>${text}</span></div>`;
}

// ---------- The save form ----------

function storePreview(draft, { priceText }) {
  const web = draft.web ?? {};
  const title = web.title ?? draft.custom?.name ?? 'Untitled product';
  const { seen, checked } = seenParts(web, { priceText });
  const availability = AVAILABILITY[web.availability];
  const code = web.identifiers?.mpn ?? web.identifiers?.sku ?? null;
  return html`<div class="web-preview">
    <div class="media web-preview-img">${remoteImage(draft.imageUrl, { alt: `Store image: ${title}`, category: draft.category })}</div>
    <div class="stack stack-xs web-preview-text">
      <span class="small muted web-host">${sourceLabel(web)}</span>
      <strong class="web-row-title">${title}</strong>
      <span class="small">${seen}, ${checked}</span>
      ${availability || code
        ? html`<span class="cluster">${availability ? html`<span class="badge ${availability[1]}">${availability[0]}</span>` : ''}${code ? html`<span class="small code">${code}</span>` : ''}</span>`
        : ''}
    </div>
  </div>`;
}

function categoryChoice(selected) {
  return html`<fieldset class="field web-category" data-web-category>
    <legend class="field-label">What is it?</legend>
    <div class="cluster">${CATEGORIES.map(
      (c) => html`<label class="chip-choice">
        <input class="visually-hidden" type="radio" name="category" value="${c}" ${c === selected ? raw('checked') : ''}>
        <span class="chip">${CATEGORY_SINGULAR[c]}</span>
      </label>`,
    )}</div>
    ${selected ? '' : html`<p class="field-hint" data-category-hint>The store's words don't say, so choose one.</p>`}
  </fieldset>`;
}

function typeField(category, type) {
  const types = PRODUCT_TYPES[category] ?? [];
  if (!types.length) {
    return html`<div class="field">
      <label class="field-label" for="f-web-type">Type <span class="optional">(optional)</span></label>
      <select class="select" id="f-web-type" name="custom.type" disabled><option value="">Choose what it is first</option></select>
    </div>`;
  }
  return selectField({
    label: 'Type',
    name: 'custom.type',
    id: 'f-web-type',
    options: types.map((t) => ({ value: t, label: TYPE_LABEL[t] ?? fmt.humanize(t) })),
    value: types.includes(type) ? type : '',
    placeholder: 'Not sure',
    optional: true,
  });
}

function imageChoice(hasImage, photoFlow) {
  const hint = !hasImage
    ? "There's no store image to save with this one."
    : photoFlow
      ? "Your photo stays the item's photo; the store's image is kept on this device as another option."
      : "It's downloaded once through Rotation's local server and kept on this device.";
  return html`<div class="field">
    <label class="check"><input type="checkbox" name="saveImage" ${hasImage ? raw('checked') : raw('disabled')}> Save the store's image with it</label>
    <p class="field-hint">${hint}</p>
  </div>`;
}

/** The owned-details or wishlist questions; nothing in them is read from the page. */
function destFields({ dest, category, type, profile, ownedItems, values }) {
  const usual = category ? profileSizeFor(profile, category, type) : null;
  if (dest === 'wishlist') return wishFields({ category, type, usual, values: { reason: 'want_exact', ...(values ?? {}) }, ownedItems });
  return ownedDetailsFields({ category, type, usual, values });
}

/**
 * The form that saves a draft (engine/web-guess.js draftFromWeb: { category, custom, web,
 * imageUrl }) as the person's own item: what the store showed, then the guesses to check, the
 * destination's own questions and whether to keep the store's image. Nothing is chosen that the
 * words didn't say: without a category guess the person picks one, and the size starts empty.
 * @param {any} draft
 * @param {{ dest: 'owned'|'wishlist', profile?: any, ownedItems?: any[], photoFlow?: boolean,
 *   priceText?: string|null }} opts
 */
export function webSaveForm(draft, opts) {
  const { dest, profile = null, ownedItems = [], photoFlow = false, priceText = null } = opts;
  const category = CATEGORIES.includes(draft.category) ? draft.category : null;
  const custom = draft.custom ?? {};
  const type = category && (PRODUCT_TYPES[category] ?? []).includes(custom.type) ? custom.type : '';
  const guessed = custom.colors ?? [];
  // Metals (a steel case) aren't in the everyday picker, but a guessed one stays choosable.
  const colors = [...new Set([...guessed.filter((c) => !PICKABLE_COLORS.includes(c)), ...PICKABLE_COLORS])];
  const keepAs = dest === 'wishlist' ? 'not as your target price' : 'not as what you paid';
  return html`<form class="stack stack-lg web-save" data-web-save data-category="${category ?? ''}" novalidate>
    ${storePreview(draft, { priceText })}
    ${categoryChoice(category)}
    <div class="form-grid two">
      ${field({ label: 'Brand', name: 'custom.brand', id: 'f-web-brand', value: custom.brand ?? '', required: true, attrs: 'maxlength="120" autocomplete="off"', hint: custom.brand ? null : "The store didn't name the brand, so type it in." })}
      ${field({ label: 'Name', name: 'custom.name', id: 'f-web-name', value: custom.name ?? '', required: true, placeholder: 'Model or a short description', attrs: 'maxlength="120" autocomplete="off"' })}
      ${field({ label: 'Color or version', name: 'custom.variantName', id: 'f-web-variant', value: custom.variantName ?? '', optional: true, attrs: 'maxlength="120" autocomplete="off"' })}
      <div class="web-type" data-web-type>${typeField(category, type)}</div>
    </div>
    ${chipGroup({ legend: 'Main colors', name: 'colors', options: colors.map((c) => ({ value: c, label: colorLabel(c) })), selected: guessed })}
    ${imageChoice(isHttp(draft.imageUrl), photoFlow)}
    <div data-web-dest>${destFields({ dest, category, type, profile, ownedItems })}</div>
    <p class="small muted">Saved as your own item, not a catalog match. Rotation hasn't checked the store's details; size and condition are yours to fill in, and the store's price is kept as what you saw, ${keepAs}.</p>
    <button type="submit" class="btn btn-primary btn-block">${dest === 'wishlist' ? 'Save to wishlist' : 'Add to collection'}</button>
  </form>`;
}

/**
 * Reads a webSaveForm. `errors` (field name -> message) is set when something required is
 * missing, so nothing is downloaded or saved before the form is complete.
 * @returns {{ category: string, custom: { brand, name, variantName, type, colors }, saveImage: boolean,
 *   errors: Record<string, string>|null }}
 */
export function readWebSaveForm(form) {
  const val = (name) => form.elements[name]?.value?.trim() ?? '';
  const category = form.querySelector('input[name="category"]:checked')?.value ?? '';
  const custom = {
    brand: val('custom.brand'),
    name: val('custom.name'),
    variantName: val('custom.variantName'),
    type: form.elements['custom.type']?.disabled ? '' : val('custom.type'),
    colors: [...form.querySelectorAll('input[name="colors"]:checked')].map((el) => el.value),
  };
  const errors = {};
  if (!CATEGORIES.includes(category)) errors.category = 'Choose what it is';
  if (!custom.brand) errors['custom.brand'] = 'Enter the brand';
  if (!custom.name) errors['custom.name'] = 'Enter a name';
  const box = form.elements.saveImage;
  return { category, custom, saveImage: Boolean(box?.checked && !box.disabled), errors: Object.keys(errors).length ? errors : null };
}

const readDest = (form, dest) => (dest === 'wishlist' ? readWish(form) : readOwnedDetails(form, form.dataset.category));

function renderDest(form, opts) {
  const slot = form.querySelector('[data-web-dest]');
  render(slot, destFields(opts));
  hydratePhotos(slot);
}

/**
 * Wires a webSaveForm inside `container`: a category or clothing-type change redraws the
 * questions that depend on it (keeping what was typed), and submit checks the form, then calls
 * `save`. Errors from saving are shown on their fields, or as a toast.
 * @param {HTMLElement} container
 * @param {{ draft: any, dest: 'owned'|'wishlist', profile?: any, ownedItems?: any[],
 *   save: (args: { form: HTMLFormElement, draft: any, values: any }) => Promise<any> }} opts
 * @returns {() => void} cleanup
 */
export function bindWebSave(container, opts) {
  const offs = [bindWishFields(container), bindUsualSize(container)];
  const words = [opts.draft.web?.title, opts.draft.web?.query].filter(Boolean).join(' ');
  const onChange = (event) => {
    const form = event.target.closest?.('form[data-web-save]');
    if (!form || !container.contains(form)) return;
    if (event.target.name === 'category') {
      const values = readDest(form, opts.dest);
      const category = event.target.value;
      const type = guessType(category, words) ?? '';
      form.dataset.category = category;
      form.querySelector('[data-category-hint]')?.remove();
      form.querySelector('.field-error[data-for="category"]')?.remove();
      for (const radio of form.querySelectorAll('input[name="category"]')) radio.removeAttribute('aria-invalid');
      render(form.querySelector('[data-web-type]'), typeField(category, type));
      renderDest(form, { ...opts, category, type, values });
    } else if (event.target.name === 'custom.type' && form.dataset.category === 'clothing') {
      // Tops and trousers are sized differently.
      renderDest(form, { ...opts, category: 'clothing', type: event.target.value, values: readDest(form, opts.dest) });
    }
  };
  const onSubmit = async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-web-save]') || !container.contains(form)) return;
    event.preventDefault();
    const values = readWebSaveForm(form);
    if (values.errors) {
      showFieldErrors(form, { details: { fields: values.errors } });
      return;
    }
    await withBusy(form.querySelector('[type="submit"]'), async () => {
      try {
        await opts.save({ form, draft: opts.draft, values });
      } catch (error) {
        if (!showFieldErrors(form, error)) toastError(error);
      }
    });
  };
  container.addEventListener('change', onChange);
  container.addEventListener('submit', onSubmit);
  return () => {
    container.removeEventListener('change', onChange);
    container.removeEventListener('submit', onSubmit);
    offs.forEach((off) => off());
  };
}

// ---------- Saving ----------

/**
 * Keeps the store's image on this device (importWebImage, photo kind 'web').
 * @returns {Promise<string|null>} the photo id, or null when it couldn't be kept
 */
export async function keepStoreImage(api, draft, key) {
  if (!isHttp(draft.imageUrl)) return null;
  try {
    const out = await api.importWebImage({ imageUrl: draft.imageUrl, pageUrl: draft.web?.url, idempotencyKey: `${key}-img` });
    return out?.status === 'ok' ? out.photoId : null;
  } catch {
    // A rate limit or the like: the item is still saved, without the image.
    return null;
  }
}

/**
 * Saves a draft to the collection or the wishlist as a custom item from the web (source 'web',
 * never a catalog identity): the store's image first when asked, then createOwned or
 * createWishlist, asking about duplicates. A store image that can't be kept doesn't stop the save.
 * @param {any} api
 * @param {{ dest: 'owned'|'wishlist', draft: any, values: any, form: HTMLFormElement, key: string,
 *   navigate: (path: string) => void }} args key: one idempotency key per save form
 * @returns {Promise<any|null>} the item view, or null when the duplicate warning was dismissed
 */
export async function saveWebDraft(api, { dest, draft, values, form, key, navigate }) {
  const webId = values.saveImage ? await keepStoreImage(api, draft, key) : null;
  const base = { source: 'web', category: values.category, custom: values.custom, web: draft.web, ...(webId ? { photos: { webId } } : {}) };
  const item = await createWithDuplicateCheck(
    ({ allowDuplicate }) => {
      const idempotencyKey = allowDuplicate ? `${key}-dup` : key;
      return dest === 'wishlist'
        ? api.createWishlist({ ...base, ...readWish(form), allowDuplicate, idempotencyKey })
        : api.createOwned({ ...base, details: readOwnedDetails(form, values.category), allowDuplicate, idempotencyKey });
    },
    { dest, navigate },
  );
  if (item && values.saveImage && !webId) toast(IMAGE_NOT_KEPT);
  return item;
}

// ---------- When a page isn't a product ----------

/** "#/add/manual?..." filled in with whatever is known; empty values are left out. */
export function manualHref(dest, known = {}) {
  const params = new URLSearchParams({ dest });
  for (const key of ['category', 'brand', 'name', 'variantName', 'sourceUrl']) if (known[key]) params.set(key, known[key]);
  return `#/add/manual?${params}`;
}

/** What a lookup that found no product still knows: the page's own name and brand, and its link. */
function knownFrom(out, url) {
  const draft = out.draft;
  if (draft) {
    return { category: draft.category, brand: draft.custom?.brand, name: draft.custom?.name, variantName: draft.custom?.variantName, sourceUrl: draft.web?.url ?? url };
  }
  return { brand: out.page?.brand, name: out.page?.name, sourceUrl: out.status === 'invalid_url' ? null : out.page?.url ?? url };
}

/**
 * What to show when a store link didn't give a product. StockX and GOAT links are read from
 * the link itself instead (importMarketplaceLink); anything else shows the lookup's own reason
 * and an "Enter it yourself" step filled in with what is known.
 * @param {any} api
 * @param {{ out: any, url: string, dest: 'owned'|'wishlist', manual?: 'link'|'button' }} args
 *   manual 'button': "Enter it yourself" is a [data-web-manual] button carrying the known values
 *   (the photo flow keeps the person on the match), instead of a link to /add/manual
 * @returns {Promise<import('../lib/html.js').SafeHtml>}
 */
export async function lookupFallback(api, { out, url, dest, manual = 'link' }) {
  const enter = (known, text, primary = false) =>
    manual === 'button'
      ? html`<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-secondary'}" data-web-manual="${JSON.stringify(known)}">${text}</button>`
      : html`<a class="btn ${primary ? 'btn-primary' : 'btn-secondary'}" href="${safeUrl(manualHref(dest, known))}" data-sheet-close>${text}</a>`;

  if (out.status !== 'invalid_url') {
    const market = await api.importMarketplaceLink({ url }).catch(() => null);
    if (market?.ok) {
      const d = market.draft;
      const name = market.link?.marketplace?.name ?? 'marketplace';
      return html`<div class="stack stack-sm">
        ${notice({ tone: 'info', title: `A ${name} link`, body: `${name} pages can't be read here, but the link names the product. Save it as your own item, filled in from the link.` })}
        <div class="button-row">${enter({ category: d.category, brand: d.custom?.brand, name: d.custom?.name, variantName: d.custom?.variantName, sourceUrl: d.sourceUrl ?? url }, 'Continue', true)}</div>
      </div>`;
    }
    // A StockX or GOAT link that isn't to a product: its own message says what to copy instead.
    if (market && !market.ok && market.marketplace) {
      return html`<div class="stack stack-sm">
        ${notice({ tone: 'warn', title: "That link didn't work", body: market.message })}
        <div class="button-row">${enter({ sourceUrl: url }, 'Enter it yourself')}</div>
      </div>`;
    }
  }

  const known = knownFrom(out, url);
  // A blocking store still shows the page to a person, and a non-product page links onward.
  const openable = out.status === 'blocked' || (out.status === 'not_product' && out.page);
  const pageUrl = openable ? safeUrl(out.page?.url ?? url) : null;
  return html`<div class="stack stack-sm">
    ${notice({ tone: out.status === 'not_connected' ? 'info' : 'warn', title: PROBLEM_TITLE[out.status] ?? PROBLEM_TITLE.unavailable, body: out.reason })}
    <div class="button-row">
      ${enter(known, 'Enter it yourself')}
      ${pageUrl && pageUrl !== '#'
        ? html`<a class="btn btn-ghost" href="${pageUrl}" target="_blank" rel="noopener noreferrer">Open the page${icon('external')}</a>`
        : ''}
    </div>
  </div>`;
}

/**
 * Reads a store page (lookupProductPage) for the save sheet.
 * @param {any} api
 * @param {{ url: string, dest: 'owned'|'wishlist', category?: string|null, manual?: 'link'|'button' }} args
 *   category: wins over the page's guess (a match job's category)
 * @returns {Promise<{ draft: any } | { fallback: import('../lib/html.js').SafeHtml }>}
 */
export async function loadStorePage(api, { url, dest, category = null, manual = 'link' }) {
  const out = await api.lookupProductPage({ url });
  if (out.status === 'found' && out.draft) return { draft: category ? { ...out.draft, category } : out.draft };
  return { fallback: await lookupFallback(api, { out, url, dest, manual }) };
}

/**
 * The save form in a sheet, for a draft in hand (a listing) or one still to be read (`load`, a
 * store page). `save` saves and returns what the sheet closes with; null keeps it open (a
 * dismissed duplicate warning). Resolves with that value, { navigate } from a duplicate's "View
 * the one you have", { manual: known } from a [data-web-manual] button, or undefined when closed.
 * @param {{ dest: 'owned'|'wishlist', draft?: any, load?: () => Promise<{ draft?: any, fallback?: any }>,
 *   loadingText?: string, title?: string, profile?: any, ownedItems?: any[], photoFlow?: boolean,
 *   priceText?: string|null,
 *   save: (args: { form: HTMLFormElement, draft: any, values: any, close: (value: any) => void }) => Promise<any> }} opts
 * @returns {Promise<any>}
 */
export function openWebSheet(opts) {
  return openSheet({
    title: opts.title ?? (opts.dest === 'wishlist' ? 'Save to your wishlist' : 'Add to your collection'),
    body: opts.draft ? webSaveForm(opts.draft, opts) : webLoading(opts.loadingText ?? 'Reading the store page'),
    onMount(el, close) {
      let alive = true;
      let offForm = () => {};
      const offImages = bindRemoteImages(el);
      const onManual = (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-web-manual]') : null;
        if (button) close({ manual: JSON.parse(button.dataset.webManual) });
      };
      el.addEventListener('click', onManual);
      const showForm = (draft) => {
        hydratePhotos(el);
        offForm = bindWebSave(el, {
          ...opts,
          draft,
          async save(args) {
            const out = await opts.save({ ...args, close });
            if (out) close(out);
          },
        });
      };
      if (opts.draft) {
        showForm(opts.draft);
      } else {
        opts
          .load()
          .then((loaded) => {
            if (!alive) return;
            if (loaded.draft) {
              render(el, webSaveForm(loaded.draft, opts));
              showForm(loaded.draft);
            } else {
              render(el, loaded.fallback);
            }
          })
          .catch((error) => {
            if (alive) render(el, notice({ tone: 'danger', title: "The store page couldn't be read", body: error?.message ?? 'Try again in a moment.' }));
          });
      }
      return () => {
        alive = false;
        el.removeEventListener('click', onManual);
        offImages();
        offForm();
      };
    },
  });
}

// ---------- Item details ----------

/**
 * What the store showed when the item was saved: "Seen at Nike for $115, checked 2 hours ago",
 * and a plain link to the page (not an offer and not an affiliate link).
 * @param {any} web WebSnapshot (item.web), or null
 */
export function webSnapshot(web) {
  if (!web?.url) return '';
  const { seen, checked } = seenParts(web);
  const href = safeUrl(web.url);
  return html`<div class="web-seen" role="group" aria-label="From the store">
    <p class="small"><strong>${seen}</strong>, ${checked}</p>
    ${href !== '#'
      ? html`<a class="link-btn small" href="${href}" target="_blank" rel="noopener noreferrer">View on ${isBing(web) ? 'Bing Shopping' : web.host ?? webSite(web)}${icon('external', { className: 'icon-sm' })}</a>`
      : ''}
  </div>`;
}
