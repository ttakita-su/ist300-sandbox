// Turns what a store page, a Bing Shopping listing or a visual search said about a product into a
// draft the person confirms: category, type, brand, name and main colors. Every value is a
// guess from the words alone. A draft never carries a catalog identity, a size or a condition,
// and the page's own words are kept unchanged in the WebSnapshot next to it (records.js).
// Pure and Node-importable: no DOM, no network.
import { CATEGORIES } from '../data/schema.js';
import { COLORS } from '../data/colors.js';
import { cleanWebSnapshot, displayHost, iso } from '../server/records.js';

const MAX_NAME = 120;
const MAX_COLORS = 4;

/** Lowercase word tokens: accents, trademark signs and punctuation dropped; apostrophes kept. */
function tokenize(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^a-z0-9'&]+/g, ' ')
    .split(' ')
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

/** Phrase table keyed by first token, longest phrases first. */
function phraseTable(entries) {
  const index = new Map();
  for (const [phrase, value] of entries) {
    const words = tokenize(phrase);
    if (!words.length) continue;
    const list = index.get(words[0]) ?? [];
    if (!list.some((e) => e.words.join(' ') === words.join(' '))) list.push({ words, value });
    index.set(words[0], list);
  }
  for (const list of index.values()) list.sort((a, b) => b.words.length - a.words.length);
  return index;
}

/** Left-to-right, longest-first phrase hits: [{ start, end, value }] in token positions. */
function scan(tokens, table) {
  const hits = [];
  for (let i = 0; i < tokens.length; ) {
    const hit = (table.get(tokens[i]) ?? []).find((e) => e.words.every((w, k) => tokens[i + k] === w));
    if (hit) {
      hits.push({ start: i, end: i + hit.words.length, value: hit.value });
      i += hit.words.length;
    } else {
      i += 1;
    }
  }
  return hits;
}

const words = (list, value) => list.map((w) => [w, value]);

// ---------- Brands ----------

// [name, { aliases, models, hosts, category, keep }]. `category` hints at brands that make almost
// one kind of product; it is used only when the words themselves say nothing. `models`: model
// lines titles often start with instead of the brand ("Air Force 1 '07"); like `keep`, their words
// stay in the item name. `hosts`: the brand's own store domain when it isn't simply the brand's
// name (seikowatches.com).
const BRANDS = [
  ['Nike', { models: ['air force 1', 'af1', 'air max', 'dunk', 'sb dunk', 'cortez', 'blazer mid', 'blazer low'] }],
  ['Jordan', { aliases: ['air jordan'], keep: true }],
  ['adidas', { models: ['stan smith', 'superstar', 'samba', 'gazelle', 'ultraboost', 'yeezy'] }], ['New Balance', { category: 'sneaker' }],
  ['Converse', { models: ['chuck taylor', 'chuck 70'], category: 'sneaker' }], ['Vans', { models: ['old skool', 'sk8 hi'], category: 'sneaker' }],
  ['Puma'], ['Reebok'], ['New Era'], ['Apple'],
  ['ASICS', { category: 'sneaker' }], ['Onitsuka Tiger', { category: 'sneaker' }], ['HOKA', { aliases: ['hoka one one'], category: 'sneaker' }],
  ['Saucony', { category: 'sneaker' }], ['Brooks', { category: 'sneaker' }], ['Salomon', { category: 'sneaker' }],
  ['Allbirds', { category: 'sneaker' }], ['Veja', { category: 'sneaker' }], ['Skechers', { category: 'sneaker' }],
  ['Golden Goose', { category: 'sneaker' }], ['Common Projects', { category: 'sneaker' }], ['Under Armour'], ['Off-White'],
  ['Casio', { models: ['g shock', 'baby g'], category: 'watch' }], ['Seiko', { hosts: ['seikowatches', 'seikousa'], category: 'watch' }],
  ['Grand Seiko', { category: 'watch' }], ['Citizen', { category: 'watch' }], ['Orient', { category: 'watch' }],
  ['Timex', { category: 'watch' }], ['Rolex', { category: 'watch' }], ['Omega', { category: 'watch' }],
  ['Tudor', { category: 'watch' }], ['Hamilton', { category: 'watch' }], ['Tissot', { category: 'watch' }],
  ['Swatch', { category: 'watch' }], ['Breitling', { category: 'watch' }], ['TAG Heuer', { category: 'watch' }],
  ['Longines', { category: 'watch' }], ['Oris', { category: 'watch' }], ['Bulova', { category: 'watch' }],
  ['Patek Philippe', { category: 'watch' }], ['Audemars Piguet', { category: 'watch' }], ['IWC', { category: 'watch' }],
  ['Panerai', { category: 'watch' }], ['Sinn', { category: 'watch' }], ['Nomos', { category: 'watch' }],
  ["Levi's", { aliases: ['levis', 'levi', 'levi strauss'], hosts: ['levi'], category: 'clothing' }],
  ['UNIQLO', { category: 'clothing' }], ['Patagonia', { category: 'clothing' }], ['The North Face', { aliases: ['north face'], category: 'clothing' }],
  ["Arc'teryx", { aliases: ['arcteryx'], category: 'clothing' }], ['Carhartt', { aliases: ['carhartt wip'], category: 'clothing' }],
  ['Ralph Lauren', { aliases: ['polo ralph lauren'], category: 'clothing' }], ['Tommy Hilfiger', { category: 'clothing' }],
  ['J.Crew', { aliases: ['j crew', 'jcrew'], category: 'clothing' }], ['Gap', { category: 'clothing' }], ['Old Navy', { category: 'clothing' }],
  ['Banana Republic', { category: 'clothing' }], ['Athleta', { category: 'clothing' }], ['Everlane', { category: 'clothing' }], ['Champion', { category: 'clothing' }],
  ['Stüssy', { aliases: ['stussy'], category: 'clothing' }], ['Barbour', { category: 'clothing' }], ['Columbia', { category: 'clothing' }],
  ['Wrangler', { category: 'clothing' }], ['Dickies', { category: 'clothing' }], ['Lululemon', { category: 'clothing' }],
  ['Abercrombie & Fitch', { aliases: ['abercrombie'], category: 'clothing' }], ['H&M', { category: 'clothing' }],
  ['Zara', { category: 'clothing' }], ['Stone Island', { category: 'clothing' }], ['Fear of God', { category: 'clothing' }],
].map(([name, opts = {}]) => ({ name, compact: tokenize(name).join('').replace(/[^a-z0-9]/g, ''), keep: Boolean(opts.keep), category: opts.category ?? null, hosts: opts.hosts ?? [], aliases: opts.aliases ?? [], models: opts.models ?? [] }));

const BRAND_TABLE = phraseTable(
  BRANDS.flatMap((b) => [[b.name, b], ...b.aliases.map((a) => [a, b]), ...b.models.map((m) => [m, { ...b, keep: true }])]),
);

// Leading words that describe the listing, not the product ("[Brand New] Casio ...", "Men's Levi's ...").
const LEADING_NOISE = phraseTable(words(['brand new', 'new', 'nwt', 'nib', 'authentic', 'genuine', "men's", 'mens', 'men', "women's", 'womens', 'women', 'unisex', 'kids', "kid's", 'boys', 'girls', 'ladies'], true));

// First words that are product description, never a brand.
const GENERIC = new Set(`classic original vintage retro premium essential essentials basic everyday organic cotton leather
  wool canvas suede linen denim slim relaxed regular straight oversize oversized cropped boxy fitted loose skinny tapered
  wide washed raw selvedge heavyweight midweight garment dyed ribbed knit knitted quilted padded insulated packable
  recycled merino cashmere corduroy twill nylon polyester mesh rubber patent faux vegan plain solid striped graphic logo
  embroidered printed pocket zip half quarter full crew v button hooded sleeveless performance technical tech outdoor
  hiking travel work dress formal smart the a an old mini big small little light heavy soft waterproof casual sport
  sports athletic running lightweight stainless steel digital analog automatic quartz solar mechanical made one two pair
  set lot unisex short long low high mid pro limited special exclusive edition series collection official replacement
  genuine luxury fashion trendy stylish cool comfortable comfort super ultra hot top best cheap rare used preowned pre
  refurbished deadstock youth junior adult toddler mens womens kids`.split(/\s+/).filter(Boolean));

function brandByCompact(compact) {
  return BRANDS.find((b) => b.compact === compact || b.hosts.includes(compact)) ?? null;
}

/** The brand whose own store this host is (vans.com, seikowatches.com), or null for retailers. */
function brandForHost(host) {
  const labels = String(host ?? '').toLowerCase().split('.').filter(Boolean);
  if (labels.length < 2) return null;
  // nike.co.uk -> nike
  const second = labels.length >= 3 && labels[labels.length - 1].length === 2 && labels[labels.length - 2].length <= 3;
  const site = labels.length - (second ? 3 : 2);
  // A brand's own part of a group's store comes first: oldnavy.gap.com is Old Navy, not Gap.
  for (let i = 0; i <= site; i += 1) {
    const brand = brandByCompact(labels[i]);
    if (brand) return brand;
  }
  return null;
}

/** A page's brand in its usual spelling when it's a brand Rotation knows ("TIMEX" -> "Timex"). */
function canonicalBrand(name) {
  const toks = tokenize(name);
  const hit = scan(toks, BRAND_TABLE)[0];
  return hit && hit.start === 0 && hit.end === toks.length ? hit.value.name : null;
}

/** Tokens of a title with the raw word each came from, so leading words can be cut cleanly. */
function titleParts(title) {
  const raw = String(title ?? '').trim().split(/\s+/).filter(Boolean);
  const tokens = [];
  const wordOf = [];
  raw.forEach((word, i) => {
    for (const t of tokenize(word)) {
      tokens.push(t);
      wordOf.push(i);
    }
  });
  return { raw, tokens, wordOf };
}

const startsAt = (tokens, i, words) => words.length > 0 && words.every((w, k) => tokens[i + k] === w);

/**
 * How many tokens of listing noise ("[Brand New]", "Men's") start the title. A brand that starts
 * with a noise word ends it: a known one ("New Balance", "New Era") or the page's own `brandWords`.
 */
function leadingNoise(tokens, brandWords = []) {
  let i = 0;
  for (;;) {
    if (startsAt(tokens, i, brandWords) || (BRAND_TABLE.get(tokens[i]) ?? []).some((e) => startsAt(tokens, i, e.words))) return i;
    const hit = (LEADING_NOISE.get(tokens[i]) ?? []).find((e) => startsAt(tokens, i, e.words));
    if (!hit) return i;
    i += hit.words.length;
  }
}

/**
 * The brand a title starts with, after listing noise. Known brands only, unless `loose`, which
 * also accepts an unknown first word that isn't a description word.
 * @returns {{ name: string, end: number, keep: boolean, brand: any } | null} end: tokens consumed
 */
function leadingBrand(parts, { loose = false } = {}) {
  const start = leadingNoise(parts.tokens);
  const hit = scan(parts.tokens.slice(start), BRAND_TABLE)[0];
  if (hit && hit.start === 0) return { name: hit.value.name, end: start + hit.end, keep: hit.value.keep, brand: hit.value };
  if (!loose) return null;
  const first = parts.tokens[start];
  if (!first || GENERIC.has(first) || COLOR_TOKENS.has(first) || NOUN_TOKENS.has(first) || TYPE_TOKENS.has(first) || /\d/.test(first) || first.length < 2) return null;
  // Only a whole raw word counts, in the spelling the store used.
  const raw = parts.raw[parts.wordOf[start]];
  if (tokenize(raw).length !== 1) return null;
  const name = raw.replace(/[®™©]/g, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '');
  return name ? { name, end: start + 1, keep: false, brand: null } : null;
}

/** A known brand that is the whole last "- ..." or "| ..." segment of a title ("Air Force 1 Shoes - Nike"). */
function trailingBrand(title) {
  const segments = String(title ?? '').split(/\s+[-–—|]\s+/);
  return segments.length > 1 ? canonicalBrand(segments[segments.length - 1]) : null;
}

/**
 * Brand guess: the page's own brand, else a known brand at the start of the title (after "Men's",
 * "[Brand New]", "NEW" ...) or as its last "- Brand" segment, else the brand whose own store the
 * host is, else the title's first word when it reads like a brand. Null when nothing fits.
 * @param {{ title?: string|null, brand?: string|null, host?: string|null }} input
 * @returns {string|null}
 */
export function guessBrand({ title = null, brand = null, host = null } = {}) {
  const given = typeof brand === 'string' ? brand.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim() : '';
  if (given) return canonicalBrand(given) ?? given.slice(0, MAX_NAME);
  const parts = titleParts(title);
  return leadingBrand(parts)?.name ?? trailingBrand(title) ?? brandForHost(host)?.name ?? leadingBrand(parts, { loose: true })?.name ?? null;
}

// ---------- Category ----------

const CATEGORY_NOUNS = phraseTable([
  ...words(['watch', 'watches', 'wristwatch', 'wristwatches', 'timepiece', 'timepieces', 'smartwatch', 'smartwatches', 'chronograph',
    'chronographs', 'diver', 'divers', "diver's", 'dive watch', 'watch strap', 'watch straps', 'watch band', 'watch bands',
    'watch bracelet', 'nato strap'], 'watch'),
  ...words(['sneaker', 'sneakers', 'shoe', 'shoes', 'trainer', 'trainers', 'running shoe', 'running shoes', 'kicks', 'footwear',
    'runner', 'runners', 'high top', 'high tops', 'hi top', 'low top', 'low tops', 'slip on', 'slip ons', 'plimsoll', 'plimsolls',
    'skate shoe', 'skate shoes', 'tennis shoe', 'tennis shoes'], 'sneaker'),
  ...words(['shirt', 'shirts', 't shirt', 't shirts', 'tshirt', 'tshirts', 'tee', 'tees', 'jeans', 'jacket', 'jackets', 'hoodie',
    'hoodies', 'hoody', 'sweater', 'sweaters', 'sweatshirt', 'sweatshirts', 'fleece', 'chinos', 'chino', 'trousers', 'trouser',
    'pants', 'shorts', 'crewneck', 'crew neck', 'overshirt', 'overshirts', 'shacket', 'jumper', 'pullover', 'cardigan', 'coat',
    'coats', 'parka', 'puffer', 'anorak', 'windbreaker', 'bomber', 'vest', 'gilet', 'polo', 'henley', 'joggers', 'sweatpants',
    'slacks', 'khakis', 'overalls', 'flannel', 'jersey', 'tank top', 'long sleeve', 'longsleeve'], 'clothing'),
  // Things Rotation doesn't keep: when one of these is what the title is about, there's no guess.
  ...words(['bag', 'bags', 'backpack', 'backpacks', 'tote', 'handbag', 'purse', 'wallet', 'duffel', 'phone', 'iphone', 'smartphone',
    'phone case', 'airpods', 'earbuds', 'headphones', 'laptop', 'tablet', 'ipad', 'sunglasses', 'glasses', 'eyeglasses', 'perfume',
    'cologne', 'fragrance', 'hat', 'hats', 'cap', 'caps', 'beanie', 'socks', 'sock', 'belt', 'necklace', 'ring', 'earrings',
    'bracelet', 'bracelets', 'keychain', 'key chain', 'poster', 'book', 'toy', 'sticker', 'calculator', 'keyboard', 'camera', 'boot',
    'boots', 'sandal', 'sandals', 'slides', 'flip flops', 'heels', 'loafer', 'loafers', 'insoles', 'laces', 'shoelaces', 'shoe cleaner',
    'cleaner', 'cleaning kit', 'shoe trees', 'scarf', 'gloves', 'umbrella', 'mug', 'blanket',
    // Clocks, instruments and the things that hold, protect or mend an item, not the item itself.
    'clock', 'clocks', 'alarm clock', 'wall clock', 'piano', 'pianos', 'synthesizer', 'winder', 'winders', 'organizer', 'organizers',
    'organiser', 'rack', 'racks', 'spray', 'protector', 'protectors', 'sneaker shield', 'sneaker shields', 'crease shield',
    'crease shields', 'bumper', 'bumpers', 'holder', 'holders', 'hanger', 'hangers', 'board', 'kit', 'kits', 'drawstring',
    'drawstrings', 'charger', 'chargers', 'charging cable', 'battery', 'batteries', 'watch box', 'watch boxes', 'watch case',
    'watch cases', 'watch stand', 'watch stands', 'display stand', 'shoe box', 'shoe boxes', 'storage box'], 'other'),
]);
const NOUN_TOKENS = new Set([...CATEGORY_NOUNS.keys()]);
// After "for" or "with", a product word says what the item is for or comes with ("Watch Winder
// for Automatic Watches", "Diver's Watch with Steel Bracelet"); the head comes before it.
const CLAUSE_WORDS = new Set(['for', 'with']);
// A bracelet after a watch word is the watch's own ("Automatic Watch, Stainless Steel Bracelet").
const WATCH_PARTS = new Set(['bracelet', 'bracelets']);

/** Tokens for reading product words: "Watch6" (Samsung Galaxy Watch6) reads as "watch". */
function nounTokens(text) {
  return tokenize(text).map((t) => (/^(?:smart)?watch\d{1,2}$/.test(t) ? t.replace(/\d+$/, '') : t));
}

/** The product word a title is about: the last one before "for" or "with", skipping a watch's own bracelet. */
function headNoun(tokens) {
  const nouns = scan(tokens, CATEGORY_NOUNS);
  const clause = tokens.findIndex((t) => CLAUSE_WORDS.has(t));
  const before = clause > 0 ? nouns.filter((n) => n.end <= clause) : [];
  const pool = before.length ? before : nouns;
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    const part = WATCH_PARTS.has(tokens.slice(pool[i].start, pool[i].end).join(' ')) && pool.slice(0, i).some((n) => n.value === 'watch');
    if (!part) return pool[i];
  }
  return null;
}

