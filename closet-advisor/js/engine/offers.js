// Offer comparison for one variant (ARCHITECTURE.md 6.1 OffersView). Offers are never merged
// across references, colorways, sizes or conditions; unknown shipping, fees and tax stay unknown;
// rows are ordered by benefit to the person. Commission and affiliate status are never inputs
// to ordering or to the lowest-total claim. Contract notes: docs/affiliate.md.
import { size as sizeLabel, plural, listJoin } from '../lib/format.js';
import { ALPHA_SIZES } from '../data/schema.js';

export const FRESH_HOURS = 24;
export const AGING_HOURS = 12;

/** Shown wherever affiliate links can appear. */
export const AFFILIATE_DISCLOSURE =
  "Rotation may earn a commission from links marked Affiliate. It doesn't change your price or the order of offers.";

const validHours = (hours) => (Number.isFinite(hours) && hours > 0 ? hours : FRESH_HOURS);

/** 'fresh' (< 12h), 'aging' (< freshnessHours), 'stale' (older or unknown). */
export function freshness(lastCheckedAt, now, freshnessHours = FRESH_HOURS) {
  if (!lastCheckedAt) return 'stale';
  const hours = (now - Date.parse(lastCheckedAt)) / 3600000;
  if (!Number.isFinite(hours)) return 'stale';
  // Staleness is checked first so a window shorter than 12 hours still marks old offers stale.
  if (hours >= validHours(freshnessHours)) return 'stale';
  return hours < AGING_HOURS ? 'fresh' : 'aging';
}

/** Matches an offer condition against a wishlist-style preference or an exact condition. */
export function conditionAllowed(offerCondition, wanted) {
  if (!wanted || wanted === 'new_or_used') return true;
  if (wanted === 'new_only') return offerCondition === 'new';
  return offerCondition === wanted;
}

/**
 * The price and stock for one size (or the whole offer when it isn't sized).
 * @returns {{ priceMinor: number|null, stock: string|null, size: any|null }}
 */
export function sizeEntry(offer, size) {
  if (!offer.sizes) return { priceMinor: offer.priceMinor ?? null, stock: offer.stock ?? null, size: null };
  if (!size) {
    const inStock = offer.sizes.filter((s) => s.stock !== 'out_of_stock');
    const pool = inStock.length ? inStock : offer.sizes;
    const cheapest = pool.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a), pool[0]);
    return cheapest ? { priceMinor: cheapest.priceMinor, stock: inStock.length ? 'in_stock' : 'out_of_stock', size: null } : { priceMinor: null, stock: null, size: null };
  }
  const entry = offer.sizes.find((s) => s.value === size.value && s.system === size.system);
  return entry ? { priceMinor: entry.priceMinor, stock: entry.stock, size: { value: entry.value, system: entry.system } } : { priceMinor: null, stock: null, size: null };
}

const amount = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/**
 * Splits an offer's costs into known amounts and unknown parts. A flat shipping or known fee
 * without an amount is unknown, not zero.
 */
function costBreakdown(offer, priceMinor) {
  const price = amount(priceMinor);
  const shipping = offer.shipping?.kind === 'free' ? 0 : offer.shipping?.kind === 'flat' ? amount(offer.shipping.amountMinor) : null;
  const fees = offer.fees?.kind === 'none' ? 0 : offer.fees?.kind === 'known' ? amount(offer.fees.amountMinor) : null;
  const tax = offer.tax?.kind === 'estimate' ? amount(offer.tax.amountMinor) : null;
  const missing = [];
  if (price == null) missing.push('price');
  if (shipping == null) missing.push('shipping');
  if (fees == null) missing.push('fees');
  if (tax == null) missing.push('tax');
  return {
    totalKnownMinor: price == null ? null : price + (shipping ?? 0) + (fees ?? 0) + (tax ?? 0),
    totalComplete: missing.length === 0,
    missing,
    // What can be compared across offers when tax isn't estimated: price, shipping and fees.
    preTaxMinor: price != null && shipping != null && fees != null ? price + shipping + fees : null,
  };
}

/**
 * Known total = price + shipping + fees + tax, only counting parts that are known. Missing
 * parts are listed so the UI never presents an incomplete sum as the total.
 */
