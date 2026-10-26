// Small pieces several screens share: filter pills, recommendation actions and saving a
// suggestion to the wishlist.
import { html, cx } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { idempotencyKey } from '../lib/ids.js';
import { toast, toastError, withBusy } from '../lib/ui.js';
import { createWithDuplicateCheck } from './item-forms.js';

/** A chip-styled link that marks the current choice. */
export function pill(href, text, on, count) {
  return html`<a class="${cx('chip', on && 'is-selected')}" href="${href}" ${on ? html`aria-current="true"` : ''}>${text}${count != null ? html` <span class="count">${count}</span>` : ''}</a>`;
}

/**
 * The Items / Outfits switch under the head of /collection and /outfits.
 * @param {'items'|'outfits'} current
 * @param {{ items?: number, outfits?: number }} [counts]
 */
export function collectionTabs(current, counts = {}) {
  const tab = (id, href, text, count) =>
    html`<a href="${href}" ${current === id ? html`aria-current="page"` : ''}>${text}${count != null ? html`<span class="count">${count}</span>` : ''}</a>`;
  return html`<nav class="tabs" aria-label="Collection">${tab('items', '#/collection', 'Items', counts.items)}${tab('outfits', '#/outfits', 'Outfits', counts.outfits)}</nav>`;
}

/** Action row for a recommendation card. Feedback goes back to the request that showed it. */
export function recActions(item, requestId) {
  const btn = (attr, cls, content) =>
    html`<button type="button" class="${cls}" ${attr} data-product="${item.productId}" data-variant="${item.variantId}" data-category="${item.product.category}" data-request="${requestId ?? ''}">${content}</button>`;
  return html`${item.flags?.onWishlist ? '' : btn(html`data-rec-save`, 'btn btn-secondary btn-sm', html`${icon('heart')}Save to wishlist`)}
    ${btn(html`data-rec-feedback="more_like_this"`, 'btn btn-ghost btn-sm', 'More like this')}
    ${btn(html`data-rec-feedback="wrong_style"`, 'btn btn-ghost btn-sm', 'Not my style')}
    ${btn(html`data-rec-feedback="too_expensive"`, 'btn btn-ghost btn-sm', 'Too expensive')}`;
}

/** Wires recActions buttons for a screen. */
export function bindRecActions(ctx) {
  ctx.on('click', '[data-rec-save]', async (event, button) => {
    await withBusy(button, async () => {
      try {
        const key = idempotencyKey();
        const saved = await createWithDuplicateCheck(
          ({ allowDuplicate }) =>
            ctx.api.createWishlist({
              category: button.dataset.category,
              productId: button.dataset.product,
              variantId: button.dataset.variant,
              reason: 'like_style',
              desired: { condition: 'new_only' },
              source: 'catalog_search',
              allowDuplicate,
              idempotencyKey: allowDuplicate ? `${key}-dup` : key,
            }),
          { dest: 'wishlist', navigate: ctx.navigate },
        );
        if (saved) {
          toast('Saved to your wishlist', { action: { label: 'View', onClick: () => ctx.navigate(`/wishlist/${saved.id}`) } });
          button.remove();
        }
      } catch (error) {
        toastError(error);
      }
    });
  });
  ctx.on('click', '[data-rec-feedback]', async (event, button) => {
    await withBusy(button, async () => {
      try {
        const type = button.dataset.recFeedback;
        await ctx.api.giveFeedback({
          productId: button.dataset.product,
          variantId: button.dataset.variant,
          type,
          requestId: button.dataset.request || undefined,
          idempotencyKey: idempotencyKey(),
        });
        toast(type === 'more_like_this' ? "Got it. You'll see more like this." : "Thanks. You'll see fewer like this.", {
          action: { label: 'Update results', onClick: () => ctx.refresh() },
        });
      } catch (error) {
        toastError(error);
      }
    });
  });
}
