# Rotation

Rotation is a class prototype of an AI closet and shopping advisor. You photograph what you
own, confirm what it is, and the app builds a collection, suggests what goes with it, keeps a
wishlist and compares retailer offers. It is a mobile-first web app in plain HTML, CSS and
JavaScript with no build step.

It now also has a small local Node server (`npm start`) that looks up **real products** from
online stores: paste a store's product link, search online stores by name, or search with a
photo through Microsoft Bing. Everything else runs in the browser.

Engineers: the design contract is [ARCHITECTURE.md](ARCHITECTURE.md). The production plan is
[docs/PLAN.md](docs/PLAN.md).

## What is real and what is demo

| Part | Status |
| --- | --- |
| Photo pipeline (orientation, metadata stripping, cropping, background removal, color and shape features, optional label reading) | Real, runs on your device |
| Matching against the catalog, identity and version checks, abstaining when unsure | Real logic, but matched against a fictional catalog |
| Catalog, brands, retailers, offers, prices, affiliate links | Demo. Fictional, labeled as demo, store domains end in `.example` |
| Accounts and the "server" for your data | Demo. A module layer in the browser tab, data in IndexedDB |
| Product page lookup (paste a link) | Real, with `npm start` |
| Search online stores (Bing Shopping and Bing web results) | Real, with `npm start` |
| Photo search (Bing visual search) | Real, with `npm start`, only when you press the button |
| Recommendations and offer comparison | Real logic over the demo catalog only. Real products you save are not ranked against real offers |

Real products you save are your own custom items. Rotation never turns them into catalog
matches, and it never takes a size, condition or authenticity from a store page or photo. A
store price is kept as "Seen at Nike for $115, checked 2 hours ago", not as an offer or a price
you paid.

## How to run it

You need Node.js 24 or newer.

```sh
cd closet-advisor
npm start
```

`npm start` uses port 8130, or the next free port up to 8139, and prints the address, for
example `Rotation is running at http://127.0.0.1:8130/`. Open that address in your browser.
To pick a port yourself, run `npm start -- --port 8140` (or `PORT=8140 npm start`). Stop the
server with Ctrl+C.

Without `npm start`, Rotation runs in demo mode:

- The GitHub Pages copy (`https://ttakita-su.github.io/ist300-sandbox/closet-advisor/`) stays
  in demo mode. The live features say "Real store search needs the local server", and demo
  store links (`.example`) still work.
- `python3 -m http.server` from the repo root, or `npm run serve` here, also serves demo mode.

No `npm install` is needed to run the app. `npm install` is only for the browser tests
(Playwright).

### Using it from a phone on the same Wi-Fi

The server listens only on this computer (`127.0.0.1`) by default. To open it from a phone on
the same Wi-Fi network:

```sh
HOST=0.0.0.0 npm start
```

Then open `http://<your computer's LAN address>:8130/` on the phone (on a Mac, the LAN address is
under System Settings, Wi-Fi, Details). Be careful with this:

- Anyone on that network who can reach the address can use the server to make lookups from
  your computer. Use it only on a network you trust, such as your home Wi-Fi, and stop it when
  you're done.
- Each address keeps its own data. Items saved at `127.0.0.1:8130` won't appear at your LAN
  address, at `localhost:8130`, at another port, or on GitHub Pages.

## Live features

All three need `npm start`. Each one makes a small number of requests from your computer, one
person action at a time.

| Feature | Where | What you get |
| --- | --- | --- |
| Paste a product link | Add, Paste a product link (`/add/link`) | The server reads that one page (plus one Shopify data file on the same store, when the store uses Shopify). You get the name, brand, store image, price, availability, color, style code or barcode, and a form to check before saving. |
| Search online stores | Add, Search online stores (`/add/web`) | Bing Shopping listings (thumbnail, title, price, seller) and Bing web results for store pages. A listing opens the save form directly; a store page is read like a pasted link first. |
| Photo search | On the match screen after a photo, Search online stores | The photo goes to Bing visual search, which names the item ("Bing recognized this as: Casio F-91W") and returns the same listings and store pages for that name. Your photo stays the item's photo; the store image is saved as an extra option. |

When you save, "Save the store's image with it" downloads the store image through the server
and keeps a re-encoded copy in this browser, so the item doesn't depend on the store later.
Item details show "Seen at {store} for {price}, checked {time}" and a plain "View on {store}"
link (not an affiliate link).

Example results from a test run on 2026-10-15:

- A Nike Air Force 1 '07 link gave the name, brand, $115.00, the color White/White, the style
  code CW2288-111 and 22 sizes.
- A search for "Casio F-91W" gave 24 Bing Shopping listings (for example Walmart, $28.99) and
  10 store pages.
- Photos of a Casio F-91W and of Converse Chuck Taylors were recognized as "Casio F-91W" and
  "Converse Chuck Taylor All Star" in about 6 to 7 seconds.

### Stores that block automated lookups

In testing, these stores refused automated lookups: **adidas, New Balance, Levi's, Casio,
eBay, StockX, GOAT and Patagonia** (a 403 "Access denied" page, a bot check, or a waiting room).
Stores that worked included Nike, Converse, Vans, Allbirds, Timex, Zappos, Foot Locker, END,
Seiko and Amazon. This changes over time.

When a store blocks a lookup, Rotation:

