# Twisted Takes

Twisted Takes is a student team's movie and TV review community website. It is a Jekyll site published free on GitHub Pages, with long-form reviews, genre hubs, Watch Next recommendation collections and discussion prompts that connect to the team's Instagram, TikTok and YouTube channels.

| Person | Role |
|---|---|
| Tomoyoshi | Blog and website |
| Sara | TikTok |
| Jaylene | Instagram |

There are two guides:

- **README.md (this file):** preview, publishing, the site address, configuration, analytics and campaign measurement, checks and troubleshooting.
- **[EDITOR_GUIDE.md](EDITOR_GUIDE.md):** writing and editing content: reviews, TV reviews, articles, Watch Next collections, cover art, social links, the community form, brand changes and approving sample content.

## Contents

1. [Find your task](#find-your-task)
2. [What's in the box](#whats-in-the-box)
3. [Preview locally](#preview-locally)
4. [Moving the site into its own repository](#moving-the-site-into-its-own-repository)
5. [Publish with GitHub Pages](#publish-with-github-pages)
6. [Base path and article URLs](#base-path-and-article-urls)
7. [Configuration reference](#configuration-reference)
8. [Analytics and campaign measurement](#analytics-and-campaign-measurement)
9. [Verification tools](#verification-tools)
10. [Troubleshooting](#troubleshooting)
11. [Official references](#official-references)

## Find your task

| # | Task | Where |
|---|---|---|
| 1 | Preview the site on your computer | [Preview locally](#preview-locally) |
| 2 | Publish with GitHub Pages (repository settings) | [Moving the site…](#moving-the-site-into-its-own-repository), [Publish with GitHub Pages](#publish-with-github-pages) |
| 3 | Configure the base path and verify article URLs | [Base path and article URLs](#base-path-and-article-urls) |
| 4 | Change colors, logo, homepage feature, tagline | [EDITOR_GUIDE: Brand](EDITOR_GUIDE.md#4-brand-colors-logo-featured-story-tagline) |
| 5 | Edit one review or add a fifth movie to a genre | [EDITOR_GUIDE: Edit a review](EDITOR_GUIDE.md#5a-edit-an-existing-review), [Add a movie](EDITOR_GUIDE.md#5b-add-a-fifth-movie-to-a-genre) |
| 6 | Add a TV review | [EDITOR_GUIDE: TV review](EDITOR_GUIDE.md#6-add-a-tv-review) |
| 7 | Add a blog post or recommendation collection | [EDITOR_GUIDE: Blog post](EDITOR_GUIDE.md#7a-add-a-blog-post), [Watch Next](EDITOR_GUIDE.md#7b-add-a-watch-next-recommendation-collection) |
| 8 | Replace cover art and credit it | [EDITOR_GUIDE: Cover art](EDITOR_GUIDE.md#8-replace-cover-art-and-credit-it) |
| 9 | Add the real social profile URLs | [EDITOR_GUIDE: Social URLs](EDITOR_GUIDE.md#9-add-the-social-profile-urls) |
| 10 | Enable GA4 and verify collection | [Analytics and campaign measurement](#analytics-and-campaign-measurement) |
| 11 | Connect an optional external form | [EDITOR_GUIDE: Community form](EDITOR_GUIDE.md#11-connect-an-external-community-form) |
| 12 | Review and approve sample content | [EDITOR_GUIDE: Approval](EDITOR_GUIDE.md#12-review-and-approve-sample-content) |

## What's in the box

```text
twisted-takes/
├── _config.yml            Site settings: brand, address, featured story, social, analytics, form, privacy
├── Gemfile                Ruby gems for local preview (github-pages = the versions GitHub builds with)
├── .gitignore             Keeps build output, installed gems, Gemfile.lock and node_modules out of Git
├── index.html             Home page: intro, featured story, genre sections, recent articles, weekly question
├── reviews/index.html     Reviews page: search, genre and format filters, sorting
├── genres/index.html      Genre index (all genre hubs)
├── genres/<key>.md        One hub per genre: sci-fi, true-crime, fantasy, rom-com, horror
├── watch-next/index.html  List of Watch Next collections
├── articles/index.html    All blog posts and Watch Next collections, newest first
├── community/index.html   Weekly question, optional form, ground rules, channel links
├── about/index.md         About page (team list and rating scale come from _data/)
├── privacy/index.md       Privacy notice, generated from your settings
├── 404.html               "Page not found" page
├── search.json            Search index used by the Reviews page
├── robots.txt             Points crawlers to sitemap.xml
├── _reviews/              One Markdown file per review (movies and TV)
├── _posts/                Blog articles, named YYYY-MM-DD-short-title.md
├── _watch_next/           Recommendation collections
├── _data/                 genres.yml, navigation.yml, rating_scale.yml, team.yml, weekly_prompt.yml
├── _layouts/              Page templates: default, page, review, article, genre
├── _includes/             Shared pieces: header, footer, cards, SEO tags, analytics, share, sample notice …
├── assets/css/main.css    The only stylesheet; brand colors and fonts are at the top in :root
├── assets/js/site.js      Mobile menu, share buttons, TT.track() analytics helper
├── assets/js/catalog.js   Reviews page search/filter/sort and its analytics events
├── assets/images/         covers/ (4:5 review art), editorial/ (8:5 article art),
│                          social/ (1200×630 link previews), favicon.svg, apple-touch-icon.png
├── templates/             Starting files to copy for reviews, TV reviews, posts, Watch Next (not published)
├── tools/                 Optional Node scripts: check-site, browser-check, social-cards (not published)
├── README.md              This file (not published)
└── EDITOR_GUIDE.md        Content guide (not published)
```

Created on your computer and never committed: `_site/` (build output), `.jekyll-cache/`, `vendor/` and `.bundle/` (installed gems), `Gemfile.lock`, `tools/node_modules/`.

## Preview locally

You need Ruby 3.x and Bundler. GitHub Pages currently builds with Ruby 3.3, the `github-pages` gem (version 232) and Jekyll 3.10.0 ([dependency versions](https://pages.github.com/versions/)). This project was tested with Ruby 3.3.12 and Bundler.

### Step 1: Install Ruby 3.3 (once)

**macOS.** The Ruby that ships with macOS (2.6) is too old. Use Homebrew ([brew.sh](https://brew.sh)):

```sh
brew install ruby@3.3
echo 'export PATH="/opt/homebrew/opt/ruby@3.3/bin:$PATH"' >> ~/.zshrc
exec zsh          # or open a new Terminal window
ruby -v           # should print ruby 3.3.x
bundle -v         # Bundler comes with Ruby
```

On an Intel Mac the path is `/usr/local/opt/ruby@3.3/bin`; `brew info ruby@3.3` prints the right one.

**Windows.** Download a **Ruby+Devkit 3.3.x (x64)** installer from [RubyInstaller](https://rubyinstaller.org/downloads/). On the last screen keep the `ridk install` box checked, and when asked choose **MSYS2 and MINGW development toolchain**. Open a new terminal and run `ruby -v`. (The Gemfile already adds the `tzinfo-data` gem Windows needs.)

**Linux.** Install Ruby 3.3 and its development headers with your package manager or a version manager.

> GitHub's local-testing page suggests Ruby 3.1 if Ruby 3.2+ gives `github-pages` errors. This project builds cleanly on Ruby 3.3, which matches GitHub's servers.

### Step 2: Install the gems (once per computer)

```sh
cd path/to/twisted-takes
bundle config set --local path vendor/bundle
bundle install
```

Gems go into `vendor/bundle/` inside the project. Run `bundle install` again only if the Gemfile changes. To pick up a newer GitHub Pages release: `bundle update github-pages`.

### Step 3: Start the preview

```sh
bundle exec jekyll serve
```

Open **http://127.0.0.1:4000/twisted-takes/**. Note the `/twisted-takes/` base path: the bare `http://127.0.0.1:4000/` does not show the site. Press **Ctrl+C** in the terminal to stop.

| Situation | What to do |
|---|---|
| You edited a review, layout or CSS | Save, then refresh the browser (Jekyll rebuilds on its own) |
| You want the browser to refresh itself | `bundle exec jekyll serve --livereload` |
| You edited `_config.yml` | Stop with Ctrl+C and run `bundle exec jekyll serve` again |
| Content dated in the future is missing | Expected (see below). Preview it with `bundle exec jekyll serve --future` |
| Port 4000 is busy | `bundle exec jekyll serve --port 4001` |
| You want to test the GA4 tag | macOS/Linux: `JEKYLL_ENV=production bundle exec jekyll serve`; Windows PowerShell: `$env:JEKYLL_ENV="production"; bundle exec jekyll serve` (close that window afterward) |
| You only want the files | `bundle exec jekyll build` writes the site to `_site/` |

**Harmless messages.** `To use retry middleware with Faraday v2.0+, install faraday-retry gem` and `GitHub Metadata: No GitHub API authentication could be found. Some fields may be missing or have incorrect data.` come from the github-pages gem. This site does not use those features; ignore them.

**Future-dated content.** Reviews, posts and Watch Next pages with a date later than the build time are left out, both locally and on GitHub Pages (timezone `America/New_York`). GitHub only builds when someone pushes, so a future-dated item appears with the **first build on or after its date**. On the day, push any small change (or re-save a file on GitHub) to publish it.

## Moving the site into its own repository

The site currently lives in `twisted-takes/` inside Tomoyoshi's coursework repository `ist300-sandbox`. The sandbox's root `_config.yml` lists `twisted-takes` under `exclude:`, so the sandbox's own Pages build ignores it. Twisted Takes is designed to be the **root of its own repository**, recommended name `twisted-takes`.

1. **Create the repository.** On GitHub, click **+** → **New repository**. Owner: the account that will host the site (for example `ttakita-su`). Name: `twisted-takes`. Visibility: **Public** (GitHub Pages on GitHub Free requires a public repository). Do not add a README, .gitignore or license; the project has its own. Click **Create repository**.
2. **Copy the contents** of `twisted-takes/` (not the folder itself) into a new folder. macOS Terminal:

   ```sh
   cd ~/Desktop/IST444
   rsync -a --exclude _site --exclude vendor --exclude .bundle --exclude .jekyll-cache \
     --exclude Gemfile.lock --exclude node_modules \
     ist300-sandbox/twisted-takes/ twisted-takes/
   ls -a twisted-takes    # expect .gitignore, _config.yml, index.html … at the top level
   ```

   The trailing slash after `ist300-sandbox/twisted-takes/` copies the contents, including the hidden `.gitignore`. On Windows, copy in File Explorer with **View → Show → Hidden items** turned on and skip the folders listed above. (If they come along by accident, `.gitignore` still keeps them out of Git.)
3. **Commit and push:**

   ```sh
   cd ~/Desktop/IST444/twisted-takes
   git init
   git add -A
   git status     # must NOT list _site/, vendor/, .bundle/, .jekyll-cache/, Gemfile.lock or node_modules/
   git commit -m "Add Twisted Takes site"
   git branch -M main
   git remote add origin https://github.com/ttakita-su/twisted-takes.git   # use the owner you chose in step 1
   git push -u origin main
   ```

4. **Enable Pages:** see [Publish with GitHub Pages](#publish-with-github-pages).
5. **Set `url` and `baseurl`** in `_config.yml` if the owner or repository name differs from `ttakita-su` / `twisted-takes`: see [Base path and article URLs](#base-path-and-article-urls).
6. **Verify** the live site with the checklist in that section.
7. **Add teammates.** Repository **Settings** → in the sidebar's **Access** section, **Collaborators** → **Add people** → search for the GitHub username → **Add NAME to twisted-takes**. Each person accepts the emailed invitation.
8. **Edit one copy only.** From now on, edit the new repository. The copy in `ist300-sandbox` can stay (it is excluded) or be removed once the new site is live.

## Publish with GitHub Pages

The site uses GitHub's built-in Jekyll build. No GitHub Actions workflow file, custom domain or paid service is needed.

1. Open the repository on GitHub and click **Settings**.
2. In the sidebar, under **Code, planning, and automation**, click **Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. In the branch drop-down choose **main**; in the folder drop-down choose **/ (root)**. Click **Save**.
5. Open the **Actions** tab. A run named **pages build and deployment** starts. A green check means the site is live; a red X means the build failed (click it to read the error).
6. Back in **Settings → Pages**, click **Visit site**. It can take up to 10 minutes for changes to publish after a push.

| Pages setting | Value |
|---|---|
| Source | Deploy from a branch |
| Branch | `main` |
| Folder | `/ (root)` |
| Custom domain | Leave empty |
| Repository visibility | Public (required on GitHub Free) |

**What GitHub builds.** Every push to `main`, including edits committed in the GitHub web editor, triggers a rebuild with the `github-pages` gem: Jekyll 3.10 with the `jekyll-feed` and `jekyll-sitemap` plugins listed in `_config.yml`. GitHub's builds use the production environment, so GA4 loads there once a Measurement ID is set. GitHub ignores the Gemfile on its servers; the Gemfile exists so your local preview matches.

**Limits worth knowing** ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)): published sites up to 1 GB, deployments time out after 10 minutes, soft limits of 10 builds per hour and 100 GB bandwidth per month. A failed build also sends an email to the pusher's primary address.

## Base path and article URLs

GitHub Pages serves two kinds of sites:

| Site type | Repository name | Public address | `url` | `baseurl` |
|---|---|---|---|---|
| Project site (current setup) | `twisted-takes` | `https://ttakita-su.github.io/twisted-takes/` | `"https://ttakita-su.github.io"` | `"/twisted-takes"` |
| User site | `ttakita-su.github.io` | `https://ttakita-su.github.io/` | `"https://ttakita-su.github.io"` | `""` |
| Project site on another account | e.g. `twisted-takes` owned by `USERNAME` | `https://USERNAME.github.io/twisted-takes/` | `"https://USERNAME.github.io"` | `"/twisted-takes"` |

Rules for `_config.yml`:

- `url` is the scheme and host only, with no trailing slash.
- `baseurl` is `/` plus the exact repository name, with no trailing slash, or `""` for a user site.
- Change both, commit, and wait for the rebuild. If you are previewing locally, restart `jekyll serve`.

Every link, image, script, canonical URL, feed entry and search request is built with Jekyll's `relative_url` (adds `baseurl`) or `absolute_url` (adds `url` + `baseurl`) filters, so these two values are the only things to change when the site moves. When you write internal links in Markdown, use the same pattern instead of typing the address:

```markdown
[Arrival]({{ '/reviews/arrival/' | relative_url }})
```

### Verify article URLs after publishing

1. Open `https://ttakita-su.github.io/twisted-takes/`. The page should be styled (warm off-white background, burgundy links). An unstyled page means `baseurl` is wrong.
2. Open a review directly by typing its address: `https://ttakita-su.github.io/twisted-takes/reviews/arrival/`. Refresh. It should load again with styles and images.
3. Click through the menu, a genre hub, a review card, the Reviews filters and a Watch Next collection.
4. Open a page that does not exist, such as `https://ttakita-su.github.io/twisted-takes/reviews/not-a-real-movie/`. You should see the styled "That page took an unexpected twist" 404 page.
5. On a review, view the page source (**Ctrl+U**, or **Option+Command+U** in Chrome on a Mac) and find `<link rel="canonical" href="https://ttakita-su.github.io/twisted-takes/reviews/arrival/">`. The `og:url` line should match.
6. Open `https://ttakita-su.github.io/twisted-takes/sitemap.xml` and `…/feed.xml`; every address should include `/twisted-takes/`.
7. Locally, run the static check:

   ```sh
   bundle exec jekyll build
   node tools/check-site.mjs
   ```

8. To test the user-site case (`baseurl: ""`) without changing `_config.yml`:

   ```sh
   bundle exec jekyll build --baseurl ""
   node tools/check-site.mjs --baseurl ""
   bundle exec jekyll build          # rebuild afterward so _site matches _config.yml again
   ```

Note: crawlers only read `robots.txt` at the root of a host, so on a project site `/twisted-takes/robots.txt` is ignored (harmless). It takes effect on a user site.

## Configuration reference

All settings live in `_config.yml`. Restart `bundle exec jekyll serve` after editing it; on GitHub, the push rebuilds the site.

| Key | Current value | What it controls |
|---|---|---|
| `title` | `"Twisted Takes"` | Browser tab titles, social previews, footer copyright, feed. The header/footer wordmark is separate text ([EDITOR_GUIDE §4](EDITOR_GUIDE.md#4-brand-colors-logo-featured-story-tagline)). |
| `tagline` | `"Strong opinions. Better watchlists."` | Home page browser title and the footer line. The home page heading is separate text in `index.html`. |
| `description` | Site summary | Default meta description and the home page's structured data. |
| `lang`, `locale` | `"en-US"`, `"en_US"` | `<html lang>` and `og:locale`. |
| `author` | `"Twisted Takes"` | Fallback byline. The `defaults:` block also sets `author: "Twisted Takes"` for reviews, posts and Watch Next, so credit a writer with `author:` in that file's front matter. |
| `url`, `baseurl` | see above | The site address ([Base path](#base-path-and-article-urls)). |
| `featured.collection`, `featured.slug` | `posts`, `five-genres-five-starting-points` | Story at the top of the home page. `collection` is `posts` or `watch_next`. If the slug is not found, the newest post is used. |
| `social.instagram`, `.tiktok`, `.youtube` | `""` | Profile URLs. Empty hides every link to that platform ([EDITOR_GUIDE §9](EDITOR_GUIDE.md#9-add-the-social-profile-urls)). |
| `analytics.ga4_measurement_id` | `""` | GA4 Measurement ID (`G-…`). Empty = no analytics code on any page. |
| `community_form.url`, `.embed_url`, `.provider`, `.label` | `""`, `""`, `""`, button text | Optional external form ([EDITOR_GUIDE §11](EDITOR_GUIDE.md#11-connect-an-external-community-form)). |
| `privacy.contact`, `privacy.extra_note` | `""` | Adds a Contact section and/or an extra sentence to `/privacy/`. |
| `timezone` | `"America/New_York"` | Displayed dates and the cutoff for future-dated content. |
| `theme`, `markdown`, `kramdown`, `plugins`, `feed`, `collections`, `defaults`, `exclude` | — | Build settings. Change with care. `exclude` keeps README.md, EDITOR_GUIDE.md, templates/ and tools/ off the public site. |

**Privacy notice.** `/privacy/` and the footer sentence are generated from these settings. With no GA4 ID, the footer says the site uses no analytics or tracking cookies. With an ID in a production build, both describe Google Analytics. With a form URL, both name the form `provider`. You do not edit the privacy page by hand; change the settings and it follows.

## Analytics and campaign measurement

### How the GA4 tag works here

- The tag is in `_includes/analytics.html`, loaded once per page in `<head>`.
- It loads only when `analytics.ga4_measurement_id` starts with `G-` (and is not the placeholder `G-XXXXXXXXXX`) **and** the build is a production build. GitHub Pages builds are production; the default local preview is not.
- Custom events go through `TT.track()` in `assets/js/site.js`, which does nothing when the tag is absent.
- The site never sends names, emails, form answers or free text. Do not add any.

### Step 1: Create the property and web stream

1. Go to [analytics.google.com](https://analytics.google.com) and click **Start measuring** (or, in **Admin**, **Create → Account**). Name the account (for example "Twisted Takes") and click **Next**.
2. Create a property: name "Twisted Takes", reporting time zone New York (US Eastern, to match the site), currency USD. Click **Next**, fill in business details and objectives, click **Create** and accept the terms.
3. Add a data stream: **Admin → Data collection and modification → Data streams → Add stream → Web**. Website URL: `https://ttakita-su.github.io` (the host only; the `/twisted-takes/` path is not needed). Stream name: "Twisted Takes website". Leave **Enhanced measurement** on for now. Click **Create stream**.
4. Under **Stream details**, copy the **Measurement ID** (starts with `G-`). Ignore the "View tag instructions" code; the site already contains the tag.
5. Optional: give teammates access with **Admin → Property → Access management → + → Add users** (the Viewer role is enough to read reports).

### Step 2: Turn it on

1. In `_config.yml` set:

   ```yaml
   analytics:
     ga4_measurement_id: "G-ABC123DEF4"   # your real ID
   ```

2. Commit and push (or commit in the GitHub web editor). Wait for the **pages build and deployment** run to finish.
3. If visitors may come from regions that require consent before analytics cookies (for example the EU or UK), look into a consent banner and Google's [Consent Mode](https://support.google.com/analytics/answer/9976101) before turning GA4 on. The site has no consent banner.

### Step 3: Set enhanced measurement for this site

**Admin → Data collection and modification → Data streams →** your web stream **→ Enhanced measurement →** settings (gear) icon:

| Option | Setting | Why |
|---|---|---|
| Page views | On (always) | Open its advanced settings and **uncheck "Page changes based on browser history events"**. The Reviews page updates its address with `history.replaceState` as people filter, which would otherwise count extra page views. |
| Scrolls | On | Records `scroll` when a reader reaches 90% of a page. |
| Outbound clicks | On | Records `click` with Link domain and Link URL. This is how clicks to Instagram, TikTok and YouTube are counted. |
| Site search | **Off** | The site sends its own privacy-filtered `search` event. GA's automatic version would record the raw `q` text. |
| Form interactions | **Off** | Would fire on the search boxes and add noise. |
| Video engagement | **Off** | The site embeds no video. |
| File downloads | Optional | The site offers no downloads today. |

### Events the site sends

| Event | When it fires | Parameters |
|---|---|---|
| `search` | Reviews page, about 1.2 s after typing stops (2+ characters), once per distinct term; also when the page opens with `?q=` from the header search | `search_term`: the normalized term (lowercase, max 60 characters) **only if it matched at least one review** and contains no `@` or 5+ digit run, otherwise `(no match)`; `results_count`: number of reviews shown |
| `filter_genre` | A genre checkbox is checked or unchecked | `genre` (`sci-fi`, `true-crime`, `fantasy`, `rom-com`, `horror`); `filter_action` (`add` or `remove`) |
| `filter_format` | A Format option is chosen | `format` (`all`, `movie`, `tv`) |
| `sort_reviews` | The Sort menu changes | `sort_order` (`title`, `title-desc`, `year-desc`, `year`) |
| `share` | **Copy link** succeeds, or the device share sheet completes | `method` (`copy_link` or `native_share`); `content_type` (`review`, `article`, `collection`); `item_id` (the page's slug) |

GA4 also collects `page_view`, `scroll` and outbound `click` from enhanced measurement, plus its automatic events.

### Step 4: Register custom dimensions (optional, for detailed reports)

GA4 only shows custom event parameters in reports after you register them, and only for data collected **after** registration (allow 24–48 hours). **Admin → Data display → Custom definitions → Custom dimensions → Create custom dimensions**, Scope **Event**, then **Save**:

| Dimension name | Event parameter |
|---|---|
| Genre filter | `genre` |
| Filter action | `filter_action` |
| Format filter | `format` |
| Sort order | `sort_order` |
| Shared content type | `content_type` |
| Shared item | `item_id` |

For the number of results, use **Custom metrics → Create custom metric**: name "Search results count", event parameter `results_count`, unit **Standard**. `search_term` and `method` feed GA4's built-in **Search term** and **Method** dimensions, so check Explore before registering them. Names cannot contain hyphens. The event parameter cannot be changed after saving.

### Step 5: Verify collection

1. Open the live site in a normal browser window with ad blockers paused. Visit a few pages, filter the Reviews page, click **Copy link** on a review.
2. In GA4 go to **Reports → Realtime**. Within a few minutes you should count as an active user, with `page_view` and your custom events listed. Data collection can take up to 30 minutes to begin after setup.
3. For event-by-event detail, use **DebugView** (**Admin → Data display → DebugView**). Turn on debug mode for your browser with [Tag Assistant](https://tagassistant.google.com) or the Google Analytics Debugger Chrome extension.
4. View the source of any page: `googletagmanager.com/gtag/js?id=G-…` should appear exactly once, inside `<head>`.
5. Locally: `JEKYLL_ENV=production bundle exec jekyll build`, then `node tools/check-site.mjs --expect-analytics` (and `node tools/browser-check.mjs --expect-analytics`). Visits to a local production preview send real hits, so keep them brief.

### Reading the reports

| Question | Where in GA4 |
|---|---|
| Users, sessions, page views | **Explore → Free form**: metrics **Active users**, **Sessions**, **Views**; set the date range to the campaign period. Do not add weekly user counts together; read the whole range at once. |
| Most-read pages | **Reports → Engagement → Pages and screens**. Switch the table's dimension to **Page path and screen class**; sort by **Views**. |
| Traffic from each platform | **Reports → Acquisition → Traffic acquisition**. Change the dimension to **Session source / medium** (`instagram / social`, `tiktok / social`, `youtube / social`). Use **Session campaign** to isolate `twisted_takes_launch` and **Session manual ad content** for `utm_content`. |
| Engagement rate | Same report, **Engagement rate** column. GA4: "An engaged session is a session that meets any of the following criteria: Lasts longer than 10 seconds; Has a key event; Has 2 or more screen or page views." "The engagement rate is the percentage of engaged sessions on your website or mobile app." |
| Clicks out to social profiles | Total: **Reports → Engagement → Events → `click`**. By platform: **Explore → Free form**, rows **Link domain** (and **Link URL**), value **Event count**, filter **Event name** exactly matches `click`, and **Link domain** contains `instagram.com`, `tiktok.com` or `youtube.com`. |
| Search, filter, share use | **Reports → Engagement → Events** for counts; Explore with the custom dimensions above for detail. |
| Poll responses and comments | **Not in GA4.** Count form responses in the form service's own responses view (Google Forms: **Responses** tab). Count comments in each platform's own analytics or insights. Report these numbers separately. |

Instagram and TikTok often open links in an in-app browser that drops the referrer, so those visits can show up as `(direct) / (none)`. That is why every promotional link needs UTM tags.

### Campaign links (UTM tags)

Add UTM tags only to **external promotional links that point to the blog** (bio links, captions, video descriptions, link stickers). Never add them to links inside the site. Keep values lowercase; GA4 treats `Instagram` and `instagram` as different sources.

| Parameter | Value |
|---|---|
| `utm_source` | `instagram`, `tiktok` or `youtube` |
| `utm_medium` | `social` (GA4 groups medium `social` into the Organic Social channel) |
| `utm_campaign` | `twisted_takes_launch` |
| `utm_content` | Optional, to tell posts apart, e.g. `bio_link`, `arrival_review`, `week2_prompt` |

```text
https://ttakita-su.github.io/twisted-takes/?utm_source=instagram&utm_medium=social&utm_campaign=twisted_takes_launch&utm_content=bio_link
https://ttakita-su.github.io/twisted-takes/?utm_source=tiktok&utm_medium=social&utm_campaign=twisted_takes_launch&utm_content=bio_link
https://ttakita-su.github.io/twisted-takes/?utm_source=youtube&utm_medium=social&utm_campaign=twisted_takes_launch&utm_content=channel_description
https://ttakita-su.github.io/twisted-takes/reviews/arrival/?utm_source=tiktok&utm_medium=social&utm_campaign=twisted_takes_launch&utm_content=arrival_review
https://ttakita-su.github.io/twisted-takes/reviews/arrival/?utm_source=instagram&utm_medium=social&utm_campaign=twisted_takes_launch&utm_content=arrival_review
https://ttakita-su.github.io/twisted-takes/reviews/arrival/?utm_source=youtube&utm_medium=social&utm_campaign=twisted_takes_launch&utm_content=arrival_review
```

Build links with Google's [Campaign URL Builder](https://ga-dev-tools.google/campaign-url-builder/) or by editing the examples. Pages keep a clean canonical URL, so tagged links do not create duplicate pages for search engines. The Reviews page keeps `utm_` parameters in the address while visitors search and filter.

### Four-week campaign targets

These are **targets, not results**. Never show them, or any analytics totals, on the public site.

| Target | Measured with |
|---|---|
| Two launch posts, then one new editorial article per week | Posts published in `_posts/` (approved) |
| 150 users and 300 page views over the four weeks | GA4 **Active users** and **Views**, full campaign date range |
| 15 genuine poll responses or discussion contributions | Form responses in the form service + comment counts in each platform's own analytics |

### Weekly tracking sheet (copy into a shared doc)

| Week | Dates | New articles | Active users | Views | Engagement rate | Sessions: instagram / tiktok / youtube | Outbound social clicks | Form responses | Comments: IG / TikTok / YT | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | |
| 2 | | | | | | | | | | |
| 3 | | | | | | | | | | |
| 4 | | | | | | | | | | |
| Campaign total | | | (read for full range) | | | | | | | |

## Verification tools

Both scripts read `url` and `baseurl` from `_config.yml` and check the built `_site/` folder, so run `bundle exec jekyll build` first.

**`node tools/check-site.mjs`**: no installs needed (Node 18+). Checks that every internal link, image, script and stylesheet resolves under the base path; that each page has one `<h1>`, `<html lang>`, a `<title>`, a meta description, a skip link and a canonical URL on the configured address (and that the 404 page has none); no `#` links or relative links; every `<img>` has alt text; no duplicate ids; the GA4 tag appears at most once per page (and not at all unless expected); `search.json` is valid and every review page in it exists; `sitemap.xml`, `robots.txt`, `feed.xml` and `404.html` exist. It prints review counts per genre.

| Flag | Use |
|---|---|
| `--baseurl ""` | Check a build made with `--baseurl ""` |
| `--url "https://USERNAME.github.io"` | Check against a different host |
| `--expect-analytics` | Require the GA4 tag exactly once per page (production build with an ID) |

**`node tools/browser-check.mjs`**: runs Chromium through Playwright against `_site/`, served like GitHub Pages (under the base path, 404.html for unknown URLs). One-time setup: `cd tools && npm install && npx playwright install chromium`. It checks the home page sections and featured link, direct review loads, copy-link feedback, Reviews search, combined filters, sorting, address-bar state, clear filters, the TV empty state, header search, genre hubs, Watch Next collections, the skip link, the 404 page, the mobile menu, no horizontal scrolling at 320, 375, 820 and 1280 px, the no-JavaScript fallback, console errors, and that no analytics requests happen unless expected.

| Flag | Use |
|---|---|
| `--baseurl ""` | After building with `--baseurl ""` |
| `--screenshots shots` | Also save full-page screenshots into `shots/` |
| `--expect-analytics` | Require analytics requests (production build with an ID) |

> `browser-check.mjs` reads its expected counts (reviews per genre, movie cards, Watch Next collections) from the built `search.json`, and the expected page background from `--color-bg` in `assets/css/main.css`, so adding reviews or collections or changing colors does not break it. It does assume the five genre hubs (`sci-fi`, `true-crime`, `fantasy`, `rom-com`, `horror`); add a key to its genre list if you add a sixth genre.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Live site is unstyled, or every link gives a 404 | `url`/`baseurl` do not match the repository. Fix them in `_config.yml` ([Base path](#base-path-and-article-urls)). |
| Images missing on one page | The `image:` path is wrong. GitHub Pages paths are case-sensitive; use lowercase file names and start paths with `/assets/…`. |
| New review or post does not appear | Its `date` is in the future (it appears with the first build on or after that date); the file is in the wrong folder or does not end in `.md`; a post's file name lacks the `YYYY-MM-DD-` prefix; the front matter is missing a `---` line; or a YAML error stopped the build. |
| Review appears on the Reviews page but not on its genre page | `primary_genre` does not exactly match a `key` in `_data/genres.yml`, or `media_type` is not `movie`/`tv`. |
| A related review or Watch Next pick is missing | The slug has a typo. Unknown slugs are skipped silently. |
| Changes are not live | Open the **Actions** tab: wait for the **pages build and deployment** run (up to 10 minutes) or open a failed run to read the error. Then hard-refresh (**Cmd+Shift+R** / **Ctrl+F5**). |
| Build failed with a YAML or Liquid error | The message names the file and line. Common causes: a value containing `: ` without quotes, tabs instead of spaces, curly quotes (“ ”) instead of straight quotes, an unescaped `"` inside a quoted value (use `\"`), or uneven indentation under `related_reviews:`. Run `bundle exec jekyll build` locally to see the same error. |
| Social links do not appear | The value in `_config.yml` is empty or not inside quotes. |
| GA4 shows nothing | The ID is empty, mistyped or not pushed; an ad blocker is on; or you are testing a local preview without `JEKYLL_ENV=production`. |
| `bundle: command not found`, or Ruby 2.6 errors on a Mac | Homebrew Ruby is not on your PATH. Repeat [Step 1](#step-1-install-ruby-33-once) and open a new terminal. |
| `browser-check.mjs` fails after you add content | Expected; see the note under [Verification tools](#verification-tools). |

## Official references

- What is GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- Configuring a publishing source: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- Setting up a GitHub Pages site with Jekyll: https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll
- Testing your GitHub Pages site locally with Jekyll: https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/testing-your-github-pages-site-locally-with-jekyll
- About Jekyll build errors: https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/about-jekyll-build-errors-for-github-pages-sites
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Inviting collaborators: https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-access-to-your-personal-repositories/inviting-collaborators-to-a-personal-repository
- GitHub Pages dependency versions: https://pages.github.com/versions/
- Jekyll on macOS / Windows: https://jekyllrb.com/docs/installation/macos/ and https://jekyllrb.com/docs/installation/windows/
- Set up Analytics for a website (GA4): https://support.google.com/analytics/answer/9304153
- Enhanced measurement events: https://support.google.com/analytics/answer/9216061
- Engagement rate and bounce rate: https://support.google.com/analytics/answer/12195621
- Collect campaign data with custom URLs (UTM): https://support.google.com/analytics/answer/10917952
- Campaign URL Builder: https://ga-dev-tools.google/campaign-url-builder/
- Realtime report: https://support.google.com/analytics/answer/9271392
- DebugView: https://support.google.com/analytics/answer/7201382
- Custom dimensions and metrics: https://support.google.com/analytics/answer/10075209 (create dimensions: https://support.google.com/analytics/answer/14239696; create metrics: https://support.google.com/analytics/answer/14239619)
- Traffic acquisition report: https://support.google.com/analytics/answer/12923437
- Pages and screens report: https://support.google.com/analytics/answer/12926732
- Free-form exploration: https://support.google.com/analytics/answer/9327972
- Default channel groups: https://support.google.com/analytics/answer/9756891
- Add users to Analytics: https://support.google.com/analytics/answer/9305788
- Consent mode: https://support.google.com/analytics/answer/9976101
