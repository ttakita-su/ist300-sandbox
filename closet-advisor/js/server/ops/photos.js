// Private photo storage. A photo is readable by its owner, and by a stylist only through a live
// request that shared the item and its photos. Photo URLs are short-lived and tracked, so when
// access ends (revocation, an ended assignment, deletion) URLs already handed out are withdrawn.
//
// Storage contract (relied on by the matching job runner):
//   original/label row: { id, userId, kind: 'original'|'label', blob, mime, width, height, bytes,
//                         createdAt, processingId, sourceId: null }
//   processing row:     { id, userId, kind: 'processing', blob, ..., processingId: null,
//                         sourceId: <id of the original/label row> }
//   cleaned row:        { id, userId, kind: 'cleaned', blob, ..., sourceId: <original id> }
import { ApiError, invalid } from '../errors.js';
import { newId } from '../../lib/ids.js';
import { canReadPhoto, isOwner, sharedItemIds, stylistCanReadRequest } from '../policy.js';
import { leadingBytes, sniffImageType, validateUploadBlob } from '../validate-image.js';

export const PHOTO_URL_TTL_MS = 10 * 60 * 1000;
// A URL with less than this left is replaced rather than handed out again.
const REUSE_MARGIN_MS = 60 * 1000;
const UPLOAD_KINDS = ['original', 'label'];

const photoNotFound = () =>
  new ApiError('not_found', "That photo isn't available. It may have been deleted, or it isn't shared with you.");
const itemNotFound = () => new ApiError('not_found', "That item isn't in your collection. It may have been deleted.");

function isBlob(value) {
  return Boolean(value) && typeof value.size === 'number' && typeof value.slice === 'function' && typeof value.arrayBuffer === 'function';
}

const positiveOrNull = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : null);

async function sniffBlob(blob) {
  try {
    return sniffImageType(await leadingBytes(blob));
  } catch {
    return null;
  }
}

// ---------- Issued URL registry ----------

// One registry per urls provider, so separate API instances (tests, a reset) never share entries.
const registries = new WeakMap();

function registryFor(urls) {
  let registry = registries.get(urls);
  if (!registry) {
    registry = new Map();
    registries.set(urls, registry);
  }
  return registry;
}

function revokeEntry(urls, registry, entry) {
  if (registry.get(entry.key) !== entry) return false;
  registry.delete(entry.key);
  if (entry.timer) clearTimeout(entry.timer);
  try {
    urls.revoke?.(entry.url);
  } catch {
    // Revoking a URL the browser already dropped is harmless.
  }
  return true;
}

/**
 * Withdraws issued photo URLs. Every given criterion must match; with no criteria nothing is
 * revoked, so a missing argument can never wipe every URL.
 * @param {{ revoke?: (url: string) => void }} urls ctx.providers.urls
 * @param {{ actorId?: string, ownerId?: string, photoIds?: Iterable<string> }} match
 * @returns {number} how many URLs were revoked
 */
export function revokePhotoUrls(urls, match = {}) {
  if (!urls || typeof urls !== 'object') return 0;
  const registry = registries.get(urls);
  if (!registry) return 0;
  const ids = match.photoIds ? new Set(match.photoIds) : null;
  if (!match.actorId && !match.ownerId && !ids) return 0;
  let count = 0;
  for (const entry of [...registry.values()]) {
    if (match.actorId && entry.actorId !== match.actorId) continue;
    if (match.ownerId && entry.ownerId !== match.ownerId) continue;
    if (ids && !ids.has(entry.photoId)) continue;
    if (revokeEntry(urls, registry, entry)) count += 1;
  }
  return count;
}

/** Revokes URLs whose expiry has passed by the server clock (tests use a fixed clock). */
export function sweepExpiredPhotoUrls(urls, now) {
  const registry = urls && typeof urls === 'object' ? registries.get(urls) : null;
  if (!registry) return 0;
  let count = 0;
  for (const entry of [...registry.values()]) {
    if (entry.expiresAt <= now && revokeEntry(urls, registry, entry)) count += 1;
  }
  return count;
}

/** Live URLs issued through a urls provider: { url, photoId, ownerId, actorId, expiresAt }. */
export function issuedPhotoUrls(urls) {
  const registry = urls && typeof urls === 'object' ? registries.get(urls) : null;
  return registry
    ? [...registry.values()].map(({ url, photoId, ownerId, actorId, expiresAt }) => ({ url, photoId, ownerId, actorId, expiresAt: new Date(expiresAt).toISOString() }))
    : [];
}

