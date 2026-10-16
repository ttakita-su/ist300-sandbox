// Sign in, sign up and the demo accounts. A person who hasn't finished the survey goes to
// onboarding first (the router doesn't do that itself).
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { setSession } from '../client.js';
import { HOME_FOR_ROLE } from '../data/schema.js';
import { field, demoNote, notice } from '../ui/components.js';
import { pill } from '../ui/screen-kit.js';
import { formData, showFieldErrors, toastError, withBusy } from '../lib/ui.js';

const ROLE_WORD = { user: 'Shopper', stylist: 'Stylist', admin: 'Admin' };

async function enter(ctx, result) {
  setSession(result);
  const session = result.session;
  if (session.role === 'user') {
    const profile = await ctx.api.getProfile({});
    if (!profile.onboardedAt) {
      ctx.navigate('/onboarding', { replace: true });
      return;
    }
  }
  const next = ctx.query.next;
  const home = HOME_FOR_ROLE[session.role] ?? '/discover';
  ctx.navigate(next && next.startsWith('/') && !next.startsWith('/welcome') ? next : home, { replace: true });
}

export default [
  {
    path: '/welcome',
    title: 'Welcome',
    tab: null,
    async render(ctx) {
      const accounts = await ctx.api.listDemoAccounts({});
      const mode = ctx.query.mode === 'signup' ? 'signup' : 'signin';
      return html`<div class="stack stack-lg">
        <header class="screen-head">
          <div>
            <h1>Rotation</h1>
            <p class="lede">Photograph what you own, find what goes with it, and compare offers before you buy.</p>
          </div>
        </header>
        ${notice({ tone: 'info', title: 'This is a prototype', body: "Your items and photos are kept in this browser. The catalog's brands, retailers and prices are fictional demo data. Real products can be looked up online while Rotation's local server is running." })}

        <section class="stack">
          <h2>Try a demo account</h2>
          <ul class="list">${accounts.map(
            (a) => html`<li><button type="button" class="list-item" data-demo="${a.id}">
              <span class="avatar" aria-hidden="true">${a.displayName.slice(0, 1)}</span>
              <span class="grow"><span>${a.displayName} <span class="badge badge-muted">${ROLE_WORD[a.role] ?? a.role}</span></span><span>${a.blurb}</span></span>
              ${icon('chevron-right')}
            </button></li>`,
          )}</ul>
        </section>

        <section class="panel stack">
          <nav class="cluster" aria-label="Account">
            ${pill('#/welcome', 'Sign in', mode === 'signin')}
            ${pill('#/welcome?mode=signup', 'Create account', mode === 'signup')}
          </nav>
          ${mode === 'signup'
            ? html`<form class="form-grid" data-signup novalidate>
                ${field({ label: 'Name', name: 'displayName', required: true, attrs: 'autocomplete="name"' })}
                ${field({ label: 'Email', name: 'email', type: 'email', required: true, attrs: 'autocomplete="email"' })}
                ${field({ label: 'Password', name: 'password', type: 'password', required: true, attrs: 'autocomplete="new-password"', hint: 'At least 8 characters.' })}
                <button type="submit" class="btn btn-primary btn-block">Create account</button>
              </form>`
            : html`<form class="form-grid" data-signin novalidate>
                ${field({ label: 'Email', name: 'email', type: 'email', required: true, attrs: 'autocomplete="email"' })}
                ${field({ label: 'Password', name: 'password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
                <button type="submit" class="btn btn-primary btn-block">Sign in</button>
              </form>`}
        </section>
        ${demoNote()}
      </div>`;
    },
    mount(root, ctx) {
      ctx.on('click', '[data-demo]', async (event, button) => {
        await withBusy(button, async () => {
          try {
            await enter(ctx, await ctx.api.signInDemo({ userId: button.dataset.demo }));
          } catch (error) {
            toastError(error);
          }
        });
      });
      const submit = (op) => async (event, form) => {
        event.preventDefault();
        await withBusy(form.querySelector('[type="submit"]'), async () => {
          try {
            await enter(ctx, await ctx.api[op](formData(form)));
          } catch (error) {
            if (!showFieldErrors(form, error)) toastError(error);
          }
        });
      };
      ctx.on('submit', '[data-signin]', submit('signIn'));
      ctx.on('submit', '[data-signup]', submit('signUp'));
    },
  },
];
