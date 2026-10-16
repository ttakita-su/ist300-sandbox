// Human stylist requests with scoped, revocable, audited access. A person shares chosen items
// with a stylist an admin assigned to them. The stylist sees redacted copies (policy.js) only
// while the request is live and the assignment stands, and every view is audited.
import { ApiError, invalid } from '../errors.js';
import { newId } from '../../lib/ids.js';
import { activeAssignment, canAnswerRequest, isOwner, redactForStylist, stylistCanReadRequest } from '../policy.js';
import { ownedView, productSummary, variantView, copyCounts } from '../views.js';
import { CATEGORIES } from '../../data/schema.js';
import { ownedViews } from './inventory.js';
import { revokePhotoUrls } from './photos.js';

const MAX_TEXT = 1000;
const MAX_SHARED = 30;
const MAX_REC_ITEMS = 12;

const requestNotFound = () => new ApiError('not_found', "That request isn't available. It may have been revoked, or it isn't shared with you.");

const cleanText = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function namesOf(ctx, ids) {
  const names = new Map();
  for (const id of new Set(ids.filter(Boolean))) names.set(id, (await ctx.db.get('users', id))?.displayName ?? null);
  return names;
}

/** 'live' while the stylist can see it, 'revoked' by the person, 'ended' when the assignment ended. */
function accessOf(request, assignments) {
  if (request.revokedReason === 'assignment_ended') return 'ended';
  if (request.status === 'revoked' || request.revokedAt) return 'revoked';
  return activeAssignment(assignments, request.stylistId, request.userId) ? 'live' : 'ended';
}

function ownerRequestView(request, { names, assignments, recCount }) {
  const { snapshot, ...rest } = request;
  return {
    ...rest,
    stylist: { id: request.stylistId, displayName: names.get(request.stylistId) ?? 'Former stylist' },
    access: accessOf(request, assignments),
    itemCount: request.share.itemIds.length,
    recCount,
    snapshotTaken: Array.isArray(snapshot),
  };
}

/** What a stylist sees about a request: no ids of unshared items, no snapshot internals. */
function stylistRequestView(request, { names, recCount }) {
  return {
    id: request.id,
    client: { id: request.userId, displayName: names.get(request.userId) ?? 'Client' },
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    status: request.status,
    share: { snapshot: Boolean(request.share.snapshot), includePhotos: Boolean(request.share.includePhotos), includeNotes: Boolean(request.share.includeNotes) },
    itemCount: request.share.itemIds.length,
    message: request.message,
    budgetMinor: request.budgetMinor ?? null,
    category: request.category ?? null,
    recCount,
  };
}

/**
 * Redacted copies of the shared items as they are now. Without shared photos the stylist sees the
 * catalog image (public catalog data) rather than a photo, and photo ids never leave the server.
 */
async function liveSharedItems(ctx, request) {
  const all = await ctx.db.where('ownedItems', 'userId', request.userId);
  const byId = new Map(all.map((i) => [i.id, i]));
  const catalog = await ctx.catalog();
  const counts = copyCounts(all);
  const now = ctx.now();
  return request.share.itemIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((item) => {
      const visible = request.share.includePhotos
        ? item
        : { ...item, display: 'catalog', photos: { originalId: null, cleanedId: null, labelIds: [], webId: null } };
      const copies = item.archivedAt || !item.variantId ? 1 : counts.get(item.variantId) ?? 1;
      return redactForStylist(ownedView(catalog, visible, { now, copies }), request.share);
    });
}

async function sharedItemsFor(ctx, request) {
  if (request.share.snapshot && Array.isArray(request.snapshot)) return request.snapshot;
  return liveSharedItems(ctx, request);
}

