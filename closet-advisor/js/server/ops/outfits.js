// Outfits: named sets of the person's own items. Every read and write is scoped to the
// signed-in person, and another person's outfit ids behave exactly like ids that don't exist.
// Outfits hold item ids only; deleting an outfit never touches the items in it. Suggestions
// read the saved outfits only to leave out combinations the person already saved.
import { ApiError, invalid } from '../errors.js';
import { newId } from '../../lib/ids.js';
import { isOwner } from '../policy.js';
import { OUTFIT_FIELDS, checkOutfitFields, outfitNameKey } from '../records.js';
import { OUTFIT_LIMITS } from '../../data/schema.js';
import { ownedViews } from './inventory.js';
import { suggestOutfits as buildSuggestions } from '../../engine/outfit-suggest.js';

/** `base`, else `base 2`, `base 3`... (cut to fit): the first whose name key isn't in `taken`, which it joins. */
function freeName(base, taken) {
  let name = base;
  for (let n = 2; taken.has(outfitNameKey(name)); n += 1) name = `${base.slice(0, OUTFIT_LIMITS.nameMax - String(n).length - 1).trimEnd()} ${n}`;
  taken.add(outfitNameKey(name));
  return name;
}

const outfitNotFound = () => new ApiError('not_found', "That outfit isn't in your collection. It may have been deleted.");

async function loadOutfit(ctx, outfitId) {
  const outfit = typeof outfitId === 'string' && outfitId ? await ctx.db.get('outfits', outfitId) : null;
  if (!outfit || !isOwner(ctx.actor, outfit)) throw outfitNotFound();
  return outfit;
}