export function offerTotal(offer, priceMinor) {
  if (priceMinor == null) return { totalKnownMinor: null, totalComplete: false, missing: ['price'] };
  const { totalKnownMinor, totalComplete, missing } = costBreakdown(offer, priceMinor);
  return { totalKnownMinor, totalComplete, missing };
}

/**
 * Compact price/availability summary used by recommendations.
 * @param {{ offers: any[], retailers: Map<string, any>, size?: any, condition?: string, now: number, freshnessHours?: number }} input
 *   offers must have lastCheckedAt resolved (providers/offers.js)
 * @returns {{ status: 'known'|'stale'|'unknown', fromMinor: number|null, currency: string, offerCount: number,
 *   checkedAt: string|null, retailerName: string|null, offerId: string|null,
 *   availability: 'in_stock_in_size'|'in_stock'|'size_unavailable'|'out_of_stock'|'no_offers' }}
 */
export function summarizeOffers({ offers, retailers, size = null, condition = 'new_or_used', now, freshnessHours = FRESH_HOURS }) {
  const live = offers.filter((o) => o.listingStatus === 'active' && conditionAllowed(o.condition, condition));
  const base = { status: 'unknown', fromMinor: null, currency: 'USD', offerCount: 0, checkedAt: null, retailerName: null, offerId: null };
  if (!live.length) return { ...base, availability: 'no_offers' };

  const priced = [];
  let inStockInSize = false;
  for (const offer of live) {
    const entry = sizeEntry(offer, size);
    if (entry.stock && entry.stock !== 'out_of_stock') inStockInSize = true;
    if (entry.priceMinor != null && entry.stock !== 'out_of_stock') priced.push({ offer, priceMinor: entry.priceMinor });
  }
  const inStockAnySize = live.some((o) => (o.sizes ? o.sizes.some((s) => s.stock !== 'out_of_stock') : o.stock && o.stock !== 'out_of_stock'));
  const sized = Boolean(size) && live.some((o) => o.sizes);

  let availability;
  if (sized) availability = inStockInSize ? 'in_stock_in_size' : inStockAnySize ? 'size_unavailable' : 'out_of_stock';
  else availability = inStockAnySize ? 'in_stock' : 'out_of_stock';

  if (!priced.length) return { ...base, availability };
  const fresh = priced.filter((p) => freshness(p.offer.lastCheckedAt, now, freshnessHours) !== 'stale');
  const pool = fresh.length ? fresh : priced;
  const best = pool.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a), pool[0]);
  return {
    status: fresh.length ? 'known' : 'stale',
    fromMinor: best.priceMinor,
    currency: best.offer.currency ?? 'USD',
    offerCount: pool.length,
    checkedAt: best.offer.lastCheckedAt,
    retailerName: retailers?.get?.(best.offer.retailerId)?.name ?? null,
    offerId: best.offer.id,
    availability,
  };
}

// ---------- compareOffers ----------

const STOCK = ['in_stock', 'low_stock', 'out_of_stock'];
const CONDITION_RANK = { new: 0, used_like_new: 1, used_good: 2, used_fair: 3 };
const isInStock = (stock) => stock === 'in_stock' || stock === 'low_stock';
const stockOrNull = (stock) => (STOCK.includes(stock) ? stock : null);

/** Trims a size and canonicalizes case, keeping its system. Returns null for "no size". */
function normalizeSize(size) {
  if (!size || typeof size !== 'object' || !size.system) return null;
  const raw = String(size.value ?? '').trim();
  if (!raw) return null;
  const value = size.system === 'ALPHA' ? raw.toUpperCase() : size.system === 'WAIST-INSEAM' ? raw.toLowerCase().replace(/\s+/g, '') : raw;
  return { value, system: String(size.system) };
}

const sameSize = (a, b) => Boolean(a && b && a.value === b.value && a.system === b.system);
const sizeKey = (s) => `${s.system}:${s.value}`;

