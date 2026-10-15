// Conversion reporting provider. No affiliate network is connected in the prototype, so the
// honest answer is "not connected". Demo conversion events can be loaded by an admin and are
// labeled as demo wherever they appear.

export const conversionsProvider = {
  name: 'none',
  async report() {
    return { connected: false, network: null, events: [] };
  },
};
