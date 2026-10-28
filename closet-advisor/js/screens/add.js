// Ways to add an item other than a photo: the chooser, a product link, online store search, demo
// catalog search and manual entry. Each saves to the collection or the wishlist
// (?dest=owned|wishlist). Demo store links (.example) resolve against the catalog; any other
// store's page, and online store search, go through Rotation's local server (`npm start`) and
// become custom items the person checks before saving.
import { html, render } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import * as fmt from '../lib/format.js';
import { idempotencyKey } from '../lib/ids.js';
import { CATEGORIES, CATEGORY_SINGULAR, PRODUCT_TYPES, TYPE_LABEL } from '../data/schema.js';
import { PICKABLE_COLORS, colorLabel } from '../data/colors.js';
import { backHead, screenHead, media, label, notice, field, selectField, chipGroup, demoNote } from '../ui/components.js';
import {
  ownedDetailsFields,
  readOwnedDetails,
  wishFields,
  readWish,
  bindWishFields,
  bindUsualSize,
  profileSizeFor,
  createWithDuplicateCheck,
} from '../ui/item-forms.js';
import { openCatalogPicker } from '../ui/catalog-picker.js';
import {
  webResultLists,
  webLoading,
  webSaveForm,
  bindWebSave,
  bindRemoteImages,
  saveWebDraft,
  openWebSheet,
  loadStorePage,
  lookupFallback,
} from '../ui/web-product.js';
import { hydratePhotos } from '../ui/hydrate.js';
import { pill } from '../ui/screen-kit.js';
import { openSheet, toast, toastError, withBusy, showFieldErrors } from '../lib/ui.js';

const destOf = (ctx) => (ctx.query.dest === 'wishlist' ? 'wishlist' : 'owned');
const bareHost = (host) => String(host ?? '').replace(/^www\./, '');

function destSwitch(path, ctx) {
  const dest = destOf(ctx);
  const q = (d) => {
    const params = new URLSearchParams({ ...ctx.query, dest: d });
    return `#${path}?${params}`;
  };
  return html`<div class="cluster" role="group" aria-label="Save to">
    ${pill(q('owned'), 'I own it', dest === 'owned')}
    ${pill(q('wishlist'), 'I want it', dest === 'wishlist')}
  </div>`;
}

/** The details form for the chosen destination. */
function destFields(dest, opts, owned) {
  return dest === 'wishlist' ? wishFields({ ...opts, values: { reason: 'want_exact', ...(opts.values ?? {}) }, ownedItems: owned }) : ownedDetailsFields(opts);
}

/** Creates the item for the destination, asking about duplicates; returns the view or null. */
async function saveItem(ctx, dest, form, base, key) {
  return createWithDuplicateCheck(
    ({ allowDuplicate }) => {
      const idem = allowDuplicate ? `${key}-dup` : key;
      return dest === 'wishlist'
        ? ctx.api.createWishlist({ ...base, ...readWish(form), allowDuplicate, idempotencyKey: idem })
        : ctx.api.createOwned({ ...base, details: readOwnedDetails(form, base.category), allowDuplicate, idempotencyKey: idem });
    },
    { dest, navigate: ctx.navigate },
  );
}

function done(ctx, dest, item) {
  if (!item) return;
  toast(dest === 'wishlist' ? 'Saved to your wishlist' : 'Added to your collection');
  ctx.navigate(`/${dest === 'wishlist' ? 'wishlist' : 'collection'}/${encodeURIComponent(item.id)}`, { replace: true });
}

// Answers from the local server, kept for this page load so switching "I own it / I want it" or
// going back to a search shows them again without asking the store or Bing a second time. Only
// usable answers are kept; a request still running is shared.
const answers = new Map();
const MAX_ANSWERS = 12;

function remember(key, run, keep) {
  let entry = answers.get(key);
  if (!entry) {
    entry = { value: undefined, promise: null };
    entry.promise = run().then(
      (value) => {
        if (keep(value)) entry.value = value;
        else answers.delete(key);
        return value;
      },
      (error) => {
        answers.delete(key);
        throw error;
      },
    );
    answers.set(key, entry);
    if (answers.size > MAX_ANSWERS) answers.delete(answers.keys().next().value);
  }
  return entry.promise;
}

