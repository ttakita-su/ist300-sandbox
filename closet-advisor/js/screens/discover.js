// Discover: the recommendation feed, the request box, and full result lists for one mode.
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { constraintsFromChips } from '../engine/parse-request.js';
import { screenHead, backHead, recCard, notice, emptyState, demoNote } from '../ui/components.js';
import { recActions, bindRecActions } from '../ui/screen-kit.js';

const MODE_TITLE = {
  similar: 'Similar to what you have',
  matching: 'Goes with what you own',
  alternatives: 'Alternatives',
  feed: 'Suggestions',
};

function requestBox(value = '') {
  return html`<form class="stack stack-sm" data-request-form role="search">
    <label class="field-label" for="f-request">Ask for something</label>
    <div class="input-group">
      <input class="input" id="f-request" name="text" type="search" maxlength="300" value="${value}" placeholder="Brown boots under $200 that go with my navy jacket" autocomplete="off">
      <button type="submit" class="btn btn-primary">${icon('search')}Find</button>
    </div>
  </form>`;
}

function bindRequestBox(ctx) {
  ctx.on('submit', '[data-request-form]', (event, form) => {
    event.preventDefault();
    const text = form.elements.text.value.trim();
    if (text) ctx.navigate(ctx.href('/recs', { text }).slice(1));
  });
}

function section(s, requestId) {
  const seedType = s.id.startsWith('alternatives-') ? 'wishlist' : 'owned';
  const more = s.mode && s.mode !== 'feed' && s.seedIds?.length
    ? html`<a class="link-btn" href="${`#/recs?mode=${encodeURIComponent(s.mode)}&seed=${encodeURIComponent(s.seedIds.join(','))}&seedType=${seedType}`}">See more</a>`
    : '';
  return html`<section class="section stack">
    <div class="section-head">
      <div><h2>${s.title}</h2>${s.description ? html`<p>${s.description}</p>` : ''}</div>
      ${more}
    </div>
    ${s.items.length
      ? html`<div class="stack">${s.items.map((item) => recCard(item, { actions: recActions(item, requestId) }))}</div>`
      : html`<p class="muted">${s.emptyReason ?? 'Nothing to show here yet.'}</p>`}
  </section>`;
}

