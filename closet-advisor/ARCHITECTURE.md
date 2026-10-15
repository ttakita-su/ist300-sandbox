# Rotation prototype architecture

Rotation (working name) is the prototype of the AI closet and shopping advisor brief. This
document is the contract every module is written against, and it describes what is built, not
what was planned. Read **Conventions** and **Data model** first, then the section for the module
you are working on. Screen builders: section 5.4 lists every operation with its arguments and
result, and section 7.3 says what each screen calls and which states it must show.

## 1. What the prototype is

A mobile-first web app with no build step, served as static files (GitHub Pages serves it at
`/closet-advisor/`). It runs the whole product journey in the browser:

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

What is demo:

- The catalog, brands, retailers, offers and prices are **fictional** and labeled as demo
  everywhere they appear. Retailer domains use the reserved `.example` TLD, so no link leaves
  for a real store. GTINs use the GS1 restricted-circulation prefix 2, so they can never collide
  with a real product.
- The "server" is a module layer running in the same browser tab, storing data in IndexedDB.
  It mirrors the boundary a Next.js + Supabase build would have (see `docs/PLAN.md`,
  `docs/providers.md` and `supabase/README.md`), but it is not a security boundary: anyone can
  open devtools.
- Catalog images are SVG illustrations generated from each variant's palette, so the prototype
  owns every image it displays.
- Sample photos (`js/engine/samples.js`) are catalog illustrations staged like phone photos, so
  the photo flow can be tried without the fictional products. Screens must label them as samples.

## 2. Layout