// Model names that settle the category when no product word is present ("Nike Dunk Low Panda").
const MODEL_HINTS = phraseTable([
  ...words(['air force 1', 'af1', 'air max', 'air jordan', 'jordan 1', 'jordan 3', 'jordan 4', 'jordan 11', 'dunk', 'dunks',
    'sb dunk', 'chuck taylor', 'chuck 70', 'all star', 'old skool', 'sk8 hi', 'stan smith', 'superstar', 'samba', 'gazelle',
    'campus 00s', 'ultraboost', 'ultra boost', 'nmd', 'yeezy', 'club c', 'cortez', 'blazer mid', 'blazer low', 'huarache',
    'pegasus', 'vomero', 'gel kayano', 'gel nimbus', 'gel lyte', 'clifton', 'bondi', 'speedcross', 'xt 6', 'tree runner',
    'wool runner', 'tree dasher'], 'sneaker'),
  ...words(['g shock', 'baby g', 'submariner', 'speedmaster', 'seamaster', 'datejust', 'daytona', 'gmt master', 'black bay',
    'pelagos', 'khaki field', 'royal oak', 'nautilus', 'carrera', 'aquaracer', 'navitimer', 'presage', 'prospex', 'moon phase',
    'moonphase', 'weekender', 'marlin', 'q timex', 'casioak', 'edifice', 'pro trek'], 'watch'),
  ...words(['nuptse', 'synchilla', 'better sweater', 'retro x'], 'clothing'),
]);
// Watch reference codes: F-91W, A168, CA-53, DW-5600, GA-2100, SKX007, SRPD55, SPB453, SBDC101, TW2W51000.
const WATCH_CODE = /(?:^| )(?:f ?91 ?w?|a ?168|ca ?53|dw ?5600|ga ?2100|skx ?\d{3}|srp[a-z] ?\d{2}|sp[a-z] ?\d{3}|snk ?\d{3}|sbdc ?\d{3}|tw2[a-z]\d{4,})(?:[a-z0-9]*)(?= |$)/;
// New Balance model numbers: retro runners, and court styles (550, 480). For the category they
// count only when the text also says New Balance.
const NB_RUNNER = /(?:^| )(?:99[0-3](?:v\d)?|2002r|1906r|9060|574|327|530)(?= |$)/;
const NB_COURT = /(?:^| )(?:550|480)(?= |$)/;

