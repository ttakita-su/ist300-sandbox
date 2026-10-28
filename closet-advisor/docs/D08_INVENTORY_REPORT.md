# D08 report: Personal Closet Inventory in Rotation

IST 300 D08 ("What's Hardest About CRUD?"), Tomoyoshi Takita, 2026-10-27. The plan, written in
Plan Mode and approved before any code changed, is in [D08_INVENTORY_PLAN.md](D08_INVENTORY_PLAN.md).
The feature card is [feature-cards/closet-inventory.md](feature-cards/closet-inventory.md) and the
storage decision is [decisions/001-inventory-storage.md](decisions/001-inventory-storage.md).
Paths are relative to `closet-advisor/`.

**How this was done.** I directed Claude Code (the AI agent) through the D08 workflow in one session:

1. inspect the code;
2. plan in Plan Mode;
3. wait for my approval;
4. write the tests;
5. run them on the **unchanged** code;
6. fix what failed;
7. run everything again.

Every result below comes from those runs. The output was saved to log files and screenshots while
working, and the key lines are quoted here. Nothing in this report describes a test that wasn't run.

## 1. Feature and starting point

The feature is **Personal Closet Inventory**: add, see, edit and delete the clothing, sneakers and
watches you own.

Rotation already had this feature. My earlier D08 write-up ([D08_CRUD_REPORT.md](D08_CRUD_REPORT.md),
Outfits) says the closet inventory "was already complete". So this time the job wasn't to build
a second inventory. It was to prove the existing one against the eight acceptance checks, and to
fix whatever the checks and break tests found. They found seven failing checks and two hidden
problems. All are fixed except the first Back press after a delete, which is listed under
limitations.

| Assignment field | Where it is in the app | Stored as |
| --- | --- | --- |
| Name | "Name" (required) | `custom.name` |
| Category | "What is it?": Sneaker / Watch / Clothing item | `category`: `sneaker` / `watch` / `clothing` |
| Brand | "Brand" (required) | `custom.brand` |
| Color | "Color or version" (optional free text) | `custom.variantName` |

## 2. The four CRUD actions

- **Create:** I can add an item I own by typing its name, brand and color and choosing clothing,
  sneakers or a watch, and it appears in my collection.
- **Read:** I can see every item I own in my collection, and open one to see its name, category,
  brand and color.
- **Update:** I can change an item's name, brand or color and save it. The same item changes, no
  copy is made, and Cancel leaves it as it was.
- **Delete:** I can remove one item after confirming. Nothing else is removed, and cancelling
  keeps it.

## 3. Storage decision

The inventory stays in the existing **IndexedDB** store (`ownedItems`), not localStorage:

- **No second copy.** Outfits, export, account deletion and photos already use that database, so a
  localStorage copy would be a second source of truth.
- **Room for photos.** localStorage only stores strings and is capped at about 5 MB.
- **No migration.** No new store was needed, so `DB_VERSION` stays at 2 and existing data is untouched.

Full reasoning is in [decisions/001-inventory-storage.md](decisions/001-inventory-storage.md).

## 4. Acceptance check results

Browser suite: `tests/e2e/inventory.mjs`. It uses Chromium at 390 px phone size in the light theme,
plus a desktop dark-theme pass, and blocks all network requests that would leave the machine.

| # | Check | Test | Before fixes | After fixes |
| --- | --- | --- | --- | --- |
| 1 | Creating a valid item makes it appear | AC1, AC1d | Pass. Tile: "Uniqlo Oxford shirt Light blue Custom item" | Pass |
| 2 | Reloading keeps saved items | AC2 | Pass (IndexedDB, not the memory fallback) | Pass |
| 3 | Each item displays its saved details | AC3, AC3d | **Fail.** The details list was only `{"Added":"Oct 27, 2026"}`; category never appeared as text | Pass. `{"Category":"Clothing", …}`, `{"Category":"Watches", …}` |
| 4 | Editing updates the correct record, no duplicate | AC4, N1 | AC4 pass. **N1 fail:** after Save, Back stayed on the item page | Pass. One Back goes to Collection |
| 5 | Deleting removes only that item | AC5 | Pass | Pass |
| 6 | Empty closet shows an empty-state message | AC6 | Pass. "Your collection is empty" | Pass |
| 7 | Blank required names are rejected | AC7, C1 | AC7 pass (empty and spaces only). **C1 fail:** a zero-width-space name was saved | Pass |
| 8 | Cancel leaves the data unchanged | AC8, N2 | AC8 pass. **N2 fail:** after Cancel, Back reopened the edit form | Pass. One Back goes to Collection |

