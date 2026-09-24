# ist300-sandbox

A sandbox repository for **IST300 — Prompts to Products** (Syracuse University). It holds
the hand-written static sites and lab deliverables built over the course of the semester.

**Live site:** https://ttakita-su.github.io/ist300-sandbox/

Everything is plain HTML and CSS — no build step, no frameworks, no dependencies.
GitHub Pages serves the `main` branch from the repository root, so anything pushed to
`main` is live within about a minute.

## What's in here

### Blackjack 101 (repository root)

A four-page static site explaining how to play blackjack.

| Page | File | Live |
| --- | --- | --- |
| Home | [`index.html`](index.html) | [/](https://ttakita-su.github.io/ist300-sandbox/) |
| Rules | [`rules.html`](rules.html) | [/rules.html](https://ttakita-su.github.io/ist300-sandbox/rules.html) |
| Basic Strategy | [`strategy.html`](strategy.html) | [/strategy.html](https://ttakita-su.github.io/ist300-sandbox/strategy.html) |
| Glossary | [`glossary.html`](glossary.html) | [/glossary.html](https://ttakita-su.github.io/ist300-sandbox/glossary.html) |

All four share [`style.css`](style.css).

### Why Syracuse — campus life ([`campus-life/`](campus-life/))

A three-page site arguing that Syracuse has the best campus life in America, with its own
stylesheet: [index](campus-life/index.html), [traditions](campus-life/traditions.html),
and [get involved](campus-life/get-involved.html).
Live at [/campus-life/](https://ttakita-su.github.io/ist300-sandbox/campus-life/).

### Dinosaurs — test page ([`testing.html/`](testing.html/))

A scratch page used to test page structure, tables, and deploys. Covers the three Mesozoic
eras, a species table, and quick facts.
Live at [/testing.html/testing.html](https://ttakita-su.github.io/ist300-sandbox/testing.html/testing.html).

> Note: the file sits inside a folder that is itself named `testing.html`, which is why the
> URL has a doubled path. Moving the file up one level would shorten it to `/testing.html`.

### Coursework ([`docs/`](docs/))

- [`docs/backlog.md`](docs/backlog.md) — Lab 3 user-story backlog for the **Free Bet
  Blackjack Strategy Trainer**: 11 stories sorted MUST / SHOULD / COULD / WON'T, each with
  Given–When–Then acceptance criteria and a quote from user interviews as evidence. The MVP
  slice is rules-to-graded-drill; live table assist was cut to Won't based on interview
  evidence.

### Miscellaneous

- [`hello.md`](hello.md) — the original scratch file, kept as a record of the first
  successful push to this repository.

## Running it locally

Open any `.html` file directly in a browser, or serve the folder so that relative links
behave exactly as they do on GitHub Pages:

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

- One folder per site; shared styling lives in a `style.css` next to the pages that use it.
- Semantic HTML first — headings in order, tables for tabular data, no layout hacks.
- Commit messages say what changed and why in one line.
- [`.gitignore`](.gitignore) excludes `.claude/settings.local.json` (machine-specific) and
  `.DS_Store`.