function issueUrl(ctx, photo) {
  const urls = ctx.providers.urls;
  if (!urls?.objectUrl) throw new ApiError('unavailable', "Photos can't be shown right now. Reload the page and try again.");
  const now = ctx.now();
  const registry = registryFor(urls);
  const key = `${ctx.actor.id}\u0000${photo.id}`;
  const existing = registry.get(key);
  if (existing && existing.expiresAt - now > REUSE_MARGIN_MS) return { entry: existing, reused: true };
  if (existing) revokeEntry(urls, registry, existing);
  const entry = {
    key,
    url: urls.objectUrl(photo.blob, photo.id),
    photoId: photo.id,
    ownerId: photo.userId,
    actorId: ctx.actor.id,
    expiresAt: now + PHOTO_URL_TTL_MS,
    timer: null,
  };
  registry.set(key, entry);
  // Wall-clock expiry for the browser; unref so a pending timer never keeps Node tests alive.
  entry.timer = setTimeout(() => revokeEntry(urls, registry, entry), PHOTO_URL_TTL_MS);
  entry.timer?.unref?.();
  return { entry, reused: false };
}

// ---------- Helpers shared with inventory and privacy ----------

/**
 * Deletes photo rows owned by `userId`, with the processing copies made from them, and
 * withdraws their URLs. Ids that belong to someone else are skipped.
 * @returns {Promise<string[]>} ids deleted
 */
export async function deletePhotos(ctx, userId, photoIds) {
  const queue = [...new Set([...(photoIds ?? [])].filter(Boolean))];
  const deleted = new Set();
  while (queue.length) {
    const id = queue.pop();
    if (deleted.has(id)) continue;
    const photo = await ctx.db.get('photos', id);
    if (!photo || photo.userId !== userId) continue;
    if (photo.processingId) queue.push(photo.processingId);
    await ctx.db.delete('photos', id);
    deleted.add(id);
  }
  if (deleted.size) {
    // A processing copy whose source row lost its processingId link still points back by sourceId.
    for (const row of await ctx.db.where('photos', 'userId', userId)) {
      if (row.kind === 'processing' && deleted.has(row.sourceId)) {
        await ctx.db.delete('photos', row.id);
        deleted.add(row.id);
      }
    }
    revokePhotoUrls(ctx.providers.urls, { photoIds: deleted });
  }
  return [...deleted];
}

/** The live request that lets this stylist see the photo, or null. Policy decides; this finds which. */
async function stylistPhotoGrant(ctx, photo) {
  const [items, requests, assignments] = await Promise.all([
    ctx.db.where('ownedItems', 'userId', photo.userId),
    ctx.db.where('stylistRequests', 'stylistId', ctx.actor.id),
    ctx.db.where('stylistAssignments', 'stylistId', ctx.actor.id),
  ]);
  if (!canReadPhoto(ctx.actor, photo, { items, requests, assignments })) return null;
  const showsPhoto = (item) => item.photos?.originalId === photo.id || item.photos?.cleanedId === photo.id;
  return (
    requests.find(
      (r) =>
        r.userId === photo.userId &&
        r.share?.includePhotos &&
        stylistCanReadRequest(ctx.actor, r, assignments) &&
        items.some((item) => sharedItemIds(r).has(item.id) && showsPhoto(item)),
    ) ?? null
  );
}

