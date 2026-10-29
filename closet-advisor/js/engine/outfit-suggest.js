// Suggested outfits: combinations of the person's own active items, never catalog fill-ins.
//
// An outfit is a top, a bottom and shoes, with an optional jacket over the top; a jacket stands
// in for the top only when there's no usable top. At most one watch is added, and only when it
// clashes with nothing. Combinations are dropped when two pieces clash, when no two clothing or
// shoe pieces pair by color, or when a saved outfit already holds every clothing and shoe piece.
// Every sentence comes from a relation computed in harmony.js or from catalog style tags.
import { itemSubject, outfitPart, baseName, fullName } from './recommend.js';
import { paletteHarmony, PAIRING_THRESHOLD } from './harmony.js';
import { outfitPairDetail, outfitStyleDetail, typeWord } from './explain.js';
import { STYLE_TAGS } from '../data/schema.js';
import { colorLabel } from '../data/colors.js';

/** Outfit parts, head to toe; suggestions list item ids in this order. */
export const OUTFIT_PARTS = ['top', 'outer', 'bottom', 'feet', 'wrist'];

/**
 * perPart: items per part combined after pruning (keeps big closets fast); maxRepeats: how many
 * suggestions a core item may join while other combinations still qualify.
 */
export const SUGGEST_RULES = Object.freeze({ perPart: 8, maxRepeats: 2, defaultLimit: 6, maxLimit: 12 });

const CORE = ['top', 'outer', 'bottom', 'feet'];
const ORDER = Object.fromEntries(OUTFIT_PARTS.map((p, i) => [p, i]));

