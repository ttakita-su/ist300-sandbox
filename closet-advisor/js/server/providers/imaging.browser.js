// On-device photo normalization and clean-up (js/engine/image.js). Re-encoding drops EXIF and
// GPS; the original is capped at 2048 px and a 768 px processing copy is made for analysis.
import { ApiError } from '../errors.js';
import { decodeImage, reencode, release, removeBackground, sizeOf, MIN_EDGE, ORIGINAL_EDGE, PROCESSING_EDGE } from '../../engine/image.js';
import { leadingBytes, sniffImageType } from '../validate-image.js';

export const imagingProvider = {
  /**
   * @param {Blob} blob an upload that already passed validate-image.js
   * @returns {Promise<{ original: Blob, processing: Blob, width, height, mime, processingWidth, processingHeight }>}
   */
  async normalize(blob) {
    const mime = sniffImageType(await leadingBytes(blob)) ?? blob.type;
    const image = await decodeImage(blob, { mime });
    try {
      const { width, height } = sizeOf(image);
      if (Math.min(width, height) < MIN_EDGE) {
        throw new ApiError('invalid', `This photo is too small to analyze. Use one at least ${MIN_EDGE} pixels on each side.`);
      }
      const original = await reencode(image, { maxEdge: ORIGINAL_EDGE, quality: 0.9 });
      const processing = await reencode(image, { maxEdge: PROCESSING_EDGE, quality: 0.92 });
      return {
        original: original.blob,
        processing: processing.blob,
        width: original.width,
        height: original.height,
        mime: 'image/jpeg',
        processingWidth: processing.width,
        processingHeight: processing.height,
      };
    } finally {
      release(image);
    }
  },

  /** @returns {Promise<{ blob: Blob, width: number, height: number }>} the item on the studio backdrop */
  async cleanup(blob) {
    return removeBackground(blob);
  },
};
