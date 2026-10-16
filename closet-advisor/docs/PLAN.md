# Rotation: production plan

For the product owner and the development team. Written 2026-10-14. Prices and provider facts
come from [providers.md](providers.md), which links every source; the database design is in
[`supabase/migrations/`](../supabase/migrations) with notes in
[`supabase/README.md`](../supabase/README.md).

**Nothing in this plan is confirmed with any outside party yet.** There are no accounts,
approvals or contracts. Every estimate below says what it assumes.

## At a glance

- **The bet.** People will keep an accurate closet if adding an item takes one photo and one
  tap, and they will trust the shopping advice if every claim traces to a real product, a real
  offer, or something they own.
- **The hard parts are outside the code.** Identifying the exact version (colorway, reference)
  from a phone photo, getting permission to show catalog images in a person's collection, and
  getting accepted by affiliate networks and their advertisers.
- **So Milestone 1 is a feasibility test,** not a build: 100+ labeled in-catalog photos and 30+
  out-of-catalog or ambiguous ones, held out from tuning, against a provisional target of 80%
  top-3 accuracy, plus one working, permitted route to display catalog images. It ends in a
  go, adjust or stop decision.
- **Estimate.** About 21 engineer-weeks for the core product (range 16.5 to 25.5), plus time
  waiting for approvals. The human stylist workflow adds 3 to 4.
- **Running cost.** About $106 a month at 100 active users, $476 at 1,000 and $4,182 at 10,000,
  assuming Claude Opus 5.5 and 8 scans per active user a month. AI is most of it; the model choice
  after Milestone 1 can halve or quarter it. Data licensing is unknown until quoted.
