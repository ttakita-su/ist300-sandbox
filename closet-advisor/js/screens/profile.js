// Profile: the hub, preferences, feedback history, and privacy (export and delete).
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import * as fmt from '../lib/format.js';
import { signOut, resetDemo, applyTheme, savedTheme, storageKind } from '../client.js';
import { screenHead, backHead, segmented, emptyState, notice, field, thumb } from '../ui/components.js';
import { preferenceFields, readPreferences } from '../ui/preferences.js';
import { bindUsualSize } from '../ui/item-forms.js';
import { confirmDialog, downloadBlob, toast, toastError, withBusy, showFieldErrors } from '../lib/ui.js';

export default [
  {
    path: '/profile',
    title: 'Profile',
    tab: 'profile',
    roles: ['user'],
    async render(ctx) {
      const me = ctx.session;
      const links = [
        { href: '#/profile/preferences', icon: 'sliders', title: 'Preferences', body: 'Sizes, budgets, styles and colors' },
        { href: '#/profile/feedback', icon: 'history', title: 'Your feedback', body: 'What you told suggestions to show more or less of' },
        { href: '#/profile/stylist', icon: 'stylist', title: 'Stylist', body: 'Share items and get picks from a stylist' },
        { href: '#/profile/privacy', icon: 'shield', title: 'Privacy and data', body: 'Download or delete your data' },
      ];
      return html`<div class="stack stack-lg">
        ${screenHead({ title: me.displayName, lede: me.email })}
        <ul class="list">${links.map(
          (l) => html`<li><a class="list-item" href="${l.href}">
            <span class="list-thumb">${icon(l.icon)}</span>
            <span class="grow"><span>${l.title}</span><span>${l.body}</span></span>
            ${icon('chevron-right')}
          </a></li>`,
        )}</ul>
        <section class="stack stack-sm">
          <h2>Appearance</h2>
          ${segmented({ name: 'theme', label: 'Theme', value: savedTheme(), options: [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] })}
        </section>
        <section class="stack stack-sm">
          <h2>Account</h2>
          <div class="button-row">
            <button type="button" class="btn btn-secondary" data-signout>${icon('logout')}Sign out</button>
            ${me.demo ? html`<button type="button" class="btn btn-ghost" data-reset>${icon('refresh')}Reset demo data</button>` : ''}
          </div>
          <p class="small muted">${storageKind() === 'memory' ? "This browser blocks site storage, so nothing is kept after you close the tab." : 'Your data is stored in this browser only.'}</p>
        </section>
      </div>`;
    },
    mount(root, ctx) {
      ctx.on('change', 'input[name="theme"]', async (event, input) => {
        applyTheme(input.value);
        await ctx.api.updateProfile({ theme: input.value }).catch(() => {});
      });
      ctx.on('click', '[data-signout]', async () => {
        await signOut();
        ctx.navigate('/welcome', { replace: true });
      });
      ctx.on('click', '[data-reset]', async () => {
        const ok = await confirmDialog({ title: 'Reset the demo?', message: 'Every change in this browser is erased and the demo accounts start over.', confirmLabel: 'Reset', tone: 'danger' });
        if (ok) await resetDemo();
      });
    },
  },
  {
    path: '/profile/preferences',
    title: 'Preferences',
    tab: 'profile',
    roles: ['user'],
    async render(ctx) {
      const profile = await ctx.api.getProfile({});
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Preferences', back: '#/profile' })}
        <form class="stack stack-lg" data-prefs novalidate>
          ${preferenceFields(profile)}
          <button type="submit" class="btn btn-primary">Save preferences</button>
        </form>
      </div>`;
    },
    mount(root, ctx) {
      const off = bindUsualSize(root);
      ctx.on('submit', '[data-prefs]', async (event, form) => {
        event.preventDefault();
        await withBusy(form.querySelector('[type="submit"]'), async () => {
          try {
            await ctx.api.updateProfile(readPreferences(form));
            toast('Preferences saved');
          } catch (error) {
            if (!showFieldErrors(form, error)) toastError(error);
          }
        });
      });
      return off;
    },
  },
  {
    path: '/profile/feedback',
    title: 'Your feedback',
    tab: 'profile',
    roles: ['user'],
    async render(ctx) {
      const items = await ctx.api.listFeedback({});
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Your feedback', back: '#/profile' })}
        ${items.length
          ? html`<p class="muted">Removing feedback puts suggestions back the way they were.</p>
            <ul class="list">${items.map(
              (f) => html`<li class="list-item">
                <span class="list-thumb">${thumb(f.variant?.image, '', f.product?.category)}</span>
                <span class="grow"><span>${f.brandName} ${f.title}</span><span>${f.label}${f.contextItem ? `, for ${f.contextItem.title}` : ''}, ${fmt.relative(f.createdAt)}</span></span>
                <button type="button" class="btn btn-ghost btn-sm" data-remove-feedback="${f.id}">Remove</button>
              </li>`,
            )}</ul>`
          : emptyState({ iconName: 'history', title: 'No feedback yet', body: 'Use "More like this" or "Not my style" on suggestions and it shows up here.' })}
      </div>`;
    },
    mount(root, ctx) {
      ctx.on('click', '[data-remove-feedback]', async (event, button) => {
        await withBusy(button, async () => {
          try {
            await ctx.api.removeFeedback({ feedbackId: button.dataset.removeFeedback });
            ctx.refresh();
          } catch (error) {
            toastError(error);
          }
        });
      });
    },
  },
  {
    path: '/profile/privacy',
    title: 'Privacy and data',
    tab: 'profile',
    roles: ['user'],
    render(ctx) {
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Privacy and data', back: '#/profile' })}
        ${notice({ tone: 'info', iconName: 'lock', title: 'Stored in this browser', body: 'Your photos, items, notes and sizes stay on this device. Clicks to stores are recorded under a pseudonymous id, not your name.' })}
        <section class="panel stack stack-sm">
          <h2>Download your data</h2>
          <p class="small">Everything stored about your account, including photos, as one JSON file.</p>
          <button type="button" class="btn btn-secondary" data-export>${icon('download')}Download</button>
        </section>
        <section class="panel stack stack-sm">
          <h2>Delete your account</h2>
          <p class="small">${ctx.session.demo ? 'This is a demo account, so deleting it resets the whole demo instead.' : 'Removes your account, items, photos and history from this browser.'}</p>
          <form class="stack stack-sm" data-delete novalidate>
            ${field({ label: 'Type DELETE to confirm', name: 'confirm', attrs: 'autocomplete="off"' })}
            <button type="submit" class="btn btn-danger">${icon('trash')}Delete my account</button>
          </form>
        </section>
      </div>`;
    },
    mount(root, ctx) {
      ctx.on('click', '[data-export]', async (event, button) => {
        await withBusy(button, async () => {
          try {
            const data = await ctx.api.exportMyData({});
            downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'rotation-data.json');
          } catch (error) {
            toastError(error);
          }
        });
      });
      ctx.on('submit', '[data-delete]', async (event, form) => {
        event.preventDefault();
        await withBusy(form.querySelector('[type="submit"]'), async () => {
          try {
            const out = await ctx.api.deleteMyAccount({ confirm: form.elements.confirm.value.trim() });
            await signOut();
            if (out.reset) await resetDemo();
            else ctx.navigate('/welcome', { replace: true });
          } catch (error) {
            if (!showFieldErrors(form, error)) toastError(error);
          }
        });
      });
    },
  },
];
