// Shared vocabulary and validators. See ARCHITECTURE.md section 4.1 for what each state means.

export const CATEGORIES = ['sneaker', 'watch', 'clothing'];
export const CATEGORY_LABEL = { sneaker: 'Sneakers', watch: 'Watches', clothing: 'Clothing' };
export const CATEGORY_SINGULAR = { sneaker: 'Sneaker', watch: 'Watch', clothing: 'Clothing item' };

/** Outfit limits. An outfit can fall below minItems when one of its items is deleted. */
export const OUTFIT_LIMITS = { nameMax: 60, notesMax: 500, minItems: 2, maxItems: 12 };

export const RETRIEVAL = ['candidate_found', 'similar_result', 'no_match', 'processing_error', 'not_run'];
export const IDENTITY = ['unconfirmed', 'user_confirmed', 'identifier_supported', 'manual'];
export const VARIANT_STATE = ['confirmed', 'incomplete', 'conflicting', 'not_applicable'];

export const OWNED_CONDITIONS = ['new', 'like_new', 'good', 'well_worn'];
export const OWNED_CONDITION_LABEL = {
  new: 'New, unworn',
  like_new: 'Like new',
  good: 'Good',
  well_worn: 'Well worn',
};

export const OFFER_CONDITIONS = ['new', 'used_like_new', 'used_good', 'used_fair'];
export const OFFER_CONDITION_LABEL = {
  new: 'New',
  used_like_new: 'Used, like new',
  used_good: 'Used, good',
  used_fair: 'Used, fair',
};

export const WISH_CONDITIONS = ['new_only', 'new_or_used'];
export const WISH_REASONS = ['want_exact', 'like_style', 'too_expensive', 'find_alternatives', 'match_owned'];
export const WISH_REASON_LABEL = {
  want_exact: 'I want this exact item',
  like_style: 'I like the style',
  too_expensive: "It's too expensive",
  find_alternatives: 'Find me alternatives',
  match_owned: 'It would match something I own',
};
/** Default intent for each reason; the person can change it. */
export const WISH_INTENT_FOR_REASON = {
  want_exact: 'exact',
  like_style: 'inspiration',
  too_expensive: 'inspiration',
  find_alternatives: 'inspiration',
  match_owned: 'complement',
};
export const WISH_INTENTS = ['exact', 'inspiration', 'complement'];
export const WISH_INTENT_LABEL = {
  exact: 'This exact item',
  inspiration: 'Inspiration: similar items are fine',
  complement: 'Something to go with what I own',
};

