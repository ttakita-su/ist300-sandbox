// Preference questions shared by onboarding and Profile > Preferences, so both ask the same
// things and read them back the same way.
import { html } from '../lib/html.js';
import * as fmt from '../lib/format.js';
import { CATEGORIES, CATEGORY_LABEL, STYLE_TAGS, STYLE_LABEL, INTENDED_USES, USE_LABEL } from '../data/schema.js';
import { PICKABLE_COLORS, colorLabel } from '../data/colors.js';
import { chipGroup } from './components.js';
import { sizeField, readSize } from './item-forms.js';

const list = (form, name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);

/** @param {any} profile */
export function preferenceFields(profile) {
  const p = profile ?? {};
  return html`
    ${chipGroup({ legend: 'What do you shop for?', name: 'categories', options: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })), selected: p.categories?.length ? p.categories : CATEGORIES })}
    ${chipGroup({ legend: 'Styles you like (up to 6)', name: 'styles', options: STYLE_TAGS.map((s) => ({ value: s, label: STYLE_LABEL[s] })), selected: p.styles ?? [] })}
    ${chipGroup({ legend: 'What you wear things for', name: 'uses', options: INTENDED_USES.map((u) => ({ value: u, label: USE_LABEL[u] })), selected: p.uses ?? [] })}
    ${chipGroup({ legend: 'Colors you like', name: 'colorsLiked', options: PICKABLE_COLORS.map((c) => ({ value: c, label: colorLabel(c) })), selected: p.colorsLiked ?? [] })}
    ${chipGroup({ legend: 'Colors you avoid', name: 'colorsAvoided', options: PICKABLE_COLORS.map((c) => ({ value: c, label: colorLabel(c) })), selected: p.colorsAvoided ?? [] })}
    <fieldset class="stack">
      <legend class="field-label">Your usual sizes</legend>
      <div class="form-grid">
        ${sizeField({ category: 'sneaker', name: 'sizes.shoe', label: 'Shoe size', value: p.sizes?.shoe })}
        ${sizeField({ category: 'clothing', type: 'tee', name: 'sizes.top', label: 'Tops', value: p.sizes?.top })}
        ${sizeField({ category: 'clothing', type: 'trousers', name: 'sizes.bottom', label: 'Trousers', value: p.sizes?.bottom })}
      </div>
    </fieldset>
    <fieldset class="stack">
      <legend class="field-label">Budget per item <span class="optional">(optional)</span></legend>
      <div class="form-grid">${CATEGORIES.map(
        (c) => html`<div class="field">
          <label class="field-label" for="f-budget-${c}">${CATEGORY_LABEL[c]}</label>
          <div class="input-prefix"><span>$</span><input class="input" id="f-budget-${c}" name="budgets.${c}" inputmode="decimal" autocomplete="off" value="${fmt.moneyInput(p.budgets?.[c])}"></div>
        </div>`,
      )}</div>
    </fieldset>`;
}

/** Reads preferenceFields into an updateProfile / completeOnboarding patch. */
export function readPreferences(form) {
  const budgets = {};
  for (const c of CATEGORIES) budgets[c] = fmt.parseMoney(form.elements[`budgets.${c}`]?.value);
  return {
    categories: list(form, 'categories'),
    styles: list(form, 'styles'),
    uses: list(form, 'uses'),
    colorsLiked: list(form, 'colorsLiked'),
    colorsAvoided: list(form, 'colorsAvoided'),
    sizes: { shoe: readSize(form, 'sizes.shoe'), top: readSize(form, 'sizes.top'), bottom: readSize(form, 'sizes.bottom') },
    budgets,
  };
}
