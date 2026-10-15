// On-device photo analysis: the processing copy is cropped and rotated as the person chose,
// then measured by js/engine/features.js. Nothing leaves the browser.
import { cropAndRotate, decodeImage, release, PROCESSING_EDGE } from '../../engine/image.js';
import { extractFeatures } from '../../engine/features.js';

export const visionProvider = {
  /**
   * @param {{ blob: Blob, crop: { x, y, w, h, rotate } | null, category: string | null }} args
   * @returns {Promise<any>} Features (ARCHITECTURE.md 6.1)
   */
  async analyze({ blob, crop, category }) {
    const image = await decodeImage(blob);
    try {
      const canvas = cropAndRotate(image, crop, { maxEdge: PROCESSING_EDGE });
      const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
      return extractFeatures(pixels, { category });
    } finally {
      release(image);
    }
  },
};
