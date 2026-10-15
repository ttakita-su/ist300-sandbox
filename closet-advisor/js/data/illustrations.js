// Catalog illustration generator. Every catalog image in the prototype is drawn here from a
// variant's palette, so the prototype owns what it shows. Output is a standalone SVG string
// (viewBox 0 0 400 400) with no ids, no text nodes and no external references: it is safe as a
// data URL or inline, and the same spec always produces the same markup.
//
// Spec vocabulary (product.illustration merged with variant.illustration, see specFor):
//   sneaker  shape: runner | court | trail | skate | high-top | slip-on
//            details: { panels: plain|stripes|mudguard|wing|dots, heelTab, toeCap,
//                       sole?: cup|foam|lug|vulc, mark?: ring|dot|bar|tab|none }
//            palette: upper, overlay, sole, midsole, laces, accent, lining
//   watch    shape: round | cushion | square | tonneau | strap
//            bezel: plain|diver|fluted|tachymeter|gmt, hands: sword|dauphine|baton|mercedes,
//            indices: arabic|baton|dot|roman, complications: [date, chronograph, gmt, small-seconds],
//            display?: analog|digital, integrated?: boolean, pins?: spring_bar|quick_release
//            options: { strapKind: bracelet|leather|rubber|nato|mesh, stripes?: 0|1|2 }
//            palette: case, dial, bezel, bezelInsert, hands, indices, strap, strapStitch, lume,
//                     accent, subdial
//   clothing shape: tee | oxford-shirt | overshirt | chore-jacket | field-jacket | bomber | hoodie |
//                   crewneck | chinos | trousers | jeans | shorts
//            details: { pockets?, collar?, cuffs? }, options: { pattern: solid|stripe|check|heather }
//            palette: main, secondary, trim, buttons, stitching
//
// Only numbers and validated hex colors from the spec reach the markup, so a spec from an
// imported feed can't inject anything.

export const ILLUSTRATION_VERSION = 'flat-2026-10-14.1';

/** Palette parts each kind reads (documentation and feed validation). */
export const PALETTE_PARTS = {
  sneaker: ['upper', 'overlay', 'sole', 'midsole', 'laces', 'accent', 'lining'],
  watch: ['case', 'dial', 'bezel', 'bezelInsert', 'hands', 'indices', 'strap', 'strapStitch', 'lume', 'accent', 'subdial'],
  clothing: ['main', 'secondary', 'trim', 'buttons', 'stitching'],
};

export const SHAPES = {
  sneaker: ['runner', 'court', 'trail', 'skate', 'high-top', 'slip-on'],
  watch: ['round', 'cushion', 'square', 'tonneau', 'strap'],
  clothing: ['tee', 'oxford-shirt', 'overshirt', 'chore-jacket', 'field-jacket', 'bomber', 'hoodie', 'crewneck', 'chinos', 'trousers', 'jeans', 'shorts'],
};

// ---------- Numbers, colors, markup ----------

const n = (v) => String(Math.round(v * 10) / 10);
const pt = (x, y) => `${n(x)} ${n(y)}`;

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

/** Accepts #rgb or #rrggbb; anything else falls back. */
function hex(value, fallback) {
  if (typeof value === 'string') {
    if (HEX6.test(value)) return value.toLowerCase();
    if (HEX3.test(value)) return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
  }
  return fallback;
}

function rgbOf(h) {
  const v = Number.parseInt(h.slice(1), 16);
  return [v >> 16, (v >> 8) & 255, v & 255];
}

function mix(a, b, t) {
  const x = rgbOf(a);
  const y = rgbOf(b);
  const c = (i) => Math.max(0, Math.min(255, Math.round(x[i] + (y[i] - x[i]) * t)));
  return `#${((1 << 24) | (c(0) << 16) | (c(1) << 8) | c(2)).toString(16).slice(1)}`;
}

// Shadows lean toward a cool ink rather than pure black so shading stays clean on both tiles.
const INK = '#151726';
const shade = (c, t) => mix(c, INK, t);
const tint = (c, t) => mix(c, '#ffffff', t);

function luma(h) {
  const [r, g, b] = rgbOf(h);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Dark parts get a lighter rim instead of a darker line, so they still separate from the dark
// studio tile; lighter parts get a darker line so they separate from the light tile.
const edge = (c) => (luma(c) < 0.26 ? tint(c, 0.3) : shade(c, 0.42));
const isDark = (c) => luma(c) < 0.3;

function attrs(a) {
  let s = '';
  for (const k in a) {
    const v = a[k];
    if (v == null || v === false || v === '') continue;
    s += ` ${k}="${v}"`;
  }
  return s;
}

const path = (d, a = {}) => (d ? `<path d="${d}"${attrs(a)}/>` : '');
const circle = (cx, cy, r, a = {}) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"${attrs(a)}/>`;
const ellipse = (cx, cy, rx, ry, a = {}) => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}"${attrs(a)}/>`;
const rect = (x, y, w, h, rx, a = {}) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${rx ? ` rx="${n(rx)}"` : ''}${attrs(a)}/>`;
const group = (a, body) => (body ? `<g${attrs(a)}>${body}</g>` : '');
const filled = (fill, stroke, width = 2.2) => ({ fill, stroke, 'stroke-width': stroke ? n(width) : null });

// ---------- Paths and polygon geometry ----------

const cmdCache = new Map();

/** Parses absolute M/L/C/Q/Z path data written in this file. Results are cached. */
function parse(d) {
  if (cmdCache.has(d)) return cmdCache.get(d);
  const out = [];
  const arity = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
  const re = /([MLCQZ])([^MLCQZ]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const nums = m[2].trim() ? m[2].trim().split(/[\s,]+/).map(Number) : [];
    const k = arity[m[1]];
    if (!k) out.push([m[1]]);
    else for (let i = 0; i < nums.length; i += k) out.push([i && m[1] === 'M' ? 'L' : m[1], ...nums.slice(i, i + k)]);
  }
  cmdCache.set(d, out);
  return out;
}

function toD(cmds) {
  let s = '';
  for (const c of cmds) {
    s += c[0];
    for (let i = 1; i < c.length; i += 2) s += `${i > 1 ? ' ' : ''}${pt(c[i], c[i + 1])}`;
  }
  return s;
}

/** Points along the first subpath (curves sampled), for clipping and hit tests. */
function flatten(cmds, steps = 8) {
  const pts = [];
  let x = 0;
  let y = 0;
  for (const c of cmds) {
    if (c[0] === 'M' || c[0] === 'L') {
      if (c[0] === 'M' && pts.length) break;
      x = c[1];
      y = c[2];
      pts.push([x, y]);
    } else if (c[0] === 'Q') {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        pts.push([u * u * x + 2 * u * t * c[1] + t * t * c[3], u * u * y + 2 * u * t * c[2] + t * t * c[4]]);
      }
      x = c[3];
      y = c[4];
    } else if (c[0] === 'C') {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const cc = 3 * u * t * t;
        const dd = t * t * t;
        pts.push([a * x + b * c[1] + cc * c[3] + dd * c[5], a * y + b * c[2] + cc * c[4] + dd * c[6]]);
      }
      x = c[5];
      y = c[6];
    }
  }
  return pts;
}

const polyCache = new Map();
function polyOf(d) {
  if (!polyCache.has(d)) polyCache.set(d, flatten(parse(d)));
  return polyCache.get(d);
}

/** Sutherland-Hodgman against the half-plane a*x + b*y + c >= 0. */
function clipHalf(poly, a, b, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = a * p[0] + b * p[1] + c;
    const fq = a * q[0] + b * q[1] + c;
    if (fp >= 0) out.push(p);
    if (fp >= 0 !== fq >= 0) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

const clipBelow = (poly, y) => clipHalf(poly, 0, 1, -y);
const clipAbove = (poly, y) => clipHalf(poly, 0, -1, y);
const clipRight = (poly, x) => clipHalf(poly, 1, 0, -x);
const clipLeft = (poly, x) => clipHalf(poly, -1, 0, x);
const clipRect = (poly, x0, y0, x1, y1) => clipAbove(clipBelow(clipLeft(clipRight(poly, x0), x1), y0), y1);

function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** Clips a polygon to a convex polygon. */
function clipConvex(poly, clip) {
  const s = signedArea(clip) > 0 ? 1 : -1;
  let out = poly;
  for (let i = 0; i < clip.length && out.length; i++) {
    const [px, py] = clip[i];
    const [qx, qy] = clip[(i + 1) % clip.length];
    out = clipHalf(out, -(qy - py) * s, (qx - px) * s, ((qy - py) * px - (qx - px) * py) * s);
  }
  return out;
}

function polyD(pts) {
  if (pts.length < 3) return '';
  let s = `M${pt(pts[0][0], pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) s += `L${pt(pts[i][0], pts[i][1])}`;
  return `${s}Z`;
}

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Horizontal spans [x0, x1] where the line at y is inside the polygon. */
function spans(poly, y) {
  const xs = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}

/** Distance from a point to the polygon outline (for keeping marks off the edges). */
function edgeDistance(poly, x, y) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

const mirrorPt = ([x, y]) => [400 - x, y];

/** Mirrors path data across x = 200 (keeps the drawing order). */
function mirrorD(d) {
  return toD(parse(d).map((c) => (c.length > 1 ? [c[0], ...c.slice(1).flatMap((v, i) => (i % 2 ? [] : mirrorPt([v, c[i + 2]])))] : c)));
}

/**
 * A symmetric outline from its right half: the half runs from the top center to the bottom
 * center; the mirrored half is appended in reverse so the result is one closed path.
 */
function symmetric(half) {
  const key = `sym:${half}`;
  if (cmdCache.has(key)) return cmdCache.get(key);
  const cmds = parse(half).filter((c) => c[0] !== 'Z');
  const segs = [];
  let cur = [cmds[0][1], cmds[0][2]];
  for (const c of cmds.slice(1)) {
    const to = [c[c.length - 2], c[c.length - 1]];
    const ctrl = [];
    for (let i = 1; i < c.length - 2; i += 2) ctrl.push([c[i], c[i + 1]]);
    segs.push({ type: c[0], from: cur, ctrl, to });
    cur = to;
  }
  const out = [...cmds];
  for (const s of segs.reverse()) {
    out.push([s.type, ...s.ctrl.slice().reverse().map(mirrorPt).flat(), ...mirrorPt(s.from)]);
  }
  out.push(['Z']);
  const d = toD(out);
  cmdCache.set(key, d);
  return d;
}

/** Points along a polyline at even spacing (inclusive of the ends when count > 1). */
function along(x0, y0, x1, y1, count, inset = 0) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : inset + ((1 - 2 * inset) * i) / (count - 1);
    pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
  }
  return pts;
}

