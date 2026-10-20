# Twisted Takes editor guide

How to write, edit, approve and publish content on Twisted Takes. Setup, local preview, publishing, the site address and analytics are in [README.md](README.md).

## Task finder

| # | I want to… | Section |
|---|---|---|
| 1 | Preview the site on my computer | [README: Preview locally](README.md#preview-locally) |
| 2 | Publish with GitHub Pages | [README: Publish with GitHub Pages](README.md#publish-with-github-pages) |
| 3 | Set the base path and verify article URLs | [README: Base path and article URLs](README.md#base-path-and-article-urls) |
| 4 | Change colors, logo, homepage feature, tagline | [4. Brand](#4-brand-colors-logo-featured-story-tagline) |
| 5 | Edit one review, or add a fifth movie to a genre | [5a. Edit a review](#5a-edit-an-existing-review), [5b. Add a fifth movie](#5b-add-a-fifth-movie-to-a-genre) |
| 6 | Add a TV review without redesigning anything | [6. Add a TV review](#6-add-a-tv-review) |
| 7 | Add a blog post or a recommendation collection | [7a. Blog post](#7a-add-a-blog-post), [7b. Watch Next collection](#7b-add-a-watch-next-recommendation-collection) |
| 8 | Replace cover art and credit it | [8. Cover art](#8-replace-cover-art-and-credit-it) |
| 9 | Add our real Instagram, TikTok and YouTube URLs | [9. Social profile URLs](#9-add-the-social-profile-urls) |
| 10 | Turn on GA4 and check it works | [README: Analytics](README.md#analytics-and-campaign-measurement) |
| 11 | Connect a poll or suggestion form | [11. Community form](#11-connect-an-external-community-form) |
| 12 | Review and approve sample content | [12. Approve sample content](#12-review-and-approve-sample-content) |

Also: [How editing works](#how-editing-works) · [Where content lives](#where-content-lives) · [Front matter basics](#front-matter-basics) · [Writing guidelines](#writing-guidelines) · [Review field reference](#review-front-matter-reference) · [Spoiler sections](#spoiler-sections) · [Social preview images](#social-preview-images) · [Weekly prompt](#weekly-prompt) · [About page: team and ratings](#about-page-team-list-and-rating-scale) · [Pre-publish checklist](#pre-publish-checklist)

## How editing works

Every change is a commit to the `main` branch. Each commit rebuilds the live site; allow up to 10 minutes, and watch the **Actions** tab for the **pages build and deployment** run.

**On the GitHub website (no installs):**

| To… | Do this |
|---|---|
| Edit a file | Open the file → pencil icon (**Edit file**) → make changes → **Commit changes…** → write a short message → **Commit directly to the main branch** → **Commit changes** |
| Create a file | Open the folder → **Add file → Create new file** → type the name (typing `/` creates a folder, e.g. `_reviews/past-lives.md`) → paste content → commit |
| Upload an image | Open `assets/images/covers/` → **Add file → Upload files** → drag the file in → commit (browser uploads are limited to 25 MiB per file; covers should be far smaller) |

**On your computer:** edit in a text editor (VS Code works well), preview with `bundle exec jekyll serve`, then commit and push. Run `git pull` before you start so you have teammates' changes.

Agree in the group chat who is editing which file, so two people do not change the same file at once.

## Where content lives

| Content | Location | Starting file |
|---|---|---|
| Reviews (movies and TV) | `_reviews/<slug>.md` → `/reviews/<slug>/` | `templates/review-movie.md`, `templates/review-tv.md` |
| Blog posts (articles) | `_posts/YYYY-MM-DD-short-title.md` → `/articles/YYYY/MM/short-title/` | `templates/post.md` |
| Watch Next collections | `_watch_next/<slug>.md` → `/watch-next/<slug>/` | `templates/watch-next.md` |
| Genre list, colors, labels, discussion questions | `_data/genres.yml` | — |
| Genre hub intro text | `genres/<key>.md` | — |
| Weekly discussion question | `_data/weekly_prompt.yml` | — |
| Team list (About page) | `_data/team.yml` | — |
| Rating scale (About page) | `_data/rating_scale.yml` | — |
| Main menu | `_data/navigation.yml` | — |
| About and privacy text | `about/index.md`, `privacy/index.md` (privacy is mostly generated) | — |
| Brand, address, social, analytics, form | `_config.yml` | — |
| Review cover art (4:5) | `assets/images/covers/` | `placeholder.svg` |
| Article and collection art (8:5) | `assets/images/editorial/` | — |
| Link-preview images (1200×630) | `assets/images/social/` (generated) | — |

Files in `templates/` are not published. Copy one, never edit it in place.

## Front matter basics

Front matter is the block between the two `---` lines at the very top of a content file. It is YAML; small typos stop the build.

- One setting per line: `key: "value"`. Use straight double quotes (`"`), not curly quotes (“ ”).
- A double quote inside a value needs a backslash: `question: "Who \"doesn't do\" horror?"`. Apostrophes are fine.
- Lists: `tags: ["slow-burn", "aliens"]`, or one `- item` per line indented two spaces.
- Unknown or unverified facts: `null` with no quotes.
- Dates: `2026-10-26` (YYYY-MM-DD). Numbers (`year`, `runtime_minutes`, `score`) have no quotes.
- Indent with spaces, never tabs. Keep nested items (`related_reviews`, `sources`, `picks`) lined up exactly as in the template.
- Slugs and file names: lowercase, hyphens, no spaces (`howls-moving-castle`).
- Internal links in the body use this pattern so they survive a base-path change: `[Arrival]({{ '/reviews/arrival/' | relative_url }})`.

## Writing guidelines

**Voice.** Reviews are the team's opinions. Be specific about craft (writing, performances, visuals, sound, pacing), say who a title suits, and leave room for disagreement. Follow the body structure in the templates: Premise, The Take, What Works, What May Divide Viewers, Who Should Watch.

**Spoilers.**
- Reviews are spoiler-free by default: no endings, twists, late reveals or deaths of major characters.
- `headline`, `excerpt`, `description`, `discussion_question`, image alt text and social captions must always be spoiler-free.
- Anything that spoils goes in a labeled [spoiler section](#spoiler-sections) at the end of the review, with `spoiler_status: "contains-spoilers"`.

**True crime documentaries.** These involve real victims, families and communities.
- Review the film: how it uses interviews, footage, pacing and what it leaves out.
- Attribute case details to the film: "the documentary presents…", "according to interviews in the film…".
- Be respectful toward victims and families. No jokes about the crime, no graphic detail beyond what the review needs.
- Do not state anyone's current legal status (sentences, appeals, parole, release). It changes and is easy to get wrong.
- Do not add your own speculation about guilt or unproven claims.

**No invented data.**
- Never invent scores, audience reactions, polls, "fans say" consensus, view or comment counts, quotes or testimonials.
- Never substitute IMDb, Rotten Tomatoes, Metacritic or Letterboxd scores for our rating. `score` is the team's own rating, set only after the team agrees.
- Never put analytics numbers, campaign targets or response counts on the public site.

**Facts.** Verify director, runtime, rating and release year against official or authoritative sources (studio or distributor pages, network or streamer pages, [filmratings.com](https://www.filmratings.com) for MPA ratings, the AFI Catalog). List them under `sources`. If you cannot verify a fact, set it to `null`.

**Images.** Use original artwork or images you have permission to use, and credit them ([section 8](#8-replace-cover-art-and-credit-it)).

## Review front matter reference

"Required" means the key must be present (it may be `null` where noted). Fields marked TV apply when `media_type: "tv"`.

| Field | Req. | Accepted values | What it controls | If `null` / missing |
|---|---|---|---|---|
| `title` | Yes | Exact title, quoted | Card title, the cited title under the headline, breadcrumb, browser title "Title (Year) review", search, A–Z sort | — |
| `slug` | Yes | Same as the file name without `.md` | The page address `/reviews/<slug>/`; how other files refer to this review | — |
| `year` | Yes | Number, e.g. `2016` (TV: year the season premiered) | "(2016)" after the title, card meta, year sorting; genre sections list oldest first | — |
| `media_type` | Yes | `"movie"` or `"tv"` | "Movie review"/"TV review" label, Format filter, which genre-page section it appears in | Defaults to `"movie"` |
| `primary_genre` | Yes | `sci-fi`, `true-crime`, `fantasy`, `rom-com`, `horror` (a `key` in `_data/genres.yml`) | Genre sections, genre filter, accent color, breadcrumb | Misspelled: review appears only on the Reviews page |
| `subgenre` | No | Short label | Added to the Genre row and the card kicker; searchable | Hidden |
| `tags` | Yes | 3–6 lowercase hyphenated words | Tags row (each links to a Reviews search); search | Row hidden |
| `moods` | No | 2–3 of: thoughtful, mind-bending, tense, eerie, cozy, romantic, funny, adventurous, emotional, unsettling, investigative | Mood row; search | Row hidden |
| `headline` | Yes | Descriptive, spoiler-free | The page's `<h1>`, link-preview title, social card title | Falls back to `title` |
| `excerpt` | Yes | One spoiler-free sentence under 150 characters | Text on review cards (and the description fallback) | Jekyll uses the first block of the body, which shows a stray "Premise" heading on cards; always set it |
| `description` | Yes | 120–155 characters, spoiler-free | Search-engine and link-preview description | Falls back to `excerpt` |
| `image` | Yes | `/assets/images/covers/<slug>.svg` (or `.jpg`/`.webp`) | Cover on the review page, cards, genre index | Placeholder on review page and cards; broken image on the Genres page |
| `image_alt` | Yes | What the image shows | Alt text on the review page cover and in link previews (cards use empty alt) | Falls back to `title` |
| `image_credit` | Yes | Who made it, license or permission | Caption under the cover and a line in "Sources and credits" | Hidden |
| `social_image` | No | `/assets/images/social/<slug>.png` | Link-preview image | Site default `social/default.png` |
| `director` | Yes | Verified name(s) | Director row, card meta; searchable | Row omitted |
| `runtime_minutes` | Yes | Number of minutes (TV: typical episode) | Runtime row ("1 hr 56 min"; TV "About 50 min per episode") | Row omitted |
| `content_rating` | Yes | Verified US rating: `G`, `PG`, `PG-13`, `R`, `TV-14`, `TV-MA` … | Rated row | Row omitted |
| `content_rating_system` | No | `"MPA"`, `"TV"` or `null` | Adds "(MPA)" or "(US TV rating)" after the rating | Nothing added |
| `advisory` | No | Short advisory in your own words | "Content advisory:" line under the facts | Hidden |
| `score` | Yes | Whole number `1`–`5`, or `null` | Our rating: stars and "4 out of 5" | "Not yet rated" (also for out-of-range values) |
| `spoiler_status` | Yes | `"spoiler-free"` or `"contains-spoilers"` | Byline label: "Spoiler-free" or "Spoilers are hidden below and labeled" | Shows "Spoiler-free" |
| `editorial_status` | Yes | `"sample"` or `"approved"` | Anything but `"approved"` shows the Sample notice and card label | Sample notice shown |
| `author` | Yes | Byline name | "By …" line | "Twisted Takes" |
| `date` | Yes | `YYYY-MM-DD` | Byline date and publish date; future dates are hidden until a build on or after that date | The build time, which changes on every build; always set it |
| `discussion_question` | No | One specific question | "Your take" box at the end | Box hidden |
| `related_reviews` | Yes | Two items, each `slug:` (existing review) + `reason:` | "If this sounds like your kind of movie" (or "show" for TV) cards | Section hidden; unknown slugs skipped |
| `sources` | No | Items with `label:` and `url:` (official pages preferred) | "Sources and credits" list | Only the image credit shown |
| `trailer_url` | No | Official trailer URL only; never guess | "Watch the official trailer" link | Hidden |
| `season` | TV | Number, or `null` for a whole or limited series | ", season 1" after the title, card meta, Season row, browser title | Omitted |
| `episodes` | TV | Number or `null` | "(9 episodes)" in the Season row | Omitted |
| `creator` | TV | Verified name(s) | "Created by" row; card meta when there is no director | Row omitted |
| `network` | TV | Verified network or streamer | Network row | Row omitted |

## 4. Brand: colors, logo, featured story, tagline

### Colors

All site colors are CSS custom properties at the top of `assets/css/main.css`, in `:root`. Change a value there and the whole site follows.

| Property | Now | Used for |
|---|---|---|
| `--color-bg` | `#FAF9F6` | Page background |
| `--color-surface` | `#FFFFFF` | Cards and article surfaces |
| `--color-text` / `--color-muted` | `#202124` / `#5F6368` | Body text / secondary text |
| `--color-accent` / `--color-accent-dark` | `#7A2944` / `#5C1E33` | Links, kickers, buttons, "Twisted" in the wordmark / hover |
| `--color-accent-tint` | `#F6EDF0` | Light accent backgrounds |
| `--color-rule` / `--color-rule-strong` | `#DEDBD4` / `#BDB8AE` | Borders and dividers |
| `--color-footer` | `#F2EFE9` | Footer background |
| `--color-note-bg` / `-border` / `-text` | `#FBF5E4` / `#E6D5A3` / `#4D3B06` | Sample notice |
| `--color-focus` | `#7A2944` | Keyboard focus outline |
| `--font-serif` / `--font-sans` | Georgia… / system-ui… | Headings and wordmark / interface text |

Keep text readable: check text-on-background pairs with a contrast checker (at least 4.5:1). Each genre's accent color is `accent:` in `_data/genres.yml`. The brand burgundy is also hard-coded in `assets/images/favicon.svg`, in `tools/social-cards.mjs` (social cards) and as a fallback (`#7A2944`) in a few layouts; update those if you change the accent. `tools/browser-check.mjs` reads the background color from the stylesheet, so it follows your change.

### Logo (wordmark) and favicon

The logo is text, not an image: `<span class="wordmark__twisted">Twisted</span> <span class="wordmark__takes">Takes</span>`, in both `_includes/header.html` and `_includes/footer.html`. Its look (italic, tilted burgundy "Twisted", bold "Takes") is the `.wordmark` CSS in `main.css`. To use an image logo instead, upload it (e.g. `assets/images/logo.svg`) and replace the two spans in **both** files with:

```html
<img src="{{ '/assets/images/logo.svg' | relative_url }}" alt="Twisted Takes" width="200" height="40">
```

(set `width`/`height` to your file's proportions). The social cards draw their own wordmark in `tools/social-cards.mjs`.

The browser-tab icon is `assets/images/favicon.svg` (square). After replacing it, run `npm run social-cards` with no filter to regenerate `assets/images/apple-touch-icon.png`.

### Featured story

In `_config.yml`:

```yaml
featured:
  collection: "posts"          # posts or watch_next
  slug: "five-genres-five-starting-points"
```

For a post, the slug is the file name without the date and `.md` (`2026-10-18-five-genres-five-starting-points.md` → `five-genres-five-starting-points`). For a Watch Next collection, use `collection: "watch_next"` and its `slug:` (e.g. `if-you-liked-inception`). If the slug is not found, the newest post is featured. The feature uses the item's `image`, `kicker`, `title`, `excerpt` and byline.

### Tagline

The tagline appears in several places; change all of them:

1. `_config.yml` → `tagline:` (home page browser title and footer).
2. `index.html` → the intro heading, which hard-codes the two halves with the second in italics: `Strong opinions. <em>Better watchlists.</em>`
3. `tools/social-cards.mjs` → the default card's `title: 'Strong opinions. Better watchlists.'`, then run `npm run social-cards -- default`.
4. Optional: the last line of `_posts/2026-10-17-welcome-to-twisted-takes.md`.

## 5a. Edit an existing review

1. Open `_reviews/<slug>.md` (on GitHub: pencil icon).
2. Change front matter values or body text. Keep the `---` lines and the field layout.
3. Do not change `slug` or the file name unless you mean to change the address; other files (related reviews, Watch Next picks, the weekly prompt) refer to the slug.
4. Commit, wait for the build, and check the page.

## 5b. Add a fifth movie to a genre

1. Pick the slug: the title in lowercase with hyphens, e.g. `past-lives`.
2. Copy `templates/review-movie.md` to `_reviews/past-lives.md`.
3. Fill in every field (see the [reference](#review-front-matter-reference)). Set `primary_genre` to the genre key, `slug: "past-lives"`, `editorial_status: "sample"` until it is approved, and `date` to today or the planned publish date.
4. Cover art: add your own 800×1000 artwork at `assets/images/covers/past-lives.svg` (or `.jpg`/`.webp`) and set `image`, `image_alt`, `image_credit`. If the art is not ready, use `image: "/assets/images/covers/placeholder.svg"` so nothing shows a broken image.
5. Write the body under the template headings. Delete the commented-out spoiler block unless you need it.
6. Optional: generate its link-preview image ([Social preview images](#social-preview-images)), or set `social_image: null`.
7. Preview locally or commit and check the live page.

What updates automatically:

| Place | What it shows |
|---|---|
| Home page genre section | Every movie in the genre, oldest release first (a fifth card wraps to a new row) |
| Home "Pick a genre" strip | Movie review count for the genre, plus a TV count once TV reviews exist |
| Genre hub (`/genres/<key>/`) | Every movie in "<Genre> movies", oldest first |
| Genres index (`/genres/`) | Every title as a link; **only the first 4 covers** by release year |
| Reviews page | Every review, the total count and the search/filter data |
| Search (header box and Reviews page) | The new review, by title, tags, moods, director, year |

Update by hand:

- The genre hub's intro and `description` in `genres/<key>.md`; both name the current four films.
- Optional: link the new review from other reviews' `related_reviews`, a Watch Next collection or the weekly prompt.
- If you run `tools/browser-check.mjs`, update its launch-specific counts ([README note](README.md#verification-tools)).

## Spoiler sections

Use only when a review must discuss an ending or twist. Put it at the end of the body:

```markdown
<details class="spoiler" markdown="1">
<summary>Spoiler section: the ending of Get Out</summary>

Paragraphs about the ending go here. Markdown works inside.

</details>
```

Keep the blank lines after `<summary>…</summary>` and before `</details>`, and set `spoiler_status: "contains-spoilers"` in the front matter. Readers see a closed, labeled box they can choose to open. The text is still in the page source, so keep everything above the box spoiler-free.

## 6. Add a TV review

TV reviews use the same folder, layout and design as movies.

1. Pick a slug that includes the season, e.g. `severance-season-1`.
2. Copy `templates/review-tv.md` to `_reviews/severance-season-1.md`.
3. Keep `media_type: "tv"` and fill in `season`, `episodes`, `creator`, `network` (verified only, else `null`). `director` is usually `null`; `runtime_minutes` is a typical episode; use `content_rating_system: "TV"` with a rating like `"TV-14"`.
4. Fill in the remaining fields as for a movie, add cover art (800×1000) and write the body under the same headings.
5. Commit and check.

What happens automatically: the review page shows "TV review", ", season 1" after the title and the Created by / Network / Season rows. The Reviews page **Format → TV** filter lists it instead of the "TV reviews are on the way" message, and the page intro adds the TV count. The genre hub's "<Genre> TV" section shows the card instead of its placeholder note. Cards show "· TV" and "Season 1". Search includes it.

The home page genre sections list **movies only** (`index.html` filters on `media_type "movie"`). To show TV there too (optional), edit this line in `index.html`:

```liquid
{%- assign genre_movies = site.reviews | where: "primary_genre", genre.key | where: "media_type", "movie" | sort: "year" %}
```

and remove `| where: "media_type", "movie"`, so it reads:

```liquid
{%- assign genre_movies = site.reviews | where: "primary_genre", genre.key | sort: "year" %}
```

## 7a. Add a blog post

1. Copy `templates/post.md` to `_posts/2026-10-26-best-rewatches.md`. The date in the file name is the publish date; the address becomes `/articles/2026/10/best-rewatches/`.
2. Fill in `title`, `kicker` (small label, e.g. "Recommendations"), `excerpt`, `description`, `image` (8:5, e.g. 1200×750, in `assets/images/editorial/`), `image_alt`, `image_credit`, `author`, `tags` and an optional `discussion_question`. Keep `editorial_status: "sample"` until approved.
3. Write the article in Markdown below the front matter. Link to reviews with `{{ '/reviews/arrival/' | relative_url }}`.
4. Commit. The post appears on the Articles page, in the home page's "Recent articles" (newest 6 posts and collections), in "More from Twisted Takes" on other articles, in search results on the Reviews page and in `feed.xml`.
5. To make it the home page feature, see [Featured story](#featured-story).

A post dated in the future stays hidden until the first build on or after that date ([README](README.md#preview-locally)).

## 7b. Add a Watch Next recommendation collection

1. Copy `templates/watch-next.md` to `_watch_next/movies-for-a-rainy-day.md` and set `slug: "movies-for-a-rainy-day"`.
2. Fill in `title`, `excerpt`, `description`, `image` (8:5), `image_alt`, `image_credit`, `author`, `date`, `editorial_status: "sample"` and an optional `discussion_question`.
3. List the picks in the order you discuss them. Each `slug` must be an existing review; `reason` is under 25 words and names the connection (theme, pace, style or mood), not the plot. It is an editor's summary kept with the collection; readers see the explanation you write in the body, and the pick cards show each review's own excerpt:

   ```yaml
   picks:
     - slug: "arrival"
       reason: "A quiet puzzle built on language, for viewers who liked the thinking more than the explosions."
     - slug: "spirited-away"
       reason: "Another world with its own rules, explored at a gentle pace."
   ```

4. Write an introduction and one short section per pick, linking each review.
5. Commit. It appears on the Watch Next page (with its pick count), the Articles page and "Recent articles"; the picks show as cards under "In this collection". Update the `description` in `watch-next/index.html` if you want it to mention the new collection.

## 8. Replace cover art and credit it

The covers in `assets/images/covers/` are **original Twisted Takes artwork**, not official posters (the footer says so). Keep it that way unless you have the right to use another image.

Allowed: your own photos or artwork; images with a license that allows this use (follow its attribution terms); press-kit or publicity images only when the team has permission. Not allowed: copying posters or stills from search results, fan sites or streaming services, or hotlinking images from other sites.

1. Make the image 4:5 portrait, ideally 800×1000 px, saved as JPG or WebP under about 200 KB (SVG for flat artwork).
2. Name it after the slug and upload it to `assets/images/covers/`, e.g. `assets/images/covers/arrival.jpg`.
3. In the review's front matter, update:

   ```yaml
   image: "/assets/images/covers/arrival.jpg"
   image_alt: "Describe what the image shows, without spoilers."
   image_credit: "Photo by Sara for Twisted Takes."      # or: "Image: NAME, licensed CC BY 4.0." / "Publicity image courtesy of STUDIO, used with permission."
   ```

4. Delete the old file if nothing else uses it.
5. Regenerate the link-preview image: `npm run social-cards -- arrival` ([Social preview images](#social-preview-images)).
6. Check the review page (cover and caption), a card and the Genres page.

Article and collection images work the same way in `assets/images/editorial/`, at 8:5 (1200×750).

## Social preview images

The 1200×630 PNGs in `assets/images/social/` appear when someone shares a link. `tools/social-cards.mjs` draws them from each file's headline, title and cover. It is optional; the site builds without it. It only writes cards for files whose `social_image` points into `/assets/images/social/`.

One-time setup (needs [Node.js](https://nodejs.org) 18+):

```sh
cd tools
npm install
npx playwright install chromium
```

Then, from `tools/`:

```sh
npm run social-cards              # every review, post and collection, default.png and apple-touch-icon.png
npm run social-cards -- arrival   # only files whose name contains "arrival"
npm run social-cards -- default   # only the site default card
```

Commit the new PNGs. Run it after adding content or changing a headline, title or cover. To skip a card, set `social_image: null` (the site default is used).

## 9. Add the social profile URLs

1. Open `_config.yml` and fill in the full profile URLs, keeping the quotes:

   ```yaml
   social:
     instagram: "https://www.instagram.com/HANDLE/"
     tiktok: "https://www.tiktok.com/@HANDLE"
     youtube: "https://www.youtube.com/@HANDLE"
   ```

2. Commit. Links appear in the footer ("Follow"), the home page "Join the conversation" box, the Community page and the "Your take" box on every review, article and genre hub. An empty value hides that platform everywhere and the site shows plain text instead.
3. Open each link on the live site to confirm it reaches the right profile.

**Links to specific posts.** For a genre conversation, put post URLs in that genre's `discussion_links` in `_data/genres.yml`; they appear on the genre hub and on that genre's reviews. For this week's question, use `discussion_links` in `_data/weekly_prompt.yml`; they appear on the Community page. Any empty entry falls back to the profile URL above.

These links point away from the blog, so they never get UTM tags. UTM tags go on links in your posts and bios that point **to** the blog ([README: Campaign links](README.md#campaign-links-utm-tags)).

## 11. Connect an external community form

The Community page can show a real external form or poll. While `community_form.url` is empty, nothing form-like appears. The site never shows its own success message or response counts; answers go straight to the form service.

**Google Forms:**

1. Create the form. Do not ask for names, emails or other personal details unless the team truly needs them.
2. Publish it (**Publish** at the top right); an unpublished form cannot be opened by responders.
3. Copy the responder link (**Published → Copy responder link**, or **Preview → Copy responder link**).
4. Optional embed: choose **Embed HTML** in the form's sharing options and copy the code. Use only the `src` address from it, which ends in `viewform?embedded=true`.
5. In `_config.yml`:

   ```yaml
   community_form:
     url: "https://docs.google.com/forms/d/e/FORM_ID/viewform"
     embed_url: "https://docs.google.com/forms/d/e/FORM_ID/viewform?embedded=true"   # optional; "" for link only
     provider: "Google Forms"
     label: "Suggest a movie or answer this week's poll"
   ```

6. Commit and check `/community/`: a "Suggest a movie or vote" section with your button (and the embedded form if `embed_url` is set). The footer and `/privacy/` now name the provider.

Other services (Microsoft Forms, Tally, …): put the public link in `url` and the provider's name in `provider`. Use `embed_url` only if the service gives an embeddable address.

**Counting responses.** Read real totals in the form service (Google Forms: **Responses** tab) and comment counts in each platform's own analytics. Report them in the [weekly tracking sheet](README.md#weekly-tracking-sheet-copy-into-a-shared-doc), never on the site.

## 12. Review and approve sample content

All launch reviews, posts and Watch Next collections were written as starter text and carry `editorial_status: "sample"`. While a file says anything other than `"approved"` (exact spelling, lowercase):

- the page shows a yellow notice: "**Sample review.**" (reviews) or "**Sample article.**" (posts and collections) "This is starter text written to launch Twisted Takes. The team has not yet reviewed it or approved it as its own opinion.";
- review cards show a "Sample review" line; article and collection cards and the home page feature show "Sample article".

Setting `editorial_status: "approved"` removes all of them. Nothing else changes.

**Approval checklist** (ideally done by a teammate other than the writer):

1. Fact-check `year`, `director`, `runtime_minutes`, `content_rating`, TV fields and any facts in the body against the links in `sources`. Fix or set to `null` anything you cannot confirm. Open every source link.
2. Rewrite the text in the team's own voice and opinions. If you disagree with the sample take, change it.
3. Confirm there are no spoilers outside a spoiler section, including the headline, excerpt, description, discussion question and image alt text. Check `spoiler_status` matches.
4. For true crime, re-read against the [true crime rules](#writing-guidelines).
5. Confirm both `related_reviews` slugs exist and each `reason` still makes sense.
6. Set `score` only if the team agreed on a rating; otherwise leave `score: null`.
7. Change `author` if a named writer should be credited (e.g. `author: "Jaylene"`).
8. Check `image_credit` is accurate and the cover is original or permitted.
9. Set `editorial_status: "approved"`, commit, and check the live page: the notice and card labels are gone.

When the first ratings go live, update the About page sentence "Our launch reviews have not been rated yet…" in `about/index.md`. When nothing is marked Sample any more, you can delete the "About 'Sample' labels" section there too.

## Weekly prompt

Replace `_data/weekly_prompt.yml` each Monday. It appears on the Community page and in the home page's "This week's question" box.

```yaml
week_of: 2026-10-26              # Monday the question goes live
question: "Which sequel or series continuation was actually worth it?"
context: "One or two sentences that set it up."
related:                         # review slugs to suggest as starting points
  - "the-fellowship-of-the-ring"
  - "the-conjuring"
discussion_links:                # this week's posts; empty values fall back to the profiles
  instagram: ""
  tiktok: ""
  youtube: ""
```

## About page: team list and rating scale

- **Team:** edit `_data/team.yml` (`name` and `role` per person, shown in that order). List only people and roles the team has confirmed.
- **Rating scale:** `_data/rating_scale.yml` holds the 1–5 labels and meanings shown on the About page. A review shows stars only when its own `score` is set.
- **Other About text** (mission, the five launch genres, the Sample-label note) is in `about/index.md`.

Adding a sixth genre (optional): add an entry to `_data/genres.yml` (`key`, `name`, `accent`, `short_description`, `labels`, `discussion_question`, `discussion_links`), create `genres/<key>.md` (copy an existing hub and change `title`, `genre_key`, `permalink`, `description` and the intro), and review the hard-coded "five genres" wording in `reviews/index.html`, `genres/index.html`, `about/index.md` and `_data/weekly_prompt.yml`.

## Pre-publish checklist

- [ ] File is in the right folder with a lowercase, hyphenated name; posts start with `YYYY-MM-DD-`.
- [ ] `slug` matches the file name (reviews and Watch Next).
- [ ] Front matter starts and ends with `---`; straight quotes; no tabs.
- [ ] `primary_genre` is one of the keys in `_data/genres.yml`; `media_type` is `movie` or `tv`.
- [ ] Facts verified and listed in `sources`, or set to `null`.
- [ ] No spoilers outside a spoiler section; `spoiler_status` is correct.
- [ ] True crime rules followed.
- [ ] No invented scores, reactions or numbers; `score` set only by team agreement.
- [ ] `image` path exists; `image_alt` describes it; `image_credit` names the creator and permission.
- [ ] `related_reviews` / `picks` slugs exist.
- [ ] Internal links use `relative_url`.
- [ ] `date` is right (future dates stay hidden until a build on or after that date).
- [ ] `editorial_status` is `"approved"` only after the [approval checklist](#12-review-and-approve-sample-content).
- [ ] Social card regenerated, or `social_image: null`.
- [ ] Previewed locally or checked on the live site after the **Actions** run finished; page refreshed and links clicked.
