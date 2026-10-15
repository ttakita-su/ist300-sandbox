// Cold-start survey. With nothing owned yet, the feed's picks are built from these answers.
import { html } from '../lib/html.js';
import { CATEGORIES } from '../data/schema.js';
import { screenHead } from '../ui/components.js';
import { preferenceFields, readPreferences } from '../ui/preferences.js';
import { showFieldErrors, toastError, withBusy } from '../lib/ui.js';

export default [
  {
    path: '/onboarding',
    title: 'Your preferences',
    tab: null,
    roles: ['user'],
    async render(ctx) {
      const profile = await ctx.api.getProfile({});
      return html`<div class="stack stack-lg">
        ${screenHead({ title: 'What are you shopping for?', lede: 'A few answers so suggestions make sense before you add anything. You can change these any time in Profile.' })}
        <form class="stack stack-lg" data-onboarding novalidate>
          ${preferenceFields(profile)}
          <div class="button-row">
            <button type="submit" class="btn btn-primary">Show my suggestions</button>
            <button type="button" class="btn btn-ghost" data-skip>Skip for now</button>
          </div>
        </form>
      </div>`;
    },
    mount(root, ctx) {
      ctx.on('submit', '[data-onboarding]', async (event, form) => {
        event.preventDefault();
        await withBusy(form.querySelector('[type="submit"]'), async () => {
          try {
            await ctx.api.completeOnboarding(readPreferences(form));
            ctx.navigate('/discover', { replace: true });
          } catch (error) {
            if (!showFieldErrors(form, error)) toastError(error);
          }
        });
      });
      ctx.on('click', '[data-skip]', async (event, button) => {
        await withBusy(button, async () => {
          try {
            await ctx.api.completeOnboarding({ categories: CATEGORIES });
            ctx.navigate('/discover', { replace: true });
          } catch (error) {
            toastError(error);
          }
        });
      });
    },
  },
];

