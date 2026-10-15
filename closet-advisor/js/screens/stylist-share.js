// Sharing with a stylist, from the person's side: send items and a request, see the picks that
// come back, see who opened what, and revoke access.
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import * as fmt from '../lib/format.js';
import { idempotencyKey } from '../lib/ids.js';
import { backHead, emptyState, notice, field, thumb, productTile } from '../ui/components.js';
import { confirmDialog, toast, toastError, withBusy, showFieldErrors } from '../lib/ui.js';

const ACCESS_COPY = { live: 'Shared', revoked: 'Access revoked', ended: 'Assignment ended' };

export default [
  {
    path: '/profile/stylist',
    title: 'Stylist',
    tab: 'profile',
    roles: ['user'],
    async render(ctx) {
      const [stylists, requests, owned] = await Promise.all([ctx.api.listMyStylists({}), ctx.api.listStylistRequests({}), ctx.api.listOwned({})]);
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Stylist', back: '#/profile' })}
        ${requests.length
          ? html`<section class="stack stack-sm"><h2>Your requests</h2>
              <ul class="list">${requests.map(
                (r) => html`<li><a class="list-item" href="#/profile/stylist/${encodeURIComponent(r.id)}">
                  <span class="list-thumb">${icon('stylist')}</span>
                  <span class="grow"><span>${r.stylist.displayName}: ${r.message || 'No message'}</span><span>${ACCESS_COPY[r.access] ?? r.access}, ${fmt.plural(r.itemCount, 'item')}, ${fmt.plural(r.recCount, 'pick')}, ${fmt.relative(r.createdAt)}</span></span>
                  ${icon('chevron-right')}
                </a></li>`,
              )}</ul></section>`
          : ''}
        ${stylists.length
          ? html`<section class="panel stack">
              <h2>Ask for picks</h2>
              <form class="stack" data-request novalidate>
                <fieldset class="stack stack-sm">
                  <legend class="field-label">Stylist</legend>
                  ${stylists.map((s, i) => html`<label class="choice"><input type="radio" name="stylistId" value="${s.id}" ${i === 0 ? html`checked` : ''}><span class="choice-body"><span class="choice-title">${s.displayName}</span><span class="choice-hint">Assigned ${fmt.date(s.assignedAt)}</span></span></label>`)}
                </fieldset>
                ${owned.items.length
                  ? html`<fieldset class="stack stack-sm">
                      <legend class="field-label">Items to share</legend>
                      ${owned.items.map(
                        (it) => html`<label class="choice"><input type="checkbox" name="itemIds" value="${it.id}" checked>
                          <span class="list-thumb">${thumb(it.image, '', it.category)}</span>
                          <span class="choice-body"><span class="choice-title">${it.brandName} ${it.title}</span><span class="choice-hint">${it.subtitle ?? ''}</span></span></label>`,
                      )}
                    </fieldset>`
                  : html`<p class="small muted">Your collection is empty, so only your message is shared.</p>`}
                ${field({ label: 'What are you looking for?', name: 'message', type: 'textarea', required: true, placeholder: 'Something for weekends that works with my navy jacket' })}
                <div class="field">
                  <label class="field-label" for="f-req-budget">Budget <span class="optional">(optional)</span></label>
                  <div class="input-prefix"><span>$</span><input class="input" id="f-req-budget" name="budget" inputmode="decimal" autocomplete="off"></div>
                </div>
                <label class="switch"><span>Share my photos</span><input type="checkbox" name="includePhotos"></label>
                <label class="switch"><span>Share my private notes</span><input type="checkbox" name="includeNotes"></label>
                <p class="small muted">Prices you paid and serial numbers are never shared. You can revoke access at any time.</p>
                <button type="submit" class="btn btn-primary">${icon('send')}Send request</button>
              </form>
            </section>`
          : emptyState({ iconName: 'stylist', title: 'No stylist assigned', body: 'An admin assigns stylists in this demo. Alex Rivera has one: Jordan Blake.' })}
      </div>`;
    },
    mount(root, ctx) {
      const key = idempotencyKey();
      ctx.on('submit', '[data-request]', async (event, form) => {
        event.preventDefault();
        await withBusy(form.querySelector('[type="submit"]'), async () => {
          try {
            const req = await ctx.api.createStylistRequest({
              stylistId: form.querySelector('input[name="stylistId"]:checked')?.value,
              itemIds: [...form.querySelectorAll('input[name="itemIds"]:checked')].map((el) => el.value),
              includePhotos: form.elements.includePhotos.checked,
              includeNotes: form.elements.includeNotes.checked,
              snapshot: false,
              message: form.elements.message.value.trim(),
              budgetMinor: fmt.parseMoney(form.elements.budget.value),
              idempotencyKey: key,
            });
            toast('Request sent');
            ctx.navigate(`/profile/stylist/${encodeURIComponent(req.id)}`);
          } catch (error) {
            if (!showFieldErrors(form, error)) toastError(error);
          }
        });
      });
    },
  },
  {
    path: '/profile/stylist/:id',
    title: 'Stylist request',
    tab: 'profile',
    roles: ['user'],
    async render(ctx) {
      const [data, audit] = await Promise.all([ctx.api.getStylistRequest({ requestId: ctx.params.id }), ctx.api.getAuditLog({ requestId: ctx.params.id })]);
      const { request, items, recs } = data;
      ctx.requestId = request.id;
      return html`<div class="stack stack-lg">
        ${backHead({ title: `Request to ${request.stylist.displayName}`, back: '#/profile/stylist' })}
        ${request.access !== 'live' ? notice({ tone: 'info', body: `${ACCESS_COPY[request.access]}. The stylist can no longer see these items.` }) : ''}
        <section class="panel stack stack-sm">
          <p>${request.message}</p>
          <p class="small muted">${fmt.plural(request.itemCount, 'item')} shared${request.share.includePhotos ? ', with photos' : ''}${request.share.includeNotes ? ', with notes' : ''}${request.budgetMinor ? `, budget ${fmt.money(request.budgetMinor)}` : ''}. Sent ${fmt.relative(request.createdAt)}.</p>
          ${request.access === 'live' ? html`<button type="button" class="btn btn-secondary btn-sm" data-revoke>${icon('lock')}Revoke access</button>` : ''}
        </section>
        <section class="stack">
          <h2>Picks from your stylist</h2>
          ${recs.length
            ? recs.map(
                (r) => html`<article class="stack stack-sm">
                  <p><span class="badge badge-human">${r.label}</span> ${r.message}</p>
                  <div class="tile-grid">${r.items.map((it) => html`<div class="stack stack-xs">${productTile({ product: it.product, variant: it.variant, href: `#/product/${encodeURIComponent(it.productId)}${it.variantId ? `?variant=${encodeURIComponent(it.variantId)}` : ''}` })}${it.note ? html`<p class="small">${it.note}</p>` : ''}</div>`)}</div>
                </article>`,
              )
            : html`<p class="muted">No picks yet.</p>`}
        </section>
        ${items.length
          ? html`<section class="stack stack-sm"><h2>What you shared</h2>
              <ul class="list">${items.map((it) => html`<li class="list-item"><span class="list-thumb">${thumb(it.image, '', it.category)}</span><span class="grow"><span>${it.brandName} ${it.title}</span><span>${it.subtitle ?? ''}</span></span></li>`)}</ul></section>`
          : ''}
        ${audit.length
          ? html`<section class="stack stack-sm"><h2>Activity</h2>
              <ul class="stack stack-xs">${audit.map((a) => html`<li class="small">${a.summary} <span class="muted">${fmt.relative(a.at)}</span></li>`)}</ul></section>`
          : ''}
      </div>`;
    },
    mount(root, ctx) {
      ctx.on('click', '[data-revoke]', async (event, button) => {
        const ok = await confirmDialog({ title: 'Revoke access?', message: 'The stylist stops seeing these items and photos right away.', confirmLabel: 'Revoke', tone: 'danger' });
        if (!ok) return;
        await withBusy(button, async () => {
          try {
            await ctx.api.revokeStylistRequest({ requestId: ctx.requestId });
            ctx.refresh();
          } catch (error) {
            toastError(error);
          }
        });
      });
    },
  },
];
