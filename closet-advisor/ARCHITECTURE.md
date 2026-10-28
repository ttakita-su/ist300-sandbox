# Rotation prototype architecture

Rotation (working name) is the prototype of the AI closet and shopping advisor brief. This
document is the contract every module is written against, and it describes what is built, not
what was planned. Read **Conventions** and **Data model** first, then the section for the module
you are working on. Screen builders: section 5.4 lists every operation with its arguments and
result, and section 7.3 says what each screen calls and which states it must show. The local
server for real store lookups, and the network rules it must keep, are in section 2.1.

## 1. What the prototype is

A mobile-first web app with no build step, served as static files (GitHub Pages serves it at
`/closet-advisor/`), plus an optional local Node server (`npm start`, `backend/`) that serves
the same files and adds live product lookups (section 2.1). It runs the whole product journey
in the browser:

photo → candidate products → confirm item and variant → catalog image → collection →
similar/matching recommendations → retailer offer comparison → affiliate redirect.

What is real in the prototype:

- The photo pipeline runs on the device: validation by file signature, orientation, metadata
  stripping by re-encoding, cropping, background segmentation with shadow and seam handling,
  color and layout features, optional on-device OCR (Tesseract.js) and barcode reading, retrieval
  against reference renders of the catalog, reranking with conflict checks, and abstention when
  nothing matches.
- Retrieval statuses, identity resolution and variant resolution are stored separately, with the
  evidence behind each match and who confirmed it.
- Recommendations are retrieved from catalog data and ranked by transparent, configurable
  weights. Hard constraints apply before ranking. Explanations are built only from computed
  relations to named items.
- Offers are grouped by variant, size and condition. Unknown shipping, fees and tax stay unknown.
- Affiliate clicks, conversions and purchases are separate records.
- Access rules (the equivalent of Postgres row-level security) are pure functions with tests.
- A synthetic evaluation (`npm run eval`, `docs/evaluation.md`) measures the matching pipeline.
- **Live mode** (only with `npm start`): real product lookups. A pasted store link is read for
  its structured product data, typed words search Bing Shopping and Bing web results, and a photo
  the person chooses to send goes to Bing visual search. What comes back is a draft the person
  confirms and saves as a custom item with a `WebSnapshot` (4.3); it never becomes a catalog
  identity, an offer or a recommendation. Without the server (GitHub Pages,
  `python3 -m http.server`, `npm run serve`, the tests) every live call answers `not_connected`
  with a sentence saying how to start it.

What is demo:

- The catalog, brands, retailers, offers and prices are **fictional** and labeled as demo
  everywhere they appear. Demo retailer domains use the reserved `.example` TLD, so no catalog
  or offer link leads to a real store. GTINs use the GS1 restricted-circulation prefix 2, so
  they can never collide with a real product. Only live mode touches real stores, and only for
  the person's own lookups.
- The "server" is a module layer running in the same browser tab, storing data in IndexedDB.
  It mirrors the boundary a Next.js + Supabase build would have (see `docs/PLAN.md`,
  `docs/providers.md` and `supabase/README.md`), but it is not a security boundary: anyone can
  open devtools. The local Node server is not that server either: it holds no accounts or
  items, only fetches on request and keeps nothing (2.1).
- Catalog images are SVG illustrations generated from each variant's palette, so the prototype
  owns every image it displays.
- Sample photos (`js/engine/samples.js`) are catalog illustrations staged like phone photos, so
  the photo flow can be tried without the fictional products. Screens must label them as samples.

## 2. Layout

```
closet-advisor/
  README.md               how to run it, live features, privacy, troubleshooting (for people)
  index.html              app shell; loads css/*.css and js/app.js as a module
  manifest.webmanifest    PWA manifest
  sw.js                   service worker (app shell, stale-while-revalidate past the HTTP cache;
                          never cross-origin requests or ./api/)
  api/status.json         { "live": false }: what every static host serves; the local server
                          answers this path itself with { "live": true, ... }
  backend/                the local server (Node 24, zero dependencies; section 2.1)
    server.mjs            startAppServer(): static allowlist + /api; `npm start` runs it
    routes.mjs            /api handlers and request checks (POST, X-Rotation, Host, Origin)
    net.mjs               createUpstream(): the guarded outbound fetcher (SSRF checks, honest
                          User-Agent, per-host spacing, cache, block detection and cooldown)
    extract.mjs           extractProduct(html, url): structured product data from a store page
    bing.mjs              createBing(): Bing web search, Shopping and visual search parsers
  css/
    tokens.css            color, type, spacing tokens; light/dark themes
    base.css              element defaults, layout primitives, focus, motion
    components.css        shared component classes (see section 7)
    screens/*.css         account, add, collection, discover, workspace (one block per screen)
  fonts/                  Archivo variable (OFL), latin + latin-ext
  icons/                  app icons
  js/
    app.js                bootstrap: open db, seed, session restore, router, chrome
    client.js             browser singleton: db + api + current session token
    lib/                  html.js, router.js, ui.js, format.js, icons.js, ids.js
    ui/                   components.js (shared views), item-forms.js, catalog-picker.js, hydrate.js,
                          web-product.js (store result lists, the web save form, "Seen at")
    data/                 schema.js, colors.js, catalog.js, retailers.js, illustrations.js,
                          catalog-index.js
    engine/               features, matcher, recommend, harmony, explain, parse-request, offers,
                          affiliate, conversions, duplicates, provenance, web-guess (pure);
                          image, samples, ocr, reference, eval (browser)
    server/               errors.js, db.js, auth.js, policy.js, records.js, views.js, api.js,
                          catalog-repo.js, seed.js, urlsafety.js, validate-image.js,
                          marketplaces.js, ops/*.js, providers/*.js
    screens/              one file per screen group; index.js lists them (Phase 2)
  dev/                    gallery.html (every illustration), components.html (component sheet)
  tests/
    unit/*.test.mjs       `npm test` (node --test, no dependencies; backend-*.test.mjs cover backend/)
    fixtures/scenes.mjs   synthetic product scenes for Node feature and matching tests
    fixtures/web/         fixtureUpstream(): made-up store pages, images and Bing answers
                          (hosts under .fixture.alt) so backend and e2e tests never use the network
    e2e/*.mjs             Playwright (devDependency) against tests/serve.mjs, and web.mjs against
                          backend/server.mjs with the fixture upstream
    helpers.mjs, serve.mjs
  supabase/               production schema, RLS policies and storage (not run by the prototype)
  docs/                   PLAN, providers, affiliate, recommendations, marketplaces, evaluation
```

Rules:

- Every path is relative (`./js/app.js`, never `/js/app.js`). The site is served from a
  sub-folder.
- Browser-only code (DOM, canvas, IndexedDB, Tesseract) lives in `js/engine/image.js`,
  `js/engine/samples.js`, `js/engine/ocr.js`, `js/engine/reference.js`, `js/engine/eval.js`,
  `js/server/providers/*.browser.js`, `js/lib/*`, `js/ui/*`, `js/screens/*`, `js/app.js` and
  `js/client.js`. Everything else imports cleanly in Node 24 (`node --test`) with no DOM.
  (`js/lib/format.js`, `html.js` and `ids.js` happen to work in Node and engines use them.)
- `backend/` is Node only and never imported by the browser. It may import
  `js/server/urlsafety.js` and `js/server/validate-image.js` (both dependency-free); nothing in
  `js/` imports `backend/`. The browser reaches it only through same-origin `./api/*` requests
  in `js/server/providers/web.browser.js`.
- No runtime dependencies except Tesseract.js 7.0.0, which `js/engine/ocr.js` loads lazily from
  jsDelivr (worker, engine and English data too) only when a label photo is read. Everything
  works without it. The backend uses only Node's standard library.
- The browser itself contacts no store or search engine, with one exception: thumbnails in
  web result lists and the web save form's preview are hot-linked from the store's or Bing's
  image host (`loading="lazy"`, `referrerpolicy="no-referrer"`, through `safeUrl()`). Saved
  items show the copy kept on the device (photo kind `'web'`).

### 2.1 Live mode: the local server (`backend/`)

`npm start` runs `backend/server.mjs`. It uses port 8130, or the next free port up to 8139,
and prints the address (`--port` / `PORT` choose another). It binds to `127.0.0.1`; `HOST` or
`--host` (for example `0.0.0.0` for a phone on the same Wi-Fi) binds elsewhere, and the bound
interface addresses are then added to the allowed `Host` values. It reads no other
environment variable and no `.env` file. `startAppServer({ port, host, upstream })` returns
`{ server, port, url, close() }`; tests pass `port: 0` and `upstream: fixtureUpstream()`.

**Static files.** Only `/`, `index.html`, `manifest.webmanifest`, `sw.js` and the folders `css/`,
`js/`, `fonts/`, `icons/` and `dev/` are served; everything else (`backend/`, `tests/`, `docs/`,
`supabase/`, `node_modules/`, dotfiles, `.env*`) is 404. Encoded slashes, dot segments and
symlinks leading outside the folder are refused. Every response is `Cache-Control: no-store`.

**How the browser knows.** `providers.web.status()` reads `./api/status.json` once per page
load. The committed file says `{ "live": false }`; the local server answers that path with
`{ "live": true, "version": 1, "engines": { "lookup": "page", "search": "bing", "photo": "bing" } }`.
Starting the server after the page loaded needs a reload.

**HTTP API.** Every `/api/*` request except `GET /api/status.json` must be a `POST` with
`X-Rotation: 1`, a `Host` this server answers to (`127.0.0.1:<port>`, `localhost:<port>`, plus
the bound address), no `Origin` or `http://<Host>`, and not `Sec-Fetch-Site: cross-site`;
otherwise `403 { status: 'forbidden', reason }`. `OPTIONS` gets 405 and there are no CORS
headers anywhere, so another site's page can neither send the custom header nor read an
answer, and DNS rebinding fails the `Host` check. JSON bodies are at most 16 KB, photos 6 MB.
Every `reason` is a full sentence that can be shown. Expected outcomes are HTTP 200 with a
`status`; request errors are 400, 403, 404, 405, 413 or 415.

| Route | Body | Result |
| --- | --- | --- |
| `GET /api/status.json` | none | `{ live: true, version: 1, engines }` |
| `POST /api/lookup` | `{ url }` | `{ status: 'found', page: Page }` \| `{ status: 'not_product', host, reason, page: Page \| null }` (fetched, not a single product; a 404 or 410 page is `not_product` with `page: null`) \| `{ status: 'blocked', host, reason }` \| `{ status: 'invalid_url', code, reason }` \| `{ status: 'unavailable', host, reason }` (DNS, timeout, 5xx, too large, not HTML) |
| `POST /api/search` | `{ query }` (2 to 200 characters) | `{ status: 'ok', engine: 'bing', query, shopping: [Listing], results: [WebResult] }` \| `{ status: 'blocked' \| 'unavailable' \| 'invalid', reason }`; `ok` when either Bing page answered |
| `POST /api/lens` | raw JPEG, PNG or WebP (type sniffed from the bytes) | `{ status: 'ok', engine: 'bing', query /* what Bing recognized */, shopping, results }` \| `{ status: 'no_match', reason }` \| `blocked` \| `unavailable` \| `invalid` with `reason` |
| `POST /api/image` | `{ url }` | 200 with the image bytes (JPEG, PNG, WebP, GIF or AVIF, sniffed), `Content-Type` and `X-Final-Url`; or `{ status: 'invalid_url' \| 'blocked' \| 'unsupported' \| 'unavailable', reason }` with 400, 415, 502 or 504 |

```js
Page { url /* canonical on the same site, else final; tracking parameters removed */,
       requestedUrl, host /* no www. */, siteName, name, brand, description,
       images: [https url] /* best first, max 8 */, price: { amountMinor, currency } | null,
       availability: 'in_stock'|'out_of_stock'|'preorder'|'backorder'|'discontinued'|'limited'|null,
       condition: 'new'|'used'|'refurbished'|null, color, sku, gtin, mpn, sizes: [string],
       via: ['json-ld'|'microdata'|'meta'|'shopify'|'adapter'|'title'], fetchedAt }
Listing { id: 'shop_1', title, price: { amountMinor, currency } | null, priceText, seller,
          imageUrl, url /* Bing's product page */, source: 'bing_shopping' }   // max 24, free listings only
WebResult { id: 'web_1', title, url, host, snippet, productPage: boolean }  // max 10, no bing.com/msn.com
```

`extractProduct` takes each field from the first layer that has it: JSON-LD `Product` /
`ProductGroup` (the variant matched to the URL), site adapters (Amazon, GOAT `__NEXT_DATA__`,
Seiko), microdata, OpenGraph and `product:*` meta, then `<title>`, canonical link and host.
"Found" needs a product signal (structured data, `og:type` product, a price, or a name and image
on a product-looking URL), not just a title. On a Shopify store, one `/products/<handle>.js`
follow-up on the same host adds cent prices and variants. Money is integer minor units with the
currency's real digits; anything unknown is `null`. Bing details are in
`docs/providers.md` (Bing visual search, web search and Shopping).

**Network rules** (non-negotiable; `backend/net.mjs` enforces them for every outbound request):

