// Color and layout features from pixels. The same function analyzes a person's photo and a
// rasterized catalog illustration, so both sides of every comparison are measured the same way.
// Pure: takes ImageData-like { width, height, data } and runs in Node tests (no DOM).
//
// Steps: CIE Lab -> background model from the border (clusters with a gradient/vignette fit)
// -> flood fill of background-like pixels from the border (edges stop it; soft shadows are
// treated as background unless that would erase the item) -> keep the main object, fill holes
// -> bbox, aspect and a spatial color grid in the object's upright frame -> k-means palette.
import { deltaE, hexToLab, hexToRgb, nearestColorName, rgbToHex } from '../data/colors.js';

export { deltaE };

/** Features.v: bump when the measurement changes so cached reference features are rebuilt. */
export const FEATURES_VERSION = 1;

/** Long side, in pixels, of the image the pipeline analyzes (photos and reference renders). */
export const ANALYSIS_SIZE = 256;

/** Neutral studio backdrop used for reference renders and photo clean-up. */
export const STUDIO_HEX = '#e6e8e3';

/**
 * Neutral studio tones for reference renders. Each variant is drawn on the tone farthest from
 * its own colors, so a white sneaker isn't lost on a white backdrop; the backdrop never enters
 * the features, only the segmentation that runs on it (the same one photos get).
 */
export const STUDIO_TONES = ['#e6e8e3', '#a9aca7', '#5c5f5b'];

/**
 * Picks the studio tone with the most contrast to a set of colors.
 * @param {string[]} hexes illustration palette colors
 */
export function referenceBackdrop(hexes) {
  const labs = (hexes ?? []).filter((h) => /^#[0-9a-f]{6}$/i.test(h)).map((h) => hexToLab(h));
  if (!labs.length) return STUDIO_TONES[0];
  let best = STUDIO_TONES[0];
  let bestD = -1;
  for (const tone of STUDIO_TONES) {
    const t = hexToLab(tone);
    const d = Math.min(...labs.map((l) => deltaE(l, t)));
    if (d > bestD) {
      bestD = d;
      best = tone;
    }
  }
  return best;
}

/** Grid shape per category: sneakers are long and low, watches tall (strap), clothing in between. */
export const GRID_SHAPES = {
  sneaker: { cols: 6, rows: 4 },
  watch: { cols: 4, rows: 6 },
  clothing: { cols: 4, rows: 5 },
  default: { cols: 5, rows: 5 },
};

/** Segmentation and palette settings. Exported so the debug page can show what was used. */
export const FEATURE_CONFIG = {
  borderBand: 0.035, // share of the short side sampled as background
  borderSamples: 900,
  bgClusters: 3,
  bgMergeDeltaE: 10,
  bgMinShare: 0.06, // border clusters smaller than this are treated as the item touching the edge
  bgThresholdK: 3, // background tolerance = K * robust spread + base, clamped
  bgThresholdBase: 4,
  // On a perfectly flat backdrop (no texture or noise) the tolerance falls to the base, so an
  // off-white item on a light grey studio tone (about 5 apart) is still an item.
  bgThresholdMin: 4,
  bgThresholdMax: 26,
  edgeMin: 4, // gradient (L per pixel) that stops the background flood fill
  edgeK: 1.8,
  // crossMinRatio: only shade at least this light may cross a hard edge. Room-light shadows on a
  // surface rarely go darker; a darker neutral patch is more likely a dark part of the item.
  shadow: { minRatio: 0.5, maxRatio: 0.97, minDrop: 3, chroma: 4.5, keepShare: 0.6, crossMinRatio: 0.65 },
  attachRadius: 3, // fragments this close to the main object belong to it
  minObjectShare: 0.004, // smaller than this means no item was found
  paletteK: 6,
  paletteSamples: 2600,
  paletteIterations: 10,
  paletteMergeDeltaE: 8,
  paletteMinWeight: 0.025,
  cellMinFill: 0.2,
  maxDeskewDeg: 25,
  minElongation: 1.25,
  edgeThreshold: 6,
};

// ---------- Color conversion (same constants as data/colors.js rgbToLab, with a lookup) ----------

const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  LINEAR[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;
const fLab = (t) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);

/** Lab of a hex color, e.g. labFromHex('#5d6136'). */
export function labFromHex(hex) {
  return hexToLab(hex);
}

function labInto(r, g, b, L, A, B, i) {
  const R = LINEAR[r];
  const G = LINEAR[g];
  const Bl = LINEAR[b];
  const fx = fLab((R * 0.4124 + G * 0.3576 + Bl * 0.1805) / 0.95047);
  const fy = fLab(R * 0.2126 + G * 0.7152 + Bl * 0.0722);
  const fz = fLab((R * 0.0193 + G * 0.1192 + Bl * 0.9505) / 1.08883);
  L[i] = 116 * fy - 16;
  A[i] = 500 * (fx - fy);
  B[i] = 200 * (fy - fz);
}

// ---------- Image preparation ----------

/**
 * Converts ImageData-like input into RGB and Lab planes at analysis size. Larger inputs are
 * box-averaged by an integer factor; transparent pixels are composited onto the studio color.
 */
function prepare(imageData) {
  const srcW = imageData.width;
  const srcH = imageData.height;
  const src = imageData.data;
  const factor = Math.max(1, Math.ceil(Math.max(srcW, srcH) / ANALYSIS_SIZE));
  const w = Math.max(1, Math.floor(srcW / factor));
  const h = Math.max(1, Math.floor(srcH / factor));
  const n = w * h;
  const rgb = new Uint8ClampedArray(n * 3);
  const [sr, sg, sb] = hexToRgb(STUDIO_HEX);
  const area = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < factor; dy++) {
        let p = ((y * factor + dy) * srcW + x * factor) * 4;
        for (let dx = 0; dx < factor; dx++, p += 4) {
          const a = src[p + 3];
          if (a === 255) {
            r += src[p];
            g += src[p + 1];
            b += src[p + 2];
          } else {
            const t = a / 255;
            r += src[p] * t + sr * (1 - t);
            g += src[p + 1] * t + sg * (1 - t);
            b += src[p + 2] * t + sb * (1 - t);
          }
        }
      }
      const o = (y * w + x) * 3;
      rgb[o] = r / area;
      rgb[o + 1] = g / area;
      rgb[o + 2] = b / area;
    }
  }
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 3) labInto(rgb[o], rgb[o + 1], rgb[o + 2], L, A, B, i);
  return { w, h, n, rgb, L, A, B };
}

