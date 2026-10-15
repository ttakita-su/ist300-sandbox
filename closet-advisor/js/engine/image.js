// Browser image helpers: decoding with the photo's orientation applied, cropping and rotating,
// re-encoding (drawing to a canvas and encoding again drops EXIF, GPS and every other metadata
// block), and background clean-up. Browser only: uses createImageBitmap and canvas.
import { ApiError } from '../server/errors.js';
import { analyzeImage, ANALYSIS_SIZE, STUDIO_HEX } from './features.js';
import { hexToRgb } from '../data/colors.js';

export const HEIC_UNSUPPORTED = "This browser can't read HEIC photos. On iPhone, photos convert automatically; on a computer, export a JPEG.";
const UNREADABLE = "This photo couldn't be opened. It may be damaged or in a format this browser can't read. Choose another photo.";

/** Smallest short edge, in pixels, that still shows enough of an item to analyze. */
export const MIN_EDGE = 200;
export const ORIGINAL_EDGE = 2048;
export const PROCESSING_EDGE = 768;

/** A 2D canvas of the given size (OffscreenCanvas where available). */
export function makeCanvas(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function context(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Encodes a canvas. JPEG by default; quality 0..1. */
export async function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ApiError('unavailable', "This photo couldn't be saved. Try again."))), type, quality);
  });
}

/** Pixel size of a decoded image, bitmap or canvas. */
export function sizeOf(source) {
  return {
    width: source.naturalWidth || source.videoWidth || source.width,
    height: source.naturalHeight || source.videoHeight || source.height,
  };
}

async function decodeWithElement(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Decodes a photo with its EXIF orientation applied. HEIC decodes where the browser supports it
 * (Safari); elsewhere it is refused with a message that says what to do.
 * @param {Blob} blob
 * @param {{ mime?: string }} [opts] the sniffed type, used to explain HEIC failures
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
export async function decodeImage(blob, { mime } = {}) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // Some browsers decode a format in <img> but not in createImageBitmap; try that next.
    }
  }
  try {
    return await decodeWithElement(blob);
  } catch {
    const type = mime ?? blob.type ?? '';
    if (/hei[cf]/i.test(type)) throw new ApiError('unsupported', HEIC_UNSUPPORTED);
    throw new ApiError('invalid', UNREADABLE);
  }
}

/** Releases a decoded bitmap (no-op for elements and canvases). */
export function release(source) {
  if (source && typeof source.close === 'function') source.close();
}

/**
 * Draws `source` scaled so its long edge is at most `maxEdge` (never upscaled). Transparent
 * pixels land on the studio backdrop, which is also what feature extraction assumes.
 * @returns {OffscreenCanvas|HTMLCanvasElement}
 */
