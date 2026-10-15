// Synthetic scenes for Node tests: product-like shapes drawn from an illustration spec, either
// as a clean studio reference render or as a photo-like scene (textured backdrop, offset, tilt,
// mirror, uneven light, color cast and noise). Pixels are RGBA ImageData-like objects, so the
// real feature extractor (js/engine/features.js) runs on them without a DOM.
import { referenceBackdrop } from '../../js/engine/features.js';
import { hexToRgb } from '../../js/data/colors.js';

/* A tiny rasterizer: product-like shapes in a 400 x 400 design space. */

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function image(w, h, bg) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = typeof bg === 'function' ? bg(x, y) : hexToRgb(bg);
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

export function inPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function draw(img, shapes, { s, tx, ty, mirror = false, angle = 0 }) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const u0 = (x - tx) / s;
      const v0 = (y - ty) / s;
      let u = u0 * cos + v0 * sin + 200;
      const v = -u0 * sin + v0 * cos + 200;
      if (mirror) u = 400 - u;
      let fill = null;
      for (const sh of shapes) {
        const hit = sh.poly ? inPoly(u, v, sh.poly) : sh.circle ? (u - sh.circle[0]) ** 2 + (v - sh.circle[1]) ** 2 <= sh.circle[2] ** 2 : u >= sh.rect[0] && u < sh.rect[2] && v >= sh.rect[1] && v < sh.rect[3];
        if (hit) fill = sh.fill;
      }
      if (fill) {
        const c = hexToRgb(fill);
        const i = (y * img.width + x) * 4;
        img.data[i] = c[0];
        img.data[i + 1] = c[1];
        img.data[i + 2] = c[2];
      }
    }
  }
}

export function shapesFor(spec) {
  const p = spec.palette ?? {};
  if (spec.kind === 'watch') {
    return [
      { rect: [165, 30, 235, 370], fill: p.strap ?? '#777777' },
      { circle: [200, 200, 92], fill: p.case ?? '#bbbbbb' },
      { circle: [200, 200, 76], fill: p.dial ?? '#222222' },
      { rect: [196, 140, 204, 200], fill: p.hands ?? '#ffffff' },
      { poly: [[200, 196], [242, 212], [238, 220], [198, 204]], fill: p.hands ?? '#ffffff' },
      { rect: [196, 128, 204, 140], fill: p.indices ?? '#ffffff' },
      { rect: [196, 262, 204, 274], fill: p.indices ?? '#ffffff' },
      { rect: [130, 196, 142, 204], fill: p.indices ?? '#ffffff' },
      { rect: [258, 196, 270, 204], fill: p.indices ?? '#ffffff' },
    ];
  }
  if (spec.kind === 'clothing') {
    if (['chinos', 'trousers', 'jeans', 'shorts'].includes(spec.shape)) {
      return [
        { poly: [[130, 40], [270, 40], [290, 360], [215, 360], [200, 120], [185, 360], [110, 360]], fill: p.main ?? '#888888' },
        { rect: [130, 40, 270, 56], fill: p.secondary ?? p.main ?? '#777777' },
      ];
    }
    return [
      { poly: [[140, 60], [260, 60], [340, 120], [310, 170], [280, 150], [280, 340], [120, 340], [120, 150], [90, 170], [60, 120]], fill: p.main ?? '#888888' },
      { poly: [[160, 60], [240, 60], [200, 95]], fill: p.secondary ?? '#666666' },
      { rect: [140, 200, 185, 240], fill: p.trim ?? p.main ?? '#777777' },
      { rect: [215, 200, 260, 240], fill: p.trim ?? p.main ?? '#777777' },
    ];
  }
  return [
    { poly: [[60, 250], [80, 170], [150, 150], [200, 120], [250, 130], [300, 190], [350, 210], [370, 235], [360, 255]], fill: p.upper ?? '#cccccc' },
    { poly: [[150, 200], [250, 160], [262, 172], [160, 215]], fill: p.accent ?? p.overlay ?? '#bbbbbb' },
    { poly: [[205, 135], [245, 140], [250, 150], [210, 147]], fill: p.laces ?? '#eeeeee' },
    { poly: [[50, 255], [365, 255], [372, 275], [350, 282], [60, 282], [45, 275]], fill: p.sole ?? '#eeeeee' },
  ];
}

/** A reference render: the spec on its contrasting studio tone, centered, upright. */
export function studio(spec) {
  const img = image(256, 256, referenceBackdrop(Object.values(spec.palette ?? {})));
  draw(img, shapesFor(spec), { s: 256 / 400, tx: 128, ty: 128 });
  return img;
}

/** A photo-like scene: textured backdrop, offset, tilt, mirror, uneven light, color cast, noise. */
export function photo(spec, seed, opts = {}) {
  const r = rng(seed);
  const w = 256;
  const h = 192;
  const base = opts.bg ?? [[196, 160, 120], [180, 182, 178], [92, 84, 78]][Math.floor(r() * 3)];
  const img = image(w, h, (x, y) => {
    const grain = Math.sin((y + Math.sin(x * 0.05) * 6) * 0.35) * 6;
    return [base[0] + grain, base[1] + grain, base[2] + grain];
  });
  const s = (h / 400) * (0.85 + r() * 0.2);
  draw(img, shapesFor(spec), { s, tx: w / 2 + (r() - 0.5) * 30, ty: h / 2 + (r() - 0.5) * 18, mirror: r() < 0.5, angle: (r() - 0.5) * 0.2 });
  const gain = 0.92 + r() * 0.16;
  const warm = (r() - 0.5) * 0.12;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const light = gain * (1 - 0.12 * (x / w - 0.5)) * (1 - 0.15 * ((x / w - 0.5) ** 2 + (y / h - 0.5) ** 2));
      const n = () => (r() + r() + r() - 1.5) * 4;
      img.data[i] = img.data[i] * light * (1 + warm) + n();
      img.data[i + 1] = img.data[i + 1] * light + n();
      img.data[i + 2] = img.data[i + 2] * light * (1 - warm) + n();
    }
  }
  return img;
}
