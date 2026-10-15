// On-device label reading. Tesseract.js is the prototype's only runtime dependency: it is
// downloaded from jsDelivr the first time someone asks to read a label, then runs in this
// browser (its worker, engine and English data also come from jsDelivr). Nothing is uploaded.
// Barcodes are read with the browser's BarcodeDetector where it exists. Browser only.
import { ApiError } from '../server/errors.js';
import { decodeImage, drawScaled, release } from './image.js';

export const TESSERACT_VERSION = '7.0.0';
const TESSERACT_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.esm.min.js`;
const LOAD_TIMEOUT_MS = 45000;
const READ_TIMEOUT_MS = 20000;
const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

const UNAVAILABLE = "Label reading needs a connection the first time it's used. Type the code instead.";
const SLOW = 'Reading the label took too long. Type the code instead.';

let workerPromise = null;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ApiError('unavailable', message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Loads Tesseract and starts one English worker, shared by every later read. */
function getWorker() {
  workerPromise ??= withTimeout(
    (async () => {
      const mod = await import(/* webpackIgnore: true */ TESSERACT_URL);
      const Tesseract = mod.default ?? mod;
      return Tesseract.createWorker('eng', 1);
    })(),
    LOAD_TIMEOUT_MS,
    UNAVAILABLE,
  ).catch((error) => {
    // A failed download is retried on the next read rather than cached as broken.
    workerPromise = null;
    throw error instanceof ApiError ? error : new ApiError('unavailable', UNAVAILABLE);
  });
  return workerPromise;
}

/** True once the OCR engine has been downloaded in this session. */
export function ocrLoaded() {
  return workerPromise != null;
}

async function readBarcodes(source) {
  if (typeof globalThis.BarcodeDetector !== 'function') return [];
  try {
    const supported = (await globalThis.BarcodeDetector.getSupportedFormats?.()) ?? BARCODE_FORMATS;
    const formats = BARCODE_FORMATS.filter((f) => supported.includes(f));
    if (!formats.length) return [];
    const found = await new globalThis.BarcodeDetector({ formats }).detect(source);
    return [...new Set(found.map((b) => String(b.rawValue ?? '').replace(/\D/g, '')).filter((d) => d.length >= 8))];
  } catch {
    return [];
  }
}

/**
 * Reads printed text (and barcodes, where the browser can) from a label photo.
 * Throws ApiError('unavailable') when the engine can't be loaded or the read takes too long;
 * callers then ask the person to type the code.
 * @param {Blob} blob
 * @returns {Promise<{ text: string, confidence: number, barcodes: string[] }>}
 */
export async function readText(blob) {
  const image = await decodeImage(blob);
  try {
    // Labels are small print: give Tesseract a large, flattened copy.
    const canvas = drawScaled(image, 2000, { background: '#ffffff' });
    const barcodes = await readBarcodes(canvas);
    const worker = await getWorker();
    const { data } = await withTimeout(worker.recognize(canvas), READ_TIMEOUT_MS, SLOW);
    const confidence = Number.isFinite(data?.confidence) ? Math.round(data.confidence) / 100 : null;
    return { text: String(data?.text ?? '').trim(), confidence, barcodes };
  } finally {
    release(image);
  }
}
