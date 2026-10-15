// Wishlist: what the person wants and why they saved it. A wishlist item becomes owned only when
// the person marks it bought (markPurchased); following a retailer link never does.
import { ApiError, invalid } from '../errors.js';
import { isOwner } from '../policy.js';
import { buildOwnedItem, buildWishlistItem, catalogIdentity, iso, makeIdentity } from '../records.js';
import { copyCounts, wishlistView } from '../views.js';
import { findDuplicates } from '../../engine/duplicates.js';
import { WISH_INTENT_FOR_REASON } from '../../data/schema.js';
import { variantTitle } from '../../data/catalog-index.js';
import { checkPhotoRefs, cleanLinkUrl, loadOwned, ownedViews } from './inventory.js';

const STATUS_FILTERS = ['active', 'purchased', 'removed', 'all'];
const PATCH_FIELDS = ['reason', 'intent', 'desired', 'targetPriceMinor', 'linkedOwnedIds', 'reasonNote'];

const wishNotFound = () => new ApiError('not_found', "That item isn't on your wishlist. It may have been removed.");

async function loadWish(ctx, itemId) {
  const wish = typeof itemId === 'string' && itemId ? await ctx.db.get('wishlistItems', itemId) : null;
  if (!wish || !isOwner(ctx.actor, wish)) throw wishNotFound();
  return wish;
}

/** Linked items must be the actor's own; anyone else's id is not_found. */
async function checkLinked(ctx, ids) {
  if (ids == null) return [];
  if (!Array.isArray(ids)) throw invalid({ linkedOwnedIds: 'Choose items from your collection' });
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
  if (unique.length > 10) throw invalid({ linkedOwnedIds: 'Link up to 10 items' });
  for (const id of unique) await loadOwned(ctx, id);
  return unique;
}

/**
 * Wishlist views with what screens show next to them: the linked owned items, how many copies
 * of the same version the person already owns, and the owned record a purchase created.
 */
export async function wishViews(ctx, wishes) {
  const catalog = await ctx.catalog();
  const now = ctx.now();
  const owned = await ctx.db.where('ownedItems', 'userId', ctx.actor.id);
  const byId = new Map(owned.map((o) => [o.id, o]));
  const counts = copyCounts(owned);
  const linkedIds = [...new Set(wishes.flatMap((w) => w.linkedOwnedIds ?? []))].filter((id) => byId.has(id));
  const linkedViews = new Map((await ownedViews(ctx, linkedIds.map((id) => byId.get(id)), owned)).map((v) => [v.id, v]));
  return wishes.map((wish) => ({
    ...wishlistView(catalog, wish, { now }),
    linkedOwned: (wish.linkedOwnedIds ?? [])
      .filter((id) => linkedViews.has(id))
      .map((id) => {
        const v = linkedViews.get(id);
        return { id: v.id, category: v.category, brandName: v.brandName, title: v.title, subtitle: v.subtitle, image: v.image };
      }),
    ownedCopies: wish.variantId ? counts.get(wish.variantId) ?? 0 : 0,
    purchasedOwned: wish.purchasedOwnedId && byId.has(wish.purchasedOwnedId) ? { id: wish.purchasedOwnedId } : null,
  }));
}

async function wishView(ctx, wish) {
  return (await wishViews(ctx, [wish]))[0];
}