```
closet-advisor/
  index.html              app shell; loads css/*.css and js/app.js as a module
  manifest.webmanifest    PWA manifest
  sw.js                   service worker (app shell, stale-while-revalidate; no cross-origin)
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
    ui/                   components.js (shared views), item-forms.js, catalog-picker.js, hydrate.js
    data/                 schema.js, colors.js, catalog.js, retailers.js, illustrations.js,
                          catalog-index.js
    engine/               features, matcher, recommend, harmony, explain, parse-request, offers,
                          affiliate, conversions, duplicates, provenance (pure);
                          image, samples, ocr, reference, eval (browser)
    server/               errors.js, db.js, auth.js, policy.js, records.js, views.js, api.js,
                          catalog-repo.js, seed.js, urlsafety.js, validate-image.js,
                          marketplaces.js, ops/*.js, providers/*.js
    screens/              one file per screen group; index.js lists them (Phase 2)
  dev/                    gallery.html (every illustration), components.html (component sheet)
  tests/
    unit/*.test.mjs       `npm test` (node --test, no dependencies)
    fixtures/scenes.mjs   synthetic product scenes for Node feature and matching tests
    e2e/*.mjs             Playwright (devDependency) against tests/serve.mjs
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
- No runtime dependencies except Tesseract.js 7.0.0, which `js/engine/ocr.js` loads lazily from
  jsDelivr (worker, engine and English data too) only when a label photo is read. Everything
  works without it.

## 3. Conventions

- Vanilla ES modules, `.js` extension on every import. No TypeScript, no bundler.
- JSDoc types on exported functions. Comments explain why, not what; match the existing
  density (a short comment above a non-obvious block).
- Rendering uses the `html` tagged template from `js/lib/html.js`. It escapes every
  interpolated value. Use `raw()` only for markup produced by `html` or trusted generators
  (`icons.js`, `illustrations.js`). Never build markup by string concatenation of user data.
- URLs placed in `href`/`src` go through `safeUrl()` (allows `http:`, `https:`, `blob:`,
  `data:image/`, relative and hash URLs).
- Money is an integer number of minor units plus an ISO currency (`{ amountMinor, currency }`
  or `priceMinor` + `currency`). Never floats for money. Format with `format.money()`.
- Times are ISO strings in records; the server takes `ctx.now()` (ms) so tests can fix time.
  UI shows relative times with `format.relative()`.
- Unknown is `null`, never `0` or `''`. A missing shipping cost is `{ kind: 'unknown' }`.
- Sizes always carry their system: `{ value: '10', system: 'US-M' }`. One-size products use
  `{ value: 'OS', system: 'ONE-SIZE' }`. Size systems are never converted into each other.
- IDs: catalog ids are stable slugs; user records use `newId(prefix)` from `js/lib/ids.js`
  (`own_`, `wish_`, `pho_`, `job_`, `rec_`, `fb_`, `req_`, `srec_`, `clk_`, `cor_`, `aud_`).
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

photo    { id, userId, kind: 'original' | 'processing' | 'cleaned' | 'label',
           blob: Blob, mime, width: number|null, height: number|null, bytes, createdAt,
           processingId: string|null,   // original/label row -> its processing copy
           sourceId: string|null }      // processing/cleaned row -> the row it was made from
                                        // private; blobs never leave except as object URLs

ownedItem {
  id, userId, createdAt, updatedAt, archivedAt: ISO | null,
  category, productId: string | null, variantId: string | null,
  custom: { brand, name, variantName, type, colors: [COLOR_NAME] } | null,
  identity: Identity,
  details: {
    size: Size | null, condition: OWNED_CONDITION | null,
    purchase: { priceMinor, currency, date, from } | null,
    notes: string,                      // private
    serialNumber: string | null,        // watches only, private, never a product identifier
  },
  ownerChanges: [{ part: 'strap' | 'bracelet' | 'other', description, widthMm: number|null }],
  photos: { originalId: string | null, cleanedId: string | null, labelIds: [string] },
  display: 'catalog' | 'original' | 'cleaned',
  sourceUrl?: string | null,            // added from a product link
  fromWishlistId?: string               // created by markPurchased
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
  photos: { originalId: string | null }, purchasedOwnedId: string | null
}

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
  runId                                 // internal; never returned
}

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
                                        // 'offerFreshnessHours', 'matchTimeoutMs', 'evalReport'
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
- `rateLimit`: `'scan'` (30 per hour) or `'recs'` (120 per hour) per actor; `rate_limited`
  carries `details.retryAfterMs`.
- `ctx` = `{ actor, token, db, clock, config: { get, set }, providers, catalog(),
  invalidateCatalog(), now(), iso(), audit(action, targetType, targetId, meta),
  metric(type, data), call(opName, args) /* internal, same actor */ }`.
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
| `ops/matching.js` | `createMatchJob`, `getMatchJob`, `addMatchEvidence`, `retryMatchJob`, `rejectMatch`, `confirmMatch` |
| `ops/inventory.js` | `listOwned`, `getOwned`, `createOwned`, `updateOwned`, `archiveOwned`, `restoreOwned`, `deleteOwned`, `setDisplayImage`, `correctMatch`, `reportCatalogIssue`, `checkDuplicates` |
| `ops/wishlist.js` | `listWishlist`, `getWishlistItem`, `createWishlist`, `updateWishlist`, `removeWishlist`, `markPurchased` |
| `ops/recs.js` | `recommend`, `helpMeChoose`, `giveFeedback`, `listFeedback`, `removeFeedback`, `parseRequest` |
| `ops/offers.js` | `getOffers`, `createClick`, `importFromUrl` |
| `ops/marketplaces.js` | `listMarketplaces`, `searchMarketplaces`, `importMarketplaceLink` |
| `ops/stylist.js` | `listMyStylists`, `createStylistRequest`, `listStylistRequests`, `getStylistRequest`, `revokeStylistRequest`, `submitStylistRecs`, `listStylistRecs`, `getAuditLog` |
| `ops/privacy.js` | `exportMyData`, `deleteMyAccount` |
| `ops/admin.js` | `adminOverview`, `adminListProducts`, `adminImportFeed`, `adminListCorrections`, `adminResolveCorrection`, `adminListImages`, `adminSetImageStatus`, `adminListOffers`, `adminRefreshOffer`, `adminListJobs`, `adminRetryJob`, `adminGetProviders`, `adminSetProviderSimulation`, `adminGetWeights`, `adminSetWeights`, `adminListAccounts`, `adminAssignStylist`, `adminEndAssignment`, `adminListClicks`, `adminConversions`, `adminLoadDemoConversions`, `adminSaveEvalReport`, `adminGetEvalReport` |

Each operation's arguments and result are also documented with JSDoc in its file. Cross-module
helpers other ops use: `requeueMatchJob(ctx, jobId)` and `loadReferenceIndex(env)` /
`analyzeAndMatch(input)` (`ops/matching.js`), `ownedViews`, `loadOwned`, `checkPhotoRefs`
(`ops/inventory.js`), `wishViews` (`ops/wishlist.js`), `deletePhotos`, `revokePhotoUrls`
(`ops/photos.js`), `correctionField`, `coerceCorrectionValue` (`ops/admin.js`),
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
  brandName: string, title: string, subtitle: string, code: string | null,   // label strip
  image: DisplayImage,
  copies: number            // how many active records share this variant (multiple copies)
}
// subtitle when the version isn't confirmed: 'Colorway not confirmed' (sneakers),
// 'Color not confirmed' (clothing), 'Reference not confirmed' (watches); custom: variantName
// or 'Custom item'.

WishlistView = wishlistItem & { product, variant, brandName, title, subtitle, code, image,
  linkedOwned: [{ id, category, brandName, title, subtitle, image }],
  ownedCopies: number, purchasedOwned: { id } | null }

DisplayImage {
  kind: 'catalog' | 'original' | 'cleaned' | 'placeholder',
  url: string | null,       // data: URL for catalog images; null for photos (hydrate)
  photoId: string | null,   // for photos; screens hydrate with api.getPhotoUrl
  label: 'Catalog image' | 'Your photo' | 'Your photo, cleaned up' | null,
  attribution: string | null,
  fallbackReason: string | null,   // why the catalog image isn't shown (say it, don't hide it)
  options: ['catalog'?, 'original'?, 'cleaned'?]   // what the person can switch to
}

RedactedItem {             // what a stylist sees (policy.redactForStylist), allowlist only
  id, category, productId, variantId, custom, product, variant, title, brandName, subtitle, code,
  image,                   // a photo only when the request shares photos
  details: { size, condition, notes: string | null },   // notes only when shared
  ownerChanges, identity: { resolution, variant }, shared: { photos, notes }
}                          // never: purchase, serialNumber, evidence, photo ids
```

