// Browser providers: everything runs on the device. Swap these for cloud adapters in a real
// backend without changing the operations that call them.
import { imagingProvider } from './imaging.browser.js';
import { visionProvider } from './vision.browser.js';
import { ocrProvider } from './ocr.browser.js';
import { referenceProvider } from './reference.browser.js';
import { offersProvider } from './offers.js';
import { conversionsProvider } from './conversions.js';
import { marketplacesProvider } from './marketplaces.js';

export function createBrowserProviders() {
  return {
    imaging: imagingProvider,
    vision: visionProvider,
    ocr: ocrProvider,
    reference: referenceProvider,
    offers: offersProvider,
    conversions: conversionsProvider,
    marketplaces: marketplacesProvider,
    urls: {
      objectUrl(blob) {
        return URL.createObjectURL(blob);
      },
      revoke(url) {
        URL.revokeObjectURL(url);
      },
    },
  };
}
