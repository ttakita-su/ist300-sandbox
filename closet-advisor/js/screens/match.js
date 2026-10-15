// Match results: progress while the photo is analyzed, then candidates to confirm, ways to settle
// an unsure version (a code, a label photo, a link), and saving it as the person's own item.
import { html, render } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { idempotencyKey } from '../lib/ids.js';
import { CATEGORIES, CATEGORY_SINGULAR } from '../data/schema.js';
import { renderLabel } from '../engine/samples.js';
import { backHead, media, label, evidenceList, notice, thumb, field, selectField, demoNote } from '../ui/components.js';
import { createWithDuplicateCheck } from '../ui/item-forms.js';
import { openCatalogPicker } from '../ui/catalog-picker.js';
import { openSheet, toast, toastError, withBusy, showFieldErrors } from '../lib/ui.js';

const RUNNING = ['queued', 'processing'];
const STAGE_COPY = {
  queued: 'Waiting to start',
  preparing: 'Preparing your photo',
  indexing: 'Getting the catalog ready (first scan only)',
  reading_label: 'Reading the label',
  analyzing: 'Comparing shape and colors with the catalog',
};
const STRENGTH = { strong: 'Strong match', possible: 'Possible match', weak: 'Weak match' };
const ASK_COPY = {
  style_code: { title: 'Type the style code', hint: 'Usually on the tongue label or the box, like KR2-OLB.', kind: 'code' },
  reference: { title: 'Type the reference', hint: 'On the caseback, papers or box, like AF40-SL-BK.', kind: 'code' },
  product_link: { title: 'Paste a product link', kind: 'link' },
  size_tag_photo: { title: 'Photograph the size tag', kind: 'photo' },
  brand_label: { title: 'Photograph the brand label', kind: 'photo' },
  barcode: { title: 'Photograph the barcode', kind: 'photo' },
  caseback_photo: { title: 'Photograph the caseback', kind: 'photo' },
};
const VARIANT_WORD = { sneaker: 'colorway', clothing: 'color', watch: 'reference' };

function progress(job) {
  const p = job.progress;
  const stage = STAGE_COPY[p?.stage ?? job.status] ?? 'Working';
  const pct = p?.stage === 'indexing' && p.total ? Math.round((p.done / p.total) * 100) : null;
  return html`<section class="panel stack" aria-live="polite" aria-busy="true" data-progress>
    <h2>Looking for matches</h2>
    <p>${stage}${pct != null ? html` <span class="num">(${p.done} of ${p.total})</span>` : ''}</p>
    <div class="progress"><span style="width: ${pct ?? 35}%"></span></div>
    <p class="small muted">This runs on your device. The first scan takes longer while the catalog is prepared.</p>
  </section>`;
}

