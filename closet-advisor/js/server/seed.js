// Demo accounts and their data. Everything here is labeled demo; it is re-created whenever
// DEMO_SEED_VERSION changes or the person resets the demo.
import { newId } from '../lib/ids.js';
import { defaultProfile, makeIdentity, catalogIdentity } from './records.js';

export const DEMO_SEED_VERSION = 'demo-2026-10-14.1';

export const DEMO_ACCOUNTS = [
  {
    id: 'usr_demo_alex',
    displayName: 'Alex Rivera',
    email: 'alex@demo.rotation.example',
    role: 'user',
    blurb: 'Owns white court sneakers, a navy field jacket, grey wool trousers and a steel field watch. Saved olive runners to the wishlist.',
  },
  {
    id: 'usr_demo_sam',
    displayName: 'Sam Okafor',
    email: 'sam@demo.rotation.example',
    role: 'user',
    blurb: 'A second collection, so you can check that accounts never see each other’s items.',
  },
  {
    id: 'usr_demo_jordan',
    displayName: 'Jordan Blake',
    email: 'jordan@demo.rotation.example',
    role: 'stylist',
    blurb: 'Stylist assigned to Alex. Sees only what Alex chooses to share.',
  },
  {
    id: 'usr_demo_riley',
    displayName: 'Riley Park',
    email: 'riley@demo.rotation.example',
    role: 'stylist',
    blurb: 'Stylist with no assigned clients, so no inventory is visible.',
  },
  {
    id: 'usr_demo_morgan',
    displayName: 'Morgan Lee',
    email: 'morgan@demo.rotation.example',
    role: 'admin',
    blurb: 'Admin: catalog imports, match corrections, image sources, offers and provider checks.',
  },
];

const USER_STORES = ['ownedItems', 'wishlistItems', 'photos', 'matchJobs', 'recRequests', 'feedback', 'stylistRequests', 'stylistRecs', 'corrections'];

export const DEMO_ACCOUNT_IDS = new Set(DEMO_ACCOUNTS.map((a) => a.id));

async function wipeUser(db, userId) {
  for (const store of USER_STORES) {
    for (const row of await db.where(store, 'userId', userId)) await db.delete(store, row.id);
  }
  for (const s of await db.where('sessions', 'userId', userId)) await db.delete('sessions', s.token);
  await db.delete('profiles', userId);
  // Rows keyed some other way: retried requests, pseudonymous clicks and the account's audit trail.
  for (const row of await db.all('idempotency')) if (String(row.id).startsWith(`${userId}:`)) await db.delete('idempotency', row.id);
  const user = await db.get('users', userId);
  if (user?.analyticsId) for (const c of await db.where('clicks', 'analyticsId', user.analyticsId)) await db.delete('clicks', c.id);
  for (const a of await db.where('audit', 'actorId', userId)) await db.delete('audit', a.id);
}

function owned({ userId, now, catalog, variantId, details = {}, identity, ownerChanges = [], createdDaysAgo = 30 }) {
  const variant = catalog.variant(variantId);
  if (!variant) throw new Error(`Seed refers to missing variant ${variantId}`);
  const product = catalog.product(variant.productId);
  const created = new Date(now - createdDaysAgo * 86400000).toISOString();
  return {
    id: newId('own'),
    userId,
    createdAt: created,
    updatedAt: created,
    archivedAt: null,
    category: product.category,
    productId: product.id,
    variantId,
    custom: null,
    identity: identity ?? catalogIdentity({ userId, now: now - createdDaysAgo * 86400000, variantId }),
    details: { size: null, condition: null, purchase: null, notes: '', serialNumber: null, ...details },
    ownerChanges,
    photos: { originalId: null, cleanedId: null, labelIds: [] },
    display: 'catalog',
  };
}

function wished({ userId, now, catalog, variantId, reason, intent, desired, targetPriceMinor, createdDaysAgo = 5 }) {
  const variant = catalog.variant(variantId);
  if (!variant) throw new Error(`Seed refers to missing variant ${variantId}`);
  const product = catalog.product(variant.productId);
  const created = new Date(now - createdDaysAgo * 86400000).toISOString();
  return {
    id: newId('wish'),
    userId,
    createdAt: created,
    updatedAt: created,
    status: 'active',
    category: product.category,
    productId: product.id,
    variantId,
    custom: null,
    identity: catalogIdentity({ userId, now: now - createdDaysAgo * 86400000, variantId }),
    reason,
    reasonNote: '',
    intent,
    linkedOwnedIds: [],
    desired,
    targetPriceMinor,
    currency: 'USD',
    sourceUrl: null,
    matchPending: false,
    photos: { originalId: null },
    purchasedOwnedId: null,
  };
}

/**
 * Creates demo accounts and data when the seed version changes.
 * @param {{ db: any, clock: { now: () => number }, catalog: any, force?: boolean }} env
 */
