// Shared form pieces for owned and wishlist items: size by category, private details, wishlist
// intent, and the duplicate warning. Used by the add flow, match confirmation, product pages
// and "mark as purchased", so every entry point asks the same questions the same way.
import { html, raw } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import * as fmt from '../lib/format.js';
import { openSheet } from '../lib/ui.js';
import {
  ALPHA_SIZES,
  US_SHOE_SIZES,
  BOTTOM_TYPES,
  OWNED_CONDITIONS,
  OWNED_CONDITION_LABEL,
  WISH_REASONS,
  WISH_REASON_LABEL,
  WISH_INTENT_FOR_REASON,
  WISH_INTENT_LABEL,
  WISH_INTENTS,
} from '../data/schema.js';
import { field, selectField, thumb } from './components.js';
import { hydratePhotos } from './hydrate.js';

const WAISTS = ['28', '29', '30', '31', '32', '33', '34', '36', '38', '40'];
const INSEAMS = ['28', '30', '32', '34', '36'];

/** Which size control a product needs: 'shoe' | 'top' | 'bottom' | null (watches, straps). */
export function sizeKind(category, type) {
  if (category === 'sneaker') return 'shoe';
  if (category === 'clothing') return BOTTOM_TYPES.includes(type) ? 'bottom' : 'top';
  return null;
}

/** The person's usual size for a category/type from their profile, or null. */
export function profileSizeFor(profile, category, type) {
  const kind = sizeKind(category, type);
  return kind ? profile?.sizes?.[kind] ?? null : null;
}

/**
 * Size control. Sizes are never guessed from a photo: the field starts empty unless a value
 * is passed, and the person's usual size is offered as a one-tap choice.
 * @param {{ category: string, type?: string, sizing?: { system: string, sizes: string[] }|null,
 *   value?: { value: string, system: string }|null, usual?: { value: string, system: string }|null,
 *   name?: string, label?: string, optional?: boolean }} opts
 */
export function sizeField(opts) {
  const kind = sizeKind(opts.category, opts.type);
  if (!kind) return '';
  const name = opts.name ?? 'size';
  const label = opts.label ?? 'Size';
  const usualText = opts.usual ? fmt.size(opts.usual) : null;
  const usualButton = usualText
    ? html`<button type="button" class="chip" data-use-usual-size="${name}" data-value="${opts.usual.value}">Use my usual size (${usualText})</button>`
    : '';

  if (kind === 'bottom') {
    const [w, l] = (opts.value?.value ?? '').split('x');
    return html`<fieldset class="field" data-size-field="${name}" data-size-kind="bottom">
      <legend class="field-label">${label}${opts.optional !== false ? html` <span class="optional">(optional)</span>` : ''}</legend>
      <div class="grid-2">
        ${selectField({ label: 'Waist', name: `${name}.waist`, options: WAISTS.map((v) => ({ value: v, label: `${v} in` })), value: w ?? '', placeholder: 'Waist', id: `f-${name}-waist` })}
        ${selectField({ label: 'Inseam', name: `${name}.inseam`, options: INSEAMS.map((v) => ({ value: v, label: `${v} in` })), value: l ?? '', placeholder: 'Inseam', id: `f-${name}-inseam` })}
      </div>
      ${usualButton}
    </fieldset>`;
  }

  const sizes = kind === 'shoe' ? opts.sizing?.sizes ?? US_SHOE_SIZES : opts.sizing?.sizes ?? ALPHA_SIZES;
  const system = kind === 'shoe' ? opts.value?.system ?? opts.sizing?.system ?? 'US-M' : 'ALPHA';
  return html`<div class="field" data-size-field="${name}" data-size-kind="${kind}">
    ${selectField({
      label: kind === 'shoe' ? `${label} (${system === 'US-W' ? 'US women' : 'US men'})` : label,
      name: `${name}.value`,
      options: sizes.map((v) => ({ value: v, label: kind === 'shoe' ? `US ${v}` : v })),
      value: opts.value?.value ?? '',
      placeholder: 'Choose a size',
      optional: opts.optional !== false,
      id: `f-${name}-value`,
    })}
    <input type="hidden" name="${name}.system" value="${system}">
    ${usualButton}
  </div>`;
}

