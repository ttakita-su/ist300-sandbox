# Rotation

Rotation is a class prototype of an AI closet and shopping advisor. You photograph what you
own, confirm what it is, and the app builds a collection, lets you save outfits made from it,
suggests what goes with it, keeps a wishlist and compares retailer offers. It is a
mobile-first web app in plain HTML, CSS and JavaScript with no build step.

It now also has a small local Node server (`npm start`) that looks up **real products** from
online stores: paste a store's product link, search online stores by name, or search with a
photo. Everything else runs in the browser.

**Photo search needs a model to name the item (since 2026-11-05).** Bing's image-upload page now
requires browser verification instead of the signed upload token this prototype supported, and
Rotation doesn't try to get past that. Instead, a vision model names the item in the photo
(brand, model, color), and the local server searches Bing Shopping and the web for that name, the
same search as typing it yourself. There are two ways to set that up:

- **Free, on this computer:** a vision model in [Ollama](https://ollama.com/). No key and no
  account; the photo goes to no online service, and only the name it finds goes to Bing. See
  [Free photo search on this computer](#free-photo-search-on-this-computer).
- **Claude:** an Anthropic API key, which you pay for. More accurate at exact models. See
  [Turning on photo search with Claude](#turning-on-photo-search-with-claude).

With neither, the photo search falls back to Bing visual search, which currently answers that
browser verification is required; Rotation then offers **Open Bing Visual Search** and
**Label it myself**.

To add your own clothes, take or upload a photo and press **Search online for this item**.
The prepared photo goes to the local model or Claude (or Bing visual search, with neither), which
suggests a product name, and Rotation shows online listings for it. Choose a result and check its details
before saving; a result can be a lookalike. Your original photo stays with the saved item. There
is no demo-catalog scan before this search.

If no result is suitable, the search is blocked, or the local server is unavailable, choose
**Label it myself**. You can also choose that straight after taking the photo without sending
it anywhere. Enter a name, optional clothing brand, type, color/version and main colors;
**Edit details** on the saved item lets you change these later. Sample photos still offer
**Try demo matching** to demonstrate the on-device catalog matcher.

Engineers: the design contract is [ARCHITECTURE.md](ARCHITECTURE.md). The production plan is
[docs/PLAN.md](docs/PLAN.md).

## What is real and what is demo

| Part | Status |
| --- | --- |
| Photo pipeline (orientation, metadata stripping, cropping, background removal, color and shape features, optional label reading) | Real, runs on your device |
| Matching against the catalog, identity and version checks, abstaining when unsure | Real logic, but matched against a fictional catalog |
| Catalog, brands, retailers, offers, prices, affiliate links | Demo. Fictional, labeled as demo, store domains end in `.example` |
| Accounts and the "server" for your data | Demo. A module layer in the browser tab, data in IndexedDB |
| Outfits (Collection, Outfits: build, view, edit and delete named sets of your own items) | Real, kept in this browser like your items. Outfits are never shared with a stylist and are not used for suggestions |
| Product page lookup (paste a link) | Real, with `npm start` |
| Search online stores (Bing Shopping and Bing web results) | Real, with `npm start` |
| Photo search (a model names the item, then Bing Shopping and web search) | Real, with `npm start` and either a vision model in Ollama on this computer (`OLLAMA_PHOTO_MODEL`, free) or an Anthropic API key in `.env`. With neither it falls back to Bing visual search, which currently refuses automated uploads (browser verification), so only Open Bing Visual Search and manual labeling work |
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
- `python3 -m http.server 8000 --bind 127.0.0.1` from the repo root, or `npm run serve` here,
  also serves demo mode. Keep the `--bind`: Python's server hands out every file, including a
  `.env` with your API key, and without it anyone on your network can reach it. `npm start` and
  `npm run serve` never serve dotfiles.

No `npm install` is needed to run the app. `npm install` is only for photo search with Claude
(the Anthropic SDK) and the browser tests (Playwright).

### Free photo search on this computer

A vision model runs in [Ollama](https://ollama.com/), a free app, on the same computer as
`npm start`. It needs about 6 GB of disk for the model and works best on a Mac with Apple silicon
or a computer with a recent graphics card.

1. Install Ollama: `brew install ollama` on a Mac, or the installer from ollama.com.
2. Start it: `ollama serve` in a terminal (keep it open), or open the Ollama app. To have it
   start by itself at login on a Mac, run `brew services start ollama` instead.
3. Download the model once: `ollama pull qwen3-vl:8b-instruct` (about 6 GB).
4. In `closet-advisor/.env`, add the line `OLLAMA_PHOTO_MODEL=qwen3-vl:8b-instruct`. This is a
   model name, not a secret.
5. Restart `npm start`. It prints `Photo search is on: qwen3-vl:8b-instruct in Ollama on this
   computer ...`, then `The photo model is loaded.`

Use the `-instruct` model. The plain `qwen3-vl:8b` tag thinks through each photo first and took
53 to 70 seconds per photo on an M3 Pro, longer than Rotation waits (40 seconds). The instruct
model took about 9 seconds for a new photo there. It is less accurate than Claude at exact models
and can guess a brand wrong, so check the results before saving, as with any photo search.
When `ANTHROPIC_API_KEY` is also set, Claude is used instead.

### Turning on photo search with Claude

Photo search needs an Anthropic API key (from the [Claude Console](https://platform.claude.com/),
with billing set up) and the Anthropic SDK:

1. In the `closet-advisor` folder, run `npm install` once. It installs the Anthropic SDK (and
   the browser-test tools).
2. Create the file `closet-advisor/.env` in your editor and add one line:
   `ANTHROPIC_API_KEY=` followed by your key. Type or paste the key there yourself, not into a
   chat or an AI tool. `.env` is ignored by git, and `npm start` never serves dotfiles; don't
   serve this folder with a plain static server on your network (see demo mode above).
3. Restart `npm start`. It prints `Photo search is on: photos go to Claude (claude-opus-5-5) ...`.

`npm start` reads `.env` itself; a variable already set in your shell wins over the file. The
key stays on your computer and goes only to Anthropic, inside the server's requests; it never
reaches the browser. Optional: `ANTHROPIC_PHOTO_MODEL` picks another Claude model, for example
`claude-haiku-5-5`, which costs far less per photo. Each photo is one Claude request with the
768 px image, at low effort; with the default model we estimate about one US cent or less
per photo (it varies with how long Claude thinks; the Claude Console shows the real cost). The
server sends at most 60 photos to Claude per hour and asks Claude only once per photo for 15
minutes (a retry after Bing failed reuses Claude's name for it). Anthropic's usage policies and API data terms apply to the photos it receives.

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
- With `ANTHROPIC_API_KEY` set, anyone who can reach the address can also run photo searches
  billed to your key (up to 60 an hour); `npm start` prints a warning. To share the server
  without that, start it with the key cleared: `ANTHROPIC_API_KEY= HOST=0.0.0.0 npm start`.
- Each address keeps its own data. Items saved at `127.0.0.1:8130` won't appear at your LAN
  address, at `localhost:8130`, at another port, or on GitHub Pages.

## Live features

All three need `npm start`; photo search also needs the local model or an Anthropic API key. Each one makes a small number of requests from your computer, one
person action at a time.

| Feature | Where | What you get |
| --- | --- | --- |
| Paste a product link | Add, Paste a product link (`/add/link`) | The server reads that one page (plus one Shopify data file on the same store, when the store uses Shopify). You get the name, brand, store image, price, availability, color, style code or barcode, and a form to check before saving. |
| Search online stores | Add, Search online stores (`/add/web`) | Bing Shopping listings (thumbnail, title, price, seller) and Bing web results for store pages. A listing opens the save form directly; a store page is read like a pasted link first. |
| Photo search | After taking/uploading a photo, Search online for this item; existing demo match results also offer Search online stores | The local model (with `OLLAMA_PHOTO_MODEL`) or Claude (with an Anthropic key) names the item in the photo and the server searches Bing Shopping and the web for that name; with neither, the photo goes to Bing visual search. Check which result is yours, or choose Label it myself. Your photo stays the item's photo; a store image can be saved as an extra option. |

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

- Your items, outfits, photos, notes and sizes are kept in this browser (IndexedDB). Nothing is
  synced. Export my data includes your outfits; deleting your account removes them.
- **Your photo leaves your device only when you press a photo-search button**: Search online
  for this item on the preview, or Search online stores / Search again on the results screen.
  The text beside the button says where it goes: Anthropic's Claude when the server has a key,
  otherwise Microsoft Bing. Rotation sends the 768 px copy it already made, re-encoded without
  EXIF or GPS data, rotated the way you rotated it. That service's own terms then apply to it.
  With Claude, only the name Claude gives (not the photo) is then sent to Bing.
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
- **Claude is a documented API.** Photo search uses Anthropic's Messages API with your own key,
  through the official SDK. The server caps it at 60 photos an hour.
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
| `npm test` | Unit tests in Node (`tests/unit/*.test.mjs`): the server layer, matching, recommendations, access rules, and the live-lookup code with fake answers: the backend's request guard (address checks, redirects, size and type limits, block detection, cooldowns, spacing, caching), the product-page extractor, the Bing parsers, Claude photo identification against a fake SDK (the request it sends, its answers, every failure, the hourly cap), the server's request checks, saving web items, and outfits (limits, duplicate names, ownership, the item-delete cascade, export and deletion) |
| `npm run test:e2e` | Browser checks in Chromium (needs `npm install` once): every route as each role, the photo pipeline, and the real-product flows (a pasted link, an online search and a photo search, each to a saved item, a store that blocks, and demo mode), the closet inventory (the eight D08 checks for adding, listing, editing and deleting your own items, with reloads, two break tests per action and a desktop dark pass), and outfits (create, view, edit and delete with reloads, the D08 break tests, a desktop dark pass, and the database upgrade from version 1) |
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
| "Bing now requires browser verification for photo uploads" | The server has no photo model set up, so it tried Bing's photo upload, which no longer works for automated tools. Set up the free local model ([Free photo search on this computer](#free-photo-search-on-this-computer)) or add `ANTHROPIC_API_KEY` ([Turning on photo search with Claude](#turning-on-photo-search-with-claude)), restart `npm start` and reload Rotation. Meanwhile choose Open Bing Visual Search to select the photo on Bing's own page, or Label it myself. |
| "Ollama isn't running on this computer" | Start it with `ollama serve` in a terminal (or open the Ollama app), then search again. `npm start` doesn't need restarting. |
| "Ollama doesn't have the model ..." | Run `ollama pull` with the model name in the message, or fix `OLLAMA_PHOTO_MODEL` in `closet-advisor/.env` and restart `npm start`. |
| "The local model took too long to answer" | The first photo after about 30 minutes without one waits for the model to load. Search again. If it keeps happening, the computer may be too slow for this model. |
| "Claude refused the API key" | The key in `.env` is wrong, revoked or has a typo. Copy it again from the Claude Console, then restart `npm start`. |
| "Claude's API refused the request" | Usually billing: the key's organization has no credit or hit a spend limit. Check Billing and Limits in the Claude Console. |
| "Photo search with Claude needs its library" | Run `npm install` in the `closet-advisor` folder, then restart `npm start`. |
| "Claude doesn't offer the model named in ANTHROPIC_PHOTO_MODEL" | The model id in `.env` is misspelled or retired. Fix it (for example `claude-haiku-5-5`) or delete the line to use the default, then restart `npm start`. |
| "Rotation's photo search changed since this page was opened" | `npm start` was restarted with or without a Claude key after you opened the page, so the page's note about where the photo goes was out of date. Reload, check the note, and search again. |
| "Claude couldn't name a sneaker, watch or clothing item" | Claude didn't see one item clearly. Take a closer photo with the item filling the frame, or search by name. |
| "Rotation has sent 60 photos to Claude in the last hour" | The server's own cap, to keep costs down. Wait, or label the item yourself. |
| "That page ... doesn't look like a single product" | Open the product itself (not a category or search page) and copy its link. |
| "You've reached the limit of 60 web searches an hour" | Lookups and searches are limited to 60 an hour per person. Wait for the time it gives, or enter the item yourself meanwhile. |
