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
├── prd/             Free Bet trainer PRD as a web page
├── docs/            lab write-ups
└── archive/         old scratch files
```

One folder per site, each with its own `index.html` so the live URL is a clean folder path,
and its own `style.css` where the pages share styling.

## Free Bet Strategy Trainer

Open [`free-bet/index.html`](free-bet/index.html) for the playable PRD implementation: random hands, strategy feedback, rule primer, and saved hand history. Its strategy charts and hand engine live in [`free-bet/extension/strategy.js`](free-bet/extension/strategy.js), which the trainer and the Chrome extension both load. Run `node free-bet/tests.cjs` for the 200-case strategy regression, the engine checks, and the extension's tests. Source assumptions and remaining validation are documented in [`free-bet/STRATEGY.md`](free-bet/STRATEGY.md).

### Chrome extension (prototype, PRD F9)

[`free-bet/extension/`](free-bet/extension/) is a Manifest V3 extension that opens in Chrome's side panel beside an online table. Type your two cards and the dealer's upcard, and it shows the basic-strategy play, including whether a double or split is free. It reads the same `strategy.js` as the trainer, and a test plays thousands of trainer rounds through the panel to check that the two agree on every decision.

To try it:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select the `free-bet/extension` folder.
3. Pin the extension, then click its icon (or press ⌘⇧Y / Ctrl+Shift+Y) to open the side panel.

Type every card you're dealt: your two cards, the dealer's upcard, then each card you draw. A card you type means you followed the last answer; press H, S, D or P first when you did something else. U (or the dealer row) enters the dealer's card at any point, Backspace undoes, and N starts a new round. Looked-up hands are kept in the panel's History tab.

The extension asks only for the `sidePanel` and `storage` permissions. It has no access to web pages, makes no network requests, and keeps hands in `chrome.storage.local` on the device. The panel can also be opened as a plain page (`free-bet/extension/sidepanel.html`) for a quick look; it then stores hands in `localStorage`.

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

Lab files are named by lab number so they sort in order.

## Running it locally

Serve the folder rather than opening files directly, so relative links behave exactly as they
do on GitHub Pages:

```bash
git clone https://github.com/ttakita-su/ist300-sandbox.git
cd ist300-sandbox
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

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
