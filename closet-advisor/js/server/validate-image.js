// Upload validation by file signature. The type a browser or file picker declares (blob.type)
// is never trusted: a renamed PDF or script must not reach the image pipeline.
import { ApiError } from './errors.js';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

// ISO-BMFF brands. HEIC files usually carry 'heic' as the major brand; generic HEIF containers
// carry 'mif1'/'msf1'/'heif' and list HEVC brands as compatible ones.
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc']);
const HEIF_BRANDS = new Set(['mif1', 'msf1', 'heif']);
// AVIF shares the HEIF container (and the mif1 brand); it is not an accepted format.
const AVIF_BRANDS = new Set(['avif', 'avis']);

const SNIFF_BYTES = 64;

function ascii(bytes, start, end) {
  let out = '';
  for (let i = start; i < end && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function startsWith(bytes, signature, offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

function heifType(bytes) {
  if (bytes.length < 12 || ascii(bytes, 4, 8) !== 'ftyp') return null;
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const end = Math.min(bytes.length, boxSize >= 16 ? boxSize : bytes.length);
  const major = ascii(bytes, 8, 12);
  const compatible = [];
  for (let i = 16; i + 4 <= end; i += 4) compatible.push(ascii(bytes, i, i + 4));
  if (HEIC_BRANDS.has(major)) return 'image/heic';
  if (AVIF_BRANDS.has(major) || compatible.some((b) => AVIF_BRANDS.has(b))) return null;
  if (HEIF_BRANDS.has(major)) return compatible.some((b) => HEIC_BRANDS.has(b)) ? 'image/heic' : 'image/heif';
  return null;
}

/**
 * Identifies an image from its first bytes.
 * @param {Uint8Array} bytes at least the first 32 bytes of the file
 * @returns {'image/jpeg'|'image/png'|'image/webp'|'image/heic'|'image/heif'|'image/gif'|null}
 */
export function sniffImageType(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 3) return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  return heifType(bytes);
}

/**
 * Like sniffImageType, and also names AVIF, which store images often use.
 * @param {Uint8Array} bytes
 * @returns {'image/jpeg'|'image/png'|'image/webp'|'image/heic'|'image/heif'|'image/gif'|'image/avif'|null}
 */
export function sniffStoreImageType(bytes) {
  const type = sniffImageType(bytes);
  if (type || !(bytes instanceof Uint8Array) || bytes.length < 12 || ascii(bytes, 4, 8) !== 'ftyp') return type;
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const end = Math.min(bytes.length, boxSize >= 16 ? boxSize : bytes.length);
  const brands = [ascii(bytes, 8, 12)];
  for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(bytes, i, i + 4));
  return brands.some((b) => AVIF_BRANDS.has(b)) ? 'image/avif' : null;
}

/** What a store image may be when it arrives; it is re-encoded as JPEG before it is kept. */
export const STORE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

function isBlob(value) {
  return Boolean(value) && typeof value.size === 'number' && typeof value.slice === 'function' && typeof value.arrayBuffer === 'function';
}

/** Reads the leading bytes of a Blob for sniffing. */
export async function leadingBytes(blob, count = SNIFF_BYTES) {
  return new Uint8Array(await blob.slice(0, count).arrayBuffer());
}

/**
 * Checks an upload before any decoding happens. Throws ApiError with a message the person can
 * act on; returns the sniffed type.
 * @param {Blob} blob
 * @returns {Promise<{ mime: string }>}
 */
export async function validateUploadBlob(blob) {
  if (!isBlob(blob)) throw new ApiError('invalid', 'Choose a photo to upload.');
  if (blob.size === 0) throw new ApiError('invalid', 'This file is empty. Choose another photo or retake it.');
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new ApiError('invalid', 'This photo is larger than 15 MB. Choose a smaller one or retake it.', { maxBytes: MAX_UPLOAD_BYTES });
  }
  const mime = sniffImageType(await leadingBytes(blob));
  // GIFs are sniffed so they can be named in support logs, but they are not product photos.
  if (!mime || mime === 'image/gif') {
    throw new ApiError('unsupported', 'Use a JPEG, PNG, WebP or HEIC photo.', { accepted: ACCEPTED_TYPES });
  }
  return { mime };
}

/**
 * Checks a store image downloaded by the local server before it is decoded. Same size limits as
 * uploads; AVIF and GIF are allowed because the image is re-encoded before it is kept.
 * @param {Blob} blob
 * @returns {Promise<{ mime: string }>}
 */
export async function validateStoreImageBlob(blob) {
  if (!isBlob(blob) || blob.size === 0) throw new ApiError('invalid', "The store's image is empty. Save the item without it.");
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new ApiError('invalid', "The store's image is larger than 15 MB, so it wasn't saved. Save the item without it.", { maxBytes: MAX_UPLOAD_BYTES });
  }
  const mime = sniffStoreImageType(await leadingBytes(blob));
  if (!mime || !STORE_IMAGE_TYPES.includes(mime)) {
    throw new ApiError('unsupported', "The store's image isn't a JPEG, PNG, WebP, GIF or AVIF file, so it wasn't saved. Save the item without it.", { accepted: STORE_IMAGE_TYPES });
  }
  return { mime };
}