/** Reads a sizeField back into { value, system } or null. */
export function readSize(form, name = 'size') {
  const wrap = form.querySelector(`[data-size-field="${name}"]`);
  if (!wrap) return null;
  if (wrap.dataset.sizeKind === 'bottom') {
    const w = form.elements[`${name}.waist`]?.value;
    const l = form.elements[`${name}.inseam`]?.value;
    return w && l ? { value: `${w}x${l}`, system: 'WAIST-INSEAM' } : null;
  }
  const value = form.elements[`${name}.value`]?.value;
  const system = form.elements[`${name}.system`]?.value;
  return value ? { value, system } : null;
}

/** Wires "Use my usual size" buttons inside a container. Call from mount/onMount. */
export function bindUsualSize(container) {
  const handler = (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-use-usual-size]') : null;
    if (!button) return;
    const name = button.dataset.useUsualSize;
    const form = button.closest('form');
    const value = button.dataset.value;
    if (form.elements[`${name}.waist`]) {
      const [w, l] = value.split('x');
      form.elements[`${name}.waist`].value = w;
      form.elements[`${name}.inseam`].value = l;
    } else if (form.elements[`${name}.value`]) {
      form.elements[`${name}.value`].value = value;
    }
    button.setAttribute('aria-pressed', 'true');
  };
  container.addEventListener('click', handler);
  return () => container.removeEventListener('click', handler);
}

/**
 * Private details for an owned item. Everything is optional except what the person chooses
 * to enter; nothing here is inferred from a photo.
 * @param {{ category: string, type?: string, sizing?: any, values?: any, usual?: any }} opts
 */
export function ownedDetailsFields(opts) {
  const v = opts.values ?? {};
  const purchase = v.purchase ?? {};
  const today = new Date().toISOString().slice(0, 10);
  return html`<div class="form-grid">
    ${sizeField({ category: opts.category, type: opts.type, sizing: opts.sizing, value: v.size, usual: opts.usual })}
    ${selectField({
      label: 'Condition',
      name: 'condition',
      options: OWNED_CONDITIONS.map((c) => ({ value: c, label: OWNED_CONDITION_LABEL[c] })),
      value: v.condition ?? '',
      placeholder: 'Not set',
      optional: true,
    })}
    <div class="form-grid two">
      <div class="field">
        <label class="field-label" for="f-purchase-price">Price paid <span class="optional">(optional)</span></label>
        <div class="input-prefix"><span>$</span><input class="input" id="f-purchase-price" name="purchase.price" inputmode="decimal" autocomplete="off" value="${fmt.moneyInput(purchase.priceMinor)}"></div>
      </div>
      ${field({ label: 'Purchase date', name: 'purchase.date', type: 'date', value: purchase.date ?? '', optional: true, attrs: `max="${today}"` })}
    </div>
    ${field({ label: 'Bought from', name: 'purchase.from', value: purchase.from ?? '', optional: true, placeholder: 'Store or seller' })}
    ${field({ label: 'Notes', name: 'notes', type: 'textarea', value: v.notes ?? '', optional: true, hint: 'Private. Only you can see notes unless you choose to share them with a stylist.' })}
    ${opts.category === 'watch' && opts.type !== 'strap'
      ? field({
          label: 'Serial number',
          name: 'serialNumber',
          value: v.serialNumber ?? '',
          optional: true,
          attrs: 'autocomplete="off" spellcheck="false"',
          hint: "Private. It's never shared and isn't used to identify the model.",
        })
      : ''}
  </div>`;
}