/** Product sizing order first ("8, 8.5, 9"), then natural order for sizes only offers list. */
function sizeComparator(product) {
  const order = new Map((product?.sizing?.sizes ?? []).map((v, i) => [`${product.sizing.system}:${v}`, i]));
  const alpha = (v) => ALPHA_SIZES.indexOf(v);
  return (a, b) => {
    const ia = order.get(sizeKey(a.size)) ?? Infinity;
    const ib = order.get(sizeKey(b.size)) ?? Infinity;
    if (ia !== ib) return ia - ib;
    if (a.size.system !== b.size.system) return a.size.system.localeCompare(b.size.system);
    if (alpha(a.size.value) >= 0 && alpha(b.size.value) >= 0) return alpha(a.size.value) - alpha(b.size.value);
    return a.size.value.localeCompare(b.size.value, 'en', { numeric: true });
  };
}

/**
 * Every size the product comes in or an active listing carries, with how many listings have
 * it in stock. Listings that only carry other sizes count toward those sizes, never this one.
 */
function tallySizes(offers, product) {
  const tally = new Map();
  const slot = (size) => {
    const key = sizeKey(size);
    if (!tally.has(key)) tally.set(key, { size, inStockOffers: new Set() });
    return tally.get(key);
  };
  if (product?.sizing?.system) {
    for (const value of product.sizing.sizes ?? []) slot({ value: String(value), system: product.sizing.system });
  }
  for (const offer of offers) {
    for (const entry of offer.sizes ?? []) {
      const size = normalizeSize(entry);
      if (!size) continue;
      const s = slot(size);
      if (isInStock(entry.stock)) s.inStockOffers.add(offer.id);
    }
  }
  return [...tally.values()]
    .map(({ size, inStockOffers }) => ({ size, offerCount: inStockOffers.size, inStock: inStockOffers.size > 0 }))
    .sort(sizeComparator(product));
}

/**
 * Price and stock of one offer for the chosen size. Without a size, a sized listing shows its
 * lowest in-stock price ("from") and is in stock when any size is.
 * @returns {{ priceMinor: number|null, stock: string|null, size: any|null, listed: boolean }}
 */
function entryFor(offer, wanted) {
  if (!Array.isArray(offer.sizes)) {
    return { priceMinor: amount(offer.priceMinor), stock: stockOrNull(offer.stock), size: null, listed: true };
  }
  if (wanted) {
    const entry = offer.sizes.find((s) => sameSize(normalizeSize(s), wanted));
    if (!entry) return { priceMinor: null, stock: null, size: null, listed: false };
    return { priceMinor: amount(entry.priceMinor), stock: stockOrNull(entry.stock), size: { value: entry.value, system: entry.system }, listed: true };
  }
  const priced = (list) => list.filter((s) => amount(s.priceMinor) != null);
  const cheapest = (list) => (list.length ? list.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a)).priceMinor : null);
  const inStock = offer.sizes.filter((s) => isInStock(s.stock));
  if (inStock.length) return { priceMinor: cheapest(priced(inStock)), stock: 'in_stock', size: null, listed: true };
  const unknown = offer.sizes.some((s) => stockOrNull(s.stock) == null);
  return { priceMinor: cheapest(priced(offer.sizes)), stock: unknown ? null : 'out_of_stock', size: null, listed: true };
}

/**
 * The warranty as the listing states it. A manufacturer warranty is only presented as one when
 * the seller is an authorized dealer; otherwise it can't be relied on, so it reads as unknown
 * with a note. Nothing is filled in when the listing is silent.
 */
function statedWarranty(offer) {
  const w = offer.warranty;
  if (!w || !w.kind) return { warranty: { kind: 'unknown' }, warrantyNote: null };
  if (w.kind === 'manufacturer' && offer.sellerType !== 'authorized_dealer') {
    return {
      warranty: { kind: 'unknown', claimed: 'manufacturer', ...(w.months != null ? { months: w.months } : {}), ...(w.provider ? { provider: w.provider } : {}) },
      warrantyNote: "The listing mentions a manufacturer warranty, but the seller isn't an authorized dealer, so it may not apply. Ask the seller before you buy.",
    };
  }
  return { warranty: { ...w }, warrantyNote: null };
}

function totalLabel(missing) {
  if (missing.includes('price')) return 'Price not listed';
  if (!missing.length) return 'Total';
  return `Total before ${listJoin(missing)}`;
}