export const ops = {
  /**
   * Validates and stores a photo the person uploaded or captured.
   * args: { blob: Blob, kind: 'original' | 'label', idempotencyKey? }
   * - Sniff the real type from the first bytes (validate-image.js): JPEG, PNG, WebP, HEIC/HEIF.
   *   Reject anything else with ApiError('unsupported', ...). Reject > 15 MB ('invalid').
   * - ctx.providers.imaging.normalize(blob) re-encodes (strips EXIF/GPS), corrects orientation,
   *   caps the long edge (2048 original, 768 processing) and checks decoded dimensions
   *   (min 200 px). HEIC that the browser can't decode -> ApiError('unsupported', 'This browser
   *   can't read HEIC photos. On iPhone, photos convert automatically; on a computer, export a JPEG.').
   * - Stores two private `photos` rows (kind 'original' or 'label', plus 'processing'), both
   *   with userId = actor. The original row stores processingId; the processing row stores
   *   sourceId. Never log image bytes.
   * - Optional provider fields processingWidth/processingHeight size the processing row;
   *   without them its dimensions are stored as unknown (null).
   * result: { photoId, processingId, width, height, mime, bytes }
   */
  uploadPhoto: {
    auth: 'user',
    idempotent: true,
    async run(ctx, args) {
      const kind = args.kind ?? 'original';
      if (!UPLOAD_KINDS.includes(kind)) throw invalid({ kind: 'Choose a photo of the item or of its label' }, 'Choose what this photo shows.');
      const { mime: uploadedMime } = await validateUploadBlob(args.blob);

      const normalized = await ctx.providers.imaging.normalize(args.blob);
      if (!normalized || !isBlob(normalized.original) || !isBlob(normalized.processing)) {
        throw new ApiError('unavailable', "This photo couldn't be processed. Try again, or choose another photo.");
      }
      // Record the type of what is stored (the re-encoded copy), read from its bytes.
      const originalMime = (await sniffBlob(normalized.original)) ?? normalized.mime ?? uploadedMime;
      const processingMime = (await sniffBlob(normalized.processing)) ?? normalized.mime ?? uploadedMime;
      const createdAt = ctx.iso();
      const photoId = newId('pho');
      const processingId = newId('pho');
      const original = {
        id: photoId,
        userId: ctx.actor.id,
        kind,
        blob: normalized.original,
        mime: originalMime,
        width: positiveOrNull(normalized.width),
        height: positiveOrNull(normalized.height),
        bytes: normalized.original.size,
        createdAt,
        processingId,
        sourceId: null,
      };
      const processing = {
        id: processingId,
        userId: ctx.actor.id,
        kind: 'processing',
        blob: normalized.processing,
        mime: processingMime,
        width: positiveOrNull(normalized.processingWidth),
        height: positiveOrNull(normalized.processingHeight),
        bytes: normalized.processing.size,
        createdAt,
        processingId: null,
        sourceId: photoId,
      };
      await ctx.db.put('photos', original);
      await ctx.db.put('photos', processing);
      await ctx.metric('photo_uploaded', { kind, mime: originalMime });
      return { photoId, processingId, width: original.width, height: original.height, mime: originalMime, bytes: original.bytes };
    },
  },

  /**
   * An expiring object URL for a private photo.
   * args: { photoId }
   * - Owner may read. A stylist may read only via policy.canReadPhoto (live request that shared
   *   the item and its photos). Anyone else -> ApiError('not_found').
   * - URLs last 10 minutes and are tracked with who they were issued to, so revoking a request,
   *   ending an assignment or deleting the photo withdraws them. Each URL issued to a stylist is
   *   audited ('stylist_request.photo_viewed') on the request that allowed it.
   * - Browser: URL.createObjectURL(blob). Tests: 'blob:test/<id>'.
   * result: { url, expiresAt }
   */
  getPhotoUrl: {
    auth: 'any',
    async run(ctx, { photoId }) {
      sweepExpiredPhotoUrls(ctx.providers.urls, ctx.now());
      const photo = typeof photoId === 'string' && photoId ? await ctx.db.get('photos', photoId) : null;
      if (!photo) throw photoNotFound();
      let grant = null;
      if (!isOwner(ctx.actor, photo)) {
        if (ctx.actor.role !== 'stylist') throw photoNotFound();
        grant = await stylistPhotoGrant(ctx, photo);
        if (!grant) throw photoNotFound();
      }
      const { entry, reused } = issueUrl(ctx, photo);
      if (grant && !reused) await ctx.audit('stylist_request.photo_viewed', 'stylistRequest', grant.id, { photoId: photo.id });
      return { url: entry.url, expiresAt: new Date(entry.expiresAt).toISOString() };
    },
  },

  /**
   * Optional background clean-up of an owned item's original photo (on a neutral backdrop).
   * Never invents product details. Stores a 'cleaned' photo and sets item.photos.cleanedId; a
   * previous cleaned copy is replaced. The original is kept and the display choice is unchanged.
   * args: { itemId, idempotencyKey? }  result: { photoId, itemId }
   */
  cleanupPhoto: {
    auth: 'user',
    idempotent: true,
    async run(ctx, { itemId }) {
      const item = typeof itemId === 'string' && itemId ? await ctx.db.get('ownedItems', itemId) : null;
      if (!item || !isOwner(ctx.actor, item)) throw itemNotFound();
      const original = item.photos?.originalId ? await ctx.db.get('photos', item.photos.originalId) : null;
      if (!original || !isOwner(ctx.actor, original)) {
        throw new ApiError('invalid', 'This item has no photo to clean up. Add a photo of your item first.');
      }

      const result = await ctx.providers.imaging.cleanup(original.blob);
      const blob = isBlob(result) ? result : result?.blob;
      if (!isBlob(blob)) throw new ApiError('unavailable', "The photo couldn't be cleaned up. Try again, or keep your original photo.");
      const cleaned = {
        id: newId('pho'),
        userId: ctx.actor.id,
        kind: 'cleaned',
        blob,
        mime: (await sniffBlob(blob)) ?? original.mime,
        // Clean-up may crop or pad; only a provider that reports its output size is trusted.
        width: positiveOrNull(result?.width),
        height: positiveOrNull(result?.height),
        bytes: blob.size,
        createdAt: ctx.iso(),
        processingId: null,
        sourceId: original.id,
      };
      await ctx.db.put('photos', cleaned);

      const previous = item.photos.cleanedId;
      const next = { ...item, photos: { ...item.photos, cleanedId: cleaned.id }, updatedAt: ctx.iso() };
      await ctx.db.put('ownedItems', next);
      if (previous && previous !== cleaned.id) await deletePhotos(ctx, ctx.actor.id, [previous]);
      await ctx.audit('owned.photo_cleaned', 'ownedItem', item.id, {});
      return { photoId: cleaned.id, itemId: item.id };
    },
  },
};