/** Separable box blur with clamped edges. */
function boxBlur(src, w, h, r) {
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const size = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / size;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / size;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Sobel gradient magnitude in L units per pixel. */
function gradient(L, w, h) {
  const g = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1];
      const gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1];
      g[i] = Math.sqrt(gx * gx + gy * gy) / 8;
    }
  }
  // Copy the nearest interior value onto the 1 px frame.
  for (let x = 0; x < w; x++) {
    g[x] = g[Math.min(h - 1, 1) * w + x];
    g[(h - 1) * w + x] = g[Math.max(0, h - 2) * w + x];
  }
  for (let y = 0; y < h; y++) {
    g[y * w] = g[y * w + Math.min(w - 1, 1)];
    g[y * w + w - 1] = g[y * w + Math.max(0, w - 2)];
  }
  return g;
}

// ---------- Small numeric helpers ----------

function median(values) {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

/** Solves a small dense linear system (Gaussian elimination with partial pivoting). */
function solve(M, v) {
  const n = v.length;
  const a = M.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = c + 1; r < n; r++) {
      const k = a[r][c] / a[c][c];
      for (let j = c; j <= n; j++) a[r][j] -= k * a[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n];
    for (let j = r + 1; j < n; j++) s -= a[r][j] * x[j];
    x[r] = s / a[r][r];
  }
  return x;
}

const dist3 = (l1, a1, b1, l2, a2, b2) => Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);

// ---------- Background model ----------

/**
 * Samples a band along the border, clusters it in Lab (wood, wall and tabletop can all appear
 * in one photo) and fits each cluster's color as a smooth function of position (linear
 * gradient plus a radial term for vignetting). Tolerance follows the cluster's own texture.
 */
function backgroundModel(img, Ls, As, Bs, grad, cfg) {
  const { w, h } = img;
  const band = Math.max(2, Math.round(Math.min(w, h) * cfg.borderBand));
  const idx = [];
  for (let y = 0; y < h; y++) {
    const edgeRow = y < band || y >= h - band;
    for (let x = 0; x < w; x++) {
      if (edgeRow || x < band || x >= w - band) idx.push(y * w + x);
    }
  }
  const stride = Math.max(1, Math.floor(idx.length / cfg.borderSamples));
  const S = [];
  for (let k = 0; k < idx.length; k += stride) {
    const i = idx[k];
    const x = i % w;
    const y = (i - x) / w;
    const side = (y < band ? 1 : 0) | (y >= h - band ? 2 : 0) | (x < band ? 4 : 0) | (x >= w - band ? 8 : 0);
    S.push({ dx: (x + 0.5) / w - 0.5, dy: (y + 0.5) / h - 0.5, L: Ls[i], a: As[i], b: Bs[i], g: grad[i], side, c: 0 });
  }

  // k-means on the samples, initialised from the median-lightness sample, then farthest points.
  const byL = [...S].sort((p, q) => p.L - q.L);
  const centers = [{ L: byL[byL.length >> 1].L, a: byL[byL.length >> 1].a, b: byL[byL.length >> 1].b }];
  while (centers.length < cfg.bgClusters) {
    let far = null;
    let farD = -1;
    for (const s of S) {
      let d = Infinity;
      for (const c of centers) d = Math.min(d, dist3(s.L, s.a, s.b, c.L, c.a, c.b));
      if (d > farD) {
        farD = d;
        far = s;
      }
    }
    if (!far || farD < cfg.bgMergeDeltaE) break;
    centers.push({ L: far.L, a: far.a, b: far.b });
  }
  for (let iter = 0; iter < 6; iter++) {
    const sums = centers.map(() => ({ L: 0, a: 0, b: 0, n: 0 }));
    for (const s of S) {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, k) => {
        const d = dist3(s.L, s.a, s.b, c.L, c.a, c.b);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      s.c = best;
      const t = sums[best];
      t.L += s.L;
      t.a += s.a;
      t.b += s.b;
      t.n += 1;
    }
    centers.forEach((c, k) => {
      if (sums[k].n) {
        c.L = sums[k].L / sums[k].n;
        c.a = sums[k].a / sums[k].n;
        c.b = sums[k].b / sums[k].n;
      }
    });
  }
  let groups = centers.map((c, k) => ({ center: c, members: S.filter((s) => s.c === k) })).filter((g) => g.members.length);
  // Merge clusters that are really one surface.
  for (let merged = true; merged && groups.length > 1; ) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i++) {
      for (let j = i + 1; j < groups.length && !merged; j++) {
        const a = groups[i].center;
        const b = groups[j].center;
        if (dist3(a.L, a.a, a.b, b.L, b.a, b.b) < cfg.bgMergeDeltaE) {
          const members = [...groups[i].members, ...groups[j].members];
          const mean = (key) => members.reduce((s, m) => s + m[key], 0) / members.length;
          groups.splice(j, 1);
          groups[i] = { center: { L: mean('L'), a: mean('a'), b: mean('b') }, members };
          merged = true;
        }
      }
    }
  }
  const total = S.length;
  const kept = groups.filter((g) => g.members.length / total >= cfg.bgMinShare);
  groups = kept.length ? kept : [groups.reduce((a, b) => (b.members.length > a.members.length ? b : a))];

  const clusters = groups.map((g) => fitCluster(g.members, total, cfg));
  const borderGrad = S.map((s) => s.g);
  const edgeLimit = Math.max(cfg.edgeMin, cfg.edgeK * quantile(borderGrad, 0.95));
  return { band, clusters, edgeLimit };
}

