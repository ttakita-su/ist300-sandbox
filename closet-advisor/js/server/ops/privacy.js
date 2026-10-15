// Data export and account deletion. Export returns everything stored about the signed-in
// account and nothing about anyone else; deletion removes all of it.
import { ApiError, invalid } from '../errors.js';
import { seedDemo } from '../seed.js';
import { revokePhotoUrls } from './photos.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// A multiple of 3, so padding can only appear at the very end.
const B64_CHUNK = 3 * 4096;

/**
 * Base64 for raw bytes, in plain JS so it behaves the same in Node and in browsers (no btoa
 * string limits, no Buffer).
 * @param {Uint8Array} bytes
 */
export function bytesToBase64(bytes) {
  const parts = [];
  const full = bytes.length - (bytes.length % 3);
  for (let start = 0; start < full; start += B64_CHUNK) {
    const end = Math.min(start + B64_CHUNK, full);
    let out = '';
    for (let i = start; i < end; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[n >>> 18] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63];
    }
    parts.push(out);
  }
  const rest = bytes.length - full;
  if (rest === 1) {
    const n = bytes[full] << 16;
    parts.push(`${B64[n >>> 18]}${B64[(n >>> 12) & 63]}==`);
  } else if (rest === 2) {
    const n = (bytes[full] << 16) | (bytes[full + 1] << 8);
    parts.push(`${B64[n >>> 18]}${B64[(n >>> 12) & 63]}${B64[(n >>> 6) & 63]}=`);
  }
  return parts.join('');
}

