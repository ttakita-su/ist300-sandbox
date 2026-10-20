// Twisted Takes: generate 1200×630 social preview images (Open Graph cards).
//
// Optional. The site builds and publishes without this; it only refreshes the
// PNGs in assets/images/social/ after you add a review or article or change a
// title or cover. See EDITOR_GUIDE.md, "Social preview images".
//
//   cd tools
//   npm install
//   npx playwright install chromium
//   npm run social-cards            # every review, post and Watch Next page
//   npm run social-cards -- arrival # only files whose name contains "arrival"
//
// A card is written only for documents whose `social_image` points into
// /assets/images/social/. Set `social_image: null` to use the site default.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, '..');
const require = createRequire(process.env.PLAYWRIGHT_FROM || join(here, 'package.json'));
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: cd tools && npm install && npx playwright install chromium');
  process.exit(1);
}

const filter = process.argv[2] || '';

// Front matter reader for the simple `key: "value"` lines this site uses.
function frontMatter(file) {
  const text = readFileSync(file, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  const data = {};
  if (!match) return data;
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*?)\s*(#.*)?$/);
    if (!m) continue;
    let value = m[2];
    if (value === 'null' || value === '') { data[m[1]] = null; continue; }
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
    data[m[1]] = value;
  }
  return data;
}

function genres() {
  const text = readFileSync(join(site, '_data/genres.yml'), 'utf8');
  const out = {};
  let key = null;
  for (const line of text.split('\n')) {
    let m = line.match(/^- key:\s*"?([a-z-]+)"?/);
    if (m) { key = m[1]; out[key] = {}; continue; }
    m = line.match(/^\s+(name|accent):\s*(?:"([^"]*)"|([^\s#][^#]*?))\s*(?:#.*)?$/);
    if (m && key) out[key][m[1]] = m[2] ?? m[3];
  }
  return out;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Local images are inlined as data URIs (pages made with setContent cannot
// load file:// URLs). Remote https:// images are used as they are.
const MIME = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
function imageSrc(p) {
  if (/^https?:\/\//.test(p)) return p;
  const file = join(site, p.replace(/^\//, ''));
  if (!existsSync(file)) return '';
  const ext = file.split('.').pop().toLowerCase();
  return `data:${MIME[ext] || 'application/octet-stream'};base64,${readFileSync(file).toString('base64')}`;
}

function cardHtml({ image, portrait, kicker, title, subtitle, accent }) {
  const media = image
    ? `<div class="media ${portrait ? 'portrait' : 'wide'}"><img src="${imageSrc(image)}"></div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    body { width: 1200px; height: 630px; background: #FAF9F6; font-family: Georgia, 'Times New Roman', serif; color: #202124; display: flex; overflow: hidden; }
    .media { height: 630px; flex: 0 0 auto; background: #EDEAE4; }
    .media.portrait { width: 504px; }
    .media.wide { width: 600px; }
    .media img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .text { flex: 1; padding: 64px 64px 56px; display: flex; flex-direction: column; border-top: 10px solid #7A2944; }
    .brand { font-size: 34px; }
    .brand i { color: #7A2944; display: inline-block; transform: rotate(-3deg); }
    .brand b { font-weight: bold; }
    .kicker { margin-top: auto; font: 700 20px/1.2 -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; letter-spacing: 3px; text-transform: uppercase; color: ${accent}; }
    .title { margin-top: 18px; font-size: ${title.length > 60 ? 42 : title.length > 38 ? 50 : 60}px; line-height: 1.1; }
    .subtitle { margin-top: 18px; font-size: 26px; color: #5F6368; font-style: italic; }
    .rule { margin-top: 28px; height: 4px; width: 72px; background: ${accent}; }
  </style></head><body>${media}<div class="text">
    <div class="brand"><i>Twisted</i> <b>Takes</b></div>
    <div class="kicker">${esc(kicker)}</div>
    <div class="title">${esc(title)}</div>
    ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ''}
    <div class="rule"></div>
  </div></body></html>`;
}

const jobs = [];
const genreInfo = genres();

for (const [dir, kind] of [['_reviews', 'review'], ['_posts', 'post'], ['_watch_next', 'collection']]) {
  const full = join(site, dir);
  if (!existsSync(full)) continue;
  for (const name of readdirSync(full).filter((f) => f.endsWith('.md'))) {
    if (filter && !name.includes(filter)) continue;
    const fm = frontMatter(join(full, name));
    if (!fm.social_image || !fm.social_image.startsWith('/assets/images/social/')) continue;
    if (kind === 'review') {
      const g = genreInfo[fm.primary_genre] || {};
      jobs.push({ out: fm.social_image, html: cardHtml({
        image: fm.image, portrait: true, accent: g.accent || '#7A2944',
        kicker: `${g.name || fm.primary_genre} · ${fm.media_type === 'tv' ? 'TV' : 'Movie'} review`,
        title: fm.headline || fm.title, subtitle: `${fm.title} (${fm.year})`,
      }) });
    } else {
      jobs.push({ out: fm.social_image, html: cardHtml({
        image: fm.image, portrait: false, accent: '#7A2944',
        kicker: fm.kicker || (kind === 'collection' ? 'Watch Next' : 'Article'), title: fm.title,
      }) });
    }
  }
}

if (!filter || 'default'.includes(filter)) {
  jobs.push({ out: '/assets/images/social/default.png', html: cardHtml({
    image: '/assets/images/editorial/welcome.svg', portrait: false, accent: '#7A2944',
    kicker: 'Movie and TV reviews', title: 'Strong opinions. Better watchlists.',
  }) });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const job of jobs) {
  const out = join(site, job.out.replace(/^\//, ''));
  mkdirSync(dirname(out), { recursive: true });
  await page.setContent(job.html, { waitUntil: 'load' });
  await page.screenshot({ path: out, type: 'png' });
  console.log('wrote', job.out);
}

// Apple touch icon from the favicon.
if (!filter) {
  const icon = join(site, 'assets/images/apple-touch-icon.png');
  await page.setViewportSize({ width: 180, height: 180 });
  await page.setContent(`<html><body style="margin:0;background:#7A2944"> <img src="${imageSrc('/assets/images/favicon.svg')}" style="width:180px;height:180px;display:block"></body></html>`, { waitUntil: 'load' });
  await page.screenshot({ path: icon });
  console.log('wrote /assets/images/apple-touch-icon.png');
}
await browser.close();