/** Deterministic pseudo-random sequence from a string (for heather speckles). */
function seeded(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Glyphs (stroke numerals; no text nodes, so renders don't depend on fonts) ----------

// Digits on a 6 x 10 grid, drawn with strokes.
const DIGITS = {
  0: 'M3 0C6.3 0 6.3 10 3 10C-.3 10-.3 0 3 0Z',
  1: 'M1.2 2.2L3.6 0L3.6 10',
  2: 'M.4 2.4C.6 -.4 5.6 -.6 5.6 2.6C5.6 5 .4 7.2 .3 10L5.8 10',
  3: 'M.5 1.2C1.8 -.4 5.6 -.3 5.5 2.4C5.4 4.4 3.4 4.8 2.2 4.8C3.6 4.8 5.9 5.2 5.8 7.6C5.6 10.6 1.4 10.6 .2 8.6',
  4: 'M4.4 10L4.4 0L.1 7L5.9 7',
  5: 'M5.4 0L1.1 0L.6 4.4C2.4 3.4 5.9 3.6 5.9 6.8C5.9 10.4 1.5 10.6 .2 8.7',
  6: 'M5.2 .9C2.2 -.9 .3 2.4 .3 6.2C.3 8.9 1.5 10 3 10C4.6 10 5.8 8.8 5.8 6.8C5.8 4.8 4.5 3.8 3 3.8C1.5 3.8 .4 4.9 .3 6.2',
  7: 'M.1 0L5.9 0L2.2 10',
  8: 'M3 4.7C.6 4.7 .7 0 3 0C5.3 0 5.4 4.7 3 4.7C.1 4.7 .1 10 3 10C5.9 10 5.9 4.7 3 4.7Z',
  9: 'M.8 9.1C3.8 10.9 5.7 7.6 5.7 3.8C5.7 1.1 4.5 0 3 0C1.4 0 .2 1.2 .2 3.2C.2 5.2 1.5 6.2 3 6.2C4.5 6.2 5.6 5.1 5.7 3.8',
};

/** Places a string of digits centered at (cx, cy) with the given height; returns path data. */
function digitsD(text, cx, cy, h) {
  const s = h / 10;
  const gap = 1.4 * s;
  const w = 6 * s;
  const total = text.length * w + (text.length - 1) * gap;
  let x = cx - total / 2;
  let out = '';
  for (const ch of text) {
    const glyph = DIGITS[ch];
    if (glyph) {
      const ox = x;
      const oy = cy - h / 2;
      out += toD(parse(glyph).map((c) => (c.length > 1 ? [c[0], ...c.slice(1).map((v, i) => (i % 2 ? oy + v * s : ox + v * s))] : c)));
    }
    x += w + gap;
  }
  return out;
}

const ROMAN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

/** Roman numeral strokes centered at (cx, top) reading upright, height h. */
function romanD(text, cx, top, h) {
  const widths = { I: 0.18, V: 0.62, X: 0.62 };
  const gap = 0.16 * h;
  const total = [...text].reduce((sum, ch) => sum + widths[ch] * h, 0) + gap * (text.length - 1);
  let x = cx - total / 2;
  let d = '';
  const b = top + h;
  for (const ch of text) {
    const w = widths[ch] * h;
    if (ch === 'I') d += `M${pt(x + w / 2, top)}L${pt(x + w / 2, b)}`;
    if (ch === 'V') d += `M${pt(x, top)}L${pt(x + w / 2, b)}L${pt(x + w, top)}`;
    if (ch === 'X') d += `M${pt(x, top)}L${pt(x + w, b)}M${pt(x + w, top)}L${pt(x, b)}`;
    x += w + gap;
  }
  return d;
}

// Seven-segment layout for digital displays, on a 10 x 18 cell.
const SEGMENTS = {
  a: [1.6, 0, 8.4, 0],
  b: [10, 1.6, 10, 7.4],
  c: [10, 10.6, 10, 16.4],
  d: [1.6, 18, 8.4, 18],
  e: [0, 10.6, 0, 16.4],
  f: [0, 1.6, 0, 7.4],
  g: [1.6, 9, 8.4, 9],
};
const SEG_DIGITS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];

function segmentD(text, x, y, h) {
  const s = h / 18;
  let d = '';
  let cx = x;
  for (const ch of text) {
    if (ch === ':') {
      d += `M${pt(cx + 1.5 * s, y + 5 * s)}L${pt(cx + 1.5 * s, y + 5.2 * s)}M${pt(cx + 1.5 * s, y + 13 * s)}L${pt(cx + 1.5 * s, y + 13.2 * s)}`;
      cx += 5 * s;
      continue;
    }
    for (const seg of SEG_DIGITS[Number(ch)] ?? '') {
      const [x0, y0, x1, y1] = SEGMENTS[seg];
      d += `M${pt(cx + x0 * s, y + y0 * s)}L${pt(cx + x1 * s, y + y1 * s)}`;
    }
    cx += 15 * s;
  }
  return d;
}

// ---------- Shared pieces ----------

/** Soft ground shadow: stacked translucent ellipses read as a blur without filters. */
function groundShadow(cx, cy, rx, ry) {
  return group({ fill: INK }, [
    ellipse(cx, cy, rx, ry, { 'fill-opacity': '.06' }),
    ellipse(cx, cy, rx * 0.86, ry * 0.72, { 'fill-opacity': '.07' }),
    ellipse(cx, cy, rx * 0.7, ry * 0.46, { 'fill-opacity': '.08' }),
  ].join(''));
}

// ---------- Sneakers (side profile, toe to the right) ----------

// Each profile: upper outline, far-side lining seen in the collar, lace line (or none), the
// line where the upper meets the sole (for panels), sole kind and the parts that differ.
const SNEAKERS = {
  court: {
    upper: 'M56 258C47 232 46 196 58 168C72 161 94 164 112 176C124 164 138 152 154 147C160 145 166 147 167 153L171 157C206 172 236 190 262 202C292 212 324 217 344 228C357 235 364 247 361 258Z',
    lining: 'M60 169C88 156 122 150 154 147C138 152 124 164 112 176C94 164 72 161 60 169Z',
    collar: 'M60 169C72 161 94 164 112 176',
    lace: [172, 157, 258, 200, 6],
    base: [50, 252, 362, 252],
    heel: 'M56 258C47 232 46 202 51 182C67 187 85 212 93 258Z',
    tab: 'M58 168C52 177 48 189 47.4 203L58 204C58.4 191 62 179 68 171Z',
    toeCap: 'M296 213C322 217 346 226 356 238C362 246 362 252 361 258L304 258C294 245 292 228 296 213Z',
    toeLine: 'M270 206C300 214 330 219 348 230',
    mark: [122, 218],
    sole: 'cup',
  },
  runner: {
    upper: 'M60 236C50 212 50 176 62 154C80 148 101 155 118 167C131 151 147 138 163 132C169 130 175 133 175 140L179 145C214 165 246 186 274 199C304 208 330 214 346 226C356 233 360 243 356 252L60 252Z',
    lining: 'M63 155C96 141 130 134 163 132C147 138 131 151 118 167C101 155 80 148 63 155Z',
    collar: 'M63 155C80 148 101 155 118 167',
    lace: [180, 145, 272, 198, 6],
    base: [52, 228, 356, 246],
    heel: 'M60 252C50 228 49 198 55 180C72 184 92 212 100 252Z',
    pull: 'M57 160C55 150 55 139 58 128L69 130C67 140 67 150 69 158Z',
    toeCap: 'M300 208C326 213 346 222 354 232C359 239 359 246 357 252L310 252C298 240 296 222 300 208Z',
    toeLine: 'M282 202C310 209 334 216 348 228',
    mark: [126, 210],
    sole: 'foam',
  },
  trail: {
    upper: 'M58 240C48 214 48 178 60 154C78 147 100 152 118 164C131 149 146 137 162 131C169 129 175 132 175 139L179 144C214 163 247 185 276 197C306 206 333 213 348 226C357 234 361 243 357 252L58 252Z',
    lining: 'M61 155C95 141 130 133 162 131C146 137 131 149 118 164C100 152 78 147 61 155Z',
    collar: 'M61 155C78 147 100 152 118 164',
    lace: [180, 144, 274, 196, 6],
    base: [50, 236, 358, 246],
    heel: 'M58 250C48 226 48 198 54 180C72 186 92 214 98 250Z',
    pull: 'M56 162C53 152 53 141 56 131L66 132C64 142 65 152 67 160Z',
    toeCap: 'M302 206C328 211 348 221 355 232C360 240 360 246 358 252L312 252C300 240 297 222 302 206Z',
    toeLine: 'M284 200C312 207 336 215 349 227',
    mark: [128, 210],
    sole: 'lug',
  },
  skate: {
    upper: 'M56 246C48 216 48 180 60 157C76 149 98 153 118 164C131 150 147 140 165 136C173 134 179 138 179 146L183 151C215 168 245 187 270 198C302 207 330 212 348 224C358 231 363 240 360 248L56 248Z',
    lining: 'M59 158C95 145 132 138 165 136C147 140 131 150 118 164C98 153 76 149 59 158Z',
    collar: 'M59 158C76 149 98 153 118 164',
    lace: [184, 151, 268, 197, 5],
    base: [48, 240, 362, 240],
    heel: 'M56 248C48 220 48 198 53 182C70 186 88 212 94 248Z',
    tab: 'M59 159C54 168 50 180 49.5 194L60 195C60.5 183 64 172 69 162Z',
    toeCap: 'M292 204C320 209 344 218 354 230C360 237 361 243 360 248L300 248C290 234 287 218 292 204Z',
    toeLine: 'M276 201C304 208 330 214 346 225',
    mark: [118, 208],
    sole: 'vulc',
  },
  'high-top': {
    upper: 'M54 256C44 218 42 136 50 90C72 82 108 82 134 90C144 83 157 77 168 77C177 77 181 83 177 91L178 98C192 144 228 186 262 202C292 212 324 218 344 229C357 236 364 247 361 256Z',
    lining: 'M52 91C84 78 132 74 168 77C157 77 144 83 134 90C108 82 72 82 52 91Z',
    collar: 'M52 91C72 83 108 83 134 90',
    lace: [179, 99, 258, 199, 8],
    base: [50, 252, 362, 252],
    heel: 'M54 256C45 224 44 194 49 170C68 176 86 210 94 256Z',
    tab: 'M50 92C45 108 43 124 42.6 140L53 141C53.4 125 55 109 59 94Z',
    toeCap: 'M296 213C322 217 346 226 356 238C362 246 362 252 361 256L304 256C294 244 292 228 296 213Z',
    toeLine: 'M268 205C298 214 330 220 348 231',
    patch: [62, 108, 24, 16],
    mark: [108, 204],
    sole: 'cup',
  },
  'slip-on': {
    upper: 'M54 248C46 222 46 194 58 174C82 168 112 171 140 180C156 186 170 191 186 193C226 197 262 204 292 212C320 219 342 226 354 236C362 242 362 248 358 250L54 250Z',
    lining: 'M60 175C98 163 146 172 186 193C170 191 156 186 140 180C112 171 82 168 60 175Z',
    collar: 'M60 175C82 168 112 171 140 180',
    lace: null,
    gore: 'M148 183L190 194L170 226Z',
    vamp: 'M188 193C226 197 262 204 292 212C320 219 342 226 354 236C360 241 361 245 360 250L214 250C202 234 193 214 188 193Z',
    base: [50, 242, 360, 242],
    heel: 'M54 250C46 224 46 202 51 186C68 190 86 214 92 250Z',
    pull: 'M57 179C54 170 54 161 57 153L66 154C64 162 64 170 66 177Z',
    toeCap: 'M294 212C320 218 342 226 352 234C359 240 360 245 359 250L302 250C292 238 289 225 294 212Z',
    toeLine: 'M272 208C302 215 330 222 348 232',
    mark: [112, 214],
    sole: 'vulc',
  },
};

const SOLES = {
  cup: {
    wall: 'M46 274C46 258 47 252 55 252L352 252C364 252 370 260 370 270C370 282 362 289 348 289L62 289C52 289 46 284 46 274Z',
    outsoleTop: 282,
    stitch: 'M56 261L361 261',
  },
  foam: {
    wall: 'M50 226C110 230 230 242 352 245C364 245 371 252 368 260C362 272 330 279 286 280L72 282C57 282 47 275 46 260L46 236C46 230 47 226 50 226Z',
    outsole: 'M60 281L286 279C324 278 352 272 366 262C368 266 368 270 364 274C350 284 320 289 286 289L62 290C55 290 51 288 51 285Z',
    sculpt: 'M66 263C112 255 152 269 200 263C250 257 300 263 344 257',
  },
  lug: {
    wall: 'M48 234C110 238 232 246 354 247C365 247 370 254 368 262C366 270 356 274 340 274L66 276C54 276 47 270 46 260L46 242C46 237 46 234 48 234Z',
    outsole: 'M52 274L344 272C356 272 365 268 368 262C370 266 370 272 366 276C360 281 352 283 344 283L58 284C53 284 50 281 50 278Z',
    bumper: 'M322 250C330 242 344 237 355 239C363 241 368 248 368 256L366 262L330 261C323 258 319 254 322 250Z',
    sculpt: 'M62 258C110 252 170 262 230 258C280 255 320 258 350 256',
  },
  vulc: {
    wall: 'M44 272C44 248 44 240 52 240L356 240C366 240 371 249 371 264C371 281 363 290 348 290L60 290C50 290 44 285 44 272Z',
    outsoleTop: 283,
    foxing: 'M47 249L368 249',
    bumper: 'M320 240C340 238 360 240 367 250L371 264L328 264C322 257 318 248 320 240Z',
  },
};

function sneakerPalette(pal) {
  const upper = hex(pal.upper, '#d9d9d4');
  const sole = hex(pal.sole, '#f2f1ec');
  const overlay = hex(pal.overlay, shade(upper, 0.08));
  return {
    upper,
    overlay,
    sole,
    midsole: hex(pal.midsole, sole),
    laces: hex(pal.laces, tint(upper, 0.1)),
    accent: hex(pal.accent, overlay),
    lining: hex(pal.lining, shade(upper, 0.16)),
  };
}

/** Line y = f(x) through the base points, shifted up by `off`. */
function baseLine(base, off) {
  const [x0, y0, x1, y1] = base;
  const m = (y1 - y0) / (x1 - x0);
  return { m, b: y0 - m * x0 - off };
}

/** Part of the polygon between two lines parallel to the base (offsets above the base). */
function alongBase(poly, base, offLow, offHigh) {
  const lo = baseLine(base, offLow);
  const hi = baseLine(base, offHigh);
  // keep y <= m x + lo.b  and  y >= m x + hi.b
  return clipHalf(clipHalf(poly, lo.m, -1, lo.b), -hi.m, 1, -hi.b);
}

function drawSneaker(spec, pal) {
  const shape = SNEAKERS[spec.shape] ? spec.shape : 'runner';
  const s = SNEAKERS[shape];
  const details = spec.details ?? {};
  const p = sneakerPalette(pal);
  const soleKind = SOLES[details.sole] ? details.sole : s.sole;
  const sole = SOLES[soleKind];
  const panels = ['plain', 'stripes', 'mudguard', 'wing', 'dots'].includes(details.panels) ? details.panels : 'plain';
  const upperPoly = polyOf(s.upper);
  const stitchColor = isDark(p.overlay) ? tint(p.overlay, 0.34) : shade(p.overlay, 0.3);
  const out = [];

  out.push(groundShadow(206, 291, 170, 12));

  // Pull tabs sit behind the upper and stick out above the collar.
  if (s.pull && details.heelTab !== false) out.push(path(s.pull, filled(p.accent, edge(p.accent), 2)));
  out.push(path(s.lining, filled(p.lining, edge(p.lining), 2)));
  out.push(path(s.upper, filled(p.upper, edge(p.upper))));

  // Soft shading: the lower edge of the upper falls into shadow above the sole.
  out.push(path(polyD(alongBase(upperPoly, s.base, -8, 12)), { fill: shade(p.upper, 0.08), 'fill-opacity': '.7' }));

  // Panels.
  if (panels === 'stripes') {
    // Horizontal stitched overlays along the quarter (not diagonal stripes).
    for (const [lo, hi] of [[30, 42], [50, 62]]) {
      out.push(path(polyD(clipRect(alongBase(upperPoly, s.base, lo, hi), 96, 0, 300, 400)), filled(p.overlay, edge(p.overlay), 1.6)));
      const stitch = clipRect(alongBase(upperPoly, s.base, lo + 2.6, hi - 2.6), 100, 0, 296, 400);
      out.push(path(polyD(stitch), { fill: 'none', stroke: stitchColor, 'stroke-width': '1.1', 'stroke-dasharray': '3 2.4' }));
    }
  } else if (panels === 'mudguard') {
    const poly = alongBase(upperPoly, s.base, -10, 26);
    out.push(path(polyD(poly), filled(p.overlay, edge(p.overlay), 1.8)));
    const line = baseLine(s.base, 21);
    out.push(path(`M${pt(62, line.m * 62 + line.b)}L${pt(352, line.m * 352 + line.b)}`, { stroke: stitchColor, 'stroke-width': '1.4', 'stroke-dasharray': '4 3', fill: 'none', 'stroke-opacity': '.9' }));
  } else if (panels === 'wing') {
    const [lx, ly] = s.lace ? [s.lace[2] + 6, s.lace[3] + 4] : [250, 200];
    const sx = 150;
    const sy = baseLine(s.base, 0).m * sx + baseLine(s.base, 0).b;
    const seam = flatten(parse(`M${pt(lx, ly)}Q${pt(lx - 60, ly - 4)} ${pt(sx, sy)}`));
    const region = [...seam, [sx - 10, 330], [440, 330], [440, ly - 30]];
    const poly = clipConvex(upperPoly, region);
    out.push(path(polyD(poly), filled(p.overlay, edge(p.overlay), 1.8)));
    // Perforations follow the seam, a nod to wingtip broguing.
    const dots = seam.filter((_, i) => i % 1 === 0).map(([x, y]) => [x + 3, y + 6]).filter(([x, y]) => inside(upperPoly, x, y) && edgeDistance(upperPoly, x, y) > 4);
    out.push(path(dots.map(([x, y]) => `M${pt(x, y)}h.1`).join(''), { stroke: stitchColor, 'stroke-width': '3', fill: 'none' }));
  }

  if (s.heel) out.push(path(s.heel, filled(p.overlay, edge(p.overlay), 1.8)));
  if (details.toeCap) out.push(path(s.toeCap, filled(p.overlay, edge(p.overlay), 1.8)));

  if (panels === 'dots') {
    const holes = [];
    for (let y = 212; y <= 246; y += 8) {
      for (let x = 286 + ((y / 8) % 2) * 4; x <= 350; x += 9) {
        if (inside(upperPoly, x, y) && edgeDistance(upperPoly, x, y) > 6 && y < 240) holes.push([x, y]);
      }
    }
    for (let y = 196; y <= 230; y += 9) {
      for (let x = 112 + ((y / 9) % 2) * 5; x <= 230; x += 10) {
        if (inside(upperPoly, x, y) && edgeDistance(upperPoly, x, y) > 8 && y < baseLine(s.base, 16).m * x + baseLine(s.base, 16).b) holes.push([x, y]);
      }
    }
    out.push(path(holes.map(([x, y]) => `M${pt(x, y)}h.1`).join(''), { stroke: shade(p.upper, 0.42), 'stroke-width': '3.2', fill: 'none' }));
  }

  // Lacing or elastic gore.
  if (s.lace) out.push(lacing(s.lace, p));
  if (s.gore) {
    out.push(path(s.gore, filled(shade(p.upper, 0.28), edge(p.upper), 1.6)));
    const ribs = [];
    for (let x = 156; x < 186; x += 4.5) ribs.push(`M${pt(x, 184 + (x - 148) * 0.26)}L${pt(x, 222 - Math.abs(x - 170) * 1.1)}`);
    out.push(path(ribs.join(''), { stroke: shade(p.upper, 0.45), 'stroke-width': '1.2', fill: 'none' }));
  }
  if (s.vamp) out.push(path(s.vamp, filled(p.overlay, edge(p.overlay), 1.8)));

  if (details.heelTab && s.tab) out.push(path(s.tab, filled(p.accent, edge(p.accent), 1.6)));
  if (s.patch) {
    const [x, y, w, h] = s.patch;
    out.push(rect(x, y, w, h, 3, filled(p.accent, edge(p.accent), 1.4)));
  }
  out.push(brandMark(details.mark ?? 'ring', s.mark, p));

  // Toe highlight: a light line along the top of the toe box.
  out.push(path(s.toeLine, { stroke: tint(p.upper, 0.45), 'stroke-width': '3', fill: 'none', 'stroke-opacity': isDark(p.upper) ? '.45' : '.7' }));

  out.push(drawSole(soleKind, sole, p, shape === 'trail' || Boolean(details.toeCap)));

  // Padded collar.
  out.push(path(s.collar, { stroke: tint(p.upper, 0.18), 'stroke-width': '4', fill: 'none', 'stroke-opacity': '.8' }));
  // Sneakers are wide and low; lift them so the shoe and its shadow sit centered.
  return group({ transform: 'translate(0 -12)' }, out.join(''));
}

function lacing([x0, y0, x1, y1, count], p) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  // Normal pointing below the lace line (into the upper).
  const nx = -uy;
  const ny = ux;
  const t = 14;
  const stay = [[x0 - ux * 4, y0 - uy * 4], [x1 + ux * 6, y1 + uy * 6], [x1 + ux * 6 + nx * t, y1 + uy * 6 + ny * t], [x0 - ux * 2 + nx * t, y0 - uy * 2 + ny * t]];
  const holes = along(x0, y0, x1, y1, count, 0.06).map(([x, y]) => [x + nx * 7, y + ny * 7]);
  const laces = holes.map(([x, y]) => `M${pt(x, y)}L${pt(x - nx * 11 + ux * 6, y - ny * 11 + uy * 6)}`).join('');
  return [
    path(polyD(stay), filled(p.overlay, edge(p.overlay), 1.6)),
    path(holes.map(([x, y]) => `M${pt(x, y)}h.1`).join(''), { stroke: shade(p.overlay, 0.5), 'stroke-width': '5', fill: 'none' }),
    path(laces, { stroke: edge(p.laces), 'stroke-width': '6.4', fill: 'none' }),
    path(laces, { stroke: p.laces, 'stroke-width': '4', fill: 'none' }),
  ].join('');
}

