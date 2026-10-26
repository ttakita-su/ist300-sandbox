# ist300-sandbox

A sandbox repository for **IST300 — Prompts to Products** (Syracuse University). It holds
the hand-written static sites and lab deliverables built over the course of the semester.

**Live site:** https://ttakita-su.github.io/ist300-sandbox/

Everything is plain HTML, CSS, and JavaScript — no build step, no frameworks, no runtime dependencies.
GitHub Pages serves the `main` branch from the repository root, so anything pushed to
`main` is live within about a minute.

## Layout

```
.
├── index.html       landing page linking to every site
├── free-bet/        Free Bet Strategy Trainer — playable prototype
│   └── extension/   its Chrome extension (side panel advisor, prototype)
├── prd/             Free Bet PRD, published as a web page
├── blackjack/       Blackjack 101 — four pages
├── ist400-blogsite/ Post-Credits — movie and TV blog template
├── closet-advisor/  Rotation — closet and shopping advisor prototype (plus a local Node server)
├── prd/             Free Bet trainer PRD as a web page
├── docs/            lab write-ups
└── archive/         old scratch files
```

One folder per site, each with its own `index.html` so the live URL is a clean folder path,
and its own `style.css` where the pages share styling.

## Free Bet Strategy Trainer

Open [`free-bet/index.html`](free-bet/index.html) for the playable PRD implementation: random hands, strategy feedback, rule primer, and saved hand history. Its strategy charts and hand engine live in [`free-bet/extension/strategy.js`](free-bet/extension/strategy.js), which the trainer and the Chrome extension both load. Run `node free-bet/tests.cjs` for the 200-case strategy regression, the engine checks, and the extension's tests. Source assumptions and remaining validation are documented in [`free-bet/STRATEGY.md`](free-bet/STRATEGY.md).

### Chrome extension (prototype, PRD F9)

[`free-bet/extension/`](free-bet/extension/) is a Manifest V3 extension, Blackjack Strategy Advisor, that opens in Chrome's side panel beside an online table. Type your two cards and the dealer's upcard, and it shows the basic-strategy play. A switch at the top of the panel, or the G key, picks the game:

- **Free Bet**: Free Bet Blackjack. The panel says whether a double or split is free. It reads the same `strategy.js` as the trainer, and a test plays thousands of trainer rounds through the panel to check that the two agree on every decision.
- **Blackjack**: regular blackjack, where every double and split costs a bet equal to your first.

Each round keeps the game it was played in. Switching mid-round regrades that round's answers; switching after a round ends starts a new one, and Backspace brings the old round back.

