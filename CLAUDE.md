# CLAUDE.md

## Project context

This is Tomoyoshi Takita's sandbox for **IST300 — Prompts to Products** at Syracuse University. It contains several independent sites and coursework deliverables, rather than one application.

- Live site: https://ttakita-su.github.io/ist300-sandbox/
- GitHub Pages serves the repository root from `main`; pushing to `main` publishes changes.
- The existing stack is plain HTML, CSS, and JavaScript, with no build step. Preserve this approach unless a requested change calls for a different stack.
- There is no root `package.json` or repository-wide npm command. Rotation has its own package and an optional Node backend.

## Repository map

| Path | Purpose |
| --- | --- |
| `index.html` | Landing page linking to the sites |
| `free-bet/index.html` | Free Bet Blackjack Strategy Trainer; inline styling and page logic |
| `free-bet/extension/` | Manifest V3 Chrome side panel advisor; shared strategy and game logic |
| `free-bet/emulator/` | Browser preview of the extension beside a mock table |
| `blackjack/` | Blackjack 101: home, rules, strategy, glossary; shared `style.css` |
| `ist400-blogsite/` | Post-Credits movie and TV blog template; shared `style.css` |
| `closet-advisor/` | Rotation closet and shopping advisor prototype |
| `PRD.md`, `prd/index.html` | Free Bet product requirements in Markdown and published HTML |
| `docs/` | Lab backlog, technical architecture, architecture map, stack decision |
| `archive/` | Historical scratch files |

The Twisted Takes team blog moved to the separate `ist444` repository. `ist400-blogsite/` here is the Post-Credits template.

## Local commands

Run these from the repository root:

```sh
# Serve every site; Rotation runs in demo mode here.
python3 -m http.server 8000
# Open http://localhost:8000/

# Free Bet strategy, engine, trainer/side-panel parity, and extension tests.
node free-bet/tests.cjs

# Extension tests alone.
node free-bet/extension-tests.cjs
```

For Rotation, run commands inside `closet-advisor/`:

```sh
cd closet-advisor
npm start          # Node 24+; serves the app and live lookup API
npm run serve      # Static demo server only
npm test           # Node unit/integration tests; no dependency install required
npm run test:e2e   # Playwright browser checks
npm run eval       # Synthetic matching evaluation; rewrites docs/evaluation.md
```

Rotation needs no install step to run the app or unit tests. Browser tests require its dev dependencies (`npm ci`) and a Playwright Chromium installation (`npx playwright install chromium` if missing). `npm start` binds to `127.0.0.1`, tries ports 8130–8139, and prints the URL. `npm start -- --port 8140` selects another port.

## General editing conventions

- Keep each site's entry point as `index.html` within its own folder. Folder names are public URL paths.
- Use relative links and asset paths so sites work beneath `/ist300-sandbox/` on GitHub Pages. Avoid root-relative paths such as `/css/style.css`.
- Follow the existing organization of the affected site: some pages are self-contained; others share a stylesheet or JavaScript files. Avoid unrelated formatting changes, especially to dense inline code.
- Match each site's established visual style. Preserve responsive layouts, semantic HTML, labeled controls, keyboard access, visible focus, and reduced-motion support.
- Update the root landing page and README when adding a site or changing navigation.
- Never commit real credentials, local environment files, dependency directories, or machine-specific `.claude/settings.local.json`.
- Keep changes scoped to the request and preserve unrelated working-tree changes. Report what changed and what was actually verified.

## Free Bet trainer and extension

Read [free-bet/STRATEGY.md](free-bet/STRATEGY.md) before modifying rules, chart data, payouts, or recommendations.

- `free-bet/extension/strategy.js` is the single shared source for the trainer and side panel. It defines `Strategy`, `Engine`, `Rules`, `Classic`, `ClassicRules`, and `Games` as classic-script globals. Preserve its ability to load directly in both contexts.
- The trainer grades **Free Bet only** using `Strategy`. The side panel supports both Free Bet and regular blackjack using the appropriate game definitions.
- Preserve distinct original-hand and free-hand charts. Unsupported Free Bet states return a gap (`null`); do not invent an optimal play. Regular blackjack uses its documented fallback rules.
- Keep recommendations consistent with the cited chart and configured table rules. Explain rule changes and update the strategy reference and regression cases together.
- Trainer history uses `localStorage` keys `freebet.history.v1` and `freebet.primer.v1`. Only completed rounds persist; maintain compatibility with saved data.
- The extension requests only `sidePanel` and `storage`. It accepts manual card entry, makes no network requests, and does not inspect other pages. History uses `chrome.storage.local`, with a `localStorage` fallback for the plain-page preview.
- `node free-bet/tests.cjs` includes `extension-tests.cjs`. Its VM/stub-DOM tests do not replace checking changed UI in a browser. Load `free-bet/extension/` unpacked in Chrome for extension-specific behavior.
- Existing strategy fixtures do not establish that every launch requirement is complete. Consult `STRATEGY.md` for outstanding validation.

