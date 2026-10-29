// Outfits: named sets of items from the person's collection. List, build, view, edit, delete,
// and suggested combinations of the person's own items.
import { html, safeUrl } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import * as fmt from '../lib/format.js';
import { idempotencyKey } from '../lib/ids.js';
import { CATEGORY_LABEL, OUTFIT_LIMITS } from '../data/schema.js';
import { screenHead, backHead, itemTile, thumb, notice, emptyState, facts, field } from '../ui/components.js';
import { collectionTabs } from '../ui/screen-kit.js';
import { confirmDialog, toast, toastError, withBusy, showFieldErrors } from '../lib/ui.js';
import { href as routeHref } from '../lib/router.js';
import { outfitPart } from '../engine/recommend.js';

// Head to toe: the order the form lists items in, so outfits are saved in it too. Accessories
// are watches and straps; clothing saved without a type we know goes under Other clothing.
const PART_GROUPS = [
  { id: 'top', label: 'Tops', parts: ['top'] },
  { id: 'outer', label: 'Jackets', parts: ['outer'] },
  { id: 'bottom', label: 'Bottoms', parts: ['bottom'] },
  { id: 'other', label: 'Other clothing', parts: [null] },
  { id: 'feet', label: 'Shoes', parts: ['feet'] },
  { id: 'accessory', label: 'Accessories', parts: ['wrist', 'strap'] },
];
const OTHER = PART_GROUPS[3];
const groupOf = (item) => PART_GROUPS.find((g) => g.parts.includes(outfitPart(item.category, item.product?.type ?? item.custom?.type))) ?? OTHER;
const itemName = (item) => [item.brandName, item.title].filter(Boolean).join(' ');
const NEED_WORD = { top: 'a top or jacket', bottom: 'bottoms', feet: 'shoes' };
// Collections longer than this get a box that narrows the item list.
const FILTER_FROM = 6;

const findText = (text) => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

const outfitHref = (id) => `#/outfits/${encodeURIComponent(id)}`;

// The outfit whose page last sent the person to its edit form with a plain click, so saving can
// step back to that page instead of stacking a second copy of it in the history. Arriving any
// other way (Back, Forward, a bookmark) leaves it unset.
let editOpenedFrom = null;

function chosenText(n) {
  if (n === 0) return 'None chosen yet';
  if (n < OUTFIT_LIMITS.minItems) return '1 chosen. Choose one more.';
  if (n > OUTFIT_LIMITS.maxItems) return `${n} chosen. Choose up to ${OUTFIT_LIMITS.maxItems}.`;
  return `${n} chosen`;
}

/** Up to four thumbnails of an outfit's items; the last cell counts the rest. */
function mosaic(outfit) {
  const shown = outfit.items.slice(0, 4);
  const extra = outfit.itemCount - shown.length;
  if (!shown.length) return html`<div class="outfit-mosaic" data-count="1" aria-hidden="true"><span>${icon('layers')}</span></div>`;
  return html`<div class="outfit-mosaic" data-count="${shown.length}" aria-hidden="true">
    ${shown.map((item, i) => html`<span>${thumb(item.image, '', item.category)}${extra > 0 && i === 3 ? html`<span class="outfit-more">+${extra}</span>` : ''}</span>`)}
  </div>`;
}

function outfitCard(outfit) {
  return html`<article class="outfit-card">
    <a class="outfit-card-link" href="${outfitHref(outfit.id)}">
      ${mosaic(outfit)}
      <span class="outfit-card-text">
        <span class="outfit-card-name">${outfit.name}</span>
        <span class="small muted">${fmt.plural(outfit.itemCount, 'item')}</span>
        ${outfit.incomplete ? html`<span class="small outfit-needs">Needs another item</span>` : ''}
      </span>
    </a>
  </article>`;
}

// Nothing in the Suggested section uses emptyState (section.state) or the .outfit-card classes:
// those name the saved outfits.
function suggestionCard(s, i) {
  return html`<article class="outfit-suggestion" data-suggestion="${s.key}" aria-labelledby="suggestion-${i}">
    ${mosaic({ items: s.items, itemCount: s.items.length })}
    <div class="outfit-suggestion-text">
      <h3 class="outfit-suggestion-name" id="suggestion-${i}">${s.name}</h3>
      <p class="small muted" data-suggestion-items>${fmt.listJoin(s.items.map(itemName))}</p>
      <p class="small" data-suggestion-why>${s.reasons.join(' ')}</p>
    </div>
    <div class="button-row outfit-suggestion-actions">
      <a class="btn btn-secondary" href="${safeUrl(routeHref('/outfits/new', { items: s.itemIds, name: s.name }))}" aria-describedby="suggestion-${i}" data-suggestion-save>${icon('layers')}Save this outfit</a>
    </div>
  </article>`;
}