- **Honest client.** User-Agent `Mozilla/5.0 (compatible; RotationLookup/0.1; educational
  prototype)`. No headless browser, no stealth or spoofed fingerprint, no CAPTCHA handling. Google
  is never contacted.
- **No circumvention.** A 401, 403 or 429, or a CAPTCHA, bot-check, Akamai, Cloudflare,
  PerimeterX or DataDome block page or a waiting room (any status) is `blocked`. Nothing is
  retried, and that site (`www.` ignored) goes on a 30-minute cooldown: later requests return
  `blocked` without contacting it. Cooldowns live in memory; a restart clears them.
- **Polite and minimal.** One upstream page per person action (plus at most one Shopify `.js`
  follow-up on the same host; a photo search is an upload plus two Bing pages). Requests to one
  host run one at a time, at least 1 s apart. Answers are cached in memory for 15 minutes (200
  entries, 64 MB) and identical in-flight requests are shared. No crawling, no prefetching.
- **Safe fetching (SSRF).** Every URL and every redirect hop goes through `validateImportUrl` /
  `checkRedirectChain` (`js/server/urlsafety.js`, at most 5 hops); every A/AAAA answer is checked
  against the blocked ranges and the connection is pinned to the checked address; 12 s timeout;
  byte caps after decompression (pages 8 MB, JSON 2 MB, images 10 MB); content-type allowlists;
  no cookies, except Bing's own in-memory jar, sent only to `www.bing.com`.
- **Route budgets.** Lookup and search answer within 22 s and lens within 36 s, before the
  browser gives up (25 s and 40 s). Once Bing has named a photo, lens returns whatever lists it
  has when time runs out.

**Privacy.** The server stores nothing on disk and has no accounts. A photo sent to
`/api/lens` lives in memory for that request only; the lens answer is cached for 15 minutes
under a SHA-256 of the bytes, never the bytes. The browser sends the photo only from
`searchWebForPhoto`, which runs only when the person presses "Search online stores" on the
match screen next to the line saying it goes to Microsoft Bing. It sends the 768 px processing
copy (already re-encoded without EXIF or GPS), rotated as the person rotated it. Metrics carry
statuses and counts, never URLs, hosts, queries or user ids.

## 3. Conventions

- Vanilla ES modules, `.js` extension on every import. No TypeScript, no bundler.
- JSDoc types on exported functions. Comments explain why, not what; match the existing
  density (a short comment above a non-obvious block).
- Rendering uses the `html` tagged template from `js/lib/html.js`. It escapes every
  interpolated value. Use `raw()` only for markup produced by `html` or trusted generators
  (`icons.js`, `illustrations.js`). Never build markup by string concatenation of user data.
- URLs placed in `href`/`src` go through `safeUrl()` (allows `http:`, `https:`, `blob:`,
  `data:image/`, relative and hash URLs).
- Anything a store page or Bing returned is untrusted: text only through `html` (never
  `raw()`), links and images only through `safeUrl()`, store links as plain
  `target="_blank" rel="noopener noreferrer"` links (never affiliate redirects), remote images
  with `referrerpolicy="no-referrer"`. Server-side, ops rebuild every web answer field by field
  (`cleanWebSnapshot`, `cleanPage`, `cleanListing`) before storing or returning it.
- Money is an integer number of minor units plus an ISO currency (`{ amountMinor, currency }`
  or `priceMinor` + `currency`). Never floats for money. Format with `format.money()`.
- Times are ISO strings in records; the server takes `ctx.now()` (ms) so tests can fix time.
  UI shows relative times with `format.relative()`.
- Unknown is `null`, never `0` or `''`. A missing shipping cost is `{ kind: 'unknown' }`.
- Sizes always carry their system: `{ value: '10', system: 'US-M' }`. One-size products use
  `{ value: 'OS', system: 'ONE-SIZE' }`. Size systems are never converted into each other.
- IDs: catalog ids are stable slugs; user records use `newId(prefix)` from `js/lib/ids.js`
  (`own_`, `wish_`, `fit_` (outfits), `pho_`, `job_`, `rec_`, `fb_`, `req_`, `srec_`, `clk_`,
  `cor_`, `aud_`).
- User-facing copy: US English, sentence case, plain verbs, active voice. Buttons say what
  happens ("Save to collection", "View offers"). Errors say what happened and what to do; they
  don't apologize. No all-caps labels, no `→` on buttons, no percentages the data can't support.
- Never use gendered pronouns for people in copy or demo data.

## 4. Data model

### 4.1 Shared vocabulary (`js/data/schema.js`)

```
CATEGORY          'sneaker' | 'watch' | 'clothing'
RETRIEVAL         'candidate_found' | 'similar_result' | 'no_match' | 'processing_error' | 'not_run'
IDENTITY          'unconfirmed' | 'user_confirmed' | 'identifier_supported' | 'manual'
VARIANT_STATE     'confirmed' | 'incomplete' | 'conflicting' | 'not_applicable'
OWNED_CONDITION   'new' | 'like_new' | 'good' | 'well_worn'
OFFER_CONDITION   'new' | 'used_like_new' | 'used_good' | 'used_fair'
WISH_CONDITION    'new_only' | 'new_or_used'
WISH_REASON       'want_exact' | 'like_style' | 'too_expensive' | 'find_alternatives' | 'match_owned'
WISH_INTENT       'exact' | 'inspiration' | 'complement'      (derived from reason, editable)
SIZE_SYSTEM       'US-M' | 'US-W' | 'EU' | 'UK' | 'ALPHA' | 'WAIST-INSEAM' | 'ONE-SIZE'
ROLE              'user' | 'stylist' | 'admin'
STYLE_TAG         'minimal' 'classic' 'street' 'sporty' 'outdoor' 'workwear' 'preppy'
                  'tech' 'vintage' 'dressy' 'bold'
INTENDED_USE      'everyday' 'work' 'running' 'training' 'outdoors' 'going_out' 'formal'
FEEDBACK          'too_expensive' | 'wrong_style' | 'too_similar' | 'more_like_this' | 'saved'
EVIDENCE_KIND     'visual' | 'color' | 'identifier' | 'brand_text' | 'product_link'
                  | 'catalog_search' | 'user_selection'
EVIDENCE_SOURCE   'image_features' | 'ocr' | 'barcode' | 'user_entered' | 'url' | 'catalog'
PRODUCT_TYPES     sneaker: runner court trail skate high-top slip-on
                  watch: field diver dress chronograph gmt digital strap
                  clothing: tee oxford-shirt overshirt chore-jacket field-jacket bomber hoodie
                            crewneck chinos trousers jeans shorts
```

Labels for all of these live next to them in `schema.js` (`CATEGORY_LABEL`, `TYPE_LABEL`,
`STYLE_LABEL`, `USE_LABEL`, `FEEDBACK_LABEL`, `WISH_REASON_LABEL`, `WISH_INTENT_LABEL`,
`OWNED_CONDITION_LABEL`, `OFFER_CONDITION_LABEL`, `SELLER_TYPE_LABEL`). Colors and their labels
are in `js/data/colors.js` (`COLORS`, `PICKABLE_COLORS` excludes metals).

Identity rules (the UI and storage must keep these distinct):

- `user_confirmed`: the person picked this candidate. That is their choice, not independent
  verification, and the UI says "Confirmed by you".
- `identifier_supported`: the person confirmed it **and** a product identifier (style code,
  reference, GTIN) from a label, barcode or typed entry matches the confirmed variant. The
  evidence records where the identifier came from (`ocr`, `barcode`, `user_entered`).
- `manual`: a custom record with no catalog identity. `productId` and `variantId` are `null`.
- `unconfirmed`: only on wishlist items saved while matching is still running (`matchPending`).
- A `similar_result` candidate can never become an item's identity without the person choosing
  it explicitly, and the confirmation screen labels it as similar, not a match.
- Variant `incomplete` means the model is known but the colorway/reference is not.
  `conflicting` means evidence disagrees (for example the label's style code belongs to a
  different colorway than the one chosen) and the item is flagged for review.
- Size, clothing size, watch dimensions beyond the catalog's sourced facts, authenticity and
  condition are never inferred from a photo. Sizes come only from what the person enters.
- Web data (a store page, a Bing Shopping listing, Bing visual search) never becomes a catalog
  identity. Items saved from it are `manual` with null ids, one `product_link` / `url` evidence
  line saying where the details came from, and a `WebSnapshot` (4.3). Size, condition and
  authenticity are never taken from a page or photo, and a store price never fills
  `targetPriceMinor` or `details.purchase`.

### 4.2 Catalog (static seed in `js/data/*.js`, copied into IndexedDB on first run)

```js
brand   { id, name, categories: [CATEGORY], country?: string }

product {
  id: 'kestrel-runner-2', category, type, brandId, name,
  styleTags: [STYLE_TAG], materials: [string], features: [string],
  description: string,
  sizing: { system: SIZE_SYSTEM, sizes: [string], widths?: [string] } | null,
                             // watches: null; straps: { system: 'ONE-SIZE', sizes: ['OS'] }
  attributes: {},            // model-level facts, validated per category (schema.js ATTRIBUTE_RULES)
  sources: [{ provider, sourceId, retrievedAt }],
  illustration: { kind, shape, details?, ... }   // generator input (illustrations.js header)
}

variant {
  id: 'kestrel-runner-2--olive-bone', productId, name: 'Olive / Bone',
  identifiers: { styleCode?, reference?, gtins?: [string] },
  colors: [{ name: COLOR_NAME, role: string, weight: number }],   // weights sum to ~1
  attributes: {},            // variant-level facts, validated per category
  msrpMinor: number | null, currency: 'USD',
  release: { date, source } | null,
  illustration: { palette: { [part]: '#rrggbb' }, options? }
}

image {                      // catalog image provenance, one or more per variant
  id, variantId, provider: 'demo-illustrations' | 'demo-retailer-feed',
  sourceUrl: string, attribution: string, license: 'owned' | 'feed-terms',
  permissions: { inventoryDisplay: boolean, requiresActiveOffer: boolean,
                 cacheTtlHours: number, attributionRequired: boolean },
  status: 'active' | 'expired' | 'taken_down', fetchedAt: ISO, expiresAt: ISO | null
}

retailer {
  id, name, domain: 'northline.example', kind: 'retailer' | 'marketplace',
  categories: [CATEGORY],
  affiliate: { networkId, programId, status: 'approved' | 'pending' | 'none',
               allowedParams: [string], paramValues: {} } | null,
  returnsPolicy: string | null, urlPattern: '/p/{listingId}'
}

offer {
  id, retailerId, listingId, variantId,
  condition: OFFER_CONDITION, sellerType: 'retailer' | 'authorized_dealer'
    | 'independent_dealer' | 'marketplace_seller' | 'private_seller',
  includedComponents: [string] | null,      // watches: 'box', 'papers', 'warranty card'
  sizes: [{ value, system, priceMinor, stock: 'in_stock'|'low_stock'|'out_of_stock' }] | null,
  priceMinor: number | null, stock: ... | null,   // used when sizes is null (watches)
  currency: 'USD',
  shipping: { kind: 'free' | 'flat' | 'unknown' | 'calculated_at_checkout', amountMinor? },
  fees:     { kind: 'none' | 'known' | 'unknown', amountMinor?, label? },
  tax:      { kind: 'unknown' | 'estimate', amountMinor? },
  delivery: { minDays, maxDays } | null,
  returns: string | null,
  warranty: { kind: 'manufacturer' | 'seller' | 'none' | 'unknown', months?, provider? },
  url: 'https://northline.example/p/NL-48213',
  listingStatus: 'active' | 'removed',
  demoAgeHours: number,      // demo only: lastCheckedAt = now - demoAgeHours
  checkedAt?: ISO            // set when an admin refreshes the demo offer
}
```

Watches: `product.attributes.attachment` is `spring_bar | quick_release | integrated`;
`variant.attributes.lugWidthMm` is the catalog lug width. Straps: `type: 'strap'`,
`variant.attributes.strapWidthMm`. A strap "fits" only when both catalog facts agree (6.1).

`js/data/catalog-index.js` turns the arrays into the **Catalog** object every engine takes:

```js
catalog = {
  version, brands: Map, products: Map, variants: Map, images: Map, retailers: Map, offers: Map,
  variantsByProduct, offersByVariant, imagesByVariant,          // Map<id, list>
  product(id), variant(id), brand(id), retailer(id), productOf(variantId), brandOf(productId),
  variantsOf(productId), offersOf(variantId), imagesOf(variantId),
  listProducts({ category? }), listVariants({ category? })
}
```

Helpers: `variantTitle(catalog, variantId)`, `primaryCode(variant)` (style code, else reference).
Bump `CATALOG_VERSION` in `catalog.js` whenever the seed changes: stored catalogs re-seed on the
next load (admin imports and accepted corrections are then replaced).

**Demo catalog** (`CATALOG_VERSION` 2026-10-14.2): 9 brands, 10 products, 24 versions, 6
retailers, 25 offers. It is built to show specific states; screens should expect all of them:

