// Stylist workspace: live client requests, the redacted items they shared, and sending picks.
import { html, render } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import * as fmt from '../lib/format.js';
import { idempotencyKey } from '../lib/ids.js';
import { signOut } from '../client.js';
import { screenHead, backHead, emptyState, field, thumb, media, label, productTile, demoNote } from '../ui/components.js';
import { openCatalogPicker } from '../ui/catalog-picker.js';
import { toast, toastError, withBusy, showFieldErrors } from '../lib/ui.js';

function signOutButton() {
  return html`<button type="button" class="btn btn-ghost btn-sm" data-signout>${icon('logout')}Sign out</button>`;
}

function bindSignOut(ctx) {
  ctx.on('click', '[data-signout]', async () => {
    await signOut();
    ctx.navigate('/welcome', { replace: true });
  });
}

function picksList(picks) {
  if (!picks.length) return html`<p class="small muted">No picks added yet.</p>`;
  return html`<ul class="list">${picks.map(
    (p, i) => html`<li class="list-item">
      <span class="list-thumb">${thumb(p.variant?.image, '', p.product.category)}</span>
      <span class="grow"><span>${p.product.brand?.name} ${p.product.name}</span><span>${p.variant?.name ?? 'Any version'}</span></span>
      <button type="button" class="btn btn-ghost btn-sm" data-drop-pick="${i}" aria-label="Remove">${icon('x')}</button>
    </li>
    <li><label class="visually-hidden" for="f-note-${i}">Note for ${p.product.name}</label><input class="input" id="f-note-${i}" name="note-${i}" placeholder="Why this one (optional)" value="${p.note ?? ''}"></li>`,
  )}</ul>`;
}

export default [
  {
    path: '/stylist',
    title: 'Stylist workspace',
    tab: null,
    roles: ['stylist'],
    async render(ctx) {
      const requests = await ctx.api.listStylistRequests({});
      return html`<div class="stack stack-lg">
        ${screenHead({ title: 'Client requests', lede: `Signed in as ${ctx.session.displayName}`, actions: signOutButton() })}
        ${requests.length
          ? html`<ul class="list">${requests.map(
              (r) => html`<li><a class="list-item" href="#/stylist/request/${encodeURIComponent(r.id)}">
                <span class="avatar" aria-hidden="true">${r.client.displayName.slice(0, 1)}</span>
                <span class="grow"><span>${r.client.displayName}: ${r.message || 'No message'}</span><span>${fmt.plural(r.itemCount, 'item')}, ${r.recCount ? fmt.plural(r.recCount, 'pick') + ' sent' : 'no picks yet'}, ${fmt.relative(r.createdAt)}</span></span>
                ${icon('chevron-right')}
              </a></li>`,
            )}</ul>`
          : emptyState({ iconName: 'stylist', title: 'No open requests', body: 'When an assigned client shares items with you, the request appears here.' })}
        ${demoNote()}
      </div>`;
    },
    mount(root, ctx) {
      bindSignOut(ctx);
    },
  },
  {
    path: '/stylist/request/:id',
    title: 'Client request',
    tab: null,
    roles: ['stylist'],
    async render(ctx) {
      const { request, items, recs } = await ctx.api.getStylistRequest({ requestId: ctx.params.id });
      ctx.requestId = request.id;
      return html`<div class="stack stack-lg">
        ${backHead({ title: request.client?.displayName ?? 'Client request', back: '#/stylist' })}
        <section class="panel stack stack-sm">
          <p>${request.message}</p>
          <p class="small muted">${request.budgetMinor ? `Budget ${fmt.money(request.budgetMinor)}. ` : ''}Sent ${fmt.relative(request.createdAt)}.</p>
        </section>
        <section class="stack">
          <h2>What they shared</h2>
          ${items.length
            ? html`<div class="tile-grid">${items.map(
                (it) => html`<article class="tile">
                  ${media(it.image, { alt: `${it.brandName} ${it.title}`, category: it.category })}
                  ${label({ brand: it.brandName, name: it.title, variant: it.subtitle, code: it.code, state: 'owned' })}
                  ${it.details?.size ? html`<p class="small">Size ${fmt.size(it.details.size)}</p>` : ''}
                  ${it.details?.notes ? html`<p class="small muted">${it.details.notes}</p>` : ''}
                </article>`,
              )}</div>`
            : html`<p class="muted">No items shared.</p>`}
        </section>
        ${recs.length
          ? html`<section class="stack"><h2>Picks you sent</h2>${recs.map(
              (r) => html`<div class="stack stack-sm"><p class="small">${r.message} <span class="muted">${fmt.relative(r.createdAt)}</span></p>
                <div class="tile-grid">${r.items.map((it) => productTile({ product: it.product, variant: it.variant, href: `#/product/${encodeURIComponent(it.productId)}${it.variantId ? `?variant=${encodeURIComponent(it.variantId)}` : ''}` }))}</div></div>`,
            )}</section>`
          : ''}
        <section class="panel stack">
          <h2>Send picks</h2>
          <form class="stack" data-picks novalidate>
            <div data-pick-list>${picksList([])}</div>
            <button type="button" class="btn btn-secondary" data-add-pick>${icon('plus')}Add from catalog</button>
            ${field({ label: 'Message', name: 'message', type: 'textarea', required: true, placeholder: 'A few options that work with what you have' })}
            <button type="submit" class="btn btn-primary">${icon('send')}Send picks</button>
          </form>
          <p class="small muted">Your picks are labeled as coming from you, a person, everywhere the client sees them.</p>
        </section>
      </div>`;
    },
    mount(root, ctx) {
      const picks = [];
      const key = idempotencyKey();
      const host = root.querySelector('[data-pick-list]');
      const saveNotes = () => picks.forEach((p, i) => (p.note = root.querySelector(`[name="note-${i}"]`)?.value ?? p.note));
      ctx.on('click', '[data-add-pick]', async () => {
        saveNotes();
        const pick = await openCatalogPicker({ title: 'Add a pick', confirmLabel: 'Add pick' });
        if (!pick) return;
        picks.push({ product: pick.product, variant: pick.variant, note: '' });
        render(host, picksList(picks));
      });
      ctx.on('click', '[data-drop-pick]', (event, button) => {
        saveNotes();
        picks.splice(Number(button.dataset.dropPick), 1);
        render(host, picksList(picks));
      });
      ctx.on('submit', '[data-picks]', async (event, form) => {
        event.preventDefault();
        saveNotes();
        if (!picks.length) {
          toast('Add at least one pick');
          return;
        }
        await withBusy(form.querySelector('[type="submit"]'), async () => {
          try {
            await ctx.api.submitStylistRecs({
              requestId: ctx.requestId,
              items: picks.map((p) => ({ productId: p.product.id, variantId: p.variant?.id ?? null, note: p.note ?? '' })),
              message: form.elements.message.value.trim(),
              idempotencyKey: key,
            });
            toast('Picks sent');
            ctx.refresh();
          } catch (error) {
            if (!showFieldErrors(form, error)) toastError(error);
          }
        });
      });
    },
  },
];