- says so ("Automated lookups aren't allowed on adidas.com. Enter the details yourself, or try
  another store's link.") and offers "Enter it yourself", prefilled with what it knows, plus a
  link to open the page yourself;
- for StockX and GOAT links, fills in the brand, model and style code from the words in the
  link instead. Their terms forbid automated access, so Rotation never requests their pages at
  all;
- does not try again and does not try to get around the block. That store is left alone for
  30 minutes; lookups during that time get the same message without contacting it.

## Privacy

- Your items, photos, notes and sizes are kept in this browser (IndexedDB). Nothing is synced.
- **Your photo leaves your device only when you press Search online stores** on the match
  screen. The line under the button says it goes to Microsoft Bing. Rotation sends the 768 px
  copy it already made, re-encoded without EXIF or GPS data, rotated the way you rotated it.
  Bing's own privacy terms then apply to it.
- A pasted link goes to that store. A typed search goes to Bing. Both are sent from your
  computer by the local server, so the stores and Bing see your computer's internet address.
- The local server keeps nothing on disk. It holds answers in memory for 15 minutes so the same
  lookup isn't repeated, keeps Bing's session cookie in memory for Bing only, and forgets all of
  it when it stops. It doesn't keep your photo: the photo is held only while its request runs
  (the in-memory cache is keyed by a fingerprint of the photo, not the photo itself).
- Thumbnails in result lists and previews load straight from the store's or Bing's image
  server, without a referrer. Saved items show the copy kept in this browser.
- Store images you save count as your data: they're included in Export my data, removed with
  the item or the account, and shown to a stylist only when you share photos.
- Usage metrics record only statuses and counts, never links, hosts, searches or who you are.

## Ethics and terms

This is an educational prototype. It is built to be a polite, honest client, and it is meant
for low-volume personal use while you run it for a class, not for anything public or
commercial.

- **Honest User-Agent.** Every request says
  `Mozilla/5.0 (compatible; RotationLookup/0.1; educational prototype)`. It doesn't pretend to
  be a browser, and it uses no headless browser, stealth tricks or CAPTCHA solving.
- **No getting around blocks.** A 401, 403 or 429, a CAPTCHA, a "verify you are human" page,
  or a bot-protection or waiting-room page counts as a block. Nothing is retried, and that site
  gets no more requests for 30 minutes.
- **Low volume.** One page per action (plus at most one Shopify data file on the same store),
  at least 1 second between requests to the same site, a 15-minute cache, no crawling and no
  prefetching. Each person gets 60 lookups and searches (photo searches included) per hour, and
  240 store-image saves per hour.
- **No Google.** Google blocks automated use of Lens and Search (in testing it answered with its
  "unusual traffic" page), so Rotation doesn't contact Google at all.
- **Bing is unofficial.** Rotation reads Bing's public web pages, not a documented API. Those
  pages can change at any time, and Microsoft's terms don't grant automated access. Keep use
  low and personal.
- **Store terms.** Many stores' terms limit automated access; some (StockX and GOAT among them)
  forbid it. Rotation reads one public page per tap with an honest User-Agent and stops as soon
  as a site says no, but that doesn't make it permitted. It doesn't check `robots.txt`.
- Store names, prices and images belong to their owners. They're shown as found, with where and
  when they came from.

## Tests

| Command | What it covers |
| --- | --- |
| `npm test` | Unit tests in Node (`tests/unit/*.test.mjs`): the server layer, matching, recommendations, access rules, and the live-lookup code with fake answers: the backend's request guard (address checks, redirects, size and type limits, block detection, cooldowns, spacing, caching), the product-page extractor, the Bing parsers, the server's request checks, and saving web items |
| `npm run test:e2e` | Browser checks in Chromium (needs `npm install` once): every route as each role, the photo pipeline, and the real-product flows (a pasted link, an online search and a photo search, each to a saved item, a store that blocks, and demo mode) |
| `npm run eval` | The synthetic matching evaluation; rewrites `docs/evaluation.md` |

**The tests never use the network.** The live-lookup tests run the real server code against
made-up store and Bing pages in `tests/fixtures/web/upstream.mjs` (hosts under `.fixture.alt`,
which never resolve on the internet), and the browser test refuses any request that would leave
the machine. The one exception is `npm run test:e2e -- --ocr`, which downloads the label
reader from jsDelivr.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| "Port ... is already in use" | Another program has every port from 8130 to 8139. Stop one of them, or run `npm start -- --port 8140`. |
| "Real store search needs the local server" | You opened Rotation from GitHub Pages, `python3 -m http.server` or `npm run serve`, or from a different address than the one `npm start` printed. Run `npm start` and open the printed address. If you started the server after opening the page, reload. |
| "The local server didn't answer" | `npm start` stopped or crashed. Check its terminal window, start it again, then reload. |
| My items are gone | Data is kept per address. Open the same address (host and port) you used before. |
| "Automated lookups aren't allowed on ..." | That store blocks automated lookups. Enter the item yourself, or try the same product at another store. Rotation won't ask that store again for 30 minutes. |
| "Bing isn't accepting automated searches ..." | Bing returned a bot check. Wait about 30 minutes before searching again, and search less often. |
| "Bing's photo search page has changed" or no listings come back | Bing changed its pages, so the parser no longer finds what it needs. Search by name or enter the item yourself. Fixing it means updating `backend/bing.mjs`. |
| "That page ... doesn't look like a single product" | Open the product itself (not a category or search page) and copy its link. |
| "You've reached the limit of 60 web searches an hour" | Lookups and searches are limited to 60 an hour per person. Wait for the time it gives, or enter the item yourself meanwhile. |
