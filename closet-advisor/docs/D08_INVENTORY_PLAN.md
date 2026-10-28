# D08 plan: Personal Closet Inventory in Rotation

IST 300 D08 ("What's Hardest About CRUD?"), Tomoyoshi Takita. Written in Plan Mode in Claude Code and
approved on 2026-10-27, before any code changed. Results are in [D08_INVENTORY_REPORT.md](D08_INVENTORY_REPORT.md).
File paths are relative to `closet-advisor/`.

## Context

D08 asks for one complete CRUD feature, Personal Closet Inventory, demonstrated against 8 acceptance checks, with real test evidence and documentation. In my capstone (Rotation, `closet-advisor/`), this feature **already exists**. Items live in IndexedDB (`ownedItems`). The earlier D08 report already says "Option A (closet inventory) was already complete".

Inspecting the code against the 8 checks found:

| # | Check | Current code | Gap |
|---|---|---|---|
| 1 | A valid item appears | Works: Add item → "Enter it yourself" (`js/screens/add.js:459`) → `createOwned` (`js/server/ops/inventory.js:299`) | Text typed before picking a category pill appears to be lost (`add.js:477`): the pills are plain links |
| 2 | Reload keeps items | Works: IndexedDB with a memory fallback (`js/server/db.js`) | No test covers it |
| 3 | Details are displayed | Partly: name, brand and color show on the tile and the item page | **Category is never shown as text**, only as an icon or filter pill |
| 4 | Edit updates the same record | Works: `updateOwned` overwrites by id (`inventory.js:379`) | After Save, Back has to be pressed twice (`collection.js:314` replace leaves a duplicate entry) |
| 5 | Delete removes only that item | Works: `deleteOwned` (`inventory.js:451`) | No test checks that the other items survive |
| 6 | Empty closet message | Works: "Your collection is empty" (`collection.js:104`) | Only reachable with a new account, since no demo account starts empty |
| 7 | Blank names rejected | Works for empty and spaces-only (`records.js:226`, `:342`) | A zero-width-space name appears to be accepted. Outfits already guard this with `INVISIBLE` (`records.js:437`) |
| 8 | Cancel leaves data unchanged | Works: nothing is written before Save; the delete dialog's Cancel returns early (`collection.js:259`) | The edit Cancel is a plain link (`collection.js:292`), so Back reopens the form |

"Appears" means I found it by reading the code. Real tests will decide, and they'll run **before** any fix so the failures are recorded as evidence.

**Approach:** verify and finish the existing inventory instead of building a second one. The work is a browser test suite that maps 1:1 to the 8 checks, 8 break tests, a few small fixes for what they expose, and the D08 documents.

## Field mapping (the assignment's four fields → the existing form)

| Field | Form control | Stored as |
|---|---|---|
| Name | "Name", `#f-custom-name` (required) | `custom.name` |
| Category | "What is it?" pills: Sneaker / Watch / Clothing item | `category`: `sneaker` / `watch` / `clothing` |
| Brand | "Brand", `#f-custom-brand` (required in the existing app) | `custom.brand` |
| Color | "Color or version", `#f-custom-variantName`, free text | `custom.variantName` (the optional "Main colors" chips stay as they are) |

## Storage decision: keep IndexedDB (no localStorage)

- Items already persist in IndexedDB. Outfits reference item ids, and photos are Blobs in the same database. A second localStorage copy would mean two sources of truth.
- localStorage holds only strings, is synchronous and is capped at about 5 MB. It is already used for exactly two small things: the session token and the theme.
- No new store or index is needed, so there is **no `DB_VERSION` bump**, and existing data is untouched.
- This will be written up as a decision record (Context / Decision / Why not the alternative / What it costs / What would change my mind), the same format as `docs/decisions/001-stack.md`.

## Code changes (small, each tied to a check)

1. **Check 3: show category as text.** In `js/screens/collection.js` (item detail, "Your details" facts), add a first row `['Category', CATEGORY_LABEL[item.category]]`. `CATEGORY_LABEL` is already imported. The tile (`itemTile`, which is shared with the wishlist and outfits) stays unchanged.
2. **Check 7: names with nothing visible are rejected.** In `js/server/records.js`, `checkIdentityFields` and `patchOwnedItem` will treat brand or name as blank when `cleanText(value).replace(INVISIBLE, '')` is empty. This reuses the existing `INVISIBLE` regex. The messages ("Enter a name", "Enter the brand") don't change.
3. **Checks 4 and 8: edit navigation.** In `js/screens/collection.js`, the edit form's Cancel gets `data-back`. Save returns to the item page with `ctx.back(...)` when the edit was opened from that page, copying the existing `editOpenedFrom` pattern in `js/screens/outfits.js:23,303-307,353-371`. Both edit links on the item page get `data-edit-item`.
4. **Check 1: only if break test C2 confirms text is lost.** In `js/screens/add.js`, a click on a category pill will carry the typed brand, name and color into the new URL. This mirrors the existing type-change handler at `add.js:495-503`.

