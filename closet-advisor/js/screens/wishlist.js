// Wishlist: saved items, one item with its wish settings, and "help me choose" between up to three.
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import * as fmt from '../lib/format.js';
import { idempotencyKey } from '../lib/ids.js';
import { WISH_REASON_LABEL, WISH_INTENT_LABEL } from '../data/schema.js';
import {
  screenHead,
  backHead,
  itemTile,
  media,
  label,
  identityStamps,
  wishBlock,
  facts,
  notice,
  emptyState,
  thumb,
  priceLine,
  availabilityBadge,
  relatedChips,
  demoNote,
} from '../ui/components.js';
import {
  wishFields,
  readWish,
  bindWishFields,
  bindUsualSize,
  ownedDetailsFields,
  readOwnedDetails,
  profileSizeFor,
  createWithDuplicateCheck,
} from '../ui/item-forms.js';
import { webSnapshot } from '../ui/web-product.js';
import { pill } from '../ui/screen-kit.js';
import { confirmDialog, openSheet, toast, toastError, withBusy, showFieldErrors } from '../lib/ui.js';

const BUDGET_COPY = {
  within: (b) => `${fmt.money(b.differenceMinor)} under your target`,
  over: (b) => `${fmt.money(b.differenceMinor)} over your target`,
  unknown: () => 'Price or target unknown',
};

