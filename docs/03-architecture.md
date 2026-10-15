# CP-M3 Technical Architecture: Free Bet Blackjack Strategy Trainer

**Author:** Tomoyoshi Takita · **Date:** 15 October 2026 · **Covers:** `free-bet/` at the current `main`
**Companion files:** [architecture map](design/architecture-map.md) · [stack decision record 001](decisions/001-stack.md)

Every claim below is taken from the code as it is now. References use `file:line`. `PRD.md:N` and `L N` refer to lines of [PRD.md](../PRD.md); `S#` and `W#` refer to [docs/lab3-backlog.md](lab3-backlog.md). No app code was changed to write this document.

---

## 1. Purpose and scope

This document describes how the V1 trainer is built and why, for the **MVP slice only**:

- **Backlog MVP slice:** S11 → S1 → S2 → S3 (docs/lab3-backlog.md:174), plus **S4** (hand review) and **S5** (no account), which the code also supports.
- **PRD V1:** F1 Hand engine, F2 Decision grader, F3 Session log, F4 Rule primer (PRD.md:316).

What the MVP does, end to end: a player opens one web page, reads the three rule differences, plays randomly dealt Free Bet hands, gets a verdict on every decision before the next card, and reviews completed hands later in the same browser.

Everything else (F5–F9, S6–S10, W1–W6) is listed in [§7 Out of the map on purpose](#7-out-of-the-map-on-purpose). The Chrome extension code that lives in `free-bet/extension/` is real, but it is V1.1 (F9) and is not on the map. The map includes only the one file the trainer shares with it, `free-bet/extension/strategy.js`.

---

## 2. Stack decision

### 2.1 The decision

**Plain HTML, CSS and JavaScript. No framework, no build step, no dependencies, no backend.**

| Layer | Choice | Where it is |
|---|---|---|
| Page | One HTML file with an inline `<style>` (all CSS on line 7) and one inline `<script>` | `free-bet/index.html:6-8`, `:28-68` |
| Shared logic | One classic browser script that declares top-level `const` objects `Strategy` and `Engine`. It has no `module.exports` or `export` | `free-bet/extension/strategy.js:4-24` |
| Hosting | GitHub Pages serves the `main` branch from the repo root, as committed | README.md:9-10 |
| Storage | Browser `localStorage`, two keys | `index.html:33`, `:34`, `:66` |
| Tests | Node script that runs the real files in `node:vm` | `free-bet/tests.cjs` |

`free-bet/` has no `package.json`, no bundler and no CDN. The page loads exactly one other file, `extension/strategy.js` (`index.html:27`). Its only external link is a plain `<a>` to the Wizard of Odds source (`index.html:21`).

### 2.2 Compared against one real alternative: React + Firebase

The alternative is a React single-page app built with a bundler, hosted on Firebase Hosting, with history in Firestore and, if needed, Firebase Auth.

| Criterion (requirement) | Plain HTML/JS + GitHub Pages + localStorage | React + Firebase | Winner |
|---|---|---|---|
| No backend required (§6.1 L133) | No backend at all | Firestore is a backend: a cloud project, security rules, quotas | Plain |
| No account, 60-second start (§6.1 L132, §5.2 L111, S5, W6) | Nothing to sign in to | Firestore per-user data needs Auth (even anonymous) or open rules | Plain |
| Extension shares the same strategy data, no network (§6.1 L134, F9 L263-264) | The extension loads the same `strategy.js` file (`extension/sidepanel.html:75`) | The shared chart would still have to stay a plain script for the extension; the Firebase sync is network traffic the extension must not make | Plain |
| Testability of grader and engine (§9.4 L359, §5.2 L110) | `tests.cjs` runs the actual `strategy.js` and the page's own scripts in `node:vm` (tests.cjs:3-4, 26-30) | Jest/Vitest plus a build config; components are testable but the setup is larger | Plain, narrowly |
| History across devices and browsers (not required by the PRD) | No: one browser only | Yes, with sign-in | React + Firebase |
| Central measurement of §5.2 metrics (L109, L112) | No: each player's log stays in their browser | Possible via Firestore or Analytics | React + Firebase |
| Maintainability as UI grows (F5–F8 later) | Hand-written DOM updates in one 70-line file | Components, state handling, a big ecosystem | React + Firebase |
| Running cost | Free | Free on the Firebase free tier at this scale | Tie |
| **My familiarity** (a personal criterion, not a technical one) | I know plain HTML/JS well | I would be learning React and Firebase during the capstone | Plain |

**Decision:** plain HTML/JS. It is the only option that meets §6.1 L132–L134 without extra parts, and it lets the trainer and extension load one strategy file unchanged. Familiarity is one of my reasons, and it is listed above as exactly that: a reason about me, not about the product.

### 2.3 What I am giving up (concrete costs)

1. **Data lives in one browser.** History is per browser and per device. Clearing site data, private windows, or switching devices loses it. No sync, no backup.
2. **Shared origin.** Every GitHub Pages project under `ttakita-su.github.io` shares one `localStorage` origin. The keys are namespaced `freebet.*`, but any page on that origin can read or overwrite them.
3. **No size cap, clear or export.** `logs.unshift(...)` (`index.html:61`) grows forever. There is no `removeItem`, `clear()` or export control. The browser's storage quota is the only limit, and when it is hit, `save()` fails into `storageError()` (`index.html:34`).
4. **No server means no metrics.** §5.2 L109 (session completion) and L112 (accuracy improvement) cannot be collected from real users. They need manual observation.
5. **One dense file.** All CSS is on line 7 and the whole app script is on lines 28–68, with many lines over 300 characters. It is hard to read, review or diff.
6. **Globals instead of modules.** `strategy.js` declares six top-level `const` objects and exports nothing. Tests must evaluate the files in `node:vm` and add `;globalThis.api={Engine,Strategy};` to get at them (`tests.cjs:4`).
7. **Game rules are split across two files.** The reshuffle point (`index.html:51`), the dealer's soft-17 loop (`:59`), legal moves (`:37`) and action handling (`:57`) are in the page, not in `Engine`. See gap G20.
8. **No type checking and no component reuse.** Mistakes in object shapes (for example a history entry) are found only at run time.
9. **No staging.** A push to `main` is live within about a minute (README.md:9–10). A broken commit goes straight to users.
10. **Tests do not use a real browser.** The DOM, `showModal`, CSS and `localStorage` are stubs (`tests.cjs:26-27`), so layout, dialogs and storage failure are untested.

---

## 3. Components (MVP slice only)

Each row is one box on the [map](design/architecture-map.md). A component with no requirement would be removed. The one needed component with no PRD requirement (hosting) is kept and flagged in [§8](#8-requirements-the-prd-is-missing).

| Component | What it is in code | Requirement it exists for |
|---|---|---|
| **Browser** | Any modern browser. Viewport meta `index.html:4`. Media queries for 820px and 480px widths `index.html:7` | §6.1 L127 (responsive web, no install); §6.1 L132 (no auth); §9.4 L356; S5 |
| **GitHub Pages** | Static hosting of `main` from the repo root (README.md:9-10). The site root is `https://ttakita-su.github.io/ist300-sandbox/` (README.md:6), and each folder has its own `index.html` (README.md:27), so the trainer is at `https://ttakita-su.github.io/ist300-sandbox/free-bet/` (the exact URL appears in `free-bet/extension/sidepanel.html:54`) | **No PRD requirement — missing from PRD:** Hosting: the V1 trainer is served as static files from a public URL (GitHub Pages, `main` branch); no server-side code. (M1, §8) |
| **Table UI** | `section#practice` (`index.html:14-22`): `render()` (`:41-49`), action buttons `data-action="H"/"S"/"D"/"P"` (`:17`), `#continue` (`:19`), feedback panel `#feedback` with `aria-live="polite"` filled by `setFeedback()` (`:39`), source citation line (`:21`). Click handlers at `:64` | F1, F2; S1, S3; §6.3 screen 2 (PRD.md:282); §6.1 L131 (source cited) |
| **Rule primer** | `dialog#primer` (`:26`). `deal()` opens it when `seen` is false (`:50`). `#rulesNav` opens it at any time (`:66`). `closeRules()` sets `seen=true`, writes `freebet.primer.v1`, closes the dialog, then calls `deal()` if no game exists, otherwise `render()` (`:66`) | F4 (PRD.md:195-206); S11 |
| **Grader** | `choose(a)` (`:54-55`): calls `Strategy.best`, sets `verdict` to `'gap'`, `'correct'` or `'misplay'`, pushes a decision record, sets `pending`. `#hint` handler (`:65`) sets `game.assisted=true` and shows the best move | F2 (PRD.md:160-174); S3; S2 AC3 |
| **Hand engine, page half** | `draw()` `:35`, `hand()` `:36`, `legal()` `:37`, `deal()` `:50-53` (reshuffle when `shoe.length<78`, deal order, peek), `advance()` `:56`, `execute()` `:57` (hit, stand, double, split), `finish()` `:58-61` (dealer hits soft 17, payouts, log) | F1 (PRD.md:142-156); S1, S2 |
| **Engine** (in strategy.js) | `Engine.rank` `strategy.js:19`, `value` `:20`, `shoe` `:21` (6 decks, Fisher–Yates with `Math.random`), `freeDouble` `:22`, `payout` `:23` | F1; S1, S2 |
| **Strategy** (in strategy.js) | `Strategy.realHard`, `freeHard`, `realSoft`, `freeSoft` (`:5-8`, 10-character strings, dealer 2 to A) and `Strategy.best(hand,up,count)` (`:9-16`), which returns `'H'`, `'S'`, `'D'`, `'P'` or `null` (gap) | F2; S2 AC3, S3; §6.1 L131, L134 |
| **History view** | `section#history` (`:23`), `showLog()` (`:62`) lists rounds newest first, adds class `misplay` and shows "Best: X" and "Answer shown". `practice()` (`:63`) switches back | F3 (PRD.md:178-191); S4; §6.3 screen 4 |
| **Storage notice** | `div#storageNotice` with `role="alert"` (`:13`), shown by `storageError()` (`:32`) | F3 L189; §9.3 L351 |
| **localStorage** | Keys `freebet.history.v1` and `freebet.primer.v1` (see §4) | §6.1 L133; F3 L185; F4 L205; S4; S11 AC2 |
| **Test harness** | `free-bet/tests.cjs` (80 lines), which also runs `free-bet/extension-tests.cjs` (`tests.cjs:80`) | §5.2 L110; §9.1 L330; §9.4 L359 |

**S5 has no box of its own.** It is met by what is absent: there is no login, account or payment code anywhere in `index.html`. The page shows "Free practice · No account needed" (`:15`) and "Learning only · No real money" (`:24`).

**Loaded but not used by the trainer:** `strategy.js` also declares `Rules`, `Classic`, `ClassicRules` and `Games` (`:26-56`). `index.html` never references them. They belong to the F9 side panel and are off the map (§7).

**Untraced UI removed from the map:** the hand counter `HAND NN / 20` (`index.html:42`), the `#progress` text "`N of 20 practice hands completed`" (`:48`) and the "Twenty hands. Nicely done." message (`:61`). They are not required by any F#/S#; the 20-hand target appears only as a metric and gate (§5.2 L109, §8 L316, §9.5 L363). See M4 and G21.

---

## 4. Data and storage

### 4.1 Keys

| Key | Value | Read | Written | Requirement |
|---|---|---|---|---|
| `freebet.history.v1` | JSON array of completed rounds, newest first | Once, at page load (`index.html:33`) | `save()` (`:34`), called only from `finish()` (`:61`) | F3; S4 |
| `freebet.primer.v1` | The string `'yes'` | Once, at page load: `seen=localStorage.getItem('freebet.primer.v1')==='yes'` (`:33`) | `closeRules()` (`:66`) | F4 L205; S11 AC2 |

No `sessionStorage`, IndexedDB or cookies are used.

### 4.2 Shape of one history entry

`finish()` stores a deep copy, `JSON.parse(JSON.stringify({...game, timestamp, dealerFinalTotal, results}))` (`index.html:61`):

```
{
  hands:     [ { cards:[{r,s}], free, split, aces, risk, units, done, payout } ],
  dealer:    [ {r,s} ],
  index, assisted, done,
  decisions: [ { cards, hand, free, dealerUpcard, action, optimal,
                 verdict, assisted, timestamp } ],      // pushed in choose(), :54
  timestamp,                                            // ISO string, round end
  dealerFinalTotal,                                     // Engine.value(game.dealer).total
  results:   [ "Win +1" | "Loss -1" | "Push · dealer 22" | ... ]
}
```

That covers all eight fields F3 L183 lists. Seven are stored per decision. Dealer final total is stored once per round.

### 4.3 Load check and limits

- **On load** (`:33`): the value must be an array, and every item must have array `hands` and array `decisions`. If not, it throws `Error('Invalid history')`. The catch calls `storageError()` and sets `logs=[]`.
- **During a visit**, nothing re-reads storage. `showLog()` renders the in-memory `logs`.
- **Only completed rounds persist.** A round in progress is lost on refresh (STRATEGY.md:13; G22).
- **No size cap, no clear, no export, no migration.** The `.v1` suffix is the only versioning.
- **Error handling:** every read and write is in try/catch (`:33`, `:34`, `:66`), and each failure calls `storageError()`.

---

## 5. Trace: S3 (graded decision), hop by hop

S3: "As someone unsure of a play, I want to be told the correct action and whether mine matched" (docs/lab3-backlog.md:39). AC1: the verdict "states correct or incorrect and names the optimal action" (:42). The example below is a returning player who stands on a hard 16.

| # | Hop | What happens, from the code |
|---|---|---|
| 1 | **Browser → GitHub Pages** | The browser requests `https://ttakita-su.github.io/ist300-sandbox/free-bet/`. GitHub Pages serves the `main` branch from the repository root (README.md:9-10; live root README.md:6), and the folder URL resolves to `free-bet/index.html` because each site folder has its own `index.html` (README.md:27). Nothing is built or rendered on a server. |
| 2 | **GitHub Pages → page** | The browser parses the inline CSS (`index.html:6-8`), then fetches `extension/strategy.js` from the same origin (`:27`). That defines `Strategy` (`strategy.js:4-17`) and `Engine` (`:18-24`) as globals. The inline script (`index.html:28-68`) then declares state `shoe=[]`, `game=null`, `pending=null`, `completed=0`, `logs=[]`, `seen=false` (`:31`). |
| 3 | **Page load → localStorage → UI** | The startup `try` reads `freebet.history.v1` into `logs` and `freebet.primer.v1` into `seen` (`:33`). Handlers are wired (`:64-67`), and `render()` shows an empty table with "READY WHEN YOU ARE" (`:42`, `:67`). |
| 4 | **UI → Engine (deal)** | The player clicks `#continue` ("Start practicing →", `:19`). Its handler is `pending?execute():deal()` (`:64`). `deal()` (`:50`) would open `dialog#primer` here if `seen` were false (F4/S11). For this player it reshuffles if `shoe.length<78` using `Engine.shoe()` (`:51`, `strategy.js:21`), deals player, dealer, player, dealer with `draw()` (`index.html:35`), and builds `game={hands:[hand(p)],dealer:d,index:0,decisions:[],assisted:false,done:false}`. If either side has a two-card 21, it calls `finish()` at once (`:52`). Otherwise `setFeedback('What’s your move?', ...)` and `render()` (`:53`). `render()` enables each button only where `legal(h)` allows it (`:46`, `:37`) and labels the Double button "Free double" when `Engine.freeDouble(h)` is true (`:47`). |
| 5 | **UI → Grader** | The player clicks `button[data-action="S"]` (`:17`). Its handler calls `choose('S')` (`:64`). `choose()` returns early if there is no game, the round is done, a move is pending, the primer is open, or the move is not legal (`:54`). |
| 6 | **Grader → Strategy (→ Engine)** | `choose()` calls `Strategy.best(h, game.dealer[0], game.hands.length)` (`:54`). In `strategy.js:9`, `Engine.value(hand.cards)` returns `{total:16, soft:false}` and `Engine.rank(up)-2` picks the upcard column. The split-aces, pair and hard 9–11 checks (`:10-12`) do not apply. `:13` picks `realHard` because `hand.free` is false. `:14` reads `realHard[16][i]`, for example `'S'` against a 2. A `null` would mean "strategy gap" (F2 L171). |
| 7 | **Strategy → Grader → screen** | Back in `choose()`: `verdict = best===null ? 'gap' : best===a ? 'correct' : 'misplay'`. A record `{cards, hand, free, dealerUpcard, action, optimal, verdict, assisted, timestamp}` is pushed to `game.decisions`, and `pending='S'` (`:54`). `setFeedback(...)` (`:55`) writes the title ("That’s the right move." or "A chance to learn." or "Strategy gap") and "You chose stand. The chart recommends stand for this original hand." into `#feedback` (`aria-live="polite"`, `:19`). It also sets class `good` or `bad` and shows "Continue →". `render()` disables all actions while `pending` is set. Focus moves to `#continue`, and on screens 820px wide or less the panel scrolls into view. **No card has been drawn yet**, which meets F2 L167, "before the next card is dealt". |
| 8 | **Screen → Engine (resolve)** | The player clicks "Continue →". `#continue` now calls `execute()` (`:64`, `:57`), which clears `pending` and applies the action (Stand sets `h.done=true`). `advance()` (`:56`) moves to the next unfinished hand. If none remain, it calls `finish()` (`:58`). `finish()` runs the dealer loop `while(v.total<17||(v.total===17&&v.soft))` (`:59`), scores each hand with `Engine.payout(h, game.dealer, !h.split&&h.cards.length===2)` (`:60`, `strategy.js:23`) and increments `completed`. |
| 9 | **Engine → localStorage** | `finish()` runs `logs.unshift(JSON.parse(JSON.stringify({...game, timestamp, dealerFinalTotal, results})))`, then `save()` (`:61`). `save()` runs `localStorage.setItem('freebet.history.v1', JSON.stringify(logs))`, and a failure calls `storageError()` (`:34`, `:32`). The feedback panel shows the results and "Deal next hand →" (`:61`). |
| 10 | **localStorage → back to the screen** | *Same visit:* "Hand history" (`#logNav`, `:11`, handler `:67`) calls `showLog()` (`:62`). It renders the in-memory `logs` newest first, with class `misplay` on rounds that have a misplay and a line per decision: "Hand 1: 10♠ 6♥ vs 2♣ — Stand · Correct · Best: Stand". *Next visit:* hop 3 (`:33`) loads `freebet.history.v1` into the in-memory `logs`, but nothing is rendered from it on load. The entries show again only when the player opens Hand history, which calls `showLog()` (`:62`, wired at `:67`) (F3 L185). `completed` (`:31`) is not restored, so the progress line restarts at 0. "Back to table →" (`#back`, `:23`, handler `:67`) calls `practice()` (`:63`), and the next `deal()` starts the loop again at hop 4. |

**Assisted variant (S3 AC3):** if the player clicks `#hint` before acting, its handler (`:65`) sets `game.assisted=true`, calls the same `Strategy.best`, and shows "Best move: Stand". The next decision record then stores `assisted:true`, `#progress` adds " · Assisted hand" (`:48`), and the log shows "Assisted" and "Answer shown" (`:62`). The flag is built, but the "excluded from unassisted accuracy" half is not, because no accuracy figure exists (G9).

**Timing (F2 L167, under 1 second):** hops 5–7 are synchronous calls in the page with no network. It has not been measured (§6).

---

## 6. Testing

| What | How | Requirement | Result |
|---|---|---|---|
| **Full suite** | `node free-bet/tests.cjs`, run 15 October 2026 | §9.4 L359 | **Exit code 0. Passed.** Output: "Passed 200 chart regression cases plus engine, gap, and shared-strategy checks; the side panel matched all 3573 trainer decisions in 2815 rounds (213 with splits, 56 resplits, 57 split aces, 23 at four hands, 12 with chart gaps)." then "Passed 52 extension checks." |
| 200-case chart regression | 20 fixture rows (10 original-hand, 10 free-hand) × 10 upcards against `S.best` (`tests.cjs:7-11`) | §5.2 L110; §9.1 L330; §9.2 L339; S2 AC3 | Pass. The fixtures were transcribed from the same source as the chart (STRATEGY.md:11), so they are not an independent check (G5) |
| Gap handling | `S.best` returns `null` for 3,3,3 vs 6 and for 8,8 vs 6 at four hands (`tests.cjs:12-13`) | F2 L171; §9.2 L340 | Pass |
| Engine | `E.value` (`:14`), `E.freeDouble` (`:15-16`), `E.payout`, including dealer 22 push, blackjack 1.5, free hands (`:17-22`), `E.shoe` 312 cards, 6 of each (`:23`) | F1; §9.2 L334-L338; S2 | Pass |
| Trainer uses the shared chart | Runs the real `index.html` scripts in `node:vm`; altering `strategy.js` changes the trainer's grade (`:24-34`) | §6.1 L134; S2 AC3 | Pass |
| Trainer vs side panel | 3,000 seeded trainer rounds (2,815 compared after skipping dealer naturals), checked decision by decision against the side panel (`:36-79`) | F9 L263 (V1.1, off the map) | Pass |
| **Not tested** | Real DOM, CSS and layout; `showModal` is a stub; `localStorage` is an in-memory stub pre-seeded with `{'freebet.primer.v1':'yes'}` (`tests.cjs:26-27`), so the first-visit primer, reload, corrupt history and storage failure are never run; the 78-card reshuffle point; phone portrait (`innerWidth:1200`); keyboard and focus (§9.4 L357); timing (F2 L167, §5.2 L111); GitHub Pages deploy | §9.3 L349, L351, L352; §9.4 L356, L357 | Open. See G17 and G19 |

---

## 7. Out of the map on purpose

| Item | Why it is not on the map |
|---|---|
| **F5 Session summary** (PRD.md:210) / S7 | V1.1 and a hypothesis. Not built. Its accuracy figure is what F2 L168's "exclusion" would need (G9) |
| **F6 Decision rationale** (PRD.md:226) / S6 | V1.1. Not built |
| **F7 Configurable house rules** (PRD.md:238) / S9 | V2 and a hypothesis. The trainer has no rule settings |
| **F8 Additional variants** (PRD.md:246) / S10 | V2. "No implementation in V1". The trainer is Free Bet only |
| **F9 Chrome extension** (PRD.md:254) | V1.1. Code exists in `free-bet/extension/` (`sidepanel.html/js/css`, `advisor.js`, `background.js`, `welcome.*`, `manifest.json`) and `free-bet/emulator/`. Only the shared `strategy.js` (`Strategy`, `Engine`) is mapped |
| `Rules`, `Classic`, `ClassicRules`, `Games` in `strategy.js:26-56` | Used only by the side panel. `index.html` never references them. `Classic` (regular blackjack) has no requirement at all (G23) |
| **S8 Targeted drills** | SHOULD, with no PRD feature. Not built |
| **W1** Live mid-hand assistance | Won't: cut on interview evidence (docs/lab3-backlog.md:152) |
| **W2** Real money play | Won't: changes the product category and legal exposure (:155). §7.2 L303 |
| **W3** Runtime-solver games | Won't: needs a different engine from a chart lookup (:158). §7.2 L305 |
| **W4** Poker | Won't: no fixed optimal-play table (:161). §7.2 L304 |
| **W5** Card counting | Won't: separate skill, already served by other tools (:164). §7.2 L306 |
| **W6** Accounts, profiles, leaderboards | Won't: contradicts S5 (:167). §7.2 L307 |
| Hand counter "HAND NN / 20" (`index.html:42`, `:48`, `:61`) | In the code but not required by any F#/S# (the 20-hand target is only a metric/gate, §5.2 L109, §8 L316). Kept out of the map; see M4 |

---

## 8. Requirements the PRD is missing

These components or behaviors exist, or are needed, but no PRD item asks for them.

| # | Component or behavior | Status | Suggested requirement to add |
|---|---|---|---|
| **M1** | **Hosting** (GitHub Pages) | **No PRD requirement — missing from PRD:** §6.1 Hosting row (see suggestion). The PRD names a "browser-based" trainer with "no install" (L17, L127) but no host or public URL | §6.1 row: "Hosting: the V1 trainer is served as static files from a public URL (GitHub Pages, `main` branch); no server-side code." |
| **M2** | **Storage keys, retention and clearing** | **No PRD requirement — missing from PRD:** storage key, retention and clear/export rules (see suggestion). §6.1 L133 says only "browser local storage". | F3 bullet: "History is stored under a versioned key, capped at N rounds (or explicitly unbounded), and the player can clear or export it." |
| **M3** | **Definition of a session** | **Missing from PRD.** §5.2 L109, §8 L316, §9.5 L363 and S4 AC1 ("Given a session ends") all depend on it. The code has no session boundary | F3 bullet: "A session is one page visit (or 20 hands); the log marks session start and end." Or reword S4 AC1 |
| **M4** | **Hand counter and 20-hand target** (`index.html:42`, `:48`, `:61`) | **No PRD requirement — missing from PRD:** a progress-counter requirement (see suggestion). No F# or S# asks for a progress counter. The 20-hand target exists only as a metric/gate (§5.2 L109, §8 L316, §9.5 L363; backlog L178), not as a UI requirement. Kept off the map until the PRD says whether the trainer shows progress toward it | Either add F1/F3 bullet "Shows progress toward the 20-hand session target (§5.2 L109)" or remove the counter in a later change |
| **M5** | **Round in progress on refresh** | **PRD is silent.** The code discards it (STRATEGY.md:13) | F3 constraint: "An unfinished round is discarded on refresh" (or "restored") |
| **M6** | **Full rule set the engine enforces**: dealer peek, no surrender, four-hand cap, split aces one card and resplittable, paid doubles after splits, a two-card 21 after a split pays even money, tens never split, no insurance | **Missing from §6.1 L130.** `legal()`, `advance()`, `execute()` and `finish()` enforce them | Amend the §6.1 Default rules row to the rule list in STRATEGY.md:7 and `Rules.full` (`strategy.js:28`) |
| **M7** | **Unassisted-accuracy figure in V1** | **Missing from V1.** F2 L168 and S3 AC3 require an exclusion from a figure the PRD defines only in F5 (V1.1) | Move the exclusion wording to F5/S7, or add a V1 F2 bullet that computes unassisted accuracy |
| **M8** | **S# ↔ F# traceability** | **Missing from both docs.** The backlog never cites an F number and the PRD never cites an S number | Add a "Stories: S1, S2" line under each F#, or a "PRD: F1" line under each story |

The test harness has a requirement (§5.2 L110, §9.4 L359) and is not listed here.

---

## 9. Known gaps

Each gap compares the code with the PRD or backlog. **No code was changed.** "Fix in" says where the fix belongs.

### 9.1 Checked and matching (for the record)

| PRD item | Code | Match |
|---|---|---|
| F1 L147: six decks, reshuffle when penetration exceeds 75% | `Engine.shoe()` builds 6 × 4 × 13 = 312 cards (`strategy.js:21`). `deal()` reshuffles when `shoe.length<78` (`index.html:51`), i.e. after more than 234 of 312 cards (75%). The check runs only between hands | Yes |
| F1 L148, §9.2 L334: free double on hard 9, 10, 11 only | `Engine.freeDouble` requires two cards, hard, total 9, 10 or 11 (`strategy.js:22`) | Yes |
| F1 L149: free split on all pairs except tens | `legal()` blocks rank 10 (`index.html:37`). Each split creates the new hand with `hand([second,draw()],true,true,aces)`, i.e. `free=true`. The original hand keeps its bet (`h.split=true`, `h.free` unchanged) (`:57`); the chip shows "◉ ORIGINAL BET" on it and "◉ FREE BET" only on the new hand (`:45`). Tens cannot be split at all (see G3) | Yes |
| F1 L151: 3:2 blackjack, 1:1 otherwise | `payout` returns `1.5` or `h.units` (`strategy.js:23`) | Yes |
| §6.1 L130: dealer hits soft 17 | `while(v.total<17||(v.total===17&&v.soft))` (`index.html:59`) | Yes |
| F2 L166: names the optimal action regardless of outcome | Feedback text names it before the card is drawn (`:55`) | Yes |
| F2 L171: report a gap rather than infer | `Strategy.best` returns `null` and the verdict is `'gap'` (`strategy.js:10-15`, `index.html:54`) | Yes |
| F3 L184: newest first, misplays marked | `logs.unshift` (`:61`), class `misplay` (`:62`) | Yes |
| F4 L201, L202, L206: persistent control, keeps hand state, no deal while open | `#rulesNav` (`:11`, `:66`). `deal()`, `choose()`, `execute()` and `#hint` return early while the primer is open (`:50`, `:54`, `:57`, `:65`) | Yes in code; untested (G17) |

### 9.2 Gaps in the MVP slice

| # | Requirement | What the code does | Type | Fix in |
|---|---|---|---|---|
| **G1** | F1 L150, §9.2 L336, S2 AC2 (backlog L30): dealer 22 pushes against **all** non-busted hands | `Engine.payout` checks `if(bj)return 1.5;` before `if(d===22||t===d)return 0;` (`strategy.js:23`), so a natural beats a dealer 22. `Rules.full` (`:28`) and STRATEGY.md:7 document this exception. The trainer cannot reach the case: a two-card 21 ends the round in `deal()` (`index.html:52`), and `finish()` skips the dealer draw on a natural (`:58-59`). No test covers it (tests.cjs:18 uses non-naturals) | Code differs from PRD (unreachable) | PRD: add "except a natural" at L150, L336 and backlog L30 |
| **G2** | F1 L152 "Offers hit, stand, double, split, and surrender where configured"; L144 "configured rule set" | No surrender. The only buttons are H/S/D/P (`index.html:17`, `names` `:30`). The UI says "No surrender" (`:21`, `:26`), as do `Rules.short`/`full` (`strategy.js:27-28`). There is no rule configuration (that is F7, V2). §6.1 L130 never says "no surrender" | PRD lists a feature the fixed rule set excludes | PRD: add "no surrender" to §6.1; reword L152 |
| **G3** | §6.1 L130 Default rules | The code also enforces rules the PRD never states: dealer peek (`index.html:52`; blackjack beats non-blackjack, `strategy.js:23`); four-hand cap (`game.hands.length<4`, `index.html:37`); split aces get one card, resplit allowed (`:37`, `:56`); paid doubles on any non-split-ace two-card hand, including after splits (`:37`, `if(!free)h.risk++` `:57`); two-card 21 after a split pays even money (`Engine.payout(h,game.dealer,!h.split&&h.cards.length===2)`, `index.html:60`; parameter `natural` in `strategy.js:23`); ten-value pairs cannot be split at all, paid or free (`Engine.rank(h.cards[0])!==10` in `legal()`, `index.html:37`), while PRD L149 and L130 only exclude tens from the *free* split; no insurance or even money | PRD silent | PRD: amend §6.1 (M6) |
| **G4** | §6.1 L130 "pending confirmation", L136 "source not yet selected… blocks F2", F2 L174, §9.1 L328-330 unchecked, §11 L380 "Unresolved", §13 Q1 L402 "Blocks implementation" | The source has been chosen and built in: Wizard of Odds, checked 28 September 2026 (STRATEGY.md:5, `Games.freebet.source` `strategy.js:53`, link `index.html:21`). The rule set is recorded (STRATEGY.md:7, `Rules` `strategy.js:26-28`). A 200-case regression exists (`tests.cjs:7-11`) | PRD out of date | PRD: record the decision; tick L328 and L330; amend §6.1 for L329; close §11 L380 and §13 Q1 |
| **G5** | §12 L390 mitigation "cross-check against a second" source | Not done. STRATEGY.md:11 says the fixtures are "manually transcribed from the same source, not an independent strategy audit" and the second-source check is "outstanding". `Games.freebet.source.note` (`strategy.js:53`) says the same. Also, `tests.cjs:6` labels the rows "Independent fixture rows", which contradicts STRATEGY.md:11 | Mitigation missing; a test comment contradicts the docs | Work item: second-source cross-check. Reword the test comment later |
| **G6** | §7.2 L308 "Chips are displayed so free doubles are legible"; S2 AC1 "no chips are deducted" | The behavior is met: a free double adds `units` without `risk` (`index.html:36`, `:57`; `strategy.js:23`). But after the double, the chip reads "+ ◉ DOUBLE" for both free and paid doubles (`index.html:45`). Only the final "Loss -1" vs "Loss -2" text shows the difference (`:60`). Before the double, the button says "Free double" (`:47`) | Display differs | Code (later): label free doubles on the chip |
| **G7** | S1 AC2 (backlog L17): no hand-plus-upcard combination more than twice in 20 hands | Not built. `deal()` draws straight from a Math.random Fisher–Yates shoe (`index.html:51`, `strategy.js:21`) and never compares against earlier hands. Not tested. Not in the PRD | Missing (backlog only) | Decide: add to F1 and build, or drop the AC |
| **G8** | F4 L205, §9.3 L352, S11 AC2 (backlog L144): no auto-display on return visits | Usually met. But in the startup `try` (`index.html:33`), `seen` is read **after** the history check. A corrupt or invalid `freebet.history.v1` throws first, so `seen` stays `false` (`:31`) even though `freebet.primer.v1` is `'yes'`, and the primer opens again on the next `deal()` (`:50`) for a returning player. If storage is unavailable, the primer shows on every visit. Not tested | Code differs in an edge case | Code (later): read the primer flag separately |
| **G9** | F2 L168, §9.3 L348, S3 AC3 (backlog L44): assisted hands are flagged **and excluded from unassisted accuracy**; §5.2 L112 | Flag: built (`assisted:false` `:51`, set by `#hint` `:65`, stored per decision `:54`, shown `:48`, `:62`). Exclusion: nothing to exclude from, because no accuracy figure exists anywhere ("accura" does not appear in the code). `completed` counts all hands (`:60`). The figure belongs to F5/S7 (V1.1) | Half missing; PRD dependency on a later release | PRD (M7) |
| **G10** | F2 L168, F3 L183: "assisted flag", level not stated | The flag lives on the round (`game.assisted`, `:51`, `:65`) **and** is copied to each decision at decision time (`:54`). A hint after the first decision, or on split hand 2, marks the whole round "Assisted" while earlier decisions keep `assisted:false` (`:62`) | PRD silent | PRD: say whether the flag is per decision or per round |
| **G11** | F3 L189, §9.3 L351: "surface storage failure rather than presenting an empty history" | The failure is surfaced: `#storageNotice` (`role="alert"`, `:13`) is shown by `storageError()` (`:32`) on read, save and primer-write failures. But after a failed **read**, `logs=[]` (`:33`) and `showLog()` prints "No completed hands yet. Your first hand will appear here." (`:62`) next to the alert. The next `save()` (`:34`) overwrites the damaged stored history without warning. The notice says "History remains in memory for this visit", which is misleading when nothing was loaded. Not tested | Partly meets; differs on the read path | Code (later): different empty-state text after a failed load; do not overwrite unreadable data |
| **G12** | F3 L183 lists **eight** fields; §9.3 L349 says "all **nine** fields listed in F3" | The code stores all eight: seven per decision (`:54`) and dealer final total per round (`:61`). It also stores `hand`, `free`, `results` and the full game | PRD contradicts itself | PRD: change "nine" to "eight" or name the ninth field |
| **G13** | §5.2 L109 "completes 20 hands without abandoning" (measured by "Session log"), §5.1 L103, §8 L316 "reviews the session", §9.5 L363, S4 AC1 "Given a session ends" | "Session" is not defined in the PRD and has no counterpart in the code. `logs` is one growing array across visits (`:33`, `:61`) with no session id. `completed` is memory-only and resets on load (`:31`, `:60`). Play does not stop at 20 ("HAND 21 / 20"). Abandoned rounds are not logged. The §5.2 L109 metric cannot be measured from the log | PRD undefined; metric not measurable | PRD (M3) |
| **G14** | (no PRD item): storage size, retention, clear, export | `logs` grows without limit (`:61`). There is no `removeItem`, `clear()`, clear button or export. A quota error goes to `storageError()` (`:34`) | PRD silent | PRD (M2) |
| **G15** | F2 L165 "exact player total, hand composition and dealer upcard"; §13 Q4 L405 still open | `Strategy.best` grades on total, soft/hard, `hand.free` and upcard (`strategy.js:9-14`). The only composition checks are split aces (`:10`), two-card pairs (`:11`) and two cards vs more for doubles (`:12`, `:15`). No multi-card exceptions. STRATEGY.md:9 says composition exceptions "are not claimed". Pairs are hard-coded (`:11`: split every pair except 10s and 5s against every upcard), not stored as data, although STRATEGY.md:5 says the pair charts are "transcribed as decision data" | Code differs from F2 wording; STRATEGY.md differs from code | PRD: answer §13 Q4 as "total plus upcard" and reword L165. Fix the STRATEGY.md:5 wording |
| **G16** | §6.3 Screen 1 L281 "Variant selection, rule primer, begin session"; S5 AC1 (backlog L67) "When I choose Free Bet" | There is no variant picker and no separate Start screen. Start is the intro plus `#continue` "Start practicing →" in `section#practice` (`:14-19`). The primer is a dialog (`:26`). Screen 4 (Log) is its own view (`:23`). The PRD allows only screens 3 and 4 to share a page (L287), not 1 and 2. A one-variant V1 matches §6.1 L126 and F8 | PRD row disagrees with its own one-variant decision | PRD: update §6.3 row 1 and S5 AC1 wording |
| **G17** | F4 L200, L202, L205, L206; §9.3 L352 | The behavior is in the code (see 9.1), but nothing tests it: the test stub pre-seeds `freebet.primer.v1='yes'` (`tests.cjs:26`), and `showModal` is a stub | Untested | Test (later) |
| **G18** | S11 is a **COULD** (backlog L112, L138) but leads the MVP slice (L174); PRD F4 is **V1** (PRD.md:195, L316) | The backlog never explains why a COULD is in the slice, and no file links S11 to F4. The two documents disagree on priority | Doc mismatch (no code) | Backlog: re-tier S11 to MUST, or note why |
| **G19** | §9.4 L356 "Usable on a phone browser in portrait" | Supported in code: viewport meta (`index.html:4`), media queries at 820px and 480px (`:7`), and the feedback panel scrolls into view when `innerWidth<=820` (`:55`). Never checked: tests use `innerWidth:1200` and no CSS | Untested | Manual phone check before ticking L356 |
| **G20** | §6.1 L134 and PRD.md:23: game logic separated from the platform so variants "become configuration" | Strategy data is shared (`strategy.js`, also loaded by `extension/sidepanel.html:75`). But part of the game logic sits in the page script: reshuffle (`index.html:51`), dealer H17 (`:59`), legal moves (`:37`), action handling (`:57`). The trainer calls `Strategy.best` directly (`:54`, `:65`) and never uses `Games` or `Rules`. A new variant would mean editing `index.html`, not adding configuration | Code differs from the architecture goal | Code (V2, with F8): move rules into `Engine` or `Games` |
| **G21** | (no F#/S#; the 20-hand target is only a metric/gate, §5.2 L109, §8 L316): hand counter | `HAND NN / 20` and "N of 20 practice hands completed" (`:42`, `:48`) come from `completed`, which resets to 0 on every load (`:31`) and is never rebuilt from `logs`. Play continues past 20 | Extra in code | PRD (M4), or remove later |
| **G22** | F3 L185 "Persists across page refresh" (silent on rounds in progress) | Only completed rounds are saved (`save()` is called only in `finish()`, `:61`). A refresh mid-round loses that round and its graded decisions (STRATEGY.md:13) | PRD silent | PRD (M5) |
| **G26** | S1 AC3 (backlog L18): "Given a hand resolves, When the next deals, Then it requires no input beyond one action" | Between hands: one click, "Deal next hand →" (`index.html:61`), which runs `deal()` through the `#continue` handler (`:64`). Within a hand, each action needs a second click, "Continue →" (`:55`, `:64`), before `execute()` draws the card. This is deliberate, to meet F2 L167 "before the next card is dealt" | Backlog AC conflicts with F2 L167 (if read as covering every action) | Backlog: reword S1 AC3 to "one click to deal the next hand", or note that the Continue step is required by F2 |
| **G27** | S4 AC1 (backlog L55): every logged hand shows "the dealer upcard" | `showLog()` shows the upcard only inside each decision line (`vs ${d.dealerUpcard.r}${d.dealerUpcard.s}`, `index.html:62`); the summary line shows player cards and `Dealer ${item.dealerFinalTotal}`. A round ended by a two-card 21 at deal (`:52`) has `decisions:[]` (`:51`), so its entry shows no upcard, only "Natural hand; no decisions to grade.", although the upcard is stored as `item.dealer[0]` (`:61`) | Display differs (edge case) | Code (later): show `item.dealer[0]` in the summary line |

### 9.3 Gaps outside the map (F9 extension, V1.1)

These are listed so that no change is silent, but they are not part of the MVP slice.

| # | Requirement | What the code does | Fix in |
|---|---|---|---|
| **G23** | None. PRD.md:23 and L126 say one variant; F8 names Spanish 21 as the next one | The extension ships a second game, regular blackjack: `Classic`, `ClassicRules` and `Games.classic` (`strategy.js:34-56`), used by the side panel (`extension/advisor.js`, `sidepanel.js`). The trainer never uses it | PRD: add an F9 item for regular blackjack in the panel, or mark it beyond scope |
| **G24** | F9 L265: extension hands reviewable "in the session log (F3)" | The panel saves rounds under its own `round:<id>` keys in `chrome.storage.local` (or `localStorage` with prefix `freebet.panel.` when opened as a page) and shows them in its own History tab (`extension/sidepanel.js:5`, `:10-14`, `:124`). They never appear in the trainer's `freebet.history.v1` log, and they cannot, since the stores are separate | PRD: change L265 to "the panel's own history" |
| **G25** | §12 L396: "Links to problem-gambling help in the panel" | Absent. The panel's only external links are the trainer link (`extension/sidepanel.html:54`) and the strategy-source link `sourceLink` (`extension/sidepanel.js:175`) | Code (V1.1): add the link before store submission |

---

## 10. Links

- Architecture map: [docs/design/architecture-map.md](design/architecture-map.md)
- Stack decision record: [docs/decisions/001-stack.md](decisions/001-stack.md)
- Requirements: [PRD.md](../PRD.md), [docs/lab3-backlog.md](lab3-backlog.md)
- Code: [free-bet/index.html](../free-bet/index.html), [free-bet/extension/strategy.js](../free-bet/extension/strategy.js), [free-bet/STRATEGY.md](../free-bet/STRATEGY.md), [free-bet/tests.cjs](../free-bet/tests.cjs)