Not changing: the item tile, the delete flow's history entry (documented as a known limitation), the purchase-date and target-price error-key mismatches (outside these checks), and the service worker (its revalidation already serves new files on the next load).

## Check → observable test map

The new suite is `tests/e2e/inventory.mjs` (Playwright, Chromium, phone size, network fenced), registered in `tests/e2e/run.mjs`. Each run signs up a **new account** through the API, so the closet starts empty and the demo data stays untouched. Helpers are copied from `tests/e2e/outfits.mjs` (`check`, `openContext`, `reload`, `fieldError`, `toast`).

| ID | Check | What the test does | Pass means |
|---|---|---|---|
| AC6 | Empty state | Opens `#/collection` on the new account | `section.state h2` reads "Your collection is empty" |
| AC1 | Create | Fills Brand "Uniqlo", Name "Oxford shirt", Color "Light blue", picks Clothing item, then presses Add to collection | Toast "Added to your collection"; the item is on `#/collection`; `listOwned` total is 1 |
| AC2 | Reload | Adds a second item (a watch), reloads the page, opens `#/collection` | Both tiles are still listed |
| AC3 | Details | Opens each item's page | Name, brand, color and the **Category** row (Clothing / Watches) are visible |
| AC4 | Edit | Changes the name and color, saves, then reloads | The new values show; the item has the same id; total is still 2 |
| AC5 | Delete | Deletes one item and confirms | That id now returns not_found; the other item is untouched; total is 1 |
| AC7 | Blank name | Submits create, and then edit, with an empty and a spaces-only name | Field error "Enter a name"; nothing is saved (total unchanged, the record unchanged after reload) |
| AC8 | Cancel | Edits fields, then presses Cancel; opens Delete, then presses Cancel | The record is the same as before after reload; the item is still listed |

A desktop-size pass repeats AC1 and AC3 and checks that nothing scrolls sideways. `tests/unit/inventory.test.mjs` gains unit cases for blank, spaces-only and invisible-only names on create and update, update keeping the id and the count, and deleting one of two identical copies.

## Break tests (2 per action; outcomes recorded only after running)

| Verb | ID | Unexpected user action |
|---|---|---|
| Create | C1 | Pastes a name that is only a zero-width space |
| Create | C2 | Types brand, name and color first, then changes the category pill |
| Read | R1 | Opens a link to an item that doesn't exist or was deleted (`#/collection/own_missing`) |
| Read | R2 | Uses a 120-character name with no spaces plus `<b>HTML</b>`, on a phone |
| Update | U1 | Clears the name and presses Save, then reloads |
| Update | U2 | Edits the same item in two tabs; the stale tab saves last |
| Delete | D1 | Deletes an item, then presses the browser Back button |
| Delete | D2 | Adds two identical items ("Add another copy") and deletes one |

Each test runs against the **current code first**. Its real result goes into the report table (`| Verb | What I tried | What happened | Did I have to correct the agent? |`) before any fix, and then again after the fix.

## Documents (written after testing, from saved logs)

- `closet-advisor/docs/D08_INVENTORY_PLAN.md`: this approved plan, committed as written before coding.
- `closet-advisor/docs/D08_INVENTORY_REPORT.md`:
  - check results;
  - the break-test table;
  - manual test steps for all four actions;
  - moments when authentication would have helped (for D10, observed only);
  - Discovery Log evidence: real errors, my corrections to the agent, the commands run and their pass/fail output.
- `closet-advisor/docs/feature-cards/closet-inventory.md`: the feature card, covering:
  - the user story;
  - the four actions;
  - checks with their status and test IDs;
  - storage;
  - out of scope;
  - limitations;
  - evidence links.
- `closet-advisor/docs/decisions/001-inventory-storage.md`: the storage decision record.
- A one-line addition for `inventory.mjs` in the tests table in `closet-advisor/README.md` and in `ARCHITECTURE.md` §8.
- The existing Outfits D08 docs stay as they are.

## Git commits (prepared, not run until you say so)

1. `Show item category and reject invisible-only item names` (code fixes)
2. `Add browser checks for closet inventory CRUD` (tests and runner)
3. `Document D08 closet inventory: plan, report, feature card, storage decision`

I'll give you the exact commands and messages to dictate or edit. Nothing will be pushed: a push to `main` publishes the live site.

## Verification

1. Run the new tests on the unchanged code: `node tests/e2e/inventory.mjs` and `npm test`. Save the output to a log, which is the "before" evidence.
2. Apply the fixes, then run `node tests/e2e/inventory.mjs` again ("after" evidence).
3. Run the full checks: `npm test` (currently 290 pass), `npm run test:e2e` (all suites, including the new one), and `git diff --check`.
4. Take screenshots of the item page (Category row) and of the blank-name error at phone and desktop sizes.
5. Do a manual check in the running app (http://127.0.0.1:8130/) following the steps that go in the report.
6. Limitations to state: Chromium only, demo or new local accounts, no screen reader, live site not checked.

## Out of scope

Authentication changes, AI recommendations, image uploads, new storage, and changes to outfits or the wishlist.