/** Reads ownedDetailsFields into the details object the API expects. */
export function readOwnedDetails(form, category) {
  const val = (name) => form.elements[name]?.value?.trim() ?? '';
  const priceMinor = fmt.parseMoney(val('purchase.price'));
  const date = val('purchase.date') || null;
  const from = val('purchase.from') || null;
  return {
    size: readSize(form),
    condition: val('condition') || null,
    purchase: priceMinor != null || date || from ? { priceMinor, currency: 'USD', date, from } : null,
    notes: val('notes'),
    serialNumber: category === 'watch' ? val('serialNumber') || null : null,
  };
}

/**
 * Wishlist questions: why it was saved (which sets exact vs inspiration), size, condition and
 * target price.
 * @param {{ category: string, type?: string, sizing?: any, values?: any, usual?: any, ownedItems?: any[] }} opts
 */
export function wishFields(opts) {
  const v = opts.values ?? {};
  const reason = v.reason ?? 'like_style';
  const intent = v.intent ?? WISH_INTENT_FOR_REASON[reason];
  const linked = new Set(v.linkedOwnedIds ?? []);
  return html`<div class="form-grid" data-wish-fields>
    ${selectField({ label: 'Why are you saving it?', name: 'reason', options: WISH_REASONS.map((r) => ({ value: r, label: WISH_REASON_LABEL[r] })), value: reason })}
    <fieldset class="stack stack-sm">
      <legend class="field-label">What should we look for?</legend>
      ${WISH_INTENTS.map(
        (i) => html`<label class="choice"><input type="radio" name="intent" value="${i}" ${i === intent ? raw('checked') : ''}><span class="choice-body"><span class="choice-title">${WISH_INTENT_LABEL[i]}</span></span></label>`,
      )}
    </fieldset>
    ${opts.ownedItems?.length
      ? html`<fieldset class="stack stack-sm" data-linked-owned ${intent === 'complement' ? '' : raw('hidden')}>
          <legend class="field-label">Goes with <span class="optional">(optional)</span></legend>
          ${opts.ownedItems.map(
            (item) => html`<label class="choice"><input type="checkbox" name="linkedOwnedIds" value="${item.id}" ${linked.has(item.id) ? raw('checked') : ''}>
              <span class="list-thumb">${thumb(item.image, '', item.category)}</span>
              <span class="choice-body"><span class="choice-title">${item.brandName} ${item.title}</span><span class="choice-hint">${item.subtitle}</span></span></label>`,
          )}
        </fieldset>`
      : ''}
    ${sizeField({ category: opts.category, type: opts.type, sizing: opts.sizing, value: v.desired?.size, usual: opts.usual, label: 'Size you want' })}
    ${selectField({
      label: 'Condition',
      name: 'desiredCondition',
      options: [
        { value: 'new_only', label: 'New only' },
        { value: 'new_or_used', label: 'New or used' },
      ],
      value: v.desired?.condition ?? 'new_only',
    })}
    <div class="field">
      <label class="field-label" for="f-target-price">Target price <span class="optional">(optional)</span></label>
      <div class="input-prefix"><span>$</span><input class="input" id="f-target-price" name="targetPrice" inputmode="decimal" autocomplete="off" value="${fmt.moneyInput(v.targetPriceMinor)}"></div>
      <p class="field-hint">Offers are compared against this at the prices we checked.</p>
    </div>
  </div>`;
}

/** Keeps the intent radio in step with the reason, and shows "Goes with" for complements. */
export function bindWishFields(container) {
  const onChange = (event) => {
    const form = event.target.closest?.('form');
    if (!form) return;
    if (event.target.name === 'reason') {
      const intent = WISH_INTENT_FOR_REASON[event.target.value];
      const radio = form.querySelector(`input[name="intent"][value="${intent}"]`);
      if (radio) radio.checked = true;
    }
    if (event.target.name === 'reason' || event.target.name === 'intent') {
      const linked = form.querySelector('[data-linked-owned]');
      const intent = form.querySelector('input[name="intent"]:checked')?.value;
      if (linked) linked.hidden = intent !== 'complement';
    }
  };
  container.addEventListener('change', onChange);
  return () => container.removeEventListener('change', onChange);
}

