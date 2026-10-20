// Twisted Takes: static checks on the built site (_site/).
//
//   bundle exec jekyll build
//   node tools/check-site.mjs
//
// No installs needed (plain Node 18+). It reads `url` and `baseurl` from
// _config.yml, or from a config override passed as an argument:
//   node tools/check-site.mjs --baseurl "" --url "https://example.github.io"
//
// Checks: every internal link, image, script and stylesheet resolves inside
// _site under the base path; each page has one <h1>, a <title>, a meta
// description and a canonical URL on the configured address; no "#" links;
// every <img> has alt text (empty alt is allowed for decorative images); no
// duplicate ids; the GA4 tag appears at most once per page; search.json is
// valid; every review is reachable and each genre's count is reported.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = join(root, '_site');
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };

const config = readFileSync(join(root, '_config.yml'), 'utf8');
const configValue = (key) => { const m = config.match(new RegExp(`^${key}:\\s*"?([^"\\n#]*)"?`, 'm')); return m ? m[1].trim() : ''; };
const baseurl = (arg('--baseurl') ?? configValue('baseurl')).replace(/\/$/, '');
const url = (arg('--url') ?? configValue('url')).replace(/\/$/, '');
const expectGa = args.includes('--expect-analytics');

if (!existsSync(siteDir)) {
  console.error('No _site/ folder. Run `bundle exec jekyll build` first.');
  process.exit(1);
}

const problems = [];
const warn = (file, msg) => problems.push(`${file}: ${msg}`);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(siteDir);
const htmlFiles = files.filter((f) => f.endsWith('.html'));

function resolveTarget(path) {
  // path is the URL path with the base path already removed
  const clean = decodeURIComponent(path.split('#')[0].split('?')[0]);
  const candidates = clean.endsWith('/')
    ? [join(siteDir, clean, 'index.html')]
    : [join(siteDir, clean), join(siteDir, clean, 'index.html'), join(siteDir, clean + '.html')];
  return candidates.some((c) => existsSync(c) && statSync(c).isFile());
}

let linkCount = 0;
for (const file of htmlFiles) {
  const rel = file.slice(siteDir.length);
  const html = readFileSync(file, 'utf8');
  const isNotFound = rel === '/404.html';

  // Internal references
  const refs = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  for (const ref of refs) {
    if (!ref || /^(https?:|mailto:|tel:|data:)/.test(ref)) {
      if (ref.startsWith(url + '/') && baseurl && !ref.startsWith(url + baseurl + '/')) warn(rel, `absolute link misses the base path: ${ref}`);
      continue;
    }
    if (ref === '#') { warn(rel, 'dead "#" link'); continue; }
    if (ref.startsWith('#')) {
      const id = ref.slice(1);
      if (!html.includes(`id="${id}"`)) warn(rel, `in-page link to missing id: ${ref}`);
      continue;
    }
    if (!ref.startsWith('/')) { warn(rel, `relative link (breaks on 404 and nested pages): ${ref}`); continue; }
    linkCount++;
    if (baseurl && !(ref === baseurl || ref.startsWith(baseurl + '/'))) { warn(rel, `link missing base path ${baseurl}: ${ref}`); continue; }
    const path = ref.slice(baseurl.length) || '/';
    if (!resolveTarget(path)) warn(rel, `broken internal link: ${ref}`);
  }

  // Page structure
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) warn(rel, `expected exactly one <h1>, found ${h1s}`);
  if (!/<html lang="[^"]+"/.test(html)) warn(rel, 'missing <html lang>');
  if (!/<title>[^<]+<\/title>/.test(html)) warn(rel, 'missing <title>');
  if (!/<meta name="description" content="[^"]+"/.test(html)) warn(rel, 'missing meta description');
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
  if (isNotFound) {
    if (canonical) warn(rel, '404 page should not have a canonical URL');
  } else if (!canonical) {
    warn(rel, 'missing canonical URL');
  } else if (!canonical[1].startsWith(url + baseurl + '/')) {
    warn(rel, `canonical URL not on ${url + baseurl}/: ${canonical[1]}`);
  }
  if (!html.includes('class="skip-link"')) warn(rel, 'missing skip link');

  for (const img of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt="/.test(img[0])) warn(rel, `<img> without alt: ${img[0].slice(0, 80)}`);
  }

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) warn(rel, `duplicate ids: ${[...new Set(dupes)].join(', ')}`);

  const gaTags = (html.match(/googletagmanager\.com\/gtag\/js/g) || []).length;
  if (gaTags > 1) warn(rel, `GA4 tag loaded ${gaTags} times`);
  if (expectGa && gaTags !== 1) warn(rel, 'GA4 tag expected once but not found');
  if (!expectGa && gaTags) warn(rel, 'GA4 tag present although no Measurement ID is expected');
}

// Search index and catalog
let index = [];
try {
  index = JSON.parse(readFileSync(join(siteDir, 'search.json'), 'utf8'));
} catch (err) {
  warn('/search.json', `invalid JSON: ${err.message}`);
}
const reviews = index.filter((d) => d.kind === 'review');
const byGenre = {};
for (const r of reviews) {
  byGenre[r.genre] = (byGenre[r.genre] || 0) + 1;
  if (baseurl && !r.url.startsWith(baseurl + '/')) warn('/search.json', `URL without base path: ${r.url}`);
  if (!resolveTarget(r.url.slice(baseurl.length))) warn('/search.json', `review page missing: ${r.url}`);
}
const titles = reviews.map((r) => r.title);
const dupeTitles = titles.filter((t, i) => titles.indexOf(t) !== i);
if (dupeTitles.length) warn('/search.json', `duplicate review titles: ${dupeTitles.join(', ')}`);

for (const required of ['/sitemap.xml', '/robots.txt', '/feed.xml', '/404.html']) {
  if (!existsSync(join(siteDir, required))) warn(required, 'missing');
}

console.log(`Checked ${htmlFiles.length} pages and ${linkCount} internal links (base path "${baseurl}", url "${url}").`);
console.log(`Reviews: ${reviews.length} (${Object.entries(byGenre).map(([g, n]) => `${g} ${n}`).join(', ')})`);
console.log(`Articles: ${index.filter((d) => d.kind === 'article').length}, Watch Next collections: ${index.filter((d) => d.kind === 'collection').length}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}
console.log('No problems found.');
