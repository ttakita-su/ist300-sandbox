// Catalog search sheet: find a product, then choose the exact version (colorway, color or
// reference). Used to add from search, change a match, and build stylist picks.
import { html, render, raw } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { openSheet } from '../lib/ui.js';
import { api } from '../client.js';
import { CATEGORIES, CATEGORY_LABEL } from '../data/schema.js';
import { thumb, demoNote } from './components.js';

function resultsList(results) {
  if (!results.length) return html`<p class="muted">No catalog products match. Try a brand, model, color or code.</p>`;
  return html`<ul class="list">${results.map((r) => {
    const preview = r.variants.find((v) => r.matchedVariantIds.includes(v.id)) ?? r.variants[0];
    const matched = r.matchedVariantIds.length && r.matchedVariantIds.length < r.variants.length ? `${r.matchedVariantIds.length} matching ${r.matchedVariantIds.length === 1 ? 'version' : 'versions'}` : `${r.variants.length} ${r.variants.length === 1 ? 'version' : 'versions'}`;
    return html`<li><button type="button" class="list-item" data-pick-product="${r.product.id}">
      <span class="list-thumb">${thumb(preview?.image, '', r.product.category)}</span>
      <span class="grow"><span>${r.product.brand?.name} ${r.product.name}</span><span>${r.product.typeLabel}, ${matched}</span></span>
      ${icon('chevron-right')}
    </button></li>`;
  })}</ul>`;
}

function variantStep(result, { confirmLabel, allowUnsure }) {
  const preselect = result.matchedVariantIds.length === 1 ? result.matchedVariantIds[0] : null;
  return html`<form class="stack" data-variant-form>
    <button type="button" class="link-btn" data-back-to-results>${icon('chevron-left', { className: 'icon-sm' })} Back to results</button>
    <div>
      <p class="label-brand">${result.product.brand?.name}</p>
      <h3>${result.product.name}</h3>
    </div>
    <fieldset class="stack stack-sm">
      <legend class="field-label">Which version is it?</legend>
      ${result.variants.map(
        (v) => html`<label class="choice">
          <input type="radio" name="variantId" value="${v.id}" ${v.id === preselect ? raw('checked') : ''} required>
          <span class="list-thumb">${thumb(v.image, '', result.product.category)}</span>
          <span class="choice-body"><span class="choice-title">${v.name}</span>${v.code ? html`<span class="choice-hint code">${v.code}</span>` : ''}</span>
        </label>`,
      )}
      ${allowUnsure
        ? html`<label class="choice"><input type="radio" name="variantId" value="" required><span class="choice-body"><span class="choice-title">I'm not sure which version</span><span class="choice-hint">It's saved as this model with the version marked unsure.</span></span></label>`
        : ''}
    </fieldset>
    <button type="submit" class="btn btn-primary btn-block">${confirmLabel}</button>
  </form>`;
}

/**
 * @param {{ title?: string, category?: string|null, confirmLabel?: string, allowUnsure?: boolean, initialQuery?: string }} [opts]
 * @returns {Promise<{ product: any, variant: any|null }|null>}
 */
export function openCatalogPicker(opts = {}) {
  const fixedCategory = opts.category ?? null;
  const confirmLabel = opts.confirmLabel ?? 'Choose this version';
  return openSheet({
    title: opts.title ?? 'Search the catalog',
    body: html`<div class="stack" data-picker>
      <div class="search-field">
        ${icon('search')}
        <label class="visually-hidden" for="picker-q">Search the catalog</label>
        <input class="input" id="picker-q" type="search" placeholder="Brand, model, color or code" autocomplete="off" value="${opts.initialQuery ?? ''}">
      </div>
      ${fixedCategory
        ? ''
        : html`<div class="cluster" role="group" aria-label="Category">
            <button type="button" class="chip" aria-pressed="true" data-cat="">All</button>
            ${CATEGORIES.map((c) => html`<button type="button" class="chip" aria-pressed="false" data-cat="${c}">${CATEGORY_LABEL[c]}</button>`)}
          </div>`}
      <div data-results aria-live="polite"></div>
      ${demoNote()}
    </div>`,
    onMount(el, close) {
      const input = el.querySelector('#picker-q');
      const results = el.querySelector('[data-results]');
      let category = fixedCategory ?? '';
      let lastResults = [];
      let seq = 0;
      let timer = null;

      async function search() {
        const mine = ++seq;
        try {
          const found = await api.searchCatalog({ q: input.value, category: category || undefined, limit: 20 });
          if (mine !== seq) return;
          lastResults = found;
          render(results, resultsList(found));
        } catch (error) {
          render(results, html`<p class="field-error">${error.message}</p>`);
        }
      }

      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(search, 180);
      });
      el.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const cat = target?.closest('[data-cat]');
        if (cat) {
          category = cat.dataset.cat;
          for (const chip of el.querySelectorAll('[data-cat]')) chip.setAttribute('aria-pressed', String(chip === cat));
          search();
          return;
        }
        const pick = target?.closest('[data-pick-product]');
        if (pick) {
          const result = lastResults.find((r) => r.product.id === pick.dataset.pickProduct);
          if (!result) return;
          render(results, variantStep(result, { confirmLabel, allowUnsure: opts.allowUnsure !== false }));
          results.querySelector('input[type="radio"]:checked, input[type="radio"]')?.focus();
          results.querySelector('[data-variant-form]').addEventListener('submit', (submit) => {
            submit.preventDefault();
            const variantId = new FormData(submit.target).get('variantId');
            const variant = result.variants.find((v) => v.id === variantId) ?? null;
            close({ product: result.product, variant });
          });
          return;
        }
        if (target?.closest('[data-back-to-results]')) {
          render(results, resultsList(lastResults));
          input.focus();
        }
      });
      search();
      setTimeout(() => input.focus(), 50);
      return () => clearTimeout(timer);
    },
  });
}
