// Color-pairing relations between named colors (js/data/colors.js). These are style
// suggestions drawn from common dressing conventions, not facts about a product, so every
// sentence is phrased as advice ("a classic pairing", "tends to suit", "can compete").
import { colorFamily, colorLabel, labOf, deltaE } from '../data/colors.js';

/** Relation kinds, strongest first. 'clash' is a soft negative; 'none' means no opinion. */
export const HARMONY_KINDS = ['classic_pair', 'earth_palette', 'metal', 'neutral_base', 'tonal', 'contrast_accent', 'clash', 'none'];

/** A palette relation must reach this score before recommendations call it a pairing. */
export const PAIRING_THRESHOLD = 0.45;

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const pairSet = (pairs) => new Set(pairs.map(([a, b]) => pairKey(a, b)));

// Pairings that menswear and streetwear guides keep coming back to.
const CLASSIC = pairSet([
  ['navy', 'olive'], ['navy', 'grey'], ['navy', 'light-grey'], ['navy', 'tan'], ['navy', 'khaki'],
  ['navy', 'white'], ['navy', 'off-white'], ['navy', 'bone'], ['navy', 'camel'], ['navy', 'brown'],
  ['navy', 'burgundy'], ['navy', 'light-blue'], ['navy', 'rust'], ['navy', 'gum'],
  ['grey', 'olive'], ['grey', 'white'], ['grey', 'black'], ['grey', 'burgundy'], ['grey', 'light-blue'],
  ['grey', 'camel'], ['grey', 'forest'], ['grey', 'pink'],
  ['charcoal', 'white'], ['charcoal', 'off-white'], ['charcoal', 'olive'], ['charcoal', 'light-blue'],
  ['charcoal', 'burgundy'], ['charcoal', 'camel'],
  ['black', 'white'], ['black', 'off-white'], ['black', 'light-grey'], ['black', 'camel'], ['black', 'gum'],
  ['brown', 'olive'], ['brown', 'off-white'], ['brown', 'bone'], ['brown', 'light-blue'], ['brown', 'white'],
  ['white', 'olive'], ['white', 'khaki'], ['white', 'tan'], ['white', 'light-blue'], ['white', 'gum'], ['white', 'forest'],
  ['off-white', 'olive'], ['bone', 'olive'], ['off-white', 'gum'],
  ['khaki', 'light-blue'], ['khaki', 'forest'], ['tan', 'light-blue'], ['camel', 'white'], ['camel', 'off-white'],
  ['forest', 'tan'], ['forest', 'navy'], ['burgundy', 'olive'],
]);

// Mild clashes: near-misses that read as a mistake, or loud colors that compete.
const NEAR_MISS = pairSet([['navy', 'black'], ['brown', 'black'], ['olive', 'green'], ['teal', 'green'], ['navy', 'blue']]);
const COMPETING = pairSet([
  ['red', 'pink'], ['red', 'orange'], ['orange', 'pink'], ['green', 'red'], ['purple', 'orange'],
  ['mustard', 'pink'], ['rust', 'pink'], ['purple', 'mustard'],
]);

const EARTH_EXTRA = new Set(['rust', 'mustard']);
const ACCENTS = new Set(['red', 'orange', 'yellow', 'mustard', 'pink', 'purple', 'teal', 'green', 'blue', 'rust', 'burgundy']);
const WARM_FRIENDLY = new Set(['off-white', 'bone', 'navy', 'black', 'white']);

const isMetal = (name) => String(colorFamily(name) ?? '').startsWith('metal');
const isNeutralName = (name) => ['light-neutral', 'mid-neutral', 'dark-neutral'].includes(colorFamily(name));
const isEarth = (name) => colorFamily(name) === 'earth' || EARTH_EXTRA.has(name);
const word = (name) => colorLabel(name).toLowerCase();
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function rel(kind, strength, sentence) {
  return { kind, strength, sentence };
}