/** Ridge least-squares fit of L, a, b over [1, dx, dy, r^2], refit once without outliers. */
function fitCluster(members, total, cfg) {
  const fit = (pts) => {
    const lambda = 0.01 * pts.length;
    const M = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const vL = [0, 0, 0, 0];
    const vA = [0, 0, 0, 0];
    const vB = [0, 0, 0, 0];
    for (const p of pts) {
      const row = [1, p.dx, p.dy, p.dx * p.dx + p.dy * p.dy];
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) M[i][j] += row[i] * row[j];
        vL[i] += row[i] * p.L;
        vA[i] += row[i] * p.a;
        vB[i] += row[i] * p.b;
      }
    }
    for (let i = 1; i < 4; i++) M[i][i] += lambda;
    const mean = (key) => pts.reduce((s, m) => s + m[key], 0) / pts.length;
    return {
      L: solve(M, vL) ?? [mean('L'), 0, 0, 0],
      a: solve(M, vA) ?? [mean('a'), 0, 0, 0],
      b: solve(M, vB) ?? [mean('b'), 0, 0, 0],
    };
  };
  const evalAt = (coef, p) => {
    const r2 = p.dx * p.dx + p.dy * p.dy;
    return [
      coef.L[0] + coef.L[1] * p.dx + coef.L[2] * p.dy + coef.L[3] * r2,
      coef.a[0] + coef.a[1] * p.dx + coef.a[2] * p.dy + coef.a[3] * r2,
      coef.b[0] + coef.b[1] * p.dx + coef.b[2] * p.dy + coef.b[3] * r2,
    ];
  };
  const residuals = (coef, pts) =>
    pts.map((p) => {
      const [L, a, b] = evalAt(coef, p);
      return dist3(p.L, p.a, p.b, L, a, b);
    });
  let coef = fit(members);
  let res = residuals(coef, members);
  const sigma0 = 1.4826 * median(res);
  const inliers = members.filter((_, i) => res[i] <= Math.max(3 * sigma0, 3));
  if (inliers.length >= 12 && inliers.length < members.length) {
    coef = fit(inliers);
    res = residuals(coef, inliers);
  }
  const sigma = 1.4826 * median(res);
  const threshold = Math.min(cfg.bgThresholdMax, Math.max(cfg.bgThresholdMin, cfg.bgThresholdK * sigma + cfg.bgThresholdBase));
  let sides = 0;
  for (const m of members) sides |= m.side;
  return { coef, sigma, threshold, share: members.length / total, sides };
}

// ---------- Mask operations ----------

/** Flood fill from passable border pixels; returns 1 for reached (background) pixels. */
function floodFromBorder(w, h, passable) {
  const n = w * h;
  const reached = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const push = (i) => {
    if (!reached[i] && passable[i]) {
      reached[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < n - w) push(i + w);
  }
  return reached;
}

/** Square min/max filter (erode when `max` is false), separable, O(n) via sliding counts. */
function morph(mask, w, h, r, max) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = 0; x <= Math.min(w - 1, r); x++) count += mask[row + x];
    for (let x = 0; x < w; x++) {
      const size = Math.min(w - 1, x + r) - Math.max(0, x - r) + 1;
      tmp[row + x] = max ? (count > 0 ? 1 : 0) : count === size ? 1 : 0;
      if (x - r >= 0) count -= mask[row + x - r];
      if (x + r + 1 < w) count += mask[row + x + r + 1];
    }
  }
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y <= Math.min(h - 1, r); y++) count += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const size = Math.min(h - 1, y + r) - Math.max(0, y - r) + 1;
      out[y * w + x] = max ? (count > 0 ? 1 : 0) : count === size ? 1 : 0;
      if (y - r >= 0) count -= tmp[(y - r) * w + x];
      if (y + r + 1 < h) count += tmp[(y + r + 1) * w + x];
    }
  }
  return out;
}

