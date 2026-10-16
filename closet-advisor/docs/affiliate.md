# Buying options, affiliate links and conversion reporting

How Rotation compares retailer offers, sends people to a store, records the click, and reports
conversions, plus how pasted product links are checked. Code:

| Module | What it does |
| --- | --- |
| `js/engine/offers.js` | `compareOffers` (buying options), `orderRows`, `summarizeOffers` (used by recommendations), `offerTotal`, `freshness` |
| `js/engine/affiliate.js` | `buildOutboundUrl`, `newClickRef` |
| `js/engine/conversions.js` | `reconcileConversions`, `summarize`, `demoConversionEvents` |
| `js/server/urlsafety.js` | `validateImportUrl`, `checkRedirectChain`, `resolveRetailerUrl` |
| `js/server/ops/offers.js` | operations `getOffers`, `createClick`, `importFromUrl` |

Tests: `node --test tests/unit/commerce.test.mjs`.

## What is demo

- Every retailer, listing, price, stock level, shipping rate and tax estimate is fictional.
  Retailer domains use the reserved `.example` top-level domain, so no link can reach a real
  store.
- The affiliate programs (`demo-network`, the program ids and parameter values in
  `js/data/retailers.js`) are fictional. No affiliate network is connected:
  `providers.conversions.report()` answers `{ connected: false }`, and the honest revenue figure
  is "unknown", not zero.
- Conversion events exist only when an admin loads the demo report. Every event carries
  `demo: true` and the report says so.
- "Last checked" times come from each offer's `demoAgeHours` (or an admin refresh), not from
  polling retailers.

## Buying options

`compareOffers` builds the buying options for exactly one variant. It never merges offers
across references (AF38 and AF40 are different watches), colorways, sizes or conditions. Each
row is one listing; a retailer's listing id identifies the offer, never the product.

**Size.** For a sized product, the person's size picks the price and stock of that size in
each listing. A listing that doesn't carry the size is left out of the rows (it is about other
sizes) and counts toward `otherSizes`. When no size is chosen, `needsSize` is true, rows show
each listing's lowest in-stock price ("from"), and there is no lowest-total claim, because the
cheapest size somewhere may not be the person's size. Sizes are never inferred.

**Condition.** `'new_only'`, `'new_or_used'` or one exact condition. New and used rows stay
separate and keep their condition label. `hiddenByCondition` counts active listings the filter
hides that would appear (in the chosen size) if the filter changed.