const round4 = (v) => Math.round(v * 1e4) / 1e4;
// Oldest first, as recommend.js orders the person's items.
const byCreated = (a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id));
const byScore = (a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** The heaviest color of an item, as a lowercase label ("navy", "light grey"). */
function mainColor(subject) {
  const weights = new Map();
  for (const c of subject.colors) weights.set(c.name, (weights.get(c.name) ?? 0) + (c.weight ?? 1));
  const [first] = [...weights.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return colorLabel(first[0]).toLowerCase();
}

function pairsOf(list, pair) {
  const out = [];
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) out.push(pair(list[i], list[j]));
  return out;
}

/**
 * Ranked outfit suggestions from one person's items.
 * @param {{ catalog: any, owned: any[], saved?: string[][], limit?: number }} input
 *   owned: all of the person's ownedItem records (archived ones are skipped); saved: each saved
 *   outfit's itemIds; limit: 1-12, default 6.
 * @returns {{ suggestions: { key: string, name: string, itemIds: string[], reasons: string[], score: number }[],
 *   missing: ('top'|'bottom'|'feet')[], emptyReason: null|'missing'|'all_saved'|'no_pairs',
 *   leftOut: { noType: number, noColors: number } }}
 */
export function suggestOutfits({ catalog, owned = [], saved = [], limit } = {}) {
  const n = Number.parseInt(limit, 10);
  const max = Number.isFinite(n) ? Math.min(SUGGEST_RULES.maxLimit, Math.max(1, n)) : SUGGEST_RULES.defaultLimit;
  // Copies of one catalog version look the same, so they count as one item.
  const look = new Map(owned.map((r) => [r.id, r.variantId ? `v:${r.variantId}` : `i:${r.id}`]));
  const savedSets = saved.map((ids) => new Set((ids ?? []).map((id) => look.get(id) ?? `i:${id}`)));

  const pools = { top: [], outer: [], bottom: [], feet: [], wrist: [] };
  const leftOut = { noType: 0, noColors: 0 };
  const seen = new Set();
  for (const record of owned.filter((r) => !r.archivedAt).sort(byCreated)) {
    const lk = look.get(record.id);
    if (seen.has(lk)) continue;
    seen.add(lk);
    const subject = itemSubject(catalog, record, 'owned');
    const part = outfitPart(subject.category, subject.type);
    // We can't know which watch a strap is on, so straps are never suggested.
    if (part === 'strap') continue;
    if (!part) {
      leftOut.noType += 1;
      continue;
    }
    if (!subject.colors.length) {
      leftOut.noColors += 1;
      continue;
    }
    pools[part].push({ ...subject, part, look: lk });
  }

  const missing = [];
  if (!pools.top.length && !pools.outer.length) missing.push('top');
  if (!pools.bottom.length) missing.push('bottom');
  if (!pools.feet.length) missing.push('feet');
  if (missing.length) return { suggestions: [], missing, emptyReason: 'missing', leftOut };

  const products = new Map();
  for (const s of OUTFIT_PARTS.flatMap((p) => pools[p])) if (s.productId) products.set(s.productId, (products.get(s.productId) ?? 0) + 1);
  // Two colorways of one product need their version to tell them apart.
  const nameOf = (s) => (s.productId && products.get(s.productId) > 1 ? fullName(s) : baseName(s));

  const memo = new Map();
  const pair = (x, y) => {
    const [a, b] = ORDER[x.part] <= ORDER[y.part] ? [x, y] : [y, x];
    const k = `${a.itemId}|${b.itemId}`;
    if (!memo.has(k)) {
      const h = paletteHarmony(a.colors, b.colors);
      const score = round4(h.score);
      memo.set(k, { a, b, score, sentence: h.sentence, pairing: score >= PAIRING_THRESHOLD && h.kind !== 'clash' && h.kind !== 'none' });
    }
    return memo.get(k);
  };

  // Big closets: keep the items in each part that pair best with everything else.
  const potential = new Map();
  for (const part of OUTFIT_PARTS) {
    const others = CORE.filter((p) => p !== part).flatMap((p) => pools[p]);
    for (const x of pools[part]) potential.set(x.itemId, round4(others.reduce((sum, y) => sum + Math.max(0, pair(x, y).score), 0)));
  }
  for (const part of OUTFIT_PARTS) {
    if (pools[part].length <= SUGGEST_RULES.perPart) continue;
    const keep = new Set(
      pools[part]
        .map((x, i) => ({ x, i }))
        .sort((p, q) => potential.get(q.x.itemId) - potential.get(p.x.itemId) || p.i - q.i)
        .slice(0, SUGGEST_RULES.perPart)
        .map((p) => p.x.itemId),
    );
    pools[part] = pools[part].filter((x) => keep.has(x.itemId));
  }

  const uppers = pools.top.length ? pools.top.flatMap((t) => [[t], ...pools.outer.map((o) => [t, o])]) : pools.outer.map((o) => [o]);
  const candidates = [];
  let covered = 0;
  for (const upper of uppers) {
    for (const bottom of pools.bottom) {
      for (const feet of pools.feet) {
        const core = [...upper, bottom, feet];
        const pairs = pairsOf(core, pair);
        if (pairs.some((p) => p.score < 0) || !pairs.some((p) => p.pairing)) continue;
        // A saved outfit with every clothing and shoe piece (any watch, any extras) covers it.
        if (savedSets.some((set) => core.every((s) => set.has(s.look)))) {
          covered += 1;
          continue;
        }
        candidates.push({
          core,
          upper,
          bottom,
          score: round4(pairs.reduce((sum, p) => sum + p.score, 0) / pairs.length),
          key: core.map((s) => s.itemId).sort().join('+'),
        });
      }
    }
  }
  candidates.sort(byScore);

  // Variety: an item joins at most maxRepeats suggestions unless it's the only one in its part.
  const uses = new Map();
  const chosen = [];
  const take = (c) => {
    c.taken = true;
    chosen.push(c);
    for (const s of c.core) uses.set(s.itemId, (uses.get(s.itemId) ?? 0) + 1);
  };
  const capped = (c) => c.core.some((s) => pools[s.part].length > 1 && (uses.get(s.itemId) ?? 0) >= SUGGEST_RULES.maxRepeats);
  for (const c of candidates) {
    if (chosen.length >= max) break;
    if (!capped(c)) take(c);
  }
  for (const c of candidates) {
    if (chosen.length >= max) break;
    if (!c.taken) take(c);
  }
  chosen.sort(byScore);

  const rank = (list) =>
    list
      .map((p, i) => ({ p, i }))
      .sort((x, y) => y.p.score - x.p.score || x.i - y.i)
      .map((x) => x.p);
  const suggestions = chosen.map((c) => {
    let watch = null;
    let best = -Infinity;
    for (const w of pools.wrist) {
      const scores = c.core.map((s) => pair(s, w).score);
      if (scores.some((v) => v < 0)) continue;
      const m = round4(scores.reduce((a, b) => a + b, 0) / scores.length);
      if (m > best) {
        best = m;
        watch = w;
      }
    }
    const items = watch ? [...c.core, watch] : c.core;
    const first = rank(pairsOf(c.core, pair).filter((p) => p.pairing))[0];
    const reasons = [outfitPairDetail(first.sentence, nameOf(first.a), nameOf(first.b))];
    const named = new Set([first.a.itemId, first.b.itemId]);
    const rest = rank(pairsOf(items, pair).filter((p) => p.pairing && p !== first));
    const second = rest.find((p) => !named.has(p.a.itemId) && !named.has(p.b.itemId)) ?? rest.find((p) => !named.has(p.a.itemId) || !named.has(p.b.itemId));
    if (second) reasons.push(outfitPairDetail(second.sentence, nameOf(second.a), nameOf(second.b)));
    if (items.every((s) => s.styleTags.length)) {
      const tags = STYLE_TAGS.filter((t) => items.every((s) => s.styleTags.includes(t))).slice(0, 2);
      if (tags.length) reasons.push(outfitStyleDetail(tags));
    }
    const lead = c.upper[c.upper.length - 1];
    const name = cap(`${mainColor(lead)} ${typeWord(lead.type)} and ${mainColor(c.bottom)} ${typeWord(c.bottom.type)}`).slice(0, 60);
    return { key: c.key, name, itemIds: items.map((s) => s.itemId), reasons, score: c.score };
  });
  return { suggestions, missing, emptyReason: suggestions.length ? null : covered > 0 ? 'all_saved' : 'no_pairs', leftOut };
}