// Abstract, fictional marks only: a ring, a dot, a short bar or a heel label.
function brandMark(kind, [x, y], p) {
  if (kind === 'none') return '';
  if (kind === 'dot') return circle(x, y, 6, filled(p.accent, edge(p.accent), 1.4));
  if (kind === 'bar') return rect(x - 15, y - 4, 30, 8, 4, filled(p.accent, edge(p.accent), 1.4));
  if (kind === 'tab') return rect(x - 10, y - 7, 20, 14, 2.5, filled(p.accent, edge(p.accent), 1.4));
  return circle(x, y, 7, { fill: 'none', stroke: p.accent, 'stroke-width': '3.4' });
}

function drawSole(kind, sole, p, bumper) {
  const out = [];
  const wallEdge = edge(p.midsole);
  out.push(path(sole.wall, filled(p.midsole, wallEdge)));
  if (kind === 'cup' || kind === 'vulc') {
    const bottom = clipBelow(polyOf(sole.wall), sole.outsoleTop);
    const bottomColor = p.sole === p.midsole ? shade(p.sole, 0.12) : p.sole;
    out.push(path(polyD(bottom), { fill: bottomColor }));
    if (sole.stitch) out.push(path(sole.stitch, { stroke: shade(p.midsole, 0.32), 'stroke-width': '1.6', 'stroke-dasharray': '5 4', fill: 'none' }));
    if (sole.foxing) out.push(path(sole.foxing, { stroke: shade(p.midsole, 0.22), 'stroke-width': '2.4', fill: 'none' }));
    if (sole.bumper) out.push(path(sole.bumper, filled(tint(p.midsole, 0.06), wallEdge, 1.6)));
    if (kind === 'vulc') {
      const ticks = [];
      for (let x = 58; x < 352; x += 7) ticks.push(`M${x} 284L${x} 288`);
      out.push(path(ticks.join(''), { stroke: shade(bottomColor, 0.2), 'stroke-width': '1.4', fill: 'none' }));
    }
    out.push(path(sole.wall, { fill: 'none', stroke: wallEdge, 'stroke-width': '2.2' }));
  } else {
    out.push(path(sole.sculpt, { stroke: shade(p.midsole, 0.14), 'stroke-width': '2.2', fill: 'none' }));
    out.push(path(sole.outsole, filled(p.sole, edge(p.sole), 2)));
    if (kind === 'lug') {
      const lugs = [];
      for (let x = 60; x < 340; x += 21) lugs.push(`M${x} 283L${x + 13} 283L${x + 12} 291L${x + 1} 291Z`);
      out.push(path(lugs.join(''), filled(shade(p.sole, 0.06), edge(p.sole), 1.6)));
      if (bumper) out.push(path(sole.bumper, filled(shade(p.overlay, 0.08), edge(p.overlay), 1.8)));
    }
  }
  return out.join('');
}

// ---------- Watches (front view, 12 o'clock up) ----------

const CX = 200;
const CY = 200;
// The classic product-shot time, 10:08:37: hands frame the dial without covering it.
const HOUR_ANGLE = (10 + 8 / 60) * 30;
const MINUTE_ANGLE = (8 + 37 / 60) * 6;
const SECOND_ANGLE = 37 * 6;
const GMT_ANGLE = ((22 + 8 / 60) / 24) * 360;

function watchPalette(pal) {
  const kase = hex(pal.case, '#b9bcc0');
  const dial = hex(pal.dial, '#1f2022');
  const hands = hex(pal.hands, luma(dial) < 0.5 ? '#f1f1ee' : '#1f2022');
  const strap = hex(pal.strap, '#6b4a32');
  return {
    case: kase,
    dial,
    bezel: hex(pal.bezel, kase),
    bezelInsert: hex(pal.bezelInsert, shade(dial, 0.1)),
    hands,
    indices: hex(pal.indices, hands),
    strap,
    strapStitch: hex(pal.strapStitch, isDark(strap) ? tint(strap, 0.42) : shade(strap, 0.3)),
    lume: hex(pal.lume, '#e8efd8'),
    accent: hex(pal.accent, '#c0322e'),
    subdial: hex(pal.subdial, isDark(dial) ? tint(dial, 0.1) : shade(dial, 0.1)),
  };
}

/** Rounded rectangle with optionally bulging sides (cushion and tonneau cases). */
function softRect(cx, cy, hw, hh, r, bulgeX = 0, bulgeY = 0) {
  const x0 = cx - hw;
  const x1 = cx + hw;
  const y0 = cy - hh;
  const y1 = cy + hh;
  return `M${pt(x0 + r, y0)}Q${pt(cx, y0 - bulgeY)} ${pt(x1 - r, y0)}Q${pt(x1, y0)} ${pt(x1, y0 + r)}Q${pt(x1 + bulgeX, cy)} ${pt(x1, y1 - r)}Q${pt(x1, y1)} ${pt(x1 - r, y1)}Q${pt(cx, y1 + bulgeY)} ${pt(x0 + r, y1)}Q${pt(x0, y1)} ${pt(x0, y1 - r)}Q${pt(x0 - bulgeX, cy)} ${pt(x0, y0 + r)}Q${pt(x0, y0)} ${pt(x0 + r, y0)}Z`;
}

function circleD(cx, cy, r) {
  return `M${pt(cx - r, cy)}C${pt(cx - r, cy - r * 0.552)} ${pt(cx - r * 0.552, cy - r)} ${pt(cx, cy - r)}C${pt(cx + r * 0.552, cy - r)} ${pt(cx + r, cy - r * 0.552)} ${pt(cx + r, cy)}C${pt(cx + r, cy + r * 0.552)} ${pt(cx + r * 0.552, cy + r)} ${pt(cx, cy + r)}C${pt(cx - r * 0.552, cy + r)} ${pt(cx - r, cy + r * 0.552)} ${pt(cx - r, cy)}Z`;
}