To try it online without installing anything, open the
[panel preview](https://ttakita-su.github.io/ist300-sandbox/free-bet/extension/sidepanel.html) or the
[extension emulator](https://ttakita-su.github.io/ist300-sandbox/free-bet/emulator/).

#### Installing from GitHub

The extension isn't on the Chrome Web Store, so it's installed from this repository in Developer mode:

1. On the [repository page](https://github.com/ttakita-su/ist300-sandbox), click the green **Code** button, then **Download ZIP**.
2. Unzip the download. The extension is in `ist300-sandbox-main/free-bet/extension`.
3. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `extension` folder (the one containing `manifest.json`).
5. Click the puzzle-piece icon in the toolbar and pin **Blackjack Strategy Advisor**. Click its icon, or press ⌘⇧Y / Ctrl+Shift+Y, to open the side panel.

Keep the unzipped folder: Chrome loads the extension from it, so deleting or moving it removes the extension. Updates aren't automatic. To get a newer version, download the ZIP again, replace the folder, and click the reload icon on the extension's card in `chrome://extensions`. Chrome may warn about developer-mode extensions; that's expected for anything installed this way.

Type every card you're dealt: your two cards, the dealer's upcard, then each card you draw. A card you type means you followed the last answer; press H, S, D or P first when you did something else. U (or the dealer row) enters the dealer's card at any point, Backspace undoes, N starts a new round, and G switches games. Looked-up hands are kept in the panel's History tab, each tagged with its game.

The extension asks only for the `sidePanel` and `storage` permissions. It has no access to web pages, makes no network requests, and keeps hands in `chrome.storage.local` on the device. The panel can also be opened as a plain page (`free-bet/extension/sidepanel.html`) for a quick look; it then stores hands in `localStorage`.

#### The regular blackjack chart

It assumes six decks, a dealer who hits soft 17 and peeks for blackjack, 3 to 2 blackjacks, doubling on any first two cards (after splits too), splits up to four hands with aces resplittable, and no surrender. The chart is the [Wizard of Odds 4–8 deck chart](https://wizardofodds.com/games/blackjack/strategy/4-decks/) for a dealer who hits soft 17, checked on 6 October 2026 three ways: against Wizard of Odds' own six-deck tables, against independent charts (Ken Smith's Blackjack Info engine and others), and against an exact six-deck calculation. All three agree on every cell. Where the chart's double isn't possible (three or more cards), the panel shows its printed fallback: hit, or stand for a soft 18 or 19. A pair that can't split because four hands are in play is played as its total, so this game never leaves a gap. The trainer page stays Free Bet only. Details are in [`free-bet/STRATEGY.md`](free-bet/STRATEGY.md).

## Closet Advisor: Rotation ([`closet-advisor/`](closet-advisor/))

A mobile-first prototype of an AI closet and shopping advisor: photograph what you own, confirm
what it is, save outfits made from it, get picks that go with it, keep a wishlist and compare
retailer offers. The photo pipeline and matching run in the browser against a fictional demo
catalog (brands, retailers and prices are made up and labeled as demo). Live at
[/closet-advisor/](https://ttakita-su.github.io/ist300-sandbox/closet-advisor/), in demo mode.

It also has three live features that look up **real products**: paste a store's product link,
search online stores by name (Bing Shopping and Bing web results), and search with a photo
(Bing visual search, only when you press the button). These need the small local Node server in
the folder:

```bash
cd closet-advisor
npm start          # prints the address to open, usually http://127.0.0.1:8130/
```

GitHub Pages and `python3 -m http.server` can't run that server, so there the live features say
they need it, and everything else works in demo mode. How to run it, what is real, privacy, the
stores that block automated lookups, and troubleshooting are in
[`closet-advisor/README.md`](closet-advisor/README.md); the design contract is
[`closet-advisor/ARCHITECTURE.md`](closet-advisor/ARCHITECTURE.md). Run `npm test` in the
folder for the unit tests and `npm run test:e2e` for the browser checks (neither uses the
network).

## Sites

### Blackjack 101 ([`blackjack/`](blackjack/))

A four-page guide to the game of 21.

| Page | File | Live |
| --- | --- | --- |
| Home | [`blackjack/index.html`](blackjack/index.html) | [/blackjack/](https://ttakita-su.github.io/ist300-sandbox/blackjack/) |
| Rules | [`blackjack/rules.html`](blackjack/rules.html) | [/blackjack/rules.html](https://ttakita-su.github.io/ist300-sandbox/blackjack/rules.html) |
| Basic Strategy | [`blackjack/strategy.html`](blackjack/strategy.html) | [/blackjack/strategy.html](https://ttakita-su.github.io/ist300-sandbox/blackjack/strategy.html) |
| Glossary | [`blackjack/glossary.html`](blackjack/glossary.html) | [/blackjack/glossary.html](https://ttakita-su.github.io/ist300-sandbox/blackjack/glossary.html) |

All four share [`blackjack/style.css`](blackjack/style.css).

### Post-Credits ([`ist400-blogsite/`](ist400-blogsite/))

A movie and TV blog template for IST400: a featured review on a film strip, posters drawn in
CSS, a reviews archive filterable by movies, shows, and lists, and six sample posts. Pages share
[`ist400-blogsite/style.css`](ist400-blogsite/style.css). How to add a post is in
[`ist400-blogsite/README.md`](ist400-blogsite/README.md).
Live at [/ist400-blogsite/](https://ttakita-su.github.io/ist300-sandbox/ist400-blogsite/).

The Twisted Takes team blog now lives in the [ist444 repository](https://github.com/ttakita-su/ist444).

## Coursework ([`docs/`](docs/))

- [`PRD.md`](PRD.md) — Product requirements document for the **Free Bet Blackjack Strategy
  Trainer**, also published as a web page at
  [/prd/](https://ttakita-su.github.io/ist300-sandbox/prd/) ([`prd/index.html`](prd/index.html)).
- [`docs/lab3-backlog.md`](docs/lab3-backlog.md) — Lab 3 user-story backlog for the **Free Bet
  Blackjack Strategy Trainer**: 11 stories sorted MUST / SHOULD / COULD / WON'T, each with
  Given–When–Then acceptance criteria and a quote from user interviews as evidence. The MVP
  slice is rules-to-graded-drill; live table assist was cut to Won't based on interview
  evidence.
- [`PRD.md`](PRD.md) — product requirements document for the Free Bet trainer. It is
  also published as a web page at [`prd/index.html`](prd/index.html), live at
  [/prd/](https://ttakita-su.github.io/ist300-sandbox/prd/); edit both when the PRD changes.

- [`docs/03-architecture.md`](docs/03-architecture.md) — CP-M3 technical architecture for the
  **Free Bet trainer** MVP slice (F1–F4; S11, S1–S5): components traced to requirements, the
  stack compared against React + Firebase, a hop-by-hop trace of a graded decision (S3), test
  results, and every known gap between the PRD and the code.
- [`docs/design/architecture-map.md`](docs/design/architecture-map.md) — the architecture map
  as an ASCII diagram; every box names the story or PRD item it exists for.
- [`docs/decisions/001-stack.md`](docs/decisions/001-stack.md) — stack decision record: plain
  HTML/JS on GitHub Pages with `localStorage`, and what that choice costs.

Lab files are named by lab number so they sort in order.

## Running it locally

Serve the folder rather than opening files directly, so relative links behave exactly as they
do on GitHub Pages:

```bash
git clone https://github.com/ttakita-su/ist300-sandbox.git
cd ist300-sandbox
python3 -m http.server 8000
```

Then visit <http://localhost:8000>. That serves every site, including Closet Advisor in demo
mode.

Closet Advisor's live features (real product links, online store search and photo search) need
its own Node server instead (Node 24 or newer, no install step):

```bash
cd closet-advisor
npm start
```

It uses port 8130, or the next free port up to 8139, and prints the address to open. See
[`closet-advisor/README.md`](closet-advisor/README.md).

## Publishing a change

```bash
git add .
git commit -m "Describe the change"
git push
```

GitHub Pages rebuilds automatically from `main`. Build status is visible under the repository's
**Actions** tab; if a change does not appear, do a hard refresh to clear the cached page.

## Conventions

- One folder per site, named for the site — the folder name becomes the URL.
- Each site's main page is `index.html`, so links can stay short.
- Shared styling lives in a `style.css` next to the pages that use it; single self-contained
  pages keep their styles inline.
- Internal links are relative to the current folder, which keeps each site movable.
- Commit messages say what changed and why in one line.
- [`.gitignore`](.gitignore) excludes `.claude/settings.local.json` (machine-specific) and
  `.DS_Store`.

## Archive

- [`archive/hello.md`](archive/hello.md) — the original scratch file, kept as a record of the
  first successful push to this repository.
