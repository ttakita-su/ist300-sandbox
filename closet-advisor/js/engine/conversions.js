// Conversion reporting. Networks send status updates per conversion (pending -> approved -> paid,
// or reversed after a cancellation or refund), often more than once. Reconciliation keeps the
// latest update per conversion; clicks are counted separately and never become revenue.
// See docs/affiliate.md.
import { seededRandom } from '../lib/ids.js';

export const CONVERSION_STATUSES = ['pending', 'approved', 'reversed', 'paid'];

// Lifecycle order, used to break ties between updates sent with the same timestamp.
const RANK = { pending: 0, approved: 1, paid: 2, reversed: 3 };

const amountOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const timeOf = (e) => {
  const t = Date.parse(e.updatedAt ?? e.occurredAt ?? '');
  return Number.isFinite(t) ? t : 0;
};

function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object' || !raw.eventId || !CONVERSION_STATUSES.includes(raw.status)) return null;
  return {
    id: raw.id ?? null,
    network: raw.network ?? null,
    eventId: String(raw.eventId),
    clickRef: raw.clickRef ?? null,
    status: raw.status,
    reason: raw.reason ?? null,
    orderAmountMinor: amountOrNull(raw.orderAmountMinor),
    commissionMinor: amountOrNull(raw.commissionMinor),
    currency: raw.currency ?? null,
    occurredAt: raw.occurredAt ?? null,
    updatedAt: raw.updatedAt ?? raw.occurredAt ?? null,
    demo: Boolean(raw.demo),
  };
}

const emptyTotals = () =>
  Object.fromEntries(CONVERSION_STATUSES.map((s) => [s, { count: 0, orderAmountMinor: 0, commissionMinor: 0, unknownAmounts: 0 }]));

/**
 * Deduplicates conversion events by network + eventId, keeping the latest status update, and
 * totals the result by status.
 * - Exact repeats (same status, time and amounts) count as duplicates.
 * - A refund is either a reversal (status 'reversed', reason 'refund') or a later update with
 *   lower amounts (partial refund); the latest update wins either way.
 * - A later update that moves backwards (paid -> pending) is kept but listed in `anomalies`.
 * - Mixed currencies can't be summed, so amounts become null; unknown amounts are never 0.
 * @param {any[]} events conversion records (ARCHITECTURE.md 4.3), optionally with updatedAt and reason
 */
