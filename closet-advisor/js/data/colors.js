// Named colors used for catalog facts, photo color naming and pairing logic.
// Hex values are reference points for nearest-color naming, not exact product colors.

/** @type {Array<{ name: string, label: string, hex: string, family: string }>} */
export const COLORS = [
  { name: 'white', label: 'White', hex: '#f5f5f2', family: 'light-neutral' },
  { name: 'off-white', label: 'Off-white', hex: '#ece6d6', family: 'light-neutral' },
  { name: 'bone', label: 'Bone', hex: '#ddd3bd', family: 'light-neutral' },
  { name: 'light-grey', label: 'Light grey', hex: '#c4c6c4', family: 'light-neutral' },
  { name: 'grey', label: 'Grey', hex: '#8e9092', family: 'mid-neutral' },
  { name: 'charcoal', label: 'Charcoal', hex: '#45484c', family: 'dark-neutral' },
  { name: 'black', label: 'Black', hex: '#1e1f21', family: 'dark-neutral' },
  { name: 'navy', label: 'Navy', hex: '#1f2a44', family: 'dark-neutral' },
  { name: 'blue', label: 'Blue', hex: '#2f5fa8', family: 'cool' },
  { name: 'light-blue', label: 'Light blue', hex: '#9dbbdb', family: 'cool' },
  { name: 'teal', label: 'Teal', hex: '#2c7470', family: 'cool' },
  { name: 'green', label: 'Green', hex: '#3d8a4f', family: 'cool' },
  { name: 'forest', label: 'Forest green', hex: '#2b4532', family: 'earth' },
  { name: 'olive', label: 'Olive', hex: '#5d6136', family: 'earth' },
  { name: 'sage', label: 'Sage', hex: '#9aa58a', family: 'earth' },
  { name: 'khaki', label: 'Khaki', hex: '#b6a77c', family: 'earth' },
  { name: 'tan', label: 'Tan', hex: '#c09a6b', family: 'earth' },
  { name: 'gum', label: 'Gum', hex: '#b37a43', family: 'earth' },
  { name: 'camel', label: 'Camel', hex: '#a87a4c', family: 'earth' },
  { name: 'brown', label: 'Brown', hex: '#6b4a32', family: 'earth' },
  { name: 'rust', label: 'Rust', hex: '#a24d27', family: 'warm' },
  { name: 'burgundy', label: 'Burgundy', hex: '#6d2333', family: 'warm' },
  { name: 'red', label: 'Red', hex: '#c0322e', family: 'warm' },
  { name: 'orange', label: 'Orange', hex: '#e2742c', family: 'warm' },
  { name: 'mustard', label: 'Mustard', hex: '#c9a032', family: 'warm' },
  { name: 'yellow', label: 'Yellow', hex: '#ecd04a', family: 'warm' },
  { name: 'pink', label: 'Pink', hex: '#e3a3b1', family: 'warm' },
  { name: 'purple', label: 'Purple', hex: '#5d4382', family: 'cool' },
  { name: 'silver', label: 'Silver', hex: '#b9bcc0', family: 'metal-cool' },
  { name: 'steel', label: 'Steel', hex: '#9ca1a6', family: 'metal-cool' },
  { name: 'gunmetal', label: 'Gunmetal', hex: '#55595e', family: 'metal-cool' },
  { name: 'gold', label: 'Gold', hex: '#c7a254', family: 'metal-warm' },
  { name: 'rose-gold', label: 'Rose gold', hex: '#c69078', family: 'metal-warm' },
  { name: 'bronze', label: 'Bronze', hex: '#94714a', family: 'metal-warm' },
];

export const COLOR_BY_NAME = new Map(COLORS.map((c) => [c.name, c]));

/** Color names a person can pick as likes/avoids (metals excluded). */
export const PICKABLE_COLORS = COLORS.filter((c) => !c.family.startsWith('metal')).map((c) => c.name);

export function colorLabel(name) {
  return COLOR_BY_NAME.get(name)?.label ?? name;
}

export function colorHex(name) {
  return COLOR_BY_NAME.get(name)?.hex ?? '#999999';
}

export function colorFamily(name) {
  return COLOR_BY_NAME.get(name)?.family ?? null;
}

export function isNeutral(name) {
  const family = colorFamily(name);
  return family === 'light-neutral' || family === 'mid-neutral' || family === 'dark-neutral';
}

// ---- Color math (sRGB -> CIE Lab, D65) ----

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** @returns {[number, number, number]} */
export function rgbToLab(r, g, b) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
}

export function hexToLab(hex) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

export function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/** CIE76 color difference; adequate for naming and coarse similarity. */
export function deltaE(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const LAB_BY_NAME = new Map(COLORS.map((c) => [c.name, hexToLab(c.hex)]));

export function labOf(name) {
  return LAB_BY_NAME.get(name) ?? null;
}

/**
 * Nearest named color to a Lab value.
 * @param {[number,number,number]} lab
 * @param {{ includeMetals?: boolean }} [opts]
 */
export function nearestColorName(lab, opts = {}) {
  let best = null;
  let bestD = Infinity;
  for (const c of COLORS) {
    if (!opts.includeMetals && c.family.startsWith('metal')) continue;
    const d = deltaE(lab, LAB_BY_NAME.get(c.name));
    if (d < bestD) {
      bestD = d;
      best = c.name;
    }
  }
  return { name: best, distance: bestD };
}