export const ops = {
  /**
   * args: { status?: 'active'|'purchased'|'removed'|'all' } -> { items: [WishlistView], counts: { active, purchased } }
   * Actor's only, newest first. 'all' means active and purchased; removed items only appear
   * when asked for by name.
   */
  listWishlist: {
    auth: 'user',
    async run(ctx, args) {
      const status = STATUS_FILTERS.includes(args.status) ? args.status : 'active';
      const all = await ctx.db.where('wishlistItems', 'userId', ctx.actor.id);
      const wanted = all
        .filter((w) => (status === 'all' ? w.status !== 'removed' : w.status === status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      return {
        items: await wishViews(ctx, wanted),
        counts: { active: all.filter((w) => w.status === 'active').length, purchased: all.filter((w) => w.status === 'purchased').length },
      };
    },
  },

  /** args: { itemId } -> WishlistView (owner; removed items keep status 'removed') ; others -> not_found */
  getWishlistItem: {
    auth: 'user',
    async run(ctx, { itemId }) {
      return wishView(ctx, await loadWish(ctx, itemId));
    },
  },

  /**
   * args: { category, productId?, variantId?, custom?, matchPending?, reason, reasonNote?, intent?,
   *         linkedOwnedIds?, desired: { size?, condition, variantFlexible }, targetPriceMinor?,
   *         sourceUrl?, source?: 'catalog_search'|'product_link', photos?, allowDuplicate?, idempotencyKey }
   * - The identity is built here: catalog items are user_confirmed with catalog_search evidence,
   *   or product_link evidence when saved from a link (sourceUrl); custom items are manual; an
   *   item still being matched is unconfirmed.
   * - linkedOwnedIds and photos must be the actor's own (others -> not_found).
   * - Duplicate active entries of the same variant -> ApiError('duplicate', ..., { duplicates })
   *   unless allowDuplicate.
   * result: WishlistView
   */
  createWishlist: {
    auth: 'user',
    idempotent: true,
    async run(ctx, args) {
      const catalog = await ctx.catalog();
      const now = ctx.now();
      let sourceUrl = null;
      if (args.sourceUrl != null && args.sourceUrl !== '') {
        sourceUrl = cleanLinkUrl(args.sourceUrl);
        if (!sourceUrl) throw invalid({ sourceUrl: 'Enter a link that starts with https://' });
      }
      const photos = await checkPhotoRefs(ctx, { originalId: args.photos?.originalId });
      const linkedOwnedIds = await checkLinked(ctx, args.linkedOwnedIds);
      const fromLink = args.productId && (args.source === 'product_link' || (args.source == null && sourceUrl));
      let identity;
      if (args.productId) {
        identity = catalogIdentity({
          userId: ctx.actor.id,
          now,
          variantId: args.variantId || null,
          source: fromLink ? 'product_link' : 'catalog_search',
          detail: fromLink && sourceUrl ? `Saved from a link on ${new URL(sourceUrl).hostname}` : undefined,
        });
      } else if (args.custom) {
        identity = makeIdentity();
      } else {
        // Saved before matching finished: nothing is known or confirmed yet.
        identity = makeIdentity({ resolution: 'unconfirmed', variant: 'incomplete' });
      }
      const record = buildWishlistItem(
        {
          category: args.category,
          productId: args.productId || null,
          variantId: args.productId ? args.variantId || null : null,
          custom: args.productId ? null : args.custom ?? null,
          matchPending: Boolean(args.matchPending) && !args.productId && !args.custom,
          reason: args.reason,
          reasonNote: args.reasonNote,
          intent: args.intent,
          linkedOwnedIds,
          desired: args.desired,
          targetPriceMinor: args.targetPriceMinor,
          sourceUrl,
          photos: { originalId: photos.originalId },
          identity,
        },
        { userId: ctx.actor.id, now, catalog },
      );

      if (!args.allowDuplicate) {
        const mine = await ctx.db.where('wishlistItems', 'userId', ctx.actor.id);
        const duplicates = findDuplicates(mine, record);
        if (duplicates.length) throw new ApiError('duplicate', 'This is already on your wishlist.', { duplicates: await wishViews(ctx, duplicates) });
      }
      await ctx.db.put('wishlistItems', record);
      await ctx.audit('wishlist.created', 'wishlistItem', record.id, { reason: record.reason, category: record.category });
      await ctx.metric('wishlist_created', { reason: record.reason, intent: record.intent, category: record.category });
      return wishView(ctx, record);
    },
  },

  /**
   * args: { itemId, patch: { reason?, intent?, desired?, targetPriceMinor?, linkedOwnedIds?, reasonNote? } }
   * -> WishlistView. Changing the reason resets the intent to that reason's default unless an
   * intent is given; desired merges into the current preferences. Active items only.
   */
  updateWishlist: {
    auth: 'user',
    async run(ctx, { itemId, patch }) {
      const wish = await loadWish(ctx, itemId);
      if (wish.status !== 'active') throw new ApiError('conflict', 'This item is no longer on your wishlist, so it cannot be changed.');
      if (!patch || typeof patch !== 'object' || !PATCH_FIELDS.some((k) => patch[k] !== undefined)) throw invalid({}, 'Choose what to change.');
      const catalog = await ctx.catalog();
      const now = ctx.now();
      const reason = patch.reason ?? wish.reason;
      const reasonChanged = patch.reason !== undefined && patch.reason !== wish.reason;
      const intent = patch.intent ?? (reasonChanged ? WISH_INTENT_FOR_REASON[reason] ?? wish.intent : wish.intent);
      const desired = { ...wish.desired, ...(patch.desired ?? {}) };
      if ((patch.intent !== undefined || reasonChanged) && patch.desired?.variantFlexible === undefined) desired.variantFlexible = intent !== 'exact';
      const linkedOwnedIds = patch.linkedOwnedIds !== undefined ? await checkLinked(ctx, patch.linkedOwnedIds) : wish.linkedOwnedIds;
      // Rebuilding runs the same validation as a new item; the identity is carried over untouched.
      const rebuilt = buildWishlistItem(
        {
          ...wish,
          reason,
          intent,
          desired,
          linkedOwnedIds,
          targetPriceMinor: patch.targetPriceMinor !== undefined ? patch.targetPriceMinor : wish.targetPriceMinor,
          reasonNote: patch.reasonNote !== undefined ? patch.reasonNote : wish.reasonNote,
        },
        { userId: ctx.actor.id, now, catalog },
      );
      const next = {
        ...wish,
        reason: rebuilt.reason,
        intent: rebuilt.intent,
        desired: rebuilt.desired,
        linkedOwnedIds: rebuilt.linkedOwnedIds,
        targetPriceMinor: rebuilt.targetPriceMinor,
        reasonNote: rebuilt.reasonNote,
        updatedAt: iso(now),
      };
      await ctx.db.put('wishlistItems', next);
      await ctx.audit('wishlist.updated', 'wishlistItem', wish.id, { fields: PATCH_FIELDS.filter((k) => patch[k] !== undefined) });
      return wishView(ctx, next);
    },
  },

  /** args: { itemId } -> { ok: true } (status 'removed') */
  removeWishlist: {
    auth: 'user',
    async run(ctx, { itemId }) {
      const wish = await loadWish(ctx, itemId);
      if (wish.status !== 'removed') {
        await ctx.db.put('wishlistItems', { ...wish, status: 'removed', updatedAt: ctx.iso() });
        await ctx.audit('wishlist.removed', 'wishlistItem', wish.id, {});
      }
      return { ok: true };
    },
  },

  /**
   * The only way a wishlist item becomes owned. An affiliate click never does this.
   * args: { itemId, details: { size?, condition?, purchase? }, variantId?, allowDuplicate?, idempotencyKey }
   * Creates an owned item with the same catalog identity (or, when the person bought a
   * different version of the same product, variantId with a user_selection evidence entry),
   * sets wishlist status 'purchased' and purchasedOwnedId. Sizes come only from details; the
   * wished-for size is not assumed. Duplicate check as in createOwned.
   * result: { owned: OwnedView, wish: WishlistView }
   */
  markPurchased: {
    auth: 'user',
    idempotent: true,
    async run(ctx, args) {
      const wish = await loadWish(ctx, args.itemId);
      if (wish.status === 'purchased') throw new ApiError('conflict', 'You already marked this as bought. It is in your collection.', { ownedId: wish.purchasedOwnedId });
      if (wish.status === 'removed') throw new ApiError('conflict', 'This item was removed from your wishlist. Add it again to mark it as bought.');
      if (!wish.productId && !wish.custom) throw new ApiError('invalid', 'Finish matching this item before marking it as bought.');
      const catalog = await ctx.catalog();
      const now = ctx.now();

      let variantId = wish.variantId;
      let identity = structuredClone(wish.identity);
      if (args.variantId && args.variantId !== wish.variantId) {
        const variant = wish.productId ? catalog.variant(args.variantId) : null;
        if (!variant || variant.productId !== wish.productId) throw invalid({ variantId: 'That version does not belong to this product' });
        variantId = variant.id;
        identity = makeIdentity({
          retrieval: wish.identity?.retrieval ?? 'not_run',
          resolution: 'user_confirmed',
          variant: 'confirmed',
          evidence: [{ kind: 'user_selection', source: 'catalog', detail: `You chose ${variantTitle(catalog, variant.id)} when you marked it as bought` }],
          confirmedBy: ctx.actor.id,
          confirmedAt: iso(now),
          matchJobId: wish.identity?.matchJobId ?? null,
        });
      }
      const owned = buildOwnedItem(
        {
          category: wish.category,
          productId: wish.productId,
          variantId,
          custom: wish.custom,
          details: args.details,
          identity,
          display: wish.productId ? 'catalog' : 'original',
        },
        { userId: ctx.actor.id, now, catalog },
      );
      owned.sourceUrl = wish.sourceUrl ?? null;
      owned.fromWishlistId = wish.id;

      const all = await ctx.db.where('ownedItems', 'userId', ctx.actor.id);
      if (!args.allowDuplicate) {
        const duplicates = findDuplicates(all, owned);
        if (duplicates.length) throw new ApiError('duplicate', 'You already have this in your collection.', { duplicates: await ownedViews(ctx, duplicates, all) });
      }
      await ctx.db.put('ownedItems', owned);
      const purchased = { ...wish, status: 'purchased', purchasedOwnedId: owned.id, updatedAt: iso(now) };
      await ctx.db.put('wishlistItems', purchased);
      await ctx.audit('owned.created', 'ownedItem', owned.id, { source: 'wishlist', category: owned.category });
      await ctx.audit('wishlist.purchased', 'wishlistItem', wish.id, { ownedId: owned.id });
      await ctx.metric('wishlist_purchased', { category: owned.category, reason: wish.reason });
      const [ownedView] = await ownedViews(ctx, [owned], [...all, owned]);
      return { owned: ownedView, wish: await wishView(ctx, purchased) };
    },
  },
};
