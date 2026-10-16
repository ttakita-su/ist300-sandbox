# Provider research

What each outside service would do for Rotation, what access it needs, what it costs as
published, and which image and data terms matter. All sources were checked on **2026-10-14**
unless a row says otherwise. Prices are list prices in USD and change often; re-check before
committing to any of them.

**Nothing below is confirmed for this project.** No accounts, applications, approvals, keys or
contracts exist yet. Every "Access" line is something still to obtain.

The one exception is the prototype's local server (`npm start`, `backend/`), which reads Bing's
public pages and stores' product pages for an educational demo; see
[Bing visual search, web search and Shopping](#bing-visual-search-web-search-and-shopping).
It has no account, key or agreement with Microsoft or any store.

Related notes from the rest of the team: StockX and GOAT link handling in
[marketplaces.md](marketplaces.md), affiliate links and conversion reporting in
[affiliate.md](affiliate.md), recommendations in [recommendations.md](recommendations.md).

## Summary

| Provider | Role in Rotation | Status for this project | Cost as published | Recommendation |
| --- | --- | --- | --- | --- |
| [Google Vision API Product Search](#google-cloud-vision-api-product-search) | Managed visual product search | Not started. Product in maintenance mode; its suggested replacement is end of life | $4.50 per 1,000 queries after 1,000 free | Don't build on it |
| [Google Lens](#google-lens) | Consumer visual search | No public API; Google blocks automated use | n/a | Not used |
| [Bing visual search, web search and Shopping](#bing-visual-search-web-search-and-shopping) | Photo search and real store listings in the prototype | Used by the local server through Bing's public pages, no API or agreement | Free as used; not licensed | Prototype only, low volume; not for production |
| [Google Cloud Vision API](#google-cloud-vision-api-ocr-and-detection) | Server OCR of labels, optional | Not started | $1.50 per 1,000 text detections after 1,000 free | Optional fallback |
| [Gemini Enterprise Agent Platform embeddings](#gemini-enterprise-agent-platform-multimodal-embeddings) (formerly Vertex AI) | Image embeddings for retrieval | Not started | $0.0001 per image (`multimodalembedding@001`) | Default for Milestone 1 |
| [Amazon Bedrock embeddings](#amazon-bedrock-multimodal-embeddings) | Alternative image embeddings | Not started | $0.00006 per image | Alternative |
| [Azure Vision multimodal embeddings](#azure-vision-multimodal-embeddings) | Alternative image embeddings | Not started | $0.10 per 1,000 images | Alternative |
| [Anthropic Claude](#anthropic-claude) | Rerank and verify candidates, read labels, parse requests | Not started | $4 / $20 per million tokens (Opus 5.5) | Core |
| [Rakuten Advertising](#rakuten-advertising) | Product feeds, affiliate links | Not applied | No publisher fee found | Apply |
| [CJ](#cj) | Product feeds, affiliate links | Not applied | No publisher fee found | Apply |
| [Impact](#impact) | Product feeds, affiliate links (StockX, GOAT) | Not applied | No fee shown at sign-up | Apply |
| [Awin](#awin) | Product feeds, affiliate links (Chrono24) | Not applied | Refundable sign-up deposit | Apply |
| [StockX](#stockx) | Sneaker catalog and market prices | Not connected | API not offered for this use | Affiliate feed only |
| [GOAT](#goat) | Sneaker catalog and prices | Not connected | No API found | Affiliate links only |
| [Chrono24](#chrono24) | Watch listings | Not connected | No API found | Affiliate links via Awin |
| [GS1 US Data Hub](#gs1-us-data-hub) | Verify GTINs and their brand owners | Not subscribed | $500 a year, API add-on $6,500 a year | Optional |
| [UPCitemdb](#upcitemdb) | Barcode lookup hints | Not subscribed | Free 100 a day, $99 a month | Optional, hints only |
| [Supabase](#supabase) | Auth, Postgres, Storage, queues | Not created | Pro from $25 a month | Core |
| [Vercel](#vercel) | Hosting for Next.js | Not created | Pro $20 a month per developer seat | Core |
| [Netlify](#netlify) | Alternative hosting | Not created | Pro $20 a month | Alternative |
| [Tesseract.js](#tesseractjs) | On-device label reading | Used by the prototype | Free, Apache-2.0 | Keep, self-host files |

## Visual search and image understanding

### Google Cloud Vision API Product Search

**What it would do.** A managed index of our products and their reference images. A query
image returns ranked, visually similar products. Supported categories include apparel, home
goods, toys, packaged goods and general items.

**Status.** The documentation says: "The Product Search feature is in maintenance mode. For
better scalability and the same functionality as Product Search, use the Vision Warehouse."
Vision Warehouse is part of Vertex AI Vision, whose documentation now says: "Vertex AI Vision is
deprecated as of June 15, 2026 and reaches End of Life on September 30, 2026", and points to
the Cloud Vision API or Agent Platform models instead. The Vision API deprecations page lists no
shutdown date for Product Search itself (it lists Celebrity Recognition and OCR On-Prem, both
shut down on 2025-09-16). So Product Search still runs, receives no new work, and Google's
named successor has already reached end of life.

**Access.** A Google Cloud project with billing. No approval step.

**Confirmed vs needed.** Nothing confirmed. We don't recommend obtaining it.

**Cost as published.** Prediction: first 1,000 images a month free, $4.50 per 1,000 up to 5
million, $1.80 per 1,000 from 5 to 20 million. Reference image storage: first 1,000 free, then
about $0.10 per 1,000 images a month (listed as $0.000136986 per 1,000 image-hours).

**Image and data terms.** We would upload our own reference images. Google adds no display
rights: the right to use each image still comes from its source.

**Fallback.** Image embeddings stored in Postgres with pgvector (next sections). That is the
design in `supabase/migrations/0001_init.sql`.

Sources: [Product Search docs](https://docs.cloud.google.com/vision/product-search/docs),
[Vertex AI Vision notice](https://docs.cloud.google.com/vision-ai/docs),
[Vision deprecations](https://docs.cloud.google.com/vision/docs/deprecations),
[Product Search pricing](https://cloud.google.com/vision/product-search/pricing).

### Google Lens

**What it would do.** Nothing we can integrate. Google offers no public Lens API. Answering on
Google's developer forum (2025-07-07), a Google staff member wrote: "There is currently no public
Google Cloud service that offers the exact same features and performance as Google Lens", and
suggested Product Search or Vertex AI instead, both covered in this note.

**Third-party "Lens APIs".** Services such as SerpApi and Apify actors scrape Google Lens result
pages. Google's Terms of Service (effective 2026-07-30) prohibit "using automated means to access
content from any of our services in violation of the machine-readable instructions on our web
pages". Their results are web pages and images owned by others, not licensed product data, so
they couldn't back a catalog identity or a displayed image even if the terms allowed it.

**Tried from the prototype (2026-10-15).** Two attempts from the local machine, then stopped:
a plain upload to Lens got only Google's "enable JavaScript" page with no results, and a
headless-browser attempt was sent to Google's `/sorry/index` "unusual traffic" page (HTTP 429).
Google blocks automated Lens and Search use from this prototype, so the local server never
contacts Google. Getting past that would mean evading a block, which the prototype doesn't do.

**Fallback.** Rotation identifies items against its own licensed catalog. For the prototype's
"search online stores with this photo", the local server uses Bing visual search instead (next
section).

Sources: [Google developer forum](https://discuss.google.dev/t/difference-google-lens-vs-google-cloud-vision-api/193387),
[Google Terms of Service](https://policies.google.com/terms),
[SerpApi Google Lens API](https://serpapi.com/google-lens-api).

### Bing visual search, web search and Shopping

**What the prototype does with it.** The local server (`backend/bing.mjs`, through the guarded
upstream in `backend/net.mjs`) reads three kinds of Bing pages. There is no API key and no
agreement with Microsoft; these are the same public pages a browser gets, fetched with the
honest User-Agent `Mozilla/5.0 (compatible; RotationLookup/0.1; educational prototype)`. Google
is never contacted.

| Use | Requests | What is read |
| --- | --- | --- |
| Text search (`POST /api/search`) | `GET https://www.bing.com/search?q=<query>&setlang=en-US&cc=US` and `GET https://www.bing.com/shop?q=<query>&setlang=en-US`, in parallel | Organic results (`li.b_algo`: title, link unwrapped from Bing's `/ck/a` redirect without following it, snippet), at most 10, product pages and known retailers first, Bing and MSN pages dropped. Free Shopping listings (`li.br-item` marked `NonSponsoredOffer` true: title, price text, seller, image, Bing product-page link), at most 24. Ad cards and sponsored listings are never read. |
| Photo search (`POST /api/lens`) | 1. `GET https://www.bing.com/images?FORM=HDRSC2&setlang=en-us` for the upload token and cookies, reused for 10 minutes. 2. `POST https://www.bing.com/images/kblob` (multipart: `imgurl` empty, `cbir=sbi`, `imageBin` = the photo as base64) with the token header. 3. The `/search?q=<recognized name>` page Bing answers with, plus Bing Shopping for that name | The name Bing recognized (the `q` of its `redirectUrl`), then the same results and listings as a text search. A redirect off `www.bing.com`, or a name under 2 characters, is "no match" and is never followed. |
| Listing images | The browser hot-links thumbnails from Bing's image host (`th.bing.com`) in result lists and the save form's preview, lazily and without a referrer | Nothing. When the person saves a listing with its image, the server downloads it once through `/api/image` and the browser keeps a re-encoded copy |

Rules the code keeps: one person action is one search (two Bing pages) or one photo search (an
upload plus two pages, and a token page at most every 10 minutes); requests to `bing.com` are
spaced at least 1 second apart and cached in memory for 15 minutes; a failed upload is not
retried. A 401, 403 or 429, or a results page with no results and Bing's challenge wording
(captcha, "verify you are human", "unusual traffic"), counts as a block: Bing then gets no
requests for 30 minutes and the app says to try later or search by name. Bing's cookies stay in
the server's memory and go only to Bing; no other site gets cookies. The photo is sent only
when the person presses "Search online stores" on the match screen, next to the line "Sends this
photo to Microsoft Bing to recognize it", as the 768 px copy without EXIF or GPS. The server
keeps the answer for 15 minutes under a SHA-256 of the bytes, never the bytes.

**Verified live on 2026-10-15** (from the developer's Mac, honest User-Agent, no blocks or
CAPTCHAs, at least 2 seconds between requests to one host in the test run):

- Text search "Casio F-91W": ok in about 2.2 seconds, 24 free listings (for example Walmart
  "$28.99", read as 2899 USD) and 10 web results (casio.com and amazon.com product pages first).
- Photo search: a Casio F-91W photo was recognized as "Casio F-91W" (about 7 seconds, 24
  listings) and a Converse photo at 768 px as "Converse Chuck Taylor All Star" (about
  6 seconds, 24 listings, 9 web results). In an earlier probe, 3 of 3 real photos were named
  correctly. The test photos are from Wikimedia Commons and may already be indexed by Bing, so
  ordinary phone photos will do worse.
- This is identify-then-shop: Bing names the item and Rotation searches for that name. It is not
  a list of visually similar images, and a wrong name gives wrong listings.
- Listing prices are read only for `$`, `€` and `£`; others keep the price text with a `null`
  price.

**Terms caveat.** Bing's result pages and its image-upload endpoint are undocumented and can
change without notice; when they do, the server fails safe (a missing token gives "Bing's photo
search page has changed", a missing listing marker gives no listings). Microsoft's terms don't
grant automated access to Bing's pages, and Microsoft's supported route, the Bing Search APIs,
was retired in 2025. This use is for an educational prototype run locally at low volume. A
production build needs a licensed source instead (the embeddings and affiliate feeds in this
note), and Bing listings, like any web data, never become a catalog identity or an offer.

### Google Cloud Vision API: OCR and detection

**What it would do.** Server-side text detection for size tags, style codes and watch
case-backs when on-device OCR (Tesseract.js) fails. Logo and web detection exist too, but web
detection returns pages and images from the open web, which are neither catalog facts nor
images we may show.

**Access.** A Google Cloud project with billing.

**Cost as published.** Each feature applied to an image is a unit. First 1,000 units a month
free per feature, then per 1,000 units up to 5 million: text detection, document text detection,
label detection and logo detection $1.50; object localization $2.25; web detection $3.50.

**Terms that matter.** Only the person's own label photo would be sent, after the server strips
metadata. The text read becomes evidence with source `ocr`; it never sets size or authenticity.

**Fallback.** Claude reads the label in the same call that reranks candidates, or the person
types the code (source `user_entered`).

Sources: [Cloud Vision pricing](https://cloud.google.com/vision/pricing).

### Gemini Enterprise Agent Platform: multimodal embeddings

On 2026-04-22 Google's release notes announced that "Vertex AI is now part of Gemini Enterprise
Agent Platform"; the documentation for Vertex AI services now lives under that name.

**What it would do.** Turn each catalog reference image into a vector once, turn each person's
cropped photo into a vector per scan, and find the nearest catalog images in Postgres
(`public.match_catalog_images_mm001` in the migration). Retrieval proposes candidates; it never
decides an identity on its own.

**Models.**

- `multimodalembedding@001`: 1,408 dimensions by default (128, 256, 512 or 1,408 available).
  The model resizes images to 512 x 512, accepts images up to 20 MB, and allows 120 to 600
  requests a minute per project depending on region. Text input is limited to 32 tokens.
- `gemini-embedding-2`: in Preview. 3,072 dimensions by default (128 to 3,072), and accepts text,
  images, video, audio and PDFs in one embedding space.

**Access.** A Google Cloud project with billing and the API enabled. No approval step.

**Confirmed vs needed.** Nothing confirmed. Needed: project, billing account, service account
for the server, and a region choice.

**Cost as published.** `multimodalembedding@001`: $0.0001 per image; text $0.0002 per 1,000
(the price page doesn't name the unit). `gemini-embedding-2` (Preview): image input $0.45 per
million tokens online, $0.225 batch; text $0.20 per million tokens online.

**Image and data terms.** What we send is licensed catalog images and the person's own
cropped photo. Before production, review Google Cloud's data processing terms for how request
data is handled; that review hasn't been done.

**Fallback.** Amazon Bedrock or Azure embeddings. Changing models means re-embedding the
catalog (a few dollars at our sizes) and adding a partial index for the new model; the schema
already stores the model name with each vector.

Sources: [multimodal embeddings docs](https://docs.cloud.google.com/vertex-ai/docs/generative-ai/embeddings/get-image-embeddings),
[pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing),
[release notes](https://docs.cloud.google.com/gemini-enterprise-agent-platform/release-notes).

### Amazon Bedrock: multimodal embeddings

**What it would do.** The same retrieval role as above.

**Models and cost as published** (US East, N. Virginia):

- Amazon Nova Multimodal Embeddings: $0.00006 per standard image on demand, $0.00003 in batch;
  text $0.135 per million tokens.
- Amazon Titan Multimodal Embeddings: $0.00006 per image; text $0.0008 per 1,000 tokens.

**Access.** An AWS account with Bedrock in a region that offers the model. Regional
availability and dimensions weren't checked for this note.

**Fallback.** Google or Azure embeddings.

Sources: [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) (prices read from
AWS's published price list for the region).

### Azure Vision: multimodal embeddings

**What it would do.** The same retrieval role. Azure Vision in Foundry Tools returns
1,024-dimension vectors for images and text in one space (model version `2023-04-15`).

**Terms that matter.** Microsoft's documentation warns that its relevance score "cannot be
accurately compared across queries" and can't easily be mapped to a confidence level. That
matches our design: similarity ranks candidates, and abstention comes from margins and evidence,
never from a raw score shown as a percentage.

**Limits.** Images under 20 MB, between 10 x 10 and 16,000 x 16,000 pixels.

**Cost as published.** Standard (S1): image embeddings $0.10 per 1,000 transactions, text
$0.014 per 1,000. Free (F0): 5,000 transactions a month.

**Access.** An Azure subscription and a Vision resource.

Sources: [multimodal embeddings concepts](https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/concept-image-retrieval),
[Azure Vision pricing](https://azure.microsoft.com/en-us/pricing/details/computer-vision/).

### Anthropic Claude

**What it would do.**

- Rerank and verify the top visual candidates: compare the person's cropped photo with each
  candidate's reference images and catalog facts, read any visible style code, reference or size
  tag, and return structured evidence for each candidate, including "none of these".
- Turn a typed request into the existing chip vocabulary (categories, colors, styles, prices,
  sizes), with the rule-based parser as the fallback and test oracle.
- Optionally reword explanations, given only computed relations and facts, with a check that
  every item and number in the output appears in the input.

Claude's output is evidence, not an identity. The person still confirms the match; size,
authenticity and condition are never taken from a photo; and an identifier the model reads
becomes `identifier_supported` only after the server checks it against the catalog.

**Models and cost as published** (Anthropic API, per million tokens; from Anthropic's current
model reference, pricing cached 2026-09-25):

| Model | Model id | Input | Output | Cache read |
| --- | --- | --- | --- | --- |
| Claude Opus 5.5 | `claude-opus-5-5` | $4.00 | $20.00 | $0.20 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2.00 | $10.00 | $0.20 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1.00 | $5.00 | about $0.10 |

Prompt cache writes cost 1.25 times the input price (5-minute lifetime) or 2 times (1 hour).
The Message Batches API costs half, but it is asynchronous, so it suits catalog jobs, not
interactive scans.

**Image tokens.** An image costs ceil(width / 28) x ceil(height / 28) tokens. A 1,092 x 1,092
photo is 1,521 tokens and a 512 x 512 reference image is 361. Claude 4.7 and later accept up to
2,576 pixels on the long edge (up to 4,784 tokens per image); other models downscale to 1,568
pixels (up to 1,568 tokens). Limits: 10 MB per image on the API, up to 600 images per request on
models with a 1-million-token context. We plan to send the photo at about 1,092 pixels and
reference images at 512.

**Data terms.** Anthropic's vision documentation says uploaded images "are ephemeral and not
stored beyond the duration of the API request" and that Anthropic "does not use uploaded images
to train models". We would send only the person's cropped photo, after the server strips
metadata. Retention of request data otherwise follows the organization's agreement; confirm the
terms when the account is created.

**Operational notes.** Current models can end a response with `stop_reason: "refusal"` from
safety classifiers. The matcher treats that as a processing error (status `error`, retry
allowed) and never as "no match".

**Access.** An Anthropic Console organization with billing and a server-only API key.

**Fallback.** Embedding retrieval alone with stricter abstention (more `similar_result` and
`no_match`, more requests for a style code), or a smaller model if Milestone 1 shows it holds
accuracy.

Sources: [vision guide](https://platform.claude.com/docs/en/build-with-claude/vision),
[pricing](https://platform.claude.com/docs/en/about-claude/pricing).

## Product data, prices and affiliate links

The four affiliate networks below are how Rotation would get product feeds (names, identifiers,
images, prices, stock) and tracked links. Feeds and image terms are set per advertiser, so
approval comes in two steps everywhere: the network accepts Rotation as a publisher, then each
advertiser accepts Rotation into its program.

Before any feed image is shown in a person's collection (not just next to that retailer's
offer), we need in writing, per source: whether display outside a promotional context is
allowed, how long the image may be cached, the attribution required, and how fast a takedown
must be honored. The `catalog_images` table records the first three for every image
(`inventory_display`, `cache_ttl_hours`, `attribution_required`), plus a status that withdraws
the image everywhere at once when a takedown arrives. Until the terms are confirmed, feed images
are shown only next to a live offer from that retailer, and collections fall back to the
person's own photo, which the prototype already does.

Feed prices arrive as decimal numbers or strings ("16.00 USD"). The import converts them to
integer minor units with an ISO currency, and a missing shipping cost or tax stays unknown,
never zero.

### Rakuten Advertising

**What it would do.** Product Catalog data feeds from advertisers in Rakuten's Product Catalog
program, delivered over SFTP as XML or pipe-delimited files, with full and delta (changed
products only) files; plus link tools for tracked deep links.

**Access.** Rakuten's guide for publishers (updated December 2023) says publishers must first
"be approved and set up for the technical implementation of the product data feeds, and then ...
be approved by each of your participating advertiser partners to use their Product Catalog data
feed on your website or blog."

**Confirmed vs needed.** Nothing confirmed. Needed: publisher account, feed implementation
approval, then each advertiser's approval.

**Data.** Fields include SKU, product name, product URL (the tracked link), image URL, sale and
retail price, ISO currency, availability (in stock, out of stock, preorder, backorder), a UPC,
EAN or JAN code, brand and default shipping cost. Freshness depends on how often each
advertiser uploads.

**Cost as published.** No publisher fee found.

**Image and data terms.** Not published in the material we could read. Set by the publisher
agreement and each advertiser's approval.

**Fallback.** The other networks; offers from a refused advertiser simply aren't shown.

Sources: [Product Catalog implementation guide](https://pubhelp.rakutenadvertising.com/hc/en-us/article_attachments/22365119792013),
[developer portal](https://developers.rakutenadvertising.com/).

### CJ

**What it would do.** The Product Feed GraphQL API (`https://ads.api.cj.com/query`) searches
products by keyword, advertiser, price, currency and identifier, and can stream an advertiser's
full feed. Fields include `gtin`, `mpn`, `imageLink`, `link` and price with currency. CJ's
publisher tools also build deep links to joined advertisers' pages (not reviewed in detail).

**Access.** A CJ publisher account and a personal access token. Searches can be limited to
`JOINED` advertisers; CJ's feed guide says "Only joined publishers can subscribe to and export"
an advertiser's full product feed, and feeds an advertiser marks private aren't searchable.

**Confirmed vs needed.** Nothing confirmed. Needed: publisher account, token, and approval by
each advertiser.

**Terms that matter.** CJ's Program Terms API (`https://programs.api.cj.com/query`) returns each
contract's terms, including free-text "special terms" where advertisers state restrictions.
The import should read and store those before using an advertiser's images.

**Cost as published.** No publisher fee found.

**Fallback.** The other networks.

Sources: [Product Feed API reference](https://developers.cj.com/graphql/reference/Product%20Feed),
[Product Feeds guide](https://developers.cj.com/docs/data-imports/product-feeds),
[CJ developer portal](https://developers.cj.com/).

### Impact

**What it would do.** The partner Catalogs API lists the catalogs available to the account,
their items, and searches across them (`/Mediapartners/{AccountSID}/Catalogs`,
`.../Catalogs/{CatalogId}/Items`, `.../Catalogs/ItemSearch`). The Tracking Links API creates
tracked links for a program.

**Data.** Item fields include `Gtin` and `GtinType`, `Mpn`, `ImageUrl`, `AdditionalImageUrls`,
`CurrentPrice` and `OriginalPrice` (strings), `Currency`, `StockAvailability`, `Size`, `Colors`,
`Condition`, `ParentSku` (variant grouping), `ShippingRate`, and `Url`, "the tracking URL for
the product page, unique to your partner account".

**Limits.** Product search endpoints: 3,000 requests an hour. Up to 5,000 vanity links per
account.

**Access.** A partner account with at least one verified property; "impact.com receives your
marketplace application after you complete every step", then brands approve partners. The API
reference doesn't define which catalogs a partner can see; confirm with Impact.

**StockX and GOAT.** StockX's affiliate program runs on Impact. Its FAQ (last updated
2020-08-06, so re-confirm) describes a product feed with "Every product on StockX and its
accompanying Lowest Ask price" in USD, AUD, GBP, EUR and CAD, deep links, a 15-day attribution
window, and manual review "within 48 business hours". Third-party directories list GOAT's
program on Impact too.

**Cost as published.** No fee shown during sign-up.

**Fallback.** For StockX and GOAT, link out without prices (see [marketplaces.md](marketplaces.md)).

Sources: [Catalogs API](https://integrations.impact.com/partner-api-reference/reference/catalogs/catalogs.md),
[rate limits](https://integrations.impact.com/partner-api-reference/readme/rate-limits.md),
[tracking links](https://integrations.impact.com/partner-api-reference/reference/tracking-links/tracking-links.md),
[partner sign-up](https://help.impact.com/partner/getting-started/sign-up-as-a-partner-on-impactcom),
[StockX affiliate FAQ](https://stockx.com/news/affiliate-faq/),
[GOAT on affilitizer](https://www.affilitizer.com/programs/goat.com).

### Awin

**What it would do.** Product feeds, built with Create-a-Feed or downloaded by URL with a feed
API key, and newer "enhanced" feeds in Google's product format as JSON Lines. A feed list
download shows every feed the account can see and when each was last updated, so the import
fetches only changed feeds. The Link Builder API
(`POST /publishers/{publisherId}/linkbuilder/generate`, up to 100 links per call) creates
tracked links and accepts `clickref` parameters, which carry Rotation's pseudonymous click
reference.

**Images.** Awin derives resized copies (200 x 200 and 70 x 70) from the merchant image and
caches them for 30 days. That is a delivery service, not permission to show the image anywhere.

**Access.** Awin checks every application by hand, including identity verification, and aims to
answer within 24 hours. Its GB page asks for a refundable £5 deposit; another Awin help article
mentions 1 EUR, GBP or USD. Confirm the amount at sign-up. Feeds come from advertisers we have
joined, or that allow promotion before joining.

**Chrono24.** Chrono24's US affiliate program is on Awin (advertiser 128225, 60-day cookie,
variable commission). The profile doesn't say whether a product feed is offered.

**Cost as published.** The refundable deposit only.

**Fallback.** The other networks; for Chrono24, plain links without prices.

Sources: [publisher feed guide](https://help.awin.com/developers/docs/product-feed-publisher-guide-intro.md),
[feed list download](https://help.awin.com/developers/docs/product-feed-list-download.md),
[image caching](https://help.awin.com/developers/docs/awin-resize-and-caching-service.md),
[enhanced feed](https://help.awin.com/apidocs/retail-publisher-productapidocumentation-1.md),
[Link Builder API](https://help.awin.com/apidocs/generatelink.md),
[joining](https://www.awin.com/gb/compliance-and-regulations/application-process-and-joining-fee),
[Chrono24 US on Awin](https://ui.awin.com/merchant-profile/128225).

## Sneaker and watch marketplaces

### StockX

**What it would do.** Sneaker catalog facts and current market prices (lowest ask).

**Access.** StockX's Developer Program API covers catalog search, market data, listings and
orders, and is "Available by Request for All Level 3+ Sellers". Its license allows use "for
your internal use only" and treats commercial use as a material breach, as quoted in the
team's [marketplaces.md](marketplaces.md); the license page renders in the browser and could
not be fetched for this note. A shopping advisor for other people doesn't fit that license.

**Usable route.** The affiliate feed through Impact (above), if StockX approves Rotation and the
feed terms allow showing names, prices and images in a third-party app.

**Terms that matter.** StockX's terms prohibit scraping. The production plan doesn't use its
pages, and neither does the prototype: a pasted StockX link is never requested (StockX also
answered 403 to the one test request on 2026-10-15). Rotation reads the link's words instead
(see [marketplaces.md](marketplaces.md)).

**Fallback.** Paste-a-link import as text, confirmed by the person, and a plain link to StockX's
own search.

Sources: [professional sellers](https://stockx.com/about/professionalsellers),
[license](https://developer.stockx.com/portal/license-agreement),
[affiliate FAQ](https://stockx.com/news/affiliate-faq/).

### GOAT

**What it would do.** Sneaker catalog facts and prices.

**Access.** No official public or partner API was found. An affiliate program is listed by
third-party directories (Impact, about 2% commission); no product-feed or image terms were
found.

**Fallback.** As for StockX: link import as text and a plain link out.

Sources: [affilitizer](https://www.affilitizer.com/programs/goat.com),
[linkclicky](https://linkclicky.com/affiliate-program/goat/), [marketplaces.md](marketplaces.md).

### Chrono24

**What it would do.** Pre-owned and new watch listings with dealer and private seller types,
which the offer model already distinguishes.

**Access.** No public API was found; Chrono24 works with dealers directly. The affiliate program
is on Awin (above).

**Fallback.** Affiliate links to Chrono24 search or listing pages without prices; watch offers
from dealers who join through the networks.

Sources: [Chrono24 US on Awin](https://ui.awin.com/merchant-profile/128225).

## Barcodes and GTINs

### GS1 US Data Hub

**What it would do.** Check that a GTIN read from a barcode or typed by the person is a real,
correctly assigned GTIN and belongs to the brand we expect, before it counts as identifier
evidence. GS1 describes it as a way to "verify that the products you're listing are associated
with the right Global Trade Item Numbers (GTINs)/UPCs and companies". The six "Verified by GS1"
attributes are brand name, product description, product image URL, GS1 product classification,
net content and target market.

**What it won't do.** It identifies a product and its brand owner, not a colorway's catalog
image we may show. An image URL in GS1 data carries no display permission for us.

**Cost as published.** Product View/Use: $500 a year for one user, $1,000 for up to 5, $1,500
for up to 10, $2,500 unlimited. API add-on: $6,500 a year. Export add-on: from $5,000 a year.

**Access.** A GS1 US Data Hub subscription.

**Fallback.** GTINs from affiliate feeds, checked against the catalog. The migration already
rejects GTINs with an invalid GS1 check digit.

Sources: [GS1 US Data Hub](https://www.gs1us.org/tools/gs1-us-data-hub),
[View/Use pricing](https://store.gs1us.org/product-view-use/p),
[API add-on](https://store.gs1us.org/add-on-api/p).

### UPCitemdb

**What it would do.** Look up a scanned barcode and return product titles and offers from many
sources, as a hint the person confirms.

**Cost as published.** Explorer: free, 100 combined requests a day per IP, no sign-up. Dev: $99 a
month (20,000 lookups and 2,000 searches a day). Pro: $699 a month (150,000 lookups a day).

**Terms that matter.** Data comes "as-is", with "no guarantees on availability or accuracy".
The terms make the customer warrant that its use of any copyrighted data won't infringe anyone's
rights, so its images aren't usable for display. Results can carry UPCitemdb's own affiliate
links (domain `upcitemdb.com`), so its offers can't feed Rotation's offer comparison.

**Fallback.** Typed codes and feed GTINs.

Sources: [plans](https://devs.upcitemdb.com/), [rate limits](https://www.upcitemdb.com/wp/docs/main/development/api-rate-limits/),
[terms](https://devs.upcitemdb.com/termsofservice).

## Platform

### Supabase

**What it would do.** Auth (accounts and sessions), Postgres with row-level security (the
migrations in `supabase/migrations/`), Storage for photos and catalog files, and background work
through Queues (pgmq) and pg_cron.

**Plans as published.**

- Free: 50,000 monthly active users, 500 MB database, 1 GB file storage, 5 GB egress. Projects
  pause after a week of inactivity, so it is for prototypes only.
- Pro, from $25 a month: 100,000 monthly active users then $0.00325 each; 8 GB disk per project
  then $0.125 per GB; 250 GB egress then $0.09 per GB; 250 GB cached egress then $0.03 per GB;
  100 GB file storage then $0.0213 per GB; daily backups kept 7 days; $10 a month of compute
  credit, which covers a Micro instance.
- Compute: Micro $10, Small $15, Medium $60, Large $110 (2 dedicated CPUs), XL $210 a month.
- Point-in-time recovery: $100 a month per 7 days of retention.
- Image transformations: 100 origin images included, then $5 per 1,000.
- Team, from $599 a month: adds SOC 2 and ISO 27001 reports, SSO, and a HIPAA add-on.

**Extensions the schema uses.** `vector` (pgvector) for embeddings and `pg_jsonschema` for JSON
Schema check constraints (`jsonb_matches_schema`). Both are installed into the `extensions`
schema.

**Terms that matter.**

- Buckets are private by default. A public bucket serves any file to anyone holding its URL,
  which is why only unconditionally displayable catalog images go there.
- Signed URLs "remain valid until their expiry time regardless of any Auth key changes", and
  revoking them takes a support request. Photo URLs must be short-lived so that revoking a
  stylist share takes effect quickly.
- Files must be deleted through the Storage API; deleting rows with SQL "will result in the
  object being orphaned".
- Authorization data belongs in `app_metadata` or a custom access token hook, never in
  `user_metadata`, which the person can change.

**Access.** An organization and project, owned by the business, with the service role key kept
on the server only.

**Fallback.** Any managed Postgres 15+ with pgvector plus S3-compatible storage; the RLS helpers
depend on Supabase's `auth.uid()` and `auth.jwt()` and would need equivalents.

Sources: [pricing](https://supabase.com/pricing),
[row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security),
[custom claims](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac),
[storage access control](https://supabase.com/docs/guides/storage/security/access-control),
[serving files](https://supabase.com/docs/guides/storage/serving/downloads),
[deleting objects](https://supabase.com/docs/guides/storage/management/delete-objects),
[pg_jsonschema](https://supabase.com/docs/guides/database/extensions/pg_jsonschema),
[pgvector](https://supabase.com/docs/guides/database/extensions/pgvector).

### Vercel

**What it would do.** Host the Next.js app: pages, server route handlers, cron and queue
consumers.

**Plans as published.** Hobby is free and "for personal, non-commercial use", so it doesn't fit
a business. Pro is $20 a month per developer seat (viewer seats free) with $20 of included usage
credit. Pro includes, among others: 4 hours of Active CPU a month (then from $0.128 an hour),
360 GB-hours of provisioned memory (then from $0.0106 per GB-hour), 1 million function
invocations (then $0.60 per million), 100 GB of fast data transfer under the flat-rate CDN, and
5,000 image transformations (then from $0.05 per 1,000).

**Access.** A team account owned by the business.

**Fallback.** Netlify, or any Node host.

Sources: [Vercel pricing](https://vercel.com/pricing).

### Netlify

**What it would do.** The same hosting role.

**Plans as published.** Free (300 credits a month), Personal $9 a month (1,000 credits), Pro $20
a month with unlimited members (3,000 to 20,000 credits a month by tier). Usage is counted in
credits; a production deploy costs 15.

Sources: [Netlify pricing](https://www.netlify.com/pricing/).

### Tesseract.js

**What it does today.** The prototype's optional on-device label reading
(`js/engine/ocr.js`). Version 7.0.0 (2025-12-15), Apache-2.0 license, a WebAssembly port of the
Tesseract engine. It doesn't change Tesseract's recognition model and doesn't read PDFs.

**Terms that matter.** Label reading never sends the photo anywhere. By default the library loads its
worker, core and language data from the jsDelivr CDN; production should host those files itself
(`workerPath`, `corePath`, `langPath`) so label reading doesn't depend on, or send requests to, a
third-party CDN.

**Cost.** Free; only the download size of the language data.

**Fallback.** Claude or the Cloud Vision API on the server, or a typed code.

Sources: [repository](https://github.com/naptha/tesseract.js),
[local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md),
[npm](https://www.npmjs.com/package/tesseract.js).