function categoryFromWords(text) {
  const tokens = nounTokens(text);
  // The last product word is what the title is about: "Nike shoe bag" is a bag.
  const head = headNoun(tokens);
  if (head) return { category: head.value === 'other' ? null : head.value, decided: true };
  const counts = { sneaker: 0, watch: 0, clothing: 0 };
  for (const hit of scan(tokens, MODEL_HINTS)) counts[hit.value] += 1;
  const joined = tokens.join(' ');
  if (WATCH_CODE.test(joined)) counts.watch += 1;
  if (/(?:^| )new balance(?= |$)/.test(joined) && (NB_RUNNER.test(joined) || NB_COURT.test(joined))) counts.sneaker += 1;
  const ranked = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return { category: null, decided: false };
  return { category: ranked[0][0], decided: true };
}

/**
 * 'sneaker' | 'watch' | 'clothing' from title, brand, query or breadcrumb words. Null when unsure,
 * or when the words are about something Rotation doesn't keep (a bag, a phone, socks ...).
 * @param {string} text
 * @returns {'sneaker'|'watch'|'clothing'|null}
 */
export function guessCategory(text) {
  const fromWords = categoryFromWords(text);
  if (fromWords.decided) return fromWords.category;
  const parts = titleParts(text);
  return leadingBrand(parts)?.brand?.category ?? null;
}

