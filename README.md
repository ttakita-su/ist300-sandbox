# ist300-sandbox

A sandbox repository for **IST300 — Prompts to Products** (Syracuse University). It holds
the hand-written static sites and lab deliverables built over the course of the semester.

**Live site:** https://ttakita-su.github.io/ist300-sandbox/

Everything is plain HTML and CSS — no build step, no frameworks, no dependencies.
GitHub Pages serves the `main` branch from the repository root, so anything pushed to
`main` is live within about a minute.

## Layout

```
.
├── index.html       landing page linking to every site
├── blackjack/       Blackjack 101 — four pages
├── campus-life/     Why Syracuse — three pages
├── dinosaurs/       test page
├── docs/            lab write-ups
└── archive/         old scratch files
```

One folder per site, each with its own `index.html` so the live URL is a clean folder path,
and its own `style.css` where the pages share styling.

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

### Dinosaurs ([`dinosaurs/`](dinosaurs/))

A scratch page used to test page structure, tables, and deploys — the three Mesozoic eras,
a species table, and quick facts. Self-contained, with its styles inline.
Live at [/dinosaurs/](https://ttakita-su.github.io/ist300-sandbox/dinosaurs/).

## Coursework ([`docs/`](docs/))

- [`docs/lab3-backlog.md`](docs/lab3-backlog.md) — Lab 3 user-story backlog for the **Free Bet
  Blackjack Strategy Trainer**: 11 stories sorted MUST / SHOULD / COULD / WON'T, each with
  Given–When–Then acceptance criteria and a quote from user interviews as evidence. The MVP
  slice is rules-to-graded-drill; live table assist was cut to Won't based on interview
  evidence.

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
