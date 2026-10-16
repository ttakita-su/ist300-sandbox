// Collection: the owned grid with filters, item detail, and editing private details.
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import * as fmt from '../lib/format.js';
import { idempotencyKey } from '../lib/ids.js';
import { CATEGORIES, CATEGORY_LABEL, OWNED_CONDITION_LABEL } from '../data/schema.js';
import {
  screenHead,
  backHead,
  itemTile,
  media,
  label,
  identityStamps,
  ownedBlock,
  evidenceList,
  facts,
  notice,
  emptyState,
  segmented,
  swatches,
  field,
} from '../ui/components.js';
import { ownedDetailsFields, readOwnedDetails, bindUsualSize, profileSizeFor } from '../ui/item-forms.js';
import { openCatalogPicker } from '../ui/catalog-picker.js';
import { webSnapshot } from '../ui/web-product.js';
import { pill } from '../ui/screen-kit.js';
import { confirmDialog, toast, toastError, withBusy, showFieldErrors } from '../lib/ui.js';

const DISPLAY_LABEL = { catalog: 'Catalog image', original: 'Your photo', cleaned: 'Cleaned up', web: 'Store image' };
const SORTS = [
  { value: 'recent', label: 'Recently added' },
  { value: 'brand', label: 'Brand' },
  { value: 'name', label: 'Name' },
  { value: 'color', label: 'Color' },
];

function filterHref(query, patch) {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
  const qs = params.toString();
  return `#/collection${qs ? `?${qs}` : ''}`;
}

