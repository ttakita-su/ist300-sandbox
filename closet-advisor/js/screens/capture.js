// Photograph an item: online product search or manual labels; samples also offer demo matching.
import { html, render, safeUrl } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { idempotencyKey } from '../lib/ids.js';
import { CATEGORIES, CATEGORY_SINGULAR } from '../data/schema.js';
import { listSamples, renderSample } from '../engine/samples.js';
import { backHead, notice, demoNote } from '../ui/components.js';
import { photoEngineCopy } from '../ui/web-product.js';
import { pill } from '../ui/screen-kit.js';
import { withBusy } from '../lib/ui.js';

function captureHref(query, patch) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...query, ...patch })) if (v) params.set(k, v);
  return `#/add/photo?${params}`;
}

function preview(state) {
  if (!state.blob) return '';
  return html`<section class="panel stack" aria-label="Your photo">
    <div class="media media-wide is-photo">
      <img src="${safeUrl(state.url)}" alt="${state.sample ? `Sample photo: ${state.sample.title}` : 'The photo you chose'}" style="transform: rotate(${state.rotate * 90}deg)">
      ${state.sample ? html`<span class="media-tag">Sample photo</span>` : ''}
    </div>
    ${state.sample ? html`<p class="small muted">${state.sample.shows}</p>` : ''}
    <div class="button-row">
      <button type="button" class="btn btn-primary" data-photo-search>${icon('search')}Search online for this item</button>
      <button type="button" class="btn btn-secondary" data-photo-label>${icon('edit')}Label it myself</button>
      ${state.sample ? html`<button type="button" class="btn btn-secondary" data-start>Try demo matching</button>` : ''}
      <button type="button" class="btn btn-secondary" data-rotate>${icon('rotate')}Rotate</button>
      <button type="button" class="btn btn-ghost" data-clear>Choose another</button>
    </div>
    <p class="xsmall muted">${photoEngineCopy(state.photoEngine).capture}</p>
    <p class="small" data-photo-progress role="status"></p>
    <div data-capture-error aria-live="assertive"></div>
  </section>`;
}

