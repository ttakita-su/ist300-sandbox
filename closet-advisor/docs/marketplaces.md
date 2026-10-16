# StockX and GOAT in Rotation

Rotation has no StockX or GOAT connection: no API, feed or agreement. It doesn't crawl or search
them, and it doesn't get around their bot protection. What it does instead:

- **Search with honest sources.** Search covers the demo marketplace (the fictional catalog) plus
  StockX and GOAT. StockX and GOAT show as "not connected" with the reason, and a button opens
  each marketplace's own search page for the same words, in a new tab. That button is a plain
  link with no tracking.
- **Paste a product link.** Rotation never requests a StockX or GOAT page, even with the local
  server running: both sites' terms forbid automated access, and both blocked it in testing on
  2026-10-15 (StockX answered 403 "Please login to continue", GOAT 403 "Sorry, you have been
  blocked"). `lookupProductPage` answers `blocked` for their hosts without contacting them and
  without using the hourly lookup allowance. The app then reads the brand, model, style code,
  category and size from the words of the link instead. Everything it reads is a guess the
  person confirms, and the saved item says "Name taken from your GOAT link; not checked with
  GOAT". If the guess matches a Rotation catalog product, the app offers that match first.
  Otherwise the item is saved as a custom item with the link, plus the person's own photo if they
  add one.

Source research checked on 2026-10-14.

## Why it isn't connected

| | What exists | Why Rotation can't use it now |
| --- | --- | --- |
| StockX API | Developer Program covering catalog search, product and market data. "Available by Request for All Level 3+ Sellers" ([stockx.com](https://stockx.com/about/professionalsellers)). | The license is "for your internal use only"; commercial use is "a material breach"; no use "on behalf of any third party"; no aggregating, indexing or archiving ([license](https://developer.stockx.com/portal/license-agreement)). A shopping advisor for other people doesn't fit. |
| StockX affiliate | Runs on Impact, with a product feed of every product and its lowest ask in USD, AUD, GBP, EUR and CAD, plus deep links, after acceptance ([FAQ](https://stockx.com/news/affiliate-faq/)). | Needs an approved application. Image-use terms for the feed weren't published where we looked. |
| GOAT API | No official public or partner API found. alias is GOAT Group's selling app ([alias](https://alias.org/faq)). | Nothing to connect to. Unofficial scrapers exist; Rotation won't use them. |
| GOAT affiliate | Impact ([affilitizer](https://www.affilitizer.com/programs/goat.com)), about 2% commission ([linkclicky](https://linkclicky.com/affiliate-program/goat/)). | Needs approval. No product-feed or image terms confirmed. |
| Reading their pages | StockX bans "any robot, spider, scraper, or other automated or manual means" without written permission ([terms](https://conductatlas.com/platform/stockx/stockx-terms-of-use/provision/CA-P-058140/prohibition-on-automated-scraping-without-permission/)). GOAT bans spiders, crawlers and data mining tools ([terms](https://conductatlas.com/platform/goat/goat-terms-of-use/provision/CA-P-062899/prohibition-on-automated-scraping-or-crawling-tools/)). | Not allowed, and both sites block bots. The prototype never requests their pages; it reads the pasted link's words instead. |

## What connecting them for real would take

1. Approved access: StockX's or GOAT's affiliate program on Impact, with a product feed whose terms
   allow displaying names, prices and images in a third-party app.
2. A server-side adapter in `js/server/providers/marketplaces.js` that reads the feed, keeps
   credentials on the server (never in the static site), and returns results only as the
   agreement allows: attribution, caching limits, deletion and where images may appear.
3. Offers from the feed going through the same offer comparison as other retailers, with the
   affiliate disclosure next to them.

## Operations (for screens)

- `listMarketplaces()` → `[{ id, name, connected, demo, note, searchUrlTemplate }]`
- `searchMarketplaces({ query, marketplaceId? })` → `{ query, sources: [{ id, name, demo, connected,
  reason, searchUrl, results: [{ product, variants, matchedVariantIds }] }] }`. Rate limit: `recs`.
- `lookupProductPage({ url })` (ARCHITECTURE.md 5.4) is tried first for every pasted link when the
  local server is running; the screen calls `importMarketplaceLink` when it returns `blocked`,
  `not_product`, `unavailable` or `not_connected`.
- `importMarketplaceLink({ url })` → `{ ok: true, link, catalogMatches, draft }` or `{ ok: false,
  reason: 'unsupported_marketplace' | 'not_a_product_page', message, marketplace }`. Malformed or
  unsafe links throw `invalid` with `fields.url`. Save the draft with `createOwned` (source
  `product_link`, `sourceUrl`) or `createWishlist` (`sourceUrl`). The draft never carries a
  catalog identity.

## Link rules

Only `stockx.com`, `www.stockx.com`, `goat.com` and `www.goat.com` are accepted, matched exactly,
so lookalikes such as `stockx.com.evil.example` are rejected. Links must be https (http is
upgraded only for these hosts), have no username, password or port, be at most 2,048 characters,
and point at a product page:

- StockX: `/{locale?}/{slug}`
- GOAT: `/{locale?}/{sneakers|apparel}/{slug}`

The stored link drops the query string and fragment, so tracking parameters aren't kept. GOAT
slugs usually end in the style code (`…-dd1391-100` → `DD1391-100`). StockX slugs often end in the
release year, which is kept separate from the name.