const remembered = (key) => answers.get(key)?.value;
const answerKey = (ctx, kind, text) => `${ctx.session?.id ?? ''}|${kind}|${text}`;

/** Opens a store listing or store page from search results in the save sheet. */
async function openWebPick(ctx, dest, pick) {
  const key = idempotencyKey();
  const [profile, owned] = await Promise.all([ctx.api.getProfile({}), ctx.api.listOwned({})]);
  const out = await openWebSheet({
    ...pick,
    dest,
    profile,
    ownedItems: owned.items,
    async save({ form, draft, values, close }) {
      const item = await saveWebDraft(ctx.api, { dest, draft, values, form, key, navigate: (path) => close({ navigate: path }) });
      return item ? { item } : null;
    },
  });
  if (out?.navigate) ctx.navigate(out.navigate);
  else if (out?.item) done(ctx, dest, out.item);
}

/** A store page read as a product: the save form, filled in from the page. */
function foundView(out, dest, link) {
  return html`${notice({ tone: 'ok', title: `Found on ${out.page?.host ?? 'the store'}`, body: 'Rotation filled in what the page says. Check it, then save.' })}
    ${webSaveForm(out.draft, { dest, profile: link.profile, ownedItems: link.ownedItems })}`;
}

const SEARCH_PROBLEM = {
  not_connected: 'Real store search is off',
  blocked: "Bing didn't allow the search",
  unavailable: "Online stores couldn't be searched",
  invalid: "That search couldn't run",
};

function searchProblem(out, dest) {
  return html`<div class="stack stack-sm">
    ${notice({ tone: out.status === 'not_connected' ? 'info' : 'warn', title: SEARCH_PROBLEM[out.status] ?? SEARCH_PROBLEM.unavailable, body: out.reason })}
    <div class="button-row">
      <a class="btn btn-secondary" href="#/add/search?dest=${dest}">${icon('search')}Search the demo catalog</a>
      <a class="btn btn-ghost" href="#/add/manual?dest=${dest}">Enter it yourself</a>
    </div>
  </div>`;
}

function searchResults(out, dest) {
  if (out.status !== 'ok') return searchProblem(out, dest);
  return html`<p class="small muted">Results for <strong>${out.query}</strong> from Bing. Choose one to check its details and save it.</p>
    ${webResultLists(out, { empty: 'Bing found no store listings or pages for this. Try the brand and model, or a style code.' })}`;
}