export async function seedDemo({ db, clock, catalog, force = false }) {
  const meta = await db.get('meta', 'demoSeedVersion');
  if (!force && meta?.value === DEMO_SEED_VERSION) return false;
  const now = clock.now();
  const createdAt = new Date(now - 60 * 86400000).toISOString();

  for (const account of DEMO_ACCOUNTS) {
    await wipeUser(db, account.id);
    const existing = await db.get('users', account.id);
    await db.put('users', {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      role: account.role,
      createdAt: existing?.createdAt ?? createdAt,
      analyticsId: existing?.analyticsId ?? newId('anon'),
      demo: true,
    });
  }
  // Only demo assignments are reset; ones an admin made for real accounts stay.
  for (const a of await db.all('stylistAssignments')) {
    if (DEMO_ACCOUNT_IDS.has(a.stylistId) || DEMO_ACCOUNT_IDS.has(a.userId)) await db.delete('stylistAssignments', a.id);
  }

  // Alex: the brief's example collection.
  const alex = 'usr_demo_alex';
  await db.put('profiles', {
    ...defaultProfile(alex),
    onboardedAt: createdAt,
    sizes: { shoe: { value: '10', system: 'US-M' }, top: { value: 'M', system: 'ALPHA' }, bottom: { value: '32x32', system: 'WAIST-INSEAM' } },
    budgets: { sneaker: 15000, watch: 60000, clothing: 20000 },
    styles: ['minimal', 'classic'],
    colorsLiked: ['olive', 'navy', 'grey', 'white'],
    colorsAvoided: [],
    uses: ['everyday', 'work'],
  });
  const alexItems = [
    owned({
      userId: alex,
      now,
      catalog,
      variantId: 'vela-court-low--white-gum',
      createdDaysAgo: 40,
      details: { size: { value: '10', system: 'US-M' }, condition: 'good', purchase: { priceMinor: 11000, currency: 'USD', date: '2025-05-02', from: 'Northline Supply' }, notes: 'Daily pair.' },
    }),
    owned({
      userId: alex,
      now,
      catalog,
      variantId: 'harbor-pine-deck-jacket--navy',
      createdDaysAgo: 34,
      details: { size: { value: 'M', system: 'ALPHA' }, condition: 'like_new' },
    }),
    owned({
      userId: alex,
      now,
      catalog,
      variantId: 'fieldhouse-wool-trouser--grey',
      createdDaysAgo: 28,
      details: { size: { value: '32x32', system: 'WAIST-INSEAM' }, condition: 'good', notes: 'Hemmed with no break.' },
    }),
    owned({
      userId: alex,
      now,
      catalog,
      variantId: 'arden-field--af38-sl-bk',
      createdDaysAgo: 21,
      details: { condition: 'good', purchase: { priceMinor: 45000, currency: 'USD', date: '2024-11-20', from: 'Meridian Time' }, serialNumber: 'A38-118204' },
      identity: makeIdentity({
        retrieval: 'candidate_found',
        resolution: 'identifier_supported',
        variant: 'confirmed',
        evidence: [
          { kind: 'visual', source: 'image_features', detail: 'Dial, case and bracelet colors match the Arden Field' },
          { kind: 'identifier', source: 'user_entered', detail: 'Reference AF38-SL-BK typed from the case back' },
        ],
        confirmedBy: alex,
        confirmedAt: new Date(now - 21 * 86400000).toISOString(),
      }),
    }),
  ];
  await db.bulkPut('ownedItems', alexItems);
  await db.bulkPut('wishlistItems', [
    wished({
      userId: alex,
      now,
      catalog,
      variantId: 'kestrel-runner-2--olive-bone',
      reason: 'like_style',
      intent: 'inspiration',
      desired: { size: { value: '10', system: 'US-M' }, condition: 'new_only', variantFlexible: true },
      targetPriceMinor: 15000,
    }),
  ]);

  // Sam: a second, separate collection.
  const sam = 'usr_demo_sam';
  await db.put('profiles', {
    ...defaultProfile(sam),
    onboardedAt: createdAt,
    sizes: { shoe: { value: '9', system: 'US-M' }, top: { value: 'L', system: 'ALPHA' }, bottom: { value: '32x30', system: 'WAIST-INSEAM' } },
    budgets: { watch: 80000, sneaker: 13000 },
    styles: ['classic', 'dressy'],
    colorsLiked: ['black', 'charcoal', 'brown'],
    uses: ['work', 'formal'],
  });
  await db.bulkPut('ownedItems', [
    owned({ userId: sam, now, catalog, variantId: 'arden-field--af38-sl-cr', createdDaysAgo: 50, details: { condition: 'like_new', purchase: { priceMinor: 46500, currency: 'USD', date: '2025-01-15', from: 'Meridian Time' }, notes: 'Anniversary gift.' } }),
    owned({ userId: sam, now, catalog, variantId: 'vela-court-low--black-white', createdDaysAgo: 18, details: { size: { value: '9', system: 'US-M' }, condition: 'good' } }),
    owned({ userId: sam, now, catalog, variantId: 'fieldhouse-wool-trouser--charcoal', createdDaysAgo: 12, details: { size: { value: '32x30', system: 'WAIST-INSEAM' }, condition: 'new' } }),
  ]);
  await db.bulkPut('wishlistItems', [
    wished({
      userId: sam,
      now,
      catalog,
      variantId: 'arden-field--af40-sl-bk',
      reason: 'want_exact',
      intent: 'exact',
      desired: { size: null, condition: 'new_or_used', variantFlexible: false },
      targetPriceMinor: 45000,
    }),
  ]);

  // Jordan is assigned to Alex by the admin. Riley has no clients.
  await db.put('stylistAssignments', {
    id: newId('asg'),
    stylistId: 'usr_demo_jordan',
    userId: alex,
    assignedBy: 'usr_demo_morgan',
    createdAt,
    endedAt: null,
  });

  await db.put('meta', { key: 'demoSeedVersion', value: DEMO_SEED_VERSION });
  return true;
}