function invert(mask) {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1;
  return out;
}

/** 8-connected components of a binary mask: { labels, areas } (label 0 = background). */
function components(mask, w, h) {
  const n = w * h;
  const labels = new Int32Array(n);
  const areas = [0];
  const queue = new Int32Array(n);
  let next = 1;
  for (let s = 0; s < n; s++) {
    if (!mask[s] || labels[s]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    labels[s] = next;
    let area = 0;
    while (head < tail) {
      const i = queue[head++];
      area += 1;
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && !labels[j]) {
            labels[j] = next;
            queue[tail++] = j;
          }
        }
      }
    }
    areas.push(area);
    next += 1;
  }
  return { labels, areas };
}

/** Keeps the largest component and fragments touching it, then fills enclosed holes. */
function mainObject(mask, w, h, cfg) {
  const n = w * h;
  const opened = morph(morph(mask, w, h, 1, false), w, h, 1, true);
  const { labels, areas } = components(opened, w, h);
  let main = 0;
  for (let k = 1; k < areas.length; k++) if (!main || areas[k] > areas[main]) main = k;
  const out = new Uint8Array(n);
  if (!main) return { mask: out, area: 0 };
  const mainMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mainMask[i] = labels[i] === main ? 1 : 0;
  const near = morph(mainMask, w, h, cfg.attachRadius, true);
  const keep = new Uint8Array(areas.length);
  keep[main] = 1;
  for (let i = 0; i < n; i++) if (labels[i] && near[i]) keep[labels[i]] = 1;
  const free = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = keep[labels[i]];
    free[i] = out[i] ? 0 : 1;
  }
  // Holes: anything the outside can't reach is part of the item (a white dial, a buttonhole).
  const outside = floodFromBorder(w, h, free);
  let area = 0;
  for (let i = 0; i < n; i++) {
    out[i] = outside[i] ? 0 : 1;
    area += out[i];
  }
  return { mask: out, area };
}

// ---------- Segmentation ----------

/** Distance from a Lab point to the segment between two Lab points. */
function segmentDistance(L, a, b, p, q) {
  const dL = q[0] - p[0];
  const dA = q[1] - p[1];
  const dB = q[2] - p[2];
  const len2 = dL * dL + dA * dA + dB * dB;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((L - p[0]) * dL + (a - p[1]) * dA + (b - p[2]) * dB) / len2)) : 0;
  return dist3(L, a, b, p[0] + t * dL, p[1] + t * dA, p[2] + t * dB);
}

/**
 * Scores pixels against the background model: `bg` is 1 where the color is within a border
 * cluster's tolerance, `shadow` where it looks like the backdrop in shade. With `only`, just
 * those pixels are scored (used to refine the boundary at a finer blur). With `mixtures`, a
 * blend of two backdrop surfaces (the seam where a tabletop meets a wall) also counts as
 * background.
 */
function scoreBackground(w, h, Lp, Ap, Bp, model, cfg, only = null, mixtures = false) {
  const n = w * h;
  const bg = new Uint8Array(n);
  const shadow = new Uint8Array(n);
  const { clusters } = model;
  const sh = cfg.shadow;
  const local = clusters.map(() => [0, 0, 0]);
  for (let y = 0; y < h; y++) {
    const dy = (y + 0.5) / h - 0.5;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (only && !only[i]) continue;
      const dx = (x + 0.5) / w - 0.5;
      const r2 = dx * dx + dy * dy;
      let bestScore = Infinity;
      let nearestD = Infinity;
      let nL = 0;
      let nA = 0;
      let nB = 0;
      for (let k = 0; k < clusters.length; k++) {
        const c = clusters[k];
        const mL = c.coef.L[0] + c.coef.L[1] * dx + c.coef.L[2] * dy + c.coef.L[3] * r2;
        const mA = c.coef.a[0] + c.coef.a[1] * dx + c.coef.a[2] * dy + c.coef.a[3] * r2;
        const mB = c.coef.b[0] + c.coef.b[1] * dx + c.coef.b[2] * dy + c.coef.b[3] * r2;
        local[k][0] = mL;
        local[k][1] = mA;
        local[k][2] = mB;
        const d = dist3(Lp[i], Ap[i], Bp[i], mL, mA, mB);
        if (d - c.threshold < bestScore) bestScore = d - c.threshold;
        if (d < nearestD) {
          nearestD = d;
          nL = mL;
          nA = mA;
          nB = mB;
        }
      }
      if (bestScore < 0) bg[i] = 1;
      if (mixtures && !bg[i]) {
        for (let p = 0; p < clusters.length && !bg[i]; p++) {
          for (let q = p + 1; q < clusters.length && !bg[i]; q++) {
            const tol = Math.min(clusters[p].threshold, clusters[q].threshold);
            if (segmentDistance(Lp[i], Ap[i], Bp[i], local[p], local[q]) < tol) bg[i] = 1;
          }
        }
      }
      // A cast shadow darkens the surface without changing its hue: in Lab, L+16, a and b
      // shrink by about the same factor. 1 marks moderate shade, 2 deep shade.
      const ratio = (Lp[i] + 16) / (nL + 16);
      if (ratio >= sh.minRatio && ratio <= sh.maxRatio && Lp[i] < nL - sh.minDrop) {
        if (Math.hypot(Ap[i] - nA * ratio, Bp[i] - nB * ratio) < sh.chroma) shadow[i] = ratio >= sh.crossMinRatio ? 1 : 2;
      }
    }
  }
  return { bg, shadow };
}