// ---------- Type ----------

const rule = (type, phrases = [], patterns = []) => ({ type, table: phraseTable(words(phrases, true)), patterns });

const SNEAKER_RULES = [
  rule('slip-on', ['slip on', 'slip ons', 'slipon']),
  rule('high-top', ['high top', 'high tops', 'hi top', 'hi tops', 'hightop', 'hightops', 'sk8 hi'], [
    /(?:^| )(?:dunk|blazer|jordan 1|aj1|chuck 70|chuck taylor|all star|air force 1|af1)(?: \S+){0,2} (?:high|hi|mid)(?= |$)/,
  ]),
  rule('trail', ['trail', 'trail runner', 'hiking shoe', 'hiking shoes', 'xt 6', 'speedcross']),
  rule('skate', ['skate', 'skateboarding', 'old skool', 'sb dunk', 'nike sb', 'half cab']),
  // A bare "run" is not enough: the Converse Run Star Hike is no running shoe.
  rule('runner', ['running', 'runner', 'runners', 'run shoe', 'run shoes', 'free run', 'jogging', 'air max', 'ultraboost', 'ultra boost',
    'pegasus', 'vomero', 'gel kayano', 'gel nimbus', 'clifton', 'bondi', 'kinvara', 'tree runner', 'wool runner'], [NB_RUNNER]),
  rule('court', ['court', 'tennis', 'air force 1', 'af1', 'stan smith', 'superstar', 'samba', 'gazelle', 'campus', 'club c', 'dunk',
    'jordan 1', 'low top', 'low tops', 'blazer low', 'court vision', 'forum low'], [NB_COURT]),
];