export default [
  {
    path: '/add/photo',
    title: 'Photograph an item',
    tab: null,
    roles: ['user'],
    async render(ctx) {
      const dest = ctx.query.dest === 'wishlist' ? 'wishlist' : 'owned';
      const category = CATEGORIES.includes(ctx.query.category) ? ctx.query.category : '';
      const samples = listSamples();
      // Who a photo search sends the photo to (status.json is read once per page load).
      ctx.photoEngine = (await ctx.api.webStatus({})).photoEngine;
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Photograph an item', back: `#/add?dest=${dest}` })}
        <p class="muted">${dest === 'wishlist' ? 'Saving to your wishlist.' : 'Adding to your collection.'} Photograph your item, search for it online, then choose the right product. If nothing matches, label it yourself. You can edit the details later.</p>
        <div class="stack stack-sm">
          <span class="field-label">What is it?</span>
          <div class="cluster">
            ${pill(captureHref(ctx.query, { category: '' }), 'Not sure', !category)}
            ${CATEGORIES.map((c) => pill(captureHref(ctx.query, { category: c }), CATEGORY_SINGULAR[c], category === c))}
          </div>
        </div>
        <div data-preview></div>
        <section class="stack" data-pickers>
          <label class="btn btn-primary btn-block" style="position:relative">
            ${icon('camera')}Take or upload a photo
            <input class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" data-file>
          </label>
          <p class="small muted">Lay the item flat or stand it on a plain surface, in good light, filling most of the frame.</p>
          <h2>Or try a sample photo</h2>
          <ul class="list">${samples.map(
            (s) => html`<li><button type="button" class="list-item" data-sample="${s.id}">
              <span class="list-thumb">${icon(s.category === 'watch' ? 'watch' : s.category === 'clothing' ? 'shirt' : 'sneaker')}</span>
              <span class="grow"><span>${s.title}</span><span>${s.shows}</span></span>
              ${icon('chevron-right')}
            </button></li>`,
          )}</ul>
        </section>
        ${demoNote('Sample photos are drawings of fictional demo products, staged to look like phone photos.')}
      </div>`;
    },
    mount(root, ctx) {
      const dest = ctx.query.dest === 'wishlist' ? 'wishlist' : 'owned';
      const samples = listSamples();
      const state = { blob: null, url: null, sample: null, rotate: 0, uploadKey: null, jobKey: null, searchKey: null, busy: false, disposed: false, photoEngine: ctx.photoEngine };
      const host = root.querySelector('[data-preview]');
      const pickers = root.querySelector('[data-pickers]');

      const show = (blob, sample = null) => {
        if (state.url) URL.revokeObjectURL(state.url);
        Object.assign(state, { blob, sample, url: blob ? URL.createObjectURL(blob) : null, rotate: 0, uploadKey: idempotencyKey(), jobKey: idempotencyKey(), searchKey: idempotencyKey() });
        render(host, preview(state));
        pickers.hidden = Boolean(blob);
        if (blob) host.querySelector('[data-photo-search]')?.focus();
      };

      ctx.on('change', '[data-file]', (event, input) => {
        const file = input.files?.[0];
        if (file && !state.busy) show(file);
        input.value = '';
      });
      ctx.on('click', '[data-sample]', async (event, button) => {
        await withBusy(button, async () => {
          const sample = samples.find((s) => s.id === button.dataset.sample);
          show(await renderSample(sample.id), sample);
        });
      });
      ctx.on('click', '[data-clear]', () => { if (!state.busy) show(null); });
      ctx.on('click', '[data-rotate]', () => {
        if (state.busy) return;
        state.rotate = (state.rotate + 1) % 4;
        host.querySelector('img').style.transform = `rotate(${state.rotate * 90}deg)`;
      });
      const start = async (button, action) => {
        if (state.busy || !state.blob) return;
        state.busy = true;
        const errorHost = host.querySelector('[data-capture-error]');
        render(errorHost, '');
        for (const el of host.querySelectorAll('button')) el.disabled = true;
        host.querySelector('[data-photo-progress]').textContent = action === 'online' ? 'Searching online for your item. This can take up to half a minute.' : 'Preparing your photo…';
        await withBusy(button, async () => {
          try {
            const upload = await ctx.api.uploadPhoto({ blob: state.blob, kind: 'original', idempotencyKey: state.uploadKey });
            const category = CATEGORIES.includes(ctx.query.category) ? ctx.query.category : state.sample?.category ?? undefined;
            const job = await ctx.api.createMatchJob({
              mode: action === 'catalog' ? 'catalog' : 'online',
              photoId: upload.photoId,
              processingId: upload.processingId,
              category,
              dest,
              crop: state.rotate ? { x: 0, y: 0, w: 1, h: 1, rotate: state.rotate * 90 } : undefined,
              idempotencyKey: `${state.jobKey}-${action === 'catalog' ? 'catalog' : 'online'}`,
            });
            if (state.disposed) return;
            if (action === 'online') await ctx.api.searchWebForPhoto({ jobId: job.id, idempotencyKey: state.searchKey });
            if (!state.disposed) ctx.navigate(`/match/${encodeURIComponent(job.id)}${action === 'manual' ? '?manual=1' : ''}`);
          } catch (error) {
            // Upload errors (HEIC, too small, too large, wrong type) are shown as they are.
            if (!state.disposed) render(errorHost, notice({ tone: 'danger', title: "The search couldn't finish", body: `${error.message} You can label the item yourself instead.` }));
          } finally {
            state.busy = false;
            if (!state.disposed) {
              for (const el of host.querySelectorAll('button')) el.disabled = false;
              host.querySelector('[data-photo-progress]').textContent = '';
            }
          }
        });
      };
      ctx.on('click', '[data-start]', (event, button) => start(button, 'catalog'));
      ctx.on('click', '[data-photo-search]', (event, button) => start(button, 'online'));
      ctx.on('click', '[data-photo-label]', (event, button) => start(button, 'manual'));
      return () => {
        state.disposed = true;
        if (state.url) URL.revokeObjectURL(state.url);
      };
    },
  },
];