/** Case outline at an inset, for each case shape. */
function caseD(shape, inset = 0) {
  if (shape === 'cushion') return softRect(CX, CY, 80 - inset, 80 - inset, Math.max(8, 34 - inset * 0.7), 5, 5);
  if (shape === 'square') return softRect(CX, CY, 82 - inset, 86 - inset, Math.max(6, 22 - inset * 0.8));
  if (shape === 'tonneau') return softRect(CX, CY, 70 - inset, 92 - inset, Math.max(8, 26 - inset * 0.6), 13, 6);
  return circleD(CX, CY, 80 - inset);
}

/** Radii of the ellipse the hour markers sit on. */
function markerRadii(shape, inset) {
  if (shape === 'cushion') return [76 - inset, 76 - inset];
  if (shape === 'square') return [74 - inset, 78 - inset];
  if (shape === 'tonneau') return [72 - inset, 86 - inset];
  return [80 - inset, 80 - inset];
}

const polar = (rx, ry, deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [CX + rx * Math.cos(a), CY + ry * Math.sin(a)];
};

/** Strap piece between y0 (at the case) and y1 (the free end), tapering from w0 to w1. */
function strapOutline(y0, y1, w0, w1, round) {
  const dir = y1 > y0 ? 1 : -1;
  const r = round ? Math.min(w1 / 2, 18) : 4;
  const endY = y1 - dir * r;
  return `M${pt(CX - w0 / 2, y0)}L${pt(CX + w0 / 2, y0)}L${pt(CX + w1 / 2, endY)}Q${pt(CX + w1 / 2, y1)} ${pt(CX + w1 / 2 - r, y1)}L${pt(CX - w1 / 2 + r, y1)}Q${pt(CX - w1 / 2, y1)} ${pt(CX - w1 / 2, endY)}Z`;
}

/** x of a tapering strap edge at y. */
const strapHalf = (y, y0, y1, w0, w1) => (w0 + ((w1 - w0) * (y - y0)) / (y1 - y0)) / 2;

function strapPiece(kind, y0, y1, w0, w1, p, { holes = false, buckle = false, opts = {} } = {}) {
  const dir = y1 > y0 ? 1 : -1;
  const out = [];
  const round = kind === 'leather' || kind === 'rubber' || kind === 'nato';
  const d = strapOutline(y0, y1, w0, w1, round);
  const strapEdge = edge(p.strap);
  if (kind === 'bracelet') return braceletPiece(y0, y1, w0, w1, p, opts);
  out.push(path(d, filled(p.strap, strapEdge)));
  // Side shading on the right edge.
  const poly = polyOf(d);
  out.push(path(polyD(clipConvex(poly, [[CX + w1 * 0.3, y0], [CX + 60, y0], [CX + 60, y1], [CX + w1 * 0.3, y1]].map(([x, y]) => [x, y]))), { fill: shade(p.strap, 0.14), 'fill-opacity': '.7' }));

  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  if (kind === 'leather') {
    const inset = 6;
    const a = y0 + dir * 4;
    const b = y1 - dir * 20;
    const stitch = `M${pt(CX - strapHalf(a, y0, y1, w0, w1) + inset, a)}L${pt(CX - strapHalf(b, y0, y1, w0, w1) + inset, b)}Q${pt(CX - w1 / 2 + inset, y1 - dir * 8)} ${pt(CX, y1 - dir * 7)}Q${pt(CX + w1 / 2 - inset, y1 - dir * 8)} ${pt(CX + strapHalf(b, y0, y1, w0, w1) - inset, b)}L${pt(CX + strapHalf(a, y0, y1, w0, w1) - inset, a)}`;
    out.push(path(stitch, { stroke: p.strapStitch, 'stroke-width': '1.6', 'stroke-dasharray': '4 3', fill: 'none' }));
  } else if (kind === 'rubber') {
    const ridges = [];
    for (let y = lo + 8; y < hi - 30; y += 9) {
      const h = strapHalf(y, y0, y1, w0, w1);
      ridges.push(`M${pt(CX - h + 9, y)}L${pt(CX + h - 9, y)}`);
    }
    out.push(path(ridges.join(''), { stroke: shade(p.strap, 0.22), 'stroke-width': '2', fill: 'none' }));
  } else if (kind === 'nato') {
    const stripes = Math.max(0, Math.min(2, Number(opts.stripes) || 0));
    const sw = w1 * 0.16;
    const xs = stripes === 1 ? [CX] : stripes === 2 ? [CX - w1 * 0.2, CX + w1 * 0.2] : [];
    for (const x of xs) out.push(rect(x - sw / 2, lo + 2, sw, hi - lo - 22, 0, { fill: p.accent }));
    // Heat-sealed edge lines.
    out.push(path(`M${pt(CX - w1 / 2 + 4, lo + 3)}L${pt(CX - w1 / 2 + 4, hi - 16)}M${pt(CX + w1 / 2 - 4, lo + 3)}L${pt(CX + w1 / 2 - 4, hi - 16)}`, { stroke: shade(p.strap, 0.25), 'stroke-width': '1.2', fill: 'none' }));
  } else if (kind === 'mesh') {
    const rows = [];
    for (let y = lo + 2; y < hi - 2; y += 3.2) {
      const h = strapHalf(y, y0, y1, w0, w1) - 2;
      rows.push(`M${pt(CX - h, y)}L${pt(CX + h, y)}`);
    }
    out.push(path(rows.join(''), { stroke: tint(p.strap, 0.4), 'stroke-width': '1.3', 'stroke-dasharray': '2 1.6', fill: 'none' }));
    out.push(path(rows.filter((_, i) => i % 2).join(''), { stroke: shade(p.strap, 0.28), 'stroke-width': '1', 'stroke-dasharray': '1.6 2', fill: 'none' }));
  }

  if (holes) {
    const ys = [];
    const start = y1 - dir * 34;
    for (let i = 0; i < 6; i++) ys.push(start - dir * i * 15);
    const metal = kind === 'nato';
    out.push(path(ys.map((y) => `M${pt(CX, y)}h.1`).join(''), { stroke: metal ? p.case : shade(p.strap, 0.55), 'stroke-width': metal ? '8' : '7', fill: 'none' }));
    out.push(path(ys.map((y) => `M${pt(CX, y)}h.1`).join(''), { stroke: shade(p.strap, 0.7), 'stroke-width': '4.4', fill: 'none' }));
  }
  if (buckle) out.push(buckleAt(y1, w1, dir, p, kind));
  return out.join('');
}

function buckleAt(yEnd, w, dir, p, kind) {
  const metal = p.case;
  const metalEdge = edge(metal);
  const y = yEnd + dir * 2;
  const frameH = 24;
  const top = dir < 0 ? y - 2 : y - frameH + 2;
  const out = [];
  if (kind === 'mesh') {
    out.push(rect(CX - w / 2 - 2, top, w + 4, frameH, 4, filled(metal, metalEdge, 2)));
    out.push(path(`M${pt(CX - w / 2 + 8, top + frameH / 2)}L${pt(CX + w / 2 - 8, top + frameH / 2)}`, { stroke: shade(metal, 0.3), 'stroke-width': '2', fill: 'none' }));
    return out.join('');
  }
  out.push(rect(CX - w / 2 - 5, top, w + 10, frameH, 7, { fill: 'none', stroke: metalEdge, 'stroke-width': '7.4' }));
  out.push(rect(CX - w / 2 - 5, top, w + 10, frameH, 7, { fill: 'none', stroke: metal, 'stroke-width': '4.6' }));
  out.push(path(`M${pt(CX, top + frameH / 2)}L${pt(CX, dir < 0 ? top + frameH + 12 : top - 12)}`, { stroke: metalEdge, 'stroke-width': '5', fill: 'none' }));
  out.push(path(`M${pt(CX, top + frameH / 2)}L${pt(CX, dir < 0 ? top + frameH + 12 : top - 12)}`, { stroke: metal, 'stroke-width': '3', fill: 'none' }));
  // Keeper loop below the buckle.
  const ky = dir < 0 ? top + frameH + 18 : top - 26;
  out.push(rect(CX - w / 2 - 2, ky, w + 4, 9, 3, filled(kind === 'nato' ? metal : shade(p.strap, 0.06), kind === 'nato' ? metalEdge : edge(p.strap), 1.6)));
  return out.join('');
}

function braceletPiece(y0, y1, w0, w1, p, { integrated = false } = {}) {
  const dir = y1 > y0 ? 1 : -1;
  const out = [];
  const metal = p.strap;
  const rowH = 15;
  const centerLinks = [];
  const outerLinks = [];
  const lines = [];
  const count = Math.floor(Math.abs(y1 - y0) / rowH);
  for (let i = 0; i < count; i++) {
    const a = y0 + dir * i * rowH;
    const b = a + dir * (rowH - 1.4);
    const ha = strapHalf(a, y0, y1, w0, w1);
    const hb = strapHalf(b, y0, y1, w0, w1);
    const top = Math.min(a, b);
    const h = Math.abs(b - a);
    const half = Math.max(ha, hb);
    const c = half * 0.36;
    outerLinks.push(`M${pt(CX - ha, a)}L${pt(CX - c - 1, a)}L${pt(CX - c - 1, b)}L${pt(CX - hb, b)}Z`);
    outerLinks.push(`M${pt(CX + c + 1, a)}L${pt(CX + ha, a)}L${pt(CX + hb, b)}L${pt(CX + c + 1, b)}Z`);
    centerLinks.push(`M${pt(CX - c, top)}L${pt(CX + c, top)}L${pt(CX + c, top + h)}L${pt(CX - c, top + h)}Z`);
    lines.push(`M${pt(CX - ha + 3, a + dir * 2)}L${pt(CX - c - 4, a + dir * 2)}`);
  }
  // Clasp: a plain plate at the end of the longer piece.
  const plateTop = Math.min(y0 + dir * count * rowH, y1);
  out.push(path(outerLinks.join(''), filled(metal, edge(metal), 1.4)));
  out.push(path(centerLinks.join(''), filled(tint(metal, 0.22), edge(metal), 1.4)));
  out.push(path(lines.join(''), { stroke: tint(metal, 0.45), 'stroke-width': '1.2', fill: 'none', 'stroke-opacity': '.8' }));
  const rest = Math.abs(y1 - plateTop);
  if (rest > 4) {
    const h = strapHalf(y1, y0, y1, w0, w1);
    out.push(rect(CX - h, Math.min(plateTop, y1), h * 2, rest, 3, filled(tint(metal, 0.1), edge(metal), 1.6)));
  }
  if (integrated) {
    // The first link widens into the case instead of meeting lugs.
    const yy = y0;
    out.push(path(`M${pt(CX - w0 / 2 - 6, yy)}L${pt(CX + w0 / 2 + 6, yy)}`, { stroke: shade(metal, 0.2), 'stroke-width': '2', fill: 'none' }));
  }
  return out.join('');
}

