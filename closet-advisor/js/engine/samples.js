// Sample photos, so the photo flow can be tried without the demo products in hand. Each sample is
// a catalog illustration (or an item the catalog doesn't have) staged like a phone photo: a
// textured surface, an off-center, slightly tilted item, uneven light, a color cast and sensor
// noise. Label samples print a version's real catalog identifier for the label-reading path.
// Screens must present these as samples, never as the person's own photos. Browser only.
import { renderSpecSvg, specFor } from '../data/illustrations.js';
import { staticCatalog } from '../server/catalog-repo.js';
import { seededRandom, hashString } from '../lib/ids.js';
import { makeCanvas, canvasToBlob } from './image.js';

/** Surfaces a sample can sit on: base color and texture. */
export const SURFACES = {
  oak: { rgb: [192, 156, 116], grain: 9, kind: 'wood' },
  concrete: { rgb: [178, 180, 176], grain: 5, kind: 'speckle' },
  slate: { rgb: [88, 82, 78], grain: 5, kind: 'speckle' },
  linen: { rgb: [226, 222, 212], grain: 4, kind: 'weave' },
};

// A sneaker the catalog doesn't have, so the flow can show that it abstains instead of guessing.
const OUT_OF_CATALOG = {
  kind: 'sneaker',
  shape: 'runner',
  details: { panels: 'stripes', heelTab: true },
  palette: { upper: '#c0322e', overlay: '#a82a26', sole: '#ecd04a', midsole: '#ecd04a', laces: '#ffffff', accent: '#2f5fa8', lining: '#8f241f' },
};

const SAMPLES = [
  { id: 'runner-navy', variantId: 'kestrel-runner-2--navy-white', surface: 'concrete', seed: 31, title: 'Navy runner', shows: 'A clear match: the photo alone finds the product and its colorway.' },
  { id: 'runner-olive', variantId: 'kestrel-runner-2--olive-bone', surface: 'oak', seed: 32, title: 'Olive runner', shows: 'Olive / Bone and Olive / Sail look almost the same, so the style code on the size tag decides.' },
  { id: 'court-white', variantId: 'vela-court-low--white-gum', surface: 'slate', seed: 33, title: 'White court sneaker', shows: 'Two colorways differ only in the sole color; a code or a closer look confirms which.' },
  { id: 'field-watch', variantId: 'arden-field--af40-sl-bk', surface: 'linen', seed: 34, title: 'Steel field watch', shows: 'The 38 and 40 mm versions look the same in a photo; only the reference tells them apart.' },
  { id: 'field-jacket', variantId: 'harbor-pine-deck-jacket--olive', surface: 'concrete', seed: 35, title: 'Olive field jacket', shows: 'Clothing is matched on color and silhouette; the size is never read from a photo.' },
  { id: 'wool-trouser', variantId: 'fieldhouse-wool-trouser--charcoal', surface: 'oak', seed: 36, title: 'Charcoal trousers', shows: 'A dark item on a warm surface.' },
  { id: 'chore-jacket', variantId: 'wrenfield-chore-jacket--navy', surface: 'linen', seed: 38, title: 'Navy chore jacket', shows: 'Two navy jackets from different brands look alike in a photo, so both are shown as similar products and the brand label or barcode settles it.' },
  { id: 'red-runner', variantId: null, spec: OUT_OF_CATALOG, category: 'sneaker', surface: 'linen', seed: 37, title: 'A sneaker that isn’t in the catalog', shows: 'Nothing in the catalog matches, so matching says so instead of guessing.' },
];

/**
 * Sample photos available for this catalog.
 * @param {any} [catalog]
 * @returns {Array<{ id, title, shows, category, variantId: string|null, inCatalog: boolean, sample: true }>}
 */
export function listSamples(catalog = staticCatalog()) {
  return SAMPLES.filter((s) => !s.variantId || catalog.variant(s.variantId)).map((s) => ({
    id: s.id,
    title: s.title,
    shows: s.shows,
    category: s.variantId ? catalog.productOf(s.variantId).category : s.category,
    variantId: s.variantId,
    inCatalog: Boolean(s.variantId),
    sample: true,
  }));
}

async function svgImage(svg) {
  const img = new Image();
  img.decoding = 'async';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}