function buildRow(offer, retailer, entry, env, reason = null) {
  const costs = costBreakdown(offer, entry.priceMinor);
  const { warranty, warrantyNote } = statedWarranty(offer);
  return {
    offerId: offer.id,
    retailer: { id: retailer.id, name: retailer.name, domain: retailer.domain, kind: retailer.kind },
    affiliate: retailer.affiliate?.status === 'approved',
    sellerType: offer.sellerType ?? null,
    condition: offer.condition,
    includedComponents: Array.isArray(offer.includedComponents) ? [...offer.includedComponents] : null,
    size: entry.size,
    stock: entry.stock,
    priceMinor: entry.priceMinor,
    currency: offer.currency ?? 'USD',
    shipping: offer.shipping ? { ...offer.shipping } : { kind: 'unknown' },
    fees: offer.fees ? { ...offer.fees } : { kind: 'unknown' },
    tax: offer.tax ? { ...offer.tax } : { kind: 'unknown' },
    totalKnownMinor: costs.totalKnownMinor,
    totalComplete: costs.totalComplete,
    missing: costs.missing,
    preTaxMinor: costs.preTaxMinor,
    totalLabel: totalLabel(costs.missing),
    delivery: offer.delivery ? { ...offer.delivery } : null,
    returns: offer.returns ?? null,
    warranty,
    warrantyNote,
    lastCheckedAt: offer.lastCheckedAt ?? null,
    freshness: freshness(offer.lastCheckedAt, env.now, env.freshnessHours),
    listingStatus: offer.listingStatus,
    url: offer.url,
    reason,
  };
}

const stockRank = (r) => (isInStock(r.stock) ? 0 : 1);
const staleRank = (r) => (r.freshness === 'stale' ? 1 : 0);
// 0: shipping and fees known, 1: shipping or fees unknown, 2: no price at all.
const costRank = (r) => (r.priceMinor == null ? 2 : r.preTaxMinor == null ? 1 : 0);
const deliveryDays = (r) => (Number.isFinite(r.delivery?.maxDays) ? r.delivery.maxDays : 1e9);

/**
 * Orders rows by benefit to the person: in stock first, fresh before stale, then comparable
 * totals ascending, then offers with unknown shipping or fees by price, then faster delivery
 * and better condition. Commission and affiliate status are deliberately not inputs.
 * Comparable totals include tax only when every comparable row in the group estimates it.
 * @param {any[]} rows OfferRow[]
 * @returns {any[]} a new, ordered array
 */
export function orderRows(rows) {
  const group = (r) => `${stockRank(r)}:${staleRank(r)}`;
  const basis = new Map();
  for (const key of new Set(rows.map(group))) {
    const comparable = rows.filter((r) => group(r) === key && costRank(r) === 0);
    basis.set(key, comparable.length && comparable.every((r) => r.totalComplete) ? 'total' : 'before_tax');
  }
  const sortAmount = (r) => {
    const rank = costRank(r);
    if (rank === 0) return basis.get(group(r)) === 'total' ? r.totalKnownMinor : r.preTaxMinor;
    return rank === 1 ? r.priceMinor : 0;
  };
  return [...rows].sort(
    (a, b) =>
      stockRank(a) - stockRank(b) ||
      staleRank(a) - staleRank(b) ||
      costRank(a) - costRank(b) ||
      sortAmount(a) - sortAmount(b) ||
      deliveryDays(a) - deliveryDays(b) ||
      (CONDITION_RANK[a.condition] ?? 9) - (CONDITION_RANK[b.condition] ?? 9) ||
      a.retailer.name.localeCompare(b.retailer.name) ||
      a.offerId.localeCompare(b.offerId),
  );
}

/** Listings that could come back (out of stock) before removed ones, then by price. */
function orderUnavailable(rows) {
  const removed = (r) => (r.listingStatus === 'active' ? 0 : 1);
  return [...rows].sort(
    (a, b) =>
      removed(a) - removed(b) ||
      (a.priceMinor ?? Infinity) - (b.priceMinor ?? Infinity) ||
      a.retailer.name.localeCompare(b.retailer.name) ||
      a.offerId.localeCompare(b.offerId),
  );
}

const offersDo = (n) => `${n} ${n === 1 ? "offer doesn't" : "offers don't"}`;