function parseConstraints(text) {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The parser's leftover words, as a list or a string. */
function unparsedText(value) {
  return (Array.isArray(value) ? value.join(' ') : String(value ?? '')).trim();
}

/** Applies a relaxation patch: null removes a key. */
function merge(base, patch) {
  const next = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next;
}

export default [
  {
    path: '/discover',
    title: 'Discover',
    tab: 'discover',
    roles: ['user'],
    async render(ctx) {
      const profile = await ctx.api.getProfile({});
      if (!profile.onboardedAt) {
        ctx.navigate('/onboarding', { replace: true });
        return html``;
      }
      let feed;
      try {
        feed = await ctx.api.recommend({ mode: 'feed' });
      } catch (error) {
        if (error?.code !== 'unavailable') throw error;
        return html`<div class="stack stack-lg">
          ${screenHead({ title: 'Discover' })}
          ${notice({ tone: 'warn', title: 'Suggestions are unavailable', body: error.message })}
        </div>`;
      }
      const sections = feed.sections.filter((s) => s.items.length || s.emptyReason);
      return html`<div class="stack stack-lg">
        ${screenHead({ title: 'Discover', lede: feed.coldStart ? 'Picks from your preferences. Add what you own and these get more specific.' : 'Built from what you own and what you want.' })}
        ${requestBox()}
        ${feed.coldStart
          ? notice({ tone: 'info', title: 'Start with what you own', body: html`Add a few items and suggestions will pair with them. <a href="#/add">Add an item</a>` })
          : ''}
        ${sections.length
          ? sections.map((s) => section(s, feed.requestId))
          : emptyState({ iconName: 'compass', title: 'No suggestions yet', body: 'Add items to your collection or wishlist to get suggestions.', actions: html`<a class="btn btn-primary" href="#/add">Add an item</a>` })}
        ${demoNote()}
      </div>`;
    },
    mount(root, ctx) {
      bindRequestBox(ctx);
      bindRecActions(ctx);
    },
  },
  {
    path: '/recs',
    title: (ctx) => (ctx.query.text ? 'Results' : MODE_TITLE[ctx.query.mode] ?? 'Recommendations'),
    tab: 'discover',
    roles: ['user'],
    async render(ctx) {
      const q = ctx.query;
      const args = { limit: 24 };
      if (q.text) args.text = q.text;
      if (q.mode) args.mode = q.mode;
      if (q.seed) args.seedIds = q.seed.split(',').filter(Boolean);
      if (q.seedType) args.seedType = q.seedType;
      const constraints = parseConstraints(q.c);
      if (constraints) args.constraints = constraints;
      if (!args.text && !args.mode) args.mode = 'feed';

      const result = await ctx.api.recommend(args);
      const title = q.text ? 'Results' : MODE_TITLE[result.mode ?? args.mode] ?? 'Recommendations';
      const interp = result.interpretation;
      // What the next request starts from when a chip is removed or a relaxation is applied.
      const state = {
        mode: result.mode ?? args.mode,
        seed: (args.seedIds ?? interp?.seedIds ?? []).join(','),
        seedType: args.seedType ?? (interp?.seedIds?.length ? 'owned' : undefined),
        constraints: { ...(interp?.constraints ?? {}), ...(constraints ?? {}) },
        chips: interp?.chips ?? [],
        relaxations: result.relaxations ?? [],
      };
      ctx.recsState = state;

      return html`<div class="stack stack-lg">
        ${backHead({ title, back: '#/discover' })}
        ${requestBox(q.text ?? '')}
        ${interp
          ? html`<section class="stack stack-sm" aria-label="How we read your request">
              <p class="small muted">We looked for:</p>
              <div class="cluster">${state.chips.length
                ? state.chips.map(
                    (chip, i) => html`<span class="chip is-selected">${chip.label}<button type="button" class="chip-remove" style="background:none;border:0;color:inherit;padding:4px;display:inline-flex;cursor:pointer" data-remove-chip="${i}" aria-label="Remove ${chip.label}">${icon('x', { className: 'icon-sm' })}</button></span>`,
                  )
                : html`<span class="muted small">Nothing specific. Showing general suggestions.</span>`}</div>
              ${unparsedText(interp.unparsed) ? html`<p class="small muted">Not understood: “${unparsedText(interp.unparsed)}”</p>` : ''}
            </section>`
          : ''}
        ${result.applied
          ? html`<div class="cluster">
              ${result.applied.hard.map((a) => html`<span class="badge badge-muted">${a.label}</span>`)}
              ${result.applied.soft.map((a) => html`<span class="badge badge-muted">Prefers: ${a.label}</span>`)}
            </div>`
          : ''}
        ${result.sections
          ? result.sections.map((s) => section(s, result.requestId))
          : result.items.length
            ? html`<div class="stack">${result.items.map((item) => recCard(item, { actions: recActions(item, result.requestId) }))}</div>`
            : emptyState({ iconName: 'compass', title: 'Nothing matches yet', body: result.emptyReason ?? 'Try loosening the request.' })}
        ${result.relaxations?.length
          ? html`<section class="stack stack-sm">
              <h2>Widen the search</h2>
              <div class="button-row">${result.relaxations.map(
                (r, i) => html`<button type="button" class="btn btn-secondary" data-relax="${i}">${r.label}${r.wouldReturn != null ? ` (${r.wouldReturn})` : ''}</button>`,
              )}</div>
            </section>`
          : ''}
        ${demoNote()}
      </div>`;
    },
    mount(root, ctx) {
      bindRequestBox(ctx);
      bindRecActions(ctx);
      const go = (constraints) => {
        const s = ctx.recsState;
        ctx.navigate(ctx.href('/recs', { mode: s.mode, seed: s.seed, seedType: s.seed ? s.seedType : undefined, c: JSON.stringify(constraints) }).slice(1));
      };
      ctx.on('click', '[data-relax]', (event, button) => {
        const s = ctx.recsState;
        go(merge(s.constraints, s.relaxations[Number(button.dataset.relax)]?.constraints));
      });
      ctx.on('click', '[data-remove-chip]', (event, button) => {
        const s = ctx.recsState;
        const chips = s.chips.filter((_, i) => i !== Number(button.dataset.removeChip));
        go(constraintsFromChips(chips));
      });
    },
  },
];