**Totals:**

- **Before fixes:** 13 of 20 browser checks passed and 7 failed (AC3, N1, N2, C1, C2, R1, AC3d).
  There were also 2 console errors.
- **After fixes:** 20 of 20 passed, with no console errors, page errors, failed requests or outside
  requests.

### What I changed

| Problem | Found by | Change |
| --- | --- | --- |
| Category not shown | AC3, AC3d | A **Category** row at the top of "Your details" (`js/screens/collection.js`) |
| An invisible name (U+200B) counted as a name | C1 and a unit test | Brand and name must contain a visible character (`isBlank` in `js/server/records.js`, reusing the outfit name rule) |
| Back after Save or Cancel went to the wrong place | N1, N2 | Cancel uses `data-back`. Save goes back in history when the edit was opened from the item page (`js/screens/collection.js`, the same pattern Outfits uses) |
| Typed text wiped by a category change | C2 | The pills carry the typed brand, name and color into the new form (`js/screens/add.js`) |
| A missing or deleted item showed an error with only "Try again" and logged a console error | R1, D1 | "This item isn't here" with **Back to collection** on the item page and its edit screen (`js/screens/collection.js`) |
| An old tab undid another tab's rename | U2 | Save sends only the brand, name or color fields that changed (`js/screens/collection.js`) |

## 5. Break tests (two per action)

| Verb | What I tried | What happened | Did I have to correct the agent? |
| --- | --- | --- | --- |
| Create | **C1.** Brand "Uniqlo", a name that is only a pasted zero-width space (U+200B), color "Navy", then Add to collection | **Before:** saved. Items went 1 → 2, and the new item's page title was an invisible character. **After:** "Enter a name" under the Name field, nothing saved (1 → 1) | No |
| Create | **C2.** On the Sneaker form, typed Brand "Seiko", Name "Presage", Color "Blue dial", then tapped **Watch** | **Before:** all three fields came back empty. **After:** the Watch form keeps all three, and saving creates a watch with them. The Main colors chips and optional details still reset | No |
| Read | **R1.** Opened `#/collection/own_missing`, then the address of an item deleted a moment earlier | **Before:** red "Not found. This item doesn't exist or isn't shared with you." with only **Try again**, plus a console error ("ApiError: That item isn't in your collection…"). **After:** both addresses show "This item isn't here. It may have been deleted, or it was saved in another browser." with **Back to collection** and no console error | No |
| Read | **R2.** Brand `Tag<i>s</i>` and a 120-character name `<b>HTML</b>xxx…` with no spaces, on a phone | Passed before any fix. All 120 characters were saved. The tags show as plain text (nothing turned bold or italic), and nothing sticks out of the screen on the tile or the item page. The tile cuts the long name with "…" | No |
| Update | **U1.** Cleared the name, changed the color to "Changed color", pressed Save, then reloaded | Passed before any fix. "Enter a name" appeared, with focus on the Name field. After reload the form showed "Oxford shirt" and "Light blue", so the color change wasn't half-saved either | No |
| Update | **U2.** Opened the same item's edit screen in two tabs. Tab B renamed it to "Name from tab B" and saved. Then tab A, still showing the old form, changed the color to "Color from tab A" and saved | **Before:** both tabs said "Saved" and there was still one record. But the final name was "Oxford shirt": tab A's old form silently undid tab B's rename. **After:** name "Name from tab B", color "Color from tab A". If both tabs change the *same* field, the last save still wins | No. The agent did tighten its own test. The first version only checked "one record, last save kept", which passed and hid the lost rename. The agent noticed it in the test's note line |
| Delete | **D1.** Opened an item from the list, deleted it, then pressed the browser Back button twice | **Before:** press 1 stayed on Collection, as if nothing happened. Press 2 opened the deleted item's address, which showed the red error and logged a console error. **After:** press 2 shows "Item not found / This item isn't here" with a way back. Press 1 still does nothing visible (not fixed, see limitations). The item stays deleted throughout | No |
| Delete | **D2.** Added "Nike Air Force 1, White" twice (the app warned "You already have this", and I chose **Add another copy**), then deleted the second copy | Passed before any fix. The deleted copy is gone (not_found), the first copy is unchanged (same `updatedAt`), the count went down by one, and Collection shows one Air Force 1 | No |