const WATCH_RULES = [
  rule('strap', ['watch strap', 'watch straps', 'watch band', 'watch bands', 'watch bracelet', 'nato strap', 'replacement strap', 'replacement band']),
  rule('digital', ['digital', 'g shock', 'baby g', 'smartwatch', 'smart watch', 'apple watch', 'lcd', 'calculator watch'], [/(?:^| )(?:f ?91 ?w?|a ?168|ca ?53|dw ?5600)(?:[a-z0-9]*)(?= |$)/]),
  rule('chronograph', ['chronograph', 'chronographs', 'chrono', 'speedmaster', 'daytona', 'navitimer']),
  rule('gmt', ['gmt', 'dual time']),
  rule('diver', ['diver', 'divers', "diver's", 'dive', 'diving', 'submariner', 'seamaster', 'black bay', 'pelagos'], [/(?:^| )skx ?\d{3}/]),
  rule('dress', ['dress watch', 'dress', 'moon phase', 'moonphase', 'presage', 'calatrava']),
  rule('field', ['field watch', 'field', 'military', 'pilot', 'khaki field', 'weekender', 'expedition', 'explorer']),
];

// Garment words and the catalog type they name; null names no type ("jacket", "fleece").
const CLOTHING_TYPES = phraseTable([
  ...words(['hooded sweatshirt', 'hoodie', 'hoodies', 'hoody'], 'hoodie'),
  ...words(['t shirt', 't shirts', 'tshirt', 'tshirts', 'tee', 'tees'], 'tee'),
  ...words(['oxford shirt', 'oxford', 'button down shirt', 'button down'], 'oxford-shirt'),
  ...words(['overshirt', 'overshirts', 'shirt jacket', 'shacket'], 'overshirt'),
  ...words(['chore jacket', 'chore coat'], 'chore-jacket'),
  ...words(['field jacket', 'm 65'], 'field-jacket'),
  ...words(['bomber jacket', 'bomber', 'flight jacket'], 'bomber'),
  ...words(['crewneck sweater', 'crewneck sweatshirt', 'crewneck', 'sweater', 'sweaters', 'sweatshirt', 'sweatshirts', 'jumper'], 'crewneck'),
  ...words(['chinos', 'chino', 'khakis'], 'chinos'),
  ...words(['trousers', 'trouser', 'slacks', 'dress pants'], 'trousers'),
  ...words(['jeans'], 'jeans'),
  ...words(['shorts'], 'shorts'),
  ...words(['jacket', 'jackets', 'coat', 'parka', 'puffer', 'shirt', 'shirts', 'pants', 'fleece', 'vest', 'cardigan', 'polo', 'henley',
    'joggers', 'sweatpants', 'anorak', 'windbreaker', 'gilet', 'pullover', 'flannel', 'jersey', 'tank top'], null),
]);

