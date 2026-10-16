// Photograph an item: take or upload a photo (or try a sample), then start a match job.
import { html, render, safeUrl } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { idempotencyKey } from '../lib/ids.js';
import { CATEGORIES, CATEGORY_SINGULAR } from '../data/schema.js';
import { listSamples, renderSample } from '../engine/samples.js';
import { backHead, notice, demoNote } from '../ui/components.js';
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
      <button type="button" class="btn btn-primary" data-start>${icon('search')}Find matches</button>
      <button type="button" class="btn btn-secondary" data-rotate>${icon('rotate')}Rotate</button>
      <button type="button" class="btn btn-ghost" data-clear>Choose another</button>
    </div>
    <div data-capture-error aria-live="assertive"></div>
  </section>`;
}

export default [
  {
    path: '/add/photo',
    title: 'Photograph an item',
    tab: null,
    roles: ['user'],
    render(ctx) {
      const dest = ctx.query.dest === 'wishlist' ? 'wishlist' : 'owned';
      const category = CATEGORIES.includes(ctx.query.category) ? ctx.query.category : '';
      const samples = listSamples();
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Photograph an item', back: `#/add?dest=${dest}` })}
        <p class="muted">${dest === 'wishlist' ? 'Saving to your wishlist.' : 'Adding to your collection.'} The photo is matched on this device. It's sent to Microsoft Bing only if you choose Search online stores afterwards.</p>
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
      const state = { blob: null, url: null, sample: null, rotate: 0, uploadKey: null, jobKey: null };
      const host = root.querySelector('[data-preview]');
      const pickers = root.querySelector('[data-pickers]');

      const show = (blob, sample = null) => {
        if (state.url) URL.revokeObjectURL(state.url);
        Object.assign(state, { blob, sample, url: blob ? URL.createObjectURL(blob) : null, rotate: 0, uploadKey: idempotencyKey(), jobKey: idempotencyKey() });
        render(host, preview(state));
        pickers.hidden = Boolean(blob);
        if (blob) host.querySelector('[data-start]')?.focus();
      };

      ctx.on('change', '[data-file]', (event, input) => {
        const file = input.files?.[0];
        if (file) show(file);
        input.value = '';
      });
      ctx.on('click', '[data-sample]', async (event, button) => {
        await withBusy(button, async () => {
          const sample = samples.find((s) => s.id === button.dataset.sample);
          show(await renderSample(sample.id), sample);
        });
      });
      ctx.on('click', '[data-clear]', () => show(null));
      ctx.on('click', '[data-rotate]', () => {
        state.rotate = (state.rotate + 1) % 4;
        host.querySelector('img').style.transform = `rotate(${state.rotate * 90}deg)`;
      });
      ctx.on('click', '[data-start]', async (event, button) => {
        const errorHost = host.querySelector('[data-capture-error]');
        render(errorHost, '');
        await withBusy(button, async () => {
          try {
            const upload = await ctx.api.uploadPhoto({ blob: state.blob, kind: 'original', idempotencyKey: state.uploadKey });
            const category = CATEGORIES.includes(ctx.query.category) ? ctx.query.category : state.sample?.category ?? undefined;
            const job = await ctx.api.createMatchJob({
              photoId: upload.photoId,
              processingId: upload.processingId,
              category,
              dest,
              crop: state.rotate ? { x: 0, y: 0, w: 1, h: 1, rotate: state.rotate * 90 } : undefined,
              idempotencyKey: state.jobKey,
            });
            ctx.navigate(`/match/${encodeURIComponent(job.id)}`);
          } catch (error) {
            // Upload errors (HEIC, too small, too large, wrong type) are shown as they are.
            render(errorHost, notice({ tone: 'danger', title: "This photo can't be used", body: error.message }));
          }
        });
      });
      return () => {
        if (state.url) URL.revokeObjectURL(state.url);
      };
    },
  },
];