function bezelRing(kind, rOuter, rInner, p) {
  const out = [];
  const mid = (rOuter + rInner) / 2;
  const width = rOuter - rInner;
  if (kind === 'gmt') {
    const top = `M${pt(CX - mid, CY)}A${n(mid)} ${n(mid)} 0 0 1 ${pt(CX + mid, CY)}`;
    const bottom = `M${pt(CX + mid, CY)}A${n(mid)} ${n(mid)} 0 0 1 ${pt(CX - mid, CY)}`;
    out.push(path(top, { stroke: p.bezelInsert, 'stroke-width': n(width), fill: 'none', 'stroke-linecap': 'butt' }));
    out.push(path(bottom, { stroke: p.bezel === p.case ? shade(p.bezelInsert, 0.5) : p.bezel, 'stroke-width': n(width), fill: 'none', 'stroke-linecap': 'butt' }));
  } else if (kind === 'fluted') {
    out.push(circle(CX, CY, mid, { fill: 'none', stroke: tint(p.case, 0.12), 'stroke-width': n(width) }));
  } else {
    out.push(circle(CX, CY, mid, { fill: 'none', stroke: p.bezelInsert, 'stroke-width': n(width) }));
  }
  const tickColor = kind === 'fluted' ? shade(p.case, 0.35) : isDark(p.bezelInsert) ? '#eeeeea' : '#1f2022';
  const ticks = [];
  if (kind === 'diver') {
    for (let m = 0; m < 60; m++) {
      if (m === 0) continue;
      const big = m % 5 === 0;
      if (!big && m > 15) continue;
      const [x0, y0] = polar(rOuter - 3, rOuter - 3, m * 6);
      const [x1, y1] = polar(big ? rInner + 3 : rOuter - 7, big ? rInner + 3 : rOuter - 7, m * 6);
      ticks.push(`M${pt(x0, y0)}L${pt(x1, y1)}`);
    }
    out.push(path(ticks.join(''), { stroke: tickColor, 'stroke-width': '2', fill: 'none' }));
    // Luminous pip at 12.
    out.push(path(`M${pt(CX - 6, CY - rOuter + 3)}L${pt(CX + 6, CY - rOuter + 3)}L${pt(CX, CY - rInner - 3)}Z`, filled(p.lume, tickColor, 1.2)));
  } else if (kind === 'gmt') {
    for (let h = 1; h < 24; h++) {
      const [x0, y0] = polar(rOuter - 3, rOuter - 3, h * 15);
      const [x1, y1] = polar(rInner + (h % 2 ? 6 : 3), rInner + (h % 2 ? 6 : 3), h * 15);
      ticks.push(`M${pt(x0, y0)}L${pt(x1, y1)}`);
    }
    out.push(path(ticks.join(''), { stroke: '#eeeeea', 'stroke-width': '2', fill: 'none' }));
    out.push(path(`M${pt(CX - 6, CY - rOuter + 3)}L${pt(CX + 6, CY - rOuter + 3)}L${pt(CX, CY - rInner - 3)}Z`, filled(p.lume, '#eeeeea', 1.2)));
  } else if (kind === 'tachymeter') {
    // Real tachymeter spacing: the mark for speed S sits at 3600 / S seconds.
    for (const speed of [500, 400, 300, 250, 200, 180, 160, 150, 140, 130, 120, 110, 100, 90, 80, 75, 70, 65, 60]) {
      const deg = (3600 / speed) * 6;
      const major = speed % 50 === 0 || speed === 60;
      const [x0, y0] = polar(rOuter - 3, rOuter - 3, deg);
      const [x1, y1] = polar(major ? rInner + 3 : rOuter - 8, major ? rInner + 3 : rOuter - 8, deg);
      ticks.push(`M${pt(x0, y0)}L${pt(x1, y1)}`);
    }
    out.push(path(ticks.join(''), { stroke: tickColor, 'stroke-width': '1.8', fill: 'none' }));
  } else if (kind === 'fluted') {
    for (let i = 0; i < 48; i++) {
      const [x0, y0] = polar(rOuter - 1, rOuter - 1, i * 7.5);
      const [x1, y1] = polar(rInner + 1, rInner + 1, i * 7.5);
      ticks.push(`M${pt(x0, y0)}L${pt(x1, y1)}`);
    }
    out.push(path(ticks.join(''), { stroke: tickColor, 'stroke-width': '2.2', fill: 'none' }));
  }
  out.push(circle(CX, CY, rInner, { fill: 'none', stroke: shade(p.case, 0.35), 'stroke-width': '1.4' }));
  return out.join('');
}

/** A hand pointing to 12 from the center; callers rotate it. */
function handD(style, len, w) {
  const t = 14;
  if (style === 'dauphine') return `M${pt(CX, CY - len)}L${pt(CX + w / 2, CY - len * 0.14)}L${pt(CX, CY + t * 0.5)}L${pt(CX - w / 2, CY - len * 0.14)}Z`;
  if (style === 'baton') return `M${pt(CX - w / 2, CY + t)}L${pt(CX - w / 2, CY - len + w / 2)}Q${pt(CX, CY - len - w / 3)} ${pt(CX + w / 2, CY - len + w / 2)}L${pt(CX + w / 2, CY + t)}Z`;
  return `M${pt(CX - w / 2, CY + t)}L${pt(CX - w / 2, CY - len * 0.8)}L${pt(CX, CY - len)}L${pt(CX + w / 2, CY - len * 0.8)}L${pt(CX + w / 2, CY + t)}Z`;
}

function lumeD(style, len, w) {
  if (style === 'dauphine') return '';
  const iw = Math.max(1.6, w - 4);
  if (style === 'baton') return `M${pt(CX - iw / 2, CY - 18)}L${pt(CX - iw / 2, CY - len + w)}L${pt(CX + iw / 2, CY - len + w)}L${pt(CX + iw / 2, CY - 18)}Z`;
  return `M${pt(CX - iw / 2, CY - 18)}L${pt(CX - iw / 2, CY - len * 0.78)}L${pt(CX, CY - len * 0.92)}L${pt(CX + iw / 2, CY - len * 0.78)}L${pt(CX + iw / 2, CY - 18)}Z`;
}

function drawHands(o, p, r) {
  const style = ['sword', 'dauphine', 'baton', 'mercedes'].includes(o.hands) ? o.hands : 'sword';
  const handEdge = edge(p.hands);
  const out = [];
  const hourLen = r * 0.56;
  const minLen = r * 0.86;
  const hourW = style === 'dauphine' ? 11 : 9;
  const minW = style === 'dauphine' ? 9 : 7;
  const rot = (deg) => ({ transform: `rotate(${n(deg)} ${CX} ${CY})` });

  // Hour hand.
  if (style === 'mercedes') {
    const ringY = CY - hourLen * 0.74;
    const ringR = 8;
    const body = `M${pt(CX - 3.5, CY + 12)}L${pt(CX - 3.5, ringY + ringR - 1)}L${pt(CX + 3.5, ringY + ringR - 1)}L${pt(CX + 3.5, CY + 12)}Z` +
      `M${pt(CX - 3.5, ringY - ringR + 1)}L${pt(CX, CY - hourLen)}L${pt(CX + 3.5, ringY - ringR + 1)}Z`;
    out.push(group(rot(HOUR_ANGLE), [
      path(body, filled(p.hands, handEdge, 1.2)),
      circle(CX, ringY, ringR, filled(p.lume, p.hands, 3.2)),
      circle(CX, ringY, ringR + 1.8, { fill: 'none', stroke: handEdge, 'stroke-width': '1' }),
      circle(CX, ringY, 2.2, { fill: p.hands }),
    ].join('')));
  } else {
    out.push(group(rot(HOUR_ANGLE), [
      path(handD(style, hourLen, hourW), filled(p.hands, handEdge, 1.2)),
      style === 'dauphine' ? path(`M${pt(CX, CY - hourLen)}L${pt(CX + hourW / 2, CY - hourLen * 0.14)}L${pt(CX, CY + 7)}Z`, { fill: shade(p.hands, 0.22) }) : path(lumeD(style, hourLen, hourW), { fill: p.lume }),
    ].join('')));
  }
  // Minute hand.
  const minStyle = style === 'mercedes' ? 'sword' : style;
  out.push(group(rot(MINUTE_ANGLE), [
    path(handD(minStyle, minLen, minW), filled(p.hands, handEdge, 1.2)),
    minStyle === 'dauphine' ? path(`M${pt(CX, CY - minLen)}L${pt(CX + minW / 2, CY - minLen * 0.14)}L${pt(CX, CY + 7)}Z`, { fill: shade(p.hands, 0.22) }) : path(lumeD(minStyle, minLen, minW), { fill: p.lume }),
  ].join('')));
  // GMT hand.
  if ((o.complications ?? []).includes('gmt') || o.bezel === 'gmt') {
    out.push(group(rot(GMT_ANGLE), [
      path(`M${pt(CX, CY + 10)}L${pt(CX, CY - r * 0.8)}`, { stroke: p.accent, 'stroke-width': '2.2', fill: 'none' }),
      path(`M${pt(CX - 6, CY - r * 0.78)}L${pt(CX, CY - r * 0.94)}L${pt(CX + 6, CY - r * 0.78)}Z`, filled(p.accent, edge(p.accent), 1)),
    ].join('')));
  }
  // Seconds hand with a counterweight.
  out.push(group(rot(SECOND_ANGLE), [
    path(`M${pt(CX, CY + 22)}L${pt(CX, CY - r * 0.92)}`, { stroke: p.accent, 'stroke-width': '1.8', fill: 'none' }),
    style === 'mercedes' || o.bezel === 'diver' ? circle(CX, CY - r * 0.66, 4, filled(p.lume, p.accent, 1.6)) : '',
    circle(CX, CY + 16, 3.4, { fill: p.accent }),
  ].join('')));
  out.push(circle(CX, CY, 5.4, filled(p.hands, handEdge, 1)));
  out.push(circle(CX, CY, 2.2, { fill: p.accent }));
  return out.join('');
}

function dialMarkers(o, shape, p, inset, complications) {
  const out = [];
  const [rx, ry] = markerRadii(shape, inset);
  const kind = ['arabic', 'baton', 'dot', 'roman'].includes(o.indices) ? o.indices : 'baton';
  const hasDate = complications.includes('date');
  const chrono = complications.includes('chronograph');
  const smallSeconds = complications.includes('small-seconds');
  const skip = (h) => (hasDate && h === 3) || (chrono && (h === 3 || h === 9)) || (smallSeconds && h === 6);

  // Minute track.
  const track = [];
  for (let m = 0; m < 60; m++) {
    const [x0, y0] = polar(rx - 2, ry - 2, m * 6);
    const [x1, y1] = polar(rx - (m % 5 ? 6 : 9), ry - (m % 5 ? 6 : 9), m * 6);
    track.push(`M${pt(x0, y0)}L${pt(x1, y1)}`);
  }
  out.push(path(track.join(''), { stroke: p.indices, 'stroke-width': '1.2', fill: 'none', 'stroke-opacity': '.75' }));

  if (kind === 'arabic') {
    let d = '';
    for (let h = 1; h <= 12; h++) {
      if (skip(h)) continue;
      const [x, y] = polar(rx - 24, ry - 24, h * 30);
      d += digitsD(String(h), x, y, h === 12 ? 15 : 13);
    }
    out.push(path(d, { stroke: p.indices, 'stroke-width': '2.3', fill: 'none' }));
  } else if (kind === 'roman') {
    let d = '';
    for (let h = 0; h < 12; h++) {
      if (skip(h === 0 ? 12 : h)) continue;
      const text = ROMAN[h];
      const top = CY - (ry - 12);
      d += `<path transform="rotate(${h * 30} ${CX} ${CY})" d="${romanD(text, CX, top, 13)}"/>`;
    }
    out.push(group({ stroke: p.indices, 'stroke-width': '1.9', fill: 'none' }, d));
  } else {
    const batons = [];
    const dots = [];
    for (let h = 0; h < 12; h++) {
      const hour = h === 0 ? 12 : h;
      if (skip(hour)) continue;
      const deg = h * 30;
      if (kind === 'dot' && h % 3 !== 0) {
        dots.push(polar(rx - 18, ry - 18, deg));
        continue;
      }
      const len = kind === 'dot' ? 18 : 16;
      const w = h === 0 ? 10 : kind === 'dot' ? 7 : 5;
      batons.push(`<path transform="rotate(${deg} ${CX} ${CY})" d="M${pt(CX - w / 2, CY - ry + 10)}L${pt(CX + w / 2, CY - ry + 10)}L${pt(CX + w / 2, CY - ry + 10 + len)}L${pt(CX - w / 2, CY - ry + 10 + len)}Z"/>`);
    }
    out.push(group(filled(kind === 'dot' ? p.lume : p.indices, edge(p.indices), 1.2), batons.join('')));
    if (dots.length) out.push(group(filled(p.lume, p.indices, 1.6), dots.map(([x, y]) => circle(x, y, 5)).join('')));
  }
  return out.join('');
}

function subdial(x, y, r, p) {
  const ticks = [];
  for (let i = 0; i < 12; i++) {
    const a = ((i * 30 - 90) * Math.PI) / 180;
    ticks.push(`M${pt(x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2))}L${pt(x + Math.cos(a) * (r - (i % 3 ? 5 : 7)), y + Math.sin(a) * (r - (i % 3 ? 5 : 7)))}`);
  }
  const ink = isDark(p.subdial) ? '#f1f1ee' : '#1f2022';
  return [
    circle(x, y, r, filled(p.subdial, shade(p.subdial, 0.3), 1.2)),
    path(ticks.join(''), { stroke: ink, 'stroke-width': '1.2', fill: 'none' }),
    path(`M${pt(x, y)}L${pt(x - r * 0.5, y - r * 0.55)}`, { stroke: ink, 'stroke-width': '2', fill: 'none' }),
    circle(x, y, 2, { fill: ink }),
  ].join('');
}

