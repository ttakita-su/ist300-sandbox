# Post-Credits — movie & TV blog template

A static blog template for movie and TV reviews. Plain HTML and CSS, with a few lines of
JavaScript for the archive filter. It has no build step, and every page shares [`style.css`](style.css).

Live at [/ist400-blogsite/](https://ttakita-su.github.io/ist300-sandbox/ist400-blogsite/) once pushed.

## Pages

| Page | File | What it shows |
| --- | --- | --- |
| Home | [`index.html`](index.html) | Featured review on a film strip, the four latest posts as posters, watch queue, rating scale |
| Reviews | [`reviews.html`](reviews.html) | Every post by month, filterable by Movies / Shows / Lists |
| About | [`about.html`](about.html) | What the blog is, the star scale, spoiler levels, sluglines |
| Posts | [`posts/`](posts/) | Six sample posts: three movies, two episodes, one list |

The sample posts cover each post type, so copy the closest one when you start a new post:

- **Movie review:** [`posts/past-lives.html`](posts/past-lives.html). Facts are year, director, runtime, and rating.
- **Episode review:** [`posts/severance-woes-hollow.html`](posts/severance-woes-hollow.html). Facts are network, episode code, and year.
- **List:** [`posts/three-tv-oners.html`](posts/three-tv-oners.html). It has no stars, and the ticket gives a pick instead.
- **Full spoilers:** [`posts/shogun-finale.html`](posts/shogun-finale.html). A warning sits at the top instead of a hidden spoiler box.

## Adding a post

1. Copy the closest sample in `posts/` and rename it, for example `posts/andor-season-2.html`.
2. Edit the head of the post: chip (`chip-movie`, `chip-show`, or `chip-list`), title, dek, date, and review number.
3. Pick a still. Reuse one of the `p-*` art classes, or add your own (see below).
4. Fill in the facts, the slugline (where you watched it), the body, and the verdict ticket.
5. Update the **Keep watching** links on the new post and on the previous newest post.
6. Add a `<li class="listing">` at the top of the right month in `reviews.html`. The filter counts update on their own.
7. On `index.html`, move the new post into the feature spot and shift the old feature into the poster grid.

## Stills and posters

Each title's art is a `p-*` class in `style.css` (`p-dune`, `p-severance`, `p-oner`, `p-shogun`,
`p-pastlives`, `p-spiderverse`). The same class draws both the wide 2.39:1 still and the 2:3 poster.
To make a new one, copy a block, change the gradients, and set `--ink` (title color) and `--ink-2`
(billing color) so the text reads on your art.

To use a real image instead, replace `<div class="art"></div>` with an `<img src="..." alt="">`.
It fills the frame automatically. Images you have the rights to (your own photos, press kits,
or openly licensed stills) are safest.

## Design notes

- One dark theme on purpose: the site is meant to feel like a screening room.
- Type: Big Shoulders Display (headlines, posters), Newsreader (reading), Courier Prime (metadata and
  screenplay sluglines). All three load from Google Fonts.
- Tungsten amber is the only accent. Exit-sign red is reserved for spoiler warnings.
- Captions on stills follow closed-caption style (`[SOUND IN BRACKETS]`). Pull quotes are set like film subtitles.
- Motion is limited to film grain and a short projector warm-up on stills. Both turn off with
  the system's reduced-motion setting.
