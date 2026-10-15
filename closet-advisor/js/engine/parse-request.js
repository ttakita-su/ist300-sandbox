// Rule-based reading of a typed request ("olive sneakers under $150 for work"). No network and
// no model: a vocabulary of categories, types, colors, styles, uses, materials and brands, plus
// patterns for prices and sizes. Every piece that was understood becomes a chip so the person
// can see and edit how the text was read; words that matched nothing come back as unparsed.
import { CATEGORY_LABEL, STYLE_LABEL, TYPE_LABEL, PRODUCT_TYPES, validateSize } from '../data/schema.js';
import { COLORS, COLOR_BY_NAME, colorLabel } from '../data/colors.js';
import { COLOR_GROUPS } from './harmony.js';
import { money, size as sizeText } from '../lib/format.js';

const CATEGORY_WORDS = {
  sneaker: ['sneakers', 'sneaker', 'shoes', 'shoe', 'trainers', 'trainer', 'kicks', 'footwear'],
  watch: ['watches', 'watch', 'timepiece', 'timepieces', 'wristwatch', 'wristwatches'],
  clothing: ['clothes', 'clothing', 'apparel'],
};

const TYPE_WORDS = {
  runner: ['running shoes', 'running shoe', 'running sneakers', 'runners', 'runner'],
  court: ['court shoes', 'court shoe', 'court sneakers', 'tennis shoes', 'court'],
  trail: ['trail runners', 'trail shoes', 'trail shoe', 'trail'],
  skate: ['skate shoes', 'skate shoe', 'skate'],
  'high-top': ['high-tops', 'high-top', 'high tops', 'high top', 'hi-tops', 'hi-top', 'hightops'],
  'slip-on': ['slip-ons', 'slip-on', 'slip ons', 'slip on'],
  field: ['field watches', 'field watch'],
  diver: ['dive watches', 'dive watch', 'divers', 'diver'],
  dress: ['dress watches', 'dress watch'],
  chronograph: ['chronographs', 'chronograph', 'chrono'],
  gmt: ['gmt watches', 'gmt watch', 'gmt'],
  digital: ['digital watches', 'digital watch', 'digital'],
  strap: ['watch straps', 'watch strap', 'watch bands', 'watch band', 'straps', 'strap', 'bands', 'band'],
  tee: ['t-shirts', 't-shirt', 't shirts', 't shirt', 'tshirts', 'tshirt', 'tees', 'tee'],
  'oxford-shirt': ['oxford shirts', 'oxford shirt', 'button-downs', 'button-down', 'button downs', 'button down', 'oxford'],
  overshirt: ['overshirts', 'overshirt', 'shirt jackets', 'shirt jacket', 'shackets', 'shacket'],
  'chore-jacket': ['chore jackets', 'chore jacket', 'chore coats', 'chore coat'],
  'field-jacket': ['field jackets', 'field jacket'],
  bomber: ['bomber jackets', 'bomber jacket', 'bombers', 'bomber'],
  hoodie: ['hooded sweatshirt', 'hoodies', 'hoodie', 'hoody'],
  crewneck: ['crewneck sweaters', 'crewneck sweater', 'crew necks', 'crew neck', 'crewnecks', 'crewneck', 'sweaters', 'sweater', 'jumpers', 'jumper', 'sweatshirts', 'sweatshirt'],
  chinos: ['chinos', 'chino', 'khakis'],
  trousers: ['dress pants', 'trousers', 'trouser', 'slacks'],
  jeans: ['jeans'],
  shorts: ['shorts'],
};

// Everyday words that cover several catalog types.
const TYPE_GROUPS = [
  { words: ['jackets', 'jacket', 'coats', 'coat', 'outerwear'], types: ['chore-jacket', 'field-jacket', 'bomber'], label: 'Jackets' },
  { words: ['shirts', 'shirt'], types: ['oxford-shirt', 'overshirt'], label: 'Shirts' },
  { words: ['pants'], types: ['chinos', 'trousers', 'jeans'], label: 'Pants' },
  { words: ['bottoms'], types: ['chinos', 'trousers', 'jeans', 'shorts'], label: 'Bottoms' },
  { words: ['tops'], types: ['tee', 'oxford-shirt', 'overshirt', 'hoodie', 'crewneck'], label: 'Tops' },
];

