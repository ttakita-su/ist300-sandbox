// Admin: aggregate overview, provider simulations (to show failure states), ranking weights,
// stylist assignments, catalog corrections and outbound clicks. No screen shows anyone's items.
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import * as fmt from '../lib/format.js';
import { signOut } from '../client.js';
import { screenHead, emptyState, selectField, demoNote } from '../ui/components.js';
import { pill } from '../ui/screen-kit.js';
import { toast, toastError, withBusy } from '../lib/ui.js';

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'providers', label: 'Providers' },
  { id: 'weights', label: 'Ranking' },
  { id: 'accounts', label: 'Stylists' },
  { id: 'corrections', label: 'Corrections' },
  { id: 'clicks', label: 'Clicks' },
];

const stat = (labelText, value) => html`<div class="panel panel-flat stack stack-xs"><span class="small muted">${labelText}</span><strong class="num" style="font-size: 1.5rem">${value}</strong></div>`;

async function overview(api) {
  const o = await api.adminOverview({});
  return html`<div class="tile-grid">
      ${stat('Photo scans', o.scans.total)}
      ${stat('Scan time (median)', o.scans.latencyMs?.p50 != null ? `${o.scans.latencyMs.p50} ms` : 'No data')}
      ${stat('Failed jobs', o.jobs.failed + o.jobs.timedOut)}
      ${stat('Store clicks', o.clicks.total)}
      ${stat('Offers active', `${o.offers.active} of ${o.offers.total}`)}
      ${stat('Open corrections', o.corrections.open)}
    </div>
    <section class="stack stack-sm"><h2>Catalog</h2>
      <p>${fmt.plural(o.catalog.brands, 'brand')}, ${fmt.plural(o.catalog.products, 'product')}, ${fmt.plural(o.catalog.variants, 'version')}, ${fmt.plural(o.catalog.retailers, 'retailer')}.</p>
      <p class="small muted">Offer freshness: ${o.offers.freshness.fresh} fresh, ${o.offers.freshness.aging} aging, ${o.offers.freshness.stale} stale.</p>
    </section>
    <section class="stack stack-sm"><h2>Accounts</h2>
      <p>${Object.entries(o.accounts.byRole).map(([role, n]) => `${n} ${role}`).join(', ')}; ${fmt.plural(o.accounts.activeAssignments, 'active stylist assignment')}.</p>
    </section>`;
}

async function providers(api) {
  const p = await api.adminGetProviders({});
  return html`<p class="muted">Switch a provider to a failure mode to see how the app handles it.</p>
    <form class="stack" data-sim>
      ${p.providers.map(
        (pr) => html`<section class="panel stack stack-sm">
          <div class="spread"><strong>${pr.name}</strong><span class="badge ${pr.status === 'normal' || pr.status === 'connected' ? 'badge-ok' : pr.status === 'simulated' ? 'badge-warn' : 'badge-muted'}">${fmt.humanize(pr.status)}</span></div>
          <p class="small">${pr.detail}</p>
          ${pr.options?.length ? selectField({ label: 'Simulation', name: pr.id, options: pr.options.map((o) => ({ value: o, label: fmt.humanize(o) })), value: pr.simulation }) : ''}
        </section>`,
      )}
      <button type="submit" class="btn btn-primary">Apply</button>
    </form>`;
}

async function weights(api) {
  const w = await api.adminGetWeights({});
  return html`<p class="muted">How suggestions are ranked. Changes apply to everyone's next request.</p>
    <form class="stack" data-weights>
      ${Object.entries(w.ranges).map(
        ([key, r]) => html`<div class="field">
          <label class="field-label" for="f-w-${key}">${r.label} <output class="num" for="f-w-${key}">${w.weights[key]}</output></label>
          <input id="f-w-${key}" name="${key}" type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${w.weights[key]}" style="width:100%">
          ${r.help ? html`<p class="field-hint">${r.help}</p>` : ''}
        </div>`,
      )}
      <div class="button-row">
        <button type="submit" class="btn btn-primary">Save weights</button>
        ${w.custom ? html`<button type="button" class="btn btn-ghost" data-reset-weights>Reset to defaults</button>` : ''}
      </div>
    </form>`;
}

async function accounts(api) {
  const { accounts: list, assignments } = await api.adminListAccounts({});
  const stylists = list.filter((a) => a.role === 'stylist');
  const users = list.filter((a) => a.role === 'user');
  const active = assignments.filter((a) => a.active);
  return html`<section class="stack stack-sm"><h2>Active assignments</h2>
      ${active.length
        ? html`<ul class="list">${active.map((a) => html`<li class="list-item"><span class="grow"><span>${a.stylistName} works with ${a.userName}</span><span>Since ${fmt.date(a.createdAt)}</span></span><button type="button" class="btn btn-ghost btn-sm" data-end="${a.id}">End</button></li>`)}</ul>`
        : html`<p class="muted">None.</p>`}
    </section>
    <form class="panel stack" data-assign>
      <h2>Assign a stylist</h2>
      ${selectField({ label: 'Stylist', name: 'stylistId', options: stylists.map((s) => ({ value: s.id, label: s.displayName })) })}
      ${selectField({ label: 'Client', name: 'userId', options: users.map((u) => ({ value: u.id, label: u.displayName })) })}
      <button type="submit" class="btn btn-primary">Assign</button>
    </form>`;
}