async function recView(ctx, rec, names) {
  const catalog = await ctx.catalog();
  const now = ctx.now();
  return {
    id: rec.id,
    requestId: rec.requestId,
    createdAt: rec.createdAt,
    message: rec.message,
    // Labeled human so screens never present it as a computed recommendation.
    source: 'human',
    kind: 'stylist',
    label: 'From your stylist',
    stylist: { id: rec.stylistId, displayName: names.get(rec.stylistId) ?? 'Former stylist' },
    items: rec.items.map((it) => {
      const product = catalog.product(it.productId);
      const variant = it.variantId ? catalog.variant(it.variantId) : null;
      const shown = variant ?? (product ? catalog.variantsOf(product.id)[0] ?? null : null);
      return {
        productId: it.productId,
        variantId: it.variantId ?? null,
        note: it.note,
        product: product ? productSummary(catalog, product) : null,
        variant: variant ? variantView(catalog, variant, { now, context: 'product' }) : null,
        image: shown ? variantView(catalog, shown, { now, context: 'product' }).image : null,
      };
    }),
  };
}

function auditSummary(entry, { you, actorName, stylistName }) {
  const who = you ? 'You' : actorName ?? 'Someone';
  const meta = entry.meta ?? {};
  switch (entry.action) {
    case 'stylist_request.created':
      return `${who} shared ${plural(meta.itemCount ?? 0, 'item')} with ${stylistName ?? 'a stylist'}`;
    case 'stylist_request.viewed':
      return `${who} opened your request`;
    case 'stylist_request.photo_viewed':
      return `${who} viewed a photo you shared`;
    case 'stylist_request.revoked':
      return meta.reason === 'assignment_ended'
        ? `${stylistName ?? 'The stylist'}'s access to this request ended with their assignment`
        : `${who} ended ${stylistName ?? 'the stylist'}'s access to this request`;
    case 'stylist_rec.submitted':
      return `${who} sent ${plural(meta.itemCount ?? 0, 'suggestion')}`;
    case 'stylist_assignment.created':
      return `${who} assigned ${stylistName ?? 'a stylist'} to you`;
    case 'stylist_assignment.ended':
      return `${who} ended ${stylistName ?? 'the stylist'}'s assignment`;
    default:
      return `${who}: ${entry.action}`;
  }
}

async function recCounts(ctx, requests) {
  const counts = new Map();
  for (const r of requests) counts.set(r.id, (await ctx.db.where('stylistRecs', 'requestId', r.id)).length);
  return counts;
}

