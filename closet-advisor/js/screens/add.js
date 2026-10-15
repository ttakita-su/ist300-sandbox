// Ways to add an item other than a photo: the chooser, a product link, catalog search and manual
// entry. Each saves to the collection or the wishlist (?dest=owned|wishlist).
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import * as fmt from '../lib/format.js';
import { idempotencyKey } from '../lib/ids.js';
import { CATEGORIES, CATEGORY_SINGULAR, PRODUCT_TYPES, TYPE_LABEL } from '../data/schema.js';
import { PICKABLE_COLORS, colorLabel } from '../data/colors.js';
import { backHead, screenHead, media, label, notice, field, selectField, chipGroup, demoNote } from '../ui/components.js';
import {
  ownedDetailsFields,
  readOwnedDetails,
  wishFields,
  readWish,
  bindWishFields,
  bindUsualSize,
  profileSizeFor,
  createWithDuplicateCheck,
} from '../ui/item-forms.js';
import { openCatalogPicker } from '../ui/catalog-picker.js';
import { pill } from '../ui/screen-kit.js';
import { openSheet, toast, toastError, withBusy, showFieldErrors } from '../lib/ui.js';

const destOf = (ctx) => (ctx.query.dest === 'wishlist' ? 'wishlist' : 'owned');

function destSwitch(path, ctx) {
  const dest = destOf(ctx);
  const q = (d) => {
    const params = new URLSearchParams({ ...ctx.query, dest: d });
    return `#${path}?${params}`;
  };
  return html`<div class="cluster" role="group" aria-label="Save to">
    ${pill(q('owned'), 'I own it', dest === 'owned')}
    ${pill(q('wishlist'), 'I want it', dest === 'wishlist')}
  </div>`;
}

/** The details form for the chosen destination. */
function destFields(dest, opts, owned) {
  return dest === 'wishlist' ? wishFields({ ...opts, values: { reason: 'want_exact', ...(opts.values ?? {}) }, ownedItems: owned }) : ownedDetailsFields(opts);
}

/** Creates the item for the destination, asking about duplicates; returns the view or null. */
async function saveItem(ctx, dest, form, base, key) {
  return createWithDuplicateCheck(
    ({ allowDuplicate }) => {
      const idem = allowDuplicate ? `${key}-dup` : key;
      return dest === 'wishlist'
        ? ctx.api.createWishlist({ ...base, ...readWish(form), allowDuplicate, idempotencyKey: idem })
        : ctx.api.createOwned({ ...base, details: readOwnedDetails(form, base.category), allowDuplicate, idempotencyKey: idem });
    },
    { dest, navigate: ctx.navigate },
  );
}

function done(ctx, dest, item) {
  if (!item) return;
  toast(dest === 'wishlist' ? 'Saved to your wishlist' : 'Added to your collection');
  ctx.navigate(`/${dest === 'wishlist' ? 'wishlist' : 'collection'}/${encodeURIComponent(item.id)}`, { replace: true });
}