## 6. Hardest CRUD operation

Update was the hardest, and it wasn't close.

Create and Read problems were about the input or the display. A name that's secretly blank and a
category that wasn't printed anywhere are both easy to fix once a test points at them.

Update is different, because it isn't one step. The app has to:

1. load the item;
2. let me change it, or back out with Cancel;
3. write it back onto the same record without making a copy;
4. put me back where I came from.

The data part (no duplicates, nothing half-saved) worked from the start. Everything around it
broke:

- **Save:** after saving, Back took two presses.
- **Cancel:** Back reopened the form I had just cancelled.
- **Two tabs:** this was the scariest one. Both saves said "Saved", yet one tab quietly erased the
  other tab's rename.

That last test only failed because I recorded what actually happened instead of just checking "is
there still one record". The fix was to send only the fields I changed. Even now, two tabs editing
the *same* field means the last one wins. Fixing that properly needs version numbers on a server,
which is a D10 problem.

Delete was the easiest on the data side. "Removes only that item" passed even with two identical
copies. Its only issue was again about navigation after the action.

## 7. How to test it yourself

1. Start the app with `cd closet-advisor && npm start`, then open the address it prints (for example
   http://127.0.0.1:8130/).
2. **Empty state:** if you're signed in, go to Profile → **Sign out**. On the welcome screen choose
   **Create account**, enter any name, an email and a password of 8 or more characters, then press
   **Skip for now**. Open **Collection**. Expect "Your collection is empty".
3. **Create:** tap **+** (Add item) → **Enter it yourself** → **Clothing item**. Type Brand
   "Uniqlo", Name "Oxford shirt" and Color or version "Light blue", then press **Add to collection**.
   Expect the toast "Added to your collection" and the item's page.
   - **Blank name:** try it with the Name left empty, or only spaces. Expect "Enter a name" and
     nothing saved.
4. **Read:** open **Collection**. The tile shows Uniqlo, Oxford shirt and Light blue. Reload the
   page and it's still there. Open it: the label shows the brand, name and color, and **Your
   details** starts with **Category: Clothing**.
5. **Update:** on the item page press **Edit details**. Change the name to "Oxford shirt slim" and
   the color to "White", then press **Save changes**. Expect "Saved" and the new values, and
   Collection still has one tile for it.
   - **Cancel:** edit again, change something, press **Cancel**. Nothing changed. One press of Back
     goes to Collection.
6. **Delete:** add a second item first. Then on the first item's page press **Delete**.
   - **Cancel:** press **Cancel**. The item is still there.
   - **Confirm:** press **Delete** again, then **Delete** in the dialog. Expect "Deleted". The item
     is gone from Collection, and the other item is still listed after a reload.

## 8. Moments when authentication would have helped (for D10)

These all came up during this work:

1. **Getting an empty closet needed a brand-new account.** Every demo account starts with items,
   and demo sign-in has no password: you pick a name.
   - My browser tests sign up by calling `api.signUp` from the page's own script.
   - Since the "server" runs inside the browser tab, any script on the page could do the same.
2. **"…or it was saved in another browser."** The not-found message has to say this because items
   only exist in one browser.
   - With real accounts and a server, the same closet would be on my phone and my laptop.
   - The message would then only ever mean "deleted" or "not yours".
3. **Two tabs (U2) are the same person in the same browser.** Both tabs share one session token in
   localStorage, so the second tab opened already signed in.
   - With accounts on several devices, editing the same item from two places becomes normal.
   - The server will need to detect a stale save, for example with a version number, instead of
     letting the last save win.
4. **Someone else's item looks the same as a deleted one.** An id that isn't mine shows the same
   "This item isn't here" as a deleted item.
   - That's the right behavior, but the ownership check runs in the browser tab (`js/server/policy.js`).
   - Real authentication has to enforce it on a server.
5. **One browser holds one signed-in person at a time.** Signing up replaces the session for every
   tab in that browser. The Outfits test had to sign Alex back in after one. So each group of
   inventory tests uses its own browser context with its own new account.

## 9. Evidence for my Discovery Log

### Real errors seen (verbatim)

- **Unit test on the unchanged code:**
  `Error: Expected ApiError invalid, but the call succeeded`, from
  `a manual item needs a visible name and brand`.
- **Direct probe of `createOwned` on the unchanged code:**
  - `""` → `invalid Enter a name`
  - `"   "` → `invalid Enter a name`
  - `"​"` → `SAVED`
  - `" ​‍﻿ "` → `SAVED, stored name "​‍"`
- **Browser console on the unchanged code, at `#/collection/own_missing` and at the deleted item's
  address after Back:**
  `ApiError: That item isn't in your collection. It may have been deleted. at itemNotFound (…/js/server/ops/inventory.js:27:35)`
- **Failure messages:**
  - AC3: `a Category row names the category, + undefined - 'Clothing'`
  - N1: `+ '#/collection/own_5o17jjww6uvjdd1o' - '#/collection'`
  - N2: `+ '#/collection/own_ruata7lgz3m0if0o/edit' - '#/collection'`
  - C1: `field error: null … items 1 -> 2`
  - C2: `{"brand":"","name":"","color":""}`
  - R1: `there is a way back to the collection`
- **Run summary before fixes:**
  `Inventory checks failed: AC3, N1, N2, C1, C2, R1, AC3d; 2 problem(s).`

### Agent corrections

I approved the plan as written and didn't correct the agent during the build. These are the
agent's own mistakes, which it caught by running things:

1. **A broken unit test.** Its first unit test for "delete one of two copies" didn't pass
   `allowDuplicate: true`, so the app correctly refused the second copy:
   `Error [ApiError]: You already have this in your collection.`
   That was a test mistake, not an app bug, and the test was fixed.
2. **A miscount.** A progress message said the "before" run was "14 of 21". After counting the log
   it was corrected to 13 of 20.
3. **A two-tab check that was too weak.** The first U2 check only asserted that the last save was
   kept, so it passed. The note line showed tab B's rename had been lost, so the check was made
   stricter and the app was fixed.

### Commands and results

| Command | Result |
| --- | --- |
| `node --test --test-name-pattern=… tests/unit/inventory.test.mjs` (before fixes) | 0 of 2 passed: the invisible name was accepted, plus the test mistake above |
| `node tests/e2e/inventory.mjs` (before fixes) | 13 passed, 7 failed, 2 console errors, exit 1 |
| `node tests/e2e/inventory.mjs` (after fixes) | 20 of 20 passed, exit 0 |
| `npm test` | 292 of 292 passed (the 290 existing plus 2 new) |
| `npm run test:e2e` | 5 of 5 suites passed: smoke, photo, web, inventory (20), outfits (37) |
| `git diff --check` | clean |

Screenshots from the runs (empty state, item details, blank-name error, long name, missing item,
desktop details) were saved locally. To make them again, run
`node tests/e2e/inventory.mjs <folder>`, which saves `inventory-*.png` there.

## 10. Limitations

- **Back after a delete.** The first press of Back looks like it does nothing (a duplicate history
  entry). The second press shows "This item isn't here". Not fixed.
- **Two tabs and the same field.** When two tabs change the same field, the last save wins with no
  warning. The optional details are sent whole, so an older tab replaces another tab's detail
  changes.
- **Long names.** Names over 120 characters are cut to 120 with no message.
- **Category can't be edited.** A wrong category means deleting the item and adding it again.
- **Testing coverage.** Only Chromium was tested, with new local accounts. There was no screen
  reader test, and the live GitHub Pages site wasn't checked (nothing is pushed).
- **No real authentication.** Accounts are demo accounts inside the browser tab (see section 8).

## 11. How to run

```sh
cd closet-advisor
npm start                       # the app, at the address it prints
npm test                        # unit tests, no install needed
npm ci && npx playwright install chromium   # once, for browser tests
node tests/e2e/inventory.mjs    # this D08 suite on its own
npm run test:e2e                # every browser suite
```