| Case | Where |
| --- | --- |
| Near-identical colorways (only a code tells) | Vela Court Low White / Gum vs White / Natural; Kestrel Runner 2 Olive / Bone vs Olive / Sail |
| Same look, different reference | Arden Field AF38 vs AF40 (38 and 40 mm) |
| Two products that look alike | Harbor & Pine Deck Field Jacket Navy vs Wrenfield Chore Jacket Navy |
| Strap fits by catalog facts / doesn't | Linwick Field Strap 20 mm fits the Arden Field and Ostrel Dive 200 (20 mm lugs, spring bars); the 18 mm version doesn't |
| Image only allowed next to a live offer | Fieldhouse Wool Trouser Charcoal (feed-terms image; not shown in collections) |
| No offers, price unknown | Kestrel Olive / Sail and Navy / White, Vela White / Natural and Black / White, Arden AF40 and AF38 cream dial, Harbor & Pine Olive, Wrenfield Chore Jacket Khaki |
| Only used offers (unknown under the default new-only condition) | Ostrel Dive 200 black dial, rubber strap |
| Sold out in the profile size | Tollan Tempo Charcoal / Gum in 10 and 10.5; Wrenfield Chore Jacket Navy new in M (a used M exists) |
| Unknown shipping, aging and stale prices | Courtside listings (shipping unknown, one 15 hours old); Hourhand AF38 private sale (52 hours, stale) |
| Affiliate program pending, or none | Hourhand Exchange (pending: plain links); Courtside Goods (no program) |

Demo accounts (`js/server/seed.js`): Alex Rivera (user, the brief's collection: white court
sneakers, navy field jacket, grey wool trousers, steel field watch; an olive runner on the
wishlist), Sam Okafor (user, a separate collection), Jordan Blake (stylist assigned to Alex),
Riley Park (stylist with no clients), Morgan Lee (admin).

### 4.3 User data (IndexedDB stores, see `js/server/db.js`)

```js
user     { id, email, displayName, role: ROLE, passwordHash?, salt?, createdAt,
           analyticsId /* pseudonymous id used for click records */, demo: boolean }
session  { token, userId, createdAt, expiresAt }      // 30 days
profile  { userId, onboardedAt: ISO|null,
           sizes: { shoe?: Size, top?: Size, bottom?: Size },
           budgets: { sneaker?: number, watch?: number, clothing?: number },  // minor units
           styles: [STYLE_TAG], colorsLiked: [COLOR_NAME], colorsAvoided: [COLOR_NAME],
           uses: [INTENDED_USE], categories: [CATEGORY], theme: 'system'|'light'|'dark' }

photo    { id, userId, kind: 'original' | 'processing' | 'cleaned' | 'label' | 'web',
           blob: Blob, mime, width: number|null, height: number|null, bytes, createdAt,
           processingId: string|null,   // original/label row -> its processing copy
           sourceId: string|null,       // processing/cleaned row -> the row it was made from
           source?: { imageUrl, pageUrl: string|null, host } }   // 'web' rows only
                                        // private; blobs never leave except as object URLs,
                                        // and a processing copy is sent to Bing only from
                                        // searchWebForPhoto (2.1)
// 'web': a store's image kept on this device (importWebImage), re-encoded by imaging.normalize
// like an upload, one row with no processing copy; host comes from pageUrl (else imageUrl).
// It follows the same privacy, export, deletion and stylist-sharing rules as the person's photos.

ownedItem {
  id, userId, createdAt, updatedAt, archivedAt: ISO | null,
  category, productId: string | null, variantId: string | null,
  // brand and name need a visible character (a zero-width space alone is blank)
  custom: { brand, name, variantName, type, colors: [COLOR_NAME] } | null,
  identity: Identity,
  details: {
    size: Size | null, condition: OWNED_CONDITION | null,
    purchase: { priceMinor, currency, date, from } | null,
    notes: string,                      // private
    serialNumber: string | null,        // watches only, private, never a product identifier
  },
  ownerChanges: [{ part: 'strap' | 'bracelet' | 'other', description, widthMm: number|null }],
  photos: { originalId: string | null, cleanedId: string | null, labelIds: [string],
            webId: string | null },     // webId: a store image (photo kind 'web')
  display: 'catalog' | 'original' | 'cleaned' | 'web',
  sourceUrl?: string | null,            // added from a product link; web items: web.url
  web: WebSnapshot | null,              // only on custom items saved from the web
  fromWishlistId?: string               // created by markPurchased
}

WebSnapshot {                           // records.cleanWebSnapshot rebuilds it from input
  url,                                  // the product page, or Bing's page for a listing;
                                        // http(s), <= 2048, no credentials
  host,                                 // derived from url, never taken from input
  siteName, title, brand, color,        // as read (title <= 200, others <= 120) or null
  price: { amountMinor, currency } | null,   // integer 0..1e9, ISO currency; a snapshot, not an offer
  availability: 'in_stock'|'out_of_stock'|'preorder'|'backorder'|'discontinued'|'limited'|null,
  identifiers: { sku, gtin, mpn },      // each string (<= 64) or null
  imageUrl,                             // where the image came from (provenance; never rendered
                                        // for saved items, which show photos.webId)
  via: 'page' | 'search' | 'photo',     // store page, Bing Shopping listing, Bing visual search
  query,                                // typed query (search) or Bing's recognized name (photo)
  fetchedAt                             // ISO; a value after now + 1 day becomes now
}

Identity {
  retrieval: RETRIEVAL, resolution: IDENTITY, variant: VARIANT_STATE,
  evidence: [{ kind: EVIDENCE_KIND, source: EVIDENCE_SOURCE, detail: string }],
  conflicts: [{ kind, detail }],
  confirmedBy: userId | null, confirmedAt: ISO | null, matchJobId: string | null
}

wishlistItem {
  id, userId, createdAt, updatedAt, status: 'active' | 'purchased' | 'removed',
  category, productId | null, variantId | null, custom | null, identity: Identity,
  reason: WISH_REASON, reasonNote: string, intent: WISH_INTENT, linkedOwnedIds: [id],
  desired: { size: Size | null, condition: WISH_CONDITION, variantFlexible: boolean },
  targetPriceMinor: number | null, currency: 'USD',
  sourceUrl: string | null, matchPending: boolean,
  photos: { originalId: string | null, webId: string | null },
  web: WebSnapshot | null, purchasedOwnedId: string | null
}                                       // no display field: views derive it (5.2)

outfit {                                // owner-only; never shared with stylists or admins
  id, userId, createdAt, updatedAt,
  name,                                 // 1..60 UTF-16 units after spaces are collapsed and
                                        // control, zero-width and bidi characters removed
                                        // (joiners kept); needs one visible character; unique
                                        // per person ignoring case, spacing and
                                        // default-ignorable characters (NFKC + lowercase;
                                        // combining marks count; best effort, no index)
  itemIds: [ownedItem id],              // 2..12 of the person's own items when saved, archived
                                        // ones allowed; deleteOwned removes an id, so an outfit
                                        // can drop below 2 (its view says incomplete)
  notes: string                         // '' or up to 500 characters
}                                       // DB_VERSION 2 added this store; no demo outfits are
                                        // seeded (DEMO_SEED_VERSION is unchanged)

matchJob {
  id, userId, createdAt, updatedAt, dest: 'owned' | 'wishlist', category: CATEGORY | null,
  photoId, processingId: string | null, crop: { x, y, w, h, rotate } | null,
                                        // normalized 0..1, rotate in 90° steps
  labelPhotoIds: [id],
  texts: [{ text, source: 'ocr' | 'barcode' | 'user_entered', at, photoId?, confidence? }],
  labelReads: [{ photoId, status: 'read' | 'empty' | 'unavailable' | 'error', message, at }],
  productUrl: string | null,
  link: { status: 'resolved' | 'unsupported_link' | 'invalid_url' | 'unresolved' | 'unavailable',
          productId?, variantId?, offerId?, reason } | null,
  status: 'queued' | 'processing' | 'done' | 'error' | 'timeout' | 'rejected' | 'confirmed',
  progress: { stage: 'queued' | 'preparing' | 'indexing' | 'reading_label' | 'analyzing',
              done, total } | null,     // indexing counts reference renders
  attempts: number, error: { code, message } | null, latencyMs: number | null,
  result: MatchResult | null, confirmedItemId: string | null,
  web: JobWeb | null,                   // online store results, only after searchWebForPhoto;
                                        // kept through addMatchEvidence and retryMatchJob
  runId                                 // internal; never returned
}

JobWeb {
  status: 'ok' | 'no_match' | 'not_connected' | 'blocked' | 'unavailable',
  engine: 'bing' | null, query: string | null,   // what Bing recognized
  shopping: [Listing & { draft: WebDraft }],     // Listing and WebResult: section 2.1
  results: [WebResult],                          // pages to read with lookupProductPage
  reason: string | null, searchedAt: ISO
}

WebDraft {                              // engine/web-guess.js draftFromWeb; a guess to confirm
  category: CATEGORY | null,
  custom: { brand, name, variantName /* the page's color */, type, colors: [COLOR_NAME] },
  web: WebSnapshot, imageUrl: string | null
}                                       // never a size, condition or catalog id

MatchResult {
  retrieval: RETRIEVAL,
  candidates: [{                        // at most 5, best first
    id, productId, kind: 'match' | 'similar',
    strength: 'strong' | 'possible' | 'weak',  // shown in words, never as a percentage
    score: number,                      // internal ordering only
    variantId: string | null,           // best variant guess (null if ambiguous and no guess)
    variantOptions: [{ variantId, score, note }],   // note: what differs, or why it was picked
    variantAmbiguous: boolean,          // true: ask the person (or for a code) before saving
    evidence: [{ kind, source, detail }], conflicts: [{ kind, detail }]
  }],
  askFor: [{ kind: 'style_code' | 'size_tag_photo' | 'brand_label' | 'barcode' | 'reference'
             | 'caseback_photo' | 'product_link', reason }],
  features: { colors: [{ name, hex, weight }], aspect, category },
  latencyMs,
  notes: [string]                       // plain sentences to show, e.g. label reading switched off
}

recRequest  { id, userId, mode, seedIds, constraints, resultIds: [variantId], createdAt }
feedback    { id, userId, productId, variantId, type: FEEDBACK, contextItemId | null,
              createdAt, active: boolean }   // opposite signals deactivate each other
click       { id, clickRef, analyticsId, offerId, retailerId, networkId | null,
              destination, tracked: boolean, createdAt }        // no userId
conversion  { id, network, eventId, clickRef, status: 'pending'|'approved'|'reversed'|'paid',
              reason, orderAmountMinor, commissionMinor, currency, occurredAt, updatedAt,
              demo: true }
stylistAssignment { id, stylistId, userId, assignedBy, createdAt, endedAt | null }
stylistRequest {
  id, userId, stylistId, createdAt, updatedAt,
  status: 'open' | 'answered' | 'closed' | 'revoked', revokedAt | null,
  revokedReason?: 'assignment_ended',
  share: { itemIds: [id], snapshot: boolean, includePhotos: boolean, includeNotes: boolean },
  snapshot: [RedactedItem] | null,      // copy made at share time when share.snapshot
  message, budgetMinor | null, category | null
}
stylistRec  { id, requestId, stylistId, userId, items: [{ productId, variantId, note }],
              message, createdAt }
audit       { id, at, actorId, action, targetType, targetId, meta }
correction  { id, userId, productId, variantId, field, currentValue, proposedValue, note,
              status: 'open' | 'accepted' | 'rejected', createdAt, reviewedBy, reviewedAt,
              applied?: boolean }
idempotency { id: `${userId}:${op}:${key}`, result, createdAt }   // 24 hours
event       { id, type, at, data }      // metrics; no user ids, no free text
config      { key, value }              // 'providerSimulation', 'rankingWeights',
                                        // 'offerFreshnessHours', 'matchTimeoutMs',
                                        // 'webSearchTimeoutMs' (45000), 'evalReport'
catalogFeatures { id: `${variantId}:${ILLUSTRATION_VERSION}`, variantId, specHash, features, ... }
```

## 5. Server layer (`js/server/`)

`createApi({ db, clock, providers, config, rateLimits })` returns an object of operations.
Every operation has the signature `op(call, args)` where `call = { token }`. The browser wraps
this in `js/client.js`, so screens call `api.listOwned(args)` with the current session.

Each `ops/*.js` file exports `ops`, a map of definitions:

```js
export const ops = {
  listOwned: { auth: 'user', async run(ctx, args) { ... } },
  createOwned: { auth: 'user', idempotent: true, async run(ctx, args) { ... } },
  recommend: { auth: 'user', rateLimit: 'recs', async run(ctx, args) { ... } },
};
```

- `auth`: `'public'` (no session), `'any'` (any signed-in role), `'user'`, `'stylist'`,
  `'admin'`. Accounts have exactly one role. A wrong role gets `forbidden`.
- `idempotent`: when `args.idempotencyKey` is present, a repeated call with the same key returns
  the first result without running again (24 hours; concurrent taps share one run). Screens
  create one key per intent (per form render, per confirm tap sequence) with
  `idempotencyKey()` from `js/lib/ids.js` and reuse it on retries.