function drawWatch(spec, pal) {
  const o = { ...(spec.details ?? {}), ...spec };
  const p = watchPalette(pal);
  const opts = spec.options ?? {};
  const strapKind = ['bracelet', 'leather', 'rubber', 'nato', 'mesh'].includes(opts.strapKind) ? opts.strapKind : 'leather';
  if (o.shape === 'strap') return drawStrapOnly(o, p, strapKind, opts);

  const digital = o.display === 'digital';
  const shape = SHAPES.watch.includes(o.shape) && o.shape !== 'strap' ? o.shape : digital ? 'square' : 'round';
  const complications = Array.isArray(o.complications) ? o.complications : [];
  const integrated = Boolean(o.integrated);
  const caseHalfH = shape === 'tonneau' ? 92 : shape === 'square' ? 86 : 80;
  const out = [];

  // Shadow under the whole watch.
  out.push(group({ fill: INK, 'fill-opacity': '.08', transform: 'translate(4 6)' }, path(caseD(shape)) + rect(CX - 38, 14, 76, 372, 16)));

  // Strap behind the case.
  const w0 = integrated ? 104 : digital ? 84 : 76;
  const w1 = integrated ? 72 : 66;
  const topY0 = CY - caseHalfH + 16;
  const botY0 = CY + caseHalfH - 16;
  if (strapKind === 'nato') {
    out.push(strapPiece('nato', CY, 16, w0 - 4, w0 - 4, p, { buckle: true, opts }));
    out.push(strapPiece('nato', CY, 384, w0 - 4, w0 - 4, p, { holes: true, opts }));
  } else {
    out.push(strapPiece(strapKind, topY0, 16, w0, w1, p, { buckle: strapKind !== 'bracelet', opts: { integrated } }));
    out.push(strapPiece(strapKind, botY0, 384, w0, w1, p, { holes: strapKind === 'leather' || strapKind === 'rubber', opts: { integrated } }));
  }

  const kase = p.case;
  const caseEdge = edge(kase);
  // Lugs and crown sit under the case outline.
  if (!integrated && !digital) {
    const lugX = w0 / 2 + 5;
    const lugs = [];
    for (const side of [-1, 1]) {
      for (const dir of [-1, 1]) {
        const x = CX + side * lugX;
        const yIn = CY + dir * (caseHalfH - 26);
        const yOut = CY + dir * (caseHalfH + 14);
        lugs.push(`M${pt(x - 6, yIn)}L${pt(x - 5, yOut - dir * 4)}Q${pt(x, yOut + dir * 2)} ${pt(x + 5, yOut - dir * 4)}L${pt(x + 6, yIn)}Z`);
      }
    }
    out.push(path(lugs.join(''), filled(kase, caseEdge, 1.8)));
  }
  if (digital) {
    const buttons = [];
    for (const side of [-1, 1]) for (const dy of [-34, 34]) buttons.push(rect(CX + side * 84 - (side < 0 ? 10 : 0), CY + dy - 7, 10, 14, 3));
    out.push(group(filled(shade(kase, 0.12), edge(kase), 1.6), buttons.join('')));
  } else {
    const crownX = CX + (shape === 'tonneau' ? 76 : 80);
    out.push(rect(crownX - 4, CY - 11, 16, 22, 3.5, filled(kase, caseEdge, 1.8)));
    out.push(path(`M${n(crownX + 3)} ${CY - 8}L${n(crownX + 3)} ${CY + 8}M${n(crownX + 7)} ${CY - 8}L${n(crownX + 7)} ${CY + 8}`, { stroke: shade(kase, 0.3), 'stroke-width': '1.2', fill: 'none' }));
    if (complications.includes('chronograph')) {
      for (const deg of [-40, 40]) {
        out.push(group({ transform: `rotate(${deg} ${CX} ${CY})` }, rect(crownX - 2, CY - 7, 13, 14, 3, filled(kase, caseEdge, 1.6))));
      }
    }
  }

  // Case with a darker lower-right rim (light from the top left).
  out.push(path(caseD(shape), filled(shade(kase, 0.16), caseEdge)));
  out.push(group({ transform: 'translate(-1.6 -1.8)' }, path(caseD(shape, 1.2), { fill: kase })));

  if (digital) {
    out.push(drawDigitalFace(p));
    return out.join('');
  }

  // Bezel and dial.
  const bezel = ['plain', 'diver', 'fluted', 'tachymeter', 'gmt'].includes(o.bezel) ? o.bezel : 'plain';
  const round = shape === 'round';
  let inset;
  if (round && bezel !== 'plain') {
    out.push(bezelRing(bezel, 78, 62, p));
    inset = 19;
  } else {
    out.push(path(caseD(shape, 5), { fill: 'none', stroke: tint(kase, 0.45), 'stroke-width': '2.4' }));
    inset = 10;
  }
  out.push(path(caseD(shape, inset), filled(p.dial, shade(p.dial, 0.35), 1.6)));
  // Gentle dial sheen toward the top left.
  out.push(path(caseD(shape, inset + 16), { fill: isDark(p.dial) ? '#ffffff' : INK, 'fill-opacity': '.04', transform: 'translate(-6 -7)' }));

  out.push(dialMarkers(o, shape, p, inset + 2, complications));
  const [rx, ry] = markerRadii(shape, inset + 2);
  const r = Math.min(rx, ry);

  // Abstract dial mark under 12 and a short line above 6 (no lettering).
  out.push(path(`M${pt(CX - 9, CY - r * 0.48)}L${pt(CX + 9, CY - r * 0.48)}M${pt(CX - 5, CY - r * 0.4)}L${pt(CX + 5, CY - r * 0.4)}`, { stroke: p.indices, 'stroke-width': '2', fill: 'none', 'stroke-opacity': '.85' }));
  if (!complications.includes('small-seconds') && !complications.includes('chronograph')) {
    out.push(path(`M${pt(CX - 7, CY + r * 0.42)}L${pt(CX + 7, CY + r * 0.42)}`, { stroke: p.indices, 'stroke-width': '1.6', fill: 'none', 'stroke-opacity': '.6' }));
  }

  if (complications.includes('chronograph')) {
    const sr = r * 0.25;
    const positions = o.subdials === 3 ? [[CX - r * 0.5, CY], [CX + r * 0.5, CY], [CX, CY + r * 0.5]] : [[CX - r * 0.5, CY], [CX + r * 0.5, CY]];
    for (const [x, y] of positions) out.push(subdial(x, y, sr, p));
  }
  if (complications.includes('small-seconds')) out.push(subdial(CX, CY + r * 0.5, r * 0.22, p));
  if (complications.includes('date')) {
    const x = CX + r * 0.66;
    out.push(rect(x - 11, CY - 8, 22, 16, 2, filled('#f3f2ec', shade(p.dial, 0.4), 1.6)));
    out.push(path(digitsD('14', x, CY, 9), { stroke: '#1f2022', 'stroke-width': '1.4', fill: 'none' }));
  }

  out.push(drawHands(o, p, r));
  // Crystal reflection.
  out.push(path(`M${pt(CX - r * 0.86, CY - r * 0.12)}Q${pt(CX - r * 0.8, CY - r * 0.8)} ${pt(CX - r * 0.12, CY - r * 0.88)}`, { stroke: '#ffffff', 'stroke-width': '5', fill: 'none', 'stroke-opacity': '.12' }));
  return out.join('');
}

function drawDigitalFace(p) {
  const out = [];
  out.push(path(caseD('square', 12), filled(p.bezel === p.case ? shade(p.case, 0.25) : p.bezel, shade(p.case, 0.4), 1.6)));
  out.push(rect(CX - 58, CY - 30, 116, 64, 7, filled(p.dial, shade(p.dial, 0.45), 2)));
  // Unlit segments, then the time.
  const ghost = shade(p.dial, 0.08);
  out.push(path(segmentD('88:88', CX - 50, CY - 16, 30), { stroke: ghost, 'stroke-width': '4', fill: 'none' }));
  out.push(path(segmentD('10:08', CX - 50, CY - 16, 30), { stroke: p.hands, 'stroke-width': '4', fill: 'none' }));
  out.push(path(segmentD('37', CX + 34, CY + 6, 12), { stroke: p.hands, 'stroke-width': '2', fill: 'none' }));
  // Indicator row and printed scale marks (abstract, no lettering).
  out.push(path(`M${pt(CX - 50, CY - 22)}L${pt(CX - 36, CY - 22)}M${pt(CX - 28, CY - 22)}L${pt(CX - 20, CY - 22)}M${pt(CX + 22, CY - 22)}L${pt(CX + 48, CY - 22)}`, { stroke: p.hands, 'stroke-width': '2.4', fill: 'none', 'stroke-opacity': '.7' }));
  out.push(path(`M${pt(CX - 40, CY - 48)}L${pt(CX + 40, CY - 48)}M${pt(CX - 26, CY + 52)}L${pt(CX + 26, CY + 52)}`, { stroke: p.indices, 'stroke-width': '3', fill: 'none' }));
  out.push(circle(CX, CY + 66, 4, { fill: p.accent }));
  return out.join('');
}

function drawStrapOnly(o, p, kind, opts) {
  const out = [];
  const w = kind === 'rubber' ? 80 : 78;
  const pins = o.pins === 'quick_release' ? 'quick_release' : 'spring_bar';
  out.push(group({ fill: INK, 'fill-opacity': '.08', transform: 'translate(4 6)' }, rect(CX - w / 2, 16, w, 368, 14)));
  if (kind === 'nato') {
    out.push(strapPiece('nato', 200, 16, w - 4, w - 4, p, { buckle: true, opts }));
    out.push(strapPiece('nato', 200, 384, w - 4, w - 4, p, { holes: true, opts }));
    // The short second layer that sits under the watch head.
    out.push(rect(CX - w / 2 + 2, 176, w - 4, 52, 2, filled(shade(p.strap, 0.06), edge(p.strap), 1.6)));
    out.push(rect(CX - w / 2 - 3, 236, w + 6, 10, 3, filled(p.case, edge(p.case), 1.6)));
    out.push(rect(CX - w / 2 - 3, 254, w + 6, 10, 3, filled(p.case, edge(p.case), 1.6)));
    return out.join('');
  }
  out.push(strapPiece(kind, 168, 18, w, w - 10, p, { buckle: true }));
  out.push(strapPiece(kind, 232, 384, w, w - 10, p, { holes: kind !== 'mesh' && kind !== 'bracelet' }));
  // Spring bars (or quick-release bars with their levers) at the lug ends.
  const metal = '#b9bcc0';
  for (const y of [170, 230]) {
    out.push(rect(CX - w / 2 - 8, y - 2.5, w + 16, 5, 2.5, filled(metal, shade(metal, 0.4), 1.2)));
    if (pins === 'quick_release') {
      const dy = y < 200 ? 4 : -11;
      out.push(rect(CX + w / 2 - 20, y + dy, 7, 7, 2, filled(metal, shade(metal, 0.4), 1.2)));
    }
  }
  return out.join('');
}

// ---------- Clothing (flat lay, front view) ----------

// Right halves of each silhouette, from the top center to the bottom center.
const TOP_LONG = 'M200 58C214 58 226 55 236 50L292 70C304 74 312 84 316 98L360 286L328 300L290 152C292 216 294 284 292 340L200 344';
const TOP_SHORT = 'M200 60C214 60 226 57 236 52L286 68C302 74 316 86 326 98L354 130L322 160L290 138C290 210 292 290 290 346L200 348';
const SHIRT = 'M200 56C214 56 226 53 236 48L292 68C304 72 312 82 316 96L360 286L328 300L290 152C292 214 294 278 292 326C284 344 246 354 200 356';
const BOXY = 'M200 58C214 58 228 55 238 50L296 70C308 74 316 84 320 98L362 286L330 300L294 156C296 220 298 284 298 342L200 346';
const PUFFY = 'M200 60C214 60 226 57 236 52L292 72C306 78 314 88 318 100L360 280L330 294L292 156C300 210 304 280 290 324L200 328';
const BOTTOM_LONG = 'M200 38L280 38C286 72 292 110 294 140L302 374L222 376L204 168C203 162 201 160 200 160';
const BOTTOM_SLIM = 'M200 38L280 38C286 72 290 110 292 140L292 374L220 376L204 168C203 162 201 160 200 160';
const BOTTOM_SHORT = 'M200 96L282 96C288 124 294 150 298 172L308 296L218 300L205 210C203 204 201 202 200 202';

const CLOTHING = {
  tee: { outline: TOP_SHORT, top: true },
  'oxford-shirt': { outline: SHIRT, top: true },
  overshirt: { outline: TOP_LONG, top: true },
  'chore-jacket': { outline: BOXY, top: true },
  'field-jacket': { outline: BOXY, top: true },
  bomber: { outline: PUFFY, top: true },
  hoodie: { outline: TOP_LONG, top: true },
  crewneck: { outline: TOP_LONG, top: true },
  chinos: { outline: BOTTOM_LONG },
  trousers: { outline: BOTTOM_LONG },
  jeans: { outline: BOTTOM_SLIM },
  shorts: { outline: BOTTOM_SHORT },
};

function clothingPalette(pal) {
  const main = hex(pal.main, '#8e9092');
  const trim = hex(pal.trim, shade(main, 0.14));
  return {
    main,
    secondary: hex(pal.secondary, shade(main, 0.22)),
    trim,
    buttons: hex(pal.buttons, isDark(main) ? tint(main, 0.5) : shade(main, 0.35)),
    stitching: hex(pal.stitching, isDark(main) ? tint(main, 0.2) : shade(main, 0.18)),
  };
}

