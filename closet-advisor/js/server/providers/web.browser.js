// Real store lookups and photo search through the local Node server (backend/, `npm start`).
// Every request is a same-origin POST to ./api/*, so the browser never contacts a store or Bing
// itself. Without the server (GitHub Pages, python3 -m http.server, tests/serve.mjs) the committed
// ./api/status.json says { live: false } and every call returns 'not_connected' without another
// request. Expected failures come back as { status, reason } with a sentence to show; nothing
// here throws for them. Browser only: fetch, canvas.
import { canvasToBlob, cropAndRotate, decodeImage, release, PROCESSING_EDGE } from '../../engine/image.js';
import { leadingBytes, sniffImageType } from '../validate-image.js';
import { NOT_CONNECTED, NO_ANSWER } from './web.js';

const TIMEOUT_MS = { lookup: 25000, search: 25000, lens: 40000, image: 25000 };
const UNREADABLE = "The local server's answer couldn't be read. Restart npm start, then try again.";
const IMAGE_FAILED = "The store's image couldn't be downloaded. Save the item without it, or try again.";
const PHOTO_FAILED = "This photo couldn't be prepared for the search. Take or choose the photo again.";
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

const apiUrl = (path) => new URL(`api/${path}`, document.baseURI);

function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

let statusOnce = null;

async function readStatus() {
  try {
    const response = await fetch(apiUrl('status.json'), { cache: 'no-store', headers: { accept: 'application/json' } });
    if (!response.ok) return { live: false, reason: NOT_CONNECTED };
    const body = await response.json();
    return body?.live === true ? { live: true, reason: null } : { live: false, reason: NOT_CONNECTED };
  } catch {
    return { live: false, reason: NOT_CONNECTED };
  }
}

