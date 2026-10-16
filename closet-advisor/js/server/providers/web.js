// Shared parts of the `web` provider (real store lookups through the local server, backend/).
// Node-safe: the browser adapter is web.browser.js; tests and pages without the server use
// notConnectedWeb, which answers every call with 'not_connected' and never touches the network.

/** Shown wherever a live lookup is asked for and the local server isn't there (GitHub Pages, tests). */
export const NOT_CONNECTED =
  'Real store search needs the local server. In the closet-advisor folder, run npm start and open the address it prints.';

/** The server said it was running, but a request then got no answer. */
export const NO_ANSWER = "The local server didn't answer. Check that npm start is still running, then try again.";

const notConnected = () => ({ status: 'not_connected', reason: NOT_CONNECTED });

/**
 * The provider when there is no local server.
 * @type {{ status(): Promise<{ live: boolean, reason: string|null }>, lookup(a: { url: string }): Promise<any>,
 *   search(a: { query: string }): Promise<any>, searchImage(a: { blob: Blob, rotate?: number, crop?: object|null }): Promise<any>,
 *   fetchImage(a: { url: string }): Promise<any> }}
 */
export const notConnectedWeb = Object.freeze({
  name: 'web',
  async status() {
    return { live: false, reason: NOT_CONNECTED };
  },
  async lookup() {
    return notConnected();
  },
  async search() {
    return notConnected();
  },
  async searchImage() {
    return notConnected();
  },
  async fetchImage() {
    return notConnected();
  },
});
