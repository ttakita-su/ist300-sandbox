// Access rules. These are pure functions so they can be tested exhaustively; they mirror the
// row-level security policies in supabase/migrations/0001_init.sql.
//
// Principles: private by default; owners read and write their own rows; a stylist reads only
// what a live request shares, while still assigned; admins manage the catalog and operations
// but cannot read anyone's inventory.

export function isOwner(actor, record) {
  return Boolean(actor && record && record.userId === actor.id);
}

export function hasRole(actor, role) {
  return Boolean(actor && actor.role === role);
}

/** The live assignment between a stylist and a user, if any. */
export function activeAssignment(assignments, stylistId, userId) {
  return assignments.find((a) => a.stylistId === stylistId && a.userId === userId && !a.endedAt) ?? null;
}

/** A request is live for a stylist when it was sent to them, isn't revoked, and they are still assigned. */
export function stylistCanReadRequest(actor, request, assignments) {
  return (
    hasRole(actor, 'stylist') &&
    Boolean(request) &&
    request.stylistId === actor.id &&
    request.status !== 'revoked' &&
    !request.revokedAt &&
    Boolean(activeAssignment(assignments, actor.id, request.userId))
  );
}

export function canReadRequest(actor, request, assignments) {
  return isOwner(actor, request) || stylistCanReadRequest(actor, request, assignments);
}

/** Only the stylist a live request was sent to can answer it. */
export function canAnswerRequest(actor, request, assignments) {
  return stylistCanReadRequest(actor, request, assignments) && request.status !== 'closed';
}

export function sharedItemIds(request) {
  return new Set(request?.share?.itemIds ?? []);
}

/** Whether a stylist may see one owned item through any live request. */
export function stylistCanReadItem(actor, item, requests, assignments) {
  if (!item) return false;
  return requests.some(
    (r) => r.userId === item.userId && stylistCanReadRequest(actor, r, assignments) && sharedItemIds(r).has(item.id),
  );
}

/** Photos are only visible to a stylist when the request shared both the item and its photos. */
export function stylistCanReadPhoto(actor, photo, items, requests, assignments) {
  if (!photo) return false;
  return requests.some((r) => {
    if (!r.share?.includePhotos || r.userId !== photo.userId) return false;
    if (!stylistCanReadRequest(actor, r, assignments)) return false;
    const ids = sharedItemIds(r);
    return items.some(
      (item) => ids.has(item.id) && (item.photos?.originalId === photo.id || item.photos?.cleanedId === photo.id),
    );
  });
}

export function canReadPhoto(actor, photo, ctx = { items: [], requests: [], assignments: [] }) {
  return isOwner(actor, photo) || stylistCanReadPhoto(actor, photo, ctx.items, ctx.requests, ctx.assignments);
}

/** Fields a stylist never sees unless the person explicitly shares them. */
export const STYLIST_HIDDEN = ['details.purchase', 'details.serialNumber', 'details.notes', 'identity.evidence', 'photos'];

/**
 * Builds the stylist's copy of an owned-item view from an allowlist, so new private fields
 * stay hidden by default.
 * @param {any} view OwnedView (server/views.js)
 * @param {{ includePhotos: boolean, includeNotes: boolean }} share
 */
export function redactForStylist(view, share) {
  const image =
    share.includePhotos || view.image?.kind === 'catalog' || view.image?.kind === 'placeholder'
      ? view.image
      : { kind: 'placeholder', url: null, photoId: null, label: null, attribution: null, fallbackReason: 'Photos not shared', options: [] };
  return {
    id: view.id,
    category: view.category,
    productId: view.productId,
    variantId: view.variantId,
    custom: view.custom,
    product: view.product,
    variant: view.variant,
    title: view.title,
    brandName: view.brandName,
    subtitle: view.subtitle,
    code: view.code,
    image,
    details: {
      size: view.details?.size ?? null,
      condition: view.details?.condition ?? null,
      notes: share.includeNotes ? view.details?.notes ?? '' : null,
    },
    ownerChanges: view.ownerChanges ?? [],
    identity: { resolution: view.identity?.resolution, variant: view.identity?.variant },
    shared: { photos: Boolean(share.includePhotos), notes: Boolean(share.includeNotes) },
  };
}

/** Admin screens see accounts as id, name and role only. */
export function redactAccountForAdmin(user) {
  return { id: user.id, displayName: user.displayName, role: user.role, demo: Boolean(user.demo), createdAt: user.createdAt };
}