/** POSTs to the local server once status.json said it is there. */
async function send(path, body, { type, timeoutMs }) {
  const { live } = await webProvider.status();
  if (!live) return { failure: { status: 'not_connected', reason: NOT_CONNECTED } };
  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'content-type': type, 'x-rotation': '1' },
      body,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: timeoutSignal(timeoutMs),
    });
    return { response };
  } catch {
    // Network errors and timeouts alike: the server isn't answering.
    return { failure: { status: 'unavailable', reason: NO_ANSWER } };
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const reasonOf = (body, fallback) => (typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : fallback);

/** The server's JSON answer when its status is one this endpoint can give; otherwise 'unavailable'. */
async function answer(sent, statuses) {
  if (sent.failure) return sent.failure;
  const body = await readJson(sent.response);
  if (!body || typeof body !== 'object' || typeof body.status !== 'string') return { status: 'unavailable', reason: UNREADABLE };
  if (!statuses.includes(body.status)) return { status: 'unavailable', reason: reasonOf(body, UNREADABLE) };
  return { ...body, reason: reasonOf(body, null) };
}

const unit = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/**
 * The part of the photo to send: the person's crop ({ x, y, w, h } in 0..1, as the match job
 * keeps it) or the whole frame, plus the rotation in quarter turns. A crop that is too small or
 * unreadable sends the whole frame rather than a sliver.
 */
export function searchFrame(crop, rotate) {
  const turn = (((Math.round((Number(crop?.rotate ?? rotate) || 0) / 90) * 90) % 360) + 360) % 360;
  const x = unit(crop?.x, 0);
  const y = unit(crop?.y, 0);
  const w = Math.min(unit(crop?.w, 1), 1 - x);
  const h = Math.min(unit(crop?.h, 1), 1 - y);
  if (!(w >= 0.02 && h >= 0.02)) return { x: 0, y: 0, w: 1, h: 1, rotate: turn };
  return { x, y, w, h, rotate: turn };
}

/** The photo as a JPEG, cropped and turned as the person framed it (the processing copy is already JPEG). */
async function jpegFor(blob, crop, rotate) {
  const frame = searchFrame(crop, rotate);
  const whole = frame.x === 0 && frame.y === 0 && frame.w === 1 && frame.h === 1;
  const mime = sniffImageType(await leadingBytes(blob));
  if (whole && !frame.rotate && mime === 'image/jpeg') return blob;
  const image = await decodeImage(blob, { mime });
  try {
    const canvas = cropAndRotate(image, frame, { maxEdge: PROCESSING_EDGE });
    return await canvasToBlob(canvas, 'image/jpeg', 0.92);
  } finally {
    release(image);
  }
}

export const webProvider = {
  name: 'web',

  /** Reads ./api/status.json once per page load. @returns {Promise<{ live: boolean, reason: string|null }>} */
  status() {
    statusOnce ??= readStatus();
    return statusOnce;
  },

  /**
   * A store's product page. @param {{ url: string }} args
   * @returns {Promise<{ status: 'found'|'not_product'|'blocked'|'invalid_url'|'unavailable'|'not_connected', reason, page?, host?, code? }>}
   */
  async lookup({ url } = {}) {
    const sent = await send('lookup', JSON.stringify({ url }), { type: 'application/json', timeoutMs: TIMEOUT_MS.lookup });
    return answer(sent, ['found', 'not_product', 'blocked', 'invalid_url', 'unavailable']);
  },

  /**
   * Bing Shopping listings and web results for typed words. @param {{ query: string }} args
   * @returns {Promise<{ status: 'ok'|'blocked'|'unavailable'|'invalid'|'not_connected', reason, engine?, query?, shopping?, results? }>}
   */
  async search({ query } = {}) {
    const sent = await send('search', JSON.stringify({ query }), { type: 'application/json', timeoutMs: TIMEOUT_MS.search });
    return answer(sent, ['ok', 'blocked', 'unavailable', 'invalid']);
  },

  /**
   * Bing visual search for a photo. Only the image bytes are sent: the 768 px processing copy,
   * already re-encoded without EXIF or GPS, cut to the person's crop and rotated as they rotated
   * it (`crop.rotate` wins over `rotate`, which is kept for callers without a crop).
   * @param {{ blob: Blob, rotate?: number, crop?: { x: number, y: number, w: number, h: number, rotate?: number } | null }} args
   * @returns {Promise<{ status: 'ok'|'no_match'|'blocked'|'unavailable'|'invalid'|'not_connected', reason, engine?, query?, shopping?, results? }>}
   */
  async searchImage({ blob, rotate = 0, crop = null } = {}) {
    const { live } = await webProvider.status();
    if (!live) return { status: 'not_connected', reason: NOT_CONNECTED };
    let jpeg;
    try {
      jpeg = await jpegFor(blob, crop, rotate);
    } catch {
      return { status: 'invalid', reason: PHOTO_FAILED };
    }
    const sent = await send('lens', jpeg, { type: 'image/jpeg', timeoutMs: TIMEOUT_MS.lens });
    return answer(sent, ['ok', 'no_match', 'blocked', 'unavailable', 'invalid']);
  },

  /**
   * A store image downloaded by the local server (so the browser never hot-links it to keep it).
   * @param {{ url: string }} args
   * @returns {Promise<{ status: 'ok', blob: Blob, mime: string, finalUrl: string } | { status: string, reason: string }>}
   */
  async fetchImage({ url } = {}) {
    const sent = await send('image', JSON.stringify({ url }), { type: 'application/json', timeoutMs: TIMEOUT_MS.image });
    if (sent.failure) return sent.failure;
    const { response } = sent;
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (response.ok && IMAGE_TYPES.includes(mime)) {
      try {
        return { status: 'ok', blob: await response.blob(), mime, finalUrl: response.headers.get('x-final-url') || url };
      } catch {
        return { status: 'unavailable', reason: NO_ANSWER };
      }
    }
    const body = await readJson(response);
    if (body && typeof body.status === 'string' && body.status !== 'ok') return { status: body.status, reason: reasonOf(body, IMAGE_FAILED) };
    return { status: 'unavailable', reason: IMAGE_FAILED };
  },
};