export default [
  {
    path: '/collection',
    title: 'Collection',
    tab: 'collection',
    roles: ['user'],
    async render(ctx) {
      const q = ctx.query;
      const data = await ctx.api.listOwned({
        category: q.category || undefined,
        brandId: q.brand || undefined,
        color: q.color || undefined,
        q: q.q || undefined,
        sort: q.sort || 'recent',
        includeArchived: q.archived === '1',
      });
      const { facets } = data;
      const filtered = Boolean(q.category || q.brand || q.color || q.q);
      return html`<div class="stack stack-lg">
        ${screenHead({
          title: 'Collection',
          lede: data.collectionTotal ? `${fmt.plural(data.collectionTotal, 'item')} you own` : null,
          actions: html`<a class="btn btn-primary" href="#/add?dest=owned">${icon('plus')}Add</a>`,
        })}
        ${data.collectionTotal || data.archivedCount
          ? html`<div class="stack stack-sm">
              <form class="search-field" data-search role="search">
                ${icon('search')}
                <label class="visually-hidden" for="f-col-q">Search your collection</label>
                <input class="input" id="f-col-q" name="q" type="search" value="${q.q ?? ''}" placeholder="Search your collection" autocomplete="off">
              </form>
              <div class="cluster" role="group" aria-label="Category">
                ${pill(filterHref(q, { category: '' }), 'All', !q.category, data.collectionTotal)}
                ${CATEGORIES.filter((c) => facets.categories[c]).map((c) => pill(filterHref(q, { category: c }), CATEGORY_LABEL[c], q.category === c, facets.categories[c]))}
              </div>
              ${facets.brands.length > 1
                ? html`<div class="cluster" role="group" aria-label="Brand">${facets.brands.map((b) => pill(filterHref(q, { brand: q.brand === b.id ? '' : b.id }), b.name, q.brand === b.id, b.count))}</div>`
                : ''}
              ${facets.colors.length > 1
                ? html`<div class="cluster" role="group" aria-label="Color">${facets.colors.map((c) => pill(filterHref(q, { color: q.color === c.name ? '' : c.name }), c.label, q.color === c.name, c.count))}</div>`
                : ''}
              <div class="spread">
                <label class="row small" style="--gap: 8px">Sort
                  <select class="select" data-sort aria-label="Sort">${SORTS.map((s) => html`<option value="${s.value}" ${(q.sort || 'recent') === s.value ? html`selected` : ''}>${s.label}</option>`)}</select>
                </label>
                ${data.archivedCount
                  ? html`<a class="link-btn small" href="${filterHref(q, { archived: q.archived === '1' ? '' : '1' })}">${q.archived === '1' ? 'Hide archived' : `Show archived (${data.archivedCount})`}</a>`
                  : ''}
              </div>
            </div>`
          : ''}
        ${data.items.length
          ? html`<div class="tile-grid">${data.items.map((item) => itemTile(item, { state: 'owned', href: `#/collection/${encodeURIComponent(item.id)}` }))}</div>`
          : filtered
            ? emptyState({ iconName: 'filter', title: 'Nothing matches these filters', actions: html`<a class="btn btn-secondary" href="#/collection">Clear filters</a>` })
            : emptyState({
                title: 'Your collection is empty',
                body: 'Photograph something you own, paste a product link, or search the catalog.',
                actions: html`<a class="btn btn-primary" href="#/add/photo?dest=owned">${icon('camera')}Photograph an item</a><a class="btn btn-secondary" href="#/add?dest=owned">Other ways to add</a>`,
              })}
      </div>`;
    },
    mount(root, ctx) {
      ctx.on('submit', '[data-search]', (event, form) => {
        event.preventDefault();
        ctx.navigate(filterHref(ctx.query, { q: form.elements.q.value.trim() }).slice(1));
      });
      ctx.on('change', '[data-sort]', (event, select) => {
        ctx.navigate(filterHref(ctx.query, { sort: select.value === 'recent' ? '' : select.value }).slice(1), { replace: true });
      });
    },
  },
  {
    path: '/collection/:id',
    title: (ctx) => ctx.itemTitle ?? 'Item',
    tab: 'collection',
    roles: ['user'],
    async render(ctx) {
      const item = await ctx.api.getOwned({ itemId: ctx.params.id });
      ctx.item = item;
      ctx.itemTitle = `${item.brandName} ${item.title}`;
      const d = item.details ?? {};
      const alt = `${item.brandName} ${item.title}${item.subtitle ? `, ${item.subtitle}` : ''}`;
      const id = encodeURIComponent(item.id);
      const options = item.image?.options ?? [];
      const variantColors = item.variant?.colors ?? (item.custom?.colors ?? []).map((name) => ({ name }));
      return html`<div class="stack stack-lg">
        ${backHead({ title: item.title, back: '#/collection', actions: html`<a class="icon-btn" href="#/collection/${id}/edit" aria-label="Edit details">${icon('edit')}</a>` })}
        ${item.archivedAt ? notice({ tone: 'info', title: 'Archived', body: `You archived this ${fmt.relative(item.archivedAt)}. It's hidden from your collection and suggestions.` }) : ''}
        <div class="split">
          <div class="stack">
            ${media(item.image, { alt, category: item.category, wide: true })}
            ${options.length > 1
              ? html`<div class="stack stack-xs">
                  <span class="small muted">Show</span>
                  ${segmented({ name: 'display', label: 'Image to show', value: item.image.kind, options: options.map((o) => ({ value: o, label: DISPLAY_LABEL[o] ?? o })) })}
                </div>`
              : ''}
            ${item.image?.fallbackReason ? html`<p class="small muted">${item.image.fallbackReason}</p>` : ''}
            ${item.image?.attribution ? html`<p class="xsmall muted">${item.image.attribution}</p>` : ''}
          </div>
          <div class="stack stack-lg">
            ${label({ brand: item.brandName, name: item.title, variant: item.subtitle, code: item.code, block: ownedBlock(item), state: 'owned', stamps: identityStamps(item.identity, item.category), archived: Boolean(item.archivedAt) })}
            ${item.copies > 1 ? html`<p class="small">You have ${item.copies} of this version.</p>` : ''}
            ${webSnapshot(item.web)}
            <div class="button-row">
              <a class="btn btn-primary" href="#/recs?mode=matching&seed=${id}&seedType=owned">${icon('sparkle')}Find matching</a>
              <a class="btn btn-secondary" href="#/recs?mode=similar&seed=${id}&seedType=owned">${icon('layers')}Find similar</a>
              ${item.productId ? html`<a class="btn btn-ghost" href="#/product/${encodeURIComponent(item.productId)}${item.variantId ? `?variant=${encodeURIComponent(item.variantId)}` : ''}">Product page</a>` : ''}
            </div>
            <section class="stack stack-sm">
              <h2>Your details</h2>
              ${facts([
                ['Size', fmt.size(d.size)],
                ['Condition', OWNED_CONDITION_LABEL[d.condition] ?? null],
                ['Paid', d.purchase?.priceMinor != null ? fmt.money(d.purchase.priceMinor, d.purchase.currency) : null],
                ['Bought', d.purchase?.date ? fmt.date(d.purchase.date) : null],
                ['From', d.purchase?.from ?? null],
                ['Serial number', d.serialNumber ?? null],
                ['Colors', variantColors.length ? swatches(variantColors) : null],
                ['Added', fmt.date(item.createdAt)],
              ])}
              ${d.notes ? html`<p class="panel panel-flat small">${d.notes}</p>` : ''}
              <a class="link-btn" href="#/collection/${id}/edit">${icon('edit', { className: 'icon-sm' })} Edit details</a>
            </section>
            <section class="stack stack-sm">
              <h2>How it was identified</h2>
              ${evidenceList(item.identity?.evidence, item.identity?.conflicts) || html`<p class="muted small">No evidence recorded.</p>`}
              <div class="button-row">
                <button type="button" class="btn btn-secondary btn-sm" data-correct>${icon('swap')}Change product</button>
                ${item.photos?.originalId && !item.photos?.cleanedId ? html`<button type="button" class="btn btn-secondary btn-sm" data-cleanup>${icon('wand')}Clean up my photo</button>` : ''}
              </div>
            </section>
            <section class="stack stack-sm">
              <h2>Manage</h2>
              <div class="button-row">
                ${item.archivedAt
                  ? html`<button type="button" class="btn btn-secondary btn-sm" data-restore>${icon('refresh')}Restore</button>`
                  : html`<button type="button" class="btn btn-secondary btn-sm" data-archive>${icon('archive')}Archive</button>`}
                <button type="button" class="btn btn-danger btn-sm" data-delete>${icon('trash')}Delete</button>
              </div>
            </section>
          </div>
        </div>
      </div>`;
    },
    mount(root, ctx) {
      const item = ctx.item;
      const run = (button, fn) =>
        withBusy(button, async () => {
          try {
            await fn();
          } catch (error) {
            toastError(error);
          }
        });
      ctx.on('change', 'input[name="display"]', (event, input) =>
        run(null, async () => {
          await ctx.api.setDisplayImage({ itemId: item.id, display: input.value });
          ctx.refresh();
        }),
      );
      ctx.on('click', '[data-cleanup]', (event, button) =>
        run(button, async () => {
          await ctx.api.cleanupPhoto({ itemId: item.id, idempotencyKey: idempotencyKey() });
          await ctx.api.setDisplayImage({ itemId: item.id, display: 'cleaned' });
          toast('Photo cleaned up. Your original is kept.');
          ctx.refresh();
        }),
      );
      ctx.on('click', '[data-correct]', (event, button) =>
        run(button, async () => {
          const pick = await openCatalogPicker({ title: 'Which product is it?', category: item.category, confirmLabel: 'Use this product' });
          if (!pick) return;
          await ctx.api.correctMatch({ itemId: item.id, productId: pick.product.id, variantId: pick.variant?.id ?? null });
          toast('Updated');
          ctx.refresh();
        }),
      );
      ctx.on('click', '[data-archive]', (event, button) =>
        run(button, async () => {
          await ctx.api.archiveOwned({ itemId: item.id });
          toast('Archived', { action: { label: 'Undo', onClick: () => ctx.api.restoreOwned({ itemId: item.id }).then(() => ctx.refresh()) } });
          ctx.refresh();
        }),
      );
      ctx.on('click', '[data-restore]', (event, button) =>
        run(button, async () => {
          await ctx.api.restoreOwned({ itemId: item.id });
          ctx.refresh();
        }),
      );
      ctx.on('click', '[data-delete]', (event, button) =>
        run(button, async () => {
          const ok = await confirmDialog({ title: 'Delete this item?', message: 'It and its photos are removed from this browser. This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' });
          if (!ok) return;
          await ctx.api.deleteOwned({ itemId: item.id });
          toast('Deleted');
          ctx.navigate('/collection', { replace: true });
        }),
      );
    },
  },
  {
    path: '/collection/:id/edit',
    title: 'Edit item',
    tab: 'collection',
    roles: ['user'],
    async render(ctx) {
      const [item, profile] = await Promise.all([ctx.api.getOwned({ itemId: ctx.params.id }), ctx.api.getProfile({})]);
      ctx.item = item;
      let sizing = null;
      if (item.productId) sizing = (await ctx.api.getProduct({ productId: item.productId })).product.sizing;
      const type = item.product?.type ?? item.custom?.type ?? undefined;
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Edit details', back: `#/collection/${encodeURIComponent(item.id)}` })}
        <p class="muted">${item.brandName} ${item.title}${item.subtitle ? `, ${item.subtitle}` : ''}</p>
        <form class="stack stack-lg" data-edit novalidate>
          ${item.custom
            ? html`<div class="form-grid two">
                ${field({ label: 'Brand', name: 'custom.brand', value: item.custom.brand, required: true })}
                ${field({ label: 'Name', name: 'custom.name', value: item.custom.name, required: true })}
                ${field({ label: 'Color or version', name: 'custom.variantName', value: item.custom.variantName ?? '', optional: true })}
              </div>`
            : ''}
          ${ownedDetailsFields({ category: item.category, type, sizing, values: item.details, usual: profileSizeFor(profile, item.category, type) })}
          <div class="button-row">
            <button type="submit" class="btn btn-primary">Save changes</button>
            <a class="btn btn-ghost" href="#/collection/${encodeURIComponent(item.id)}">Cancel</a>
          </div>
        </form>
      </div>`;
    },
    mount(root, ctx) {
      const off = bindUsualSize(root);
      ctx.on('submit', '[data-edit]', async (event, form) => {
        event.preventDefault();
        const item = ctx.item;
        await withBusy(form.querySelector('[type="submit"]'), async () => {
          try {
            const patch = { details: readOwnedDetails(form, item.category) };
            if (item.custom) {
              patch.custom = {
                brand: form.elements['custom.brand'].value,
                name: form.elements['custom.name'].value,
                variantName: form.elements['custom.variantName'].value,
              };
            }
            await ctx.api.updateOwned({ itemId: item.id, patch });
            toast('Saved');
            ctx.navigate(`/collection/${encodeURIComponent(item.id)}`, { replace: true });
          } catch (error) {
            if (!showFieldErrors(form, error)) toastError(error);
          }
        });
      });
      return off;
    },
  },
];
