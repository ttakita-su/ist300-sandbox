# Architecture map: Free Bet Blackjack Strategy Trainer (MVP slice)

This map covers the MVP slice only: S11 → S1 → S2 → S3 (docs/lab3-backlog.md:174), plus S4 and S5, which the code also supports. On the PRD side that is V1 = F1, F2, F3, F4 (PRD.md:316). Every box names the requirement it exists for (`req:`). The numbers (1)–(10) are the hops of the S3 trace in [docs/03-architecture.md §5](../03-architecture.md#5-trace-s3-graded-decision-hop-by-hop). Anything not on the map is listed in [§7 Out of the map on purpose](../03-architecture.md#7-out-of-the-map-on-purpose).

```
 MVP SLICE ONLY:  S11 -> S1 -> S2 -> S3  (+ S4, S5)     PRD V1 = F1 F2 F3 F4
 req: = the story (S#) or PRD item (F#, section, PRD.md line) the box is for
 (n)  = hop n of the S3 trace, docs/03-architecture.md section 5 (1-10)

 +----------------------------------------------------------------------------+
 | BROWSER   desktop or phone; no install, no login, no payment               |
 | req: PRD 6.1 L127 (responsive web) | 6.1 L132 (no auth) | S5               |
 +----------------------------------------------------------------------------+
       | (1) GET https://ttakita-su.github.io/ist300-sandbox/free-bet/
       v
 +----------------------------------------------------------------------------+
 | GITHUB PAGES   serves the main branch from repo root (README.md:9-10)      |
 |                static files only: no build, no server code, no database    |
 | req: No PRD requirement - missing from PRD: static hosting at a public     |
 |      URL, no server code (M1, doc section 8)                               |
 +----------------------------------------------------------------------------+
       | (2) free-bet/index.html, which loads extension/strategy.js (L27)
       v
 +==== free-bet/index.html: one page, one shared global script scope =========+
 |  req: PRD 8 L316 V1 = F1 F2 F3 F4 (the trainer page) | 6.1 L127            |
 |                                                                            |
 |  +----------------------------------------------------------------+        |
 |  | RULE PRIMER   dialog#primer, closeRules()                      |        |
 |  | opened by deal() if seen=false, or by #rulesNav                |        |
 |  | req: F4 | S11                                                  |        |
 |  +----------------------------------------------------------------+        |
 |  +----------------------------------------------------------------+        |
 |  | TABLE UI   section#practice: render(), buttons H/S/D/P,        |        |
 |  |            #continue, #feedback panel via setFeedback(),       |        |
 |  |            strategy source line                                |        |
 |  | req: F1 F2 | S1 S3 | 6.3 screen 2 | 6.1 L131                   |        |
 |  +----------------------------------------------------------------+        |
 |     | (5) click        ^ (7) verdict shown,   | (4) and (8) #continue      |
 |     v -> choose(a)     |     no card drawn yet  v -> deal() / execute()    |
 |  +-----------------------------+    +-----------------------------+        |
 |  | GRADER   choose()           |    | HAND ENGINE (page half)     |        |
 |  | verdict correct/misplay/gap |    | deal() legal() execute()    |        |
 |  | game.decisions.push({...})  |    | advance() finish() draw()   |---+    |
 |  | #hint -> game.assisted=true |    | H17 loop, reshuffle at <78  |   |    |
 |  | req: F2 | S3 (S2 AC3)       |    | req: F1 | S1 S2             |   |    |
 |  +-----------------------------+    +-----------------------------+   |    |
 |     | (6) Strategy.best(h,up,n)         | Engine.* calls              |    |
 |     v      ^ (6) action or null         v                             |    |
 |  +----------------------------------------------------------------+   |    |
 |  | free-bet/extension/strategy.js  req: 6.1 L134 (shared data)    |   |    |
 |  | STRATEGY  Strategy.best; realHard freeHard realSoft freeSoft   |   |    |
 |  |   req: F2 | S2 AC3, S3 | 6.1 L131 cited, L134 shared data      |   |    |
 |  | ENGINE    Engine.rank value shoe freeDouble payout             |   |    |
 |  |   req: F1 | S1 S2                                              |   |    |
 |  +----------------------------------------------------------------+   |    |
 |  +-----------------------------+    +-----------------------------+   |    |
 |  | HISTORY VIEW                |    | STORAGE NOTICE              |   |    |
 |  | section#history, showLog(), |    | storageError(),             |   |    |
 |  | practice()                  |    | div#storageNotice           |   |    |
 |  | req: F3 | S4                |    | req: F3 L189 | 9.3 L351     |   |    |
 |  +-----------------------------+    +-----------------------------+   |    |
 |     ^ (10) renders in-memory logs                                     |    |
 +=====|=================================================================|====+
       |  (10) back: same visit -> showLog()      (9) finish() -> save() |
       |       next load -> getItem, :33 (3)        -> setItem, :34      |
       |                                                                 v
 +----------------------------------------------------------------------------+
 | localStorage   this browser only; origin ttakita-su.github.io              |
 | 'freebet.history.v1'  JSON array of completed rounds  req: F3 | S4         |
 | 'freebet.primer.v1'   'yes' after primer is closed    req: F4 L205 | S11   |
 | req for the store itself: PRD 6.1 L133 (browser storage, no backend)       |
 +----------------------------------------------------------------------------+

 +----------------------------------------------------------------------------+
 | TEST HARNESS   node free-bet/tests.cjs  (not served; runs strategy.js      |
 | and the index.html scripts in node:vm against a stub DOM)                  |
 | also runs side-panel parity (tests.cjs:36-79) + extension-tests.cjs (:80): |
 | F9 L263, V1.1, off the map                                                 |
 | req: 5.2 L110 | 9.1 L330 | 9.4 L359      last run: exit 0, all passed      |
 +----------------------------------------------------------------------------+

 NOT ON THE MAP (doc section 7): F5 summary, F6 rationale, F7 house rules,
 F8 variants, F9 Chrome extension (side panel, advisor, Rules, Classic,
 ClassicRules, Games), emulator, S6-S10, W1-W6, and the
 "HAND NN / 20" counter, not required by any F#/S# (doc section 8, M4).
```

## Legend: box → code → requirement

| Box | Where it is in code | Requirement it exists for |
|---|---|---|
| Browser | Any browser; viewport meta at `free-bet/index.html:4`, media queries at `:7` | PRD §6.1 L127, §6.1 L132, §9.4 L356; S5 |
| GitHub Pages | Repo-root Pages site, `main` branch (README.md:9-10); site root README.md:6, folder URL via per-folder `index.html` (README.md:27) | **No PRD requirement — missing from PRD:** a §6.1 Hosting row: static files at a public URL, no server code (M1) |
| Table UI | `section#practice` `index.html:14-22`; `render()` `:41-49`; `setFeedback()` `:39`; handlers `:64` | F1, F2; S1, S3; §6.3 screen 2 (PRD.md:282); §6.1 L131 (source cited, index.html:21) |
| Rule primer | `dialog#primer` `:26`; opened by `deal()` `:50` and `#rulesNav` `:66`; `closeRules()` `:66` (calls `deal()` only if no game exists, otherwise `render()`) | F4 (PRD.md:195-206); S11 |
| Grader | `choose()` `:54-55`; `#hint` handler `:65` | F2 (PRD.md:160-174); S3; S2 AC3 |
| Hand engine (page half) | `draw()` `:35`, `hand()` `:36`, `legal()` `:37`, `deal()` `:50-53`, `advance()` `:56`, `execute()` `:57`, `finish()` `:58-61` | F1 (PRD.md:142-156); S1, S2 |
| History view | `section#history` `:23`; `showLog()` `:62`; `practice()` `:63` | F3 (PRD.md:178-191); S4; §6.3 screen 4 |
| Storage notice | `#storageNotice` `:13`; `storageError()` `:32` | F3 L189; §9.3 L351 |
| Strategy | `Strategy` `free-bet/extension/strategy.js:4-17` | F2; S2 AC3, S3; §6.1 L131, L134 |
| Engine | `Engine` `strategy.js:18-24` | F1; S1, S2 |
| localStorage | keys read `index.html:33`, written `:34` and `:66` | §6.1 L133; F3 L185; F4 L205; S4, S11 AC2 |
| Test harness | `free-bet/tests.cjs` (80 lines); also runs F9 side-panel checks (tests.cjs:36-80), off the map | §5.2 L110; §9.1 L330; §9.4 L359 |

## S3 hops at a glance

The numbers match the ten hops in [docs/03-architecture.md §5](../03-architecture.md#5-trace-s3-graded-decision-hop-by-hop).

| Hop | From → to | Code |
|---|---|---|
| (1) | Browser → GitHub Pages | `GET https://ttakita-su.github.io/ist300-sandbox/free-bet/` |
| (2) | GitHub Pages → page | `index.html`, then `<script src="extension/strategy.js">` (`index.html:27`) |
| (3) | Page load → localStorage → UI | `getItem('freebet.history.v1')`, `getItem('freebet.primer.v1')` (`index.html:33`), then `render()` (`:67`) |
| (4) | UI → Engine (deal) | `#continue` → `deal()` (`:64`, `:50-53`): `Engine.shoe()` if `shoe.length<78`, `draw()` ×4 |
| (5) | UI → Grader | `button[data-action]` → `choose(a)` (`:64`, `:54`) |
| (6) | Grader → Strategy → Grader | `Strategy.best(h,game.dealer[0],game.hands.length)` (`:54`); uses `Engine.value`, `Engine.rank` (`strategy.js:9`); returns `'H'`/`'S'`/`'D'`/`'P'` or `null` |
| (7) | Grader → screen | verdict, `game.decisions.push(...)`, `setFeedback(...)`, `render()` (`index.html:54-55`); no card drawn yet |
| (8) | Screen → Engine (resolve) | `#continue` → `execute()` → `advance()` → `finish()` (`:64`, `:57`, `:56`, `:58-60`) |
| (9) | Engine → localStorage | `logs.unshift(...)`, `save()` → `setItem('freebet.history.v1', ...)` (`:61`, `:34`) |
| (10) | localStorage → back to screen | same visit: `#logNav` → `showLog()` from in-memory `logs` (`:62`, wired `:67`); next load: hop (3) loads the key into `logs` (`:33`); shown only after `showLog()` (`:62`, wired `:67`) |