function metalRelation(metal, other) {
  const cool = colorFamily(metal) === 'metal-cool';
  if (isMetal(other)) {
    const sameTemp = colorFamily(other) === colorFamily(metal);
    return sameTemp
      ? rel('tonal', 0.6, `${cap(word(metal))} and ${word(other)} make an easy tonal pairing`)
      : rel('clash', 0.3, `Mixed metals like ${word(metal)} and ${word(other)} are a bolder choice`);
  }
  const family = colorFamily(other);
  const palette = cool ? 'cool and neutral colors' : 'warm and earth tones';
  const suits = cool ? isNeutralName(other) || family === 'cool' : isEarth(other) || family === 'warm';
  if (suits) return rel('metal', 0.7, `${cap(word(metal))} tends to suit ${palette} like ${word(other)}`);
  // Warm metals also read well against a few cool neutrals (gold on navy or black).
  if (!cool && WARM_FRIENDLY.has(other)) return rel('metal', 0.65, `${cap(word(metal))} tends to sit well against ${word(other)}`);
  return rel('metal', 0.3, `${cap(word(metal))} can work with ${word(other)}, though it usually suits ${palette} more`);
}

/**
 * The pairing relation between two named colors.
 * @param {string} a color name (the suggested item's color; named first in sentences)
 * @param {string} b color name (the person's item)
 * @returns {{ kind: string, strength: number, sentence: string|null }} strength is 0..1; for
 *   'clash' it is how strongly the colors compete, so treat it as a negative (harmonyScore).
 */
export function harmony(a, b) {
  if (!a || !b || !labOf(a) || !labOf(b)) return rel('none', 0, null);
  if (a === b) return rel('tonal', 0.5, `Matching ${word(a)} tones give a tonal look`);
  const key = pairKey(a, b);
  if (NEAR_MISS.has(key)) return rel('clash', 0.35, `${cap(word(a))} and ${word(b)} can look like a near-miss when worn together`);
  if (COMPETING.has(key)) return rel('clash', 0.35, `${cap(word(a))} and ${word(b)} can compete with each other`);
  if (isMetal(a)) return metalRelation(a, b);
  if (isMetal(b)) return metalRelation(b, a);
  if (CLASSIC.has(key)) return rel('classic_pair', 0.9, `${cap(word(a))} and ${word(b)} are a classic pairing`);
  if (isEarth(a) && isEarth(b)) return rel('earth_palette', 0.7, `${cap(word(a))} and ${word(b)} sit together in an earth-tone palette`);

  const famA = colorFamily(a);
  const famB = colorFamily(b);
  const close = deltaE(labOf(a), labOf(b)) < 22;
  if ((famA === famB && famA !== 'warm') || close) {
    return rel('tonal', 0.55, `${cap(word(a))} and ${word(b)} make an easy tonal pairing`);
  }
  const nA = isNeutralName(a);
  const nB = isNeutralName(b);
  if (nA && nB) return rel('neutral_base', 0.5, `${cap(word(a))} and ${word(b)} are easy neutrals together`);
  if (nA || nB) {
    const neutral = nA ? a : b;
    const other = nA ? b : a;
    if (ACCENTS.has(other)) return rel('contrast_accent', 0.55, `${cap(word(other))} adds a contrast accent against ${word(neutral)}`);
    return rel('neutral_base', 0.6, `${cap(word(neutral))} is an easy neutral to wear with ${word(other)}`);
  }
  return rel('none', 0, null);
}

/** Signed value of a relation: positive pairings help, clashes count against. */
export function harmonyScore(relation) {
  if (!relation) return 0;
  return relation.kind === 'clash' ? -relation.strength : relation.strength;
}

function significant(colors) {
  const list = (colors ?? []).filter((c) => c && labOf(c.name)).map((c) => ({ name: c.name, weight: c.weight ?? 1 }));
  const merged = new Map();
  for (const c of list) merged.set(c.name, (merged.get(c.name) ?? 0) + c.weight);
  const sorted = [...merged.entries()].map(([name, weight]) => ({ name, weight })).sort((x, y) => y.weight - x.weight || x.name.localeCompare(y.name));
  const total = sorted.reduce((s, c) => s + c.weight, 0) || 1;
  const normalized = sorted.map((c) => ({ ...c, weight: c.weight / total }));
  const main = normalized.filter((c) => c.weight >= 0.15).slice(0, 3);
  return main.length ? main : normalized.slice(0, 1);
}