async function corrections(api) {
  const list = await api.adminListCorrections({ status: 'all' });
  if (!list.length) return emptyState({ iconName: 'flag', title: 'No corrections reported' });
  return html`<ul class="stack">${list.map(
    (c) => html`<li class="panel stack stack-sm">
      <strong>${c.brandName} ${c.productName}${c.variantName ? `, ${c.variantName}` : ''}</strong>
      <p class="small">${c.fieldLabel}: ${String(c.currentValue ?? 'not set')} → ${String(c.proposedValue)}</p>
      ${c.note ? html`<p class="small muted">${c.note}</p>` : ''}
      ${c.status === 'open'
        ? html`<div class="button-row"><button type="button" class="btn btn-primary btn-sm" data-resolve="${c.id}" data-decision="accepted">Accept</button><button type="button" class="btn btn-ghost btn-sm" data-resolve="${c.id}" data-decision="rejected">Reject</button></div>`
        : html`<span class="badge badge-muted">${fmt.humanize(c.status)}</span>`}
    </li>`,
  )}</ul>`;
}

async function clicks(api) {
  const { clicks: list, summary } = await api.adminListClicks({ limit: 50 });
  return html`<p>${fmt.plural(summary.total, 'click')}: ${summary.tracked} tracked, ${summary.untracked} plain links. Clicks carry a pseudonymous id, never a name.</p>
    ${list.length
      ? html`<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Retailer</th><th>Tracked</th><th>Person</th></tr></thead>
          <tbody>${list.map((c) => html`<tr><td>${fmt.relative(c.createdAt)}</td><td>${c.retailerName}</td><td>${c.tracked ? 'Yes' : 'No'}</td><td class="code">${c.analyticsId}</td></tr>`)}</tbody></table></div>`
      : ''}`;
}

const RENDER = { overview, providers, weights, accounts, corrections, clicks };

async function renderAdmin(ctx) {
  const section = RENDER[ctx.params.section] ? ctx.params.section : 'overview';
  const body = await RENDER[section](ctx.api);
  return html`<div class="stack stack-lg">
    ${screenHead({ title: 'Admin', lede: `Signed in as ${ctx.session.displayName}`, actions: html`<button type="button" class="btn btn-ghost btn-sm" data-signout>${icon('logout')}Sign out</button>` })}
    <nav class="cluster" aria-label="Admin sections">${SECTIONS.map((s) => pill(`#/admin/${s.id}`, s.label, s.id === section))}</nav>
    ${body}
    ${demoNote()}
  </div>`;
}

function mountAdmin(root, ctx) {
  const act = (button, fn, message) =>
    withBusy(button, async () => {
      try {
        await fn();
        if (message) toast(message);
        ctx.refresh();
      } catch (error) {
        toastError(error);
      }
    });
  ctx.on('click', '[data-signout]', async () => {
    await signOut();
    ctx.navigate('/welcome', { replace: true });
  });
  ctx.on('submit', '[data-sim]', (event, form) => {
    event.preventDefault();
    const args = {};
    for (const el of form.querySelectorAll('select')) args[el.name] = el.value;
    act(form.querySelector('[type="submit"]'), () => ctx.api.adminSetProviderSimulation(args), 'Simulation updated');
  });
  ctx.on('input', '[data-weights] input[type="range"]', (event, input) => {
    const out = input.closest('.field').querySelector('output');
    if (out) out.textContent = input.value;
  });
  ctx.on('submit', '[data-weights]', (event, form) => {
    event.preventDefault();
    const w = {};
    for (const el of form.querySelectorAll('input[type="range"]')) w[el.name] = Number(el.value);
    act(form.querySelector('[type="submit"]'), () => ctx.api.adminSetWeights({ weights: w }), 'Weights saved');
  });
  ctx.on('click', '[data-reset-weights]', (event, button) => act(button, () => ctx.api.adminSetWeights({ reset: true }), 'Weights reset'));
  ctx.on('submit', '[data-assign]', (event, form) => {
    event.preventDefault();
    act(form.querySelector('[type="submit"]'), () => ctx.api.adminAssignStylist({ stylistId: form.elements.stylistId.value, userId: form.elements.userId.value }), 'Stylist assigned');
  });
  ctx.on('click', '[data-end]', (event, button) => act(button, () => ctx.api.adminEndAssignment({ assignmentId: button.dataset.end }), 'Assignment ended'));
  ctx.on('click', '[data-resolve]', (event, button) =>
    act(button, () => ctx.api.adminResolveCorrection({ correctionId: button.dataset.resolve, decision: button.dataset.decision }), 'Done'),
  );
}

export default [
  { path: '/admin', title: 'Admin', tab: null, roles: ['admin'], render: renderAdmin, mount: mountAdmin },
  { path: '/admin/:section', title: 'Admin', tab: null, roles: ['admin'], render: renderAdmin, mount: mountAdmin },
];