function noSuggestions({ emptyReason, missing }) {
  const text =
    emptyReason === 'missing'
      ? `Suggestions need shoes, bottoms and a top or jacket from your collection. Add ${fmt.listJoin(missing.map((p) => NEED_WORD[p]))} to get some.`
      : emptyReason === 'all_saved'
        ? "You've saved every combination we'd suggest from your items. Add more items to get new ideas."
        : 'None of your items pair well enough by color for us to suggest an outfit yet. You can still build your own.';
  return html`<div class="panel stack stack-sm" data-suggestions-none>
    <p>${text}</p>
    <div class="button-row"><a class="btn btn-secondary" href="#/add?dest=owned">${icon('plus')}Add an item</a></div>
  </div>`;
}

function suggestionsSection(ideas) {
  const skipped = ideas.leftOut.noType + ideas.leftOut.noColors;
  return html`<section class="stack stack-sm" aria-labelledby="outfits-suggested" data-suggestions>
    <div class="stack stack-xs">
      <h2 id="outfits-suggested">Suggested for you</h2>
      <p class="small muted">Made from items you own. Combinations you've already saved aren't suggested again.</p>
    </div>
    ${ideas.suggestions.length ? html`<div class="outfit-suggestions">${ideas.suggestions.map(suggestionCard)}</div>` : noSuggestions(ideas)}
    ${skipped
      ? html`<p class="small muted" data-suggestions-skipped>${fmt.plural(skipped, 'item')} ${skipped === 1 ? "isn't" : "aren't"} used in suggestions, because we need to know an item's type and colors to pair it.</p>`
      : ''}
  </section>`;
}

/** Shown on /outfits and /outfits/new when the collection can't make an outfit yet. */
function needItemsState(count) {
  return emptyState({
    iconName: 'layers',
    title: 'Add a few items first',
    body: `An outfit needs at least two items from your collection. You have ${fmt.plural(count, 'item')} now.`,
    actions: html`<a class="btn btn-primary" href="#/add?dest=owned">${icon('plus')}Add an item</a>`,
  });
}

function notFoundState() {
  return html`<div class="stack stack-lg">
    ${backHead({ title: 'Outfit not found', back: '#/outfits' })}
    ${emptyState({
      iconName: 'layers',
      title: "This outfit isn't here",
      body: 'It may have been deleted, or it was saved in another browser.',
      actions: html`<a class="btn btn-primary" href="#/outfits">Back to outfits</a>`,
    })}
  </div>`;
}

/** Loads an outfit for a screen, or null when it doesn't exist (or isn't the person's). */
async function findOutfit(ctx) {
  try {
    return await ctx.api.getOutfit({ outfitId: ctx.params.id });
  } catch (error) {
    if (error?.code === 'not_found') return null;
    throw error;
  }
}

function choice(item, checked) {
  const words = findText([item.brandName, item.title, item.subtitle, CATEGORY_LABEL[item.category], item.product?.typeLabel ?? item.custom?.type, groupOf(item).label].join(' '));
  return html`<label class="choice" data-find="${words}"><input type="checkbox" name="itemIds" value="${item.id}" ${checked ? html`checked` : ''}>
    <span class="list-thumb">${thumb(item.image, '', item.category)}</span>
    <span class="choice-body"><span class="choice-title">${item.brandName} ${item.title}</span><span class="choice-hint">${item.subtitle ?? ''}${item.archivedAt ? ', archived' : ''}</span></span>
  </label>`;
}

/**
 * Name, the items to choose from (grouped by part, head to toe) and notes.
 * @param {{ values: { name?: string, itemIds?: string[], notes?: string }, items: any[], submitLabel: string, cancelHref: string }} opts
 */
function outfitForm({ values, items, submitLabel, cancelHref }) {
  const chosen = new Set(values.itemIds ?? []);
  const groups = PART_GROUPS.map((g) => [g, items.filter((i) => groupOf(i) === g)]).filter(([, list]) => list.length);
  return html`<form class="stack stack-lg" data-outfit-form novalidate>
    ${field({ label: 'Name', name: 'name', value: values.name ?? '', required: true, placeholder: 'Weekend errands', attrs: `maxlength="${OUTFIT_LIMITS.nameMax}" autocomplete="off"` })}
    <fieldset class="field outfit-items">
      <legend class="field-label">Items</legend>
      <p class="field-hint" data-outfit-hint>Choose ${OUTFIT_LIMITS.minItems} to ${OUTFIT_LIMITS.maxItems} items. <span data-outfit-count aria-live="polite">${chosenText(chosen.size)}</span></p>
      ${items.length > FILTER_FROM
        ? html`<div class="search-field">
            ${icon('search')}
            <label class="visually-hidden" for="f-outfit-find">Find an item</label>
            <input class="input" id="f-outfit-find" type="search" placeholder="Find an item" autocomplete="off" data-outfit-find>
          </div>
          <p class="small muted" data-outfit-none hidden>No items match. Items you already chose stay chosen.</p>`
        : ''}
      ${groups.map(
        ([group, list]) => html`<div class="stack stack-sm" role="group" aria-labelledby="og-${group.id}" data-outfit-group="${group.id}">
          <h2 class="outfit-group" id="og-${group.id}">${group.label}</h2>
          ${list.map((item) => choice(item, chosen.has(item.id)))}
        </div>`,
      )}
    </fieldset>
    ${field({ label: 'Notes', name: 'notes', type: 'textarea', value: values.notes ?? '', optional: true, placeholder: 'When you wear it, what you might swap in', attrs: `maxlength="${OUTFIT_LIMITS.notesMax}"` })}
    <div class="button-row">
      <button type="submit" class="btn btn-primary">${submitLabel}</button>
      <a class="btn btn-ghost" href="${cancelHref}" data-back>Cancel</a>
    </div>
  </form>`;
}

function readOutfitForm(form) {
  return {
    name: form.elements.name.value,
    itemIds: [...form.querySelectorAll('input[name="itemIds"]:checked')].map((el) => el.value),
    notes: form.elements.notes.value,
  };
}

/**
 * Wires the form: the live "chosen" count, the item filter, saving, and errors.
 * `save(values)` returns the saved OutfitView, or null when there was nothing to save, and
 * `done(outfit)` leaves the form. Items deleted since the form opened are taken off the list.
 */
function bindOutfitForm(ctx, { save, saved, done }) {
  const checkedCount = (form) => form.querySelectorAll('input[name="itemIds"]:checked').length;
  const updateCount = (form) => {
    const out = form.querySelector('[data-outfit-count]');
    if (out) out.textContent = chosenText(checkedCount(form));
  };
  ctx.on('change', '[data-outfit-form] input[name="itemIds"]', (event, input) => {
    if (input.checked && checkedCount(input.form) > OUTFIT_LIMITS.maxItems) {
      input.checked = false;
      toast(`Choose up to ${OUTFIT_LIMITS.maxItems} items`);
    }
    updateCount(input.form);
  });
  // Narrowing the list only hides rows; chosen items stay chosen and are saved.
  ctx.on('input', '[data-outfit-find]', (event, input) => {
    const form = input.form;
    const words = findText(input.value).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const row of form.querySelectorAll('.choice[data-find]')) {
      row.hidden = !words.every((w) => row.dataset.find.includes(w));
      if (!row.hidden) shown += 1;
    }
    for (const group of form.querySelectorAll('[data-outfit-group]')) group.hidden = !group.querySelector('.choice:not([hidden])');
    form.querySelector('[data-outfit-none]').hidden = shown > 0;
  });
  // Enter in the filter box narrows the list; it doesn't save the outfit.
  ctx.on('keydown', '[data-outfit-find]', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
  ctx.on('submit', '[data-outfit-form]', async (event, form) => {
    event.preventDefault();
    await withBusy(form.querySelector('[type="submit"]'), async () => {
      try {
        const outfit = await save(readOutfitForm(form));
        toast(outfit ? saved : 'Nothing changed');
        done(outfit);
      } catch (error) {
        for (const id of error?.details?.missingItemIds ?? []) form.querySelector(`input[name="itemIds"][value="${CSS.escape(id)}"]`)?.closest('.choice')?.remove();
        updateCount(form);
        if (!showFieldErrors(form, error)) {
          toastError(error);
          return;
        }
        // The item list's error belongs under its hint, not after the last item.
        const note = form.querySelector('.field-error[data-for="itemIds"]');
        if (note) {
          form.querySelector('[data-outfit-hint]').after(note);
          note.closest('fieldset').setAttribute('aria-describedby', note.id);
        }
        // The filter may hide the item that showFieldErrors tried to focus; keep focus in the
        // list (or on the filter box when nothing shows) so keyboard users aren't left on <body>.
        if (!form.contains(document.activeElement)) {
          (form.querySelector('.choice:not([hidden]) input[name="itemIds"]') ?? form.querySelector('[data-outfit-find]'))?.focus();
        }
        // Focusing the field scrolls only as far as the field, which can leave it and its error
        // under the sticky header; bring the first error to the middle of the screen.
        form.querySelector('.field-error')?.scrollIntoView({ block: 'center' });
      }
    });
  });
}

export default [
  {
    path: '/outfits',
    title: 'Outfits',
    tab: 'collection',
    roles: ['user'],
    async render(ctx) {
      const [data, owned, ideas] = await Promise.all([ctx.api.listOutfits({}), ctx.api.listOwned({}), ctx.api.suggestOutfits({})]);
      const canBuild = owned.collectionTotal >= OUTFIT_LIMITS.minItems;
      return html`<div class="stack stack-lg outfits-screen">
        ${screenHead({
          title: 'Outfits',
          lede: data.total ? `${fmt.plural(data.total, 'outfit')} from your collection` : null,
          actions: canBuild ? html`<a class="btn btn-primary" href="#/outfits/new">${icon('plus')}New outfit</a>` : '',
        })}
        ${collectionTabs('outfits', { items: owned.collectionTotal, outfits: data.total })}
        ${data.outfits.length
          ? html`<section class="stack stack-sm" aria-labelledby="outfits-saved">
              <h2 id="outfits-saved">Saved</h2>
              <div class="tile-grid">${data.outfits.map(outfitCard)}</div>
            </section>`
          : canBuild
            ? emptyState({
                iconName: 'layers',
                title: 'No outfits yet',
                body: 'Put together items you own and save them as an outfit, so you can find the combination again.',
                actions: html`<a class="btn btn-primary" href="#/outfits/new">${icon('plus')}Build an outfit</a>`,
              })
            : needItemsState(owned.collectionTotal)}
        ${canBuild ? suggestionsSection(ideas) : ''}
      </div>`;
    },
  },
  {
    path: '/outfits/new',
    title: 'New outfit',
    tab: 'collection',
    roles: ['user'],
    async render(ctx) {
      const owned = await ctx.api.listOwned({});
      const active = new Set(owned.items.map((i) => i.id));
      // ?items=a,b (a suggestion) or ?item=a (an item's page) only preselect; nothing is saved until Save.
      const wanted = [...new Set(String(ctx.query.items ?? ctx.query.item ?? '').split(',').filter(Boolean))];
      const preset = wanted.filter((id) => active.has(id)).slice(0, OUTFIT_LIMITS.maxItems);
      const name = String(ctx.query.name ?? '').slice(0, OUTFIT_LIMITS.nameMax);
      const note =
        ctx.query.items == null || !wanted.length
          ? ''
          : preset.length < wanted.length
            ? notice({ tone: 'warn', body: "Some items from this suggestion are left out because they're archived or no longer in your collection." })
            : notice({ body: 'Suggested from items you own. Change the name or items if you like, then save.' });
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'New outfit', back: '#/outfits' })}
        ${owned.items.length >= OUTFIT_LIMITS.minItems
          ? html`${note}${outfitForm({ values: { name, itemIds: preset }, items: owned.items, submitLabel: 'Save outfit', cancelHref: '#/outfits' })}`
          : needItemsState(owned.items.length)}
      </div>`;
    },
    mount(root, ctx) {
      // One key per visit to this form, so a double tap or a retry can't save two outfits.
      const key = idempotencyKey();
      bindOutfitForm(ctx, {
        save: (values) => ctx.api.createOutfit({ ...values, idempotencyKey: key }),
        saved: 'Outfit saved',
        // The new outfit takes the form's place, so Back from it doesn't reopen a used form.
        done: (outfit) => ctx.navigate(`/outfits/${encodeURIComponent(outfit.id)}`, { replace: true }),
      });
    },
  },
  {
    path: '/outfits/:id',
    title: (ctx) => ctx.outfitTitle ?? 'Outfit',
    tab: 'collection',
    roles: ['user'],
    async render(ctx) {
      const outfit = await findOutfit(ctx);
      ctx.outfit = outfit;
      if (!outfit) return notFoundState();
      ctx.outfitTitle = outfit.name;
      const edit = `${outfitHref(outfit.id)}/edit`;
      return html`<div class="stack stack-lg outfit-detail">
        ${backHead({ title: outfit.name, back: '#/outfits', actions: html`<a class="icon-btn" href="${edit}" aria-label="Edit outfit" data-edit-outfit>${icon('edit')}</a>` })}
        ${outfit.incomplete
          ? notice({
              tone: 'warn',
              title: outfit.itemCount ? 'Only one item is left in this outfit' : 'This outfit has no items left',
              body: 'Items you delete from your collection are taken out of your outfits. Add another item, or delete this outfit.',
            })
          : ''}
        ${outfit.notes ? html`<p class="panel outfit-notes">${outfit.notes}</p>` : ''}
        <section class="stack stack-sm">
          <h2>${fmt.plural(outfit.itemCount, 'item')}</h2>
          ${outfit.items.length
            ? html`<div class="tile-grid">${outfit.items.map((item) => itemTile(item, { state: 'owned', href: `#/collection/${encodeURIComponent(item.id)}` }))}</div>`
            : html`<p class="muted small">No items left.</p>`}
        </section>
        ${facts([
          ['Created', fmt.date(outfit.createdAt)],
          ['Last changed', fmt.relative(outfit.updatedAt)],
        ])}
        <section class="stack stack-sm">
          <h2>Manage</h2>
          <div class="button-row">
            <a class="btn btn-secondary btn-sm" href="${edit}" data-edit-outfit>${icon('edit')}Edit outfit</a>
            <button type="button" class="btn btn-danger btn-sm" data-delete-outfit>${icon('trash')}Delete outfit</button>
          </div>
        </section>
      </div>`;
    },
    mount(root, ctx) {
      const outfit = ctx.outfit;
      if (!outfit) return;
      ctx.on('click', '[data-edit-outfit]', (event) => {
        // A click that opens a new tab or window doesn't navigate this one.
        const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
        editOpenedFrom = plain ? outfit.id : null;
      });
      ctx.on('click', '[data-delete-outfit]', (event, button) =>
        withBusy(button, async () => {
          const ok = await confirmDialog({
            title: 'Delete this outfit?',
            message: `“${outfit.name}” is removed. The items in it stay in your collection.`,
            confirmLabel: 'Delete outfit',
            tone: 'danger',
          });
          if (!ok) return;
          try {
            await ctx.api.deleteOutfit({ outfitId: outfit.id });
            toast('Outfit deleted');
            ctx.navigate('/outfits', { replace: true });
          } catch (error) {
            toastError(error);
          }
        }),
      );
    },
  },
  {
    path: '/outfits/:id/edit',
    title: 'Edit outfit',
    tab: 'collection',
    roles: ['user'],
    async render(ctx) {
      const [outfit, owned] = await Promise.all([findOutfit(ctx), ctx.api.listOwned({ includeArchived: true })]);
      ctx.outfit = outfit;
      if (!outfit) return notFoundState();
      // Archived items are offered only when they are already in the outfit.
      const items = owned.items.filter((i) => !i.archivedAt || outfit.itemIds.includes(i.id));
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Edit outfit', back: outfitHref(outfit.id) })}
        ${items.length < OUTFIT_LIMITS.minItems
          ? notice({
              tone: 'warn',
              title: 'Not enough items to change what is in this outfit',
              body: html`An outfit needs at least two items, and you have ${fmt.plural(items.length, 'item')} to choose from. You can still rename it or change its notes. <a href="#/add?dest=owned">Add an item</a>`,
            })
          : ''}
        ${outfitForm({ values: outfit, items, submitLabel: 'Save changes', cancelHref: outfitHref(outfit.id) })}
      </div>`;
    },
    mount(root, ctx) {
      const outfit = ctx.outfit;
      const openedFromPage = Boolean(outfit) && editOpenedFrom === outfit.id;
      editOpenedFrom = null;
      if (!outfit) return;
      const page = `/outfits/${encodeURIComponent(outfit.id)}`;
      const sameItems = (ids) => [...ids].sort().join() === [...outfit.itemIds].sort().join();
      bindOutfitForm(ctx, {
        // Only what changed in this form is sent, so an edit made in another tab isn't
        // overwritten, and renaming works even when the outfit is down to one item.
        save: async (values) => {
          const patch = {};
          if (values.name !== outfit.name) patch.name = values.name;
          if (!sameItems(values.itemIds)) patch.itemIds = values.itemIds;
          if (values.notes !== outfit.notes) patch.notes = values.notes;
          return Object.keys(patch).length ? ctx.api.updateOutfit({ outfitId: outfit.id, patch }) : null;
        },
        saved: 'Saved',
        // Back to the outfit page when it opened the form, so one Back press then leaves the
        // outfit; opened any other way, the outfit page takes the form's place.
        done: () => (openedFromPage ? ctx.back(page) : ctx.navigate(page, { replace: true })),
      });
    },
  },
];