export const SIZE_SYSTEMS = ['US-M', 'US-W', 'EU', 'UK', 'ALPHA', 'WAIST-INSEAM', 'ONE-SIZE'];
export const ALPHA_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
export const US_SHOE_SIZES = ['6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '13', '14'];

export const ROLES = ['user', 'stylist', 'admin'];
export const HOME_FOR_ROLE = { user: '/discover', stylist: '/stylist', admin: '/admin' };

export const STYLE_TAGS = ['minimal', 'classic', 'street', 'sporty', 'outdoor', 'workwear', 'preppy', 'tech', 'vintage', 'dressy', 'bold'];
export const STYLE_LABEL = {
  minimal: 'Minimal',
  classic: 'Classic',
  street: 'Streetwear',
  sporty: 'Sporty',
  outdoor: 'Outdoor',
  workwear: 'Workwear',
  preppy: 'Preppy',
  tech: 'Technical',
  vintage: 'Vintage',
  dressy: 'Dressy',
  bold: 'Bold color',
};

export const INTENDED_USES = ['everyday', 'work', 'running', 'training', 'outdoors', 'going_out', 'formal'];
export const USE_LABEL = {
  everyday: 'Everyday',
  work: 'Work',
  running: 'Running',
  training: 'Training',
  outdoors: 'Outdoors',
  going_out: 'Going out',
  formal: 'Formal occasions',
};

export const FEEDBACK_TYPES = ['too_expensive', 'wrong_style', 'too_similar', 'more_like_this', 'saved'];
export const FEEDBACK_LABEL = {
  too_expensive: 'Too expensive',
  wrong_style: 'Not my style',
  too_similar: 'Too similar to what I have',
  more_like_this: 'More like this',
  saved: 'Saved',
};

export const EVIDENCE_KINDS = ['visual', 'color', 'identifier', 'brand_text', 'product_link', 'catalog_search', 'user_selection'];
export const EVIDENCE_SOURCES = ['image_features', 'ocr', 'barcode', 'user_entered', 'url', 'catalog'];

export const SELLER_TYPE_LABEL = {
  retailer: 'Retailer',
  authorized_dealer: 'Authorized dealer',
  independent_dealer: 'Independent dealer',
  marketplace_seller: 'Marketplace seller',
  private_seller: 'Private seller',
};

/** Product types per category; the illustration generator draws each of these. */
export const PRODUCT_TYPES = {
  sneaker: ['runner', 'court', 'trail', 'skate', 'high-top', 'slip-on'],
  watch: ['field', 'diver', 'dress', 'chronograph', 'gmt', 'digital', 'strap'],
  clothing: ['tee', 'oxford-shirt', 'overshirt', 'chore-jacket', 'field-jacket', 'bomber', 'hoodie', 'crewneck', 'chinos', 'trousers', 'jeans', 'shorts'],
};

export const TYPE_LABEL = {
  runner: 'Runner',
  court: 'Court',
  trail: 'Trail',
  skate: 'Skate',
  'high-top': 'High-top',
  'slip-on': 'Slip-on',
  field: 'Field watch',
  diver: 'Dive watch',
  dress: 'Dress watch',
  chronograph: 'Chronograph',
  gmt: 'GMT',
  digital: 'Digital',
  strap: 'Strap',
  tee: 'T-shirt',
  'oxford-shirt': 'Oxford shirt',
  overshirt: 'Overshirt',
  'chore-jacket': 'Chore jacket',
  'field-jacket': 'Field jacket',
  bomber: 'Bomber jacket',
  hoodie: 'Hoodie',
  crewneck: 'Crewneck sweater',
  chinos: 'Chinos',
  trousers: 'Trousers',
  jeans: 'Jeans',
  shorts: 'Shorts',
};

/** Clothing types that are worn on the lower body (sized waist × inseam). */
export const BOTTOM_TYPES = ['chinos', 'trousers', 'jeans', 'shorts'];

/** Watch strap attachment systems. A strap only "fits" when width and attachment both match. */
export const STRAP_ATTACHMENTS = ['spring_bar', 'quick_release', 'integrated'];

/**
 * Category-specific attribute rules. Each entry: [field, type, required].
 * Types: 'string', 'number', 'string[]', 'enum:a|b|c', 'date'.
 */
export const ATTRIBUTE_RULES = {
  sneaker: {
    product: [
      ['upperMaterial', 'string', false],
      ['soleType', 'string', false],
      ['closure', 'enum:laces|slip-on|strap', false],
      ['cut', 'enum:low|mid|high', true],
    ],
    variant: [['colorway', 'string', true]],
  },
  watch: {
    product: [
      ['movement', 'enum:automatic|manual|quartz|solar|digital', false],
      ['waterResistanceM', 'number', false],
      ['crystal', 'string', false],
      ['attachment', 'enum:spring_bar|quick_release|integrated', false],
    ],
    variant: [
      ['dialColor', 'string', false],
      ['caseMaterial', 'string', false],
      ['diameterMm', 'number', false],
      ['thicknessMm', 'number', false],
      ['lugToLugMm', 'number', false],
      ['lugWidthMm', 'number', false],
      ['bracelet', 'string', false],
      ['strapWidthMm', 'number', false],
    ],
  },
  clothing: {
    product: [
      ['fit', 'enum:slim|regular|relaxed|oversized', false],
      ['material', 'string', false],
      ['weight', 'string', false],
    ],
    variant: [['color', 'string', true]],
  },
};

function checkType(value, type) {
  if (type === 'string') return typeof value === 'string' && value.length > 0;
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string[]') return Array.isArray(value) && value.every((v) => typeof v === 'string');
  if (type === 'date') return typeof value === 'string' && !Number.isNaN(Date.parse(value));
  if (type.startsWith('enum:')) return type.slice(5).split('|').includes(value);
  return false;
}

/**
 * Validates category-specific attributes. Unknown fields are rejected so facts can't hide in
 * free-form JSON; null means "not sourced" and is allowed for optional fields.
 * @returns {string[]} problems (empty when valid)
 */
export function validateAttributes(category, level, attributes = {}) {
  const rules = ATTRIBUTE_RULES[category]?.[level];
  if (!rules) return [`Unknown category ${category}`];
  const problems = [];
  const known = new Set(rules.map(([f]) => f));
  for (const key of Object.keys(attributes)) {
    if (!known.has(key)) problems.push(`${level}.attributes.${key} is not a ${category} field`);
  }
  for (const [field, type, required] of rules) {
    const value = attributes[field];
    if (value == null) {
      if (required) problems.push(`${level}.attributes.${field} is required`);
      continue;
    }
    if (!checkType(value, type)) problems.push(`${level}.attributes.${field} must be ${type}`);
  }
  return problems;
}

/** Size systems allowed for a product. */
export function sizeSystemFor(category, type) {
  if (category === 'sneaker') return 'US-M';
  if (category === 'watch') return type === 'strap' ? 'ONE-SIZE' : null;
  return BOTTOM_TYPES.includes(type) ? 'WAIST-INSEAM' : 'ALPHA';
}

/** Validates a size object; returns an error message or null. */
export function validateSize(size, category) {
  if (size == null) return null;
  if (typeof size !== 'object' || typeof size.value !== 'string' || !size.value.trim()) return 'Enter a size';
  if (!SIZE_SYSTEMS.includes(size.system)) return 'Choose a sizing system';
  if (category === 'watch' && size.system !== 'ONE-SIZE') return 'Watches are not sized this way';
  if (size.system === 'WAIST-INSEAM' && !/^\d{2}x\d{2}$/.test(size.value)) return 'Use waist x inseam, like 32x32';
  if ((size.system === 'US-M' || size.system === 'US-W') && !/^\d{1,2}(\.5)?$/.test(size.value)) return 'Use a US size like 10 or 10.5';
  return null;
}