/**
 * Foreground mask for an image. Returns the mask plus what the debug page shows.
 */
function segment(img, cfg) {
  const { w, h, n, L, A, B } = img;
  // A 5x5 blur steadies the background test against noise and texture; a 3x3 blur keeps
  // edges sharp for the gradient barrier and the final boundary.
  const Ls = boxBlur(L, w, h, 2);
  const As = boxBlur(A, w, h, 2);
  const Bs = boxBlur(B, w, h, 2);
  const L1 = boxBlur(L, w, h, 1);
  const grad = gradient(L1, w, h);
  const model = backgroundModel(img, Ls, As, Bs, grad, cfg);
  const { bg, shadow } = scoreBackground(w, h, Ls, As, Bs, model, cfg);

  const pass = new Uint8Array(n);
  for (let i = 0; i < n; i++) pass[i] = bg[i] && grad[i] < model.edgeLimit ? 1 : 0;
  const strict = mainObject(invert(floodFromBorder(w, h, pass)), w, h, cfg);

  // Only try shadow removal when the strict item contains a meaningful amount of shade.
  let shaded = 0;
  for (let i = 0; i < n; i++) if (strict.mask[i] && shadow[i]) shaded += 1;
  let chosen = strict;
  let mode = 'strict';
  if (shaded > 0.015 * strict.area) {
    // A shadow under a flash or a desk lamp has a hard edge. That edge may be crossed where
    // everything around it is backdrop or moderate shade (lit floor meeting shaded floor), never
    // where the item, or a deep shade that may belong to it, is part of the neighborhood.
    const soft = new Uint8Array(n);
    const crossable = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      soft[i] = bg[i] || shadow[i] ? 1 : 0;
      crossable[i] = bg[i] || shadow[i] === 1 ? 1 : 0;
    }
    const calm = morph(crossable, w, h, 2, false);
    for (let i = 0; i < n; i++) pass[i] = soft[i] && (grad[i] < model.edgeLimit || calm[i]) ? 1 : 0;
    const tolerant = mainObject(invert(floodFromBorder(w, h, pass)), w, h, cfg);
    // If treating shade as background removes most of the item, the item itself is a darker
    // shade of the backdrop (grey trousers on concrete): keep the strict mask.
    if (tolerant.area > 0 && tolerant.area >= cfg.shadow.keepShare * strict.area) {
      chosen = tolerant;
      mode = 'shadow_removed';
    }
  }

  // The 5x5 blur widens the item by about two pixels; re-test the outer band at 3x3 and drop
  // pixels that are really backdrop, so edges don't leak backdrop color into the palette.
  const mask = chosen.mask;
  let area = chosen.area;
  if (area) {
    const band = new Uint8Array(n);
    const core = morph(mask, w, h, 3, false);
    for (let i = 0; i < n; i++) band[i] = mask[i] && !core[i] ? 1 : 0;
    const fine = scoreBackground(w, h, L1, boxBlur(A, w, h, 1), boxBlur(B, w, h, 1), model, cfg, band, true);
    for (let i = 0; i < n; i++) {
      if (band[i] && (fine.bg[i] || (mode === 'shadow_removed' && fine.shadow[i]))) {
        mask[i] = 0;
        area -= 1;
      }
    }
  }
  return { mask, area, mode, model, grad };
}

// ---------- Palette ----------

/**
 * Deterministic k-means in Lab: seeded from the most populated coarse color bins, then Lloyd
 * iterations, then near-identical clusters merged and slivers folded into their neighbors.
 */
