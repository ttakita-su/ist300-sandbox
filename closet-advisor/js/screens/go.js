// Redirect interstitial: records a pseudonymous click, discloses the affiliate relationship and
// names the destination before the person leaves. Nothing is marked purchased.
import { html, safeUrl } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { idempotencyKey } from '../lib/ids.js';
import { backHead, affiliateDisclosure, notice, demoNote } from '../ui/components.js';

// One key per interstitial, reused when the person retries the same offer.
const keys = new Map();

export default [
  {
    path: '/go/:offerId',
    title: 'Leaving Rotation',
    tab: null,
    roles: ['user', 'stylist'],
    async render(ctx) {
      const offerId = ctx.params.offerId;
      if (!keys.has(offerId)) keys.set(offerId, idempotencyKey());
      let click;
      try {
        click = await ctx.api.createClick({ offerId, idempotencyKey: keys.get(offerId) });
      } catch (error) {
        return html`<div class="stack stack-lg">
          ${backHead({ title: 'Leaving Rotation' })}
          ${notice({ tone: 'warn', title: error.code === 'unavailable' ? 'This listing is unavailable' : "Couldn't open this offer", body: error.message })}
        </div>`;
      }
      let host = click.retailer.domain;
      try {
        host = new URL(click.destination).host;
      } catch {
        // Keep the retailer domain.
      }
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Leaving Rotation' })}
        <section class="panel stack">
          <h2>You're going to ${click.retailer.name}</h2>
          <p>The link opens <strong>${host}</strong> in a new tab. Check the price, size and shipping there before you buy.</p>
          ${click.affiliate ? html`<p class="small">${click.affiliate.status === 'approved' ? 'This is an affiliate link.' : 'This is a plain link; the affiliate program is not active.'}</p>` : html`<p class="small">This is a plain link. Rotation has no affiliate program with this store.</p>`}
          ${affiliateDisclosure(click.disclosure)}
          <a class="btn btn-primary btn-block" href="${safeUrl(click.destination)}" target="_blank" rel="noopener noreferrer">Continue to ${click.retailer.name}${icon('external')}</a>
          <a class="btn btn-ghost btn-block" href="#/product/${encodeURIComponent(click.productId)}?variant=${encodeURIComponent(click.variantId)}" data-back>Back to offers</a>
        </section>
        ${demoNote('Demo store: the link goes to a reserved .example address, so no real store opens.')}
      </div>`;
    },
  },
];