function candidateCard(c, job, index) {
  const similar = c.kind === 'similar';
  const word = VARIANT_WORD[c.product.category] ?? 'version';
  const preselect = c.variantAmbiguous ? null : c.variantId;
  const destWord = job.dest === 'wishlist' ? 'Save to wishlist' : 'Save to collection';
  const lead = c.variants.find((v) => v.id === (c.variantId ?? c.variantOptions[0]?.variantId)) ?? c.variants[0];
  return html`<article class="panel stack" data-candidate-card>
    <div class="row" style="--gap: var(--s4); align-items: flex-start">
      <div style="width: 112px; flex: none">${media(lead?.image, { alt: `${c.product.brand?.name} ${c.product.name}`, category: c.product.category })}</div>
      <div class="stack stack-xs grow">
        <span class="badge ${similar ? 'badge-muted' : c.strength === 'strong' ? 'badge-ok' : 'badge-warn'}">${similar ? 'Similar product, not a confirmed match' : STRENGTH[c.strength] ?? 'Match'}</span>
        ${label({ brand: c.product.brand?.name, name: c.product.name, variant: c.variantAmbiguous ? null : lead?.name, state: 'suggestion' })}
      </div>
    </div>
    ${evidenceList(c.evidence, c.conflicts)}
    <form class="stack" data-confirm="${c.id}" data-index="${index}">
      ${c.variants.length
        ? html`<fieldset class="stack stack-sm">
            <legend class="field-label">Which ${word} is yours?</legend>
            ${c.variantAmbiguous ? html`<p class="small">The photo can't tell these apart. Choose one, or add a code below to settle it.</p>` : ''}
            ${c.variantOptions.map((o, i) => {
              const v = c.variants[i];
              return html`<label class="choice">
                <input type="radio" name="variantId" value="${o.variantId}" ${o.variantId === preselect ? html`checked` : ''} required>
                <span class="list-thumb">${thumb(v?.image, '', c.product.category)}</span>
                <span class="choice-body"><span class="choice-title">${v?.name ?? o.variantId}</span>${v?.code ? html`<span class="choice-hint code">${v.code}</span>` : ''}${o.note ? html`<span class="choice-hint">${o.note}</span>` : ''}</span>
              </label>`;
            })}
            <label class="choice"><input type="radio" name="variantId" value="" required><span class="choice-body"><span class="choice-title">I'm not sure</span><span class="choice-hint">Saved as this model with the ${word} marked unsure.</span></span></label>
          </fieldset>`
        : ''}
      <button type="submit" class="btn ${index === 0 && !similar ? 'btn-primary' : 'btn-secondary'} btn-block">${similar ? `It's this product: ${destWord.toLowerCase()}` : destWord}</button>
    </form>
  </article>`;
}

function askSection(job) {
  const asks = job.result?.askFor ?? [];
  if (!asks.length) return '';
  const variants = (job.result?.candidates ?? []).flatMap((c) => c.variants.filter((v) => v.code)).slice(0, 4);
  return html`<section class="stack" aria-labelledby="ask-h">
    <h2 id="ask-h">Help us be sure</h2>
    ${asks.map((a) => {
      const copy = ASK_COPY[a.kind] ?? { title: a.kind, kind: 'code' };
      if (copy.kind === 'code') {
        return html`<form class="panel stack stack-sm" data-evidence="code">
          <strong>${copy.title}</strong>
          <p class="small muted">${a.reason}</p>
          <div class="input-group">
            <label class="visually-hidden" for="f-code-${a.kind}">${copy.title}</label>
            <input class="input code" id="f-code-${a.kind}" name="code" autocomplete="off" spellcheck="false" placeholder="${copy.hint ?? ''}" required>
            <button type="submit" class="btn btn-secondary">Check</button>
          </div>
        </form>`;
      }
      if (copy.kind === 'link') {
        return html`<form class="panel stack stack-sm" data-evidence="link">
          <strong>${copy.title}</strong>
          <p class="small muted">${a.reason}</p>
          <div class="input-group">
            <label class="visually-hidden" for="f-link-ev">Product link</label>
            <input class="input" id="f-link-ev" name="url" type="url" placeholder="https://" required>
            <button type="submit" class="btn btn-secondary">Use link</button>
          </div>
        </form>`;
      }
      return html`<div class="panel stack stack-sm">
        <strong>${copy.title}</strong>
        <p class="small muted">${a.reason}</p>
        <label class="btn btn-secondary" style="position:relative">${icon('camera')}Add a label photo
          <input class="visually-hidden" type="file" accept="image/*" capture="environment" data-label-file>
        </label>
        ${variants.length
          ? html`<p class="small muted">Or try a sample label (demo):</p>
              <div class="cluster">${variants.map((v) => html`<button type="button" class="chip" data-sample-label="${v.id}">${v.name}</button>`)}</div>`
          : ''}
        <p class="xsmall muted">Label reading downloads a text reader the first time. If it can't run, type the code instead.</p>
      </div>`;
    })}
  </section>`;
}

function outcomeNotice(job) {
  const r = job.result;
  if (r.retrieval === 'similar_result') {
    return notice({ tone: 'warn', title: 'No confident match', body: "These look similar, but none is a confident match. If one is yours, choose it; it'll be saved as your choice." });
  }
  if (r.retrieval === 'no_match' || !r.candidates.length) {
    return notice({ tone: 'warn', title: 'Not in the catalog', body: "We couldn't find this in the demo catalog. Add a code or link, search the catalog yourself, or save it as your own item." });
  }
  return '';
}

function doneView(job) {
  const r = job.result;
  const reads = (job.labelReads ?? []).filter((l) => l.status !== 'read');
  const candidates = [...r.candidates].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'match' ? -1 : 1));
  return html`
    ${outcomeNotice(job)}
    ${r.notes?.map((n) => notice({ tone: 'info', body: n }))}
    ${reads.map((l) => notice({ tone: 'warn', body: l.message }))}
    ${job.link?.reason ? notice({ tone: job.link.status === 'resolved' ? 'ok' : 'warn', body: job.link.reason }) : ''}
    ${candidates.length ? html`<section class="stack"><h2>${candidates[0].kind === 'match' ? 'Is it one of these?' : 'Similar products'}</h2>${candidates.map((c, i) => candidateCard(c, job, i))}</section>` : ''}
    ${askSection(job)}
    <section class="stack stack-sm">
      <h2>Something else</h2>
      <div class="button-row">
        <button type="button" class="btn btn-secondary" data-search>${icon('search')}Search the catalog</button>
        <button type="button" class="btn btn-secondary" data-custom>${icon('edit')}Save as my own item</button>
        ${candidates.length ? html`<button type="button" class="btn btn-ghost" data-reject>None of these are mine</button>` : ''}
      </div>
    </section>`;
}

export default [
  {
    path: '/match/:jobId',
    title: 'Matching',
    tab: null,
    roles: ['user'],
    async render(ctx) {
      const job = await ctx.api.getMatchJob({ jobId: ctx.params.jobId });
      ctx.job = job;
      let photo = '';
      if (job.photoId) photo = html`<div style="max-width: 240px">${media({ kind: 'original', photoId: job.photoId, label: 'Your photo' }, { alt: 'Your photo' })}</div>`;
      let body;
      if (RUNNING.includes(job.status)) body = progress(job);
      else if (job.status === 'confirmed') {
        const where = job.dest === 'wishlist' ? 'wishlist' : 'collection';
        body = notice({ tone: 'ok', title: 'Saved', body: html`This photo is already saved. <a href="#/${where}/${encodeURIComponent(job.confirmedItemId)}">Open the item</a>` });
      } else if (job.status === 'error' || job.status === 'timeout') {
        body = html`${notice({ tone: 'danger', title: job.status === 'timeout' ? 'Matching took too long' : 'Matching failed', body: job.error?.message ?? 'Try again.' })}
          <div class="button-row">
            ${job.canRetry ? html`<button type="button" class="btn btn-primary" data-retry>${icon('refresh')}Try again</button>` : ''}
            <button type="button" class="btn btn-secondary" data-search>${icon('search')}Search the catalog</button>
            <button type="button" class="btn btn-secondary" data-custom>Save as my own item</button>
          </div>`;
      } else if (job.status === 'rejected') {
        body = html`${notice({ tone: 'info', title: 'Marked as not a match', body: 'Add a code or label photo to match again, search the catalog, or save it as your own item.' })}
          ${askSection(job)}
          <div class="button-row">
            <button type="button" class="btn btn-secondary" data-search>${icon('search')}Search the catalog</button>
            <button type="button" class="btn btn-secondary" data-custom>Save as my own item</button>
          </div>`;
      } else {
        body = doneView(job);
      }
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Match', back: `#/add/photo?dest=${job.dest}` })}
        <p class="muted">${job.dest === 'wishlist' ? 'Saving to your wishlist' : 'Adding to your collection'}${job.category ? `: ${CATEGORY_SINGULAR[job.category].toLowerCase()}` : ''}</p>
        ${photo}
        ${body}
        ${demoNote()}
      </div>`;
    },
    mount(root, ctx) {
      const job = ctx.job;
      let timer = null;
      if (RUNNING.includes(job.status)) {
        const poll = async () => {
          try {
            const next = await ctx.api.getMatchJob({ jobId: job.id });
            if (!RUNNING.includes(next.status)) {
              ctx.refresh();
              return;
            }
            const host = root.querySelector('[data-progress]');
            if (host) host.outerHTML = progress(next).value;
          } catch (error) {
            toastError(error);
            return;
          }
          timer = setTimeout(poll, 250);
        };
        timer = setTimeout(poll, 200);
        return () => clearTimeout(timer);
      }

      // One idempotency key per confirm sequence; a confirmed second copy uses its own.
      const confirmKey = idempotencyKey();
      const wish = { reason: 'want_exact', desired: { condition: 'new_only' } };
      const saveWith = (args) =>
        createWithDuplicateCheck(
          ({ allowDuplicate }) =>
            ctx.api.confirmMatch({ jobId: job.id, ...args, ...(job.dest === 'wishlist' ? { wish } : {}), allowDuplicate, idempotencyKey: allowDuplicate ? `${confirmKey}-dup` : confirmKey }),
          { dest: job.dest, navigate: ctx.navigate },
        );
      const finish = (out) => {
        if (!out) return;
        const where = job.dest === 'wishlist' ? 'wishlist' : 'collection';
        toast(job.dest === 'wishlist' ? 'Saved to your wishlist' : 'Added to your collection');
        ctx.navigate(`/${where}/${encodeURIComponent(out.item.id)}`, { replace: true });
      };
      const guard = (button, fn) =>
        withBusy(button, async () => {
          try {
            await fn();
          } catch (error) {
            toastError(error);
          }
        });

      ctx.on('submit', '[data-confirm]', (event, form) => {
        event.preventDefault();
        const variantId = form.elements.variantId ? new FormData(form).get('variantId') : null;
        guard(form.querySelector('[type="submit"]'), async () =>
          finish(await saveWith({ candidateId: form.dataset.confirm, variantId: variantId || null, variantUnsure: form.elements.variantId ? !variantId : false })),
        );
      });
      ctx.on('click', '[data-reject]', (event, button) =>
        guard(button, async () => {
          await ctx.api.rejectMatch({ jobId: job.id });
          ctx.refresh();
        }),
      );
      ctx.on('click', '[data-retry]', (event, button) =>
        guard(button, async () => {
          await ctx.api.retryMatchJob({ jobId: job.id, idempotencyKey: idempotencyKey() });
          ctx.refresh();
        }),
      );
      const addEvidence = async (args) => {
        await ctx.api.addMatchEvidence({ jobId: job.id, ...args, idempotencyKey: idempotencyKey() });
        ctx.refresh();
      };
      ctx.on('submit', '[data-evidence="code"]', (event, form) => {
        event.preventDefault();
        guard(form.querySelector('[type="submit"]'), () => addEvidence({ code: form.elements.code.value.trim() }));
      });
      ctx.on('submit', '[data-evidence="link"]', (event, form) => {
        event.preventDefault();
        guard(form.querySelector('[type="submit"]'), () => addEvidence({ productUrl: form.elements.url.value.trim() }));
      });
      const useLabel = async (blob) => {
        const upload = await ctx.api.uploadPhoto({ blob, kind: 'label', idempotencyKey: idempotencyKey() });
        await addEvidence({ labelPhotoId: upload.photoId });
      };
      ctx.on('change', '[data-label-file]', (event, input) => {
        const file = input.files?.[0];
        if (file) guard(null, () => useLabel(file));
      });
      ctx.on('click', '[data-sample-label]', (event, button) =>
        guard(button, async () => useLabel(await renderLabel({ variantId: button.dataset.sampleLabel }))),
      );
      ctx.on('click', '[data-search]', (event, button) =>
        guard(button, async () => {
          const pick = await openCatalogPicker({ title: 'Find it in the catalog', category: job.category, confirmLabel: 'This is it', allowUnsure: false });
          if (!pick?.variant) return;
          finish(await saveWith({ candidateId: null, variantId: pick.variant.id }));
        }),
      );
      ctx.on('click', '[data-custom]', async () => {
        const out = await openSheet({
          title: 'Save as your own item',
          body: html`<form class="stack" novalidate>
            ${job.category ? '' : selectField({ label: 'What is it?', name: 'category', options: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_SINGULAR[c] })), value: 'sneaker' })}
            ${field({ label: 'Brand', name: 'custom.brand', required: true })}
            ${field({ label: 'Name', name: 'custom.name', required: true, placeholder: 'Model or a short description' })}
            ${field({ label: 'Color or version', name: 'custom.variantName', optional: true })}
            <button type="submit" class="btn btn-primary btn-block">Save</button>
          </form>`,
          onMount(el, close) {
            el.querySelector('form').addEventListener('submit', async (event) => {
              event.preventDefault();
              const form = event.target;
              await withBusy(form.querySelector('[type="submit"]'), async () => {
                try {
                  const custom = { brand: form.elements['custom.brand'].value, name: form.elements['custom.name'].value, variantName: form.elements['custom.variantName'].value };
                  const result = await saveWith({ candidateId: null, variantId: null, custom, category: job.category ?? form.elements.category.value });
                  close(result ?? null);
                } catch (error) {
                  if (!showFieldErrors(form, error)) toastError(error);
                }
              });
            });
          },
        });
        finish(out);
      });
      return () => clearTimeout(timer);
    },
  },
];