export function drawScaled(source, maxEdge = Infinity, { background = STUDIO_HEX } = {}) {
  const { width, height } = sizeOf(source);
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = makeCanvas(width * scale, height * scale);
  const ctx = context(canvas);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Applies a normalized crop ({ x, y, w, h } in 0..1 of the photo) and a rotation in 90-degree
 * steps, scaled so the result's long edge is at most `maxEdge`.
 * @param {ImageBitmap|HTMLImageElement|OffscreenCanvas|HTMLCanvasElement} source
 * @param {{ x: number, y: number, w: number, h: number, rotate?: number } | null} crop
 * @param {{ maxEdge?: number }} [opts]
 */
export function cropAndRotate(source, crop, { maxEdge = Infinity } = {}) {
  const { width, height } = sizeOf(source);
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1, rotate: 0 };
  const sx = Math.max(0, Math.round(c.x * width));
  const sy = Math.max(0, Math.round(c.y * height));
  const sw = Math.max(1, Math.min(width - sx, Math.round(c.w * width)));
  const sh = Math.max(1, Math.min(height - sy, Math.round(c.h * height)));
  const rotate = (((c.rotate ?? 0) % 360) + 360) % 360;
  const quarter = rotate === 90 || rotate === 270;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const canvas = makeCanvas(quarter ? dh : dw, quarter ? dw : dh);
  const ctx = context(canvas);
  ctx.fillStyle = STUDIO_HEX;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(source, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  return canvas;
}

/** RGBA pixels of a canvas or image, scaled to at most `maxEdge`. */
export function toImageData(source, { maxEdge = Infinity } = {}) {
  const { width, height } = sizeOf(source);
  const fits = typeof source.getContext === 'function' && Math.max(width, height) <= maxEdge;
  const canvas = fits ? source : drawScaled(source, maxEdge);
  return context(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Re-encodes an image as a new JPEG at most `maxEdge` on its long side. Only pixels are copied,
 * so EXIF, GPS and maker notes are gone from the result.
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function reencode(source, { maxEdge = ORIGINAL_EDGE, type = 'image/jpeg', quality = 0.9 } = {}) {
  const canvas = drawScaled(source, maxEdge);
  const blob = await canvasToBlob(canvas, type, quality);
  return { blob, width: canvas.width, height: canvas.height };
}

/** Upscales a 0/1 mask to (w, h) with bilinear filtering, then softens it into an alpha ramp. */
function alphaFromMask(mask, mw, mh, w, h) {
  const alpha = new Float32Array(w * h);
  const at = (x, y) => mask[Math.min(mh - 1, Math.max(0, y)) * mw + Math.min(mw - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    const fy = ((y + 0.5) / h) * mh - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = ((x + 0.5) / w) * mw - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      // A short ramp keeps the cut-out edge soft without a halo of the old backdrop.
      const v = top * (1 - ty) + bottom * ty;
      alpha[y * w + x] = Math.min(1, Math.max(0, (v - 0.25) / 0.5));
    }
  }
  return alpha;
}

/**
 * Places the item from a photo on the neutral studio backdrop. Only the backdrop changes: the
 * item's own pixels are copied as they are, so no detail is invented. The result is cropped to
 * the item with some space around it.
 * @param {Blob} blob
 * @param {{ maxEdge?: number }} [opts]
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function removeBackground(blob, { maxEdge = 1200 } = {}) {
  const image = await decodeImage(blob);
  try {
    const work = drawScaled(image, maxEdge);
    const small = toImageData(work, { maxEdge: ANALYSIS_SIZE });
    const analysis = analyzeImage(small, {});
    if (!analysis.features.fgRatio) {
      throw new ApiError('unavailable', "The item couldn't be separated from the background, so your photo was kept as it is. A plain surface with space around the item works best.");
    }
    const { bbox } = analysis.features;
    const pad = 0.08;
    const x0 = Math.max(0, bbox.x - pad * bbox.w);
    const y0 = Math.max(0, bbox.y - pad * bbox.h);
    const x1 = Math.min(1, bbox.x + bbox.w * (1 + pad));
    const y1 = Math.min(1, bbox.y + bbox.h * (1 + pad));

    const W = work.width;
    const H = work.height;
    const pixels = context(work).getImageData(0, 0, W, H);
    const alpha = alphaFromMask(analysis.mask, analysis.width, analysis.height, W, H);
    const [br, bg, bb] = hexToRgb(STUDIO_HEX);
    const d = pixels.data;
    for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
      const a = alpha[i];
      d[p] = d[p] * a + br * (1 - a);
      d[p + 1] = d[p + 1] * a + bg * (1 - a);
      d[p + 2] = d[p + 2] * a + bb * (1 - a);
      d[p + 3] = 255;
    }
    const sx = Math.round(x0 * W);
    const sy = Math.round(y0 * H);
    const out = makeCanvas(Math.round((x1 - x0) * W), Math.round((y1 - y0) * H));
    context(out).putImageData(pixels, -sx, -sy);
    const encoded = await canvasToBlob(out, 'image/jpeg', 0.9);
    return { blob: encoded, width: out.width, height: out.height };
  } finally {
    release(image);
  }
}
