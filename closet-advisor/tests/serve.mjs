// Zero-dependency static server for local development and the browser tests.
// Usage: node tests/serve.mjs [port]   (serves the closet-advisor folder)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
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

export function startServer(port = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      let file = join(ROOT, path);
      if (!file.startsWith(ROOT)) throw Object.assign(new Error('forbidden'), { status: 403 });
      const info = await stat(file).catch(() => null);
      if (info?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (error) {
      res.writeHead(error.status ?? 404, { 'Content-Type': 'text/plain' });
      res.end(error.status === 403 ? 'Forbidden' : 'Not found');
    }
  });
  return new Promise((resolveStart) => {
    server.listen(port, '127.0.0.1', () => resolveStart({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 8130);
  startServer(port).then(({ url }) => console.log(`Rotation prototype at ${url}`));
}
