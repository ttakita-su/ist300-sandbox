// Owned inventory: the person's collection. Every read and write is scoped to the signed-in
// person, and another person's item ids behave exactly like ids that don't exist.
import { ApiError, invalid } from '../errors.js';
import { newId } from '../../lib/ids.js';
import { isOwner } from '../policy.js';
import { OWNED_DISPLAYS, buildOwnedItem, catalogIdentity, cleanLinkUrl, cleanWebSnapshot, iso, makeIdentity, patchOwnedItem, webIdentity } from '../records.js';
import { copyCounts, ownedView } from '../views.js';
import { findDuplicates } from '../../engine/duplicates.js';
import { catalogImageFor } from '../../engine/provenance.js';
import { CATEGORIES, TYPE_LABEL } from '../../data/schema.js';
import { COLORS, colorLabel } from '../../data/colors.js';
import { variantTitle } from '../../data/catalog-index.js';
import { deletePhotos } from './photos.js';
import { coerceCorrectionValue, correctionField } from './admin.js';

const SOURCES = ['catalog_search', 'product_link', 'manual', 'web'];
// Sources that never carry a catalog product: typed by hand, or read from a store page or listing.
const CUSTOM_SOURCES = ['manual', 'web'];
const SORTS = ['recent', 'brand', 'name', 'color'];
// Match jobs still in flight keep their photo even if an item made from the same photo is deleted.
const LIVE_JOB_STATUSES = ['queued', 'processing', 'done', 'error', 'timeout'];
const MAX_NOTE = 500;

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const COLOR_RANK = new Map(COLORS.map((c, i) => [c.name, i]));

export const itemNotFound = () => new ApiError('not_found', "That item isn't in your collection. It may have been deleted.");
const photoNotFound = () => new ApiError('not_found', "That photo isn't available. Upload it again.");

/** Loads one of the actor's owned items; anyone else's id is not_found. */
export async function loadOwned(ctx, itemId) {
  const item = typeof itemId === 'string' && itemId ? await ctx.db.get('ownedItems', itemId) : null;
  if (!item || !isOwner(ctx.actor, item)) throw itemNotFound();
  return item;
}

/** Copies shown on a view: active records of the same variant; archived and custom items count as one. */
function copiesFor(item, counts) {
  if (item.archivedAt || !item.variantId) return 1;
  return counts.get(item.variantId) ?? 1;
}

/**
 * Views for some of one person's items, with copy counts taken across all of their items.
 * @param {any} ctx
 * @param {any[]} items records to render
 * @param {any[]} allItems every owned record of the same person
 */
export async function ownedViews(ctx, items, allItems) {
  const catalog = await ctx.catalog();
  const counts = copyCounts(allItems);
  const now = ctx.now();
  return items.map((item) => ownedView(catalog, item, { now, copies: copiesFor(item, counts) }));
}

async function viewOne(ctx, item) {
  const all = await ctx.db.where('ownedItems', 'userId', item.userId);
  const [view] = await ownedViews(ctx, [item], all.some((i) => i.id === item.id) ? all : [...all, item]);
  return view;
}

// The rule now lives in records.js; ops that import it from here (wishlist.js) keep working.
export { cleanLinkUrl };

/**
 * Checks that photo references belong to the actor and are the right kind: originalId an
 * original, cleanedId a cleaned copy, labelIds labels (or originals), webId a store image.
 */
export async function checkPhotoRefs(ctx, photos) {
  const originalId = photos?.originalId || null;
  const cleanedId = photos?.cleanedId || null;
  const labelIds = Array.isArray(photos?.labelIds) ? [...new Set(photos.labelIds.filter((id) => typeof id === 'string' && id))].slice(0, 6) : [];
  const webId = photos?.webId || null;
  const wanted = [
    [originalId, ['original']],
    [cleanedId, ['cleaned']],
    ...labelIds.map((id) => [id, ['label', 'original']]),
    [webId, ['web']],
  ];
  for (const [id, kinds] of wanted) {
    if (!id) continue;
    const photo = typeof id === 'string' ? await ctx.db.get('photos', id) : null;
    if (!photo || !isOwner(ctx.actor, photo) || !kinds.includes(photo.kind)) throw photoNotFound();
  }
  return { originalId, cleanedId, labelIds, webId };
}