## Rotation (`closet-advisor/`)

Read [closet-advisor/README.md](closet-advisor/README.md) for operation and [closet-advisor/ARCHITECTURE.md](closet-advisor/ARCHITECTURE.md) for data contracts and design conventions. [closet-advisor/docs/PLAN.md](closet-advisor/docs/PLAN.md) describes a future production build; the current app is the vanilla JavaScript prototype.

### Boundaries

- `js/app.js` bootstraps the app; `js/lib/router.js` provides hash routing; `js/screens/index.js` registers screens.
- Screens call `api` from `js/client.js`. The in-tab API dispatcher is `js/server/api.js`; operations live in `js/server/ops/`, role/ownership policy in `js/server/policy.js`, and persistence in `js/server/db.js`.
- The prototype keeps items and photos in IndexedDB, with an in-memory fallback. Its browser "server" and demo accounts are not a production security boundary.
- `js/engine/` holds matching, recommendation, image, and related logic. Preserve Node-compatible pure logic and use provider adapters for browser-only work.
- `backend/` is a separate Node-only HTTP server for live store lookups. Browser code reaches it through same-origin `./api/*` requests in `js/server/providers/web.browser.js`; never import backend modules into browser code.
- GitHub Pages and static servers serve `api/status.json` with `live: false`. Only the Node server enables real product-link lookup, Bing search, and user-initiated photo search.
- `supabase/migrations/` and `.env.example` support the production plan. The prototype does not use Supabase or load `.env` files. Read `supabase/README.md` for migration gaps and validation limits before database work.

### Implementation conventions

- Use vanilla ES modules with explicit `.js` import extensions and JSDoc on exported functions.
- Render with the escaping `html` template in `js/lib/html.js`; reserve `raw()` for trusted generated markup. Pass `href` and `src` values through `safeUrl()`.
- Money uses integer minor units and an ISO currency; format it with the shared helpers. Record times as ISO strings and use injected `ctx.now()` in server operations. Unknown values stay `null`; sizes always include their size system.
- Reuse `css/tokens.css`, `css/components.css`, and `js/ui/`. Preserve the Archivo typography, indigo ink, signal-orange accent, label strips, both themes, and mobile touch targets.
- Keep fictional catalog data and demo offers labeled. Real store results become user-confirmed custom items; a seen store price is neither a paid price nor a verified offer.
- Photos leave the device for live visual search only after the user presses its search button. Preserve ownership checks, stylist redaction, image provenance, export, and deletion behavior.
- Preserve backend URL/address checks, request-origin checks, limits, and static-file allowlists. Exercise live lookup changes with fixture upstreams rather than real stores.
- Bump `DB_VERSION` when adding IndexedDB stores or indexes. Preserve existing data when changing persistence.
- The HTTPS app registers `sw.js`; investigate service-worker caches when published changes appear stale. API responses must stay outside that cache.

### Validation

Use `npm test` for data, engine, API, and backend changes; use `npm run test:e2e` for affected routes, photo flows, and web-product flows. Default tests use local fixtures; `npm run test:e2e -- --ocr` additionally downloads the optional OCR assets. Synthetic evaluation results do not establish accuracy on real product photos, and `npm run eval` changes a tracked report.

## Coursework and documentation

- Keep `PRD.md` and `prd/index.html` synchronized when requirements change.
- `docs/lab3-backlog.md` contains story IDs (`S#`, `W#`) and acceptance criteria; PRD features use `F#`. Retain those identifiers when tracing implementation to coursework.
- The Free Bet MVP architecture is documented in `docs/03-architecture.md`, `docs/design/architecture-map.md`, and `docs/decisions/001-stack.md`. Update affected diagrams, references, and limitations when changing that architecture.
- Describe implemented behavior separately from proposals. Do not claim interviews, independent audits, browser checks, deployments, or test runs that did not occur.
- For Post-Credits posts, follow `ist400-blogsite/README.md`: copy the appropriate sample, update the reviews archive, home feature/grid, and related-post links.

## Before finishing

Run the relevant existing checks and inspect the diff. For static-page changes, serve the site and check the affected links, layout, and interactions at phone and desktop sizes. For documentation-only work, check referenced paths and `git diff --check`; app tests are unnecessary unless behavior changes. State any checks that could not be run. Treat a push to `main` as publishing to the live site.