const TYPE_PLURAL = {
  runner: 'Runners', court: 'Court shoes', trail: 'Trail shoes', skate: 'Skate shoes', 'high-top': 'High-tops',
  'slip-on': 'Slip-ons', field: 'Field watches', diver: 'Dive watches', dress: 'Dress watches',
  chronograph: 'Chronographs', gmt: 'GMT watches', digital: 'Digital watches', strap: 'Straps', tee: 'T-shirts',
  'oxford-shirt': 'Oxford shirts', overshirt: 'Overshirts', 'chore-jacket': 'Chore jackets', 'field-jacket': 'Field jackets',
  bomber: 'Bomber jackets', hoodie: 'Hoodies', crewneck: 'Crewneck sweaters', chinos: 'Chinos', trousers: 'Trousers',
  jeans: 'Jeans', shorts: 'Shorts',
};

const COLOR_SYNONYMS = {
  gray: 'grey', 'light gray': 'light-grey', 'light grey': 'light-grey', 'off white': 'off-white', cream: 'off-white',
  ivory: 'off-white', ecru: 'bone', stone: 'bone', sand: 'khaki', beige: 'tan', chocolate: 'brown', maroon: 'burgundy',
  wine: 'burgundy', oxblood: 'burgundy', 'army green': 'olive', 'military green': 'olive', 'sky blue': 'light-blue',
  'baby blue': 'light-blue', 'light blue': 'light-blue', 'royal blue': 'blue', cobalt: 'blue', 'dark green': 'forest',
  'forest green': 'forest', 'bottle green': 'forest', 'hunter green': 'forest', mint: 'sage', 'rose gold': 'rose-gold',
  copper: 'bronze', cognac: 'camel', 'dark grey': 'charcoal', 'dark gray': 'charcoal', 'navy blue': 'navy',
};

const COLOR_GROUP_WORDS = [
  { words: ['earth tones', 'earth tone', 'earth-tone', 'earth-toned', 'earth toned', 'earthy', 'earth colors', 'earth colours'], colors: COLOR_GROUPS.earth, label: 'Earth tones' },
  { words: ['neutral colors', 'neutral colours', 'neutral tones', 'neutrals', 'neutral'], colors: COLOR_GROUPS.neutral, label: 'Neutrals' },
];

const STYLE_WORDS = {
  minimal: ['minimalist', 'minimalistic', 'minimal', 'clean', 'simple', 'understated', 'plain'],
  classic: ['classics', 'classic', 'timeless', 'heritage', 'traditional'],
  street: ['streetwear', 'street', 'urban'],
  sporty: ['athleisure', 'athletic', 'sporty', 'sports', 'sport'],
  outdoor: ['outdoorsy', 'outdoor'],
  workwear: ['workwear', 'utility', 'rugged'],
  preppy: ['preppy', 'prep', 'ivy', 'collegiate'],
  tech: ['technical', 'techwear', 'tech', 'performance'],
  vintage: ['vintage', 'retro', 'throwback'],
  dressy: ['dressed-up', 'dressed up', 'dressy', 'smart', 'sharp', 'elegant', 'polished'],
  bold: ['colorful', 'colourful', 'statement', 'vibrant', 'bright', 'bold', 'loud'],
};

const USE_WORDS = {
  everyday: ['day-to-day', 'day to day', 'every day', 'everyday', 'daily', 'casual'],
  work: ['the office', 'workplace', 'business', 'meetings', 'office', 'work'],
  running: ['marathon', 'jogging', 'running', 'jog', 'run', 'runs'],
  training: ['workouts', 'workout', 'training', 'lifting', 'gym'],
  outdoors: ['the outdoors', 'outdoors', 'camping', 'hiking', 'hikes', 'hike'],
  going_out: ['going out', 'night out', 'nights out', 'date night', 'parties', 'party', 'dinner', 'drinks', 'evening', 'date'],
  formal: ['black tie', 'weddings', 'wedding', 'ceremony', 'interview', 'formal'],
};

