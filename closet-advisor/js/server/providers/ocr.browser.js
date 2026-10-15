// On-device label reading (js/engine/ocr.js). Tesseract.js loads from jsDelivr on first use;
// if it can't, read() throws ApiError('unavailable') and the person types the code instead.
import { readText } from '../../engine/ocr.js';

export const ocrProvider = {
  /** @returns {Promise<{ text: string, confidence: number|null, barcodes: string[] }>} */
  async read(blob) {
    return readText(blob);
  },
};