// Words that name a type or a model line ("Court Classic ...", "Oxford Shirt") are never a brand.
const TYPE_TOKENS = new Set([...SNEAKER_RULES, ...WATCH_RULES].flatMap((r) => [...r.table.keys()]).concat([...CLOTHING_TYPES.keys(), ...MODEL_HINTS.keys()]));

function typeFromRules(rules, tokens) {
  const joined = tokens.join(' ');
  for (const r of rules) {
    if (scan(tokens, r.table).length || r.patterns.some((p) => p.test(joined))) return r.type;
  }
  return null;
}

// "Oxford" alone names the shirt only when no other garment word names a type and no color
// follows it: "Oxford Slim-Fit Shirt" is one, "Reverse Weave Hoodie, Oxford Gray" is a hoodie.
const WEAK_GARMENTS = new Set(['oxford']);

/**
 * The type of the garment the title is about: its last garment word, or the word just before a
 * generic one ("chino pants"); a weak "oxford" also types a later "shirt" ("Oxford Slim-Fit Shirt").
 */
function clothingType(tokens) {
  const weak = (h) => WEAK_GARMENTS.has(tokens.slice(h.start, h.end).join(' '));
  let hits = scan(tokens, CLOTHING_TYPES).filter((h) => !(weak(h) && COLOR_TOKENS.has(tokens[h.end])));
  if (hits.some((h) => h.value && !weak(h))) hits = hits.filter((h) => !weak(h));
  if (!hits.length) return null;
  const head = hits[hits.length - 1];
  if (head.value) return head.value;
  const before = hits[hits.length - 2];
  if (!before) return null;
  if (before.end === head.start) return before.value;
  return weak(before) && /^shirts?$/.test(tokens.slice(head.start, head.end).join(' ')) ? before.value : null;
}

/**
 * A PRODUCT_TYPES[category] id read from the words ("Air Force 1" -> court, "high top" -> high-top,
 * "diver" -> diver, "F-91W" -> digital, "jeans" -> jeans, "t-shirt" -> tee), or null.
 * @param {'sneaker'|'watch'|'clothing'|null} category
 * @param {string} text
 * @returns {string|null}
 */
export function guessType(category, text) {
  const tokens = tokenize(text);
  if (category === 'sneaker') return typeFromRules(SNEAKER_RULES, tokens);
  if (category === 'watch') return typeFromRules(WATCH_RULES, tokens);
  if (category === 'clothing') return clothingType(tokens);
  return null;
}

// ---------- Colors ----------

// Store colorway words mapped to Rotation's named colors (js/data/colors.js).
const COLOR_TABLE = phraseTable([
  ...COLORS.flatMap((c) => [[c.name, c.name], [c.label, c.name]]),
  ['gray', 'grey'], ['light gray', 'light-grey'], ['dark grey', 'charcoal'], ['dark gray', 'charcoal'], ['heather grey', 'grey'],
  ['heather gray', 'grey'], ['cool grey', 'grey'], ['wolf grey', 'grey'], ['cement grey', 'grey'], ['smoke grey', 'grey'],
  ['light smoke grey', 'light-grey'], ['graphite', 'charcoal'], ['anthracite', 'charcoal'], ['iron grey', 'charcoal'],
  ['triple white', 'white'], ['summit white', 'white'], ['cloud white', 'white'], ['ftwr white', 'white'], ['optical white', 'white'],
  ['bright white', 'white'], ['true white', 'white'], ['triple black', 'black'], ['core black', 'black'], ['jet black', 'black'],
  ['onyx', 'black'], ['sail', 'off-white'], ['cream', 'off-white'], ['ivory', 'off-white'], ['pale ivory', 'off-white'],
  ['coconut milk', 'off-white'], ['egret', 'off-white'], ['chalk', 'off-white'], ['parchment', 'off-white'], ['ecru', 'bone'],
  ['stone', 'bone'], ['oatmeal', 'bone'], ['navy blue', 'navy'], ['midnight navy', 'navy'], ['college navy', 'navy'],
  ['dark navy', 'navy'], ['obsidian', 'navy'], ['indigo', 'navy'], ['sky blue', 'light-blue'], ['baby blue', 'light-blue'],
  ['university blue', 'light-blue'], ['powder blue', 'light-blue'], ['royal blue', 'blue'], ['game royal', 'blue'], ['cobalt', 'blue'],
  ['turquoise', 'teal'], ['aqua', 'teal'], ['dark green', 'forest'], ['bottle green', 'forest'], ['hunter green', 'forest'],
  ['pine green', 'forest'], ['gorge green', 'forest'], ['kelly green', 'green'], ['lime', 'green'], ['mint', 'sage'],
  ['army green', 'olive'], ['military green', 'olive'], ['medium olive', 'olive'], ['cargo khaki', 'khaki'], ['sand', 'khaki'],
  ['beige', 'tan'], ['wheat', 'tan'], ['light brown', 'tan'], ['cognac', 'camel'], ['chocolate', 'brown'], ['dark brown', 'brown'],
  ['mocha', 'brown'], ['espresso', 'brown'], ['tobacco', 'brown'], ['maroon', 'burgundy'], ['wine', 'burgundy'],
  ['oxblood', 'burgundy'], ['bordeaux', 'burgundy'], ['university red', 'red'], ['varsity red', 'red'], ['gym red', 'red'],
  ['fire red', 'red'], ['infrared', 'red'], ['crimson', 'red'], ['scarlet', 'red'], ['volt', 'yellow'], ['safety orange', 'orange'],
  ['blush', 'pink'], ['rose', 'pink'], ['lilac', 'purple'], ['lavender', 'purple'], ['violet', 'purple'], ['plum', 'purple'],
  ['yellow gold', 'gold'], ['gold tone', 'gold'], ['copper', 'bronze'], ['stainless steel', 'steel'], ['stainless', 'steel'],
]);
const COLOR_TOKENS = new Set([...COLOR_TABLE.keys()]);