export default [
  {
    path: '/add',
    title: 'Add an item',
    tab: null,
    roles: ['user'],
    render(ctx) {
      const dest = destOf(ctx);
      const ways = [
        { path: '/add/photo', icon: 'camera', title: 'Take a photo', body: 'Matched on this device. You can also search online stores with it.' },
        { path: '/add/web', icon: 'globe', title: 'Search online stores', body: 'Find a real product by name or code.' },
        { path: '/add/link', icon: 'link', title: 'Paste a product link', body: "From any store's product page." },
        { path: '/add/search', icon: 'search', title: 'Search the demo catalog', body: 'By brand, model, color or code.' },
        { path: '/add/manual', icon: 'edit', title: 'Enter it yourself', body: "For things that aren't in the catalog." },
      ];
      return html`<div class="stack stack-lg">
        ${screenHead({ title: 'Add an item' })}
        ${destSwitch('/add', ctx)}
        <ul class="list">${ways.map(
          (w) => html`<li><a class="list-item" href="#${w.path}?dest=${dest}">
            <span class="list-thumb">${icon(w.icon)}</span>
            <span class="grow"><span>${w.title}</span><span>${w.body}</span></span>
            ${icon('chevron-right')}
          </a></li>`,
        )}</ul>
        ${demoNote("The demo catalog's brands, retailers and prices are fictional. Online stores and product links are real, read through Rotation's local server.")}
      </div>`;
    },
  },
  {
    path: '/add/link',
    title: 'Add from a link',
    tab: null,
    roles: ['user'],
    async render(ctx) {
      const dest = destOf(ctx);
      const url = (ctx.query.url ?? '').trim();
      ctx.linkBase = null;
      ctx.webLink = null;
      let extra = '';
      if (url) {
        const result = await ctx.api.importFromUrl({ url });
        if (result.status === 'resolved') {
          const [profile, owned, full] = await Promise.all([ctx.api.getProfile({}), ctx.api.listOwned({}), ctx.api.getProduct({ productId: result.productId })]);
          const product = full.product;
          ctx.linkBase = { category: product.category, productId: result.productId, variantId: result.variantId, source: 'product_link', sourceUrl: result.url };
          const opts = { category: product.category, type: product.type, sizing: product.sizing, usual: profileSizeFor(profile, product.category, product.type), values: { size: result.size, desired: { size: result.size } } };
          const variant = full.variants.find((v) => v.id === result.variantId);
          extra = html`<section class="stack">
            ${notice({ tone: 'ok', title: 'Found it', body: `This link is ${result.retailer?.name ?? 'a demo store'}'s listing for this product.` })}
            <div class="row" style="--gap: var(--s4); align-items: flex-start">
              <div style="width: 120px; flex: none">${media(variant?.image, { alt: product.name, category: product.category })}</div>
              ${label({ brand: product.brand.name, name: product.name, variant: variant?.name, code: variant?.code, state: dest === 'wishlist' ? 'wishlist' : 'owned' })}
            </div>
            ${result.sizeNote ? html`<p class="small muted">${result.sizeNote}</p>` : ''}
            <form class="stack" data-link-save novalidate>
              ${destFields(dest, opts, owned.items)}
              <button type="submit" class="btn btn-primary btn-block">${dest === 'wishlist' ? 'Save to wishlist' : 'Add to collection'}</button>
            </form>
          </section>`;
        } else if (result.status === 'unsupported_link' && result.code === 'unknown_store') {
          // Not a demo store: the local server reads the real page. That runs in mount, so the
          // screen shows at once and says what it's waiting for.
          const [profile, owned] = await Promise.all([ctx.api.getProfile({}), ctx.api.listOwned({})]);
          const link = result.url ?? url;
          ctx.webLink = { url: link, host: bareHost(result.host), key: answerKey(ctx, 'link', link), profile, ownedItems: owned.items };
          const known = remembered(ctx.webLink.key);
          extra = html`<section class="stack" data-web-link>${known ? foundView(known, dest, ctx.webLink) : webLoading(`Reading the page on ${ctx.webLink.host || 'the store'}`)}</section>`;
        } else {
          // Invalid links, and demo store links that aren't a product or a listing.
          extra = notice({ tone: 'warn', title: "That link didn't work", body: result.reason });
        }
      }
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Add from a link', back: `#/add?dest=${dest}` })}
        ${destSwitch('/add/link', ctx)}
        <form class="stack stack-sm" data-link-form novalidate>
          ${field({
            label: 'Product link',
            name: 'url',
            type: 'url',
            value: url,
            placeholder: 'https://',
            required: true,
            attrs: 'autocomplete="off" autocapitalize="off" spellcheck="false"',
            hint: "From any store's product page; https:// is optional. Demo store links (.example) work anywhere; other stores are read by Rotation's local server.",
          })}
          <button type="submit" class="btn btn-secondary">Look up</button>
        </form>
        ${extra}
        ${demoNote('Demo stores use .example addresses, like northline.example. Product pages in Rotation show them in "Where to buy".')}
      </div>`;
    },
    mount(root, ctx) {
      const dest = destOf(ctx);
      const key = idempotencyKey();
      const offs = [bindWishFields(root), bindUsualSize(root), bindRemoteImages(root)];
      let alive = true;
      ctx.on('submit', '[data-link-form]', (event, form) => {
        event.preventDefault();
        const url = form.elements.url.value.trim();
        if (!url) {
          showFieldErrors(form, { details: { fields: { url: 'Paste a product link' } } });
          return;
        }
        ctx.navigate(`/add/link?${new URLSearchParams({ dest, url })}`, { replace: true });
      });
      ctx.on('submit', '[data-link-save]', async (event, form) => {
        event.preventDefault();
        await withBusy(form.querySelector('[type="submit"]'), async () => {
          try {
            done(ctx, dest, await saveItem(ctx, dest, form, ctx.linkBase, key));
          } catch (error) {
            if (!showFieldErrors(form, error)) toastError(error);
          }
        });
      });

      const link = ctx.webLink;
      const host = link ? root.querySelector('[data-web-link]') : null;
      if (host) {
        const bindForm = (draft) => {
          hydratePhotos(host);
          offs.push(
            bindWebSave(host, {
              draft,
              dest,
              profile: link.profile,
              ownedItems: link.ownedItems,
              async save({ form, values }) {
                done(ctx, dest, await saveWebDraft(ctx.api, { dest, draft, values, form, key, navigate: ctx.navigate }));
              },
            }),
          );
        };
        const known = remembered(link.key);
        if (known) {
          bindForm(known.draft);
        } else {
          remember(link.key, () => ctx.api.lookupProductPage({ url: link.url }), (out) => out?.status === 'found' && Boolean(out.draft))
            .then(async (out) => {
              if (!alive) return;
              if (out.status === 'found' && out.draft) {
                render(host, foundView(out, dest, link));
                bindForm(out.draft);
                return;
              }
              const fallback = await lookupFallback(ctx.api, { out, url: link.url, dest });
              if (alive) render(host, fallback);
            })
            .catch((error) => {
              if (alive) render(host, notice({ tone: 'danger', title: "The store page couldn't be read", body: error?.message ?? 'Try again in a moment.' }));
            });
        }
      }
      return () => {
        alive = false;
        offs.forEach((off) => off());
      };
    },
  },
  {
    path: '/add/web',
    title: 'Search online stores',
    tab: null,
    roles: ['user'],
    async render(ctx) {
      const dest = destOf(ctx);
      const q = (ctx.query.q ?? '').trim();
      // Reads ./api/status.json once per page load; nothing is sent to a store or Bing here.
      const status = await ctx.api.webStatus({});
      ctx.webSearch = status.live && q ? { q, key: answerKey(ctx, 'search', q.toLowerCase()) } : null;
      const known = ctx.webSearch ? remembered(ctx.webSearch.key) : null;
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Search online stores', back: `#/add?dest=${dest}` })}
        ${destSwitch('/add/web', ctx)}
        <form class="stack stack-sm" data-web-form role="search" novalidate>
          <div class="field">
            <label class="field-label" for="f-web-q">Product name or code</label>
            <div class="input-group">
              <input class="input" id="f-web-q" name="q" type="search" value="${q}" placeholder="Brand, model or style code" autocomplete="off" enterkeyhint="search" maxlength="200">
              <button type="submit" class="btn btn-primary">Search</button>
            </div>
            <p class="field-hint">Rotation's local server asks Bing Shopping and Bing web search. Nothing is saved until you choose a result.</p>
          </div>
        </form>
        ${status.live ? '' : searchProblem({ status: 'not_connected', reason: status.reason }, dest)}
        <div class="stack" data-web-results>${known ? searchResults(known, dest) : ctx.webSearch ? webLoading('Searching online stores') : ''}</div>
        ${demoNote("Store results are real listings and pages that Rotation doesn't check. The demo catalog is separate and fictional.")}
      </div>`;
    },
    mount(root, ctx) {
      const dest = destOf(ctx);
      const host = root.querySelector('[data-web-results]');
      const search = ctx.webSearch;
      let alive = true;
      let current = search ? remembered(search.key) ?? null : null;
      const offImages = bindRemoteImages(root);

      ctx.on('submit', '[data-web-form]', (event, form) => {
        event.preventDefault();
        const q = form.elements.q.value.trim();
        if (q.length < 2) {
          showFieldErrors(form, { details: { fields: { q: 'Type at least 2 characters, like a brand and model' } } });
          return;
        }
        // A new history entry per search, so back and forward step through them.
        ctx.navigate(`/add/web?${new URLSearchParams({ dest, q })}`);
      });

      if (search && !current) {
        remember(search.key, () => ctx.api.searchWebProducts({ query: search.q }), (out) => out?.status === 'ok')
          .then((out) => {
            if (!alive) return;
            current = out;
            render(host, searchResults(out, dest));
          })
          .catch((error) => {
            if (!alive) return;
            const form = root.querySelector('[data-web-form]');
            if (form && showFieldErrors(form, error)) render(host, '');
            else render(host, notice({ tone: 'danger', title: "Online stores couldn't be searched", body: error?.message ?? 'Try again in a moment.' }));
          });
      }

      ctx.on('click', '[data-web-listing]', (event, button) => {
        const listing = current?.shopping?.find((l) => l.id === button.dataset.webListing);
        if (!listing?.draft) return;
        withBusy(button, () => openWebPick(ctx, dest, { draft: listing.draft, priceText: listing.priceText })).catch(toastError);
      });
      ctx.on('click', '[data-web-result]', (event, button) => {
        const result = current?.results?.find((r) => r.id === button.dataset.webResult);
        if (!result) return;
        withBusy(button, () =>
          openWebPick(ctx, dest, { loadingText: `Reading the page on ${result.host}`, load: () => loadStorePage(ctx.api, { url: result.url, dest }) }),
        ).catch(toastError);
      });
      return () => {
        alive = false;
        offImages();
      };
    },
  },
  {
    path: '/add/search',
    title: 'Search the demo catalog',
    tab: null,
    roles: ['user'],
    render(ctx) {
      const dest = destOf(ctx);
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Search the demo catalog', back: `#/add?dest=${dest}` })}
        ${destSwitch('/add/search', ctx)}
        <p>Find the product, then choose your exact version.</p>
        <button type="button" class="btn btn-primary btn-block" data-open-picker>${icon('search')}Search</button>
        <p class="small muted">Looking for a real product? <a href="#/add/web?dest=${dest}">Search online stores</a> instead.</p>
        ${demoNote()}
      </div>`;
    },
    mount(root, ctx) {
      const dest = destOf(ctx);
      const open = async () => {
        const pick = await openCatalogPicker({ confirmLabel: 'Next' });
        if (!pick) return;
        const [profile, owned, full] = await Promise.all([ctx.api.getProfile({}), ctx.api.listOwned({}), ctx.api.getProduct({ productId: pick.product.id })]);
        const product = full.product;
        const key = idempotencyKey();
        const base = { category: product.category, productId: product.id, variantId: pick.variant?.id ?? null, source: 'catalog_search' };
        const opts = { category: product.category, type: product.type, sizing: product.sizing, usual: profileSizeFor(profile, product.category, product.type) };
        const item = await openSheet({
          title: `${product.brand.name} ${product.name}`,
          body: html`<form class="stack" novalidate>
            <p class="muted">${pick.variant?.name ?? 'Version not sure'}</p>
            ${destFields(dest, opts, owned.items)}
            <button type="submit" class="btn btn-primary btn-block">${dest === 'wishlist' ? 'Save to wishlist' : 'Add to collection'}</button>
          </form>`,
          onMount(el, close) {
            const offs = [bindWishFields(el), bindUsualSize(el)];
            hydratePhotos(el);
            el.querySelector('form').addEventListener('submit', async (event) => {
              event.preventDefault();
              const form = event.target;
              await withBusy(form.querySelector('[type="submit"]'), async () => {
                try {
                  const out = await saveItem({ ...ctx, navigate: (path) => close({ navigate: path }) }, dest, form, base, key);
                  if (out) close(out);
                } catch (error) {
                  if (!showFieldErrors(form, error)) toastError(error);
                }
              });
            });
            return () => offs.forEach((off) => off());
          },
        });
        if (item?.navigate) ctx.navigate(item.navigate);
        else done(ctx, dest, item);
      };
      ctx.on('click', '[data-open-picker]', () => open().catch(toastError));
      // Open straight away: searching is the only thing to do on this screen.
      const timer = setTimeout(() => open().catch(toastError), 0);
      return () => clearTimeout(timer);
    },
  },
  {
    path: '/add/manual',
    title: 'Add manually',
    tab: null,
    roles: ['user'],
    async render(ctx) {
      const dest = destOf(ctx);
      const q = ctx.query;
      const category = CATEGORIES.includes(q.category) ? q.category : 'sneaker';
      const types = PRODUCT_TYPES[category] ?? [];
      const type = types.includes(q.type) ? q.type : types[0];
      const [profile, owned] = await Promise.all([ctx.api.getProfile({}), ctx.api.listOwned({})]);
      const opts = { category, type, usual: profileSizeFor(profile, category, type) };
      const link = (patch) => `#/add/manual?${new URLSearchParams({ ...q, ...patch })}`;
      return html`<div class="stack stack-lg">
        ${backHead({ title: 'Enter it yourself', back: `#/add?dest=${dest}` })}
        ${destSwitch('/add/manual', ctx)}
        <div class="stack stack-sm">
          <span class="field-label">What is it?</span>
          <div class="cluster">${CATEGORIES.map((c) => pill(link({ category: c, type: '' }), CATEGORY_SINGULAR[c], c === category))}</div>
        </div>
        <form class="stack stack-lg" data-manual novalidate>
          <div class="form-grid two">
            ${field({ label: 'Brand', name: 'custom.brand', value: q.brand ?? '', required: true })}
            ${field({ label: 'Name', name: 'custom.name', value: q.name ?? '', required: true, placeholder: 'Model or a short description' })}
            ${field({ label: 'Color or version', name: 'custom.variantName', value: q.variantName ?? '', optional: true })}
            ${selectField({ label: 'Type', name: 'custom.type', options: types.map((t) => ({ value: t, label: TYPE_LABEL[t] ?? fmt.humanize(t) })), value: type })}
          </div>
          ${chipGroup({ legend: 'Main colors', name: 'colors', options: PICKABLE_COLORS.map((c) => ({ value: c, label: colorLabel(c) })), selected: [] })}
          ${destFields(dest, opts, owned.items)}
          <button type="submit" class="btn btn-primary btn-block">${dest === 'wishlist' ? 'Save to wishlist' : 'Add to collection'}</button>
        </form>
      </div>`;
    },
    mount(root, ctx) {
      const dest = destOf(ctx);
      const key = idempotencyKey();
      const offs = [bindWishFields(root), bindUsualSize(root)];
      const category = CATEGORIES.includes(ctx.query.category) ? ctx.query.category : 'sneaker';
      // The size control depends on the type (tops vs trousers), so a type change re-renders.
      ctx.on('change', 'select[name="custom.type"]', (event, select) => {
        if (category !== 'clothing') return;
        const form = select.form;
        const params = new URLSearchParams({ ...ctx.query, type: select.value, brand: form.elements['custom.brand'].value, name: form.elements['custom.name'].value, variantName: form.elements['custom.variantName'].value });
        ctx.navigate(`/add/manual?${params}`, { replace: true });
      });
      // The category and destination pills open a new form; carry over what was typed.
      ctx.on('click', 'a.chip[href^="#/add/manual?"]', (event, link) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const form = root.querySelector('form[data-manual]');
        const params = new URLSearchParams(link.getAttribute('href').split('?')[1]);
        for (const key of ['brand', 'name', 'variantName']) {
          const value = form?.elements[`custom.${key}`].value;
          if (value) params.set(key, value);
          else params.delete(key);
        }
        event.preventDefault();
        ctx.navigate(`/add/manual?${params}`);
      });
      ctx.on('submit', '[data-manual]', async (event, form) => {
        event.preventDefault();
        const custom = {
          brand: form.elements['custom.brand'].value,
          name: form.elements['custom.name'].value,
          variantName: form.elements['custom.variantName'].value,
          type: form.elements['custom.type'].value,
          colors: [...form.querySelectorAll('input[name="colors"]:checked')].map((el) => el.value),
        };
        const base = { category, custom, source: 'manual', sourceUrl: ctx.query.sourceUrl || undefined };
        await withBusy(form.querySelector('[type="submit"]'), async () => {
          try {
            done(ctx, dest, await saveItem(ctx, dest, form, base, key));
          } catch (error) {
            if (!showFieldErrors(form, error)) toastError(error);
          }
        });
      });
      return () => offs.forEach((off) => off());
    },
  },
];