- **What we need from you** is listed in [section 7](#7-what-we-need-from-you): accounts, catalog
  and image permissions, and a handful of decisions.

## 1. What we understand the product to be

Rotation is a closet and shopping advisor for sneakers, watches and clothing.

1. A person photographs something they own. Rotation proposes catalog products and the exact
   version, and asks for a label photo, style code or reference when the photo can't decide.
2. The person confirms the product and version. That confirmation is theirs and is labeled
   "Confirmed by you"; it becomes "Code matches" only when an identifier they provided matches
   the version. A lookalike ("similar") never becomes an item's identity unless they pick it.
3. The collection shows a catalog image, tagged as such, where its source allows it, and always
   keeps the person's own photo.
4. "Find similar" and "Find matching" recommend real catalog products, grounded in the person's
   own items, with reasons that name those items.
5. Buying options compare retailer offers for one version, size and condition. Shipping, fees
   and tax that a retailer doesn't state stay unknown, and no "lowest total" is claimed when
   totals can't be compared.
6. The person leaves through a disclosed affiliate redirect. A click is not a purchase and not
   revenue; conversions are reported by the network later and kept separate.
7. Optionally, a human stylist can be given scoped, revocable and audited access to items the
   person chooses to share.
8. An admin manages catalog imports, corrections, image source status, offer freshness, provider
   health and ranking weights, but can't read anyone's collection.

The honesty rules hold everywhere: no invented products, links, prices or stock; size,
authenticity and hidden specs are never inferred from a photo; unknown is shown as unknown
(`null`, never zero).

## 2. Production architecture

Next.js with TypeScript and Tailwind, hosted on Vercel. Supabase for Auth, Postgres with
row-level security, Storage, queues and scheduled jobs. Every outside service sits behind a
server-side adapter with the same interface the prototype's providers use.

```
Phone browser: Next.js app (installable PWA)
  |- signs in with Supabase Auth (session cookie)
  |- reads its own rows directly; row-level security filters everything
  |- uploads a photo to user-photos/<user id>/incoming/
  '- calls server route handlers on Vercel
        |- check the session and role, rate limits, idempotency key
        |- validate input with the same rules as js/server/ops/*.js
        |- write with the person's token, so row-level security still applies
        '- enqueue background jobs (Supabase Queues)

Background workers (Vercel functions on queue messages and cron)
  |- photo: check file signature, re-encode (drops EXIF and GPS), make processing copy
  |- match job: embed the crop -> nearest catalog images in pgvector -> Claude compares the
  |  photo with the top candidates and reads any visible code -> evidence -> candidates
  |- catalog import: feed adapters -> validate -> upsert -> embed new reference images
  '- offer refresh, image expiry, conversion sync, purges

Provider adapters (keys on the server only): Claude, image embeddings, affiliate networks
(Rakuten, CJ, Impact, Awin), optional GS1 US Data Hub.
```

**Security model.** The browser only ever holds the public (anon) key and the person's session.
The service role key, which bypasses row-level security, lives in server environment variables
and is used only for writes no person may make directly: match results, identity evidence,
clicks, conversions and metrics. The database enforces the rules a second time: owners see only
their rows; stylists reach shared items only through functions that check a live request and an
active assignment, and get an allowlisted copy; admins have no policy on any personal table.
Photos are served through signed URLs that expire in a few minutes, because a signed URL can't
be revoked once issued.

**Writes that must be atomic** (confirming a match: item, evidence and job together; marking a
wish purchased; sharing with a snapshot) run in one transaction from the server, over a direct
Postgres connection or as a database function. The database rejects an "identifier supported"
identity without identifier evidence at commit, so these can't be split into separate requests.

**Where each prototype module goes.**

| Prototype | Production |
| --- | --- |
| `js/server/api.js` (session, role, rate limits, idempotency, clone results) | One wrapper used by every route handler: Supabase session from cookies, role from the `user_role` claim checked against `accounts`, the same rate limits, `idempotency_keys`, the same error codes and user-safe messages |
| `js/server/db.js` (IndexedDB) | Supabase Postgres: `0001_init.sql` |
| `js/server/policy.js` | Row-level security policies and `private.*` helpers; `redactForStylist` becomes `private.redact_owned_item` |
| `js/server/auth.js` | Supabase Auth (email and password, magic link) plus a custom access token hook for the role claim |
| `js/server/records.js`, `js/data/schema.js` | Server-side schemas in TypeScript plus check constraints, enums and per-category attribute tables in Postgres |
| `js/server/views.js` | Server view builders returning the same `OwnedView` and `WishlistView` shapes |
| `js/server/ops/*.js` | Route handlers grouped the same way: account, profile, catalog, photos, matching, inventory, wishlist, recs, offers, marketplaces, stylist, privacy, admin |
| `js/server/providers/*` | Adapters with the same interfaces: imaging (server re-encode), vision (embeddings plus Claude), OCR (on-device Tesseract.js with self-hosted files, server fallback), reference (catalog embedding job), offers (feed adapters), conversions (network report APIs), marketplaces (not connected) |
| `js/engine/*` | A shared TypeScript package: recommendation ranking and constraints, color harmony, explanations, request parsing, offer comparison, affiliate links, conversion reconciliation, duplicates, image provenance and the matcher's evidence rules. Visual similarity moves from color features to embeddings; color naming stays |
| `js/data/catalog.js`, `retailers.js`, `illustrations.js` | Catalog and offer tables filled by the import pipeline; generated illustrations replaced by images we may show |
| `js/screens/*`, `js/ui/*`, `css/*` | App Router pages and React components styled with Tailwind, keeping the routes, design tokens, label strip and copy rules |
| `sw.js`, `manifest.webmanifest` | The app manifest and an app-shell service worker |
| `tests/unit`, `tests/e2e` | Unit tests for the shared package and route handlers, pgTAP tests for every policy (`supabase test db`), Playwright end-to-end tests |

**Background jobs.**

| Job | Trigger | Notes |
| --- | --- | --- |
| Photo normalization | Upload | Rejects unsupported files, strips metadata, creates the processing copy, deletes the incoming file |
| Match job | Queue | Timeout and at most 3 attempts, as in the prototype; writes candidates and evidence |
| Catalog import | Schedule per feed | Only when the feed list shows a newer file; rejected rows stored with reasons |
| Catalog embedding | After import | Only images whose terms allow indexing (`allow_retrieval_index`) |
| Offer refresh | Schedule per retailer | Updates `last_checked_at`; stale offers are flagged, never hidden as fresh |
| Image expiry | Every 15 minutes | `private.expire_catalog_images()`; removes embeddings of expired images |
| Conversion sync | Daily per network | Status changes recorded in `conversion_status_history` |
| Purges | Daily | Expired idempotency keys, unconfirmed scan photos after the retention period you choose |

## 3. Product-data sources: confirmed vs needed

Nothing is confirmed. Fallbacks keep the product honest when access is refused: missing data
shows as missing.

| Need | Planned source | Status | Needed before use | If refused |
| --- | --- | --- | --- | --- |
| Product and version facts, identifiers | Affiliate product feeds (Rakuten, CJ, Impact, Awin), checked by import validation | None | Publisher accounts, then each advertiser's approval | Smaller catalog; manual items stay custom |
| Catalog images in collections | Written permission from brands or retailers; images the team photographs | None | Written terms: display scope, caching, attribution, takedown | Person's own photo in the collection; catalog image only next to that retailer's offer |
| Prices, stock, shipping | Feeds from the same networks | None | Advertiser approval and feed access | "Price unknown at the retailers we check" |
| Sneaker market prices | StockX product feed through Impact (lowest ask) | None | StockX affiliate approval and feed terms | Plain link to StockX search, no price |
| Watch listings | Chrono24 affiliate program on Awin; watch dealers in the networks | None | Approval; feed availability unknown | Plain links, no price |
| Tracked links, conversions | Network link and report APIs | None | Approvals, payment and tax details | Untracked links, labeled as not tracked |
| GTIN checks | Feed GTINs plus check digit (in the schema); GS1 US Data Hub optional | None | Subscription if used | Check digit and catalog match only |
| Visual retrieval | `multimodalembedding@001` | None | Google Cloud project | Amazon Bedrock or Azure embeddings |
| Candidate verification, label reading, request parsing | Claude | None | Anthropic organization and key | Embeddings only, stricter abstention, rule-based parser |
| On-device label reading | Tesseract.js | In the prototype | Self-host its files | Typed code |

StockX's API license is "for your internal use only", so it can't power a consumer app; GOAT
and Chrono24 publish no API we could find; scraping any of them is against their terms and not
part of this plan ([providers.md](providers.md#sneaker-and-watch-marketplaces),
[marketplaces.md](marketplaces.md)). The prototype's local lookup server (section 8) reads public
store pages and Bing for a class demo; it is not a production data source and nothing in this
plan depends on it.

## 4. Milestone 1: feasibility of exact identification and approved images

**Questions.** Can Rotation name the right product and exact version from an ordinary phone
photo often enough, and abstain when it can't? Can it show a catalog image in a collection
under terms we actually hold?

**Pilot catalog.** About 200 versions across the three categories, at least 60 per category,
each with two or more reference images we may use, from at least one permitted source per
category. It deliberately includes hard pairs: colorways that differ only in sole color, the
same watch in 38 and 40 mm, the same garment in two close colors.

**Labeled photo set.** Collected before any tuning, and held out from it:

| Set | Size | What it contains |
| --- | --- | --- |
| In-catalog, held out | at least 100: about 40 sneakers, 30 watches, 30 clothing | Items whose exact version is in the pilot catalog |
| Out-of-catalog and ambiguous, held out | at least 30 | 10 items not in the catalog, 10 lookalikes of catalog items, 10 hard cases (blur, partial view, several items, versions only an identifier can tell apart) |
| Tuning | at least 50, separate | Used for thresholds and prompts; never mixed with the held-out sets |

Photos come from at least 5 people on at least 3 phone models, indoors and outdoors, worn and
flat-lay, new and used, with written consent. Two people label each photo (product, version,
and whether the version can be decided from the photo at all); disagreements are resolved before
the test. The held-out files are hashed and frozen.

**Pipelines compared.**

- A: embedding retrieval only (top 5 by distance).
- B: A plus Claude Opus 5.5 comparing the photo with the top candidates.
- C: B plus a label photo or typed code where the matcher asks for one.
- D: B with Claude Sonnet 5.5 and with Claude Haiku 4.5, to see whether cheaper models hold up.

**Metrics** (reported overall and per category):

| Metric | Definition |
| --- | --- |
| Top-1 | Share of in-catalog photos whose first candidate is the right product |
| Top-3 | Share whose right product is among the first three candidates |
| Exact-variant accuracy | Share where the proposed version is the right one |
| Exact-variant errors | Share where a wrong version is proposed without being flagged as unsure. This is the number that matters most for trust |
| Variant abstention | Versions left "unsure": counted as correct when the photo can't decide, as a miss when it could |
| Out-of-catalog abstention and false accepts | Share of out-of-catalog photos answered with no match or "similar" vs claimed as a match |
| Latency | p50 and p95 from upload to candidates, on a mid-range phone over a throttled connection |
| Cost per scan | Measured tokens and calls times published prices |
| Coverage by category | Of 50 items testers own, listed before the catalog is built, how many exist in sources we can license |

**Provisional targets** (for you to confirm before the test runs):

- Top-3 of at least 80% on the held-out in-catalog set, with no category below 70%.
- Exact-variant errors at most 2% of in-catalog photos.
- At most 10% false accepts on out-of-catalog photos.
- p95 latency at most 8 seconds; cost at most $0.06 per scan.

**Image route.** For at least one source per category, written terms that allow showing its
images in a person's collection, recorded in a terms register (source, display scope, cache
period, attribution, takedown time). Then a working demonstration: the image appears with its
"Catalog image" tag and attribution; an admin marks it taken down and it disappears from every
view, with its embeddings deleted; an expired image falls back to the person's photo. Where no
such terms exist, we demonstrate the fallback instead (image only next to that retailer's live
offer) and record the gap.

**Deliverables.** An evaluation report in the format of the prototype's synthetic report, but on
real photos; a cost and latency table; a gallery of every error; the terms register; and a
one-page go, adjust or stop recommendation. "Adjust" might mean launching with fewer
categories, or requiring a label photo for watches.

The prototype's synthetic evaluation measures its own illustrations, so its numbers say nothing
about real photos. Milestone 1 is where real accuracy gets measured.

## 5. Implementation estimate

Engineer-weeks for an experienced full-stack engineer comfortable with Next.js and Postgres.
Two engineers would take roughly 9 to 13 calendar weeks for the core, plus approval waits.

| Milestone | Engineer-weeks | Scope | Done when |
| --- | --- | --- | --- |
| M0 Foundations | 2 (1.5 to 2.5) | Next.js app, staging and production Supabase projects, migrations applied with policy tests in CI, auth flows, secrets, error monitoring, design tokens and label strip | A signed-in person sees an empty collection in staging; every policy has a passing test |
| M1 Feasibility | 4 (3 to 5) | Pilot catalog, photo collection and labeling, embeddings plus pgvector, Claude verification, evaluation harness and report, terms register, image display demo | Go, adjust or stop decision made |
| M2 Collection | 5 (4 to 6) | Upload and normalization, match jobs, confirmation with identity rules and evidence, collection and wishlist, add by search, link or manual entry, image provenance, copies and duplicates, export and deletion | A person adds, confirms, edits and deletes items end to end on a phone |
| M3 Commerce and recommendations | 5 (4 to 6) | Feed imports for one or two networks, offer normalization and freshness, buying options, affiliate redirect and click records, conversion sync, recommendation engine port, Claude request parsing, feedback | Recommendations and offers come from real feeds, with honest unknowns |
| M4 Admin and operations | 2.5 (2 to 3) | Imports, corrections, image status, offers, jobs, provider health, ranking weights, accounts, clicks and conversions, audit views, metrics | Operations run without database access |
| M5 Hardening and beta | 2.5 (2 to 3) | Security review, load test, rate limits and abuse checks, privacy policy and affiliate disclosure, alerts, a beta with about 100 people | Beta issues fixed; launch checklist signed off |
| **Core total** | **21 (16.5 to 25.5)** | | |

**Optional: human stylist workflow, 3 to 4 engineer-weeks.** The schema, policies and functions
already exist in the migration. The work is the sharing screens (choose items, photos and notes,
snapshot or live), the stylist workspace, revocation, the person's audit log view, admin
assignment and notifications, plus non-engineering work: who the stylists are, their agreement
and their training.

**Later features**, each after the core proves out:

| Feature | Engineer-weeks | What it depends on |
| --- | --- | --- |
| Price alerts | 2 to 3 | Fresh per-size offers and notifications; feed terms on refresh rate |
| Cashback | 4 to 6, plus legal and finance | Programs that allow cashback (many restrict incentivized traffic), payouts, tax reporting, fraud checks |
| Coupon testing | 3 to 5, plus the extension | Advertiser terms on coupon use; usually needs a browser extension |
| Browser extension | 4 to 6 | Store review, permissions, product page detection per retailer |
| Valuations | 4 to 6, plus a data license | Resale data is partner-only (StockX's license forbids this use); show ranges with sources, never a single price |
| Social sharing | 4 to 6, plus moderation | Privacy defaults, moderation, reporting |
| Virtual try-on | 8 to 12 or more, research | Third-party technology and licensing; high risk, low priority |
| In-app checkout | 8 to 12, plus agreements | Retailer checkout partnerships, hosted payments, returns and support |

**Assumptions.** The prototype's logic is ported, not reinvented. One region (United States),
USD, English. Design support of about half a person during M2 and M3 is not counted. Waiting for
approvals is not counted either: networks quote a day or two for the first review (Awin aims for
24 hours, StockX's affiliate team for 48 business hours), and each advertiser then decides on
its own schedule.

**Risks.**

| Risk | Likelihood | Effect | Mitigation |
| --- | --- | --- | --- |
| No permission to show catalog images in collections | High | Collections show the person's photos only | Start outreach in M0; photograph pilot items ourselves; the fallback already works |
| Networks or advertisers decline a new app with no traffic | High | Fewer offers and links | Apply in M0 with a public site, privacy policy and disclosure; start with programs that accept apps |
| Exact versions can't be told apart from photos | High for some pairs | More "unsure" answers | Ask for a label photo or code; abstain; measure in M1 |
| Feed quality (missing GTINs, inconsistent variants, stale prices) | Medium | Wrong groupings or stale offers | Import validation with stored rejections; freshness rules; corrections queue |
| AI cost grows with scans | Medium | Costs above section 6 | Rate limits (30 scans an hour), model choice after M1, a monthly spend cap |
| Provider changes | Medium | Rework | Adapters behind interfaces (Google's Product Search already went to maintenance mode) |
| Privacy obligations for photos | Medium | Legal exposure | Crop guidance, metadata stripping, retention limits, working export and deletion |
| Legal: disclosure, marketplace terms, the working name | Medium | Launch delay | Legal review in M5; no scraping; trademark search on "Rotation" |

## 6. Monthly operating costs

Prices are from [providers.md](providers.md) as published on 2026-10-14. Usage figures are
assumptions, to be replaced with measurements from Milestone 1 and the beta.

**Assumptions per active user per month.**

| Item | Assumption |
| --- | --- |
| Scans (photos matched) | 8; 30% also send a label photo; 10% of calls retried |
| Recommendation requests | 20; a quarter include typed text that a model parses |
| AI calls per scan | 1 image embedding and 1 Claude call (photo at 1,092 px = 1,521 tokens, five 512 px reference images = 1,805, about 2,000 tokens of instructions and facts, 800 output tokens) |
| AI calls per recommendation | Retrieval and ranking use no model; typed text uses 1 Claude call (1,500 in, 300 out) |
| Image search calls | 1 embedding per scan; nearest-neighbor search runs inside Postgres at no per-query fee; about 3,000 catalog images re-embedded a month |
| Photo storage | 25 MB per person (about 30 items with originals and copies), plus 10 GB of catalog files |
| Egress | 15 MB of private photo views and 30 MB of cached catalog images per person |
| Seats and compute | 2 Vercel developer seats; Supabase Micro, Small and Medium compute at the three sizes |

**Unit costs.** One scan costs about $0.043 with Claude Opus 5.5, $0.0215 with Sonnet 5.5 or
$0.0108 with Haiku 4.5; the embedding adds $0.0001. One parsed request costs $0.012, $0.006 or
$0.003.

**Monthly totals, with Claude Opus 5.5.**

| | 100 active users | 1,000 active users | 10,000 active users |
| --- | --- | --- | --- |
| Supabase (Pro, compute, storage and egress over the included amounts) | $25 | $30 | $80 |
| Vercel (2 seats; function usage at 10,000) | $40 | $40 | $50 |
| **Infrastructure** | **$65** | **$70** | **$130** |
| **AI** (Claude: scans and request parsing) | **$40** | **$404** | **$4,043** |
| **Image search** (embeddings) | **under $1** | **$1** | **$9** |
| **Data licensing** | Unknown until quoted | Unknown until quoted | Unknown until quoted |
| **Affiliate networks** | No fees found | No fees found | No fees found |
| **Total of known costs** | **about $106** | **about $476** | **about $4,182** |
| Per active user | $1.06 | $0.48 | $0.42 |

**Data licensing.** Partner data from StockX, GOAT or Chrono24, and image licenses from brands,
have no published price. Optional services with published prices: GS1 US Data Hub from $500 a
year, or $7,000 a year with API access (about $583 a month); UPCitemdb Dev at $99 a month.

**Affiliate dependencies.** No publisher fees were found (Awin takes a refundable deposit). The
cost is dependency, not money: approvals can be refused or withdrawn, and commissions arrive
weeks after a sale, so commission income is not counted here.

**Sensitivity, at 10,000 active users.**

- Model: Sonnet 5.5 instead of Opus 5.5 brings the total to about $2,160; Haiku 4.5 to about $1,150.
- Scans: 20 a month (heavy first-month use) raises it to about $9,360; 4 a month lowers it to about $2,456.
- Full-resolution photos (2,576 px, 4,784 tokens each) instead of 1,092 px: about $5,675.
- Storage: 50 MB a person instead of 25 adds about $5. Infrastructure stays flat until well past 10,000.
- Google's Product Search instead of embeddings would add $4.40 per 1,000 scans (about $352 a month).
- Point-in-time database recovery, if you want it: $100 a month.

AI calls per scan, times scans per person, drive almost all of the cost.

**Not included:** a transactional email provider for sign-in emails, error monitoring, extra log
retention, the domain, legal review, design, support staff, and anything a stylist program or
cashback would pay out.

## 7. What we need from you

**Accounts and credentials** (owned by the business, with team members invited):

1. Business details used by every account: legal name, address, tax ID and form, payout bank
   account, and a business email domain.
2. Supabase organization on Pro, with staging and production projects.
3. Vercel team on Pro with two developer seats; a domain and DNS access.
4. Anthropic Console organization with billing, a monthly spend limit, and keys for staging and
   production.
5. A Google Cloud project with billing for embeddings, unless you prefer AWS or Azure.
6. Affiliate publisher accounts with Rakuten Advertising, CJ, Impact and Awin. Each wants a
   public site or app listing with a privacy policy and an affiliate disclosure. Then
   applications to each advertiser: StockX and GOAT on Impact, Chrono24 on Awin, and the
   retailers you want first.
7. A transactional email (SMTP) provider for sign-in and account emails.
8. Optional: GS1 US Data Hub, UPCitemdb.

**Catalog and image permissions:**

- Written terms for every image source we show in collections: display scope, cache period,
  attribution and takedown time.
- Feed usage terms for each advertiser, including any special terms.
- Signed consent from everyone who contributes pilot photos.

**Decisions:**

- Launch scope: all three categories or one first; United States and USD only?
- The Milestone 1 targets in section 4, and who makes the go, adjust or stop call.
- The model after Milestone 1 (accuracy against cost) and a monthly AI budget cap.
- The embedding provider.
- Retention: how long to keep photos of scans that were never confirmed (we suggest 30 days),
  audit entries after an account is deleted, and whether to buy point-in-time recovery.
- Whether used and marketplace offers appear at launch.
- Whether the stylist program is in the first release, and who the stylists are.
- Wording and placement of the affiliate disclosure; privacy policy and terms (legal review).
- Any business model beyond affiliate commission, since it changes the cost picture.
- A trademark check on the working name "Rotation".

## 8. What the prototype in this folder demonstrates, and what it fakes

The prototype is a static site that runs the whole journey in the browser
([ARCHITECTURE.md](../ARCHITECTURE.md)), plus an optional local Node server (`npm start`,
[README.md](../README.md)) that looks up real products for a class demo. Its unit tests (`npm test`) and browser checks cover
the behaviors below.

**What it demonstrates for real:**

- The journey end to end on a phone: photo, candidates, confirmation, collection,
  recommendations, buying options and the affiliate redirect.
- An on-device photo pipeline: file signature checks, orientation, metadata stripping by
  re-encoding, cropping, color and layout features, optional label reading, retrieval against
  reference images, conflict checks, and abstention instead of a confident wrong answer.
- Identity kept as three separate facts (how it was retrieved, how it was resolved, how sure
  the version is) with the evidence and who confirmed it.
- Recommendations from catalog data: hard constraints first, transparent weights, explanations
  built only from computed relations to named items, and relaxations that say how many results
  they would return.
- Buying options per version, size and condition, with unknown costs kept unknown, a lowest-total
  claim only when totals are comparable, and ordering that never uses commission.
- Affiliate redirects with disclosure, pseudonymous click records, and conversions kept separate.
- Access rules as tested functions: two people never see each other's items; a stylist sees only
  what a live request shares, while still assigned; admins never see inventories.
- Catalog image provenance with fallback to the person's photo when a source's terms don't allow
  display.
- Data export and account deletion.
- With the local server: real product lookups from a pasted store link (structured data read
  from the page), Bing Shopping and Bing web results for typed words, and Bing visual search for
  a photo the person chooses to send. Results are saved only as custom items the person
  confirms, with where and when the details were seen. The server sends an honest User-Agent,
  stops at the first block, spaces and caches requests, and stores nothing.
- The production schema in `supabase/migrations/`, executed in PGlite (Postgres 18 in
  WebAssembly) with stand-ins for Supabase's `auth` and `storage` schemas, and 46 behavioral
  tests of its policies passing. It has not been run on a Supabase project.

**What it fakes:**

- The catalog, brands, retailers, offers and prices are fictional, and retailer domains end in
  `.example`.
- Catalog images are generated illustrations, so matching is measured against drawings, not
  product photos. Its accuracy numbers don't predict real-photo accuracy.
- The "server" runs in the same browser tab with IndexedDB storage. It mirrors the production
  boundary but isn't a security boundary.
- Accounts exist only in that browser; demo accounts sign in without a password.
- No AI service is called: no Claude, no embeddings. Matching uses color and layout features.
- No affiliate network is connected. Conversions appear only when an admin loads labeled demo
  data, and "last checked" times are simulated.
- Provider failures are simulated with admin switches.
- Real products have no catalog identity, offers or recommendations: they are custom items with
  a "seen at" price snapshot. Bing is read from its public pages without an API or agreement, and
  stores that block automated lookups (adidas, New Balance, Levi's, Casio, eBay, StockX, GOAT,
  Patagonia in testing) fall back to manual entry; StockX and GOAT links then fall back to the
  words in the link.

**What it can't tell us:** real-photo accuracy, catalog coverage, whether image permissions and
affiliate approvals will come through, and cost and latency with real network calls. Milestone
1 answers the first two directly and starts the other two.