/** @param {Blob} blob @param {string} [mime] */
export async function blobToDataUrl(blob, mime) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${mime || blob.type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

const omit = (record, keys) => Object.fromEntries(Object.entries(record).filter(([k]) => !keys.includes(k)));

/** Ids of every record the person owns, for matching audit rows about them. */
function ownIds(groups) {
  return new Set(groups.flat().map((r) => r.id).filter(Boolean));
}

/**
 * Removes everything stored for one account except the user row itself. Returns counts per
 * store. Stylist assignments on either side go too; recommendations a stylist already sent stay
 * with the people who received them.
 */
async function removeAccountData(ctx, user) {
  const uid = user.id;
  const removed = {};
  const ids = new Set([uid]);
  const drop = async (store, rows, key = 'id') => {
    for (const row of rows) {
      await ctx.db.delete(store, row[key]);
      if (row.id) ids.add(row.id);
    }
    removed[store] = (removed[store] ?? 0) + rows.length;
  };

  for (const store of ['ownedItems', 'wishlistItems', 'photos', 'matchJobs', 'recRequests', 'feedback', 'stylistRequests', 'stylistRecs', 'corrections']) {
    await drop(store, await ctx.db.where(store, 'userId', uid));
  }
  const profile = await ctx.db.get('profiles', uid);
  if (profile) await drop('profiles', [profile], 'userId');
  await drop('stylistAssignments', [...(await ctx.db.where('stylistAssignments', 'userId', uid)), ...(await ctx.db.where('stylistAssignments', 'stylistId', uid))]);
  await drop('sessions', await ctx.db.where('sessions', 'userId', uid), 'token');
  await drop('idempotency', (await ctx.db.all('idempotency')).filter((row) => String(row.id).startsWith(`${uid}:`)));

  // Clicks carry only the pseudonymous analyticsId; conversions point at clicks by clickRef.
  const clicks = user.analyticsId ? await ctx.db.where('clicks', 'analyticsId', user.analyticsId) : [];
  const refs = new Set(clicks.map((c) => c.clickRef));
  await drop('clicks', clicks);
  if (refs.size) await drop('conversions', (await ctx.db.all('conversions')).filter((c) => refs.has(c.clickRef)));

  // Audit rows by the person or about their records. Admin decisions on catalog corrections stay:
  // they describe catalog changes, and the correction that linked them to the person is gone.
  const aboutThem = (await ctx.db.all('audit')).filter(
    (a) =>
      a.actorId === uid ||
      (a.targetType !== 'correction' && ids.has(a.targetId)) ||
      JSON.stringify(a.meta ?? {}).includes(uid),
  );
  await drop('audit', aboutThem);

  revokePhotoUrls(ctx.providers.urls, { ownerId: uid });
  revokePhotoUrls(ctx.providers.urls, { actorId: uid });
  return removed;
}

export const ops = {
  /**
   * Everything stored about the actor, including private photos as data URLs.
   * result: { format, version, exportedAt, notes, account (no password hash or salt), profile,
   *           owned, wishlist, photos: [{ id, kind, mime, width, height, bytes, createdAt,
   *           processingId, sourceId, dataUrl }], matchJobs, recRequests, feedback,
   *           stylistRequests, stylistRecs, stylistAssignments, corrections, clicks (rows under
   *           the account's pseudonymous analyticsId), conversions linked to those clicks,
   *           sessions (times only, never tokens), activity (audit rows by the account),
   *           accessLog (audit rows by others about the account's requests and assignments) }
   * Nothing about other people: a stylist's export holds the suggestions they wrote without the
   * client's id, not the clients' shared items.
   */
  exportMyData: {
    auth: 'any',
    async run(ctx) {
      const uid = ctx.actor.id;
      const user = (await ctx.db.get('users', uid)) ?? {};
      const byUser = (store) => ctx.db.where(store, 'userId', uid);
      const [profile, owned, wishlist, photoRows, matchJobs, recRequests, feedback, requests, recsReceived, corrections, sessions] = await Promise.all([
        ctx.db.get('profiles', uid),
        byUser('ownedItems'),
        byUser('wishlistItems'),
        byUser('photos'),
        byUser('matchJobs'),
        byUser('recRequests'),
        byUser('feedback'),
        byUser('stylistRequests'),
        byUser('stylistRecs'),
        byUser('corrections'),
        byUser('sessions'),
      ]);
      const photos = [];
      for (const row of photoRows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        photos.push({ ...omit(row, ['blob']), dataUrl: row.blob ? await blobToDataUrl(row.blob, row.mime) : null });
      }

      const isStylist = ctx.actor.role === 'stylist';
      const [asClient, asStylist, recsWritten] = await Promise.all([
        ctx.db.where('stylistAssignments', 'userId', uid),
        ctx.db.where('stylistAssignments', 'stylistId', uid),
        isStylist ? ctx.db.where('stylistRecs', 'stylistId', uid) : [],
      ]);
      const names = new Map();
      for (const a of asClient) if (!names.has(a.stylistId)) names.set(a.stylistId, (await ctx.db.get('users', a.stylistId))?.displayName ?? null);
      const stylistAssignments = [
        ...asClient.map((a) => ({ id: a.id, role: 'client', stylistId: a.stylistId, stylistName: names.get(a.stylistId), createdAt: a.createdAt, endedAt: a.endedAt ?? null })),
        // The stylist's side of an assignment says when, not who the client is.
        ...asStylist.map((a) => ({ id: a.id, role: 'stylist', createdAt: a.createdAt, endedAt: a.endedAt ?? null })),
      ];
      const stylistRecs = [...recsReceived, ...recsWritten.map((r) => ({ ...omit(r, ['userId']), authoredByYou: true }))];

      const clicks = ctx.actor.analyticsId ? await ctx.db.where('clicks', 'analyticsId', ctx.actor.analyticsId) : [];
      const refs = new Set(clicks.map((c) => c.clickRef));
      const conversions = refs.size ? (await ctx.db.all('conversions')).filter((c) => refs.has(c.clickRef)) : [];

      const mine = ownIds([owned, wishlist, photoRows, matchJobs, requests, corrections, recsReceived, asClient]);
      mine.add(uid);
      const audit = await ctx.db.all('audit');
      const activity = audit
        .filter((a) => a.actorId === uid)
        .map((a) => (mine.has(a.targetId) || a.targetType === 'catalog' || a.targetType === 'config' ? a : { id: a.id, at: a.at, action: a.action, actorId: a.actorId, targetType: a.targetType }));
      const accessLog = isStylist ? [] : audit.filter((a) => a.actorId !== uid && mine.has(a.targetId) && a.targetType !== 'correction');

      await ctx.audit('privacy.exported', 'user', uid, {});
      return {
        format: 'rotation-data-export',
        version: 1,
        exportedAt: ctx.iso(),
        notes: [
          'Everything Rotation stores about your account in this browser.',
          'Photos are included as data URLs. Catalog facts, retailer offers and other people’s data are not included.',
          'Clicks are stored under a pseudonymous id (analyticsId), not your account id.',
        ],
        account: omit(user, ['passwordHash', 'salt']),
        profile: profile ?? null,
        owned,
        wishlist,
        photos,
        matchJobs,
        recRequests,
        feedback,
        stylistRequests: requests,
        stylistRecs,
        stylistAssignments,
        corrections,
        clicks,
        conversions,
        sessions: sessions.map((s) => ({ createdAt: s.createdAt, expiresAt: s.expiresAt, current: s.token === ctx.token })),
        activity: activity.sort((a, b) => a.at.localeCompare(b.at)),
        accessLog: accessLog.sort((a, b) => a.at.localeCompare(b.at)),
      };
    },
  },

  /**
   * Deletes the account and every private record and photo. args: { confirm: 'DELETE' }
   * Removes items, wishlist, photos, match jobs, recommendation requests, feedback, stylist
   * requests, recommendations and assignments, corrections the person filed, idempotency
   * entries, sessions (signing out everywhere), clicks under the analyticsId and audit rows
   * about them, then the account.
   * Demo accounts are reset instead of removed: after the same removal the demo seed runs again
   * with force, which restores every demo account's starting data. That resets the whole demo,
   * including changes made in the other demo accounts.
   * result: { ok: true, reset: boolean, removed: { [store]: count } }
   */
  deleteMyAccount: {
    auth: 'any',
    async run(ctx, { confirm } = {}) {
      if (confirm !== 'DELETE') throw invalid({ confirm: 'Type DELETE to confirm' }, 'Type DELETE in capital letters to confirm.');
      const user = await ctx.db.get('users', ctx.actor.id);
      if (!user) throw new ApiError('not_found', 'This account no longer exists. Sign in again.');
      const removed = await removeAccountData(ctx, user);
      await ctx.db.delete('users', user.id);
      if (user.demo) {
        // The seed re-creates the account with its original id and a new analyticsId.
        await seedDemo({ db: ctx.db, clock: ctx.clock, catalog: await ctx.catalog(), force: true });
        await ctx.metric('demo_reset', {});
        return { ok: true, reset: true, removed };
      }
      await ctx.metric('account_deleted', { role: user.role });
      return { ok: true, reset: false, removed };
    },
  },
};