export function reconcileConversions(events = []) {
  const byConversion = new Map();
  let ignored = 0;
  for (const raw of events ?? []) {
    const event = normalizeEvent(raw);
    if (!event) {
      ignored += 1;
      continue;
    }
    const key = `${event.network ?? ''}\u0000${event.eventId}`;
    if (!byConversion.has(key)) byConversion.set(key, []);
    byConversion.get(key).push(event);
  }

  let duplicates = 0;
  const anomalies = [];
  const conversions = [];
  for (const updates of byConversion.values()) {
    const seen = new Set();
    const unique = updates.filter((u) => {
      const sig = `${u.status}|${timeOf(u)}|${u.orderAmountMinor}|${u.commissionMinor}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
    duplicates += updates.length - unique.length;
    unique.sort((a, b) => timeOf(a) - timeOf(b) || RANK[a.status] - RANK[b.status]);
    for (let i = 1; i < unique.length; i++) {
      const from = unique[i - 1].status;
      const to = unique[i].status;
      if (from !== 'reversed' && to !== 'reversed' && RANK[to] < RANK[from]) {
        anomalies.push({ eventId: unique[i].eventId, from, to, at: unique[i].updatedAt });
      }
    }
    const latest = unique[unique.length - 1];
    const first = unique[0];
    conversions.push({
      ...latest,
      occurredAt: first.occurredAt ?? latest.occurredAt,
      updates: unique.length,
      history: unique.map((u) => ({ status: u.status, at: u.updatedAt, commissionMinor: u.commissionMinor })),
      adjusted: unique.some((u) => u.commissionMinor !== latest.commissionMinor || u.orderAmountMinor !== latest.orderAmountMinor),
      refunded: latest.reason === 'refund' || (latest.status !== 'reversed' && unique.some((u) => (u.orderAmountMinor ?? 0) > (latest.orderAmountMinor ?? 0))),
    });
  }
  conversions.sort((a, b) => timeOf(b) - timeOf(a) || a.eventId.localeCompare(b.eventId));

  const currencies = new Set(conversions.map((c) => c.currency).filter(Boolean));
  const mixed = currencies.size > 1;
  const totals = emptyTotals();
  for (const c of conversions) {
    const t = totals[c.status];
    t.count += 1;
    if (c.orderAmountMinor == null || c.commissionMinor == null) t.unknownAmounts += 1;
    t.orderAmountMinor += c.orderAmountMinor ?? 0;
    t.commissionMinor += c.commissionMinor ?? 0;
  }
  if (mixed) {
    for (const t of Object.values(totals)) {
      t.orderAmountMinor = null;
      t.commissionMinor = null;
    }
  }
  const earned = mixed ? null : totals.approved.commissionMinor + totals.paid.commissionMinor;
  return {
    conversions,
    totals,
    count: conversions.length,
    currency: mixed ? null : [...currencies][0] ?? 'USD',
    mixedCurrencies: mixed,
    // Only approved and paid commission is earned; pending can still be reversed.
    earnedMinor: earned,
    refunds: conversions.filter((c) => c.refunded).length,
    duplicates,
    ignored,
    anomalies,
    demo: conversions.some((c) => c.demo),
  };
}

/**
 * Keeps clicks and revenue apart for the admin report. A click is a visit to a retailer, never
 * a purchase or revenue. Without a conversion report, revenue is unknown (null), not zero.
 * @param {{ clicks: any[], report?: ReturnType<typeof reconcileConversions> | { connected: false } | null }} input
 */
export function summarize({ clicks = [], report = null } = {}) {
  const tracked = clicks.filter((c) => c.tracked).length;
  const perRetailer = new Map();
  for (const c of clicks) perRetailer.set(c.retailerId, (perRetailer.get(c.retailerId) ?? 0) + 1);
  const byRetailer = [...perRetailer].map(([retailerId, count]) => ({ retailerId, count })).sort((a, b) => b.count - a.count || String(a.retailerId).localeCompare(String(b.retailerId)));

  const connected = Boolean(report && report.connected !== false && Array.isArray(report.conversions));
  const refs = new Set(clicks.map((c) => c.clickRef));
  const conversions = connected ? report.conversions : [];
  const attributed = conversions.filter((c) => c.clickRef && refs.has(c.clickRef)).length;
  const t = connected ? report.totals : null;
  return {
    clicks: { total: clicks.length, tracked, untracked: clicks.length - tracked, byRetailer },
    connected,
    demo: connected ? Boolean(report.demo) : false,
    conversions: connected
      ? {
          total: conversions.length,
          byStatus: Object.fromEntries(CONVERSION_STATUSES.map((s) => [s, t[s].count])),
          attributed,
          unattributed: conversions.length - attributed,
        }
      : null,
    revenue: connected
      ? {
          currency: report.currency,
          earnedMinor: report.earnedMinor,
          approvedMinor: t.approved.commissionMinor,
          paidMinor: t.paid.commissionMinor,
          pendingMinor: t.pending.commissionMinor,
          reversedMinor: t.reversed.commissionMinor,
        }
      : null,
    notes: [
      'Clicks are visits to retailers. They are not purchases and never count as revenue.',
      connected
        ? 'Only approved and paid commission counts as earned. Pending commission can still be reversed.'
        : 'No affiliate network is connected, so revenue is unknown.',
    ],
  };
}

const DEMO_ORDER_AMOUNTS = [8400, 11000, 13000, 16500, 19800, 36000, 49500];
const DEMO_RATE = 0.06;

/** The first in-stock price for the clicked offer, so demo orders look like what was clicked. */
function offerPrice(catalog, offerId) {
  const offer = catalog?.offers?.get?.(offerId);
  if (!offer) return null;
  if (Array.isArray(offer.sizes)) {
    const entry = offer.sizes.find((s) => s.stock !== 'out_of_stock') ?? offer.sizes[0];
    return amountOrNull(entry?.priceMinor);
  }
  return amountOrNull(offer.priceMinor);
}

/**
 * Generates labeled demo conversion events for "Load demo report". Every event has demo: true.
 * The set always includes a paid conversion, an approved one, a reversal after a refund, a
 * partial refund and a duplicated update, so reconciliation has something to show. Tracked
 * clicks are used first; synthetic demo click references fill in when there are too few.
 * Ids are derived from the seed, so loading the same demo twice replaces rather than adds.
 * @param {any[]} clicks click records (only tracked clicks can be attributed by a network)
 * @param {{ seed?: number, now?: number, catalog?: any }} [opts]
 * @returns {any[]} conversion records (ARCHITECTURE.md 4.3) with updatedAt and reason
 */
export function demoConversionEvents(clicks = [], { seed = 1, now = Date.now(), catalog = null } = {}) {
  const random = seededRandom(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const plans = [
    { steps: ['pending', 'approved', 'paid'] },
    { steps: ['pending', 'approved'] },
    { steps: ['pending', 'reversed'], reason: 'refund' },
    { steps: ['pending', 'approved', 'approved'], partialRefund: true },
    { steps: ['pending'], duplicate: true },
  ];
  const tracked = clicks.filter((c) => c && c.tracked && c.clickRef).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const events = [];
  let n = 0;
  plans.forEach((plan, i) => {
    const click = tracked[i] ?? null;
    const clickedAt = click ? Date.parse(click.createdAt) : now - (30 - i * 5) * 86400000;
    const start = Math.min(clickedAt + 20 * 60000, now);
    // Spread the updates between the purchase and now, so nothing is dated in the future.
    const span = Math.max(0, Math.min(now - start, 21 * 86400000));
    const order = (click && offerPrice(catalog, click.offerId)) ?? pick(DEMO_ORDER_AMOUNTS);
    const eventId = `demo-${seed}-${i + 1}`;
    plan.steps.forEach((status, step) => {
      const refunded = plan.partialRefund && step === plan.steps.length - 1;
      const orderAmountMinor = refunded ? Math.round(order / 2) : order;
      const record = {
        id: `conv_demo_${seed}_${(n += 1)}`,
        network: click?.networkId ?? 'demo-network',
        eventId,
        clickRef: click?.clickRef ?? `c_demo${String(seed).padStart(4, '0')}${i + 1}`,
        status,
        reason: status === 'reversed' ? plan.reason ?? 'cancelled' : refunded ? 'partial_refund' : null,
        orderAmountMinor,
        commissionMinor: Math.round(orderAmountMinor * DEMO_RATE),
        currency: 'USD',
        occurredAt: new Date(start).toISOString(),
        updatedAt: new Date(start + Math.round((span * step) / Math.max(1, plan.steps.length))).toISOString(),
        demo: true,
      };
      events.push(record);
      // Networks resend updates; the copy has a new record id but the same content.
      if (plan.duplicate) events.push({ ...record, id: `conv_demo_${seed}_${(n += 1)}` });
    });
  });
  return events;
}