function palette(img, mask, count, cfg, category) {
  const { n, L, A, B, rgb } = img;
  const stride = Math.max(1, Math.floor(count / cfg.paletteSamples));
  const idx = [];
  let seen = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    if (seen++ % stride === 0) idx.push(i);
  }
  if (!idx.length) return [];

  const bins = new Map();
  for (const i of idx) {
    const key = Math.round(L[i] / 10) * 10000 + (Math.round(A[i] / 14) + 50) * 100 + (Math.round(B[i] / 14) + 50);
    const bin = bins.get(key) ?? { n: 0, L: 0, a: 0, b: 0 };
    bin.n += 1;
    bin.L += L[i];
    bin.a += A[i];
    bin.b += B[i];
    bins.set(key, bin);
  }
  const ordered = [...bins.entries()].sort((p, q) => q[1].n - p[1].n || p[0] - q[0]).map(([, b]) => ({ L: b.L / b.n, a: b.a / b.n, b: b.b / b.n }));
  const centers = [];
  for (const c of ordered) {
    if (centers.every((k) => dist3(k.L, k.a, k.b, c.L, c.a, c.b) >= 12)) centers.push(c);
    if (centers.length === cfg.paletteK) break;
  }

  const assign = new Int32Array(idx.length).fill(-1);
  for (let iter = 0; iter < cfg.paletteIterations; iter++) {
    let changed = 0;
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let s = 0; s < idx.length; s++) {
      const i = idx[s];
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < centers.length; k++) {
        const c = centers[k];
        const d = (L[i] - c.L) ** 2 + (A[i] - c.a) ** 2 + (B[i] - c.b) ** 2;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      if (assign[s] !== best) changed += 1;
      assign[s] = best;
      const t = sums[best];
      t[0] += L[i];
      t[1] += A[i];
      t[2] += B[i];
      t[3] += 1;
    }
    centers.forEach((c, k) => {
      if (sums[k][3]) {
        c.L = sums[k][0] / sums[k][3];
        c.a = sums[k][1] / sums[k][3];
        c.b = sums[k][2] / sums[k][3];
      }
    });
    if (!changed) break;
  }

  let clusters = centers.map(() => ({ L: 0, a: 0, b: 0, r: 0, g: 0, bl: 0, n: 0 }));
  for (let s = 0; s < idx.length; s++) {
    const i = idx[s];
    const c = clusters[assign[s]];
    c.L += L[i];
    c.a += A[i];
    c.b += B[i];
    c.r += rgb[i * 3];
    c.g += rgb[i * 3 + 1];
    c.bl += rgb[i * 3 + 2];
    c.n += 1;
  }
  clusters = clusters.filter((c) => c.n > 0);
  const mergeInto = (target, source) => {
    for (const key of ['L', 'a', 'b', 'r', 'g', 'bl', 'n']) target[key] += source[key];
  };
  const mean = (c) => [c.L / c.n, c.a / c.n, c.b / c.n];
  // Merge the closest pair while it is closer than the merge distance.
  for (;;) {
    let bi = -1;
    let bj = -1;
    let bd = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = deltaE(mean(clusters[i]), mean(clusters[j]));
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || bd >= cfg.paletteMergeDeltaE) break;
    mergeInto(clusters[bi], clusters[bj]);
    clusters.splice(bj, 1);
  }
  // Fold slivers (edge blends, specular glints) into their nearest cluster.
  for (;;) {
    const total = clusters.reduce((s, c) => s + c.n, 0);
    let smallest = -1;
    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].n / total < cfg.paletteMinWeight && (smallest < 0 || clusters[i].n < clusters[smallest].n)) smallest = i;
    }
    if (smallest < 0 || clusters.length === 1) break;
    const lab = mean(clusters[smallest]);
    let nearest = -1;
    let nd = Infinity;
    for (let j = 0; j < clusters.length; j++) {
      if (j === smallest) continue;
      const d = deltaE(lab, mean(clusters[j]));
      if (d < nd) {
        nd = d;
        nearest = j;
      }
    }
    mergeInto(clusters[nearest], clusters[smallest]);
    clusters.splice(smallest, 1);
  }

  const total = clusters.reduce((s, c) => s + c.n, 0);
  const includeMetals = category === 'watch';
  const out = clusters
    .map((c) => {
      const lab = mean(c).map((v) => Math.round(v * 10) / 10);
      return {
        lab,
        hex: rgbToHex(c.r / c.n, c.g / c.n, c.bl / c.n),
        weight: c.n / total,
        name: nearestColorName(lab, { includeMetals }).name,
      };
    })
    .sort((p, q) => q.weight - p.weight || p.lab[0] - q.lab[0]);
  // Round weights but keep the sum at exactly 1.
  let acc = 0;
  out.forEach((c, i) => {
    c.weight = i === out.length - 1 ? Math.round((1 - acc) * 1000) / 1000 : Math.round(c.weight * 1000) / 1000;
    acc += c.weight;
  });
  return out;
}

// ---------- Layout ----------

/**
 * Principal-axis angle of the mask, reduced to the nearest image axis. Small tilts are undone
 * so a slightly rotated photo and an upright catalog render share a frame; near-round objects
 * and large angles are left alone.
 */
function uprightAngle(mask, w, h, cfg) {
  let m = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      m += 1;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
  }
  if (!m) return { angle: 0, cx: w / 2, cy: h / 2 };
  const cx = sx / m;
  const cy = sy / m;
  const mu20 = sxx / m - cx * cx;
  const mu02 = syy / m - cy * cy;
  const mu11 = sxy / m - cx * cy;
  const common = Math.sqrt(((mu20 - mu02) / 2) ** 2 + mu11 * mu11);
  const l1 = (mu20 + mu02) / 2 + common;
  const l2 = Math.max(1e-6, (mu20 + mu02) / 2 - common);
  const elongation = Math.sqrt(l1 / l2);
  let angle = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
  while (angle > Math.PI / 4) angle -= Math.PI / 2;
  while (angle < -Math.PI / 4) angle += Math.PI / 2;
  if (elongation < cfg.minElongation || Math.abs(angle) > (cfg.maxDeskewDeg * Math.PI) / 180) angle = 0;
  return { angle, cx, cy };
}