/**
 * The lowest-total claim. It needs at least two in-stock offers checked within the freshness
 * window, all in one currency and all listing shipping and fees. When any of them lacks a tax
 * estimate, totals are compared before tax and the label says so.
 */
function lowestClaim(rows, { needsSize, freshnessHours }) {
  if (!rows.length) return { lowest: null, lowestNote: null };
  if (needsSize) return { lowest: null, lowestNote: 'Choose a size to compare totals.' };
  const inStock = rows.filter((r) => isInStock(r.stock) && r.priceMinor != null);
  const candidates = inStock.filter((r) => r.freshness !== 'stale');
  if (candidates.length < 2) {
    let note;
    if (inStock.length < 2) note = inStock.length ? "Only 1 offer is listed as in stock, so there's nothing to compare it with." : "No offer lists both a price and stock, so totals can't be compared.";
    else if (!candidates.length) note = `No in-stock offer was checked in the last ${freshnessHours} hours, so there's no lowest-total claim.`;
    else note = `Only 1 in-stock offer was checked in the last ${freshnessHours} hours, so there's nothing to compare it with.`;
    return { lowest: null, lowestNote: note };
  }
  if (new Set(candidates.map((r) => r.currency)).size > 1) {
    return { lowest: null, lowestNote: "These offers are in different currencies, so totals can't be compared." };
  }
  const lacking = candidates.filter((r) => r.missing.includes('shipping') || r.missing.includes('fees'));
  if (lacking.length) {
    const ship = lacking.some((r) => r.missing.includes('shipping'));
    const fees = lacking.some((r) => r.missing.includes('fees'));
    const what = ship && fees ? 'shipping or fees' : ship ? 'shipping' : 'fees';
    return { lowest: null, lowestNote: `${offersDo(lacking.length)} list ${what}, so totals can't be compared.` };
  }
  const basis = candidates.every((r) => r.totalComplete) ? 'total' : 'before_tax';
  const value = (r) => (basis === 'total' ? r.totalKnownMinor : r.preTaxMinor);
  const min = Math.min(...candidates.map(value));
  const best = candidates.filter((r) => value(r) === min);
  const what = basis === 'total' ? 'known total' : 'total before tax';
  if (best.length > 1) return { lowest: null, lowestNote: `${best.length} offers tie for the lowest ${what}.` };
  return { lowest: { offerId: best[0].offerId, label: `Lowest ${what} among ${candidates.length} checked offers` }, lowestNote: null };
}

function hiddenSentence(hidden, condition) {
  if (!hidden) return '';
  const what = condition === 'new_only' ? plural(hidden, 'used offer') : plural(hidden, 'other offer');
  return ` ${what} ${hidden === 1 ? 'is' : 'are'} hidden by your condition filter.`;
}

function noticeFor(s) {
  if (!s.listed) return 'None of the retailers Rotation checks list this version right now.';
  if (!s.rows.length) {
    if (!s.unavailable.length && s.hiddenByCondition) {
      const lead = s.condition === 'new_only' ? 'No new offers right now.' : 'No offers in the condition you chose.';
      return lead + hiddenSentence(s.hiddenByCondition, s.condition);
    }
    const lead = s.wanted && s.sized
      ? `No checked offer has ${sizeLabel(s.wanted)} in stock.${s.otherSizes.length ? ' Other sizes are in stock.' : ''}`
      : 'No checked offer is in stock right now.';
    return lead + hiddenSentence(s.hiddenByCondition, s.condition);
  }
  if (s.needsSize) return 'Prices shown are the lowest for any in-stock size. Choose a size to see stock and totals for yours.';
  const stale = s.rows.filter((r) => r.freshness === 'stale').length;
  if (stale) {
    return `${plural(stale, 'offer')} ${stale === 1 ? 'was' : 'were'} last checked more than ${s.freshnessHours} hours ago, so ${stale === 1 ? 'its price' : 'their prices'} may have changed.`;
  }
  return null;
}

function disclosureFor({ retailersChecked, totalRetailers, links }) {
  if (!retailersChecked) return `Rotation checks ${plural(totalRetailers, 'retailer')}. Other stores may still sell this version.`;
  const coverage = `Rotation checked ${plural(retailersChecked, 'retailer')} for this version. Other stores may have different prices or stock.`;
  if (!links.length) return coverage;
  return `${coverage} ${links.some((r) => r.affiliate) ? AFFILIATE_DISCLOSURE : "None of these links earn Rotation a commission."}`;
}