- `rateLimit`: `'scan'` (30 per hour), `'recs'` (120 per hour), `'web'` (60 per hour: store
  page lookups, online store searches and photo searches, each a real request through the local
  server) or `'webImage'` (240 per hour: store images saved with items) per actor;
  `rate_limited` carries `details.retryAfterMs`. With `chargeInRun: true` the dispatcher
  doesn't charge before `run()`; the op calls `ctx.rateLimit()` once its input is valid, so a
  malformed link or query costs nothing.
- `keepResult(result) -> boolean` (idempotent ops): whether a result is stored under the key.
  `importWebImage` keeps only `ok`, so a retry after a failed download asks again.
- `ctx` = `{ actor, token, db, clock, config: { get, set }, providers, catalog(),
  invalidateCatalog(), now(), iso(), audit(action, targetType, targetId, meta),
  metric(type, data), call(opName, args) /* internal, same actor */,
  rateLimit(kind?) /* charges one use; throws rate_limited */ }`.
- Return plain data. `api.js` deep-clones results so callers never hold store references.
- Throw `ApiError(code, message, details)` from `errors.js`. Codes: `unauthenticated`,
  `forbidden`, `not_found`, `invalid`, `conflict`, `duplicate`, `rate_limited`, `timeout`,
  `unavailable`, `unsupported`, `not_implemented`. `message` is safe to show the person;
  `invalid` carries `details.fields` (`{ 'details.size': 'Use a US size like 10 or 10.5' }`);
  `duplicate` carries `details.duplicates` (views). Unexpected errors become `unavailable`
  ("Something went wrong on our side. Try again.").
- Records that belong to a person are only read through policy checks in `policy.js`. A record
  owned by another user returns `not_found` (not `forbidden`) so ids can't be probed. Admins
  have no operation that returns anyone's items, photos, notes, sizes or prices paid.

### 5.1 Operation list and owner files

| File | Operations |
| --- | --- |
| `ops/account.js` | `listDemoAccounts`, `signInDemo`, `signUp`, `signIn`, `signOut`, `me` |
| `ops/profile.js` | `getProfile`, `updateProfile`, `completeOnboarding` |
| `ops/catalog.js` | `searchCatalog`, `getProduct`, `getVariant`, `listBrands` |
| `ops/photos.js` | `uploadPhoto`, `getPhotoUrl`, `cleanupPhoto` |
| `ops/matching.js` | `createMatchJob`, `getMatchJob`, `addMatchEvidence`, `retryMatchJob`, `rejectMatch`, `searchWebForPhoto`, `confirmMatch` |
| `ops/inventory.js` | `listOwned`, `getOwned`, `createOwned`, `updateOwned`, `archiveOwned`, `restoreOwned`, `deleteOwned`, `setDisplayImage`, `correctMatch`, `reportCatalogIssue`, `checkDuplicates` |
| `ops/wishlist.js` | `listWishlist`, `getWishlistItem`, `createWishlist`, `updateWishlist`, `removeWishlist`, `markPurchased` |
| `ops/outfits.js` | `listOutfits`, `getOutfit`, `createOutfit`, `updateOutfit`, `deleteOutfit` |
| `ops/recs.js` | `recommend`, `helpMeChoose`, `giveFeedback`, `listFeedback`, `removeFeedback`, `parseRequest` |
| `ops/offers.js` | `getOffers`, `createClick`, `importFromUrl` |
| `ops/marketplaces.js` | `listMarketplaces`, `searchMarketplaces`, `importMarketplaceLink` |
| `ops/web.js` | `webStatus`, `lookupProductPage`, `searchWebProducts`, `importWebImage` |
| `ops/stylist.js` | `listMyStylists`, `createStylistRequest`, `listStylistRequests`, `getStylistRequest`, `revokeStylistRequest`, `submitStylistRecs`, `listStylistRecs`, `getAuditLog` |
| `ops/privacy.js` | `exportMyData`, `deleteMyAccount` |
| `ops/admin.js` | `adminOverview`, `adminListProducts`, `adminImportFeed`, `adminListCorrections`, `adminResolveCorrection`, `adminListImages`, `adminSetImageStatus`, `adminListOffers`, `adminRefreshOffer`, `adminListJobs`, `adminRetryJob`, `adminGetProviders`, `adminSetProviderSimulation`, `adminGetWeights`, `adminSetWeights`, `adminListAccounts`, `adminAssignStylist`, `adminEndAssignment`, `adminListClicks`, `adminConversions`, `adminLoadDemoConversions`, `adminSaveEvalReport`, `adminGetEvalReport` |

Each operation's arguments and result are also documented with JSDoc in its file. Cross-module
helpers other ops use: `requeueMatchJob(ctx, jobId)` and `loadReferenceIndex(env)` /
`analyzeAndMatch(input)` (`ops/matching.js`), `ownedViews`, `loadOwned`, `checkPhotoRefs`
(`ops/inventory.js`), `wishViews` (`ops/wishlist.js`), `deletePhotos`, `revokePhotoUrls`,
`storePhoto` (the one validate-normalize-store path for uploads and store images,
`ops/photos.js`), `cleanSearchLists`, `photoSearchResult` (`ops/web.js`), `cleanWebSnapshot`,
`webEvidence`, `webIdentity`, `cleanLinkUrl`, `displayHost` (`records.js`), `correctionField`, `coerceCorrectionValue` (`ops/admin.js`),
`sanitizeConstraints` (`ops/recs.js`), `searchProducts`, `tokenize` (`ops/catalog.js`).

### 5.2 Items returned to screens

Owned items, wishlist items and recommendation results are **views**, not raw records. A view
adds what screens need to render without more calls:

```js
ProductSummary { id, category, type, typeLabel, name, brand: { id, name }, styleTags }
VariantView {                            // server/views.js variantView
  id, productId, name, identifiers, code, colors, attributes, msrpMinor, currency, release,
  image: { url, label: 'Catalog image', provider, attribution, license }
       | { url: null, label: null, ..., unavailableReason }   // source terms don't allow it
}

OwnedView = ownedItem & {
  product: ProductSummary | null,
  variant: { id, name, identifiers, colors, attributes } | null,
  brandName: string, title: string, subtitle: string, code: string | null,   // label strip;
                            // custom web items: web.identifiers.mpn ?? sku (a style code)
  web: WebSnapshot | null,  // null on records saved before web snapshots existed
  image: DisplayImage,
  copies: number            // how many active records share this variant (multiple copies)
}
// subtitle when the version isn't confirmed: 'Colorway not confirmed' (sneakers),
// 'Color not confirmed' (clothing), 'Reference not confirmed' (watches); custom: variantName
// or 'Custom item'.

WishlistView = wishlistItem & { product, variant, brandName, title, subtitle, code, image, web,
  linkedOwned: [{ id, category, brandName, title, subtitle, image }],
  ownedCopies: number, purchasedOwned: { id } | null }

OutfitView {               // ops/outfits.js; owner-only, like the items in it
  id, name, notes, createdAt, updatedAt,
  itemIds: [id],           // only ids that are still the person's items, in saved order
  items: [OwnedView],      // archived items included (archivedAt set)
  itemCount: number,
  incomplete: boolean      // fewer than 2 items left after deletions
}

DisplayImage {
  kind: 'catalog' | 'original' | 'cleaned' | 'web' | 'placeholder',
  url: string | null,       // data: URL for catalog images; null for photos (hydrate)
  photoId: string | null,   // for photos and store images; screens hydrate with api.getPhotoUrl
  label: 'Catalog image' | 'Your photo' | 'Your photo, cleaned up'
       | 'Image from nike.com' | 'Store image' | null,   // a store image never says "Your photo"
  attribution: string | null,
  fallbackReason: string | null,   // why the catalog image isn't shown (say it, don't hide it)
  options: ['catalog'?, 'original'?, 'cleaned'?, 'web'?]   // what the person can switch to
}
// Order: the wanted display when it has an image, then the person's photo, then the store
// image (photos.webId), then the catalog image, then the placeholder. Defaults: items saved
// from a link or text search show 'web'; items saved from the photo flow show 'original' and
// keep 'web' as an option. Wishlist views derive the display: catalog image when permitted,
// else the person's photo, else the store image.

RedactedItem {             // what a stylist sees (policy.redactForStylist), allowlist only
  id, category, productId, variantId, custom, product, variant, title, brandName, subtitle, code,
  image,                   // a photo only when the request shares photos
  details: { size, condition, notes: string | null },   // notes only when shared
  ownerChanges, identity: { resolution, variant }, shared: { photos, notes }
}                          // never: purchase, serialNumber, evidence, photo ids, web snapshot;
                           // store images are hidden unless photos are shared, like photos
```

The display choice is the person's and is kept; `image` says what is actually shown. The
original photo is never deleted or replaced when the catalog image is displayed.

### 5.3 Providers (`js/server/providers/`)

Providers keep external services replaceable. Each has a browser implementation (on the
device, `index.browser.js`) and a test implementation (`test.js`, Node, fixture features).
`web` is the only one that talks to the network on purpose, and only through the local server.

```
imaging.normalize(blob) -> { original: Blob, processing: Blob, width, height, mime,
                             processingWidth, processingHeight }
       // decodes with EXIF orientation, re-encodes JPEG (drops EXIF/GPS), original <= 2048 px,
       // processing <= 768 px, refuses < 200 px; HEIC the browser can't decode -> 'unsupported'
imaging.cleanup(blob)   -> { blob, width, height }   // item on the studio backdrop, cropped
vision.analyze({ blob, crop, category }) -> Features  // crop/rotate, then engine/features.js
ocr.read(blob)          -> { text, confidence: number|null, barcodes: [digits] }
                           // lazy Tesseract.js; throws ApiError('unavailable') to type instead
reference.features(catalog, variantIds?, { onProgress? }) -> Map<variantId, Features>
offers.list(catalog, variantId, now) -> offer[] with lastCheckedAt resolved
conversions.report()    -> { connected: false, network: null, events: [] } | { connected: true, network, events }
marketplaces.list(), marketplaces.search(id, query, { catalog })   // StockX/GOAT not connected
urls.objectUrl(blob, id), urls.revoke(url)            // photo URLs (tests: 'blob:test/<id>')
web.status()            -> { live: boolean, reason: string|null }   // ./api/status.json, once per page load
web.lookup({ url })     -> /api/lookup answer | { status: 'not_connected', reason }
web.search({ query })   -> /api/search answer | not_connected
web.searchImage({ blob, rotate }) -> /api/lens answer | not_connected
                           // rotates on a canvas when rotate != 0 and sends a JPEG
web.fetchImage({ url }) -> { status: 'ok', blob, mime, finalUrl } | { status, reason }
```