const USE_CHIP = {
  everyday: 'Everyday wear', work: 'For work', running: 'For running', training: 'For training',
  outdoors: 'For the outdoors', going_out: 'For going out', formal: 'For formal occasions',
};

const MATERIAL_WORDS = ['leather', 'suede', 'canvas', 'mesh', 'wool', 'cotton', 'linen', 'denim', 'nylon', 'rubber', 'titanium', 'ceramic', 'twill', 'corduroy', 'fleece', 'jersey', 'flannel', 'waxed cotton'];

const CONDITION_WORDS = {
  new_only: ['brand new', 'new only', 'only new', 'unworn', 'deadstock'],
  new_or_used: ['new or used', 'pre-owned', 'pre owned', 'preowned', 'secondhand', 'second-hand', 'second hand', 'used'],
};

const STOCK_WORDS = ['in stock', 'available now', 'in-stock'];
const NEGATIONS = new Set(['no', 'not', 'avoid', 'without', 'never', 'except', 'nothing']);
const NEGATION_FILLERS = new Set(['too', 'very', 'overly', 'so', 'really', 'anything', 'any', 'and', 'or', 'nor']);
const STOP_WORDS = new Set(`a an the some something anything any me i i'm im i'd want wants wanted need needs looking look
  for with to and or in on of that this these those would could should please show find get give like love really very
  pair my go goes nice good great cool stuff thing things one ones piece pieces item items wear wearing worn maybe ideal
  perfect new options option ideas idea suggestions suggest recommend recommendations what which can you help buy shop
  shopping kind sort style styles vibe vibes color colour colors colours tone tones price priced cost costs dollars dollar
  bucks usd also just else other another more much is are be it its it's so too but under below over above around about
  size sized sizes is can't cant dont don't pairs work's mine`.split(/\s+/).filter(Boolean));