**Watches.** Rows show the seller type, the included components as stated (`[]` means watch
only, `null` means the listing doesn't say) and the warranty as stated. Only an authorized
dealer's listing is presented as carrying a manufacturer warranty; a manufacturer warranty
claimed by anyone else reads as unknown with a `warrantyNote`. Nothing is filled in when a
listing is silent.

**Totals.** Unknown shipping, fees or tax are never treated as zero. A flat shipping rate or a
"known" fee without an amount is unknown. Each row carries the known sum (`totalKnownMinor`),
whether it is complete, what is missing, the before-tax amount used for comparison
(`preTaxMinor`, only when shipping and fees are known) and a label such as "Total", "Total
before tax" or "Total before shipping and tax".

**Order.** Rows are ordered by benefit to the person:

1. in stock first (stock the listing doesn't state comes after),
2. fresh and aging offers before stale ones,
3. offers with known shipping and fees by total ascending (before tax, unless every one of them
   has a tax estimate),
4. then offers with unknown shipping or fees by price,
5. ties: faster delivery, then better condition, then retailer name.

Commission and affiliate status are not inputs. A test compares every view of the real catalog
with the same catalog stripped of all affiliate programs and requires identical order and claims.

**Lowest total.** The label is set only when at least two in-stock offers checked within the
freshness window can be compared:

- if any of them doesn't list shipping or fees, there is no claim, and `lowestNote` says why
  ("2 offers don't list shipping, so totals can't be compared.");
- if any of them has no tax estimate, totals are compared before tax and the label says so
  ("Lowest total before tax among 3 checked offers");
- otherwise "Lowest known total among 3 checked offers".

There is also no claim for a single offer, a tie, or offers in different currencies; the note
explains each case.

**Freshness.** Offers older than `offerFreshnessHours` (config, default 24) are `stale`: flagged,
ordered after fresh ones, excluded from the lowest-total claim, and summarized in `notice`.
Offers under 12 hours old are `fresh`; between that and the window they are `aging`.

**Unavailable.** Removed listings and listings out of stock in the chosen size go to
`unavailable` with a `reason` ("Out of stock in US M 11.", "The retailer removed this
listing."). When the chosen size has no stock anywhere, `otherSizes` lists the sizes that do.

**Disclosure.** Every view names how many retailers were checked and that other stores may
differ, and discloses affiliate relationships: "Rotation checked 3 retailers for this version.
Other stores may have different prices or stock. Rotation may earn a commission from links
marked Affiliate. It doesn't change your price or the order of offers." When no shown link is
an affiliate link, it says so instead. A retailer whose program is pending is not marked
Affiliate, because its links carry no tracking.

`getOffers` reads offers from `providers.offers.list` and the window from config. With the
admin's provider simulation set to `offers: 'down'` (or when the provider fails) it throws
`ApiError('unavailable', 'Retailer prices could not be checked right now. Try again shortly.')`
rather than showing old or empty prices as if they were current.

## Outbound links and tracking

Offer cards link to the in-app redirect (`#/go/:offerId`), never straight to the store. The
redirect screen calls `createClick`, shows where the person is going and whether the link is an
affiliate link, then opens the destination.

`buildOutboundUrl({ offer, retailer, clickRef })`:

- Only a retailer with `affiliate.status === 'approved'` gets tracking, and only the parameters
  in `allowedParams` that have a value in `paramValues`. Values for parameters the program
  doesn't allow are dropped.
- The click reference goes into a sub-id style parameter (`sub_id`, `subid`, `u1` ...) only when
  the program allows one and doesn't fix its value. A program that allows only `ref` never sees
  the click reference.
- A pending program or no program gets the plain listing URL (with any of the program's own
  parameter names removed), `tracked: false`.
- The listing's own query string and fragment are kept as they are; tracking parameters are
  appended.
- The destination must be the retailer's own domain (or its `www.` host) over http(s) with no
  credentials and no custom port. Anything else throws `ApiError('invalid')`, so a bad offer
  record can't turn the redirect into an open redirect.

## Click recording

`createClick({ offerId, idempotencyKey })` works for active listings only (otherwise
`ApiError('unavailable', 'This listing is no longer available.')`). It stores

```
{ id, clickRef, analyticsId, offerId, retailerId, networkId, destination, tracked, createdAt }
```

with no user id: `analyticsId` is the account's pseudonymous id and `clickRef` is random
(`c_` + 16 characters). `networkId` is set only when the link is tracked. It records an
`outbound_click` metric (`{ retailerId, tracked, condition }`). It never changes wishlist or
owned records: a click is not a purchase. A wishlist item becomes owned only when the person
marks it purchased (`markPurchased`). Repeating the call with the same idempotency key returns
the first result and records one click.

## Conversion reporting

Affiliate networks report conversions (orders) separately from clicks, as a series of status
updates per conversion, sometimes repeated and sometimes out of order:

```
pending -> approved -> paid
pending -> reversed            (cancelled or refunded before approval)
approved or paid -> reversed   (refund or clawback later)
```

`reconcileConversions(events)`:

- groups updates by network and `eventId` and keeps the latest by `updatedAt` (falling back to
  `occurredAt`; equal times follow the lifecycle order);
- counts exact repeats as `duplicates` and malformed events as `ignored`;
- treats a refund either as a reversal (`reason: 'refund'`) or as a later update with lower
  amounts (a partial refund); `refunds` counts both;
- lists later updates that move backwards (paid -> pending) in `anomalies` instead of hiding
  them;
- totals count, order amount and commission per status. Only approved and paid commission is
  `earnedMinor`; pending can still be reversed. Mixed currencies make the amounts `null`
  rather than a wrong sum.

`summarize({ clicks, report })` keeps clicks and revenue apart for the admin: click counts
(tracked, untracked, per retailer), conversion counts by status, how many conversions match a
recorded click, and revenue from the report only. Without a report, `revenue` is `null`
(unknown): a click is never revenue.

`demoConversionEvents(clicks, { seed, now, catalog })` backs the admin's "Load demo report". It
uses tracked clicks first (untracked links can't be attributed by a network) and fills in with
synthetic `c_demo...` references, and always includes a paid conversion, an approved one, a
reversal after a refund, a partial refund and a duplicated update. Ids derive from the seed, so
loading twice replaces rather than adds. Every event has `demo: true`.

## Product-link import safety

`importFromUrl({ url })` validates the link, then resolves it against the demo retailers. It
never fetches the URL. Links to real stores are read by a different operation,
`lookupProductPage`, which sends them to the prototype's local server (`npm start`); that
server is the fetcher described below.

`validateImportUrl(input)` trims the input and rejects, in plain words:

- empty input and links over 2,048 characters;
- anything but `http:` and `https:` (`javascript:`, `data:`, `file:`, `ftp:` ...);
- links with a username or password;
- IP-literal hosts in private, loopback, link-local (including 169.254.169.254), CGNAT,
  multicast, reserved, benchmarking or documentation ranges, for IPv4 and IPv6. IPv6 outside
  global unicast is blocked, which covers IPv4-mapped addresses (`[::ffff:127.0.0.1]`); NAT64
  addresses are judged by the IPv4 address they embed;
- decimal, hex and octal IPv4 forms. The WHATWG URL parser (Node and browsers) normalizes
  `http://2130706433`, `http://0x7f000001`, `http://017700000001` and `http://127.1` to
  `127.0.0.1` before the range check; the tests cover each form, and a leftover numeric host is
  rejected;
- `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa` (all of `.arpa`), other
  internal-only names (`.lan`, `.home`, `.corp`, `.intranet`, `.localdomain`, `.test`,
  `.invalid`) and single-label hosts;
- ports other than the default, 80 or 443.

A link without a scheme ("northline.example/p/NL-48213") is read as https. The result is the
normalized href; anything that later uses the link should use that value, so the checker and a
fetcher can't disagree about the host.

`checkRedirectChain(urls, { maxHops: 5 })` validates every hop (resolving relative locations
against the previous hop) and rejects more than five redirects, loops and https-to-http
downgrades.

`resolveRetailerUrl(url, catalog)` accepts only a demo retailer domain (`www.` allowed) whose
path matches the retailer's `urlPattern` with a known listing id. The variant comes from the
catalog's offer record, not from parsing the id. `?size=` maps to a size the listing or product
actually comes in; any other size is ignored with a `sizeNote`. Everything else is
`unsupported_link` with a sentence that can be shown.

### What a server implementation must add before fetching

`importFromUrl` never fetches. The prototype's local server (`backend/net.mjs`) does fetch real
store pages and implements most of this list: DNS answers checked and the connection pinned to
the checked address, every redirect re-checked (at most five), a 12-second timeout, size caps
after decompression (pages 8 MB, JSON 2 MB, images 10 MB), content-type allowlists, no cookies,
per-person rate limits (`web`, 60 an hour) and page text treated as untrusted data. It has no
egress proxy and calls no AI model. A production server must also:

- resolve DNS itself and validate every resolved address (A and AAAA) with the same ranges,
  rejecting the request if any address is blocked;
- pin the connection to the validated address for that request (connect by IP, send the
  original Host and SNI), so DNS rebinding can't swap in an internal address after the check;
- repeat both for every redirect hop (`checkRedirectChain`), with at most five hops;
- limit the request: connect and total timeouts (a few seconds), a response size cap enforced
  while reading (including after decompression), and an allowlist of content types (HTML and
  JSON-LD); send no cookies or credentials, and fetch through an egress proxy that enforces the
  same rules;
- rate-limit imports per person;
- treat fetched text as untrusted data everywhere: escape it in the UI, never follow
  instructions in it, and when it goes into an AI prompt (for example to extract a product name
  or code), pass it as quoted data, ignore any instructions it contains, give the model no tools
  that page text could trigger, and check its output against the catalog before using it. Page
  text can suggest a match, but the person still confirms it.

## Before any of this is live

Real affiliate networks require, at least:

- **Program approval.** Publishers apply to each advertiser's program and can be declined or
  removed. Links stay untracked until a program is approved, which is why pending programs get
  plain links here.
- **Advertiser relationships and terms.** Each program sets what is allowed: traffic sources,
  how prices and product images may be shown and how fresh they must be, coupon and trademark
  rules, and whether deep links to product pages are permitted.
- **Allowed parameters.** Networks define the tracking format: often a redirect through the
  network's own click domain or a deep-link API rather than parameters on the store URL, plus
  sub-id fields with length and character limits. That changes the destination check (the
  network's click domain must be allowed and the final store URL still validated) and keeps
  `allowedParams` per program.
- **Reporting APIs.** Conversions arrive by polling an API or by postbacks, with lock periods
  before approval, adjustments, reversals and payouts. Ingestion has to be idempotent on the
  network's event id (as `reconcileConversions` is), store each update, handle time zones and
  currencies, and reconcile approved commission with actual payments.
- **Disclosure and privacy.** Advertising rules (in the US, the FTC's Endorsement Guides)
  require clear disclosure of material connections next to the links. Click references must
  stay pseudonymous, and tracking consent rules apply where they exist.
- **Ranking independence.** Commission must stay out of ordering and labels; keep the test that
  strips every program and compares results.

## Contracts

Additions to ARCHITECTURE.md 6.1 and the operation JSDoc. Everything listed in 6.1 is
produced as specified; these fields are extra.

### `compareOffers(input)`

```js
compareOffers({ catalog, offers /* lastCheckedAt resolved */, variantId,
  size?: { value, system } | null, condition?: 'new_only' | 'new_or_used' | OFFER_CONDITION
  /* default 'new_or_used' */, now /* ms */, freshnessHours? /* default 24 */ }) -> OffersView
```

OffersView additions and clarifications:

| Field | Meaning |
| --- | --- |
| `retailersChecked` | a number: distinct retailers holding any listing for this variant (including removed and filtered ones) |
| `size` | the size applied (trimmed, case normalized); `null` for unsized products or when none was chosen; the single size of a ONE-SIZE product is applied automatically |
| `needsSize` | `true` when the product is sized and no size was chosen |
| `sizeOptions` | `[{ size, offerCount, inStock }]` for sized products (empty otherwise): every size the product comes in or a listing carries, in sizing order; `offerCount` counts listings in stock in that size |
| `otherSizes` | same shape, only sizes in stock, only when the chosen size has no stock |
| `freshnessHours` | the window used |

OfferRow additions and clarifications:

| Field | Meaning |
| --- | --- |
| `stock` | can be `null` when the listing doesn't state stock; such rows sort after in-stock ones and are never the lowest |
| `priceMinor` | without a chosen size on a sized product, the listing's lowest in-stock price ("from") |
| `missing` | can include `'price'` when a listing has no price |
| `preTaxMinor` | price + shipping + fees when all three are known, else `null` |
| `totalLabel` | "Total", "Total before tax", "Total before shipping and tax", "Price not listed" ... |
| `warranty` | as stated; a non-authorized seller's manufacturer claim becomes `{ kind: 'unknown', claimed: 'manufacturer', months?, provider? }` |
| `warrantyNote` | plain sentence or `null` |
| `reason` | `null` in `rows`; a sentence in `unavailable` |

`orderRows(rows)` returns the ordering above. `AFFILIATE_DISCLOSURE` is the affiliate sentence.

### Existing functions

`summarizeOffers`, `conditionAllowed` and `sizeEntry` are unchanged. Two fixes keep their
documented meaning: `freshness` marks an offer older than the window `stale` even when the
window is under 12 hours, and `offerTotal` treats a flat shipping rate or known fee without an
amount as missing instead of zero.

### `buildOutboundUrl` and `newClickRef`

```js
newClickRef() -> 'c_' + 16 base-36 characters
buildOutboundUrl({ offer, retailer, clickRef? }) -> { url, tracked, network /* networkId when tracked, else null */ }
// throws ApiError('invalid') when the destination isn't the retailer's own site
```

### Operations

```js
getOffers({ variantId, size?: { value, system } | string /* bare value uses the product's system */,
  condition? }) -> OffersView
// not_found (unknown variant), invalid (bad condition or size), unavailable (provider down)

createClick({ offerId, idempotencyKey }) -> { clickRef, destination, tracked,
  retailer: { id, name, domain }, affiliate: { network, status } | null,
  disclosure /* sentence for the redirect screen */, offerId, variantId, productId }

importFromUrl({ url }) ->
    { status: 'resolved', retailerId, offerId, variantId, productId, size, sizeNote, listingStatus,
      url /* normalized */, product /* productSummary */, variant /* variantView */, retailer }
  | { status: 'unsupported_link', host, code, reason, url }
  | { status: 'invalid_url', code, reason }
// reason is always a sentence that can be shown; code is machine-readable
// codes: empty, too_long, malformed, scheme, credentials, local_host, private_address, port,
//        unknown_store, not_a_product_page, unknown_listing
```

### URL safety

```js
validateImportUrl(input) -> { ok: true, url } | { ok: false, reason /* code */, message /* sentence */ }
checkRedirectChain(urls, { maxHops = 5 }) -> { ok: true, url, hops } | { ok: false, reason, message, hop }
resolveRetailerUrl(url, catalog) -> { status: 'resolved', retailerId, offerId, variantId, productId,
  size, listingStatus, sizeNote } | { status: 'unsupported_link', host, code, reason /* sentence */ }
```

### Conversions

```js
reconcileConversions(events) -> {
  conversions: [conversion & { updates, history: [{ status, at, commissionMinor }], adjusted, refunded }],
  totals: { pending|approved|reversed|paid: { count, orderAmountMinor, commissionMinor, unknownAmounts } },
  count, currency, mixedCurrencies, earnedMinor /* approved + paid */, refunds, duplicates, ignored,
  anomalies: [{ eventId, from, to, at }], demo }

summarize({ clicks, report /* reconcileConversions result, { connected: false } or null */ }) -> {
  clicks: { total, tracked, untracked, byRetailer: [{ retailerId, count }] },
  connected, demo,
  conversions: { total, byStatus, attributed, unattributed } | null,
  revenue: { currency, earnedMinor, approvedMinor, paidMinor, pendingMinor, reversedMinor } | null,
  notes: [string] }

demoConversionEvents(clicks, { seed = 1, now = Date.now(), catalog? }) -> conversion records
// conversion records add updatedAt and reason ('refund' | 'cancelled' | 'partial_refund' | null)
```