const byRecent = (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

/**
 * Outfit views with each item as a full OwnedView (owner-only, like the outfit). Ids of items
 * deleted since are left out; `incomplete` says the outfit has fewer than two items left.
 */
async function outfitViews(ctx, outfits) {
  const owned = await ctx.db.where('ownedItems', 'userId', ctx.actor.id);
  const byId = new Map(owned.map((o) => [o.id, o]));
  const ids = [...new Set(outfits.flatMap((o) => o.itemIds))].filter((id) => byId.has(id));
  const views = new Map((await ownedViews(ctx, ids.map((id) => byId.get(id)), owned)).map((v) => [v.id, v]));
  return outfits.map((outfit) => {
    const items = outfit.itemIds.filter((id) => views.has(id)).map((id) => views.get(id));
    return {
      id: outfit.id,
      name: outfit.name,
      notes: outfit.notes,
      createdAt: outfit.createdAt,
      updatedAt: outfit.updatedAt,
      itemIds: items.map((i) => i.id),
      items,
      itemCount: items.length,
      incomplete: items.length < OUTFIT_LIMITS.minItems,
    };
  });
}

/**
 * Adds the checks that need the database to `errors`: every item must be one of the actor's
 * (a missing id and someone else's id get the same answer), and the name must not belong to
 * another of the actor's outfits. Returns the ids that aren't the actor's items.
 */
async function checkAgainstStore(ctx, fields, errors, exceptId = null) {
  let missing = [];
  if (fields.itemIds && !errors.itemIds) {
    const owned = new Set((await ctx.db.where('ownedItems', 'userId', ctx.actor.id)).map((o) => o.id));
    missing = fields.itemIds.filter((id) => !owned.has(id));
    if (missing.length) errors.itemIds = 'Choose again: some of these items are no longer in your collection';
  }
  if (fields.name && !errors.name) {
    const key = outfitNameKey(fields.name);
    const clash = (await ctx.db.where('outfits', 'userId', ctx.actor.id)).some((o) => o.id !== exceptId && outfitNameKey(o.name) === key);
    if (clash) errors.name = 'You already have an outfit with this name';
  }
  return missing;
}

function invalidOutfit(errors, missing) {
  const error = invalid(errors);
  // Lets the form take deleted items off its list; these are only ids the caller sent.
  if (missing.length) error.details.missingItemIds = missing;
  return error;
}

export const ops = {
  /**
   * args: { itemId? } -> { outfits: [OutfitView], total }
   * The actor's outfits, most recently changed first. itemId keeps the outfits that hold that
   * item. total counts all of the actor's outfits.
   */
  listOutfits: {
    auth: 'user',
    async run(ctx, args) {
      const all = await ctx.db.where('outfits', 'userId', ctx.actor.id);
      const itemId = typeof args.itemId === 'string' && args.itemId ? args.itemId : null;
      const wanted = (itemId ? all.filter((o) => o.itemIds.includes(itemId)) : all).sort(byRecent);
      return { outfits: await outfitViews(ctx, wanted), total: all.length };
    },
  },

  /** args: { outfitId } -> OutfitView (owner) ; others -> not_found */
  getOutfit: {
    auth: 'user',
    async run(ctx, { outfitId }) {
      const [view] = await outfitViews(ctx, [await loadOutfit(ctx, outfitId)]);
      return view;
    },
  },

  /**
   * args: { name, itemIds: [ownedItem id], notes?, idempotencyKey } -> OutfitView
   * name: 1-60 characters, unique among the actor's outfits ignoring case and spacing.
   * itemIds: 2-12 of the actor's own items (archived ones included). Errors are
   * ApiError('invalid') with fields name/itemIds/notes; details.missingItemIds lists ids that
   * aren't the actor's items.
   */
  createOutfit: {
    auth: 'user',
    idempotent: true,
    async run(ctx, args) {
      const { fields, errors } = checkOutfitFields(args);
      const missing = await checkAgainstStore(ctx, fields, errors);
      if (Object.keys(errors).length) throw invalidOutfit(errors, missing);
      const outfit = { id: newId('fit'), userId: ctx.actor.id, createdAt: ctx.iso(), updatedAt: ctx.iso(), ...fields };
      await ctx.db.put('outfits', outfit);
      await ctx.audit('outfit.created', 'outfit', outfit.id, { items: outfit.itemIds.length });
      await ctx.metric('outfit_created', { items: outfit.itemIds.length });
      const [view] = await outfitViews(ctx, [outfit]);
      return view;
    },
  },

  /**
   * args: { outfitId, patch: { name?, itemIds?, notes? } } -> OutfitView
   * Only the given fields are checked and changed, with the same rules as createOutfit; keeping
   * the outfit's own name (or changing its capitals) is allowed. Saving without a change
   * leaves the record as it was.
   */
  updateOutfit: {
    auth: 'user',
    async run(ctx, { outfitId, patch }) {
      const outfit = await loadOutfit(ctx, outfitId);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !OUTFIT_FIELDS.some((k) => patch[k] !== undefined)) {
        throw invalid({}, 'Choose what to change.');
      }
      const { fields, errors } = checkOutfitFields(patch, { partial: true });
      const missing = await checkAgainstStore(ctx, fields, errors, outfit.id);
      if (Object.keys(errors).length) throw invalidOutfit(errors, missing);
      const changed = OUTFIT_FIELDS.filter((k) => k in fields && JSON.stringify(fields[k]) !== JSON.stringify(outfit[k]));
      let next = outfit;
      if (changed.length) {
        next = { ...outfit, ...fields, updatedAt: ctx.iso() };
        await ctx.db.put('outfits', next);
        await ctx.audit('outfit.updated', 'outfit', outfit.id, { fields: changed });
      }
      const [view] = await outfitViews(ctx, [next]);
      return view;
    },
  },

  /**
   * args: {} -> OutfitSuggestions (ARCHITECTURE.md 5.2): combinations of the actor's own active
   * items (engine/outfit-suggest.js). Names are unique among the actor's outfit names and the
   * other suggestions. Read-only: nothing is stored, audited or measured; saving goes through
   * createOutfit.
   */
  suggestOutfits: {
    auth: 'user',
    async run(ctx) {
      const [ownedRows, outfitRows] = await Promise.all([ctx.db.where('ownedItems', 'userId', ctx.actor.id), ctx.db.where('outfits', 'userId', ctx.actor.id)]);
      const owned = ownedRows.filter((r) => isOwner(ctx.actor, r));
      const saved = outfitRows.filter((o) => isOwner(ctx.actor, o));
      const result = buildSuggestions({ catalog: await ctx.catalog(), owned, saved: saved.map((o) => o.itemIds) });
      const byId = new Map(owned.map((r) => [r.id, r]));
      const ids = [...new Set(result.suggestions.flatMap((s) => s.itemIds))];
      const views = new Map((await ownedViews(ctx, ids.map((id) => byId.get(id)), owned)).map((v) => [v.id, v]));
      const taken = new Set(saved.map((o) => outfitNameKey(o.name)));
      return {
        suggestions: result.suggestions.map((s) => ({
          key: s.key,
          name: freeName(s.name, taken),
          itemIds: s.itemIds,
          items: s.itemIds.map((id) => views.get(id)),
          reasons: s.reasons,
        })),
        missing: result.missing,
        emptyReason: result.emptyReason,
        leftOut: result.leftOut,
      };
    },
  },

  /** Deletes the outfit only; its items stay in the collection. args: { outfitId } -> { ok: true } */
  deleteOutfit: {
    auth: 'user',
    async run(ctx, { outfitId }) {
      const outfit = await loadOutfit(ctx, outfitId);
      await ctx.db.delete('outfits', outfit.id);
      await ctx.audit('outfit.deleted', 'outfit', outfit.id, {});
      return { ok: true };
    },
  },
};