function patternFill(pattern, poly, p) {
  if (pattern === 'stripe') {
    let d = '';
    for (let y = 20; y < 390; y += 17) d += polyD(clipBelow(clipAbove(poly, y + 6), y));
    return path(d, { fill: p.secondary });
  }
  if (pattern === 'check') {
    let v = '';
    let h = '';
    for (let x = 14; x < 390; x += 30) v += polyD(clipLeft(clipRight(poly, x), x + 12));
    for (let y = 14; y < 390; y += 30) h += polyD(clipAbove(clipBelow(poly, y), y + 12));
    let lines = '';
    for (let x = 34; x < 390; x += 60) lines += polyD(clipLeft(clipRight(poly, x), x + 1.6));
    for (let y = 34; y < 390; y += 60) lines += polyD(clipAbove(clipBelow(poly, y), y + 1.6));
    return path(v, { fill: p.secondary, 'fill-opacity': '.42' }) + path(h, { fill: p.secondary, 'fill-opacity': '.42' }) + path(lines, { fill: p.trim, 'fill-opacity': '.7' });
  }
  if (pattern === 'heather') {
    // Melange yarn: short dashed rows in a lighter and a darker tone, clipped to the garment.
    const rows = ['', '', ''];
    const ys = poly.map((q) => q[1]);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    let i = 0;
    for (let y = top + 3; y < bottom - 2; y += 3.4, i++) {
      for (const [x0, x1] of spans(poly, y)) {
        const start = x0 + 2 + ((i * 7) % 9);
        if (x1 - 2 > start + 4) rows[i % 3] += `M${Math.round(start)} ${n(y)}H${Math.round(x1 - 2)}`;
      }
    }
    return path(rows[0], { stroke: tint(p.main, 0.22), 'stroke-width': '1.3', 'stroke-dasharray': '3 9 1 6', fill: 'none' }) +
      path(rows[1], { stroke: shade(p.main, 0.16), 'stroke-width': '1.3', 'stroke-dasharray': '2 7 4 11', fill: 'none' }) +
      path(rows[2], { stroke: tint(p.main, 0.12), 'stroke-width': '1.2', 'stroke-dasharray': '1 5 2 8', fill: 'none' });
  }
  return '';
}

function stitchLine(d, color, width = 1.3) {
  return path(d, { stroke: color, 'stroke-width': n(width), 'stroke-dasharray': '3.4 2.6', fill: 'none' });
}