export const ops = {
  /** User: stylists assigned to them by an admin. -> [{ id, displayName, assignedAt, assignmentId }] */
  listMyStylists: {
    auth: 'user',
    async run(ctx) {
      const live = (await ctx.db.where('stylistAssignments', 'userId', ctx.actor.id)).filter((a) => !a.endedAt);
      const names = await namesOf(ctx, live.map((a) => a.stylistId));
      return live
        .filter((a) => names.get(a.stylistId))
        .map((a) => ({ id: a.stylistId, displayName: names.get(a.stylistId), assignedAt: a.createdAt, assignmentId: a.id }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
  },

  /**
   * User shares selected items (or a snapshot) with an assigned stylist.
   * args: { stylistId, itemIds: [id], snapshot?: boolean, includePhotos?: boolean, includeNotes?: boolean,
   *         message, budgetMinor?, category?, idempotencyKey }
   * - stylistId must have an active assignment to the actor (else not_found). itemIds must be the
   *   actor's items (else not_found). A message or at least one item is required.
   * - snapshot: stores redacted copies (policy.redactForStylist) taken now; the stylist sees those
   *   copies instead of live items.
   * - Purchase prices and serial numbers are never shared; notes only with includeNotes;
   *   photos only with includePhotos.
   * - Audit 'stylist_request.created'. result: request (owner view)
   */
  createStylistRequest: {
    auth: 'user',
    idempotent: true,
    async run(ctx, args) {
      const assignments = await ctx.db.where('stylistAssignments', 'userId', ctx.actor.id);
      if (typeof args.stylistId !== 'string' || !activeAssignment(assignments, args.stylistId, ctx.actor.id)) {
        throw new ApiError('not_found', "That stylist isn't assigned to you. Choose one of your stylists.");
      }
      const errors = {};
      if (args.itemIds != null && !Array.isArray(args.itemIds)) errors.itemIds = 'Choose items from your collection';
      const itemIds = [...new Set((Array.isArray(args.itemIds) ? args.itemIds : []).filter((id) => typeof id === 'string' && id))];
      if (itemIds.length > MAX_SHARED) errors.itemIds = `Share up to ${MAX_SHARED} items at a time`;
      const message = cleanText(args.message);
      if (message.length > MAX_TEXT) errors.message = 'Keep your message under 1,000 characters';
      if (!message && !itemIds.length) errors.message = 'Add a message or choose items to share';
      const budgetMinor = args.budgetMinor == null || args.budgetMinor === '' ? null : args.budgetMinor;
      if (budgetMinor != null && !(Number.isInteger(budgetMinor) && budgetMinor > 0)) errors.budgetMinor = 'Enter a budget above zero';
      const category = args.category || null;
      if (category && !CATEGORIES.includes(category)) errors.category = 'Choose sneakers, watches or clothing';
      if (Object.keys(errors).length) throw invalid(errors);
      for (const id of itemIds) {
        const item = await ctx.db.get('ownedItems', id);
        if (!item || !isOwner(ctx.actor, item)) throw new ApiError('not_found', "One of those items isn't in your collection. It may have been deleted.");
      }

      const now = ctx.iso();
      const share = { itemIds, snapshot: Boolean(args.snapshot), includePhotos: Boolean(args.includePhotos), includeNotes: Boolean(args.includeNotes) };
      const request = {
        id: newId('req'),
        userId: ctx.actor.id,
        stylistId: args.stylistId,
        createdAt: now,
        updatedAt: now,
        status: 'open',
        revokedAt: null,
        share,
        snapshot: null,
        message,
        budgetMinor,
        category,
      };
      if (share.snapshot) request.snapshot = await liveSharedItems(ctx, request);
      await ctx.db.put('stylistRequests', request);
      await ctx.audit('stylist_request.created', 'stylistRequest', request.id, {
        stylistId: request.stylistId,
        itemCount: itemIds.length,
        snapshot: share.snapshot,
        includePhotos: share.includePhotos,
        includeNotes: share.includeNotes,
      });
      return ownerRequestView(request, { names: await namesOf(ctx, [request.stylistId]), assignments, recCount: 0 });
    },
  },

  /**
   * User: their requests (with access 'live' | 'revoked' | 'ended'). Stylist: live requests
   * addressed to them (not revoked, still assigned); an unassigned stylist sees none. Newest first.
   */
  listStylistRequests: {
    auth: 'any',
    async run(ctx) {
      if (ctx.actor.role === 'user') {
        const [requests, assignments] = await Promise.all([
          ctx.db.where('stylistRequests', 'userId', ctx.actor.id),
          ctx.db.where('stylistAssignments', 'userId', ctx.actor.id),
        ]);
        const names = await namesOf(ctx, requests.map((r) => r.stylistId));
        const counts = await recCounts(ctx, requests);
        return requests
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((r) => ownerRequestView(r, { names, assignments, recCount: counts.get(r.id) ?? 0 }));
      }
      if (ctx.actor.role === 'stylist') {
        const [requests, assignments] = await Promise.all([
          ctx.db.where('stylistRequests', 'stylistId', ctx.actor.id),
          ctx.db.where('stylistAssignments', 'stylistId', ctx.actor.id),
        ]);
        const live = requests.filter((r) => stylistCanReadRequest(ctx.actor, r, assignments));
        const names = await namesOf(ctx, live.map((r) => r.userId));
        const counts = await recCounts(ctx, live);
        return live
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((r) => stylistRequestView(r, { names, recCount: counts.get(r.id) ?? 0 }));
      }
      throw new ApiError('forbidden', "Your account can't do that.");
    },
  },

  /**
   * args: { requestId }. Owner: the request, the items as the stylist sees them (`items`), their
   * own full item views (`ownItems`) and the recommendations. Stylist: only redacted shared items,
   * and only while policy.stylistCanReadRequest holds; otherwise not_found. Each stylist view is
   * audited ('stylist_request.viewed').
   * result: { request, items: [RedactedItem], recs: [StylistRecView], ownItems? }
   */
  getStylistRequest: {
    auth: 'any',
    async run(ctx, { requestId }) {
      const request = typeof requestId === 'string' && requestId ? await ctx.db.get('stylistRequests', requestId) : null;
      if (!request) throw requestNotFound();
      const recs = (await ctx.db.where('stylistRecs', 'requestId', request.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      if (ctx.actor.role === 'user' && isOwner(ctx.actor, request)) {
        const assignments = await ctx.db.where('stylistAssignments', 'userId', ctx.actor.id);
        const names = await namesOf(ctx, [request.stylistId, ...recs.map((r) => r.stylistId)]);
        const all = await ctx.db.where('ownedItems', 'userId', ctx.actor.id);
        const shared = request.share.itemIds.map((id) => all.find((i) => i.id === id)).filter(Boolean);
        return {
          request: ownerRequestView(request, { names, assignments, recCount: recs.length }),
          items: await sharedItemsFor(ctx, request),
          ownItems: await ownedViews(ctx, shared, all),
          recs: await Promise.all(recs.map((r) => recView(ctx, r, names))),
        };
      }

      if (ctx.actor.role === 'stylist') {
        const assignments = await ctx.db.where('stylistAssignments', 'stylistId', ctx.actor.id);
        if (!stylistCanReadRequest(ctx.actor, request, assignments)) throw requestNotFound();
        const items = await sharedItemsFor(ctx, request);
        const names = await namesOf(ctx, [request.userId, ctx.actor.id]);
        await ctx.audit('stylist_request.viewed', 'stylistRequest', request.id, { itemCount: items.length });
        return {
          request: stylistRequestView(request, { names, recCount: recs.length }),
          items,
          recs: await Promise.all(recs.filter((r) => r.stylistId === ctx.actor.id).map((r) => recView(ctx, r, names))),
        };
      }
      throw requestNotFound();
    },
  },

  /**
   * User revokes; stylist access ends immediately, including photo URLs already issued to that
   * stylist for the person's photos. Audit 'stylist_request.revoked'. args: { requestId } -> request
   */
  revokeStylistRequest: {
    auth: 'user',
    async run(ctx, { requestId }) {
      const request = typeof requestId === 'string' && requestId ? await ctx.db.get('stylistRequests', requestId) : null;
      if (!request || !isOwner(ctx.actor, request)) throw requestNotFound();
      const assignments = await ctx.db.where('stylistAssignments', 'userId', ctx.actor.id);
      const names = await namesOf(ctx, [request.stylistId]);
      const recCount = (await ctx.db.where('stylistRecs', 'requestId', request.id)).length;
      if (request.status === 'revoked') return ownerRequestView(request, { names, assignments, recCount });
      const now = ctx.iso();
      const revoked = { ...request, status: 'revoked', revokedAt: now, updatedAt: now };
      await ctx.db.put('stylistRequests', revoked);
      // Over-revoking is safe: URLs still allowed by another live request are simply issued again.
      const urlsRevoked = revokePhotoUrls(ctx.providers.urls, { actorId: request.stylistId, ownerId: ctx.actor.id });
      await ctx.audit('stylist_request.revoked', 'stylistRequest', request.id, { stylistId: request.stylistId, urlsRevoked });
      return ownerRequestView(revoked, { names, assignments, recCount });
    },
  },

  /**
   * Stylist answers with catalog products and notes. Products (and versions, when given) must
   * exist in the catalog; notes and the message are up to 1,000 characters. Needs live access
   * (policy.canAnswerRequest), else not_found. Sets the request to 'answered'. Audited.
   * args: { requestId, items: [{ productId, variantId?, note }], message, idempotencyKey }
   * result: StylistRecView
   */
  submitStylistRecs: {
    auth: 'stylist',
    idempotent: true,
    async run(ctx, args) {
      const request = typeof args.requestId === 'string' && args.requestId ? await ctx.db.get('stylistRequests', args.requestId) : null;
      const assignments = await ctx.db.where('stylistAssignments', 'stylistId', ctx.actor.id);
      if (!request || !canAnswerRequest(ctx.actor, request, assignments)) throw requestNotFound();
      const catalog = await ctx.catalog();
      const errors = {};
      const rawItems = Array.isArray(args.items) ? args.items : [];
      if (args.items != null && !Array.isArray(args.items)) errors.items = 'Choose products from the catalog';
      if (rawItems.length > MAX_REC_ITEMS) errors.items = `Suggest up to ${MAX_REC_ITEMS} products at a time`;
      const items = rawItems.slice(0, MAX_REC_ITEMS).map((it, i) => {
        const product = it && typeof it.productId === 'string' ? catalog.product(it.productId) : null;
        if (!product) errors[`items.${i}.productId`] = 'That product is not in the catalog';
        const variantId = it?.variantId || null;
        if (product && variantId && catalog.variant(variantId)?.productId !== product.id) errors[`items.${i}.variantId`] = 'That version does not belong to this product';
        const note = cleanText(it?.note);
        if (note.length > MAX_TEXT) errors[`items.${i}.note`] = 'Keep notes under 1,000 characters';
        return { productId: product?.id ?? null, variantId, note };
      });
      const message = cleanText(args.message);
      if (message.length > MAX_TEXT) errors.message = 'Keep your message under 1,000 characters';
      if (!items.length && !message) errors.items = 'Suggest at least one product or write a message';
      if (Object.keys(errors).length) throw invalid(errors);

      const rec = { id: newId('srec'), requestId: request.id, stylistId: ctx.actor.id, userId: request.userId, items, message, createdAt: ctx.iso() };
      await ctx.db.put('stylistRecs', rec);
      await ctx.db.put('stylistRequests', { ...request, status: 'answered', updatedAt: ctx.iso() });
      await ctx.audit('stylist_rec.submitted', 'stylistRequest', request.id, { recId: rec.id, itemCount: items.length });
      return recView(ctx, rec, await namesOf(ctx, [ctx.actor.id]));
    },
  },

  /**
   * User: recommendations stylists sent them, labeled human (source 'human'), newest first.
   * args: { requestId? } -> [StylistRecView with product and variant views and the stylist's name]
   */
  listStylistRecs: {
    auth: 'user',
    async run(ctx, args) {
      const recs = (await ctx.db.where('stylistRecs', 'userId', ctx.actor.id))
        .filter((r) => !args.requestId || r.requestId === args.requestId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const names = await namesOf(ctx, recs.map((r) => r.stylistId));
      return Promise.all(recs.map((r) => recView(ctx, r, names)));
    },
  },

  /**
   * User: audit entries for their requests (shares, stylist views, photo views, revocations,
   * suggestions) and for stylist assignments made for them. args: { requestId? }
   * -> [{ id, at, action, summary, actor: { id, displayName, role, you }, targetType, targetId, requestId, meta }]
   */
  getAuditLog: {
    auth: 'user',
    async run(ctx, args) {
      const requests = await ctx.db.where('stylistRequests', 'userId', ctx.actor.id);
      const byId = new Map(requests.map((r) => [r.id, r]));
      if (args.requestId && !byId.has(args.requestId)) throw requestNotFound();
      const targets = args.requestId ? [args.requestId] : [...byId.keys()];
      const assignments = args.requestId ? [] : await ctx.db.where('stylistAssignments', 'userId', ctx.actor.id);
      const entries = [];
      for (const id of [...targets, ...assignments.map((a) => a.id)]) entries.push(...(await ctx.db.where('audit', 'targetId', id)));
      const assignmentById = new Map(assignments.map((a) => [a.id, a]));
      const stylistOf = (e) => byId.get(e.targetId)?.stylistId ?? assignmentById.get(e.targetId)?.stylistId ?? null;
      const users = new Map();
      for (const id of new Set([...entries.map((e) => e.actorId), ...entries.map(stylistOf)].filter(Boolean))) users.set(id, await ctx.db.get('users', id));
      return entries
        .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
        .map((e) => {
          const actor = users.get(e.actorId);
          const you = e.actorId === ctx.actor.id;
          return {
            id: e.id,
            at: e.at,
            action: e.action,
            summary: auditSummary(e, { you, actorName: actor?.displayName ?? null, stylistName: users.get(stylistOf(e))?.displayName ?? null }),
            actor: { id: e.actorId, displayName: actor?.displayName ?? null, role: actor?.role ?? null, you },
            targetType: e.targetType,
            targetId: e.targetId,
            requestId: byId.has(e.targetId) ? e.targetId : null,
            meta: e.meta ?? {},
          };
        });
    },
  },
};