/**
 * Compares the buying options for exactly one variant.
 * @param {{ catalog: any, offers: any[], variantId: string, size?: { value: string, system: string } | null,
 *   condition?: 'new_only'|'new_or_used'|'new'|'used_like_new'|'used_good'|'used_fair', now: number,
 *   freshnessHours?: number }} input offers must have lastCheckedAt resolved (providers/offers.js)
 * @returns {any} OffersView (ARCHITECTURE.md 6.1, additions in docs/affiliate.md)
 */
export function compareOffers(input) {
  const { catalog, variantId, now } = input;
  const freshnessHours = validHours(input.freshnessHours);
  const condition = input.condition ?? 'new_or_used';
  const product = catalog.productOf?.(variantId) ?? null;
  const retailerOf = (id) => catalog.retailer?.(id) ?? catalog.retailers?.get?.(id) ?? null;

  // Exactly this variant: another reference, colorway or size is a different thing to buy.
  const listed = (input.offers ?? []).filter((o) => o && o.variantId === variantId && retailerOf(o.retailerId));
  const retailersChecked = new Set(listed.map((o) => o.retailerId)).size;
  const matching = listed.filter((o) => conditionAllowed(o.condition, condition));
  const active = matching.filter((o) => o.listingStatus === 'active');

  const sized = Boolean(product?.sizing) || listed.some((o) => Array.isArray(o.sizes));
  const sizeOptions = sized ? tallySizes(active, product) : [];
  let wanted = sized ? normalizeSize(input.size) : null;
  // A one-size product needs no choice.
  if (sized && !wanted && sizeOptions.length === 1 && sizeOptions[0].size.system === 'ONE-SIZE') wanted = sizeOptions[0].size;
  const needsSize = sized && !wanted;
  // Only listings that changing the filter would reveal (same size) count as hidden.
  const hiddenByCondition = listed.filter(
    (o) => o.listingStatus === 'active' && !conditionAllowed(o.condition, condition) && entryFor(o, wanted).listed,
  ).length;

  const env = { now, freshnessHours };
  const rows = [];
  const unavailable = [];
  for (const offer of matching) {
    const retailer = retailerOf(offer.retailerId);
    const entry = entryFor(offer, wanted);
    // A listing without the chosen size is for other sizes; it counts in otherSizes instead.
    if (!entry.listed) continue;
    if (offer.listingStatus !== 'active') {
      unavailable.push(buildRow(offer, retailer, entry, env, 'The retailer removed this listing.'));
    } else if (entry.stock === 'out_of_stock') {
      const reason = wanted && Array.isArray(offer.sizes) ? `Out of stock in ${sizeLabel(wanted)}.` : Array.isArray(offer.sizes) ? 'Out of stock in every size.' : 'Out of stock.';
      unavailable.push(buildRow(offer, retailer, entry, env, reason));
    } else {
      rows.push(buildRow(offer, retailer, entry, env));
    }
  }

  const ordered = orderRows(rows);
  const otherSizes = wanted && sized && !ordered.some((r) => isInStock(r.stock))
    ? sizeOptions.filter((o) => o.inStock && !sameSize(o.size, wanted))
    : [];
  const { lowest, lowestNote } = lowestClaim(ordered, { needsSize, freshnessHours });
  // Links the person can follow from this view; removed listings have none.
  const links = [...rows, ...unavailable].filter((r) => r.listingStatus === 'active');

  return {
    variantId,
    size: wanted,
    condition,
    generatedAt: new Date(now).toISOString(),
    retailersChecked,
    rows: ordered,
    otherSizes,
    hiddenByCondition,
    unavailable: orderUnavailable(unavailable),
    lowest,
    lowestNote,
    disclosure: disclosureFor({ retailersChecked, totalRetailers: catalog.retailers?.size ?? 0, links }),
    notice: noticeFor({ listed: listed.length, rows: ordered, unavailable, hiddenByCondition, condition, wanted, sized, otherSizes, needsSize, freshnessHours }),
    needsSize,
    sizeOptions,
    freshnessHours,
  };
}