function layout(img, mask, gridShape, cfg) {
  const { w, h, L, A, B } = img;
  const { angle, cx, cy } = uprightAngle(mask, w, h, cfg);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const u = (x - cx) * cos + (y - cy) * sin;
      const v = -(x - cx) * sin + (y - cy) * cos;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  if (maxX < 0) return null;
  const spanU = maxU - minU + 1;
  const spanV = maxV - minV + 1;
  const { cols, rows } = gridShape;
  const sums = new Float64Array(cols * rows * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const u = (x - cx) * cos + (y - cy) * sin;
      const v = -(x - cx) * sin + (y - cy) * cos;
      const c = Math.min(cols - 1, Math.floor(((u - minU + 0.5) / spanU) * cols));
      const r = Math.min(rows - 1, Math.floor(((v - minV + 0.5) / spanV) * rows));
      const k = (r * cols + c) * 4;
      sums[k] += L[i];
      sums[k + 1] += A[i];
      sums[k + 2] += B[i];
      sums[k + 3] += 1;
    }
  }
  const cellArea = (spanU / cols) * (spanV / rows);
  const cells = [];
  for (let k = 0; k < cols * rows; k++) {
    const count = sums[k * 4 + 3];
    if (count < Math.max(2, cfg.cellMinFill * cellArea)) cells.push(null);
    else cells.push([sums[k * 4] / count, sums[k * 4 + 1] / count, sums[k * 4 + 2] / count].map((v) => Math.round(v * 10) / 10));
  }
  return {
    bbox: { x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h },
    aspect: spanU / spanV,
    angle,
    grid: { cols, rows, cells },
  };
}

function stats(img, mask, grad, cfg) {
  const { n, L, A, B } = img;
  let count = 0;
  let sumL = 0;
  let sumC = 0;
  let edges = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    count += 1;
    sumL += L[i];
    sumC += Math.hypot(A[i], B[i]);
    if (grad[i] > cfg.edgeThreshold) edges += 1;
  }
  if (!count) return { brightness: 0, colorfulness: 0, edgeDensity: 0 };
  const round = (v) => Math.round(v * 1000) / 1000;
  return {
    brightness: round(sumL / count / 100),
    colorfulness: round(Math.min(1, sumC / count / 100)),
    edgeDensity: round(edges / count),
  };
}

// ---------- Public API ----------

/**
 * Full analysis with the intermediate results the debug page draws.
 * @param {{ width: number, height: number, data: Uint8ClampedArray|Uint8Array }} imageData RGBA
 * @param {{ category?: string|null, config?: Partial<typeof FEATURE_CONFIG> }} [opts]
 * @returns {{ features: any, mask: Uint8Array, width: number, height: number, mode: string,
 *   angle: number, background: any }}
 */
export function analyzeImage(imageData, opts = {}) {
  const cfg = { ...FEATURE_CONFIG, ...(opts.config ?? {}), shadow: { ...FEATURE_CONFIG.shadow, ...(opts.config?.shadow ?? {}) } };
  const category = opts.category ?? null;
  const gridShape = GRID_SHAPES[category] ?? GRID_SHAPES.default;
  const img = prepare(imageData);
  const { w, h, n } = img;
  let { mask, area, mode, model, grad } = img.n >= 64 ? segment(img, cfg) : { mask: new Uint8Array(n), area: 0, mode: 'too_small', model: null, grad: new Float32Array(n) };

  // No separable item: describe the whole frame and report fgRatio 0 so matching abstains.
  let found = area >= cfg.minObjectShare * n;
  if (!found) {
    mask = new Uint8Array(n).fill(1);
    mode = mode === 'too_small' ? mode : 'no_object';
  }
  const geometry = layout(img, mask, gridShape, cfg);
  // Palette from the interior so anti-aliased edges don't add blended colors.
  const inner = found ? morph(mask, w, h, 1, false) : mask;
  let innerCount = 0;
  for (let i = 0; i < n; i++) innerCount += inner[i];
  const colors = palette(img, innerCount >= 50 ? inner : mask, innerCount >= 50 ? innerCount : found ? area : n, cfg, category);

  const features = {
    v: FEATURES_VERSION,
    category,
    width: w,
    height: h,
    fgRatio: found ? Math.round((area / n) * 10000) / 10000 : 0,
    bbox: found ? roundBox(geometry.bbox) : { x: 0, y: 0, w: 1, h: 1 },
    aspect: Math.round(geometry.aspect * 1000) / 1000,
    palette: colors,
    grid: geometry.grid,
    stats: stats(img, mask, grad, cfg),
  };
  return { features, mask: found ? mask : new Uint8Array(n), width: w, height: h, mode, angle: geometry.angle, background: model };
}

function roundBox(b) {
  const r = (v) => Math.round(v * 10000) / 10000;
  return { x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) };
}

/**
 * Features (ARCHITECTURE.md 6.1) for an RGBA image.
 * @param {{ width: number, height: number, data: Uint8ClampedArray|Uint8Array }} imageData
 * @param {{ category?: string|null }} [opts]
 */
export function extractFeatures(imageData, opts = {}) {
  return analyzeImage(imageData, opts).features;
}

// ---------- Distances used by the matcher ----------

/**
 * Lab difference with lightness down-weighted (lighting changes L far more than hue).
 * @param {number[]} p
 * @param {number[]} q
 * @param {{ lightness?: number, shift?: number[] }} [opts] shift is added to `p` first
 */
export function labDistance(p, q, opts = {}) {
  const wl = opts.lightness ?? 1;
  const s = opts.shift ?? [0, 0, 0];
  return Math.sqrt((wl * (p[0] + s[0] - q[0])) ** 2 + (p[1] + s[1] - q[1]) ** 2 + (p[2] + s[2] - q[2]) ** 2);
}

