// The local server for live mode (`npm start`): it serves the app from an allowlist of its own
// files and answers /api (backend/routes.mjs), which looks up real product pages and searches Bing.
// It binds to 127.0.0.1 unless HOST says otherwise. GitHub Pages, `npm run serve` and any other
// static server keep working in demo mode: they serve api/status.json, which says { "live": false }.
//
// Usage: npm start [-- --port 8131] [-- --host 192.168.1.20]   (or PORT / HOST in the environment)
// Without a port, npm start uses 8130, or the first free port from 8131 to 8139 when 8130 is busy.
// A port that was asked for is used or nothing is: a busy one stops with a one-line message.
import http from 'node:http';
import os from 'node:os';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createUpstream } from './net.mjs';
import { createApiHandler } from './routes.mjs';

/** The port npm start uses when none is given. */
export const DEFAULT_PORT = 8130;
/** How many ports after DEFAULT_PORT npm start tries when it is busy (8131 to 8139). */
export const PORT_FALLBACKS = 9;

/**
 * The one-line message for a busy port, with the two ways to pick another one.
 * @param {number} port the first port tried
 * @param {number} [fallbacks] how many ports after it were tried too
 */
export function portBusyMessage(port, fallbacks = 0) {
  const last = port + fallbacks;
  const other = last < 8140 ? 8140 : last + 1;
  const what = fallbacks > 0 ? `Ports ${port} to ${last} are all in use.` : `Port ${port} is already in use.`;
  return `${what} Pick another port: PORT=${other} npm start, or npm start -- --port ${other}.`;
}

/** The closet-advisor folder. */
export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Same map as tests/serve.mjs.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// Only the app itself is served: never node_modules, tests, backend, supabase, docs or dotfiles.
const TOP_FILES = new Set(['index.html', 'manifest.webmanifest', 'sw.js']);
const TOP_DIRS = new Set(['css', 'js', 'fonts', 'icons', 'dev']);

/**
 * Maps a request path to a file inside the allowlist, or null. Rejects encoded slashes and
 * backslashes, dot segments, dotfiles and anything outside the allowed folders.
 * @param {string} pathname the URL's pathname, still percent-encoded
 * @returns {string | null} absolute file path
 */
export function staticFile(pathname) {
  if (pathname === '/') return join(ROOT, 'index.html');
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (/[\\\0]/.test(decoded) || /%2f|%5c/i.test(pathname)) return null;
  const segments = decoded.split('/').slice(1);
  if (!segments.length || segments.some((s) => !s || s.startsWith('.'))) return null;
  const allowed = segments.length === 1 ? TOP_FILES.has(segments[0]) : TOP_DIRS.has(segments[0]);
  if (!allowed) return null;
  const file = resolve(ROOT, ...segments);
  return file.startsWith(ROOT + sep) ? file : null;
}

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const entry of list ?? []) out.push(entry.address);
  return out;
}

const hostPort = (host, port) => (host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`).toLowerCase();

/** Host header values this server answers to: loopback names, plus the bound address on a LAN. */
export function allowedHostsFor(host, port) {
  const hosts = new Set([hostPort('127.0.0.1', port), hostPort('localhost', port)]);
  if (host === '0.0.0.0' || host === '::') for (const address of localAddresses()) hosts.add(hostPort(address, port));
  else if (host) hosts.add(hostPort(host, port));
  return hosts;
}

/**
 * Starts the app server.
 * @param {{ port?: number, host?: string, upstream?: ReturnType<typeof createUpstream>, portFallbacks?: number }} [options]
 *   upstream: the guarded upstream (tests and e2e pass tests/fixtures/web/upstream.mjs fixtureUpstream());
 *   portFallbacks: when `port` is busy, how many of the next ports to try in order (0: fail with
 *   EADDRINUSE at once)
 * @returns {Promise<{ server: http.Server, port: number, requestedPort: number, url: string, close: () => Promise<void> }>}
 *   port is the bound port; requestedPort the one asked for
 */
export async function startAppServer({ port = DEFAULT_PORT, host = '127.0.0.1', upstream, portFallbacks = 0 } = {}) {
  const rootReal = await realpath(ROOT);
  const allowedHosts = new Set();
  const handleApi = createApiHandler({ upstream: upstream ?? createUpstream(), allowedHosts });

  async function serveStatic(req, res, pathname) {
    const file = staticFile(pathname);
    const info = file ? await stat(file).catch(() => null) : null;
    // A symlink inside an allowed folder must not lead outside the app either.
    const real = info?.isFile() ? await realpath(file).catch(() => null) : null;
    if (!real || !real.startsWith(rootReal + sep)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not found');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', Allow: 'GET, HEAD' });
      res.end('Method not allowed');
      return;
    }
    const body = await readFile(real);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(real)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  const server = http.createServer(async (req, res) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }
    try {
      if (pathname === '/api' || pathname.startsWith('/api/')) await handleApi(req, res, pathname);
      else await serveStatic(req, res, pathname);
    } catch (error) {
      console.error('Rotation server error:', error?.stack ?? error);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end();
    }
  });
  server.requestTimeout = 60000;

  const listen = (candidate) =>
    new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(candidate, host, () => {
        server.off('error', rejectListen);
        resolveListen();
      });
    });
  // Node allows listen() again after a failed listen().
  for (let i = 0; ; i++) {
    try {
      await listen(port + i);
      break;
    } catch (error) {
      if (error?.code !== 'EADDRINUSE' || port === 0 || i >= portFallbacks || port + i >= 65535) throw error;
    }
  }
  const bound = server.address().port;
  for (const value of allowedHostsFor(host, bound)) allowedHosts.add(value);
  const shownHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
  return {
    server,
    port: bound,
    requestedPort: port,
    url: `http://${shownHost}:${bound}/`,
    close: () =>
      new Promise((resolveClose) => {
        server.close(() => resolveClose());
        server.closeAllConnections();
      }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { port: { type: 'string' }, host: { type: 'string' } }, strict: false });
  const given = values.port ?? (process.env.PORT || undefined);
  const port = given === undefined ? DEFAULT_PORT : Number(given);
  const host = String(values.host ?? process.env.HOST ?? '127.0.0.1');
  // Only the default port falls back to the next free one; a port that was asked for is kept.
  const portFallbacks = given === undefined ? PORT_FALLBACKS : 0;
  startAppServer({ port, host, portFallbacks })
    .then(({ url, port: bound }) => {
      if (bound !== port) {
        console.log(`Port ${port} is in use, so Rotation is using port ${bound} instead.`);
        // The browser keeps the collection per address, so a new port starts from the demo data.
        console.log(`Items saved at port ${port} stay there. To get back to them, stop what is using port ${port} and run npm start again.`);
      }
      console.log(`Rotation is running at ${url}`);
      console.log('Live web lookups are on: product links, Bing search and Bing photo search are fetched from this computer.');
    })
    .catch((error) => {
      if (error?.code === 'EADDRINUSE') console.error(portBusyMessage(port, portFallbacks));
      else console.error(`Rotation couldn't start: ${error?.message ?? error}`);
      process.exitCode = 1;
    });
}