/** Reads wishFields into createWishlist/updateWishlist arguments. */
export function readWish(form) {
  const reason = form.elements.reason?.value ?? 'like_style';
  const intent = form.querySelector('input[name="intent"]:checked')?.value ?? WISH_INTENT_FOR_REASON[reason];
  return {
    reason,
    intent,
    linkedOwnedIds: [...form.querySelectorAll('input[name="linkedOwnedIds"]:checked')].map((el) => el.value),
    desired: {
      size: readSize(form),
      condition: form.elements.desiredCondition?.value ?? 'new_only',
      variantFlexible: intent !== 'exact',
    },
    targetPriceMinor: fmt.parseMoney(form.elements.targetPrice?.value),
  };
}

/**
 * Explains a duplicate and asks what to do.
 * @param {any[]} duplicates OwnedView or WishlistView records from ApiError('duplicate').details
 * @param {{ dest: 'owned'|'wishlist' }} opts
 * @returns {Promise<'add'|{ view: string }|null>}
 */
export function duplicateDialog(duplicates, { dest }) {
  const where = dest === 'wishlist' ? 'wishlist' : 'collection';
  const first = duplicates[0];
  return openSheet({
    title: dest === 'wishlist' ? 'Already on your wishlist' : 'You already have this',
    body: html`<div class="stack">
      <p>${dest === 'wishlist'
        ? 'This version is already on your wishlist.'
        : duplicates.length === 1
          ? 'This version is already in your collection. Add it again if you own another physical copy.'
          : `You already have ${duplicates.length} of this version. Add another if you own one more.`}</p>
      <ul class="list">${duplicates.slice(0, 4).map(
        (d) => html`<li><a class="list-item" href="#/${where}/${encodeURIComponent(d.id)}" data-view-dup="${d.id}">
          <span class="list-thumb">${thumb(d.image, '', d.category)}</span>
          <span class="grow"><span>${d.brandName} ${d.title}</span><span>${[d.subtitle, d.details?.size ? fmt.size(d.details.size) : null, `added ${fmt.date(d.createdAt)}`].filter(Boolean).join(', ')}</span></span>
          ${icon('chevron-right')}
        </a></li>`,
      )}</ul>
      <div class="button-row">
        ${dest === 'owned' ? html`<button type="button" class="btn btn-primary" data-dup-add>Add another copy</button>` : ''}
        <button type="button" class="btn btn-secondary" data-dup-view>View the one you have</button>
        <button type="button" class="btn btn-ghost" data-sheet-close>Cancel</button>
      </div>
    </div>`,
    onMount(el, close) {
      // Thumbnails of photos and saved store images kept on this device.
      hydratePhotos(el);
      el.querySelector('[data-dup-add]')?.addEventListener('click', () => close('add'));
      el.querySelector('[data-dup-view]').addEventListener('click', () => close({ view: `/${where}/${first.id}` }));
      el.addEventListener('click', (event) => {
        const link = event.target.closest?.('[data-view-dup]');
        if (link) {
          event.preventDefault();
          close({ view: `/${where}/${link.dataset.viewDup}` });
        }
      });
    },
  });
}

/**
 * Runs a create call, and if the server reports a duplicate, asks the person. Retries with
 * allowDuplicate when they confirm a second copy.
 * @param {(opts: { allowDuplicate: boolean }) => Promise<any>} create
 * @param {{ dest: 'owned'|'wishlist', navigate: (path: string) => void }} ctx
 * @returns {Promise<any|null>} the created result, or null if cancelled or redirected
 */
export async function createWithDuplicateCheck(create, { dest, navigate }) {
  try {
    return await create({ allowDuplicate: false });
  } catch (error) {
    if (error?.code !== 'duplicate') throw error;
    const choice = await duplicateDialog(error.details?.duplicates ?? [], { dest });
    if (choice === 'add') return create({ allowDuplicate: true });
    if (choice?.view) navigate(choice.view);
    return null;
  }
}
