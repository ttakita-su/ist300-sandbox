// Marketplace search adapters. StockX and GOAT report "not connected" because Rotation has no
// approved access (docs/marketplaces.md); the demo adapter searches the fictional catalog so the
// search screen can be exercised. A real adapter would run on a server, keep its credentials
// there, and return results only as its agreement allows (including image-display terms).
import { MARKETPLACES } from '../marketplaces.js';
import { searchProducts } from '../ops/catalog.js';

function notConnected(marketplace) {
  return {
    async search() {
      // Where a server-side adapter would call an approved API or affiliate feed. Never scrape.
      return { connected: false, results: [], reason: marketplace.accessNote };
    },
  };
}

const ADAPTERS = {
  stockx: notConnected(MARKETPLACES.stockx),
  goat: notConnected(MARKETPLACES.goat),
  demo: {
    async search(query, { catalog, limit = 8 }) {
      return { connected: true, results: searchProducts(catalog, { q: query, limit }), reason: null };
    },
  },
};

export const MARKETPLACE_SOURCES = [
  { id: 'demo', name: 'Demo marketplace', demo: true },
  { id: 'stockx', name: MARKETPLACES.stockx.name, demo: false },
  { id: 'goat', name: MARKETPLACES.goat.name, demo: false },
];

export const marketplacesProvider = {
  name: 'marketplaces',
  /** Sources with their connection state. */
  list() {
    return MARKETPLACE_SOURCES.map((s) => ({ ...s, connected: s.id === 'demo' }));
  },
  /**
   * @param {'demo'|'stockx'|'goat'} id
   * @param {string} query
   * @param {{ catalog: any, limit?: number }} env
   * @returns {Promise<{ connected: boolean, results: any[], reason: string|null }>}
   */
  async search(id, query, env) {
    const adapter = ADAPTERS[id];
    if (!adapter) return { connected: false, results: [], reason: 'Unknown marketplace.' };
    return adapter.search(query, env);
  },
};
