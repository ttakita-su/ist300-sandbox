// Product detail: versions, facts, and retailer offers for the chosen version, size and condition.
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import * as fmt from '../lib/format.js';
import { idempotencyKey } from '../lib/ids.js';
import { OFFER_CONDITION_LABEL } from '../data/schema.js';
import { backHead, media, label, facts, swatches, offerCard, affiliateDisclosure, notice, demoNote, thumb } from '../ui/components.js';
import { wishFields, readWish, bindWishFields, bindUsualSize, ownedDetailsFields, readOwnedDetails, profileSizeFor, createWithDuplicateCheck } from '../ui/item-forms.js';
import { openSheet, toast, toastError, withBusy, showFieldErrors } from '../lib/ui.js';

const CONDITIONS = [
  { value: 'new_only', label: 'New only' },
  { value: 'new_or_used', label: 'New or used' },
];

function productHref(productId, query) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  return `#/product/${encodeURIComponent(productId)}?${params}`;
}

export default [
  {
    path: '/product/:id',
    title: (ctx) => ctx.productTitle ?? 'Product',
    tab: 'discover',
    roles: ['user', 'stylist'],
    async render(ctx) {
      const { product, variants } = await ctx.api.getProduct({ productId: ctx.params.id });
      const variant = variants.find((v) => v.id === ctx.query.variant) ?? variants[0];
      const condition = ctx.query.condition === 'new_or_used' ? 'new_or_used' : 'new_only';
      const isUser = ctx.session?.role === 'user';
      const profile = isUser ? await ctx.api.getProfile({}) : null;
      const usual = profileSizeFor(profile, product.category, product.type);
      // 'any' is an explicit choice; with no size in the link, the person's usual size is used.
      const sizeValue = ctx.query.size === 'any' ? null : ctx.query.size ?? usual?.value ?? null;
      ctx.productTitle = `${product.brand.name} ${product.name}`;
      ctx.product = product;
      ctx.variant = variant;
      ctx.usual = usual;

      let offers = null;
      let offersError = null;
      try {
        offers = await ctx.api.getOffers({ variantId: variant.id, size: sizeValue || undefined, condition });
      } catch (error) {
        offersError = error;
      }
      const q = { variant: variant.id, size: sizeValue ?? 'any', condition };
      const alt = `${product.brand.name} ${product.name}, ${variant.name}`;
      const attrs = { ...product.attributes, ...variant.attributes };

      return html`<div class="stack stack-lg">
        ${backHead({ title: product.name, back: '#/discover' })}
        <div class="split">
          <div class="stack">
            ${variant.image?.url
              ? media(variant.image, { alt, category: product.category, wide: true })
              : html`${media(null, { alt, category: product.category, wide: true })}<p class="small muted">${variant.image?.unavailableReason ?? 'No image for this version.'}</p>`}
            ${variant.image?.attribution ? html`<p class="xsmall muted">${variant.image.attribution}</p>` : ''}
          </div>
          <div class="stack stack-lg">
            ${label({ brand: product.brand.name, name: product.name, variant: variant.name, code: variant.code, state: 'suggestion' })}
            ${variants.length > 1
              ? html`<fieldset class="stack stack-sm">
                  <legend class="field-label">Version</legend>
                  <div class="cluster">${variants.map(
                    (v) => html`<a class="chip ${v.id === variant.id ? 'is-selected' : ''}" href="${productHref(product.id, { ...q, variant: v.id })}" ${v.id === variant.id ? html`aria-current="true"` : ''}>
                      <span class="list-thumb" style="width:24px;height:24px">${thumb(v.image, '', product.category)}</span>${v.name}
                    </a>`,
                  )}</div>
                </fieldset>`
              : ''}
            ${isUser
              ? html`<div class="button-row">
                  <button type="button" class="btn btn-secondary" data-save-wish>${icon('heart')}Save to wishlist</button>
                  <button type="button" class="btn btn-ghost" data-own-it>${icon('plus')}I own this</button>
                </div>`
              : ''}
            <p>${product.description}</p>
            ${facts([
              ['Type', product.typeLabel],
              ['Colors', variant.colors?.length ? swatches(variant.colors) : null],
              ['Code', variant.code ?? null],
              ['Case', attrs.diameterMm ? fmt.mm(attrs.diameterMm) : null],
              ['Lug width', attrs.lugWidthMm ? fmt.mm(attrs.lugWidthMm) : null],
              ['Strap width', attrs.strapWidthMm ? fmt.mm(attrs.strapWidthMm) : null],
              ['Materials', product.materials?.length ? fmt.listJoin(product.materials) : null],
              ['Features', product.features?.length ? fmt.listJoin(product.features) : null],
              ['List price', variant.msrpMinor != null ? fmt.money(variant.msrpMinor, variant.currency) : null],
              ['Released', variant.release?.date ? fmt.date(variant.release.date) : null],
            ])}
          </div>
        </div>

        <section class="section stack" aria-labelledby="offers-h">
          <div class="section-head"><h2 id="offers-h">Where to buy</h2></div>
          <form class="cluster" data-offer-filters>
            ${offers?.sizeOptions?.length
              ? html`<label class="row small" style="--gap: 8px">Size
                  <select class="select" name="size">
                    <option value="any">Any size</option>
                    ${offers.sizeOptions.map((o) => html`<option value="${o.size.value}" ${o.size.value === sizeValue ? html`selected` : ''}>${fmt.size(o.size)}${o.inStock ? '' : ' (sold out)'}</option>`)}
                  </select>
                </label>`
              : ''}
            <label class="row small" style="--gap: 8px">Condition
              <select class="select" name="condition">${CONDITIONS.map((c) => html`<option value="${c.value}" ${c.value === condition ? html`selected` : ''}>${c.label}</option>`)}</select>
            </label>
          </form>
          ${offersError
            ? notice({ tone: 'warn', title: 'Prices unavailable', body: offersError.message })
            : html`
              ${offers.notice ? notice({ tone: 'info', body: offers.notice }) : ''}
              ${offers.needsSize ? html`<p class="small muted">Choose a size to see exact prices and stock. Showing starting prices.</p>` : ''}
              ${offers.rows.length
                ? html`<div class="stack">${offers.rows.map((row) => offerCard(row, { lowest: offers.lowest?.offerId === row.offerId, lowestLabel: offers.lowest?.label }))}</div>`
                : html`<p class="muted">No ${condition === 'new_only' ? 'new ' : ''}offers${offers.size ? ` in ${fmt.size(offers.size)}` : ''} at the ${fmt.plural(offers.retailersChecked, 'retailer')} we check.</p>`}
              ${offers.lowestNote ? html`<p class="small muted">${offers.lowestNote}</p>` : ''}
              ${offers.otherSizes?.length
                ? html`<p class="small">In stock in other sizes: ${offers.otherSizes.map((o, i) => html`${i ? ', ' : ''}<a href="${productHref(product.id, { ...q, size: o.size.value })}">${fmt.size(o.size)}</a>`)}</p>`
                : ''}
              ${offers.hiddenByCondition
                ? html`<p class="small"><a href="${productHref(product.id, { ...q, condition: 'new_or_used' })}">Show ${fmt.plural(offers.hiddenByCondition, 'used offer')}</a></p>`
                : ''}
              ${offers.unavailable?.length
                ? html`<details><summary class="small">${fmt.plural(offers.unavailable.length, 'unavailable listing')}</summary>
                    <ul class="stack stack-xs" style="margin-top: var(--s3)">${offers.unavailable.map((r) => html`<li class="small muted">${r.retailer.name} (${OFFER_CONDITION_LABEL[r.condition] ?? r.condition}): ${r.reason}</li>`)}</ul>
                  </details>`
                : ''}
              ${affiliateDisclosure(offers.disclosure)}`}
        </section>
        ${demoNote()}
      </div>`;
    },
    mount(root, ctx) {
      const offs = [bindWishFields(root), bindUsualSize(root)];
      ctx.on('change', '[data-offer-filters] select', (event, select) => {
        const form = select.form;
        const href = productHref(ctx.product.id, { variant: ctx.variant.id, size: form.elements.size?.value ?? 'any', condition: form.elements.condition.value });
        ctx.navigate(href.slice(1), { replace: true });
      });

      const opts = () => ({ category: ctx.product.category, type: ctx.product.type, sizing: ctx.product.sizing, usual: ctx.usual });
      const base = () => ({ category: ctx.product.category, productId: ctx.product.id, variantId: ctx.variant.id, source: 'catalog_search' });

      ctx.on('click', '[data-save-wish]', async () => {
        const key = idempotencyKey();
        const owned = await ctx.api.listOwned({}).catch(() => ({ items: [] }));
        const saved = await openSheet({
          title: 'Save to wishlist',
          body: html`<form class="stack" novalidate>${wishFields({ ...opts(), values: { reason: 'want_exact' }, ownedItems: owned.items })}<button type="submit" class="btn btn-primary btn-block">Save</button></form>`,
          onMount(el, close) {
            const offsSheet = [bindWishFields(el), bindUsualSize(el)];
            el.querySelector('form').addEventListener('submit', async (event) => {
              event.preventDefault();
              const form = event.target;
              await withBusy(form.querySelector('[type="submit"]'), async () => {
                try {
                  const out = await createWithDuplicateCheck(
                    ({ allowDuplicate }) => ctx.api.createWishlist({ ...base(), ...readWish(form), allowDuplicate, idempotencyKey: allowDuplicate ? `${key}-dup` : key }),
                    { dest: 'wishlist', navigate: (path) => close({ navigate: path }) },
                  );
                  if (out) close({ item: out });
                } catch (error) {
                  if (!showFieldErrors(form, error)) toastError(error);
                }
              });
            });
            return () => offsSheet.forEach((off) => off());
          },
        });
        if (saved?.item) toast('Saved to your wishlist', { action: { label: 'View', onClick: () => ctx.navigate(`/wishlist/${saved.item.id}`) } });
        else if (saved?.navigate) ctx.navigate(saved.navigate);
      });

      ctx.on('click', '[data-own-it]', async () => {
        const key = idempotencyKey();
        const saved = await openSheet({
          title: 'Add to your collection',
          body: html`<form class="stack" novalidate>${ownedDetailsFields({ ...opts(), values: {} })}<button type="submit" class="btn btn-primary btn-block">Add to collection</button></form>`,
          onMount(el, close) {
            const off = bindUsualSize(el);
            el.querySelector('form').addEventListener('submit', async (event) => {
              event.preventDefault();
              const form = event.target;
              await withBusy(form.querySelector('[type="submit"]'), async () => {
                try {
                  const out = await createWithDuplicateCheck(
                    ({ allowDuplicate }) => ctx.api.createOwned({ ...base(), details: readOwnedDetails(form, ctx.product.category), allowDuplicate, idempotencyKey: allowDuplicate ? `${key}-dup` : key }),
                    { dest: 'owned', navigate: (path) => close({ navigate: path }) },
                  );
                  if (out) close({ item: out });
                } catch (error) {
                  if (!showFieldErrors(form, error)) toastError(error);
                }
              });
            });
            return off;
          },
        });
        if (saved?.item) {
          toast('Added to your collection');
          ctx.navigate(`/collection/${encodeURIComponent(saved.item.id)}`);
        } else if (saved?.navigate) ctx.navigate(saved.navigate);
      });
      return () => offs.forEach((off) => off());
    },
  },
];