/** Throws when the chosen display image can't be shown for this item. */
function assertDisplayAvailable(item, display, catalog, now) {
  if (!OWNED_DISPLAYS.includes(display)) {
    throw invalid({ display: 'Choose the catalog image, your photo, the cleaned-up photo or the store image' }, 'Choose which image to show.');
  }
  const hasPhoto = Boolean(item.photos?.originalId);
  if (display === 'catalog') {
    const insteadText = hasPhoto
      ? 'Keep showing your photo instead.'
      : item.photos?.webId
        ? 'Keep showing the store image instead.'
        : 'Add a photo of your item to show instead.';
    if (!item.productId) throw new ApiError('invalid', `Custom items have no catalog image. ${insteadText}`, { fields: { display: 'No catalog image' } });
    if (!item.variantId) {
      throw new ApiError('invalid', `Confirm the exact version first; until then there is no catalog image. ${insteadText}`, { fields: { display: 'Version not confirmed' } });
    }
    const { image, reason } = catalogImageFor(catalog, item.variantId, { context: 'inventory', now });
    if (!image) throw new ApiError('invalid', `${reason} ${insteadText}`, { fields: { display: reason } });
  }
  if (display === 'original' && !hasPhoto) {
    throw new ApiError('invalid', 'This item has no photo yet. Add a photo of your item first.', { fields: { display: 'No photo' } });
  }
  if (display === 'cleaned' && !item.photos?.cleanedId) {
    throw new ApiError('invalid', 'There is no cleaned-up photo yet. Clean up your photo first.', { fields: { display: 'No cleaned-up photo' } });
  }
  if (display === 'web' && !item.photos?.webId) {
    throw new ApiError('invalid', 'No store image was saved with this item. Show your photo or the catalog image instead.', { fields: { display: 'No store image' } });
  }
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** Photo ids the actor's other records still use: other items, wishlist items, unfinished match jobs. */
async function photosInUse(ctx, exceptItemId) {
  const userId = ctx.actor.id;
  const [owned, wishes, jobs] = await Promise.all([
    ctx.db.where('ownedItems', 'userId', userId),
    ctx.db.where('wishlistItems', 'userId', userId),
    ctx.db.where('matchJobs', 'userId', userId),
  ]);
  const inUse = new Set();
  const add = (...ids) => ids.forEach((id) => id && inUse.add(id));
  for (const other of owned) if (other.id !== exceptItemId) add(other.photos?.originalId, other.photos?.cleanedId, ...(other.photos?.labelIds ?? []), other.photos?.webId);
  for (const wish of wishes) add(wish.photos?.originalId, wish.photos?.webId);
  for (const job of jobs) if (LIVE_JOB_STATUSES.includes(job.status)) add(job.photoId, ...(job.labelPhotoIds ?? []));
  return inUse;
}

async function duplicateError(ctx, duplicates, all) {
  return new ApiError('duplicate', 'You already have this in your collection.', { duplicates: await ownedViews(ctx, duplicates, all) });
}

// ---------- Listing, search, facets ----------

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const slug = (text) => normalizeText(text).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** What filtering, facets and sorting look at for one item. Notes are searchable by their owner only. */
function itemFacts(catalog, item) {
  const product = item.productId ? catalog.product(item.productId) : null;
  const variant = item.variantId ? catalog.variant(item.variantId) : null;
  const brand = product ? catalog.brand(product.brandId) : null;
  const brandName = brand?.name ?? item.custom?.brand ?? '';
  const brandId = brand?.id ?? (item.custom?.brand ? `custom:${slug(item.custom.brand)}` : null);
  // An unconfirmed version has no known colors; only the person's own custom colors count.
  const colorNames = variant
    ? [...variant.colors].sort((a, b) => b.weight - a.weight).map((c) => c.name)
    : item.custom?.colors ?? [];
  const colors = [...new Set(colorNames)];
  const ids = variant?.identifiers ?? {};
  const webIds = item.web?.identifiers ?? {};
  const type = product?.type ?? item.custom?.type ?? null;
  const haystack = normalizeText(
    [
      brandName,
      product?.name ?? item.custom?.name,
      variant?.name ?? item.custom?.variantName,
      ids.styleCode,
      ids.reference,
      ...(ids.gtins ?? []),
      // Codes a store page listed for a custom item (style code, item number, barcode).
      webIds.mpn,
      webIds.sku,
      webIds.gtin,
      type ? TYPE_LABEL[type] ?? type : null,
      item.details?.notes,
    ]
      .filter(Boolean)
      .join(' | '),
  );
  return { brandId, brandName, colors, primaryColor: colors[0] ?? null, haystack };
}

const byRecent = (a, b) => b.item.createdAt.localeCompare(a.item.createdAt) || a.item.id.localeCompare(b.item.id);
const byBrand = (a, b) =>
  collator.compare(a.facts.brandName, b.facts.brandName) ||
  collator.compare(a.view.title, b.view.title) ||
  collator.compare(a.view.subtitle ?? '', b.view.subtitle ?? '') ||
  byRecent(a, b);
const byName = (a, b) => collator.compare(a.view.title, b.view.title) || collator.compare(a.facts.brandName, b.facts.brandName) || byRecent(a, b);
const colorRank = (e) => COLOR_RANK.get(e.facts.primaryColor) ?? COLORS.length;
const byColor = (a, b) => colorRank(a) - colorRank(b) || byBrand(a, b);
const SORTERS = { recent: byRecent, brand: byBrand, name: byName, color: byColor };

export const ops = {
  /**
   * args: { category?, q?, brandId?, color?, sort?: 'recent'|'brand'|'name'|'color', includeArchived?: boolean }
   * result: { items: [OwnedView], facets: { categories: {sneaker: n, ...}, brands: [{id, name, count}],
   *           colors: [{name, label, count}] }, total, collectionTotal, archivedCount }
   * Only the actor's items. Search matches brand, name, variant, code, type and notes (own
   * notes only). Each facet counts the items that pass every other filter, so chips show what
   * choosing them would return; a selected brand or color stays listed even at zero.
   * Custom brands use ids 'custom:<slug>'. total = items returned; collectionTotal = active
   * items; archivedCount = archived items. Unknown filter values are ignored.
   */
  listOwned: {
    auth: 'user',
    async run(ctx, args) {
      const all = await ctx.db.where('ownedItems', 'userId', ctx.actor.id);
      const catalog = await ctx.catalog();
      const now = ctx.now();
      const counts = copyCounts(all);
      const includeArchived = Boolean(args.includeArchived);
      const entries = all
        .filter((item) => includeArchived || !item.archivedAt)
        .map((item) => ({ item, facts: itemFacts(catalog, item), view: ownedView(catalog, item, { now, copies: copiesFor(item, counts) }) }));

      const category = CATEGORIES.includes(args.category) ? args.category : null;
      const brandId = typeof args.brandId === 'string' && args.brandId ? args.brandId : null;
      const color = typeof args.color === 'string' && args.color ? args.color : null;
      const tokens = normalizeText(String(args.q ?? '').slice(0, 100)).split(' ').filter(Boolean).slice(0, 8);
      const passes = (e, skip) =>
        (skip === 'category' || !category || e.item.category === category) &&
        (skip === 'brand' || !brandId || e.facts.brandId === brandId) &&
        (skip === 'color' || !color || e.facts.colors.includes(color)) &&
        tokens.every((t) => e.facts.haystack.includes(t));

      const sort = SORTS.includes(args.sort) ? args.sort : 'recent';
      const items = entries.filter((e) => passes(e)).sort(SORTERS[sort]).map((e) => e.view);

      const categories = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
      for (const e of entries) if (passes(e, 'category')) categories[e.item.category] += 1;

      const brands = new Map();
      if (brandId) brands.set(brandId, { id: brandId, name: catalog.brand(brandId)?.name ?? null, count: 0 });
      for (const e of entries) {
        if (!e.facts.brandId || !passes(e, 'brand')) continue;
        const entry = brands.get(e.facts.brandId) ?? { id: e.facts.brandId, name: e.facts.brandName, count: 0 };
        entry.name ??= e.facts.brandName;
        entry.count += 1;
        brands.set(e.facts.brandId, entry);
      }

      const colors = new Map();
      if (color && COLOR_RANK.has(color)) colors.set(color, 0);
      for (const e of entries) {
        if (!passes(e, 'color')) continue;
        for (const name of e.facts.colors) colors.set(name, (colors.get(name) ?? 0) + 1);
      }

      return {
        items,
        facets: {
          categories,
          brands: [...brands.values()].filter((b) => b.name).sort((a, b) => collator.compare(a.name, b.name)),
          colors: [...colors]
            .map(([name, count]) => ({ name, label: colorLabel(name), count }))
            .sort((a, b) => b.count - a.count || (COLOR_RANK.get(a.name) ?? 99) - (COLOR_RANK.get(b.name) ?? 99)),
        },
        total: items.length,
        collectionTotal: all.filter((i) => !i.archivedAt).length,
        archivedCount: all.filter((i) => i.archivedAt).length,
      };
    },
  },

  /** args: { itemId } -> OwnedView (owner) ; others -> not_found */
  getOwned: {
    auth: 'user',
    async run(ctx, { itemId }) {
      return viewOne(ctx, await loadOwned(ctx, itemId));
    },
  },

  /**
   * Adds an item from catalog search, a product link, a store page or listing, or manual entry.
   * args: { category, productId?, variantId?, custom?, details?, ownerChanges?, photos?, display?,
   *         source?: 'catalog_search'|'product_link'|'manual'|'web', sourceUrl?, web?,
   *         allowDuplicate?, idempotencyKey }
   * - catalog_search: identity user_confirmed with 'catalog_search' evidence.
   * - product_link: identity user_confirmed with 'product_link' evidence (source 'url'); the
   *   link is stored as sourceUrl.
   * - manual: productId/variantId stay null and identity.resolution is 'manual'.
   * - web: a custom item like manual (custom required, no catalog ids, resolution 'manual') with
   *   the WebSnapshot `web` (records.cleanWebSnapshot) and one 'product_link' evidence line
   *   saying where the details came from. sourceUrl defaults to web.url. photos.webId is a store
   *   image saved with importWebImage; display defaults to 'web' when there is one. The store
   *   price stays in the snapshot: it is never a price paid.
   * The identity is always built here; a caller can't supply one. Photo ids must be the actor's.
   * Duplicate warning: ApiError('duplicate', ..., { duplicates: [OwnedView] }) unless
   * allowDuplicate, so a deliberate second copy can be saved.
   * result: OwnedView
   */
  createOwned: {
    auth: 'user',
    idempotent: true,
    async run(ctx, args) {
      const catalog = await ctx.catalog();
      const now = ctx.now();
      const source = args.source ?? (args.productId ? 'catalog_search' : 'manual');
      const custom = CUSTOM_SOURCES.includes(source);
      const errors = {};
      if (!SOURCES.includes(source)) errors.source = 'Choose catalog search, a product link or manual entry';
      if (source === 'manual' && (args.productId || args.variantId)) errors.productId = 'A custom item has no catalog product. Use catalog search to add this product.';
      if (source === 'web' && (args.productId || args.variantId)) errors.productId = 'An item saved from a store page has no catalog product. Use catalog search to add a catalog product.';
      if (!custom && !args.productId) errors.productId = 'Choose a product from the catalog';
      const web = source === 'web' ? cleanWebSnapshot(args.web, now) : null;
      if (source === 'web' && !web) errors.web = 'The store details are missing. Look the product up again.';
      let sourceUrl = null;
      if (args.sourceUrl != null && args.sourceUrl !== '') {
        sourceUrl = cleanLinkUrl(args.sourceUrl);
        if (!sourceUrl) errors.sourceUrl = 'Enter a link that starts with https://';
      } else if (source === 'product_link') {
        errors.sourceUrl = 'Add the product link';
      } else if (web) {
        sourceUrl = web.url;
      }
      if (Object.keys(errors).length) throw invalid(errors);

      const photos = await checkPhotoRefs(ctx, args.photos);
      let identity;
      if (source === 'manual') identity = makeIdentity();
      else if (source === 'web') identity = webIdentity(web);
      else {
        identity = catalogIdentity({
          userId: ctx.actor.id,
          now,
          variantId: args.variantId || null,
          source,
          detail: source === 'product_link' ? `Added from a link on ${new URL(sourceUrl).hostname}` : undefined,
        });
      }
      const record = buildOwnedItem(
        {
          category: args.category,
          productId: custom ? null : args.productId,
          variantId: custom ? null : args.variantId || null,
          custom: custom ? args.custom : null,
          details: args.details,
          ownerChanges: args.ownerChanges,
          photos,
          // Saved from a store page or listing: the store's image shows until the person adds a photo.
          display: args.display ?? (web && photos.webId ? 'web' : undefined),
          identity,
          web,
        },
        { userId: ctx.actor.id, now, catalog },
      );
      record.sourceUrl = sourceUrl;
      if (['original', 'cleaned', 'web'].includes(args.display)) assertDisplayAvailable(record, args.display, catalog, now);

      const all = await ctx.db.where('ownedItems', 'userId', ctx.actor.id);
      if (!args.allowDuplicate) {
        const duplicates = findDuplicates(all, record);
        if (duplicates.length) throw await duplicateError(ctx, duplicates, all);
      }
      await ctx.db.put('ownedItems', record);
      await ctx.audit('owned.created', 'ownedItem', record.id, { source, category: record.category });
      await ctx.metric('owned_created', { source, category: record.category });
      const [view] = await ownedViews(ctx, [record], [...all, record]);
      return view;
    },
  },

  /**
   * args: { itemId, patch: { details?, ownerChanges?, custom?, display?, photos?: { originalId?, labelIds?, webId? } } }
   * -> OwnedView. details merge into the existing details. Identity changes go through
   * correctMatch.
   * photos attaches, replaces or (with originalId null) removes the person's own photo of the
   * item; webId does the same for a store image saved with importWebImage. A replaced or removed
   * photo is deleted with its cleaned-up copy unless another record still uses it, and a display
   * choice that no longer has an image falls back.
   */
  updateOwned: {
    auth: 'user',
    async run(ctx, { itemId, patch }) {
      const item = await loadOwned(ctx, itemId);
      if (!patch || typeof patch !== 'object') throw invalid({}, 'Choose what to change.');
      const allowed = {};
      for (const key of ['details', 'ownerChanges', 'custom', 'display']) if (patch[key] !== undefined) allowed[key] = patch[key];
      const photosPatch = isPlainObject(patch.photos) ? patch.photos : null;
      if (!Object.keys(allowed).length && !photosPatch) throw invalid({}, 'Choose what to change.');
      const now = ctx.now();
      let next = patchOwnedItem(item, allowed, { now });
      let released = [];
      if (photosPatch) {
        const originalId = photosPatch.originalId !== undefined ? photosPatch.originalId || null : item.photos.originalId;
        const labelIds = photosPatch.labelIds !== undefined ? photosPatch.labelIds : item.photos.labelIds;
        const webId = photosPatch.webId !== undefined ? photosPatch.webId || null : item.photos.webId ?? null;
        const refs = await checkPhotoRefs(ctx, { originalId, labelIds, webId });
        // A cleaned-up copy belongs to the photo it was made from.
        const cleanedId = refs.originalId === item.photos.originalId ? item.photos.cleanedId : null;
        next.photos = { originalId: refs.originalId, cleanedId, labelIds: refs.labelIds, webId: refs.webId };
        const kept = [next.photos.originalId, next.photos.cleanedId, ...next.photos.labelIds, next.photos.webId];
        released = [item.photos.originalId, item.photos.cleanedId, ...(item.photos.labelIds ?? []), item.photos.webId].filter((id) => id && !kept.includes(id));
        // Without the image it showed, the item shows the next one it has.
        const fallback = refs.webId ? 'web' : 'catalog';
        if (next.display === 'cleaned' && !cleanedId) next.display = refs.originalId ? 'original' : fallback;
        if (next.display === 'original' && !refs.originalId) next.display = fallback;
        if (next.display === 'web' && !refs.webId) next.display = refs.originalId ? 'original' : 'catalog';
      }
      if (allowed.display) assertDisplayAvailable(next, allowed.display, await ctx.catalog(), now);
      await ctx.db.put('ownedItems', next);
      if (released.length) {
        const inUse = await photosInUse(ctx, item.id);
        await deletePhotos(ctx, ctx.actor.id, released.filter((id) => !inUse.has(id)));
      }
      await ctx.audit('owned.updated', 'ownedItem', item.id, { fields: [...Object.keys(allowed), ...(photosPatch ? ['photos'] : [])] });
      return viewOne(ctx, next);
    },
  },

  /** args: { itemId } -> OwnedView (archivedAt set) */
  archiveOwned: {
    auth: 'user',
    async run(ctx, { itemId }) {
      const item = await loadOwned(ctx, itemId);
      if (item.archivedAt) return viewOne(ctx, item);
      const next = { ...item, archivedAt: ctx.iso(), updatedAt: ctx.iso() };
      await ctx.db.put('ownedItems', next);
      await ctx.audit('owned.archived', 'ownedItem', item.id, {});
      return viewOne(ctx, next);
    },
  },

  /** args: { itemId } -> OwnedView (archivedAt cleared) */
  restoreOwned: {
    auth: 'user',
    async run(ctx, { itemId }) {
      const item = await loadOwned(ctx, itemId);
      if (!item.archivedAt) return viewOne(ctx, item);
      const next = { ...item, archivedAt: null, updatedAt: ctx.iso() };
      await ctx.db.put('ownedItems', next);
      await ctx.audit('owned.restored', 'ownedItem', item.id, {});
      return viewOne(ctx, next);
    },
  },

  /**
   * Deletes the item and its private photos (original, processing, cleaned, label, store image) and removes
   * it from the person's stylist shares, snapshots and wishlist links. A photo another of the
   * person's records or an unfinished match job still uses is kept.
   * args: { itemId } -> { ok: true }
   */
  deleteOwned: {
    auth: 'user',
    async run(ctx, { itemId }) {
      const item = await loadOwned(ctx, itemId);
      const userId = ctx.actor.id;
      const inUse = await photosInUse(ctx, item.id);
      const mine = [item.photos?.originalId, item.photos?.cleanedId, ...(item.photos?.labelIds ?? []), item.photos?.webId].filter(Boolean);
      const deletedPhotos = await deletePhotos(ctx, userId, mine.filter((id) => !inUse.has(id)));

      await ctx.db.delete('ownedItems', item.id);
      for (const wish of await ctx.db.where('wishlistItems', 'userId', userId)) {
        if (!wish.linkedOwnedIds?.includes(item.id)) continue;
        await ctx.db.put('wishlistItems', { ...wish, linkedOwnedIds: wish.linkedOwnedIds.filter((id) => id !== item.id), updatedAt: ctx.iso() });
      }
      for (const request of await ctx.db.where('stylistRequests', 'userId', userId)) {
        if (!request.share?.itemIds?.includes(item.id)) continue;
        await ctx.db.put('stylistRequests', {
          ...request,
          share: { ...request.share, itemIds: request.share.itemIds.filter((id) => id !== item.id) },
          snapshot: Array.isArray(request.snapshot) ? request.snapshot.filter((s) => s.id !== item.id) : request.snapshot,
          updatedAt: ctx.iso(),
        });
      }
      await ctx.audit('owned.deleted', 'ownedItem', item.id, { photosDeleted: deletedPhotos.length });
      return { ok: true };
    },
  },

  /**
   * args: { itemId, display: 'catalog'|'original'|'cleaned'|'web' } -> OwnedView.
   * The choice must be available: 'catalog' needs a catalog image whose source terms allow
   * collection display, 'cleaned' needs a cleaned-up photo, 'web' a store image saved with the
   * item. The original photo is never deleted.
   */
  setDisplayImage: {
    auth: 'user',
    async run(ctx, { itemId, display }) {
      const item = await loadOwned(ctx, itemId);
      const now = ctx.now();
      assertDisplayAvailable(item, display, await ctx.catalog(), now);
      if (item.display === display) return viewOne(ctx, item);
      const next = { ...item, display, updatedAt: iso(now) };
      await ctx.db.put('ownedItems', next);
      await ctx.audit('owned.display_changed', 'ownedItem', item.id, { display });
      return viewOne(ctx, next);
    },
  },

  /**
   * The person corrects which product/variant their item is. Updates only their record and logs
   * the evidence (kind 'user_selection'); global catalog facts are untouched.
   * - Catalog product: resolution 'user_confirmed', variant 'confirmed' (or 'incomplete' without
   *   variantId). Evidence for the old identity no longer applies and is replaced.
   * - productId null with custom { brand, name, ... }: a custom item, resolution 'manual'.
   * The product must be in the item's category. Choosing the current identity changes nothing.
   * args: { itemId, productId|null, variantId|null, custom? } -> OwnedView
   */
  correctMatch: {
    auth: 'user',
    async run(ctx, args) {
      const item = await loadOwned(ctx, args.itemId);
      const catalog = await ctx.catalog();
      const now = ctx.now();
      const productId = args.productId || null;
      const variantId = productId ? args.variantId || null : null;
      if (productId && productId === item.productId && variantId === item.variantId) return viewOne(ctx, item);

      const previous = { productId: item.productId, variantId: item.variantId, resolution: item.identity?.resolution ?? null };
      let next;
      if (productId) {
        const product = catalog.product(productId);
        if (!product) throw invalid({ productId: 'That product is not in the catalog' });
        if (product.category !== item.category) throw invalid({ productId: 'Choose a product in the same category, or add it as a new item' });
        if (variantId && catalog.variant(variantId)?.productId !== productId) throw invalid({ variantId: 'That version does not belong to this product' });
        const title = variantId ? variantTitle(catalog, variantId) : `${catalog.brand(product.brandId)?.name ?? ''} ${product.name}`.trim();
        next = {
          ...item,
          productId,
          variantId,
          custom: null,
          identity: makeIdentity({
            retrieval: item.identity?.retrieval ?? 'not_run',
            resolution: 'user_confirmed',
            variant: variantId ? 'confirmed' : 'incomplete',
            evidence: [{ kind: 'user_selection', source: 'catalog', detail: `You corrected the match to ${title}` }],
            conflicts: [],
            confirmedBy: ctx.actor.id,
            confirmedAt: iso(now),
            matchJobId: item.identity?.matchJobId ?? null,
          }),
          // Leaving a custom record: show the catalog image the person now has.
          display: item.productId ? item.display : 'catalog',
        };
      } else {
        // Validate the custom fields with the same rules as a new manual item.
        const probe = buildOwnedItem({ category: item.category, custom: args.custom, details: item.details }, { userId: ctx.actor.id, now, catalog });
        next = {
          ...item,
          productId: null,
          variantId: null,
          custom: probe.custom,
          identity: makeIdentity({
            retrieval: item.identity?.retrieval ?? 'not_run',
            resolution: 'manual',
            variant: 'not_applicable',
            evidence: [{ kind: 'user_selection', source: 'user_entered', detail: 'You saved this as a custom item without a catalog match' }],
            confirmedBy: ctx.actor.id,
            confirmedAt: iso(now),
            matchJobId: item.identity?.matchJobId ?? null,
          }),
          display: item.display === 'catalog' ? 'original' : item.display,
        };
      }
      next.updatedAt = iso(now);
      await ctx.db.put('ownedItems', next);
      await ctx.audit('owned.match_corrected', 'ownedItem', item.id, {
        from: previous,
        to: { productId: next.productId, variantId: next.variantId, resolution: next.identity.resolution },
      });
      return viewOne(ctx, next);
    },
  },

  /**
   * Proposes a fix to a shared catalog fact. Creates a `correction` for admin review; never
   * edits the catalog directly. Fields come from an allowlist (admin.js correctionField):
   * 'product.name', 'product.description', 'product.attributes.<key>', 'variant.name',
   * 'variant.identifiers.styleCode', 'variant.identifiers.reference', 'variant.msrpMinor',
   * 'variant.attributes.<key>', or 'other' (note only).
   * args: { productId, variantId?, field, proposedValue, note } -> correction
   */
  reportCatalogIssue: {
    auth: 'user',
    async run(ctx, args) {
      const catalog = await ctx.catalog();
      const target = correctionField(catalog, { productId: args.productId, variantId: args.variantId || null, field: args.field });
      if (target.problems) throw invalid(target.problems);
      const note = String(args.note ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, MAX_NOTE);
      let proposedValue = null;
      if (target.spec.type === 'none') {
        if (!note) throw invalid({ note: 'Describe what is wrong' });
      } else {
        const coerced = coerceCorrectionValue(target.spec, args.proposedValue);
        if (coerced.problem) throw invalid({ proposedValue: coerced.problem });
        proposedValue = coerced.value;
        if (JSON.stringify(proposedValue) === JSON.stringify(target.spec.get(target.record) ?? null)) {
          throw invalid({ proposedValue: 'This is already the catalog value' });
        }
      }
      const correction = {
        id: newId('cor'),
        userId: ctx.actor.id,
        productId: target.product.id,
        variantId: target.variant?.id ?? null,
        field: target.spec.field,
        currentValue: target.spec.type === 'none' ? null : target.spec.get(target.record) ?? null,
        proposedValue,
        note,
        status: 'open',
        createdAt: ctx.iso(),
        reviewedBy: null,
        reviewedAt: null,
      };
      await ctx.db.put('corrections', correction);
      await ctx.audit('correction.created', 'correction', correction.id, { productId: correction.productId, field: correction.field });
      await ctx.metric('correction_reported', { field: target.spec.field.startsWith('other') ? 'other' : target.spec.level });
      return correction;
    },
  },

  /** args: { category?, productId?, variantId?, custom? } -> { duplicates: [OwnedView] } */
  checkDuplicates: {
    auth: 'user',
    async run(ctx, args) {
      const catalog = await ctx.catalog();
      const product = args.productId ? catalog.product(args.productId) : null;
      const all = await ctx.db.where('ownedItems', 'userId', ctx.actor.id);
      const candidate = {
        category: product?.category ?? args.category ?? null,
        productId: product?.id ?? null,
        variantId: product && args.variantId ? args.variantId : null,
        custom: product ? null : args.custom ?? null,
      };
      if (!candidate.productId && !candidate.custom) return { duplicates: [] };
      return { duplicates: await ownedViews(ctx, findDuplicates(all, candidate), all) };
    },
  },
};