/**
 * Rotation color names in the order the words mention them, at most 4 ("Triple White" and
 * "White/White" -> ['white'], "Black / White" -> ['black', 'white']). Unknown words give [].
 * @param {string} text
 * @returns {string[]}
 */
export function guessColors(text) {
  return colorsOf(tokenize(text));
}

function colorsOf(tokens) {
  const names = [];
  for (const hit of scan(tokens, COLOR_TABLE)) if (!names.includes(hit.value)) names.push(hit.value);
  return names.slice(0, MAX_COLORS);
}

/**
 * Colors a title names, leaving out words that belong to a brand or model name ("Old Navy",
 * "Hamilton Khaki Field", "Tudor Black Bay"), including `brand` wherever it appears.
 */
function titleColors(text, brand) {
  const tokens = tokenize(text);
  const brandWords = tokenize(brand);
  for (const table of [BRAND_TABLE, MODEL_HINTS]) for (const hit of scan(tokens, table)) tokens.fill('', hit.start, hit.end);
  for (let i = 0; i < tokens.length; i += 1) if (startsAt(tokens, i, brandWords)) tokens.fill('', i, i + brandWords.length);
  return colorsOf(tokens);
}

// ---------- Names ----------

const compactOf = (text) => tokenize(text).join('');

// "Size: 32X34", "US Size 10.5", "Sz M", "Size 10.5 M US": a size someone typed into a listing title.
const SIZE_TEXT = /[,(]?\s*(?:\b(?:us|uk|eu)\s+)?\b(?:size|sz)\b\.?\s*[:#]?\s*(?:[a-z]{0,3}\d[a-z0-9./-]*|xx?[sl]|[sml]|xxl|os)\b(?:\s+[mw]\b)?(?:\s+(?:us|uk|eu)\b)?\)?/gi;
// Sizes listings carry without the word "size". A number counts only in brackets, or next to a
// gender or a region at the end (or before a comma), so model numbers stay: "Air Max 90",
// "Chuck 70", "Seiko 5", "501", "990v6".
const SIZE_PATTERNS = [
  // "(L)", "(US 10)", "[XL]", "(32x30)"
  /\s*[([]\s*(?:(?:us|uk|eu)\s*)?(?:(?:wo)?men(?:[’']?s)?\s*)?(?:xxs|xs|s|m|l|xl|xxl|xxxl|[2-5]xl|\d{1,2}(?:\.5)?\s*[mw]?|\d{2}\s*[x×]\s*\d{2})\s*[)\]]/gi,
  // Waist and inseam: "32x30", "32W x 30L" (not a case size in mm)
  /\b\d{2}\s?w?\s?[x×]\s?\d{2}(?:\s?l)?\b(?!\s?(?:mm|cm|in)\b)/gi,
  // "Men's 10.5", "Mens US 9", "Men / 11 Women"
  /[\s,]*\b(?:wo)?men(?:[’']?s)?\s*\/?\s*(?:(?:us|uk|eu)\s*)?\d{1,2}(?:\.5)?(?:\s*[mw]\b)?(?:\s*(?:us|uk|eu)\b)?(?=\s*(?:$|[,;|)]|(?:wo)?men\b))/gi,
  // "10 M US", "9.5 UK", "US 9" and ", 10" at the end
  /[\s,]*\b\d{1,2}(?:\.5)?\s*[mw]?\s*(?:us|uk|eu)\b(?=[\s,;|)]*$)/gi,
  /[\s,]*\b(?:us|uk|eu)\s*[mw]?\s*\d{1,2}(?:\.5)?(?=[\s,;|)]*$)/gi,
  /,\s*\d{1,2}(?:\.5)?\s*[mw]?(?=[\s,;|)]*$)/gi,
  // "Hoodie - XL" at the end
  /[\s,–—-]+(?:xxs|xs|xl|xxl|xxxl|[2-5]xl)(?=[\s,;|)]*$)/gi,
];
// "Reverse Weave Hoodie XL Oxford Gray": a letter size right after the garment word (S, M and L
// only in capitals).
const GARMENT_SIZE = /\b(hoodie|hoody|sweatshirt|sweater|t-shirt|tee|shirt|jacket|coat|pants|jeans|shorts|joggers|polo)\s+(xxs|xs|xl|xxl|xxxl|[2-5]xl|s|m|l)\b/gi;
// "... Men's Shoes", "... Unisex Sneaker Women", "... Big Kids'" at the end, "Men's ..." at the
// start (straight or curly apostrophe, or the "Men S" some listings show).
const GENDER_TAIL = /(?:[\s,/–—-]*\b(?:(?:wo)?men(?:[’']?s)?|unisex|(?:big |little )?kids[’']?|boys[’']?|girls[’']?)(?:\s+(?:shoes?|sneakers?))?)+\s*$/i;
const GENDER_HEAD = /^(?:(?:wo)?men ?[’']? ?s|unisex)\s+/i;

/**
 * The item name from a store title: the leading brand and listing noise go, and so do a trailing
 * "- Store" or "| Brand" segment, a "Men's Shoes" tail and any size ("Size: 32X34", "Men's 10.5",
 * "32x30", "(L)"), since a size is never taken from a page.
 */
function nameFromTitle(title, { brand, siteName, host }) {
  const parts = titleParts(title);
  if (!parts.raw.length) return '';
  const brandTokens = tokenize(brand);
  // The page's brand may itself start with a noise word ("New Republic"), so it ends the noise.
  let cut = leadingNoise(parts.tokens, brandTokens);
  const lead = leadingBrand(parts);
  const startsWithBrand = startsAt(parts.tokens, cut, brandTokens);
  if (lead && !lead.keep && (!brand || compactOf(lead.name) === compactOf(brand))) cut = lead.end;
  else if (startsWithBrand) cut += brandTokens.length;
  // Cut only between whole words; a brand glued to the next word stays in the name.
  const atWord = cut < parts.tokens.length && (cut === 0 || parts.wordOf[cut] !== parts.wordOf[cut - 1]);
  let name = (atWord ? parts.raw.slice(parts.wordOf[cut]) : cut >= parts.tokens.length ? [] : parts.raw).join(' ');

  name = name.replace(/[®™©\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  const pieces = name.split(/\s+\|\s+/);
  if (pieces.length > 1) name = pieces[0];
  const own = [brand, siteName, host, String(host ?? '').split('.')[0]].map(compactOf).filter(Boolean);
  const tail = /\s+[-–—|]\s+([^-–—|]+)$/.exec(name);
  if (tail) {
    const rest = name.slice(0, tail.index);
    const t = compactOf(tail[1]);
    if (own.includes(t) || (t && compactOf(rest).includes(t))) name = rest;
  }
  name = name.replace(SIZE_TEXT, '');
  for (const pattern of SIZE_PATTERNS) name = name.replace(pattern, '');
  name = name
    .replace(GARMENT_SIZE, (all, garment, size) => (size.length > 1 || /^[SML]$/.test(size) ? garment : all))
    .replace(GENDER_TAIL, '')
    .replace(GENDER_HEAD, '')
    .replace(/^[\s,;:|–—-]+|[\s,;:|–—-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name.slice(0, MAX_NAME).trim();
}

// ---------- Drafts ----------

/**
 * A draft custom item from a store page, a Bing Shopping listing or a web result, for the person
 * to confirm. `category` (a job's category, say) wins over the guess.
 * @param {{ page?: any, listing?: any, result?: any, query?: string|null, via: 'page'|'search'|'photo',
 *   now: number, category?: string|null }} input
 * @returns {{ category: string|null, custom: { brand: string, name: string, variantName: string|null,
 *   type: string|null, colors: string[] }, web: object, imageUrl: string|null } | null}
 *   null when the source has no usable link
 */
export function draftFromWeb({ page = null, listing = null, result = null, query = null, via, now, category = null } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const source = page ?? listing ?? result;
  if (!source || typeof source !== 'object') return null;
  const title = page ? page.name : source.title;
  const web = cleanWebSnapshot(
    {
      url: source.url,
      siteName: page ? page.siteName : listing ? listing.seller : null,
      title,
      brand: page?.brand ?? null,
      price: page?.price ?? listing?.price ?? null,
      availability: page?.availability ?? null,
      identifiers: { sku: page?.sku ?? null, gtin: page?.gtin ?? null, mpn: page?.mpn ?? null },
      color: page?.color ?? null,
      imageUrl: page ? (Array.isArray(page.images) ? page.images[0] : null) : listing?.imageUrl ?? null,
      via,
      query: via === 'page' ? null : query,
      fetchedAt: page?.fetchedAt ?? iso(nowMs),
    },
    nowMs,
  );
  if (!web) return null;

  const host = web.host ?? displayHost(web.url);
  const brand = guessBrand({ title: web.title, brand: web.brand, host });
  const name = nameFromTitle(web.title, { brand, siteName: web.siteName, host });
  const variantName = web.color;
  let guessed = CATEGORIES.includes(category) ? category : null;
  if (!guessed) {
    // The title's words decide (the brand goes first so the title's own last word stays the head);
    // the query's words, then the brand, speak only when those say nothing.
    let said = categoryFromWords([brand, web.title].filter(Boolean).join(' '));
    if (!said.decided) said = categoryFromWords(web.query);
    guessed = said.decided
      ? said.category
      : leadingBrand(titleParts(brand))?.brand?.category ?? leadingBrand(titleParts(web.query))?.brand?.category ?? null;
  }
  const typeText = [web.title, web.query].filter(Boolean).join(' ');
  const colors = guessColors(variantName ?? '');
  return {
    category: guessed,
    custom: {
      brand: brand ?? '',
      name,
      variantName,
      type: guessed ? guessType(guessed, typeText) : null,
      colors: colors.length ? colors : titleColors(name, brand),
    },
    web,
    imageUrl: web.imageUrl,
  };
}