/** A rib band (collar, cuff or hem) drawn as a filled quad with short vertical ribs. */
function ribBand(points, color, ribColor, step = 4) {
  const out = [path(polyD(points), filled(color, edge(color), 1.6))];
  const xs = points.map((q) => q[0]);
  const ys = points.map((q) => q[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  let d = '';
  for (let x = x0 + step / 2; x < x1; x += step) {
    const seg = clipLeft(clipRight(points, x - 0.5), x + 0.5);
    if (seg.length > 2) d += polyD(seg);
  }
  if (d && y1 - y0 > 4) out.push(path(d, { fill: ribColor, 'fill-opacity': '.6' }));
  return out.join('');
}

/** Cuff quad at the end of a long sleeve (right side), mirrored for the left. */
function sleeveEnd(outerFrom, outerTo, innerFrom, innerTo, len) {
  const unit = ([ax, ay], [bx, by]) => {
    const l = Math.hypot(bx - ax, by - ay);
    return [(bx - ax) / l, (by - ay) / l];
  };
  const uo = unit(outerFrom, outerTo);
  const ui = unit(innerFrom, innerTo);
  return [[outerTo[0] - uo[0] * len, outerTo[1] - uo[1] * len], outerTo, innerTo, [innerTo[0] - ui[0] * len, innerTo[1] - ui[1] * len]];
}

const mirrorPoly = (pts) => pts.map(mirrorPt);

function buttons(points, p, r = 3.6) {
  return group(filled(p.buttons, edge(p.buttons), 1.2), points.map(([x, y]) => circle(x, y, r)).join(''));
}

function pocket(x, y, w, h, p, { flap = false, point = false, stitch = true } = {}) {
  const out = [];
  const bottom = point ? `L${pt(x + w, y + h - 6)}L${pt(x + w / 2, y + h)}L${pt(x, y + h - 6)}` : `L${pt(x + w, y + h - 3)}Q${pt(x + w, y + h)} ${pt(x + w - 3, y + h)}L${pt(x + 3, y + h)}Q${pt(x, y + h)} ${pt(x, y + h - 3)}`;
  const d = `M${pt(x, y)}L${pt(x + w, y)}${bottom}Z`;
  out.push(path(d, { fill: shade(p.main, 0.3), 'fill-opacity': '.14', stroke: edge(p.main), 'stroke-width': '1.6' }));
  if (stitch) out.push(stitchLine(`M${pt(x + 3.5, y + 4)}L${pt(x + 3.5, y + h - 6)}M${pt(x + w - 3.5, y + 4)}L${pt(x + w - 3.5, y + h - 6)}`, p.stitching));
  if (flap) {
    out.push(path(`M${pt(x - 2, y - 2)}L${pt(x + w + 2, y - 2)}L${pt(x + w + 2, y + 13)}Q${pt(x + w / 2, y + 19)} ${pt(x - 2, y + 13)}Z`, { fill: shade(p.main, 0.3), 'fill-opacity': '.2', stroke: edge(p.main), 'stroke-width': '1.6' }));
  }
  return out.join('');
}

function drawClothing(spec, pal) {
  const shape = CLOTHING[spec.shape] ? spec.shape : 'tee';
  const def = CLOTHING[shape];
  const p = clothingPalette(pal);
  const details = spec.details ?? {};
  const pattern = ['solid', 'stripe', 'check', 'heather'].includes(spec.options?.pattern) ? spec.options.pattern : 'solid';
  const outline = symmetric(def.outline);
  const poly = polyOf(outline);
  const mainEdge = edge(p.main);
  const out = [];
  // Flat-lay shadow: the silhouette offset down and right.
  out.push(path(outline, { fill: INK, 'fill-opacity': '.1', transform: 'translate(3 6)' }));
  out.push(path(outline, { fill: p.main }));
  out.push(patternFill(pattern, poly, p));

  const draw = DETAILS[shape];
  out.push(draw(p, details, poly, pattern));
  out.push(path(outline, { fill: 'none', stroke: mainEdge, 'stroke-width': '2.2' }));
  return out.join('');
}

// Shared fold shading for long-sleeve tops: sleeves fall slightly into shadow.
function sleeveShade(p, half) {
  const cmds = parse(half);
  const pts = flatten(cmds);
  // Shoulder seam to armpit: the sleeve is everything outside x = body side.
  const right = clipRight(pts.concat([[200, 400], [200, 0]]), 300);
  const d = polyD(right) + polyD(mirrorPoly(right));
  return path(d, { fill: shade(p.main, 0.08), 'fill-opacity': '.55' });
}

function armSeams(p, from, to) {
  const d = `M${pt(...from)}Q${pt(from[0] - 8, (from[1] + to[1]) / 2)} ${pt(...to)}`;
  return path(d + mirrorD(d), { stroke: shade(p.main, 0.22), 'stroke-width': '1.4', fill: 'none', 'stroke-opacity': '.8' });
}

function neckInside(p, d) {
  return path(d, filled(shade(p.main, 0.24), edge(p.main), 1.6));
}

const DETAILS = {
  tee(p) {
    const out = [];
    out.push(neckInside(p, 'M164 52C176 60 224 60 236 52C230 80 170 80 164 52Z'));
    out.push(ribBand([[164, 52], [171, 50], [176, 70], [200, 76], [224, 70], [229, 50], [236, 52], [232, 74], [200, 84], [168, 74]], p.trim, shade(p.trim, 0.2), 4));
    // Sleeve hems.
    const hem = sleeveEnd([326, 98], [354, 130], [290, 138], [322, 160], 12);
    out.push(path(polyD(hem) + polyD(mirrorPoly(hem)), { fill: shade(p.main, 0.06), stroke: edge(p.main), 'stroke-width': '1.4' }));
    out.push(stitchLine('M206 336L288 336' + mirrorD('M206 336L288 336'), p.stitching));
    out.push(armSeams(p, [286, 68], [290, 138]));
    return out.join('');
  },

  crewneck(p, details, poly) {
    const out = [];
    out.push(sleeveShade(p, TOP_LONG));
    out.push(neckInside(p, 'M164 50C176 58 224 58 236 50C230 80 170 80 164 50Z'));
    out.push(ribBand([[164, 50], [172, 48], [178, 68], [200, 74], [222, 68], [228, 48], [236, 50], [232, 76], [200, 86], [168, 76]], p.trim, shade(p.trim, 0.2), 3.4));
    const cuff = sleeveEnd([316, 98], [360, 286], [290, 152], [328, 300], 20);
    out.push(ribBand(cuff, p.trim, shade(p.trim, 0.2), 3.4));
    out.push(ribBand(mirrorPoly(cuff), p.trim, shade(p.trim, 0.2), 3.4));
    out.push(ribBand([[108, 318], [292, 318], [292, 340], [200, 344], [108, 340]], p.trim, shade(p.trim, 0.2), 3.4));
    out.push(armSeams(p, [292, 70], [290, 152]));
    return out.join('');
  },

  hoodie(p) {
    const out = [];
    out.push(sleeveShade(p, TOP_LONG));
    // Hood lies flat behind the neck.
    out.push(path('M148 66C138 32 168 12 200 12C232 12 262 32 252 66C240 58 160 58 148 66Z', filled(p.main, edge(p.main))));
    out.push(path('M162 62C160 36 178 26 200 26C222 26 240 36 238 62C226 72 174 72 162 62Z', filled(shade(p.main, 0.26), edge(p.main), 1.6)));
    out.push(path('M162 60C176 76 224 76 238 60C232 86 168 86 162 60Z', filled(p.trim, edge(p.trim), 1.6)));
    // Drawcords.
    out.push(path('M188 80C186 100 188 118 186 134M212 80C214 100 212 118 214 134', { stroke: p.buttons, 'stroke-width': '3.4', fill: 'none' }));
    out.push(path('M186 134L186 142M214 134L214 142', { stroke: shade(p.buttons, 0.3), 'stroke-width': '4', fill: 'none' }));
    // Kangaroo pocket.
    out.push(path('M150 232L250 232L268 304L132 304Z', { fill: shade(p.main, 0.04), stroke: edge(p.main), 'stroke-width': '1.6' }));
    out.push(path('M150 232L132 304M250 232L268 304', { stroke: shade(p.main, 0.35), 'stroke-width': '2.6', fill: 'none' }));
    out.push(stitchLine('M154 238L246 238', p.stitching));
    const cuff = sleeveEnd([316, 98], [360, 286], [290, 152], [328, 300], 20);
    out.push(ribBand(cuff, p.trim, shade(p.trim, 0.2), 3.4));
    out.push(ribBand(mirrorPoly(cuff), p.trim, shade(p.trim, 0.2), 3.4));
    out.push(ribBand([[108, 316], [292, 316], [292, 340], [200, 344], [108, 340]], p.trim, shade(p.trim, 0.2), 3.4));
    out.push(armSeams(p, [292, 70], [290, 152]));
    return out.join('');
  },

  'oxford-shirt'(p, details) {
    const out = [];
    out.push(sleeveShade(p, SHIRT));
    // Collar band and button-down collar leaves.
    out.push(path('M164 48C176 40 224 40 236 48L232 60C220 54 180 54 168 60Z', filled(shade(p.main, 0.2), edge(p.main), 1.6)));
    const leaf = 'M200 66L236 48C242 62 238 84 228 104C216 92 206 80 200 66Z';
    out.push(path(leaf + mirrorD(leaf), filled(p.main, edge(p.main), 1.8)));
    out.push(stitchLine('M205 70C212 82 220 92 227 99M233 54C236 68 233 84 226 98', p.stitching, 1.1));
    out.push(stitchLine(mirrorD('M205 70C212 82 220 92 227 99M233 54C236 68 233 84 226 98'), p.stitching, 1.1));
    // Placket.
    out.push(path('M194 66L206 66L206 354L194 354Z', { fill: 'none', stroke: shade(p.main, 0.22), 'stroke-width': '1.4' }));
    out.push(buttons([[224, 102], [176, 102], [200, 116], [200, 156], [200, 196], [200, 236], [200, 276], [200, 316]], p, 3.4));
    // Chest pocket on the wearer's left.
    out.push(pocket(222, 132, 38, 42, p, { point: true, stitch: false }));
    out.push(stitchLine('M226 136L256 136', p.stitching));
    // Cuffs.
    const cuff = sleeveEnd([316, 96], [360, 286], [290, 152], [328, 300], 22);
    out.push(path(polyD(cuff) + polyD(mirrorPoly(cuff)), { fill: p.main, stroke: edge(p.main), 'stroke-width': '1.6' }));
    out.push(buttons([[cuff[0][0] * 0.5 + cuff[3][0] * 0.5, cuff[0][1] * 0.5 + cuff[3][1] * 0.5 + 10]].flatMap((q) => [q, mirrorPt(q)]), p, 2.8));
    out.push(armSeams(p, [292, 68], [290, 152]));
    return out.join('');
  },

  overshirt(p, details) {
    const out = [];
    out.push(sleeveShade(p, TOP_LONG));
    out.push(path('M164 50C176 42 224 42 236 50L232 62C220 56 180 56 168 62Z', filled(shade(p.main, 0.22), edge(p.main), 1.6)));
    const leaf = 'M200 68L236 50C244 62 246 80 240 98C222 90 208 80 200 68Z';
    out.push(path(leaf + mirrorD(leaf), filled(p.main, edge(p.main), 1.8)));
    out.push(path('M193 68L207 68L207 340L193 340Z', { fill: 'none', stroke: shade(p.main, 0.22), 'stroke-width': '1.4' }));
    out.push(buttons([[200, 104], [200, 150], [200, 196], [200, 242], [200, 288]], p, 3.8));
    out.push(pocket(222, 128, 44, 46, p, { flap: true }));
    out.push(pocket(134, 128, 44, 46, p, { flap: true }));
    out.push(buttons([[244, 138], [156, 138]], p, 2.8));
    const cuff = sleeveEnd([316, 98], [360, 286], [290, 152], [328, 300], 22);
    out.push(path(polyD(cuff) + polyD(mirrorPoly(cuff)), { fill: p.main, stroke: edge(p.main), 'stroke-width': '1.6' }));
    out.push(stitchLine('M206 330L290 330' + mirrorD('M206 330L290 330'), p.stitching));
    out.push(armSeams(p, [292, 70], [290, 152]));
    return out.join('');
  },

  'chore-jacket'(p) {
    const out = [];
    out.push(sleeveShade(p, BOXY));
    out.push(path('M162 50C176 42 224 42 238 50L234 64C222 58 178 58 166 64Z', filled(shade(p.main, 0.22), edge(p.main), 1.6)));
    const leaf = 'M200 74L238 50C252 62 260 82 256 104C232 96 212 86 200 74Z';
    out.push(path(leaf + mirrorD(leaf), filled(p.main, edge(p.main), 1.8)));
    out.push(stitchLine('M206 76C220 86 238 94 252 99', p.stitching) + stitchLine(mirrorD('M206 76C220 86 238 94 252 99'), p.stitching));
    out.push(path('M192 74L208 74L208 344L192 344Z', { fill: 'none', stroke: shade(p.main, 0.22), 'stroke-width': '1.4' }));
    out.push(buttons([[200, 112], [200, 162], [200, 212], [200, 262], [200, 312]], p, 4.4));
    out.push(pocket(226, 122, 42, 44, p));
    out.push(pocket(222, 236, 56, 62, p));
    out.push(pocket(122, 236, 56, 62, p));
    const cuff = sleeveEnd([320, 98], [362, 286], [294, 156], [330, 300], 18);
    out.push(stitchLine(`M${pt(...cuff[0])}L${pt(...cuff[3])}` + mirrorD(`M${pt(...cuff[0])}L${pt(...cuff[3])}`), p.stitching));
    out.push(stitchLine('M206 332L294 332' + mirrorD('M206 332L294 332'), p.stitching));
    out.push(armSeams(p, [296, 70], [294, 156]));
    return out.join('');
  },

  'field-jacket'(p, details) {
    const out = [];
    out.push(sleeveShade(p, BOXY));
    // Collar in the secondary color (corduroy on the demo jacket: fine ribs).
    const collar = 'M158 52C172 40 228 40 242 52L262 92C246 84 226 76 200 74C174 76 154 84 138 92Z';
    out.push(path(collar, filled(p.secondary, edge(p.secondary), 1.8)));
    if ((details.collar ?? 'corduroy') === 'corduroy') {
      let ribs = '';
      for (let x = 146; x <= 254; x += 5) ribs += `M${n(x)} ${n(54 + Math.abs(x - 200) * 0.32)}L${n(x + (x - 200) * 0.08)} ${n(78 + Math.abs(x - 200) * 0.12)}`;
      out.push(path(ribs, { stroke: shade(p.secondary, 0.25), 'stroke-width': '1.2', fill: 'none' }));
    }
    // Snap placket.
    out.push(path('M190 76L210 76L210 346L190 346Z', filled(shade(p.main, 0.03), edge(p.main), 1.4)));
    out.push(buttons([[200, 102], [200, 150], [200, 198], [200, 246], [200, 294]], { ...p, buttons: p.trim }, 4));
    // Four bellows pockets with flaps.
    const count = Number(details.pockets ?? 4);
    out.push(pocket(222, 132, 46, 48, p, { flap: true }));
    out.push(pocket(132, 132, 46, 48, p, { flap: true }));
    if (count >= 4) {
      out.push(pocket(220, 238, 58, 64, p, { flap: true }));
      out.push(pocket(122, 238, 58, 64, p, { flap: true }));
    }
    out.push(buttons([[245, 142], [155, 142], ...(count >= 4 ? [[249, 248], [151, 248]] : [])], { ...p, buttons: p.trim }, 3));
    const cuff = sleeveEnd([320, 98], [362, 286], [294, 156], [330, 300], 18);
    out.push(path(polyD(cuff) + polyD(mirrorPoly(cuff)), { fill: shade(p.main, 0.05), stroke: edge(p.main), 'stroke-width': '1.6' }));
    out.push(stitchLine('M212 330L294 330' + mirrorD('M212 330L294 330'), p.stitching));
    out.push(armSeams(p, [296, 70], [294, 156]));
    return out.join('');
  },

  bomber(p) {
    const out = [];
    out.push(sleeveShade(p, PUFFY));
    out.push(path('M162 52C176 44 224 44 238 52L240 72C224 66 176 66 160 72Z', filled(p.trim, edge(p.trim), 1.6)));
    out.push(ribBand([[160, 56], [240, 56], [240, 72], [160, 72]], p.trim, shade(p.trim, 0.25), 3.6));
    const cuff = sleeveEnd([318, 100], [360, 280], [292, 156], [330, 294], 22);
    out.push(ribBand(cuff, p.trim, shade(p.trim, 0.25), 3.6));
    out.push(ribBand(mirrorPoly(cuff), p.trim, shade(p.trim, 0.25), 3.6));
    out.push(ribBand([[116, 300], [284, 300], [290, 324], [200, 328], [110, 324]], p.trim, shade(p.trim, 0.25), 3.6));
    // Center zip and puller.
    out.push(path('M200 72L200 326', { stroke: shade(p.main, 0.3), 'stroke-width': '4', fill: 'none' }));
    out.push(path('M200 72L200 326', { stroke: p.buttons, 'stroke-width': '1.6', 'stroke-dasharray': '1.6 1.6', fill: 'none' }));
    out.push(rect(196, 76, 8, 16, 2.5, filled(p.buttons, edge(p.buttons), 1.2)));
    // Welt pockets and the utility pocket on the left sleeve.
    out.push(path('M232 226L262 262M168 226L138 262', { stroke: shade(p.main, 0.35), 'stroke-width': '3.4', fill: 'none' }));
    out.push(path('M318 150L336 146L346 184L328 188Z', { fill: shade(p.main, 0.05), stroke: edge(p.main), 'stroke-width': '1.6' }));
    out.push(path('M320 158L338 154', { stroke: p.buttons, 'stroke-width': '1.8', fill: 'none' }));
    out.push(armSeams(p, [292, 72], [292, 156]));
    return out.join('');
  },

  chinos(p) {
    return bottoms(p, { slant: true, loops: true, crease: false });
  },
  trousers(p) {
    return bottoms(p, { slant: true, loops: false, crease: true, adjusters: true });
  },
  jeans(p) {
    return bottoms(p, { scoop: true, loops: true, rivets: true, coin: true });
  },
  shorts(p) {
    return bottoms(p, { slant: true, loops: true, short: true });
  },
};

function bottoms(p, f) {
  const out = [];
  const top = f.short ? 96 : 38;
  const wb = 16;
  const offset = top - 38;
  const T = (d) => toD(parse(d).map((c) => (c.length > 1 ? [c[0], ...c.slice(1).map((v, i) => (i % 2 ? v + offset : v))] : c)));
  // Waistband.
  out.push(path(T('M120 38L280 38L281 54L119 54Z'), filled(shade(p.main, 0.05), edge(p.main), 1.6)));
  out.push(stitchLine(T('M124 50L276 50'), p.stitching, 1.2));
  out.push(circle(208, top + 8, 4, filled(p.buttons, edge(p.buttons), 1.2)));
  // Fly.
  out.push(stitchLine(T('M214 56L214 118C214 126 210 130 202 132'), f.scoop ? p.stitching : shade(p.main, 0.3), f.scoop ? 1.6 : 1.4));
  out.push(path(T('M200 56L200 150'), { stroke: shade(p.main, 0.3), 'stroke-width': '1.4', fill: 'none' }));
  if (f.loops) {
    const loops = [128, 164, 236, 272].map((x) => rect(x - 3, top - 2, 6, wb + 4, 1.5)).join('');
    out.push(group(filled(p.main, edge(p.main), 1.2), loops));
  }
  if (f.slant) {
    const d = T('M250 56L286 112');
    out.push(path(d + mirrorD(d), { stroke: shade(p.main, 0.35), 'stroke-width': '2', fill: 'none' }));
  }
  if (f.scoop) {
    const d = T('M244 56C246 80 260 96 288 100');
    out.push(path(d + mirrorD(d), { stroke: shade(p.main, 0.35), 'stroke-width': '1.8', fill: 'none' }));
    const s = T('M240 56C242 84 258 102 288 106');
    out.push(stitchLine(s + mirrorD(s), p.stitching, 1.5));
    if (f.coin) out.push(stitchLine(mirrorD(T('M262 62L280 62L281 80L263 82Z')), p.stitching, 1.3));
    if (f.rivets) out.push(group({ fill: p.trim }, [[244, 58], [287, 100]].flatMap((q) => [q, mirrorPt(q)]).map(([x, y]) => circle(x, y + offset, 2.6)).join('')));
    const seams = T('M292 140L292 368');
    out.push(stitchLine(seams + mirrorD(seams), p.stitching, 1.3));
  }
  if (f.adjusters) {
    out.push(rect(270, 41, 16, 9, 2, filled(shade(p.main, 0.1), edge(p.main), 1.2)));
    out.push(rect(114, 41, 16, 9, 2, filled(shade(p.main, 0.1), edge(p.main), 1.2)));
  }
  if (f.crease) {
    const d = 'M246 58L262 372';
    out.push(path(d + mirrorD(d), { stroke: tint(p.main, 0.16), 'stroke-width': '1.6', fill: 'none' }));
  }
  // Inner leg shading and the hem.
  const legShade = f.short ? 'M205 210L218 300L230 300L214 212Z' : 'M204 168L222 376L234 376L214 172Z';
  out.push(path(legShade + mirrorD(legShade), { fill: shade(p.main, 0.12), 'fill-opacity': '.6' }));
  if (f.short) {
    const hem = 'M218 284L307 280L308 296L218 300Z';
    out.push(path(hem + mirrorD(hem), filled(shade(p.main, 0.04), edge(p.main), 1.4)));
  } else {
    out.push(stitchLine('M224 366L300 364' + mirrorD('M224 366L300 364'), f.scoop ? p.stitching : shade(p.main, 0.3), 1.3));
  }
  return out.join('');
}

// ---------- Public API ----------

/**
 * Renders an illustration spec to SVG markup (viewBox 0 0 400 400, transparent background).
 * @param {{ kind: 'sneaker'|'watch'|'clothing', shape: string, details?: object,
 *   palette: Record<string,string>, options?: object }} spec
 * @param {{ background?: string, size?: number }} [opts]
 * @returns {string}
 */
export function renderSpecSvg(spec, opts = {}) {
  const s = spec ?? {};
  const palette = s.palette ?? {};
  let body;
  if (s.kind === 'watch') body = drawWatch(s, palette);
  else if (s.kind === 'clothing') body = drawClothing(s, palette);
  else body = drawSneaker(s, palette);
  const bg = hex(opts.background, null);
  const size = Number.isFinite(opts.size) && opts.size > 0 ? Math.round(opts.size) : 400;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="${size}" height="${size}" stroke-linejoin="round" stroke-linecap="round">${bg ? `<rect width="400" height="400" fill="${bg}"/>` : ''}${body}</svg>`;
}

/**
 * Spec for a catalog variant: product.illustration merged with the variant's palette/options.
 * @param {any} product
 * @param {any} variant
 */
export function specFor(product, variant) {
  return {
    kind: product.illustration?.kind ?? product.category,
    shape: product.illustration?.shape ?? product.type,
    details: product.illustration?.details ?? {},
    ...product.illustration,
    palette: variant.illustration?.palette ?? {},
    options: variant.illustration?.options ?? {},
  };
}

/**
 * @param {any} product
 * @param {any} variant
 * @param {{ background?: string, size?: number }} [opts]
 */
export function renderVariantSvg(product, variant, opts = {}) {
  return renderSpecSvg(specFor(product, variant), opts);
}

const cache = new Map();

/** Data URL for a variant's catalog illustration, memoized per variant and generator version. */
export function variantImageUrl(product, variant) {
  const key = `${ILLUSTRATION_VERSION}:${variant.id}:${JSON.stringify(variant.illustration ?? null)}:${JSON.stringify(product.illustration ?? null)}`;
  if (!cache.has(key)) {
    if (cache.size > 2000) cache.clear();
    cache.set(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderVariantSvg(product, variant))}`);
  }
  return cache.get(key);
}