export default [
  {
    path: '/add',
    title: 'Add an item',
    tab: null,
    roles: ['user'],
    render(ctx) {
      const dest = destOf(ctx);
      const ways = [
        { path: '/add/photo', icon: 'camera', title: 'Take a photo', body: 'We find it in the catalog from the picture.' },
        { path: '/add/link', icon: 'link', title: 'Paste a product link', body: 'From a store page.' },
        { path: '/add/search', icon: 'search', title: 'Search the catalog', body: 'By brand, model, color or code.' },
        { path: '/add/manual', icon: 'edit', title: 'Enter it yourself', body: "For things that aren't in the catalog." },
      ];
      return html`<div class="stack stack-lg">
        ${screenHead({ title: 'Add an item' })}
        ${destSwitch('/add', ctx)}
        <ul class="list">${ways.map(
          (w) => html`<li><a class="list-item" href="#${w.path}?dest=${dest}">
            <span class="list-thumb">${icon(w.icon)}</span>
            <span class="grow"><span>${w.title}</span><span>${w.body}</span></span>
            ${icon('chevron-right')}
          </a></li>`,
        )}</ul>
        ${demoNote()}
      </div>`;
    },
  },
  {
    path: '/add/link',
    title: 'Add from a link',
    tab: null,
    roles: ['user'],
    async render(ctx) {
      const dest = destOf(ctx);
      const url = ctx.query.url ?? '';
      let result = null;
      let extra = '';
      if (url) {
        result = await ctx.api.importFromUrl({ url });
        if (result.status === 'resolved') {
          const [profile, owned, full] = await Promise.all([ctx.api.getProfile({}), ctx.api.listOwned({}), ctx.api.getProduct({ productId: result.productId })]);
          const product = full.product;
          ctx.linkBase = { category: product.category, productId: result.productId, variantId: result.variantId, source: 'product_link', sourceUrl: result.url };
          const opts = { category: product.category, type: product.type, sizing: product.sizing, usual: profileSizeFor(profile, product.category, product.type), values: { size: result.size, desired: { size: result.size } } };
          const variant = full.variants.find((v) => v.id === result.variantId);
          extra = html`<section class="stack">
            ${notice({ tone: 'ok', title: 'Found it', body: `This link is ${result.retailer?.name ?? 'a demo store'}'s listing for this product.` })}
            <div class="row" style="--gap: var(--s4); align-items: flex-start">
              <div style="width: 120px; flex: none">${media(variant?.image, { alt: product.name, category: product.category })}</div>
              ${label({ brand: product.brand.name, name: product.name, variant: variant?.name, code: variant?.code, state: dest === 'wishlist' ? 'wishlist' : 'owned' })}
            </div>
            ${result.sizeNote ? html`<p class="small muted">${result.sizeNote}</p>` : ''}
            <form class="stack" data-link-save novalidate>
              ${destFields(dest, opts, owned.items)}
              <button type="submit" class="btn btn-primary btn-block">${dest === 'wishlist' ? 'Save to wishlist' : 'Add to collection'}</button>
            </form>
          </section>`;
        } else {
          // Marketplace links (StockX, GOAT) can become a draft custom item.
          let market = null;
          if (result.status === 'unsupported_link') market = await ctx.api.importMarketplaceLink({ url }).catch(() => null);
          if (market?.ok) {
            const d = market.draft;
            const params = new URLSearchParams({ dest, category: d.category ?? '', brand: d.custom?.brand ?? '', name: d.custom?.name ?? '', variantName: d.custom?.variantName ?? '', sourceUrl: d.sourceUrl ?? url });
            extra = html`${notice({ tone: 'info', title: `A ${market.link?.marketplace ?? 'marketplace'} link`, body: 'Marketplace listings are not connected in this demo. You can save it as your own item, filled in from the link.' })}
              <a class="btn btn-primary" href="#/add/manual?${params}">Continue</a>`;
          } else {
            extra = notice({ tone: 'warn', title: "That link didn't work", body: market?.message ?? result.reason });
          }
        }
      }
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Add from a link', back: `#/add?dest=${dest}` })}
        ${destSwitch('/add/link', ctx)}
        <form class="stack stack-sm" data-link-form>
          ${field({ label: 'Product link', name: 'url', type: 'url', value: url, placeholder: 'https://northline.example/p/...', required: true, hint: "Paste a link from a store's product page. Rotation doesn't open the link; it reads the address." })}
          <button type="submit" class="btn btn-secondary">Look up</button>
        </form>
        ${extra}
        ${demoNote('Demo stores use .example addresses, like northline.example. Product pages in Rotation show them in "Where to buy".')}
      </div>`;
    },
    mount(root, ctx) {
      const dest = destOf(ctx);
      const key = idempotencyKey();
      const offs = [bindWishFields(root), bindUsualSize(root)];
      ctx.on('submit', '[data-link-form]', (event, form) => {
        event.preventDefault();
        const url = form.elements.url.value.trim();
        if (url) ctx.navigate(`/add/link?${new URLSearchParams({ dest, url })}`, { replace: true });
      });
      ctx.on('submit', '[data-link-save]', async (event, form) => {
        event.preventDefault();
        await withBusy(form.querySelector('[type="submit"]'), async () => {
          try {
            done(ctx, dest, await saveItem(ctx, dest, form, ctx.linkBase, key));
          } catch (error) {
            if (!showFieldErrors(form, error)) toastError(error);
          }
        });
      });
      return () => offs.forEach((off) => off());
    },
  },
  {
    path: '/add/search',
    title: 'Search the catalog',
    tab: null,
    roles: ['user'],
    render(ctx) {
      const dest = destOf(ctx);
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Search the catalog', back: `#/add?dest=${dest}` })}
        ${destSwitch('/add/search', ctx)}
        <p>Find the product, then choose your exact version.</p>
        <button type="button" class="btn btn-primary btn-block" data-open-picker>${icon('search')}Search</button>
        ${demoNote()}
      </div>`;
    },
    mount(root, ctx) {
      const dest = destOf(ctx);
      const open = async () => {
        const pick = await openCatalogPicker({ confirmLabel: 'Next' });
        if (!pick) return;
        const [profile, owned, full] = await Promise.all([ctx.api.getProfile({}), ctx.api.listOwned({}), ctx.api.getProduct({ productId: pick.product.id })]);
        const product = full.product;
        const key = idempotencyKey();
        const base = { category: product.category, productId: product.id, variantId: pick.variant?.id ?? null, source: 'catalog_search' };
        const opts = { category: product.category, type: product.type, sizing: product.sizing, usual: profileSizeFor(profile, product.category, product.type) };
        const item = await openSheet({
          title: `${product.brand.name} ${product.name}`,
          body: html`<form class="stack" novalidate>
            <p class="muted">${pick.variant?.name ?? 'Version not sure'}</p>
            ${destFields(dest, opts, owned.items)}
            <button type="submit" class="btn btn-primary btn-block">${dest === 'wishlist' ? 'Save to wishlist' : 'Add to collection'}</button>
          </form>`,
          onMount(el, close) {
            const offs = [bindWishFields(el), bindUsualSize(el)];
            el.querySelector('form').addEventListener('submit', async (event) => {
              event.preventDefault();
              const form = event.target;
              await withBusy(form.querySelector('[type="submit"]'), async () => {
                try {
                  const out = await saveItem({ ...ctx, navigate: (path) => close({ navigate: path }) }, dest, form, base, key);
                  if (out) close(out);
                } catch (error) {
                  if (!showFieldErrors(form, error)) toastError(error);
                }
              });
            });
            return () => offs.forEach((off) => off());
          },
        });
        if (item?.navigate) ctx.navigate(item.navigate);
        else done(ctx, dest, item);
      };
      ctx.on('click', '[data-open-picker]', () => open().catch(toastError));
      // Open straight away: searching is the only thing to do on this screen.
      const timer = setTimeout(() => open().catch(toastError), 0);
      return () => clearTimeout(timer);
    },
  },
  {
    path: '/add/manual',
    title: 'Add manually',
    tab: null,
    roles: ['user'],
    async render(ctx) {
      const dest = destOf(ctx);
      const q = ctx.query;
      const category = CATEGORIES.includes(q.category) ? q.category : 'sneaker';
      const types = PRODUCT_TYPES[category] ?? [];
      const type = types.includes(q.type) ? q.type : types[0];
      const [profile, owned] = await Promise.all([ctx.api.getProfile({}), ctx.api.listOwned({})]);
      const opts = { category, type, usual: profileSizeFor(profile, category, type) };
      const link = (patch) => `#/add/manual?${new URLSearchParams({ ...q, ...patch })}`;
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Enter it yourself', back: `#/add?dest=${dest}` })}
        ${destSwitch('/add/manual', ctx)}
        <div class="stack stack-sm">
          <span class="field-label">What is it?</span>
          <div class="cluster">${CATEGORIES.map((c) => pill(link({ category: c, type: '' }), CATEGORY_SINGULAR[c], c === category))}</div>
        </div>
        <form class="stack stack-lg" data-manual novalidate>
          <div class="form-grid two">
            ${field({ label: 'Brand', name: 'custom.brand', value: q.brand ?? '', required: true })}
            ${field({ label: 'Name', name: 'custom.name', value: q.name ?? '', required: true, placeholder: 'Model or a short description' })}
            ${field({ label: 'Color or version', name: 'custom.variantName', value: q.variantName ?? '', optional: true })}
            ${selectField({ label: 'Type', name: 'custom.type', options: types.map((t) => ({ value: t, label: TYPE_LABEL[t] ?? fmt.humanize(t) })), value: type })}
          </div>
          ${chipGroup({ legend: 'Main colors', name: 'colors', options: PICKABLE_COLORS.map((c) => ({ value: c, label: colorLabel(c) })), selected: [] })}
          ${destFields(dest, opts, owned.items)}
          <button type="submit" class="btn btn-primary btn-block">${dest === 'wishlist' ? 'Save to wishlist' : 'Add to collection'}</button>
        </form>
      </div>`;
    },
    mount(root, ctx) {
      const dest = destOf(ctx);
      const key = idempotencyKey();
      const offs = [bindWishFields(root), bindUsualSize(root)];
      const category = CATEGORIES.includes(ctx.query.category) ? ctx.query.category : 'sneaker';
      // The size control depends on the type (tops vs trousers), so a type change re-renders.
      ctx.on('change', 'select[name="custom.type"]', (event, select) => {
        if (category !== 'clothing') return;
        const form = select.form;
        const params = new URLSearchParams({ ...ctx.query, type: select.value, brand: form.elements['custom.brand'].value, name: form.elements['custom.name'].value, variantName: form.elements['custom.variantName'].value });
        ctx.navigate(`/add/manual?${params}`, { replace: true });
      });
      ctx.on('submit', '[data-manual]', async (event, form) => {
        event.preventDefault();
        const custom = {
          brand: form.elements['custom.brand'].value,
          name: form.elements['custom.name'].value,
          variantName: form.elements['custom.variantName'].value,
          type: form.elements['custom.type'].value,
          colors: [...form.querySelectorAll('input[name="colors"]:checked')].map((el) => el.value),
        };
        const base = { category, custom, source: 'manual', sourceUrl: ctx.query.sourceUrl || undefined };
        await withBusy(form.querySelector('[type="submit"]'), async () => {
          try {
            done(ctx, dest, await saveItem(ctx, dest, form, base, key));
          } catch (error) {
            if (!showFieldErrors(form, error)) toastError(error);
          }
        });
      });
      return () => offs.forEach((off) => off());
    },
  },
];