export default [
  {
    path: '/wishlist',
    title: 'Wishlist',
    tab: 'wishlist',
    roles: ['user'],
    async render(ctx) {
      const status = ctx.query.status === 'purchased' ? 'purchased' : 'active';
      const data = await ctx.api.listWishlist({ status });
      const comparing = ctx.query.pick === '1' && status === 'active';
      return html`<div class="stack stack-lg">
        ${screenHead({
          title: 'Wishlist',
          lede: 'Things you want, with the size, condition and price you want them at.',
          actions: html`<a class="btn btn-primary" href="#/add?dest=wishlist">${icon('plus')}Add</a>`,
        })}
        <div class="spread">
          <div class="cluster">
            ${pill('#/wishlist', 'Wanted', status === 'active', data.counts.active)}
            ${pill('#/wishlist?status=purchased', 'Bought', status === 'purchased', data.counts.purchased)}
          </div>
          ${status === 'active' && data.items.length > 1
            ? comparing
              ? html`<a class="link-btn" href="#/wishlist">Cancel</a>`
              : html`<a class="btn btn-secondary btn-sm" href="#/wishlist?pick=1">${icon('compare')}Help me choose</a>`
            : ''}
        </div>
        ${comparing
          ? html`<form class="stack" data-compare>
              <p>Choose up to three to compare.</p>
              <ul class="list">${data.items.map(
                (w) => html`<li><label class="choice">
                  <input type="checkbox" name="ids" value="${w.id}">
                  <span class="list-thumb">${thumb(w.image, '', w.category)}</span>
                  <span class="choice-body"><span class="choice-title">${w.brandName} ${w.title}</span><span class="choice-hint">${w.subtitle ?? ''}</span></span>
                </label></li>`,
              )}</ul>
              <button type="submit" class="btn btn-primary btn-block">${icon('compare')}Compare</button>
            </form>`
          : data.items.length
            ? html`<div class="tile-grid">${data.items.map((w) => itemTile(w, { state: 'wishlist', href: `#/wishlist/${encodeURIComponent(w.id)}` }))}</div>`
            : status === 'purchased'
              ? emptyState({ iconName: 'heart', title: 'Nothing bought yet', body: "When you buy something from your wishlist, mark it bought and it moves to your collection." })
              : emptyState({
                  iconName: 'heart',
                  title: 'Your wishlist is empty',
                  body: 'Save suggestions from Discover, or add something you want.',
                  actions: html`<a class="btn btn-primary" href="#/discover">Browse suggestions</a><a class="btn btn-secondary" href="#/add?dest=wishlist">Add an item</a>`,
                })}
      </div>`;
    },
    mount(root, ctx) {
      ctx.on('change', '[data-compare] input[name="ids"]', (event, input) => {
        const form = input.form;
        const checked = form.querySelectorAll('input[name="ids"]:checked');
        if (checked.length > 3) {
          input.checked = false;
          toast('Choose up to three');
        }
      });
      ctx.on('submit', '[data-compare]', (event, form) => {
        event.preventDefault();
        const ids = [...form.querySelectorAll('input[name="ids"]:checked')].map((el) => el.value);
        if (!ids.length) {
          toast('Choose at least one item');
          return;
        }
        ctx.navigate(`/wishlist/compare?ids=${ids.map(encodeURIComponent).join(',')}`);
      });
    },
  },
  {
    path: '/wishlist/compare',
    title: 'Help me choose',
    tab: 'wishlist',
    roles: ['user'],
    async render(ctx) {
      const ids = (ctx.query.ids ?? '').split(',').filter(Boolean);
      if (!ids.length) {
        return html`${backHead({ title: 'Help me choose', back: '#/wishlist' })}${emptyState({ iconName: 'compare', title: 'Nothing to compare', actions: html`<a class="btn btn-primary" href="#/wishlist?pick=1">Choose items</a>` })}`;
      }
      const result = await ctx.api.helpMeChoose({ wishlistIds: ids });
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Help me choose', back: '#/wishlist' })}
        ${result.summary.length
          ? html`<section class="panel stack stack-sm"><h2>What stands out</h2><ul class="stack stack-xs">${result.summary.map((s) => html`<li>${s}</li>`)}</ul></section>`
          : ''}
        <div class="tile-grid">${result.items.map(
          (it) => html`<article class="stack stack-sm">
            <a class="tile-link" href="#/wishlist/${encodeURIComponent(it.wishId)}">
              ${media(it.view.image, { alt: `${it.view.brandName} ${it.view.title}`, category: it.view.category })}
              ${label({ brand: it.view.brandName, name: it.view.title, variant: it.view.subtitle, code: it.view.code, state: 'wishlist' })}
            </a>
            ${priceLine(it.price)}
            ${availabilityBadge(it.availability, it.size)}
            <p class="small">${(BUDGET_COPY[it.budget?.status] ?? BUDGET_COPY.unknown)(it.budget ?? {})}</p>
            ${it.pairsWith?.length ? html`<p class="small muted">Goes with</p>${relatedChips(it.pairsWith)}` : ''}
            ${it.similarOwned?.length ? html`<p class="small muted">Close to what you own</p>${relatedChips(it.similarOwned)}` : ''}
            ${it.notes?.map((n) => html`<p class="small muted">${n}</p>`)}
          </article>`,
        )}</div>
        ${demoNote()}
      </div>`;
    },
  },
  {
    path: '/wishlist/:id',
    title: (ctx) => ctx.itemTitle ?? 'Wishlist item',
    tab: 'wishlist',
    roles: ['user'],
    async render(ctx) {
      const [item, profile, owned] = await Promise.all([
        ctx.api.getWishlistItem({ itemId: ctx.params.id }),
        ctx.api.getProfile({}),
        ctx.api.listOwned({}),
      ]);
      let sizing = null;
      if (item.productId) sizing = (await ctx.api.getProduct({ productId: item.productId })).product.sizing;
      const type = item.product?.type ?? item.custom?.type ?? undefined;
      ctx.item = item;
      ctx.itemTitle = `${item.brandName} ${item.title}`;
      ctx.formOpts = { category: item.category, type, sizing, usual: profileSizeFor(profile, item.category, type) };
      const id = encodeURIComponent(item.id);
      const active = item.status === 'active';
      return html`<div class="stack stack-lg">
        ${backHead({ title: item.title, back: '#/wishlist' })}
        ${item.status === 'purchased'
          ? notice({ tone: 'ok', title: 'You bought this', body: item.purchasedOwned ? html`It's in your collection. <a href="#/collection/${encodeURIComponent(item.purchasedOwned.id)}">Open it</a>` : null })
          : ''}
        <div class="split">
          <div class="stack">
            ${media(item.image, { alt: ctx.itemTitle, category: item.category, wide: true })}
            ${item.image?.fallbackReason ? html`<p class="small muted">${item.image.fallbackReason}</p>` : ''}
            ${item.image?.attribution ? html`<p class="xsmall muted">${item.image.attribution}</p>` : ''}
          </div>
          <div class="stack stack-lg">
            ${label({ brand: item.brandName, name: item.title, variant: item.subtitle, code: item.code, block: wishBlock(item), state: 'wishlist', stamps: identityStamps(item.identity, item.category) })}
            ${item.ownedCopies ? notice({ tone: 'warn', body: `You already own ${fmt.plural(item.ownedCopies, 'copy', 'copies')} of this version.` }) : ''}
            ${webSnapshot(item.web)}
            <div class="button-row">
              ${item.productId && item.variantId ? html`<a class="btn btn-primary" href="#/product/${encodeURIComponent(item.productId)}?variant=${encodeURIComponent(item.variantId)}${item.desired?.size ? `&size=${encodeURIComponent(item.desired.size.value)}` : ''}&condition=${item.desired?.condition ?? 'new_only'}">${icon('store')}View offers</a>` : ''}
              <a class="btn btn-secondary" href="#/recs?mode=alternatives&seed=${id}&seedType=wishlist">${icon('swap')}Find alternatives</a>
            </div>
            ${facts([
              ['Why', WISH_REASON_LABEL[item.reason] ?? null],
              ['Looking for', WISH_INTENT_LABEL[item.intent] ?? null],
              ['Size', fmt.size(item.desired?.size)],
              ['Condition', item.desired?.condition === 'new_or_used' ? 'New or used' : 'New only'],
              ['Target price', item.targetPriceMinor != null ? fmt.money(item.targetPriceMinor, item.currency) : null],
              ['Saved', fmt.date(item.createdAt)],
            ])}
            ${item.linkedOwned?.length ? html`<div class="stack stack-xs"><span class="small muted">Goes with</span>${relatedChips(item.linkedOwned.map((o) => ({ itemId: o.id, itemType: 'owned', title: o.title, imageUrl: o.image?.url, photoId: o.image?.photoId })))}</div>` : ''}
            ${active
              ? html`<details class="panel">
                  <summary><strong>Edit what you want</strong></summary>
                  <form class="stack" data-wish-edit novalidate style="margin-top: var(--s4)">
                    ${wishFields({ ...ctx.formOpts, values: item, ownedItems: owned.items })}
                    <button type="submit" class="btn btn-primary">Save changes</button>
                  </form>
                </details>
                <div class="button-row">
                  <button type="button" class="btn btn-secondary" data-bought>${icon('check')}I bought it</button>
                  <button type="button" class="btn btn-ghost" data-remove>${icon('trash')}Remove</button>
                </div>`
              : ''}
          </div>
        </div>
      </div>`;
    },
    mount(root, ctx) {
      const item = ctx.item;
      const offs = [bindWishFields(root), bindUsualSize(root)];
      ctx.on('submit', '[data-wish-edit]', async (event, form) => {
        event.preventDefault();
        await withBusy(form.querySelector('[type="submit"]'), async () => {
          try {
            const wish = readWish(form);
            await ctx.api.updateWishlist({ itemId: item.id, patch: wish });
            toast('Saved');
            ctx.refresh();
          } catch (error) {
            if (!showFieldErrors(form, error)) toastError(error);
          }
        });
      });
      ctx.on('click', '[data-remove]', async (event, button) => {
        await withBusy(button, async () => {
          const ok = await confirmDialog({ title: 'Remove from your wishlist?', confirmLabel: 'Remove', tone: 'danger' });
          if (!ok) return;
          try {
            await ctx.api.removeWishlist({ itemId: item.id });
            toast('Removed');
            ctx.navigate('/wishlist', { replace: true });
          } catch (error) {
            toastError(error);
          }
        });
      });
      ctx.on('click', '[data-bought]', async () => {
        const key = idempotencyKey();
        const result = await openSheet({
          title: 'Move to your collection',
          body: html`<form class="stack" data-bought-form novalidate>
            <p class="small muted">Add what you know. The size you wanted isn't assumed.</p>
            ${ownedDetailsFields({ ...ctx.formOpts, values: {} })}
            <button type="submit" class="btn btn-primary btn-block">Add to collection</button>
          </form>`,
          onMount(el, close) {
            const off = bindUsualSize(el);
            el.querySelector('form').addEventListener('submit', async (event) => {
              event.preventDefault();
              const form = event.target;
              await withBusy(form.querySelector('[type="submit"]'), async () => {
                try {
                  const details = readOwnedDetails(form, item.category);
                  const out = await createWithDuplicateCheck(
                    ({ allowDuplicate }) => ctx.api.markPurchased({ itemId: item.id, details, allowDuplicate, idempotencyKey: allowDuplicate ? `${key}-dup` : key }),
                    { dest: 'owned', navigate: (path) => close({ navigate: path }) },
                  );
                  if (out) close({ owned: out.owned });
                } catch (error) {
                  if (!showFieldErrors(form, error)) toastError(error);
                }
              });
            });
            return off;
          },
        });
        if (result?.owned) {
          toast('Added to your collection');
          ctx.navigate(`/collection/${encodeURIComponent(result.owned.id)}`);
        } else if (result?.navigate) {
          ctx.navigate(result.navigate);
        }
      });
      return () => offs.forEach((off) => off());
    },
  },
];