const ALPHA_WORDS = { xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL', xxl: 'XXL', small: 'S', medium: 'M', large: 'L', 'x-large': 'XL', 'extra large': 'XL', 'xx-large': 'XXL', 'extra small': 'XS' };

const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const AMOUNT = String.raw`\$?\s?(?:${NUMBER})\s?k?(?:\s?(?:dollars|dollar|bucks|usd))?`;
const DOLLAR = String.raw`\$\s?(?:${NUMBER})\s?k?`;

function toMinor(text) {
  const t = String(text).toLowerCase().replace(/dollars?|bucks|usd|\$|\s/g, '');
  const k = t.endsWith('k');
  const value = Number.parseFloat(t.replace(/k$/, '').replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * (k ? 1000 : 1) * 100);
}

/** Phrase table: "earth tones" -> { kind, value, label }. Longest phrases are tried first. */
function buildPhrases(vocab) {
  const table = new Map();
  const add = (phrase, entry) => {
    const key = phrase.toLowerCase().trim().replace(/\s+/g, ' ');
    if (key && !table.has(key)) table.set(key, entry);
  };
  for (const [category, words] of Object.entries(CATEGORY_WORDS)) for (const w of words) add(w, { kind: 'category', value: category });
  for (const [type, words] of Object.entries(TYPE_WORDS)) for (const w of words) add(w, { kind: 'type', value: [type], label: TYPE_PLURAL[type] ?? TYPE_LABEL[type] });
  for (const group of TYPE_GROUPS) for (const w of group.words) add(w, { kind: 'type', value: group.types, label: group.label });
  for (const group of COLOR_GROUP_WORDS) for (const w of group.words) add(w, { kind: 'color', value: group.colors, label: group.label });
  for (const [word, name] of Object.entries(COLOR_SYNONYMS)) add(word, { kind: 'color', value: name });
  for (const c of vocab.colors ?? COLORS) {
    add(c.name, { kind: 'color', value: c.name });
    add(c.name.replace(/-/g, ' '), { kind: 'color', value: c.name });
    add(c.label, { kind: 'color', value: c.name });
  }
  for (const [style, words] of Object.entries(STYLE_WORDS)) for (const w of words) add(w, { kind: 'style', value: style });
  for (const [use, words] of Object.entries(USE_WORDS)) for (const w of words) add(w, { kind: 'use', value: use });
  for (const w of MATERIAL_WORDS) add(w, { kind: 'material', value: w });
  for (const [condition, words] of Object.entries(CONDITION_WORDS)) for (const w of words) add(w, { kind: 'condition', value: condition });
  for (const w of STOCK_WORDS) add(w, { kind: 'stock', value: true });
  for (const brand of vocab.brands ?? []) {
    const name = String(brand.name ?? '').toLowerCase();
    if (!name) continue;
    const entry = { kind: 'brand', value: brand.id, label: brand.name };
    add(name, entry);
    add(name.replace(/&/g, 'and'), entry);
    add(name.replace(/\s*&\s*/g, ' '), entry);
  }
  return table;
}

const phraseCache = new WeakMap();
const defaultVocab = {};
function phrasesFor(vocab) {
  const key = vocab ?? defaultVocab;
  if (!phraseCache.has(key)) phraseCache.set(key, buildPhrases(key));
  return phraseCache.get(key);
}

const TYPE_CATEGORY = Object.fromEntries(Object.entries(PRODUCT_TYPES).flatMap(([category, types]) => types.map((t) => [t, category])));

function priceLabel(value) {
  if (value.priceAroundMinor != null) return `Around ${money(value.priceAroundMinor)}`;
  if (value.minPriceMinor != null && value.maxPriceMinor != null) return `${money(value.minPriceMinor)} to ${money(value.maxPriceMinor)}`;
  if (value.minPriceMinor != null) return `Over ${money(value.minPriceMinor)}`;
  return `Under ${money(value.maxPriceMinor)}`;
}

function sizeChipLabel(value) {
  if (value.strapWidthMm != null) return `${value.strapWidthMm} mm wide`;
  if (value.caseDiameterMm != null) return `${value.caseDiameterMm} mm case`;
  if (value.system === 'ALPHA') return `Size ${value.value}`;
  return sizeText(value) ?? value.value;
}

/**
 * Builds constraints from chips, so the screen can drop or edit a chip and ask again without
 * re-reading the text.
 * @param {Array<{ kind: string, value: any }>} chips
 */
export function constraintsFromChips(chips) {
  const c = {};
  const push = (key, values) => {
    c[key] = [...new Set([...(c[key] ?? []), ...(Array.isArray(values) ? values : [values])])];
  };
  const categories = new Set();
  for (const chip of chips ?? []) {
    switch (chip.kind) {
      case 'category':
        categories.add(chip.value);
        break;
      case 'type':
        push('types', chip.value);
        for (const t of [].concat(chip.value)) if (TYPE_CATEGORY[t]) categories.add(TYPE_CATEGORY[t]);
        break;
      case 'color':
        push('colors', chip.value);
        break;
      case 'avoid_color':
        push('avoidColors', chip.value);
        break;
      case 'style':
        push('styles', chip.value);
        break;
      case 'avoid_style':
        push('avoidStyles', chip.value);
        break;
      case 'use':
        push('uses', chip.value);
        break;
      case 'material':
        push('materials', chip.value);
        break;
      case 'brand':
        push('brandIds', chip.value);
        break;
      case 'price':
        Object.assign(c, chip.value);
        break;
      case 'size':
        if (chip.value?.system) c.size = { value: chip.value.value, system: chip.value.system };
        else Object.assign(c, chip.value);
        break;
      case 'condition':
        c.condition = chip.value;
        break;
      case 'stock':
        c.inStockOnly = true;
        break;
      default:
        break;
    }
  }
  // A color or style both asked for and avoided is ambiguous; the "no ..." wins.
  if (c.colors && c.avoidColors) {
    c.colors = c.colors.filter((x) => !c.avoidColors.includes(x));
    if (!c.colors.length) delete c.colors;
  }
  if (c.styles && c.avoidStyles) {
    c.styles = c.styles.filter((x) => !c.avoidStyles.includes(x));
    if (!c.styles.length) delete c.styles;
  }
  if (categories.size === 1) c.category = [...categories][0];
  else if (categories.size > 1) c.categories = [...categories];
  return c;
}

const SEED_TRIGGER = /\b(?:to go with|go with|goes with|going with|to wear with|wear with|wearing with|to pair with|pair with|pairs with|pairing with|to match|matches|matching|match|works with|work with|for|with)\s+my\s+/g;
const SEED_STOP = /\s(?:under|below|less|max|maximum|up to|between|around|about|roughly|approximately|over|above|at|for|in|that|which|but|size|sz|from|budget|no|not|without|please)\b|[,.;!?$~<]/;

/**
 * Reads a typed request.
 * @param {string} text
 * @param {{ brands?: Array<{ id: string, name: string }>, colors?: any[] }} [vocab]
 * @returns {{ constraints: object, chips: Array<{ kind: string, label: string, value: any }>,
 *   seedHints: string[], unparsed: string[] }}
 */
export function parseRequest(text, vocab = defaultVocab) {
  const original = String(text ?? '').slice(0, 300);
  let work = ` ${original.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ')} `;
  const found = [];
  const consume = (start, end) => {
    work = work.slice(0, start) + ' '.repeat(end - start) + work.slice(end);
  };
  const scan = (regex, handler) => {
    const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
    let match;
    while ((match = re.exec(work))) {
      const handled = handler(match);
      if (handled !== false) consume(match.index, match.index + match[0].length);
      if (match[0].length === 0) re.lastIndex += 1;
    }
  };

  // "go with my navy jacket": the words describe the person's item, not what they want.
  const seedHints = [];
  scan(SEED_TRIGGER, (m) => {
    const start = m.index;
    const rest = work.slice(start + m[0].length);
    const stop = rest.search(SEED_STOP);
    const phrase = (stop === -1 ? rest : rest.slice(0, stop)).trim();
    if (!phrase) return false;
    for (const part of phrase.split(/\s*(?:,|\band my\b|\band\b)\s*/)) {
      const hint = part.replace(/^my\s+/, '').trim();
      if (hint) {
        seedHints.push(hint);
        found.push({ at: start, chip: { kind: 'seed', label: `Goes with your ${hint}`, value: hint } });
      }
    }
    consume(start, start + m[0].length + (stop === -1 ? rest.length : stop));
    return false;
  });

  // Millimeters and waist x inseam first, so "about 40mm" is a case size, not a price.
  // Millimeters are a strap or lug width up to 26 mm and a case size above that.
  const sizeChip = (at, value) => found.push({ at, chip: { kind: 'size', label: sizeChipLabel(value), value } });
  scan(/\b(\d{1,2}(?:\.\d)?)\s?-?\s?(?:mm|millimeters?|millimetres?)\b/, (m) => {
    const v = Number(m[1]);
    if (v >= 8 && v <= 26) sizeChip(m.index, { strapWidthMm: v });
    else if (v >= 28 && v <= 55) sizeChip(m.index, { caseDiameterMm: v });
    else return false;
  });
  scan(/\b(\d{2})\s?(?:x|×|by|\/)\s?(\d{2})\b/, (m) => sizeChip(m.index, { value: `${m[1]}x${m[2]}`, system: 'WAIST-INSEAM' }));
  scan(/\bw\s?(\d{2})\s?l\s?(\d{2})\b/, (m) => sizeChip(m.index, { value: `${m[1]}x${m[2]}`, system: 'WAIST-INSEAM' }));

  // Prices.
  const price = (at, value) => found.push({ at, chip: { kind: 'price', label: priceLabel(value), value } });
  scan(new RegExp(String.raw`\b(?:between|from)\s+(${AMOUNT})\s*(?:and|to|-|–)\s*(${AMOUNT})`), (m) => {
    const a = toMinor(m[1]);
    const b = toMinor(m[2]);
    if (a == null || b == null) return false;
    price(m.index, { minPriceMinor: Math.min(a, b), maxPriceMinor: Math.max(a, b) });
  });
  scan(new RegExp(String.raw`(${DOLLAR})\s*(?:-|–|to)\s*(${AMOUNT})`), (m) => {
    const a = toMinor(m[1]);
    const b = toMinor(m[2]);
    if (a == null || b == null) return false;
    price(m.index, { minPriceMinor: Math.min(a, b), maxPriceMinor: Math.max(a, b) });
  });
  scan(new RegExp(String.raw`(?:\b(?:under|below|less than|no more than|not more than|at most|max(?:imum)?(?: of)?|up to|within|budget(?: of| is)?|cheaper than)|<=?)\s*(${AMOUNT})`), (m) => {
    const v = toMinor(m[1]);
    if (v == null) return false;
    price(m.index, { maxPriceMinor: v });
  });
  scan(new RegExp(String.raw`(${AMOUNT})\s*(?:or less|or under|or below|or cheaper|max(?:imum)?|tops)\b`), (m) => {
    const v = toMinor(m[1]);
    if (v == null || !/\$|dollar|buck|usd/.test(m[1])) return false;
    price(m.index, { maxPriceMinor: v });
  });
  scan(new RegExp(String.raw`(?:\b(?:around|about|roughly|approximately|approx\.?|close to|near)|~)\s*(${AMOUNT})`), (m) => {
    const v = toMinor(m[1]);
    if (v == null) return false;
    price(m.index, { priceAroundMinor: v });
  });
  scan(new RegExp(String.raw`\b(?:over|above|more than|at least|min(?:imum)?(?: of)?|starting at)\s*(${AMOUNT})`), (m) => {
    const v = toMinor(m[1]);
    if (v == null) return false;
    price(m.index, { minPriceMinor: v });
  });
  scan(new RegExp(String.raw`(${DOLLAR})(?:\s?(?:dollars|bucks|usd))?`), (m) => {
    const v = toMinor(m[1]);
    if (v == null) return false;
    price(m.index, { maxPriceMinor: v });
  });

  // Sizes in other systems. (Millimeters and waist x inseam are read before prices.)
  scan(/\b(?:women'?s|womens|ladies|us\s?w)\s*(?:size\s*)?(\d{1,2}(?:\.5)?)\b/, (m) => {
    const size = { value: String(Number(m[1])), system: 'US-W' };
    if (validateSize(size, 'sneaker')) return false;
    sizeChip(m.index, size);
  });
  scan(/\b(?:size|sz|us\s?m|us|men'?s|mens)\s*(?:size\s*)?(\d{1,2}(?:\.5)?)\b/, (m) => {
    const n = Number(m[1]);
    const size = { value: String(n), system: 'US-M' };
    if (n < 4 || n > 16 || validateSize(size, 'sneaker')) return false;
    sizeChip(m.index, size);
  });
  scan(/\bsize\s*(xxl|xl|xs|s|m|l|small|medium|large|x-large|xx-large|extra large|extra small)\b/, (m) => sizeChip(m.index, { value: ALPHA_WORDS[m[1]], system: 'ALPHA' }));
  scan(/\b(xxl|xl|xs|x-large|xx-large|extra large|extra small)\b/, (m) => sizeChip(m.index, { value: ALPHA_WORDS[m[1]], system: 'ALPHA' }));

  // Vocabulary over what is left, longest phrase first.
  const phrases = phrasesFor(vocab);
  const tokens = [];
  const tokenRe = /[a-z0-9][a-z0-9&'-]*/g;
  let t;
  while ((t = tokenRe.exec(work))) tokens.push({ word: t[0].replace(/['-]+$/, ''), at: t.index });
  const unparsed = [];
  let negate = false;
  for (let i = 0; i < tokens.length; ) {
    let matched = null;
    for (let len = Math.min(4, tokens.length - i); len >= 1; len -= 1) {
      const phrase = tokens.slice(i, i + len).map((x) => x.word).join(' ');
      if (phrases.has(phrase)) {
        matched = { entry: phrases.get(phrase), len };
        break;
      }
    }
    const token = tokens[i];
    if (!matched) {
      // "not too loud", "no white or black": filler words keep the negation going.
      if (NEGATIONS.has(token.word)) negate = true;
      else if (!STOP_WORDS.has(token.word) && !NEGATION_FILLERS.has(token.word)) negate = false;
      if (!STOP_WORDS.has(token.word) && !NEGATIONS.has(token.word) && !/^\d+$/.test(token.word) && !unparsed.includes(token.word)) unparsed.push(token.word);
      i += 1;
      continue;
    }
    const { entry } = matched;
    const at = token.at;
    if (entry.kind === 'color') {
      const values = [].concat(entry.value);
      const label = entry.label ?? colorLabel(values[0]);
      if (negate) found.push({ at, chip: { kind: 'avoid_color', label: `Avoid ${label.toLowerCase()}`, value: values.length === 1 ? values[0] : values } });
      else found.push({ at, chip: { kind: 'color', label, value: values.length === 1 ? values[0] : values } });
    } else {
      const negated = negate;
      negate = false;
      if (entry.kind === 'category') found.push({ at, chip: { kind: 'category', label: CATEGORY_LABEL[entry.value], value: entry.value } });
      else if (entry.kind === 'type') found.push({ at, chip: { kind: 'type', label: entry.label, value: entry.value } });
      else if (entry.kind === 'style') {
        found.push(negated
          ? { at, chip: { kind: 'avoid_style', label: `Avoid ${STYLE_LABEL[entry.value].toLowerCase()}`, value: entry.value } }
          : { at, chip: { kind: 'style', label: STYLE_LABEL[entry.value], value: entry.value } });
      }
      else if (entry.kind === 'use') found.push({ at, chip: { kind: 'use', label: USE_CHIP[entry.value], value: entry.value } });
      else if (entry.kind === 'material') found.push({ at, chip: { kind: 'material', label: entry.value.charAt(0).toUpperCase() + entry.value.slice(1), value: entry.value } });
      else if (entry.kind === 'brand') found.push({ at, chip: { kind: 'brand', label: entry.label, value: entry.value } });
      else if (entry.kind === 'condition') found.push({ at, chip: { kind: 'condition', label: entry.value === 'new_only' ? 'New only' : 'New or used', value: entry.value } });
      else if (entry.kind === 'stock') found.push({ at, chip: { kind: 'stock', label: 'In stock', value: true } });
    }
    i += matched.len;
  }

  // "Small", "medium" and "large" are sizes only when the request is about clothing.
  const clothing = found.some(({ chip }) => (chip.kind === 'category' && chip.value === 'clothing') || (chip.kind === 'type' && [].concat(chip.value).some((x) => TYPE_CATEGORY[x] === 'clothing')));
  const hasAlpha = found.some(({ chip }) => chip.kind === 'size' && chip.value.system === 'ALPHA');
  for (const word of ['small', 'medium', 'large']) {
    const idx = unparsed.indexOf(word);
    if (idx === -1 || !clothing || hasAlpha) continue;
    unparsed.splice(idx, 1);
    const at = tokens.find((x) => x.word === word)?.at ?? 0;
    found.push({ at, chip: { kind: 'size', label: `Size ${ALPHA_WORDS[word]}`, value: { value: ALPHA_WORDS[word], system: 'ALPHA' } } });
  }

  // Keep one chip per meaning, in the order the words appeared.
  const seen = new Set();
  const chips = [];
  for (const { chip } of found.sort((a, b) => a.at - b.at)) {
    const key = `${chip.kind}:${JSON.stringify(chip.value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push(chip);
  }
  return { constraints: constraintsFromChips(chips), chips, seedHints, unparsed };
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// Shades people use for each other when describing their own things ("my blue jacket").
const NEAR_SHADES = [
  ['navy', 'blue'], ['blue', 'light-blue'], ['grey', 'charcoal'], ['grey', 'light-grey'], ['charcoal', 'black'],
  ['white', 'off-white'], ['off-white', 'bone'], ['white', 'bone'], ['tan', 'khaki'], ['tan', 'camel'], ['khaki', 'bone'],
  ['camel', 'brown'], ['olive', 'green'], ['olive', 'forest'], ['green', 'forest'], ['olive', 'sage'], ['red', 'burgundy'],
  ['red', 'rust'], ['steel', 'silver'], ['steel', 'grey'], ['silver', 'grey'], ['gunmetal', 'charcoal'],
];
const NEAR = new Set(NEAR_SHADES.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

/** 1 when the item has the color named, 0.5 for a near shade (navy for "blue"), else 0. */
function colorHit(wanted, have) {
  if (wanted.some((x) => have.includes(x))) return 1;
  return wanted.some((x) => have.some((y) => NEAR.has(`${x}|${y}`))) ? 0.5 : 0;
}

/** What a hint can be matched against for one of the person's items. */
function describeItem(item, catalog) {
  const product = item.productId ? catalog.product(item.productId) : null;
  const variant = item.variantId ? catalog.variant(item.variantId) : null;
  const brand = product ? catalog.brand(product.brandId) : null;
  const colors = variant
    ? variant.colors.filter((c) => (c.weight ?? 0) >= 0.15).map((c) => c.name)
    : (item.custom?.colors ?? []).filter((c) => COLOR_BY_NAME.has(c));
  const words = new Set(
    norm([brand?.name, product?.name, variant?.name, TYPE_LABEL[product?.type], item.custom?.brand, item.custom?.name, item.custom?.variantName, item.custom?.type].filter(Boolean).join(' '))
      .split(' ')
      .filter(Boolean),
  );
  return { category: item.category, type: product?.type ?? null, brandId: product?.brandId ?? null, colors, words };
}

/**
 * Matches "navy jacket" in "go with my navy jacket" against the person's own items, using the
 * same vocabulary as parseRequest plus words from each item's name. Category, type and brand
 * must match; colors and name words rank what is left. When nothing matches every word, a
 * single item that still fits the category and type is returned with exact: false, so the
 * screen can say how it read the hint. The caller passes only the actor's records.
 * @param {string[]} hints
 * @param {any[]} items owned (or wishlist) records of one person
 * @param {{ catalog: any, vocab?: object }} env
 * @returns {Array<{ hint: string, itemIds: string[], exact: boolean }>}
 */
export function resolveSeedHints(hints, items, { catalog, vocab } = {}) {
  return (hints ?? []).map((hint) => {
    const parsed = parseRequest(hint, vocab);
    const c = parsed.constraints;
    const categories = c.category ? [c.category] : c.categories ?? [];
    const words = parsed.unparsed.map(norm).filter(Boolean);
    const softCount = (c.colors?.length ? 1 : 0) + words.length;
    const hardCount = (categories.length ? 1 : 0) + (c.types?.length ? 1 : 0) + (c.brandIds?.length ? 1 : 0);
    if (!softCount && !hardCount) return { hint, itemIds: [], exact: false };
    const scored = [];
    for (const item of items ?? []) {
      const d = describeItem(item, catalog);
      if (categories.length && !categories.includes(d.category)) continue;
      if (c.types?.length && !(d.type && c.types.includes(d.type))) continue;
      if (c.brandIds?.length && !c.brandIds.includes(d.brandId)) continue;
      let hits = 0;
      if (c.colors?.length) hits += colorHit(c.colors, d.colors);
      for (const w of words) if (d.words.has(w)) hits += 1;
      scored.push({ id: item.id, hits });
    }
    const top = Math.max(0, ...scored.map((s) => s.hits));
    const best = scored.filter((s) => s.hits === top).map((s) => s.id).slice(0, 3);
    if (!softCount || top === softCount) return { hint, itemIds: best, exact: scored.length > 0 };
    // Partly matched ("blue jacket" for a navy one): returned, but marked as a loose reading.
    // A color that clearly contradicts the item ("black" for white sneakers) never matches.
    if (top > 0) return { hint, itemIds: best, exact: false };
    return { hint, itemIds: [], exact: false };
  });
}
