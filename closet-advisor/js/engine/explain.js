// Deterministic explanations for recommendations and comparisons. Every sentence is built from
// a relation that recommend.js computed (color pairing, shared style, shape, catalog strap
// specs, prices from offers) and names the specific item it relates to. Nothing here invents a
// fact: no percentages, no outfit counts, no wear history, no fit claims beyond catalog specs.
import { money, relative, listJoin } from '../lib/format.js';
import { STYLE_LABEL, TYPE_LABEL } from '../data/schema.js';
import { colorLabel } from '../data/colors.js';

const ATTACHMENT_PHRASE = {
  spring_bar: 'standard spring bars',
  quick_release: 'quick-release spring bars',
};

const cap = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : '');
const period = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);
const unperiod = (text) => text.replace(/[.!?]+$/, '');

/** "minimal and classic" from style tags. */
export function tagPhrase(tags) {
  return listJoin((tags ?? []).map((t) => (STYLE_LABEL[t] ?? t).toLowerCase()));
}

/** "black" or "olive and bone": the colors that carry a palette. */
export function colorPhrase(colors) {
  const list = (colors ?? []).filter((c) => c?.name);
  if (!list.length) return null;
  const merged = new Map();
  for (const c of list) merged.set(c.name, (merged.get(c.name) ?? 0) + (c.weight ?? 1));
  const sorted = [...merged.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = sorted.reduce((s, [, w]) => s + w, 0) || 1;
  const [first, second] = sorted;
  if (!second || first[1] / total >= 0.6 || second[1] / total < 0.2) return colorLabel(first[0]).toLowerCase();
  return `${colorLabel(first[0]).toLowerCase()} and ${colorLabel(second[0]).toLowerCase()}`;
}

/** Lowercase type word: "field jacket", "runner", "dive watch". */
export function typeWord(type) {
  return (TYPE_LABEL[type] ?? type ?? 'item').toLowerCase();
}

/** "your X" for owned items, "the X on your wishlist" for wishlist items, null for catalog seeds. */
function ref(rel) {
  if (!rel.name) return null;
  if (rel.itemType === 'wishlist') return `the ${rel.name} on your wishlist`;
  return `your ${rel.name}`;
}

function shapeClause(f) {
  // Sneakers: "low court shape"; watches: "field watch layout"; clothing: "field jacket cut".
  if (f.category === 'sneaker') return `${f.shape} shape`;
  if (f.category === 'watch') return f.type === 'strap' ? 'strap style' : `${typeWord(f.type)} layout`;
  return `${typeWord(f.type)} cut`;
}

function shapeTail(f) {
  if (f.category === 'watch' && f.type !== 'strap') {
    if (f.dial) return `with a ${f.dial.toLowerCase()} dial`;
    if (f.caseMm) return `in a ${f.caseMm} mm case`;
  }
  return f.colorPhrase ? `in ${f.colorPhrase}` : null;
}

/**
 * One plain sentence about a single computed relation.
 * @param {{ relation: string, itemType: 'owned'|'wishlist'|'variant', name: string|null, facts: any }} rel
 *   name is the person's item as they know it ("Harbor & Pine Deck Field Jacket"); catalog
 *   seeds (a product page) have no name and get sentences that don't name anything.
 */
export function relationDetail(rel) {
  const f = rel.facts ?? {};
  const who = ref(rel);
  switch (rel.relation) {
    case 'color_pairing':
      return who ? `${f.sentence}, so this would sit well with ${who}.` : period(f.sentence);
    case 'style_match':
      return who ? `Shares the ${tagPhrase(f.tags)} style of ${who}.` : `Shares its ${tagPhrase(f.tags)} style.`;
    case 'same_shape': {
      const tail = shapeTail(f);
      const base = who ? `Same ${shapeClause(f)} as ${who}` : `Same ${shapeClause(f)}`;
      return period(tail ? `${base}, ${tail}` : base);
    }
    case 'cheaper_alternative': {
      const amount = money(f.differenceMinor, f.currency);
      return who ? `${amount} less than ${who} at the prices we checked.` : `${amount} less at the prices we checked.`;
    }
    case 'near_duplicate': {
      if (f.identical) return who ? `Same version as ${who}.` : 'Same version.';
      if (f.sameProduct && f.sizeChange) {
        return `Very close to ${who}: only the case size differs (${f.sizeChange.to} mm instead of ${f.sizeChange.from} mm).`;
      }
      if (f.sameProduct && f.differingRoles?.length) {
        const roles = listJoin(f.differingRoles);
        return `Very close to ${who}: only the ${roles} ${f.differingRoles.length > 1 ? 'colors differ' : 'color differs'}.`;
      }
      if (f.sameProduct) return `Looks the same as ${who}.`;
      return `Very close to ${who}: ${f.shape ? `the same ${f.shape} shape` : 'the same kind of item'} in nearly the same colors.`;
    }
    case 'strap_fit': {
      const how = `both ${f.widthMm} mm with ${ATTACHMENT_PHRASE[f.attachment] ?? 'standard spring bars'}, from catalog specs`;
      if (f.direction === 'watch_for_strap') return who ? `${cap(who)} fits it: ${how}.` : `Fits: ${how}.`;
      return who ? `Fits ${who}: ${how}.` : `Fits: ${how}.`;
    }
    case 'wishlist_seed': {
      if (f.basis === 'colorway') return period(`Another colorway of ${who}${f.colorPhrase ? `, in ${f.colorPhrase}` : ''}`);
      if (f.basis === 'shape') return period(`Same ${shapeClause(f)} as ${who}${shapeTail(f) ? `, ${shapeTail(f)}` : ''}`);
      if (f.basis === 'style') return `Shares the ${tagPhrase(f.tags)} style of ${who}.`;
      return `An alternative to ${who}.`;
    }
    default:
      return '';
  }
}

/**
 * The relation and one-sentence detail for a related item that may have several computed
 * relations (an alternative can share a wishlist item's shape and also cost less).
 * @param {Array<{ relation, itemType, name, facts, itemId }>} relations for one item, strongest first
 * @returns {{ relation: string, detail: string }}
 */
export function itemDetail(relations) {
  const [first] = relations;
  const cheaper = relations.find((r) => r.relation === 'cheaper_alternative');
  if (first.relation === 'wishlist_seed' && cheaper) {
    return {
      relation: 'cheaper_alternative',
      detail: `${unperiod(relationDetail(first))}, and ${money(cheaper.facts.differenceMinor, cheaper.facts.currency)} less at the prices we checked.`,
    };
  }
  return { relation: first.relation, detail: relationDetail(first) };
}

/** Shorter follow-up sentence for a second related item ("It also works with your X."). */
function alsoSentence(rel) {
  const who = ref(rel);
  if (!who) return null;
  switch (rel.relation) {
    case 'color_pairing':
    case 'style_match':
      return `It also works with ${who}.`;
    case 'strap_fit':
      return rel.facts?.direction === 'watch_for_strap' ? null : `It also fits ${who}, from catalog specs.`;
    case 'near_duplicate':
      return `It is also very close to ${who}.`;
    default:
      return null;
  }
}

/**
 * The explanation for one recommendation.
 * @param {{
 *   relations: Array<{ relation, itemType, name, facts, itemId }>,   // computed, most important first
 *   price: { status, fromMinor, currency, checkedAt },
 *   now: number,
 *   ceiling?: { minor: number, source: 'request'|'around'|'target'|'wish_price', aroundMinor?: number } | null,
 *   budget?: { minor: number, categoryWord: string } | null,     // profile budget the price fits
 *   preferences?: { requestColors?: string[], requestStyles?: string[], profileStyles?: string[], likedColors?: string[] }
 * }} input
 * @returns {string}
 */
export function explain(input) {
  const relations = input.relations ?? [];
  const why = [];
  let also = null;
  const [primary, ...rest] = relations;
  const priced = input.price && input.price.fromMinor != null && input.price.status !== 'unknown';
  let priceCovered = false;

  if (primary) {
    const cheaper = rest.find((r) => r.relation === 'cheaper_alternative' && r.itemId === primary.itemId);
    if (primary.relation === 'wishlist_seed' && cheaper) {
      // One sentence for both facts about the wishlist item, so it is named once.
      why.push(`${unperiod(relationDetail(primary))}, and ${money(cheaper.facts.differenceMinor, cheaper.facts.currency)} less at the prices we checked.`);
      priceCovered = true;
    } else {
      why.push(relationDetail(primary));
      if (primary.relation === 'cheaper_alternative') priceCovered = true;
    }
    const second = rest.find((r) => r.itemId !== primary.itemId && r.relation !== 'cheaper_alternative' && alsoSentence(r));
    if (second) also = alsoSentence(second);
  } else {
    const prefs = input.preferences ?? {};
    if (prefs.requestColors?.length) why.push(`In ${listJoin(prefs.requestColors.map((c) => colorLabel(c).toLowerCase()))}, as you asked.`);
    else if (prefs.likedColors?.length) {
      why.push(`In ${listJoin(prefs.likedColors.map((c) => colorLabel(c).toLowerCase()))}, ${prefs.likedColors.length > 1 ? 'colors' : 'a color'} you like.`);
    }
    if (prefs.requestStyles?.length) why.push(`${cap(tagPhrase(prefs.requestStyles))} style, as you asked.`);
    else if (prefs.profileStyles?.length) why.push(`Matches the ${tagPhrase(prefs.profileStyles)} style you picked.`);
    // Nothing specific matched: say so rather than invent a reason.
    if (!why.length) {
      why.push(prefs.hasPreferences
        ? "Shown to round out the list; it doesn't closely match the styles or colors you picked."
        : 'A general pick: your profile has no styles or colors yet.');
    }
  }

  const facts = [];
  if (priced && !priceCovered) {
    const c = input.ceiling;
    const currency = input.price.currency;
    if (c?.source === 'around' && c.aroundMinor != null) facts.push(`Close to the ${money(c.aroundMinor, currency)} you mentioned, at the prices we checked.`);
    else if (c?.source === 'target') facts.push(`Within your ${money(c.minor, currency)} target at the prices we checked.`);
    else if (c?.source === 'request') facts.push(`Within your ${money(c.minor, currency)} limit at the prices we checked.`);
    else if (input.budget) facts.push(`Within your ${money(input.budget.minor, currency)} ${input.budget.categoryWord} budget at the prices we checked.`);
  }
  // A stale price is a warning, so it is the last sentence to be dropped for length.
  const stale = input.price?.status === 'stale' && input.price.checkedAt
    ? `Its price was last checked ${relative(input.price.checkedAt, input.now)}, so it may have changed.`
    : null;
  const sentences = [...why, also, ...facts].filter(Boolean);
  const room = stale ? 2 : 3;
  return [...sentences.slice(0, room), stale].filter(Boolean).join(' ');
}