/**
 * Earth mover's distance between two palettes (weights sum to 1), solved greedily over the
 * cheapest pairs, which is exact enough for six colors a side. Also returns the weighted mean
 * color displacement, which the matcher uses to compensate for a global lighting shift.
 * @param {Array<{ lab: number[], weight: number }>} p photo palette
 * @param {Array<{ lab: number[], weight: number }>} q reference palette
 * @param {{ lightness?: number, shift?: number[], cap?: number }} [opts]
 * @returns {{ cost: number, shift: number[] }}
 */
export function paletteTransport(p, q, opts = {}) {
  if (!p?.length || !q?.length) return { cost: opts.cap ?? 45, shift: [0, 0, 0] };
  const cap = opts.cap ?? 45;
  const s = opts.shift ?? [0, 0, 0];
  const pairMax = opts.shiftPairMax ?? Infinity;
  const pairs = [];
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) pairs.push([labDistance(p[i].lab, q[j].lab, opts), i, j]);
  }
  pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const left = p.map((c) => c.weight);
  const right = q.map((c) => c.weight);
  const sumP = left.reduce((a, b) => a + b, 0) || 1;
  const sumQ = right.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < left.length; i++) left[i] /= sumP;
  for (let j = 0; j < right.length; j++) right[j] /= sumQ;
  let cost = 0;
  let shiftFlow = 0;
  const shift = [0, 0, 0];
  for (const [d, i, j] of pairs) {
    const flow = Math.min(left[i], right[j]);
    if (flow <= 0) continue;
    left[i] -= flow;
    right[j] -= flow;
    cost += flow * Math.min(cap, d);
    // Only pairs that plausibly show the same surface say anything about the lighting.
    if (d < pairMax) {
      shiftFlow += flow;
      for (let k = 0; k < 3; k++) shift[k] += flow * (q[j].lab[k] - p[i].lab[k] - s[k]);
    }
  }
  const usable = shiftFlow >= 0.3;
  return { cost, shift: usable ? shift.map((v) => v / shiftFlow) : [0, 0, 0] };
}

/** Palette distance only (see paletteTransport). */
export function paletteDistance(p, q, opts = {}) {
  return paletteTransport(p, q, opts).cost;
}

/** Grid mirrored left to right (a sneaker photographed toe-left vs toe-right). */
export function mirrorGrid(grid) {
  const cells = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = grid.cols - 1; c >= 0; c--) cells.push(grid.cells[r * grid.cols + c]);
  }
  return { cols: grid.cols, rows: grid.rows, cells };
}

/**
 * Resamples a grid to another shape by area-weighted averaging; empty cells stay empty when
 * most of their area is empty. Used when a photo was analyzed without a category.
 */
export function resampleGrid(grid, cols, rows) {
  if (grid.cols === cols && grid.rows === rows) return grid;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = (c / cols) * grid.cols;
      const x1 = ((c + 1) / cols) * grid.cols;
      const y0 = (r / rows) * grid.rows;
      const y1 = ((r + 1) / rows) * grid.rows;
      let wSum = 0;
      let filled = 0;
      const acc = [0, 0, 0];
      for (let gy = Math.floor(y0); gy < Math.ceil(y1); gy++) {
        for (let gx = Math.floor(x0); gx < Math.ceil(x1); gx++) {
          const ow = Math.max(0, Math.min(x1, gx + 1) - Math.max(x0, gx)) * Math.max(0, Math.min(y1, gy + 1) - Math.max(y0, gy));
          if (ow <= 0) continue;
          wSum += ow;
          const cell = grid.cells[gy * grid.cols + gx];
          if (!cell) continue;
          filled += ow;
          for (let k = 0; k < 3; k++) acc[k] += cell[k] * ow;
        }
      }
      cells.push(filled > 0 && filled >= wSum / 2 ? acc.map((v) => v / filled) : null);
    }
  }
  return { cols, rows, cells };
}

/**
 * Mean cell difference between two grids of the same shape. A cell filled on one side and
 * empty on the other (different silhouette) costs `missing`. With `mirror`, the better of the
 * direct and mirrored comparison is used.
 * @returns {{ distance: number, mirrored: boolean }}
 */
export function gridDistance(g1, g2, opts = {}) {
  if (!g1 || !g2) return { distance: opts.missing ?? 22, mirrored: false };
  const b = g1.cols === g2.cols && g1.rows === g2.rows ? g2 : resampleGrid(g2, g1.cols, g1.rows);
  const missing = opts.missing ?? 22;
  const cap = opts.cap ?? 45;
  const score = (a) => {
    let sum = 0;
    let count = 0;
    for (let k = 0; k < a.cells.length; k++) {
      const x = a.cells[k];
      const y = b.cells[k];
      if (!x && !y) continue;
      count += 1;
      sum += x && y ? Math.min(cap, labDistance(x, y, opts)) : missing;
    }
    return count ? sum / count : missing;
  };
  const direct = score(g1);
  if (!opts.mirror) return { distance: direct, mirrored: false };
  const flipped = score(mirrorGrid(g1));
  return flipped < direct ? { distance: flipped, mirrored: true } : { distance: direct, mirrored: false };
}
