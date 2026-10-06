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
├── prd/             Free Bet PRD, published as a web page
├── blackjack/       Blackjack 101 — four pages
├── campus-life/     Why Syracuse — three pages
├── ist400-blogsite/ Post-Credits — movie and TV blog template
├── dinosaurs/       test page
├── prd/             Free Bet trainer PRD as a web page
├── docs/            lab write-ups
└── archive/         old scratch files
```

One folder per site, each with its own `index.html` so the live URL is a clean folder path,
and its own `style.css` where the pages share styling.

## Free Bet Strategy Trainer

Open [`free-bet/index.html`](free-bet/index.html) for the playable PRD implementation: random hands, strategy feedback, rule primer, and saved hand history. It is a standalone HTML file with embedded CSS and JavaScript. Run `node free-bet/tests.cjs` for the 200-case strategy regression and engine checks. Source assumptions and remaining validation are documented in [`free-bet/STRATEGY.md`](free-bet/STRATEGY.md).

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

### Why Syracuse ([`campus-life/`](campus-life/))

A three-page site arguing that Syracuse has the best campus life in America:
[index](campus-life/index.html), [traditions](campus-life/traditions.html), and
[get involved](campus-life/get-involved.html), sharing
[`campus-life/style.css`](campus-life/style.css).
Live at [/campus-life/](https://ttakita-su.github.io/ist300-sandbox/campus-life/).

### Post-Credits ([`ist400-blogsite/`](ist400-blogsite/))

A movie and TV blog template for IST400: a featured review on a film strip, posters drawn in
CSS, a reviews archive filterable by movies, shows, and lists, and six sample posts. Pages share
[`ist400-blogsite/style.css`](ist400-blogsite/style.css). How to add a post is in
[`ist400-blogsite/README.md`](ist400-blogsite/README.md).
Live at [/ist400-blogsite/](https://ttakita-su.github.io/ist300-sandbox/ist400-blogsite/).

### Dinosaurs ([`dinosaurs/`](dinosaurs/))

A scratch page used to test page structure, tables, and deploys — the three Mesozoic eras,
a species table, and quick facts. Self-contained, with its styles inline.
Live at [/dinosaurs/](https://ttakita-su.github.io/ist300-sandbox/dinosaurs/).

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