function paintSurface(ctx, w, h, surface, random) {
  const [r, g, b] = surface.rgb;
  const image = ctx.createImageData(w, h);
  const d = image.data;
  const phase = random() * 10;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let t = 0;
      if (surface.kind === 'wood') t = Math.sin((y + Math.sin(x * 0.012 + phase) * 14) * 0.09) * surface.grain;
      else if (surface.kind === 'weave') t = ((x >> 1) + (y >> 1)) % 2 ? surface.grain * 0.5 : -surface.grain * 0.5;
      t += (random() - 0.5) * surface.grain;
      const i = (y * w + x) * 4;
      d[i] = r + t;
      d[i + 1] = g + t;
      d[i + 2] = b + t;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Renders an illustration spec staged like a phone photo.
 * @param {object} spec illustration spec (data/illustrations.js)
 * @param {{ seed?: number, surface?: keyof SURFACES, width?: number, height?: number,
 *   quality?: number }} [opts]
 * @returns {Promise<Blob>} JPEG
 */
export async function stagePhoto(spec, { seed = 1, surface = 'concrete', width = 1600, height = 1200, quality = 0.86 } = {}) {
  const random = seededRandom(seed);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  paintSurface(ctx, width, height, SURFACES[surface] ?? SURFACES.concrete, random);

  // The item: off-center, slightly tilted, sometimes facing the other way, and whole in the
  // frame (a watch strap reaches almost the full height of its drawing).
  const img = await svgImage(renderSpecSvg(spec, { size: 800 }));
  const side = Math.min(width, height) * (0.74 + random() * 0.12);
  ctx.save();
  ctx.translate(width / 2 + (random() - 0.5) * width * 0.1, height / 2 + (random() - 0.5) * height * 0.08);
  ctx.rotate((random() - 0.5) * 0.16);
  if (random() < 0.5) ctx.scale(-1, 1);
  ctx.drawImage(img, -side / 2, -side / 2, side, side);
  ctx.restore();

  // Light falls off across the frame, with a warm or cool cast and a little sensor noise.
  const gain = 0.92 + random() * 0.14;
  const warm = (random() - 0.5) * 0.1;
  const tiltX = (random() - 0.5) * 0.24;
  const pixels = ctx.getImageData(0, 0, width, height);
  const d = pixels.data;
  for (let y = 0; y < height; y++) {
    const ny = y / height - 0.5;
    for (let x = 0; x < width; x++) {
      const nx = x / width - 0.5;
      const light = gain * (1 - tiltX * nx) * (1 - 0.16 * (nx * nx + ny * ny));
      const n = (random() + random() - 1) * 5;
      const i = (y * width + x) * 4;
      d[i] = d[i] * light * (1 + warm) + n;
      d[i + 1] = d[i + 1] * light + n;
      d[i + 2] = d[i + 2] * light * (1 - warm) + n;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return canvasToBlob(canvas, 'image/jpeg', quality);
}

/**
 * One sample photo as a JPEG Blob. The same id always renders the same photo.
 * @param {string} id from listSamples()
 * @param {{ catalog?: any, seed?: number }} [opts]
 */
export async function renderSample(id, { catalog = staticCatalog(), seed } = {}) {
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) throw new Error(`Unknown sample ${id}`);
  let spec = sample.spec;
  if (sample.variantId) {
    const variant = catalog.variant(sample.variantId);
    if (!variant) throw new Error(`Sample ${id} refers to a version that is not in the catalog`);
    spec = specFor(catalog.product(variant.productId), variant);
  }
  return stagePhoto(spec, { seed: seed ?? sample.seed, surface: sample.surface });
}

const LABEL_FONT = '"Archivo", "Helvetica Neue", Arial, sans-serif';

/**
 * A label photo printed with a version's catalog identifier: a sneaker size tag, a watch case
 * back or a clothing care label. For trying label reading; the text comes from the catalog, so
 * it is exactly what an honest label for that version would say.
 * @param {{ variantId: string, catalog?: any, seed?: number }} opts
 * @returns {Promise<Blob>} JPEG
 */
export async function renderLabel({ variantId, catalog = staticCatalog(), seed } = {}) {
  const variant = catalog.variant(variantId);
  if (!variant) throw new Error(`Unknown version ${variantId}`);
  const product = catalog.product(variant.productId);
  const brand = catalog.brand(product.brandId);
  const ids = variant.identifiers ?? {};
  let lines;
  if (product.category === 'watch') lines = [brand.name.toUpperCase(), `REF. ${ids.reference ?? ''}`, 'STAINLESS STEEL', 'WATER RESISTANT'];
  else if (product.category === 'sneaker') lines = [brand.name.toUpperCase(), 'US 10   UK 9   EU 44', `STYLE ${ids.styleCode ?? ''}`, 'SAMPLE LABEL'];
  else lines = [brand.name.toUpperCase(), `STYLE ${ids.styleCode ?? ''}`, ...(ids.gtins?.length ? [ids.gtins[0]] : []), 'MACHINE WASH COLD'];

  const random = seededRandom(seed ?? hashString(variantId));
  const width = 1400;
  const height = 1000;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  paintSurface(ctx, width, height, SURFACES.concrete, random);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((random() - 0.5) * 0.06);
  const round = product.category === 'watch';
  ctx.fillStyle = round ? '#c8cbcf' : '#f6f4ee';
  ctx.beginPath();
  if (round) ctx.arc(0, 0, 440, 0, Math.PI * 2);
  else ctx.rect(-560, -360, 1120, 720);
  ctx.fill();
  ctx.fillStyle = round ? '#2a2c30' : '#1d1f26';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = 150;
  lines.forEach((line, i) => {
    ctx.font = `${i === 0 ? 700 : 600} ${i === 0 ? 92 : 80}px ${LABEL_FONT}`;
    ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * step);
  });
  ctx.restore();
  return canvasToBlob(canvas, 'image/jpeg', 0.92);
}