`web` (`providers/web.browser.js`) sends same-origin `POST`s to `./api/*` with `X-Rotation: 1`
and timeouts (lookup, search and image 25 s, lens 40 s). It never throws for expected failures:
without the server every call is `{ status: 'not_connected', reason: NOT_CONNECTED }` ("Real
store search needs the local server. In the closet-advisor folder, run npm start and open the
address it prints."), and a request the server doesn't answer is `unavailable` with
`NO_ANSWER`. `test.js` uses `notConnectedWeb` (`providers/web.js`), which never calls `fetch`;
tests script one with `fakeWebProvider(responses)` (`providers/test.js`, re-exported by
`tests/helpers.mjs`) and pass it as `createTestEnv({ providers: { web } })`.

Admin can switch simulations (`config.providerSimulation`): `vision: 'ok'|'timeout'|'error'`,
`offers: 'ok'|'down'`, `ocr: 'ok'|'off'`, so the failure states can be demonstrated.

### 5.4 Operation reference (arguments → result, as implemented)

Shorthand: `Size = { value, system }`; `[X]` is a list; `?` optional. Every error is an
`ApiError` with a message to show. "Others" means another person's ids, which behave like
missing ones (`not_found`).

**Account** (`public` unless noted)

- `listDemoAccounts({})` → `[{ id, displayName, role, blurb }]`
- `signInDemo({ userId })` → `{ token, session: Actor, expiresAt }`; `not_found` if not a demo id
- `signUp({ email, password, displayName })` → same; role is always `user`; `invalid` fields
- `signIn({ email, password })` → same; `invalid` ("That email and password don't match...")
- `signOut({})` (any) → `{ ok: true }`; `me({})` (any) → `Actor { id, role, displayName, email, analyticsId, demo }`
- Client: `setSession(result)` stores the session; `signOut()`, `resetDemo()`, `applyTheme()`.

**Profile** (`user`)

- `getProfile({})` → profile (4.3)
- `updateProfile(patch)` / `completeOnboarding(patch)` → profile. Patch keys: `sizes`
  (`shoe` US-M/US-W, `top` ALPHA XS..XXL, `bottom` WAIST-INSEAM; `null` clears), `budgets`
  (positive minor units; `null` clears), `styles` (≤ 6), `colorsLiked`, `colorsAvoided` (no
  overlap), `uses`, `categories` (≥ 1), `theme`. `completeOnboarding` also sets `onboardedAt`.

**Catalog** (`any`)

- `searchCatalog({ q?, category?, brandId?, limit? ≤ 60 })` → `[{ product: ProductSummary, variants: [VariantView], matchedVariantIds }]`. Exact code hits rank first.
- `getProduct({ productId })` → `{ product: ProductSummary & { description, materials, features, sizing, attributes, sources }, variants: [VariantView] }`
- `getVariant({ variantId })` → `{ product: ProductSummary, variant: VariantView }`
- `listBrands({ category? })` → `[{ id, name, categories }]`

**Photos**

- `uploadPhoto({ blob, kind: 'original'|'label'|'web', source?: { imageUrl, pageUrl? }, idempotencyKey? })` (`user`) →
  `{ photoId, processingId, width, height, mime, bytes }`. `unsupported` (not JPEG/PNG/WebP/
  HEIC by signature, or HEIC the browser can't decode), `invalid` (> 15 MB, empty, < 200 px).
  Kind `'web'` (a store image; normally saved through `importWebImage`) needs
  `source.imageUrl`, accepts JPEG, PNG, WebP, GIF or AVIF, is kept only once `normalize` has
  re-encoded it to JPEG, PNG or WebP (else `unsupported`), and stores one row with
  `processingId: null` and `source: { imageUrl, pageUrl, host }`.
- `getPhotoUrl({ photoId })` (`any`) → `{ url, expiresAt }` (10 minutes; owner, or a stylist
  through a live request that shared photos, audited). Others → `not_found`.
- `cleanupPhoto({ itemId, idempotencyKey? })` (`user`) → `{ photoId, itemId }`; sets
  `photos.cleanedId`, keeps the original and the display choice; `invalid` without a photo,
  `unavailable` when the item can't be separated.

**Matching** (`user`; create/evidence/retry are rate-limited `scan`)

- `createMatchJob({ photoId, category?, dest: 'owned'|'wishlist', crop?, texts?, processingId?, idempotencyKey })` → `MatchJobView` (status `queued`; runs in the background).
- `getMatchJob({ jobId })` → `MatchJobView` = matchJob (4.3, without `runId`) & `{ maxAttempts, canRetry }`; each `result.candidates[i]` also has `product: ProductSummary` and `variants: [VariantView]` (same order as `variantOptions`). Poll every 100–300 ms while `queued`/`processing`.
- `addMatchEvidence({ jobId, labelPhotoId?, code?, productUrl?, idempotencyKey })` → `MatchJobView` (re-queued, attempts reset). Codes are `user_entered`; label photos are read on the device (`labelReads`); product links resolve through `importFromUrl` (`link`).
- `retryMatchJob({ jobId, idempotencyKey })` → `MatchJobView`; only `error`/`timeout`, ≤ 3 attempts, else `conflict`.
- `rejectMatch({ jobId })` → `MatchJobView` (`rejected`).
- `searchWebForPhoto({ jobId, idempotencyKey })` (rate limit `web`) → `MatchJobView` with `web: JobWeb` (4.3). The one place a photo leaves the device: the job's processing copy (the original when there is none) goes to `providers.web.searchImage` with the person's framing (`crop: job.crop`, rotation included; the browser provider sends only that part), bounded by config `webSearchTimeoutMs` (45000). Own jobs only (others → `not_found`); `conflict` while `queued`/`processing` and once `confirmed`. Failures are stored as `job.web.status` with a `reason`, not thrown. Listings carry a `draft` (via `'photo'`, the job's category when set). Results are never match candidates.
- `confirmMatch({ jobId, candidateId|null, variantId|null, variantUnsure?, custom?, category?, web?, webPhotoId?, details? | wish?, display?, allowDuplicate?, idempotencyKey })` → `{ item: OwnedView | WishlistView, job: MatchJobView }`. Identity per 4.1 (identifier_supported only when a code in `job.texts` matches the chosen version). `duplicate` with `details.duplicates`; `conflict` if already confirmed or still running. Custom saves may add `web` (a WebSnapshot from `job.web`; `invalid` when it can't be cleaned) and `webPhotoId` (a kind `'web'` photo of the actor's, from `importWebImage`; others → `not_found`): the item keeps the person's photo as `photos.originalId` and shows it, gets `photos.webId`, `web` and `sourceUrl = web.url`, and its evidence adds "Found with Bing visual search from your photo on {date}; you chose it." It stays `manual`.

**Inventory** (`user`; others → `not_found`)

- `listOwned({ category?, q?, brandId?, color?, sort?: 'recent'|'brand'|'name'|'color', includeArchived? })` → `{ items: [OwnedView], facets: { categories: { sneaker, watch, clothing }, brands: [{ id, name, count }], colors: [{ name, label, count }] }, total, collectionTotal, archivedCount }`. Custom brands have ids `custom:<slug>`.
- `getOwned({ itemId })` → `OwnedView`
- `createOwned({ category, productId?, variantId?, custom?, details?, ownerChanges?, photos?: { originalId?, labelIds?, webId? }, display?, source?: 'catalog_search'|'product_link'|'manual'|'web', sourceUrl?, web?, allowDuplicate?, idempotencyKey })` → `OwnedView`; the identity is always built server side. `source: 'web'` is a custom item like `manual` (`custom` required; a `productId` or `variantId` is `invalid`) plus a required `web` snapshot (`invalid` with `fields.web` when it can't be cleaned). Its identity is `manual` with one evidence line: "Details from nike.com on Oct 15, 2026; not checked by Rotation." (via `page`) or "Picked from a Bing Shopping listing (Walmart) on Oct 15, 2026; not checked by Rotation." (via `search`). `sourceUrl` defaults to `web.url`; `display` defaults to `'web'` when `photos.webId` is set.
- `updateOwned({ itemId, patch: { details?, ownerChanges?, custom?, display?, photos?: { originalId?, labelIds?, webId? } } })` → `OwnedView`. A removed store image is deleted unless another record uses it, and a display without its image falls back.
- `archiveOwned` / `restoreOwned({ itemId })` → `OwnedView` (outfits keep archived items); `deleteOwned({ itemId })` → `{ ok: true }` (photos go too unless still used; removed from outfits first, then from wishlist links and shares)
- `setDisplayImage({ itemId, display: 'catalog'|'original'|'cleaned'|'web' })` → `OwnedView`; `invalid` with the reason when that image can't be shown (`'web'` needs `photos.webId`)
- `correctMatch({ itemId, productId|null, variantId|null, custom? })` → `OwnedView` (the person's record only; evidence replaced)
- `reportCatalogIssue({ productId, variantId?, field, proposedValue, note })` → correction (`field` from `correctionFieldsFor(category)` in `ops/admin.js`)
- `checkDuplicates({ category?, productId?, variantId?, custom? })` → `{ duplicates: [OwnedView] }`

**Wishlist** (`user`)

- `listWishlist({ status?: 'active'|'purchased'|'removed'|'all' })` → `{ items: [WishlistView], counts: { active, purchased } }`
- `getWishlistItem({ itemId })` → `WishlistView`
- `createWishlist({ category, productId?, variantId?, custom?, matchPending?, reason, reasonNote?, intent?, linkedOwnedIds?, desired: { size?, condition, variantFlexible? }, targetPriceMinor?, sourceUrl?, source?: 'catalog_search'|'product_link'|'web', web?, photos?: { originalId?, webId? }, allowDuplicate?, idempotencyKey })` → `WishlistView`. `source: 'web'` follows the `createOwned` rules; the store price stays in `web.price` and is never copied into `targetPriceMinor`.
- `updateWishlist({ itemId, patch: { reason?, intent?, desired?, targetPriceMinor?, linkedOwnedIds?, reasonNote? } })` → `WishlistView`
- `removeWishlist({ itemId })` → `{ ok: true }`
- `markPurchased({ itemId, details: { size?, condition?, purchase? }, variantId?, allowDuplicate?, idempotencyKey })` → `{ owned: OwnedView, wish: WishlistView }`. The only way a wish becomes owned; the wished size is not assumed. A custom wish's `web` snapshot and `photos.webId` carry over (the owned item then displays `'web'`).

**Outfits** (`user`; others → `not_found`; stylists and admins → `forbidden`)

- `listOutfits({ itemId? })` → `{ outfits: [OutfitView], total }`, most recently changed first (an item-delete cleanup counts as a change); `itemId` keeps the outfits holding that item; `total` counts all of them
- `getOutfit({ outfitId })` → `OutfitView`
- `createOutfit({ name, itemIds, notes?, idempotencyKey })` → `OutfitView`
- `updateOutfit({ outfitId, patch: { name?, itemIds?, notes? } })` → `OutfitView`. Only the given fields are checked and changed; keeping its own name, or changing only its capitals, is allowed; saving without a change leaves the record as it was. An empty patch is `invalid` ("Choose what to change.").
- `deleteOutfit({ outfitId })` → `{ ok: true }`; the items stay
- Errors are `invalid` with `fields.name` ("Enter a name for this outfit", "Use 60 characters or fewer", "You already have an outfit with this name"), `fields.itemIds` ("Choose at least two items", "Choose up to 12 items", "Choose items from your collection") or `fields.notes`. An item id that isn't one of the person's items, whether deleted, made up or someone else's, gets one answer: `fields.itemIds` "Choose again: some of these items are no longer in your collection", with `details.missingItemIds` echoing those ids. This is a deliberate exception to `not_found`, so the form can mark the field and drop the rows; it reveals nothing, since only the caller's own ids come back and every kind of id gets the same answer. Audit rows carry counts and field names, never the name or notes; the one metric is `outfit_created { items }`.

**Recommendations** (`user`; `recommend` and `helpMeChoose` are rate-limited `recs`)

- `recommend({ mode?: 'similar'|'matching'|'alternatives'|'feed', seedIds?, seedType?: 'owned'|'wishlist'|'variant', category?, constraints?, limit? ≤ 24, text? ≤ 300, exploreColorways? })` → `RecResult` (6.1), or `FeedResult` for `feed` (the default without text). With `text`, the result adds `interpretation` (same shape as `parseRequest`) and the mode is inferred. Seeds must be the person's own (`not_found`). `alternatives` needs a wishlist or variant seed. Constraint keys: `category`, `categories`, `types`, `maxPriceMinor`, `minPriceMinor`, `priceAroundMinor`, `size`, `condition` (default `new_only`), `inStockOnly`, `includeOwned`, `includeUnknownPrice`, `anySize`, `strapWidthMm`, `caseDiameterMm`, `colors`, `avoidColors`, `styles`, `avoidStyles`, `uses`, `materials`, `brandIds`, `exploreColorways`. Unknown values are `invalid`. `unavailable` when offers are down.
- `helpMeChoose({ wishlistIds: [1..3] })` → `Comparison` (6.1)
- `giveFeedback({ productId, variantId?, type: FEEDBACK, contextItemId?, requestId?, idempotencyKey? })` → `FeedbackView { id, productId, variantId, type, contextItemId, createdAt, active, label, title, brandName, product, variant, contextItem: { id, itemType, title, brandName } | null }`
- `listFeedback({ includeInactive? })` → `[FeedbackView]`; `removeFeedback({ feedbackId })` → `{ ok: true }` (results return to what they were)
- `parseRequest({ text })` → `{ constraints, chips: [{ kind, label, value }], seedHints, unparsed, seeds: [{ hint, exact, itemId, itemType, title, brandName, subtitle, imageUrl, photoId }], unresolvedHints, seedIds, suggestedMode }`. Chip kinds: category, type, color, avoid_color, style, avoid_style, use, material, brand, price, size, condition, stock, seed. Rebuild constraints from edited chips with `constraintsFromChips(chips)` (`js/engine/parse-request.js`).

**Offers and links**

- `getOffers({ variantId, size?: Size|string, condition?: 'new_only'|'new_or_used'|OFFER_CONDITION })` (`any`) → `OffersView` (6.1). A bare size string takes the product's system; unsized products ignore it. `unavailable` ("Retailer prices could not be checked right now. Try again shortly.") when offers are down.
- `createClick({ offerId, idempotencyKey })` (`any`) → `{ clickRef, destination, tracked, retailer: { id, name, domain }, affiliate: { network, status } | null, disclosure, offerId, variantId, productId }`. Records a pseudonymous click; never marks anything purchased. `unavailable` for removed listings.
- `importFromUrl({ url })` (`user`) → `{ status: 'resolved', productId, variantId, offerId, retailerId, size, sizeNote, listingStatus, url, product, variant, retailer }` | `{ status: 'unsupported_link', host, code, reason, url }` | `{ status: 'invalid_url', code, reason }`. Resolves demo (`.example`) links against the catalog and never fetches the URL; `reason` is a sentence to show, `code` is for logic. Links to real stores go to `lookupProductPage` instead.
- `listMarketplaces({})` → `[{ id, name, connected, demo, note, searchUrlTemplate }]`; `searchMarketplaces({ query, marketplaceId? })` → `{ query, sources: [{ id, name, demo, connected, reason, searchUrl, results }] }`; `importMarketplaceLink({ url })` → `{ ok: true, link, catalogMatches, draft: { category, custom, sourceUrl, styleCodeGuess, sizeGuess, evidence } }` | `{ ok: false, reason, message, marketplace }`. A draft never carries a catalog identity; its size is a guess for the person to confirm. See `docs/marketplaces.md`.

**Web** (`user`; real stores and Bing through the local server, `ops/web.js`). Nothing here fetches by itself: `providers.web` does, and without the server every op answers `not_connected` with `reason`. Results are drafts the person confirms; metrics carry statuses and counts only.

- `webStatus({})` → `{ live: boolean, reason: string | null }`
- `lookupProductPage({ url })` (rate limit `web`, charged only for a valid link) → `{ status: 'found', page: Page, draft: WebDraft }` | `{ status: 'not_product', host, reason, page: Page | null, draft? }` (draft when the page has a name) | `{ status: 'blocked', host, reason }` (also returned for StockX and GOAT links without contacting them: their terms forbid automated access, so the screen reads the link with `importMarketplaceLink`) | `{ status: 'invalid_url', code, reason }` (checked with `validateImportUrl` first; never reaches the provider) | `{ status: 'unavailable', host?, reason }` | `{ status: 'not_connected', reason }`. Page and draft are rebuilt from the server's answer as untrusted input.
- `searchWebProducts({ query })` (rate limit `web`, charged only for a valid query) → `{ status: 'ok', engine: 'bing', query, shopping: [Listing & { draft }], results: [WebResult] }` | `{ status: 'blocked'|'unavailable'|'invalid'|'not_connected', reason }`. Fewer than 2 or more than 200 characters throws `invalid` with `fields.query`. A listing's draft has via `'search'`; a result is opened with `lookupProductPage`.
- `importWebImage({ imageUrl, pageUrl?, idempotencyKey })` (rate limit `webImage`; idempotent, only `ok` is kept) → `{ status: 'ok', photoId }` | `{ status: 'invalid_url'|'not_connected'|'blocked'|'unsupported'|'invalid'|'unavailable', reason }`. Downloads through `providers.web.fetchImage`, then `storePhoto` with kind `'web'`. Never throws for an image it can't fetch or keep, nor for its rate limit (`unavailable` with the limit's sentence): saving the item continues without it.
- Saving: `createOwned` / `createWishlist` with `source: 'web'`, `custom` from the edited draft, `web: draft.web` and `photos.webId` from `importWebImage`; from a match, `confirmMatch` with `web` and `webPhotoId`.

**Stylist**

- `listMyStylists({})` (`user`) → `[{ id, displayName, assignedAt, assignmentId }]`
- `createStylistRequest({ stylistId, itemIds, snapshot?, includePhotos?, includeNotes?, message, budgetMinor?, category?, idempotencyKey })` (`user`) → `OwnerRequestView` = request (without `snapshot`) & `{ stylist: { id, displayName }, access: 'live'|'revoked'|'ended', itemCount, recCount, snapshotTaken }`. Unassigned stylist or foreign item → `not_found`.
- `listStylistRequests({})` (`any`): user → `[OwnerRequestView]`; stylist → live requests only, `[{ id, client: { id, displayName }, createdAt, updatedAt, status, share: { snapshot, includePhotos, includeNotes }, itemCount, message, budgetMinor, category, recCount }]`
- `getStylistRequest({ requestId })` (`any`): owner → `{ request: OwnerRequestView, items: [RedactedItem], ownItems: [OwnedView], recs: [StylistRecView] }`; stylist (live access only, audited) → `{ request, items: [RedactedItem], recs }`
- `revokeStylistRequest({ requestId })` (`user`) → `OwnerRequestView`; access and issued photo URLs end at once
- `submitStylistRecs({ requestId, items: [{ productId, variantId?, note }], message, idempotencyKey })` (`stylist`) → `StylistRecView { id, requestId, createdAt, message, source: 'human', kind: 'stylist', label: 'From your stylist', stylist, items: [{ productId, variantId, note, product, variant, image }] }`
- `listStylistRecs({ requestId? })` (`user`) → `[StylistRecView]`
- `getAuditLog({ requestId? })` (`user`) → `[{ id, at, action, summary, actor: { id, displayName, role, you }, targetType, targetId, requestId, meta }]`; `summary` is a sentence to show

**Privacy** (`any`)

- `exportMyData({})` → everything stored about the actor (photos as data URLs, outfits, sessions without tokens, clicks under the analytics id), nothing about anyone else
- `deleteMyAccount({ confirm: 'DELETE' })` → `{ ok: true, reset: boolean, removed: { [store]: count } }`; signs out everywhere. Demo accounts are reset (the whole demo re-seeds) instead of removed.

**Admin** (`admin`; never returns a person's items)

- `adminOverview({})` → aggregates: `{ generatedAt, scans: { source, total, byRetrieval, byCategory, latencyMs: { p50, p95, samples } }, jobs: { total, byStatus, failed, timedOut }, feedback: { byType }, offers: { total, active, removed, freshness: { fresh, aging, stale }, freshnessHours }, clicks: { total, tracked, untracked, last7Days }, catalog: { brands, products, variants, retailers, images: { active, expired, taken_down }, byCategory }, corrections: { open }, accounts: { byRole, activeAssignments }, providers: [{ id, name, status, simulation }], evaluation: { generatedAt, synthetic, counts, overall, outOfCatalog, latencyMs } | null }`
- `adminListProducts({ q?, category? })` → `[{ id, name, brand, category, type, typeLabel, sources, variants: [{ id, name, code, msrpMinor, currency, images: [{ id, status, license, provider }], offerCount }] }]`
- `adminImportFeed({ feed: JSON string })` → `{ accepted, rejected: [{ kind, id, problems: [sentence] }], byKind, created, updated, generatedImages, featuresCleared }`. Feed `{ brands?, products, variants, images?, offers? }`; every record validated; offers only on known retailers' `.example` domains; missing costs stay unknown.
- `adminListCorrections({ status?: 'open'|'accepted'|'rejected'|'all' })` → `[{ id, status, productId, productName, brandName, variantId, variantName, field, fieldLabel, valueAtReport, currentValue, proposedValue, note, reporter: 'p-xxxxxxx', createdAt, reviewedBy, reviewedAt, applied }]`
- `adminResolveCorrection({ correctionId, decision: 'accepted'|'rejected' })` → same view; accepted facts are applied and audited
- `adminListImages({ status?, variantId? })` / `adminSetImageStatus({ imageId, status })` → `[image & { variantName, productName, brandName, inCollections: { ok, reason }, onProductPages: { ok, reason } }]`
- `adminListOffers({ variantId?, freshness?, retailerId? })` → `[{ id, retailer, listingId, variantId, variantName, productName, brandName, condition, sellerType, listingStatus, price: { fromMinor, toMinor, currency }, sized, lastCheckedAt, freshness, refreshedByAdmin, url }]`; `adminRefreshOffer({ offerId })` → one of those
- `adminListJobs({ status? })` → `{ jobs: [{ id, status, category, attempts, latencyMs, errorCode, createdAt, person: 'p-xxxxxxx' }], byStatus }`; `adminRetryJob({ jobId })` → one job view
- `adminGetProviders({})` / `adminSetProviderSimulation({ vision?, offers?, ocr? })` → `{ simulation, providers: [{ id, name, detail, status: 'normal'|'simulated'|'demo'|'connected'|'not_connected', simulation, options }] }`. The `web` entry ("Real store lookup") is read-only: `connected` when the local server answers, `simulation: null`, no options; the `simulation` object has no web key.
- `adminGetWeights({})` / `adminSetWeights({ weights?: { key: number }, reset? })` → `{ weights, defaults, ranges: { key: { min, max, step, label, help } }, custom }`. Ranges and labels come from `WEIGHT_RANGES` in `engine/recommend.js`; stored under config `rankingWeights`.
- `adminListAccounts({})` → `{ accounts: [{ id, displayName, role, demo, createdAt }], assignments: [AssignmentView] }`; `adminAssignStylist({ stylistId, userId })` / `adminEndAssignment({ assignmentId })` → `AssignmentView { id, stylistId, stylistName, userId, userName, assignedBy, assignedByName, createdAt, endedAt, active }`. Ending revokes the stylist's photo URLs and closes the person's requests to them.
- `adminListClicks({ limit? })` → `{ clicks: [{ id, clickRef, analyticsId, offerId, retailerId, retailerName, networkId, destination, tracked, createdAt }], summary: { total, tracked, untracked, byRetailer } }`
- `adminConversions({})` / `adminLoadDemoConversions({ seed? })` → `{ connected, network, report, summary, demo }`. Without a network: `report: null` and `summary.revenue: null` (unknown, never zero). Demo events appear only under `demo: { label: 'Demo data', note, eventCount, events, report, summary }`.
- `adminSaveEvalReport({ report })` → `{ ok, savedAt }` (synthetic reports only); `adminGetEvalReport({})` → `EvalReport | null`

## 6. Engines (`js/engine/`)

| Module | Exports |
| --- | --- |
| `features.js` | `extractFeatures(imageData, { category }) -> Features`, `analyzeImage` (with mask, for clean-up and debugging), `referenceBackdrop(hexes)`, `paletteDistance`, `paletteTransport`, `gridDistance`, `mirrorGrid`, `resampleGrid`, `labFromHex`, `deltaE`, `FEATURE_CONFIG`, `FEATURES_VERSION`, `ANALYSIS_SIZE` (256), `STUDIO_HEX`, `STUDIO_TONES` |
| `matcher.js` | `buildIndex(catalog, refFeatures)`, `match(index, query, opts) -> MatchResult`, `visualDistance`, `findIdentifiers`, `findBrands`, `isValidGtin`, `normalizeText`, `codeSkeleton`, `MATCH_CONFIG` (every threshold), `ASK_FOR_VARIANT` |
| `image.js` (browser) | `decodeImage(blob, { mime })`, `cropAndRotate(source, crop, { maxEdge })`, `drawScaled`, `toImageData`, `reencode(source, { maxEdge, quality }) -> { blob, width, height }`, `removeBackground(blob) -> { blob, width, height }`, `makeCanvas`, `canvasToBlob`, `MIN_EDGE`, `ORIGINAL_EDGE`, `PROCESSING_EDGE`, `HEIC_UNSUPPORTED` |
| `samples.js` (browser) | `listSamples(catalog?) -> [Sample]`, `renderSample(id, { catalog?, seed? }) -> Blob`, `renderLabel({ variantId, catalog?, seed? }) -> Blob`, `stagePhoto(spec, opts) -> Blob`, `SURFACES` |
| `ocr.js` (browser) | `readText(blob) -> { text, confidence, barcodes }`, `ocrLoaded()`, `TESSERACT_VERSION` |
| `reference.js` (browser) | `computeReferenceFeatures(catalog, { variantIds?, onProgress? })`, `referenceImageData`, `rasterizeSvg` |
| `eval.js` (browser) | `runEvaluation({ seed?, count?, outOfCatalog?, catalog?, onProgress? }) -> EvalReport` |
| `recommend.js` | `recommend(input) -> RecResult`, `feed(input) -> FeedResult`, `helpMeChoose(input) -> Comparison`, `strapFit`, `slotOf`, `MODES`, `DEFAULT_WEIGHTS`, `WEIGHT_RANGES`, `validateWeights`, `normalizeWeights`, `USE_STYLES` |
| `harmony.js` | `harmony(a, b)`, `paletteHarmony`, `harmonyScore`, `colorCloseness`, `paletteSimilarity`, `roleSimilarity`, `HARMONY_KINDS`, `COLOR_GROUPS`, `PAIRING_THRESHOLD` |
| `explain.js` | `explain({ relations, price, now, ceiling, budget, preferences }) -> string`, `relationDetail(rel)`, `itemDetail(relations)`, `colorPhrase`, `tagPhrase`, `typeWord` |
| `parse-request.js` | `parseRequest(text, vocab?) -> { constraints, chips, seedHints, unparsed }`, `constraintsFromChips(chips)`, `resolveSeedHints(hints, items, { catalog, vocab })` |
| `offers.js` | `compareOffers(input) -> OffersView`, `summarizeOffers(input)`, `offerTotal`, `orderRows`, `freshness`, `conditionAllowed`, `sizeEntry`, `AFFILIATE_DISCLOSURE`, `FRESH_HOURS` |
| `affiliate.js` | `buildOutboundUrl({ offer, retailer, clickRef }) -> { url, tracked, network }`, `newClickRef()`, `SUB_ID_PARAMS` |
| `conversions.js` | `reconcileConversions(events) -> report`, `summarize({ clicks, report }) -> summary`, `demoConversionEvents(clicks, { seed, now, catalog })`, `CONVERSION_STATUSES` |
| `duplicates.js` | `findDuplicates(items, candidate) -> items[]` |
| `provenance.js` | `resolveDisplayImage(item, catalog, now, catalogUrl) -> DisplayImage` (including `'web'`, 5.2), `catalogImageFor`, `imagePermitted` |
| `web-guess.js` | `draftFromWeb({ page?, listing?, result?, query?, via, now, category? }) -> WebDraft \| null`, `guessCategory(text)`, `guessType(category, text)`, `guessColors(text)` (only `COLORS` names, max 4), `guessBrand({ title, brand, host })`. Guesses from words only; never a size, condition or catalog id |

Server-side glue that other code reuses: `analyzeAndMatch({ providers, index, blob, crop?, category?, texts?, productUrl?, link?, simulation? })` in `ops/matching.js` is the one analysis path for match jobs and the evaluation.

### 6.1 Engine data contracts

These shapes cross module boundaries. Producers emit exactly these fields; consumers must not
depend on anything else.

```js
Features {                         // engine/features.js, from pixels (photo or reference render)
  v: 1, category: CATEGORY | null,
  width, height,                   // of the analyzed (cropped, downscaled) image
  fgRatio,                         // foreground pixel share 0..1; 0 = no item separated
  bbox: { x, y, w, h },            // foreground box, normalized 0..1
  aspect,                          // item width / height in its upright frame
  palette: [{ lab: [L,a,b], hex, weight, name }],   // up to 6 clusters, weights sum to 1
  grid: { cols, rows, cells: [[L,a,b] | null] },     // mean Lab per cell inside the item
  stats: { brightness, colorfulness, edgeDensity }
}

MatchQuery {                       // engine/matcher.js match(index, query, opts)
  features: Features, category: CATEGORY,
  texts: [{ text, source: 'ocr' | 'barcode' | 'user_entered' }],
  productUrl: string | null
}
// opts: { link: matchJob.link } (a resolved product link counts as evidence).
// match() abstains (`no_match`) rather than return a confident wrong product, says
// `similar_result` when only lookalikes are found, and claims a product only when the colors
// and the layout both agree (MATCH_CONFIG.thresholds.layout). Identifiers decide versions.

RecItem {                          // engine/recommend.js
  key, productId, variantId,
  kind: 'similar' | 'complementary' | 'wishlist_alternative' | 'potential_duplicate' | 'stylist',
  product: ProductSummary,
  variant: VariantView,            // has image.url
  related: [{ itemId, itemType: 'owned' | 'wishlist', title, brandName, imageUrl, photoId,
              relation: 'color_pairing' | 'style_match' | 'same_shape' | 'cheaper_alternative'
                      | 'near_duplicate' | 'strap_fit' | 'wishlist_seed',
              detail }],           // detail is one plain sentence about this pair
  explanation: string,             // built only from `related`, price and constraint facts
  price: { status: 'known' | 'stale' | 'unknown', fromMinor: number | null, currency,
           offerCount, checkedAt, retailerName },   // unknown: fromMinor null, never 0
  availability: 'in_stock_in_size' | 'in_stock' | 'size_unavailable' | 'out_of_stock' | 'no_offers',
  size: Size | null,               // the size prices were checked in (request, wish or profile)
  flags: { owned: boolean, onWishlist: boolean },
  score: number                    // internal; never shown
}
// Cold-start picks use kind 'similar'. A version the person owns, shown because of
// includeOwned, has kind 'potential_duplicate'. Lookalikes of owned items are
// 'potential_duplicate' and say what differs.

RecResult {
  requestId, mode, generatedAt,
  applied: { hard: [{ kind, label }], soft: [{ kind, label }] },   // show the labels
  items: [RecItem],
  excluded: { owned, overBudget, priceUnknown, sizeUnavailable, dismissed, incompatible, nearDuplicates },
  relaxations: [{ kind: 'raise_budget' | 'any_size' | 'include_used' | 'any_category'
                  | 'include_unknown_price', label, constraints /* patch: null removes a key */,
                  wouldReturn /* exact count after applying it */ }],
  emptyReason: string | null,
  interpretation?: ParseResult     // only when `text` was given (see parseRequest, 5.4)
}

FeedResult {                       // recommend({ mode: 'feed' })
  requestId, generatedAt, coldStart: boolean,
  sections: [{ id, title, description, mode, seedIds, items: [RecItem], emptyReason, relaxations }]
}
// Section ids: 'goes-with-collection', 'alternatives-<wishId>', 'straps-<ownedId>',
// 'similar-<ownedId>', and for a new account 'picks-<category>' (from the survey alone).

Comparison {                       // helpMeChoose: up to 3 wishlist items, same facts for each
  items: [{ wishId, view: WishlistView, price: RecItem.price, availability, size,
            budget: { targetMinor, status: 'within' | 'over' | 'unknown', differenceMinor },
                                   // differenceMinor is >= 0; status gives the direction
            pairsWith: [related], similarOwned: [related], notes: [string] }],
  summary: [string]                // grounded sentences; no scores, no winner
}

OffersView {                       // engine/offers.js compareOffers (details: docs/affiliate.md)
  variantId, size: Size | null, condition: 'new_only' | 'new_or_used' | OFFER_CONDITION,
  generatedAt, retailersChecked: number,  // retailers with any listing for this version
  needsSize: boolean,              // sized product and no size chosen: rows show "from" prices
  sizeOptions: [{ size: Size, offerCount, inStock: boolean }],   // drive the size picker
  freshnessHours: number,
  rows: [OfferRow],                // comparable offers, ordered by benefit to the person,
                                   // never by commission: in stock, fresh, known total, delivery
  otherSizes: [{ size: Size, offerCount, inStock: true }],   // only when the chosen size has none
  hiddenByCondition: number,
  unavailable: [OfferRow],         // removed listings, out of stock in this size (row.reason)
  lowest: { offerId, label } | null,   // only when totals are complete enough to compare
  lowestNote: string | null,       // why there is no lowest-total claim
  disclosure: string,              // affiliate disclosure and coverage; always show it
  notice: string | null
}

OfferRow {
  offerId, retailer: { id, name, domain, kind }, affiliate: boolean,
  sellerType, condition, includedComponents: [string] | null,
  size: Size | null, stock: 'in_stock' | 'low_stock' | 'out_of_stock' | null,  // null: not stated
  priceMinor, currency, shipping, fees, tax,          // as in the offer record
  totalKnownMinor: number | null, preTaxMinor: number | null, totalComplete: boolean,
  totalLabel: string,              // 'Total' | 'Total before tax' | 'Total before shipping and tax' ...
  missing: ['price' | 'shipping' | 'fees' | 'tax'],
  delivery, returns, warranty,     // warranty { kind: 'unknown', claimed: 'manufacturer' } when a
  warrantyNote: string | null,     // non-authorized seller claims a manufacturer warranty
  lastCheckedAt, freshness: 'fresh' | 'aging' | 'stale',
  listingStatus, url, reason: string | null      // reason is set on unavailable rows
}

Sample {                           // engine/samples.js listSamples()
  id, title, shows /* what the sample demonstrates */, category, variantId: string | null,
  inCatalog: boolean, sample: true
}

EvalReport {                       // engine/eval.js, synthetic benchmark
  generatedAt, seed, synthetic: true, catalogVersion, illustrationVersion, matcherVersion,
  counts: { inCatalog, outOfCatalog },
  overall: { top1, top3, exactVariant, variantErrors, variantAmbiguous, abstainedInCatalog },
                                   // shares of counts.inCatalog, 0..1 rounded to 3 places
  byCategory: { sneaker: { count, top1, ... }, watch: {...}, clothing: {...} },
  outOfCatalog: { count, abstained, falseAccepts, similarShown },   // shares of count
  confusions: [{ pair, count }],   // wrong versions settled without ambiguity
  photos: [{ variantId | null, retrieval, leadProductId, leadKind, leadVariantId, variantAmbiguous }],
  latencyMs: { p50, p95 },
  notes: [string]                  // what the numbers do and don't mean; show them
}
```

## 7. Screens and UI

### 7.1 Routes and screen modules

Routes (hash based, `#/path?query`):

| Route | Screen | Tab |
| --- | --- | --- |
| `/welcome` | sign in, sign up, demo accounts | none |
| `/onboarding` | preference survey (cold start) | none |
| `/discover` | recommendation feed and request box | Discover |
| `/recs` | results for `?mode=similar|matching|alternatives&seed=...` | Discover |
| `/collection` | owned grid with filters | Collection |
| `/collection/:id` | item detail | Collection |
| `/collection/:id/edit` | edit item | Collection |
| `/outfits` | outfits made from the collection (Items / Outfits switch) | Collection |
| `/outfits/new` | build an outfit `?item=<ownedItem id>` preselects one | Collection |
| `/outfits/:id` | outfit detail | Collection |
| `/outfits/:id/edit` | edit an outfit | Collection |
| `/wishlist` | wishlist | Wishlist |
| `/wishlist/:id` | wishlist item | Wishlist |
| `/wishlist/compare` | help me choose `?ids=a,b,c` | Wishlist |
| `/add` | add-item chooser `?dest=owned|wishlist` | none |
| `/add/photo` | capture or upload, crop, or try a sample | none |
| `/add/link` | product link entry (demo links and real store links) | none |
| `/add/web` | search online stores `?dest=owned|wishlist` | none |
| `/add/search` | catalog search | none |
| `/add/manual` | manual entry | none |
| `/match/:jobId` | progress, candidates, confirmation | none |
| `/product/:id` | product detail, variants, offers `?variant=&size=&condition=` | Discover |
| `/go/:offerId` | affiliate redirect interstitial | none |
| `/profile` | profile hub | Profile |
| `/profile/preferences`, `/profile/feedback`, `/profile/privacy`, `/profile/stylist` | | Profile |
| `/stylist`, `/stylist/request/:id` | stylist workspace (stylist role) | none |
| `/admin`, `/admin/:section` | admin (admin role) | none |

Screen module contract (`js/screens/*.js` default-export an array of routes; `screens/index.js`
lists the modules, static segments before parameters):

```js
export default [{
  path: '/collection/:id',
  title: 'Item',                        // document title; may be a function of ctx
  tab: 'collection' | 'discover' | 'wishlist' | 'profile' | null,
  roles: ['user'],                      // omit for public screens
  async render(ctx) { return html`...`; },   // no DOM access; may call ctx.api
  mount(root, ctx) { return () => {}; }      // attach listeners; return cleanup
}];
```

`ctx = { params, query, session, api, navigate(path, opts), refresh(), back(fallback),
on(type, selector, handler) }`. `ctx.on` delegates from the screen root and is removed on
navigation. After `mount`, the router hydrates `<img data-photo-id>` elements
(`js/ui/hydrate.js` calls `getPhotoUrl`). Shared building blocks: `js/ui/components.js`
(`itemTile`, `productTile`, `label`, `identityStamps`, `recCard`, `offerCard`,
`affiliateDisclosure`, `evidenceList`, `notice`, `emptyState`, `errorState`, `loadingState`,
form fields), `js/ui/item-forms.js` (size fields, owned details, wish fields, duplicate dialog),
`js/ui/web-product.js` (`webResultLists`, `openWebSheet`, `webSaveForm`, `saveWebDraft`,
`keepStoreImage`, `lookupFallback`, `loadStorePage`, `webSnapshot`, `seenParts`),
`js/ui/catalog-picker.js`, `js/lib/ui.js` (`toast`, `openSheet`, `confirmDialog`, `withBusy`,
`formData`, `showFieldErrors`, `toastError`, `downloadBlob`). `dev/components.html` shows them.
A sheet belongs to the screen that opened it: a route change (Back, a link) dismisses it as if
cancelled, so it can't act on a page the person has left. Sheets that navigate close themselves
first, so their result is kept. Route parameters with a broken `%` escape are passed through
as typed instead of throwing.

### 7.2 Design system

Tokens in `css/tokens.css`, classes in `css/components.css`:

- Subject: shoebox end-labels, hang tags and watch references. Every product wears a
  **label strip** under its image: brand, model, variant, and the code (style code, reference,
  size) set in condensed Archivo. Owned items have a solid ink label; wishlist items a dashed
  orange outline (wanted, not yet yours); suggestions a plain label.
- Identity shows as a stamp on the label: "Confirmed by you", "Code matched", "Colorway
  unsure", "Custom item", "Needs review".
- Images sit on a neutral studio tile (`--studio`). Catalog images carry a small
  "Catalog image" tag and store images "Image from {host}", so neither is mistaken for a photo
  of the person's own item.
- One accent (signal orange) marks wishlist and desire. Ink (indigo) carries text and primary
  actions. Everything else stays quiet: no gradients, no decorative shadows, no all-caps.
- Archivo variable: wide and heavy for screen titles, regular for body, condensed for codes,
  sizes and prices (tabular numbers).
- Mobile first: 16px gutters, bottom tab bar with a center Add action, 44px touch targets.
  From 900px the tabs move into a top bar.
- Accessibility: visible focus ring, labeled controls, `aria-live` for progress, dialogs
  trap focus, reduced motion respected, AA contrast in both themes.

### 7.3 What each screen calls and must show

- **Welcome / onboarding.** `listDemoAccounts`, `signInDemo`, `signUp`, `signIn`, then
  `setSession(result)`; `completeOnboarding` for the survey. Send a person whose profile has
  `onboardedAt: null` to onboarding (the router doesn't do it yet). With nothing owned, the feed
  returns `coldStart: true` with `picks-*` sections built from the survey.
- **Add photo** (`/add/photo`). Pick or capture a file, or a sample (`listSamples()` /
  `renderSample(id)`, labeled "Sample photo"), crop in the browser (normalized crop and
  rotation), `uploadPhoto` then `createMatchJob` and go to `/match/:jobId`. Show upload errors'
  messages as they are (HEIC, too small, too large, wrong type).
- **Match** (`/match/:jobId`). Poll `getMatchJob`. While running, show `progress.stage`
  ('indexing' has `done`/`total`: the first scan renders reference images). On `done`:
  - `candidate_found`: candidates with `kind: 'match'` first; strength in words; evidence and
    conflicts in plain sentences (`evidenceList`); `variantOptions` with their notes as the
    version picker; when `variantAmbiguous`, ask before saving and offer `askFor` actions
    (type a code, add a label photo with `uploadPhoto({ kind: 'label' })` +
    `addMatchEvidence`, paste a link). `renderLabel({ variantId })` makes a sample label.
  - `similar_result`: say none is a confident match; show candidates as similar products;
    choosing one is explicit and its identity says so.
  - `no_match`: say so; offer `askFor`, catalog search and "Save as my own item" (custom).
  - Always show `result.notes` and failed `labelReads[].message`.
  - `error` / `timeout`: show `error.message`; `retryMatchJob` when `canRetry`.
  - Confirm with `confirmMatch` (one idempotency key per confirm sequence); handle `duplicate`
    with `duplicateDialog` and `allowDuplicate`. "Not mine" is `rejectMatch`.
  - On `done`, `rejected`, `error` and `timeout`: an "Online stores" panel. Its "Search online stores"
    button carries the line "Sends this photo to Microsoft Bing to recognize it. Rotation's
    server doesn't keep it." and calls `searchWebForPhoto`; nothing is sent before the tap.
    Show "Bing recognized this as: {query}", `job.web.reason` for other statuses, and the result
    lists. A listing opens the save form from its `draft`; a store page runs
    `lookupProductPage` first. Saving uses `importWebImage` (when "Save the store's image with
    it" is checked) and then `confirmMatch` with `custom`, `web` and `webPhotoId`, so the job is
    marked saved and the person's photo stays the item's photo. Reloading shows the last
    `job.web` without searching again.
- **Collection / item.** `listOwned` facets drive filter chips; tiles use `itemTile` and the
  label strip. Item detail shows identity stamps and evidence, `image.label`, the display
  switch from `image.options` (`setDisplayImage`; `'web'` is "Store image"),
  `image.fallbackReason` when the catalog image can't be shown, `cleanupPhoto`, `correctMatch`,
  `reportCatalogIssue`, archive, delete, and "Find similar" / "Find matching" links to `/recs`.
  When `item.web` exists (collection and wishlist), `webSnapshot(item.web)` shows "Seen at
  {site} for {price}", "checked {relative time}" and a plain "View on {host}" link
  (`target="_blank" rel="noopener noreferrer"`, not an affiliate link). An "Outfits" section
  lists `listOutfits({ itemId })` and links to `/outfits/new?item=` (not for archived items);
  the delete confirmation says how many outfits the item is taken out of. "Your details" starts
  with a Category row. An id that isn't the person's (deleted, never theirs) renders "This item
  isn't here" with a link back to the collection on both the item page and its edit screen,
  not the error state. The edit screen's Cancel is `data-back`; after Save it goes back in
  history when it was opened from the item page (`[data-edit-item]`), else replaces itself with
  the item page, so one Back press leaves. Save sends only the custom fields (brand, name,
  color or version) that changed, so an older tab doesn't undo them; details are sent whole.
  The manual add form's category and I own it / I want it pills carry the typed brand, name
  and color into the new form.
- **Outfits.** `/collection` and `/outfits` share an Items / Outfits switch
  (`collectionTabs`, the `.tabs` link row with `aria-current="page"`). The list shows cards
  with up to four thumbnails, "Needs another item" for incomplete outfits, and empty states for
  "No outfits yet" and for fewer than two active items ("Add a few items first", no form). The
  form has a name (`maxlength` 60), items grouped clothing, sneakers, watches as `.choice`
  checkboxes in a `fieldset.field` (the item error sits under its hint), a filter box from 7
  items (hidden choices stay chosen; Enter there doesn't submit), a live "chosen" count, and
  a 13th pick is refused with a toast. New outfits offer active items; edits also list archived
  items already in the outfit, and send only the fields that changed (so a rename works on an
  incomplete outfit and doesn't overwrite another tab's item changes). Save on edit goes back to
  the outfit page when a plain click on its Edit link opened the form, else replaces the form
  with the outfit page (Back, Forward or a bookmark); Cancel is a back link. After a refused
  save the first error is scrolled to the middle of the screen (focus alone can leave it under
  the sticky header), and focus stays in the item list when the filter hides the first item. `details.missingItemIds` rows are removed from the form. Detail and edit catch
  `not_found` and show "Outfit not found" in the screen, without a console error. Delete uses
  `confirmDialog` ("The items in it stay in your collection.").
- **Discover / recs.** `recommend({ mode: 'feed' })`; the request box calls `recommend` with
  `text` and shows `interpretation.chips` (editable; rebuild with `constraintsFromChips`),
  `applied.hard`/`soft` labels, `emptyReason`, and one button per relaxation that merges its
  `constraints` patch (`null` removes a key) and re-requests; the button can say how many
  results it brings back (`wouldReturn`). Cards use `recCard`; feedback buttons call
  `giveFeedback` with the `requestId`. Never show `score`.
- **Wishlist / compare.** `listWishlist`, `updateWishlist`, `removeWishlist`, `markPurchased`
  (the only way to "I bought it"); compare is `helpMeChoose` with its `summary` sentences.
- **Product** (`/product/:id`). `getProduct`, then `getOffers` for the chosen version. Drive
  the size picker from `needsSize` and `sizeOptions`; show `rows` with `offerCard` (pass
  `lowestLabel: view.lowest.label`), `unavailable` rows with their `reason`, `otherSizes`,
  `hiddenByCondition`, `notice`, `lowestNote` and always `disclosure`. A version's image may be
  missing (`variant.image.unavailableReason`).
- **Go** (`/go/:offerId`). `createClick({ offerId, idempotencyKey })` with one key per
  interstitial (reuse it on retry); show `disclosure` and the destination host; open
  `destination` with `rel="noopener noreferrer"`. A removed listing is `unavailable`. Nothing is
  marked purchased.
- **Add chooser** (`/add`). Take a photo, Search online stores (`/add/web`), Paste a product
  link ("From any store's product page."), Search the demo catalog, Enter it yourself.
- **Add link** (`/add/link`). Demo `.example` links resolve with `importFromUrl` (show
  `reason`, never `code`; prefill size from `size` and show `sizeNote`; store `url` as
  `sourceUrl`). Any other link calls `lookupProductPage`. On `found`: the save form with the
  store image (hot-linked, no referrer), name, store, "Seen at {site} for {price}, checked just
  now", availability, editable category, type, brand, name, color and main colors, the
  destination's fields, and "Save the store's image with it" (checked when there is an image).
  Save is `importWebImage` (if checked; a failure saves without it and says so) then
  `createOwned` / `createWishlist` with `source: 'web'`. On `blocked`, `not_product`,
  `unavailable` or `not_connected`: `importMarketplaceLink` for StockX/GOAT links (the link-text
  draft), else the `reason` with "Enter it yourself" prefilled from what is known and, for a
  blocked or non-product page, "Open the page".
- **Search online stores** (`/add/web`). `webStatus` decides whether the not-connected notice
  shows. `searchWebProducts`; "Store listings" (thumbnail, title, price, seller) and "Store
  pages" (title, host, snippet) from `webResultLists`. A listing opens the save form from its
  `draft`; a store page runs `lookupProductPage` and then the save form (or the fallback above).
- **Catalog search / manual.** `searchMarketplaces` and `importMarketplaceLink` for StockX/GOAT
  links, `searchCatalog` with `catalog-picker.js`, `createOwned` / `createWishlist`.
- **Profile.** `getProfile`/`updateProfile`, `listFeedback`/`removeFeedback`, privacy
  (`exportMyData` → `downloadBlob`, `deleteMyAccount` with typed `DELETE`), stylist sharing
  (`listMyStylists`, `createStylistRequest`, `listStylistRequests`, `revokeStylistRequest`,
  `listStylistRecs`, `getAuditLog` summaries).
- **Stylist workspace.** `listStylistRequests`, `getStylistRequest` (redacted items only),
  `submitStylistRecs` with `searchCatalog`. Suggestions are labeled human everywhere.
- **Admin.** One section per group in 5.4. Weights editor from `ranges` (labels and help
  text included); conversions show `summary` (revenue unknown without a network) and demo data
  only under its "Demo data" label; evaluation can run `runEvaluation()` in the page and save it
  with `adminSaveEvalReport`.

## 8. Tests

- `npm test` runs `node --test tests/unit/*.test.mjs` (in-memory db, fixed clock, test
  providers; `tests/helpers.mjs` has `createTestEnv`, `rejectsWith`, `waitForJob`,
  `fakeJpeg`). Files:
  - `foundation`: html escaping, safe URLs, db cloning, attribute rules, roles, accounts,
    sessions, profile validation, catalog search, the seed, display-image fallback, redaction.
  - `integration`: the core journey across modules, plus another person, an unassigned stylist
    and the admin seeing none of it.
  - `access`: stylist grants, redaction, snapshots, revocation, ended assignments, export,
    deletion, accounts, catalog reads.
  - `admin`: roles, weights, provider simulation, job retry, clicks vs revenue, feed import,
    corrections, image status, offer freshness.
  - `inventory`, `matching`, `recs`, `commerce`, `marketplaces`: each module's own rules.
  - `outfits`: create, list, read, update and delete; name, item and notes limits; duplicate
    names (case, spacing, NFKC, invisible characters); idempotent saves; another person's
    items and outfits; archived items; the item-delete cascade and dangling ids; stylists,
    admins and logs never seeing outfit text; export, account deletion and demo reset.
  - `web`: `web-guess.js`, `cleanWebSnapshot`, `money()` digits, the web ops with a scripted
    provider (found, blocked, not connected, invalid links, rate limits, another person's job,
    a running job), saving with `source: 'web'` (manual identity, evidence, `sourceUrl`,
    display `'web'`, `photos.webId`), `confirmMatch` with `web`, `markPurchased`, and delete,
    export and stylist redaction of store images.
  - `backend-net`, `backend-extract`, `backend-bing`, `backend-server`: the backend on
    synthetic pages through a fake transport: SSRF refusals (private and metadata addresses,
    private DNS answers, redirects), block detection and cooldowns, spacing, caching and
    in-flight sharing, byte and type limits, the extractor's precedence and money rules, the
    Bing parsers (free listings only), the static allowlist and traversal, `status.json`, and
    the `POST` / `X-Rotation` / `Host` / `Origin` / `Sec-Fetch-Site` checks.
- The unit tests never use the network: the browser `web` provider is replaced by
  `notConnectedWeb` or `fakeWebProvider`, and backend tests use a fake transport.
- `tests/fixtures/scenes.mjs` draws product-like scenes (studio references and photo-like
  scenes) so the real feature extractor and matcher run in Node.
- `tests/fixtures/web/upstream.mjs` exports `fixtureUpstream()`: a real `createUpstream()`
  whose transport answers made-up store pages, images and Bing endpoints from memory (hosts under
  `.fixture.alt`, resolving to a fake public address; the full list is in its header). URL
  checks, redirects, block detection and caching run as they do live. No real store or Bing
  page is copied into the repo.
- `npm run test:e2e` runs `tests/e2e/run.mjs`: `smoke.mjs` (every route as each role, no console
  errors or failed requests) and `photo.mjs` (every sample photo through upload, on-device
  analysis and matching with expected outcomes, then a confirm with a typed reference, clean-up
  and display switch), then `web.mjs`: `startAppServer({ port: 0, upstream: fixtureUpstream() })`
  in a 360 px Chromium, driving a pasted store link, an online store search and a photo search
  to saved items (the photo flow keeps the person's photo), a store that blocks, a StockX link
  falling back to its link text, and the not-connected state on the static server. It fails on
  any request that would leave the machine, and checks nothing reaches `/api/lens` before the
  tap. `-- --ocr` also reads a label photo with Tesseract.js (needs a connection to jsDelivr;
  the only test that uses the network). `inventory.mjs` signs up new accounts and drives the
  closet inventory's eight D08 checks through the screens at 390 px (light) with reloads: the
  empty state, adding by hand, the Category row, editing without a duplicate, blank names,
  cancelled edits and deletes, deleting one item only, and one press of Back after Save or
  Cancel. It adds two break tests per action (an invisible name, a category change after
  typing, a missing item's address, a long HTML name, a refused edit, two tabs, Back after a
  delete, two identical copies) and a desktop dark-theme pass. `outfits.mjs` drives outfit
  create, read, update and delete through the screens at 390 px (light) with reloads, the D08
  break tests (empty and
  duplicate saves, double taps, HTML and 60-character names, another person's address, a
  signed-out bookmark, a broken `%` escape, two tabs, archived and deleted items, a big closet,
  Back with a dialog open, keyboard only), export and demo reset, a desktop dark-theme pass and
  a version 1 database upgrading to 2; it fails on clipped content as well as page scroll, and
  on any request that would leave the machine. Helpers for new browser tests: `tests/e2e/helpers.mjs`
  (`openApp`, `signInAs`, `go`, `callApi`, `hasHorizontalScroll`).
- `npm run eval` runs the synthetic evaluation in headless Chromium and writes
  `docs/evaluation.md`.
- Matching thresholds are tuned on synthetic scenes only. Before changing `MATCH_CONFIG` or
  `FEATURE_CONFIG`, run `npm test`, `npm run test:e2e` and `npm run eval` and compare.