/**
 * Pairing relation between two palettes (variant colors with weights). Weighs every pair of
 * significant colors; the sentence comes from the pair that contributes most.
 * @param {Array<{ name: string, weight?: number }>} colorsA suggested item
 * @param {Array<{ name: string, weight?: number }>} colorsB the person's item
 * @returns {{ kind: string, strength: number, score: number, sentence: string|null, colors: string[] }}
 *   score is the weighted signed value (-1..1) used for ranking.
 */
export function paletteHarmony(colorsA, colorsB) {
  const A = significant(colorsA);
  const B = significant(colorsB);
  if (!A.length || !B.length) return { kind: 'none', strength: 0, score: 0, sentence: null, colors: [] };
  let total = 0;
  let weightSum = 0;
  let bestPositive = null;
  let worstClash = null;
  for (const a of A) {
    for (const b of B) {
      const r = harmony(a.name, b.name);
      const pw = a.weight * b.weight;
      total += pw * harmonyScore(r);
      weightSum += pw;
      const contribution = pw * r.strength;
      if (r.kind === 'clash') {
        if (!worstClash || contribution > worstClash.contribution) worstClash = { r, a: a.name, b: b.name, contribution };
      } else if (r.kind !== 'none' && (!bestPositive || contribution > bestPositive.contribution)) {
        bestPositive = { r, a: a.name, b: b.name, contribution };
      }
    }
  }
  const score = weightSum ? total / weightSum : 0;
  const pick = score < 0 ? worstClash : bestPositive ?? worstClash;
  if (!pick) return { kind: 'none', strength: 0, score, sentence: null, colors: [] };
  return { kind: pick.r.kind, strength: pick.r.strength, score, sentence: pick.r.sentence, colors: [pick.a, pick.b] };
}

/** Lab closeness of two named colors, 1 for the same color, 0 at a clear difference. */
export function colorCloseness(a, b) {
  if (a === b) return 1;
  const la = labOf(a);
  const lb = labOf(b);
  if (!la || !lb) return 0;
  return Math.max(0, 1 - deltaE(la, lb) / 40);
}

function directedSimilarity(from, to) {
  const total = from.reduce((s, c) => s + (c.weight ?? 1), 0) || 1;
  let sum = 0;
  for (const c of from) {
    let best = 0;
    for (const d of to) best = Math.max(best, colorCloseness(c.name, d.name));
    sum += (c.weight ?? 1) * best;
  }
  return sum / total;
}

/**
 * How alike two palettes look (0..1), ignoring which part each color is on. Used for
 * lookalike checks and "similar color" ranking, never as a pairing claim.
 */
export function paletteSimilarity(colorsA, colorsB) {
  const A = (colorsA ?? []).filter((c) => c && labOf(c.name));
  const B = (colorsB ?? []).filter((c) => c && labOf(c.name));
  if (!A.length || !B.length) return 0;
  return (directedSimilarity(A, B) + directedSimilarity(B, A)) / 2;
}

/**
 * Part-by-part similarity for two versions of the same product (upper vs upper, dial vs dial).
 * Returns the parts whose colors differ so explanations can say exactly what changes.
 * @returns {{ similarity: number, differingRoles: string[] }}
 */
export function roleSimilarity(colorsA, colorsB) {
  const A = (colorsA ?? []).filter((c) => c && labOf(c.name));
  const B = (colorsB ?? []).filter((c) => c && labOf(c.name));
  if (!A.length || !B.length) return { similarity: 0, differingRoles: [] };
  const differing = new Set();
  const directed = (from, to, record) => {
    const total = from.reduce((s, c) => s + (c.weight ?? 1), 0) || 1;
    let sum = 0;
    for (const c of from) {
      const same = to.find((d) => d.role && d.role === c.role);
      const closeness = same ? colorCloseness(c.name, same.name) : Math.max(0, ...to.map((d) => colorCloseness(c.name, d.name)));
      if (record && same && same.name !== c.name && c.role) differing.add(c.role);
      sum += (c.weight ?? 1) * closeness;
    }
    return sum / total;
  };
  const similarity = (directed(A, B, true) + directed(B, A, false)) / 2;
  return { similarity, differingRoles: [...differing] };
}

/** Color names grouped the way people talk about them (used by request parsing too). */
export const COLOR_GROUPS = {
  earth: ['olive', 'khaki', 'tan', 'brown', 'rust'],
  neutral: ['white', 'off-white', 'bone', 'light-grey', 'grey', 'charcoal', 'black', 'navy'],
};