The display choice is the person's and is kept; `image` says what is actually shown. The
original photo is never deleted or replaced when the catalog image is displayed.

### 5.3 Providers (`js/server/providers/`)

Providers keep external services replaceable. Each has a browser implementation (on the
device, `index.browser.js`) and a test implementation (`test.js`, Node, fixture features).

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
```

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

- `uploadPhoto({ blob, kind: 'original'|'label', idempotencyKey? })` (`user`) →
  `{ photoId, processingId, width, height, mime, bytes }`. `unsupported` (not JPEG/PNG/WebP/
  HEIC by signature, or HEIC the browser can't decode), `invalid` (> 15 MB, empty, < 200 px).
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
- `confirmMatch({ jobId, candidateId|null, variantId|null, variantUnsure?, custom?, category?, details? | wish?, display?, allowDuplicate?, idempotencyKey })` → `{ item: OwnedView | WishlistView, job: MatchJobView }`. Identity per 4.1 (identifier_supported only when a code in `job.texts` matches the chosen version). `duplicate` with `details.duplicates`; `conflict` if already confirmed or still running.

**Inventory** (`user`; others → `not_found`)

- `listOwned({ category?, q?, brandId?, color?, sort?: 'recent'|'brand'|'name'|'color', includeArchived? })` → `{ items: [OwnedView], facets: { categories: { sneaker, watch, clothing }, brands: [{ id, name, count }], colors: [{ name, label, count }] }, total, collectionTotal, archivedCount }`. Custom brands have ids `custom:<slug>`.
- `getOwned({ itemId })` → `OwnedView`
- `createOwned({ category, productId?, variantId?, custom?, details?, ownerChanges?, photos?, display?, source?: 'catalog_search'|'product_link'|'manual', sourceUrl?, allowDuplicate?, idempotencyKey })` → `OwnedView`; the identity is always built server side.
- `updateOwned({ itemId, patch: { details?, ownerChanges?, custom?, display?, photos?: { originalId?, labelIds? } } })` → `OwnedView`
- `archiveOwned` / `restoreOwned({ itemId })` → `OwnedView`; `deleteOwned({ itemId })` → `{ ok: true }` (photos go too unless still used; removed from shares)
- `setDisplayImage({ itemId, display })` → `OwnedView`; `invalid` with the reason when that image can't be shown
- `correctMatch({ itemId, productId|null, variantId|null, custom? })` → `OwnedView` (the person's record only; evidence replaced)
- `reportCatalogIssue({ productId, variantId?, field, proposedValue, note })` → correction (`field` from `correctionFieldsFor(category)` in `ops/admin.js`)
- `checkDuplicates({ category?, productId?, variantId?, custom? })` → `{ duplicates: [OwnedView] }`

**Wishlist** (`user`)

- `listWishlist({ status?: 'active'|'purchased'|'removed'|'all' })` → `{ items: [WishlistView], counts: { active, purchased } }`
- `getWishlistItem({ itemId })` → `WishlistView`
- `createWishlist({ category, productId?, variantId?, custom?, matchPending?, reason, reasonNote?, intent?, linkedOwnedIds?, desired: { size?, condition, variantFlexible? }, targetPriceMinor?, sourceUrl?, source?, photos?, allowDuplicate?, idempotencyKey })` → `WishlistView`
- `updateWishlist({ itemId, patch: { reason?, intent?, desired?, targetPriceMinor?, linkedOwnedIds?, reasonNote? } })` → `WishlistView`
- `removeWishlist({ itemId })` → `{ ok: true }`
- `markPurchased({ itemId, details: { size?, condition?, purchase? }, variantId?, allowDuplicate?, idempotencyKey })` → `{ owned: OwnedView, wish: WishlistView }`. The only way a wish becomes owned; the wished size is not assumed.

**Recommendations** (`user`; `recommend` and `helpMeChoose` are rate-limited `recs`)

- `recommend({ mode?: 'similar'|'matching'|'alternatives'|'feed', seedIds?, seedType?: 'owned'|'wishlist'|'variant', category?, constraints?, limit? ≤ 24, text? ≤ 300, exploreColorways? })` → `RecResult` (6.1), or `FeedResult` for `feed` (the default without text). With `text`, the result adds `interpretation` (same shape as `parseRequest`) and the mode is inferred. Seeds must be the person's own (`not_found`). `alternatives` needs a wishlist or variant seed. Constraint keys: `category`, `categories`, `types`, `maxPriceMinor`, `minPriceMinor`, `priceAroundMinor`, `size`, `condition` (default `new_only`), `inStockOnly`, `includeOwned`, `includeUnknownPrice`, `anySize`, `strapWidthMm`, `caseDiameterMm`, `colors`, `avoidColors`, `styles`, `avoidStyles`, `uses`, `materials`, `brandIds`, `exploreColorways`. Unknown values are `invalid`. `unavailable` when offers are down.
- `helpMeChoose({ wishlistIds: [1..3] })` → `Comparison` (6.1)
- `giveFeedback({ productId, variantId?, type: FEEDBACK, contextItemId?, requestId?, idempotencyKey? })` → `FeedbackView { id, productId, variantId, type, contextItemId, createdAt, active, label, title, brandName, product, variant, contextItem: { id, itemType, title, brandName } | null }`
- `listFeedback({ includeInactive? })` → `[FeedbackView]`; `removeFeedback({ feedbackId })` → `{ ok: true }` (results return to what they were)
- `parseRequest({ text })` → `{ constraints, chips: [{ kind, label, value }], seedHints, unparsed, seeds: [{ hint, exact, itemId, itemType, title, brandName, subtitle, imageUrl, photoId }], unresolvedHints, seedIds, suggestedMode }`. Chip kinds: category, type, color, avoid_color, style, avoid_style, use, material, brand, price, size, condition, stock, seed. Rebuild constraints from edited chips with `constraintsFromChips(chips)` (`js/engine/parse-request.js`).

**Offers and links**

- `getOffers({ variantId, size?: Size|string, condition?: 'new_only'|'new_or_used'|OFFER_CONDITION })` (`any`) → `OffersView` (6.1). A bare size string takes the product's system; unsized products ignore it. `unavailable` ("Retailer prices could not be checked right now. Try again shortly.") when offers are down.
- `createClick({ offerId, idempotencyKey })` (`any`) → `{ clickRef, destination, tracked, retailer: { id, name, domain }, affiliate: { network, status } | null, disclosure, offerId, variantId, productId }`. Records a pseudonymous click; never marks anything purchased. `unavailable` for removed listings.
- `importFromUrl({ url })` (`user`) → `{ status: 'resolved', productId, variantId, offerId, retailerId, size, sizeNote, listingStatus, url, product, variant, retailer }` | `{ status: 'unsupported_link', host, code, reason, url }` | `{ status: 'invalid_url', code, reason }`. Never fetches the URL; `reason` is a sentence to show, `code` is for logic.
- `listMarketplaces({})` → `[{ id, name, connected, demo, note, searchUrlTemplate }]`; `searchMarketplaces({ query, marketplaceId? })` → `{ query, sources: [{ id, name, demo, connected, reason, searchUrl, results }] }`; `importMarketplaceLink({ url })` → `{ ok: true, link, catalogMatches, draft: { category, custom, sourceUrl, styleCodeGuess, sizeGuess, evidence } }` | `{ ok: false, reason, message, marketplace }`. A draft never carries a catalog identity; its size is a guess for the person to confirm. See `docs/marketplaces.md`.

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

- `exportMyData({})` → everything stored about the actor (photos as data URLs, sessions without tokens, clicks under the analytics id), nothing about anyone else
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
- `adminGetProviders({})` / `adminSetProviderSimulation({ vision?, offers?, ocr? })` → `{ simulation, providers: [{ id, name, detail, status: 'normal'|'simulated'|'demo'|'connected'|'not_connected', simulation, options }] }`
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
| `provenance.js` | `resolveDisplayImage(item, catalog, now, catalogUrl) -> DisplayImage`, `catalogImageFor`, `imagePermitted` |

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
| `/wishlist` | wishlist | Wishlist |
| `/wishlist/:id` | wishlist item | Wishlist |
| `/wishlist/compare` | help me choose `?ids=a,b,c` | Wishlist |
| `/add` | add-item chooser `?dest=owned|wishlist` | none |
| `/add/photo` | capture or upload, crop, or try a sample | none |
| `/add/link` | product link entry | none |
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
`js/ui/catalog-picker.js`, `js/lib/ui.js` (`toast`, `openSheet`, `confirmDialog`, `withBusy`,
`formData`, `showFieldErrors`, `toastError`, `downloadBlob`). `dev/components.html` shows them.

### 7.2 Design system

Tokens in `css/tokens.css`, classes in `css/components.css`:

- Subject: shoebox end-labels, hang tags and watch references. Every product wears a
  **label strip** under its image: brand, model, variant, and the code (style code, reference,
  size) set in condensed Archivo. Owned items have a solid ink label; wishlist items a dashed
  orange outline (wanted, not yet yours); suggestions a plain label.
- Identity shows as a stamp on the label: "Confirmed by you", "Code matched", "Colorway
  unsure", "Custom item", "Needs review".
- Images sit on a neutral studio tile (`--studio`). Catalog images carry a small
  "Catalog image" tag so they aren't mistaken for photos of the person's own item.
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
- **Collection / item.** `listOwned` facets drive filter chips; tiles use `itemTile` and the
  label strip. Item detail shows identity stamps and evidence, `image.label`, the display
  switch from `image.options` (`setDisplayImage`), `image.fallbackReason` when the catalog image
  can't be shown, `cleanupPhoto`, `correctMatch`, `reportCatalogIssue`, archive, delete, and
  "Find similar" / "Find matching" links to `/recs`.
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
- **Add link / search / manual.** `importFromUrl` (show `reason`, never `code`; prefill size
  from `size` and show `sizeNote`; store `url` as `sourceUrl`), `searchMarketplaces` and
  `importMarketplaceLink` for StockX/GOAT links, `searchCatalog` with `catalog-picker.js`,
  `createOwned` / `createWishlist`.
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
- `tests/fixtures/scenes.mjs` draws product-like scenes (studio references and photo-like
  scenes) so the real feature extractor and matcher run in Node.
- `npm run test:e2e` runs `tests/e2e/run.mjs`: `smoke.mjs` (every route as each role, no console
  errors or failed requests) and `photo.mjs` (every sample photo through upload, on-device
  analysis and matching with expected outcomes, then a confirm with a typed reference, clean-up
  and display switch). `-- --ocr` also reads a label photo with Tesseract.js (needs a
  connection to jsDelivr). Helpers for new browser tests: `tests/e2e/helpers.mjs` (`openApp`,
  `signInAs`, `go`, `callApi`, `hasHorizontalScroll`).
- `npm run eval` runs the synthetic evaluation in headless Chromium and writes
  `docs/evaluation.md`.
- Matching thresholds are tuned on synthetic scenes only. Before changing `MATCH_CONFIG` or
  `FEATURE_CONFIG`, run `npm test`, `npm run test:e2e` and `npm run eval` and compare.
