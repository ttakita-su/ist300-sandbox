# D08 CRUD report: Outfit Collections in Rotation

IST 300 D08, Tomoyoshi Takita, 2026-10-26. The plan written before any code changed is in
[D08_CRUD_PLAN.md](D08_CRUD_PLAN.md).

**How this was done.** I directed Claude Code (the AI agent) through the assignment in one
session. I chose the feature (Option C). The agent inspected the repository, wrote the plan,
and had three separate reviewers check the plan before coding. It then wrote the code and the
tests and ran them, and four more reviewers checked the finished code. Every result below comes from those runs, which were saved as text logs
while working. Nothing here describes a test that wasn't run.

## 1. Feature selected

**Outfit Collections**: build an outfit by naming it and choosing items you own, view your
outfits, edit them, and delete them. It lives under the Collection tab, behind a new
**Items / Outfits** switch at `#/outfits`.

Why I chose it:

- **Option A (closet inventory) was already complete.** Rotation could already add items
  (including by hand), list them with filters, edit them, and delete them with a confirmation.
  Picking A would mean re-testing old work instead of implementing CRUD.
- **Option B (wishlist) was mostly done.** It had no priority field, and "remove" only marks
  an item as removed.
- **Option C didn't exist at all.** It is part of my capstone vision ("build outfits using
  my existing clothing") and builds directly on the closet items, so it adds a real feature to
  the app. The assignment said to prefer A when the options were equally suitable, but they
  weren't.

## 2. Four CRUD definitions

- **Create:** As a Rotation user, I can build an outfit by giving it a name and choosing two or
  more items from my closet, so I can save combinations I like to wear.
- **Read:** As a Rotation user, I can see all of my saved outfits with their names and pieces,
  and open one to see every item in it.
- **Update:** As a Rotation user, I can rename an outfit, change its notes, and add or remove
  pieces, and I see my changes right away.
- **Delete:** As a Rotation user, I can delete an outfit I no longer want after confirming,
  and the clothes in it stay in my closet.

The testable acceptance criteria for each are in the plan, sections 4 and the addendum.

## 3. Storage decision

**Where the data lives:** a new `outfits` store in the browser's IndexedDB database. This is
the same `rotation-prototype` database that already holds closet items, wishlist items and
photos. Each record is `{ id, userId, name, itemIds, notes, createdAt, updatedAt }`. The
database version went from 1 to 2, and the upgrade only adds the new store.

**Why:** it was already working, and outfits point at closet items that already live there.
Using the same database meant outfits could follow the app's existing rules:

- only the owner can read or change them;
- they are included in "Export my data" and removed when an account is deleted;
- deleting a closet item takes it out of every outfit.

localStorage would have split one person's data into two places and missed all of that.

**Limitations:**

- Data stays in one browser on one device. Nothing syncs, a different address or port has its
  own data, and clearing site data deletes it.
- If a browser blocks IndexedDB, the app falls back to memory and nothing survives a refresh.
  The Profile screen says so.
- The "server" that checks ownership runs in the same browser tab, so it is not a real security
  boundary (see section 6).
- Name uniqueness is checked before saving, with no database index. Two tabs saving the same
  new name at the exact same moment could both succeed.
- Two tabs editing the same field means the last save wins.

## 4. Test results

These are the "try to break it" tests: unexpected things a real user might do. Each row is a
check in `tests/e2e/outfits.mjs`, run in a real Chromium browser at phone size (390×844),
except where noted. The ID matches the `pass`/`FAIL` line the test prints.

The browser test was run seven times, and every run is described below as it happened:

| Run | Result | What led to the next run |
| --- | --- | --- |
| 1 | 30 of 34 passed: BR4, BR7, BU4 and BU7 failed, plus 2 console or page errors | The agent fixed each failure. |
| 2 | 34 of 34 passed | A screenshot showed an error hidden under the header, which the checks hadn't caught. A new check was added to BC1. |
| 3 | 33 of 34 passed: BC1 failed on the new check | Four code reviewers, each finding checked by a skeptic, found one name bug and four test gaps: two checks that couldn't fail and two missing tests. The agent fixed them, added BU9 and BU10, and made BD5 check the dialog. |
| 4 | 35 of 36 passed: BD5 failed | The failure was a mistake in the test's expected page, not in the app. |
| 5 | 36 of 36 passed | The last code reviewer found two problems in the edit form (focus and Save navigation). The agent fixed them and added BU11 and a focus check in BU8. |
| 6 | 37 of 37 passed | Putting the old code back showed BU11 still passed against it, so the agent rewrote BU11 until it failed on the old code. |
| 7 | 37 of 37 passed, with no console errors, page errors, failed requests or outside requests | |

| Verb | What I tried | What happened | Did I have to correct the agent? |
| --- | --- | --- | --- |
| Create | **BC1.** Pressed Save on the empty form. | Both fields showed errors: "Enter a name for this outfit" and "Choose at least two items". Focus moved to the name field, and the item error sat right under the list's hint, not inside the first item's card. Nothing was saved. **But a screenshot after run 2 showed the focused name field and its error hidden under the sticky "New outfit" header**: the label was at −25 px. The checks had only read the text. A visibility check was added, and **run 3 failed on it** (`belowHeader: false`). After the fix, both errors show on screen (runs 4 to 7 passed). | Yes. The agent's first version relied on focusing the field, which scrolls only far enough to reach it. The fix brings the first error to the middle of the screen. The item-error placement needed no correction, because the code inspection before coding had warned about it. |
| Create | **BC2.** Typed a name and pressed Enter before choosing any items. | The form submitted, the name error cleared, and only "Choose at least two items" stayed. Nothing was saved. Passed in every run. | No |
| Create | **BC3.** Made a second outfit named "  WEEKEND   errands " when "Weekend errands" already existed. | Refused with "You already have an outfit with this name". Capitals and extra spaces are ignored. Still one outfit. Passed in every run. | No |
| Create | **BC4.** Double-clicked Save. | Exactly one "Office" outfit was created, with no error. Passed in every run. | No |
| Create | **BC5.** Named an outfit `<img src=x onerror=alert(1)>`. | Saved and shown as plain text on the outfit page and in the list. No image element was created and no browser alert appeared. Passed in every run. | No |
| Create | **BC6.** Typed 61 W's with no spaces into the name. | The field stopped at 60 characters. From run 2 on, the outfit page, the list, the item page and the delete dialog all fit the phone screen. Sending 61 characters straight to the API was refused with "Use 60 characters or fewer". | Partly. This check passed in run 1, but the same long name broke the item page (see BR4). After that fix, the check was extended to the item page and the delete dialog. |
| Create | **BC7 (unit test).** Named an outfit with only invisible characters: a lone zero-width joiner, a soft hyphen, the Hangul filler U+3164, a blank braille cell, variation selectors. Also reused a name with a hidden soft hyphen inside it ("Week­end"). | **A code reviewer found that these were accepted**: they made names that look blank or look like an existing one. The first name cleaning only removed some invisible characters. After the fix all of them are refused, and emoji and Persian names that need joiners still save. To check the test itself, putting the old code back made 2 unit tests fail. | Yes. The agent's name check was too narrow. Now a name must contain at least one visible character, and duplicate checks ignore invisible ones. |
| Read | **BR1.** Opened Outfits before saving any. | "No outfits yet" with a **Build an outfit** button. The switch said "Outfits 0" and the Collection tab stayed highlighted. Passed in every run. | No |
| Read | **BR2.** Opened Outfits with a brand-new account that owns no items. | "Add a few items first", with no **New outfit** button and no form, only a link to add an item. Passed in every run. | No |
| Read | **BR3.** Refreshed the page after adding four outfits. | All four were still listed, newest change first, and the app reported IndexedDB storage, not the memory fallback. Passed in every run. | No |
| Read | **BR4.** From an item's page, used its Outfits list and **Build an outfit with this**. | **Run 1 failed.** The click on **Build an outfit with this** timed out because an image covered the button. The cause was the 60-character name from BC6 in the item page's Outfits list: an unbreakable name stretched the page to 1058 px on a 390 px phone. A one-off measurement confirmed it: 1058 px with the fix switched off, 390 px with it on. After the fix the item page listed the outfits, and the new form opened with that item already checked. Runs 2 to 7 passed. | Yes. The agent's first version didn't wrap long names in that list. It was fixed with `overflow-wrap: anywhere` on the list. The agent gave the delete dialog the same fix. Switching it off showed the dialog's text was 899 px wide in a 350 px box. |
| Read | **BR5.** Signed in as Sam and opened Alex's outfit address. | "Outfit not found", and nothing of Alex's outfit appeared. Sam's own Outfits screen showed "No outfits yet". Passed in every run. | No |
| Read | **BR6.** Signed out, then opened a bookmarked outfit address. | Sent to the sign-in screen; after choosing Alex, it landed on that outfit. Passed in every run. | No |
| Read | **BR7.** Hand-edited the address to `#/outfits/%`. | **Run 1 failed.** The page threw "URI malformed" and stayed on the previous outfit. This was an existing bug in the shared router that affected every address with an id, including `#/collection/%`. After the fix it shows "Outfit not found". Runs 2 to 7 passed. | Yes. The router was fixed to keep a badly escaped address part as typed instead of crashing. |
| Read | **BR8.** Opened the Outfits address as the stylist account. | Redirected to the stylist workspace. Unit tests also confirm stylists and admins are refused on all five outfit operations. Passed in every run. | No |
| Update | **BU2.** Cleared the name, unchecked items down to one, saved, then refreshed. | Both errors appeared. After the refresh the stored outfit was exactly as before. Passed in every run. | No |
| Update | **BU3.** Edited the same outfit three times in a row (rename; add an item and notes; rename and remove an item), then refreshed. | Each save showed "Saved" and updated the page. After the refresh the third version was what showed, and the outfit moved to the top of the list. Passed in every run. | No |
| Update | **BU4.** Renamed an outfit to another outfit's name, then changed only its capitals. | **Run 1 failed.** The duplicate name was refused correctly. But after the capitals change saved, the app went back to the outfit list instead of the outfit page, so the test's 8-second wait for the outfit page ran out. From run 2 on, "office" was refused and "RAINY WEEKEND" saved and opened the outfit page. | Yes. Save went back one step in the browser history to fix a Back-button problem, but when the form was opened from the list, "back" meant the list. The fix steps back only when the outfit page opened the form; otherwise it opens the outfit page. |
| Update | **BU5.** Pressed Cancel on an edit, and pressed the browser's Back after saving. | Cancel returned to the outfit page unchanged. After a save, one Back press went to the list without reopening the form. Passed in every run. | Yes, before testing. A plan reviewer found that the first version, which copied the existing item edit screen, needed two Back presses after saving. It was changed before the browser tests. That change caused the BU4 failure above. |
| Update | **BU6.** In a second tab, deleted an item while the first tab was adding another item to an outfit that held it. | Saving showed "Choose again: some of these items are no longer in your collection", the deleted item disappeared from the form, and the count went to "3 chosen". Saving again worked. Passed in every run. | No |
| Update | **BU7.** Archived an item that is in an outfit, then renamed the outfit and refreshed. | **Run 1 failed:** 0 archived tiles were found instead of 1, because of the same Save navigation bug as BU4 (the test ended on the list). From run 2 on, the archived item stayed checked and labeled "archived" in the form, and it stayed in the outfit after the rename and refresh. | Yes, the same fix as BU4. Separately, the written plan only mentioned "active" items; reviewers flagged that this would drop archived items. The edit form already lists archived items that are in the outfit, and this test confirmed it. |
| Update | **BU8.** With 13 items, used the filter box, pressed Enter in it, then tried to choose a 13th item. | "tee 1" narrowed the list to 3 rows, and Enter there didn't save. A chosen item stayed chosen while hidden. The 13th choice was refused with "Choose up to 12 items", and the outfit saved with 12. From run 4 on, its card shows 4 thumbnails and "+8". **A reviewer then found that if the filter hides the first item, the "Choose at least two items" error left keyboard focus on the page body.** From run 6 on, focus moves to the first item still shown. With the old code back, the new focus check fails. | Yes. The focus fallback was added. Also, the thumbnail check was added because a reviewer found the old one could never fail: it ran on a 2-item outfit. |
| Update | **BU9.** In a second tab, changed an outfit's items while the first tab was renaming it. | The rename saved, and the item change from the other tab was kept, not overwritten. Added in run 4; passed in runs 4 to 7. | No. A reviewer found that nothing tested "send only the changed fields" in the browser, so this check and BU10 were added. Both passed the first time. |
| Update | **BU11.** Opened the edit form from a bookmark, pressed Cancel, pressed Back to return to the form, then saved. | **A reviewer reproduced a bug here**: Save guessed that the outfit page had opened the form because the last address was the outfit page. After Back that guess was wrong, so Save stepped back past the form, possibly out of the app. The fix remembers an actual click on **Edit outfit**. In run 6 this check passed, but with the old code back it also passed: the entry behind the form happened to be that same outfit. The agent changed the test to put a different page behind the form. Now it fails with the old code and passes with the fix (run 7). | Yes, twice: the navigation code, and then the test, which at first couldn't catch the bug. |
| Update | **BU10.** Renamed an outfit that was down to one item. | Saved. It kept its one item and its "Needs another item" state. Added in run 4; passed in runs 4 to 7. | No |
| Delete | **BD1.** Opened Delete and cancelled three ways: the Cancel button, Escape, and tapping outside the dialog. | The dialog said "The items in it stay in your collection." and focus was inside it. Each way closed it and kept the outfit. Passed in every run. | No |
| Delete | **BD2.** Confirmed a deletion. | "Outfit deleted", back on the list without it, and the number of closet items was unchanged. Passed in every run. **However, a reviewer showed the original "gone from the list" check could never fail**: it searched for a card starting with "Office", but card text starts with whitespace. From run 4 on, it compares the list of names before and after, and asks the API, which says not found. | Yes, in the test. The app was fine, but the agent's first version of this check proved nothing. |
| Delete | **BD3.** Refreshed after deleting, then opened its old address and its edit address. | It stayed gone, and both addresses showed "Outfit not found" with no form. Passed in every run. | No |
| Delete | **BD4.** Deleted a closet item that was in several outfits. | The confirmation said how many outfits it would be taken out of. Afterwards, an outfit left with one item showed "Only one item is left in this outfit", and its card said "Needs another item". Passed in every run. | No |
| Delete | **BD5.** Opened the delete dialog and pressed the browser's Back button. | **Runs 1 to 3:** nothing was deleted, but the page went back while the dialog stayed open over it. Confirming at that point would still delete the outfit. The test only logged this. A reviewer pointed out that the check stayed green anyway, so dialogs now close when the page changes. **Run 4 failed** because the test waited for the wrong page: a check inserted before it changed what Back returns to. **Runs 5 to 7:** after Back the dialog is gone and nothing is deleted. | Yes. The dialog behavior was changed in `js/lib/ui.js`, and the test's expected page was corrected. |
| Delete | **BD6.** Deleted an outfit in a second tab, then pressed Edit in the first tab. | "Outfit not found", with no crash and no console error. Passed in every run. | No |

Other checks in the same run:

- **C3:** the normal create path.
- **BU1:** the edit form opens with the current values.
- **X1:** every outfit screen fits a 390 px phone.
- **X2:** an outfit can be built with the keyboard only.
- **X1d:** desktop 1280×860 in the dark theme.
- **X3:** Export my data includes outfits, and Reset demo data clears them. **In run 1 this check
  passed, but the run logged a console error** ("InvalidStateError: … The database connection is
  closing"). It came from an existing bug in **Reset demo data**, which rendered one screen
  against the database it had just deleted. The agent fixed it (`js/client.js`), and run 2 had no
  errors.
- **X6:** a version 1 database upgrades to version 2 and keeps a stored item.

## 5. Hardest CRUD operation: Update

Update was the hardest part of this feature, and it was hard in all three ways: specifying
it, building it, and testing the edge cases.

**Specifying it** was harder than I expected. "Edit an outfit" sounds simple, but an outfit
points at other records that can change on their own:

- What should the edit form show for an item that was archived after it was put in the outfit?
- What if an item was deleted in another tab while the form was open?
- What if the outfit is down to one item and I only want to rename it, but the rule says an
  outfit needs two items?

None of these were in my original plan. The plan said the form lists "my active closet items",
and reviewers pointed out that this would silently drop an archived item from an outfit the next
time it was saved. The answers:

- The form lists archived items that are already in the outfit, checked and labeled.
- After a reviewer's note, the form sends only the fields that changed. A rename then doesn't
  touch the items, so it works on a one-item outfit and doesn't overwrite an item change made in
  another tab.

**Building it** caused the most test failures. Two of the four failures in the first browser
run were Update tests (BU4 and BU7), and both had the same cause. To fix a Back-button problem,
**Save changes** went back one step in the browser history. When the form had been opened
from the outfit page, that was right. But the test opened the form from the list, so after
saving, the app went back to the list instead of the outfit page. In BU7 the test then looked
for item tiles on the list and found 0. The first fix guessed from the last address whether the
outfit page had opened the form, and the rerun passed. A code reviewer later showed that the guess
was still wrong after pressing Back into the form (BU11), which could even leave the app. Now the
app remembers an actual click on **Edit outfit**: Save goes back only then, and otherwise opens
the outfit page directly.

**Testing edge cases** for Update needed the most setup:

- a second browser tab deleting an item mid-edit (BU6);
- an archived item (BU7);
- a closet big enough to need the filter and hit the 12-item limit (BU8);
- three edits in a row with a refresh (BU3);
- two tabs changing the same outfit (BU9);
- a bookmark, Cancel and Back sequence (BU11).

By comparison, Create's rules (a name, two items, no duplicates) were easy to state. Its
problems were about presentation and names: an error hidden under the header (BC1) and
invisible characters (BC7). Delete was mostly about being careful with the cascade when a
closet item is deleted.

Corrections needed for Update:

- **Before testing, from the plan reviews:**
  - send only the changed fields;
  - make Save and Cancel go back instead of stacking a second copy of the outfit page.
- **After the failing tests:** fix the Save navigation so it lands on the outfit page however
  the form was opened (BU4, BU7).
- **After the code review:**
  - remember an actual click on **Edit outfit** instead of guessing from the last address (BU11);
  - keep keyboard focus in the item list when the filter hides the first item (BU8).

In the results table, Update has the most rows where the agent had to be corrected: five (BU4,
BU5, BU7, BU8, BU11). Create, Read and Delete have two each, plus one "partly" for Create.

## 6. Authentication observations (for D10)

I didn't add authentication in D08. These are places where real sign-in and ownership will
matter:

- **Demo accounts have no password.** One tap signs in as Alex, so anyone using the same
  browser can open, edit or delete Alex's outfits.
- **Sessions on shared devices.** The session token stays in localStorage for 30 days. On a
  shared computer the next person is still signed in unless the first one signs out.
- **Ownership is only checked in the browser tab.** The outfit operations check that the outfit
  and every item in it belong to the signed-in person. Another person's outfit acts like one that
  doesn't exist (BR5), and an outfit can't include someone else's item. But that check runs in
  the same tab. Anyone with developer tools can open the IndexedDB database and read every local
  account's outfits. A real backend has to enforce the same rule on the server, for example with
  row-level security. The unfinished Supabase table for outfits is noted in `supabase/README.md`.
- **One shared origin on GitHub Pages.** Every site under `ttakita-su.github.io` shares one
  origin, so another page there could read Rotation's IndexedDB. Real accounts with
  server-side data would remove that risk.
- **Data is per browser and per device.** Outfits don't follow a person to their phone. Sign-in
  with server storage is what would make "my outfits" mean the same thing everywhere.
- **Roles.** Stylists and admins are refused on every outfit operation (BR8 and unit tests), and
  outfits are never shared with a stylist. If sharing outfits with a stylist is added later, it
  needs the person's consent per request, like item sharing has now.
- **Signed-out visits.** A signed-out visit to an outfit address goes to sign-in and comes back
  afterwards (BR6). With real accounts, the same flow must not show anything before sign-in.
- **Account deletion and reset.** Deleting an account removes its outfits. **Reset demo data**
  deletes every account in that browser, and deleting a demo account resets all the demo
  accounts. Real accounts would need deletion scoped to one person.
- **Two devices or tabs.** The last save wins, and duplicate names are only checked on a
  best-effort basis. With real accounts on several devices, saves need a version check, and
  names need a unique index per person.
- **Duplicate saves.** Idempotency keys (which stop a double tap from saving twice) are
  already scoped per person. Real accounts should keep them that way.

## 7. Evidence

### Files changed

New:

- `js/server/ops/outfits.js`: `listOutfits`, `getOutfit`, `createOutfit`, `updateOutfit`,
  `deleteOutfit`.
- `js/screens/outfits.js`: the `/outfits`, `/outfits/new`, `/outfits/:id` and
  `/outfits/:id/edit` screens.
- `tests/unit/outfits.test.mjs`: 25 unit tests.
- `tests/e2e/outfits.mjs`: 37 browser checks.
- `docs/D08_CRUD_PLAN.md` and this report.

Changed:

- **Data and server:**
  - `js/server/db.js`: the `outfits` store, `DB_VERSION` 2.
  - `js/server/records.js`: outfit field checks and name cleaning.
  - `js/data/schema.js`: `OUTFIT_LIMITS`.
  - `js/server/api.js`: registers the new module.
  - `js/server/ops/inventory.js`: deleting an item removes it from outfits first.
  - `js/server/ops/privacy.js`: export and account deletion include outfits.
  - `js/server/seed.js`: demo resets clear outfits.
- **Screens:**
  - `js/screens/index.js`: registers the screens.
  - `js/screens/collection.js`: the Items / Outfits switch, an item page's Outfits section, and a
    delete warning that counts outfits.
  - `js/ui/screen-kit.js`: `collectionTabs`.
  - `css/screens/collection.css`: outfit styles.
  - `css/components.css`: dialog text wraps long words.
- **Bugs found while testing:**
  - `js/lib/router.js`: a stray `%` no longer crashes the page.
  - `js/client.js`: Reset demo data no longer logs an error.
  - `js/lib/ui.js`: a dialog closes when the page changes under it.
- **Rollout:**
  - `sw.js`: new cache name, and refreshes that skip the browser's HTTP cache so old and new files
    can't mix after the database upgrade.
  - `tests/unit/backend-server.test.mjs`: the matching test.
- **Tests and docs:**
  - `tests/e2e/run.mjs` and `tests/e2e/smoke.mjs`: the new browser check, and the new routes in
    the smoke test.
  - `ARCHITECTURE.md`, `README.md`, `supabase/README.md`, and the repository's root `README.md`
    and `index.html`: describe outfits.

### Commands run and results (all on 2026-10-26, in `closet-advisor/`)

| Command | Result |
| --- | --- |
| `npm test` (before any change) | 265 passed, 0 failed |
| `npm run test:e2e` (before any change) | 3 of 3 browser checks passed |
| `node --test tests/unit/outfits.test.mjs` (first version) | 20 of 20 passed |
| `node --test --test-name-pattern="service worker" tests/unit/backend-server.test.mjs` | First failed. The new check compared an object made inside the test's sandbox with strict deep-equal, which fails across sandboxes, so it was a mistake in the test, not in the app. Changed to compare the value; passed. |
| `node tests/e2e/outfits.mjs`, run 1 | 30 of 34 passed. BR4, BR7, BU4 and BU7 failed, plus 2 errors: "URI malformed" and an InvalidStateError from Reset demo data. Exit code 1. |
| `node tests/e2e/outfits.mjs`, run 2 | 34 of 34 passed |
| `node tests/e2e/outfits.mjs`, run 3 (with the new visibility check) | 33 of 34 passed. BC1 failed: the first error was under the sticky header. Exit code 1. |
| Code review: four reviewers, each finding checked by a skeptic, 14 agents in all | 10 findings. 7 were confirmed and fixed: 1 name bug, 2 edit-form problems (focus, Save navigation) and 4 test gaps (changed-fields edits, the demo-reset wipe, BD2, the thumbnails). 3 were rejected because this change didn't cause them: old tabs after the database bump, saved double-tap results keeping a deleted outfit's view, and the BD5 dialog. The BD5 dialog behavior was still improved. |
| Mutation checks: put the old code back, run, restore | Old `USER_STORES` without outfits: the demo-reset unit test failed. Old name check: 2 unit tests failed. Old focus and navigation code: the BU8 focus check failed, and the rewritten BU11 failed. Each time, restoring the fix made the tests pass again. |
| `node tests/e2e/outfits.mjs`, run 4 | 35 of 36 passed. BD5 failed because the test expected the wrong page. Exit code 1. |
| `node tests/e2e/outfits.mjs`, runs 5, 6 and 7 | 36 of 36, then 37 of 37 twice, all passed |
| One-off upgrade check from the committed version (`124a60b`, served on the same address) | The old app (DB version 1, where `listOutfits` gives "Unknown operation") saved an item with a note. After loading the new code, the database was at version 2 with the `outfits` store, the person was still signed in, all 5 item ids, the wishlist item and the note were kept, and a new outfit could be created. No console errors. |
| **Final** `npm test` | **290 passed, 0 failed**: 265 existing and 25 new |
| **Final** `npm run test:e2e` | **4 of 4 browser checks passed**: every route as each role (with `/outfits` and `/outfits/new` added), the photo pipeline, real-product lookups with fixture stores, and outfits (37 checks, no console errors, page errors, failed requests or outside requests) |
| **Final** `node free-bet/tests.cjs` (from the repo root; not affected by this change) | Passed |
| **Final** `git diff --check` | No whitespace errors |

The repository has no build, type-check or lint command, so none were run.

### Limitations and checks still to do by hand

- **Only Chromium was tested.** WebKit isn't installed here, so Safari on an iPhone hasn't been
  tried. Please open the app on a real phone once.
- **No screen reader was used.** The tests check labels, `aria-invalid`, `aria-describedby`, focus
  and keyboard use, but nobody has listened with VoiceOver.
- **The published site hasn't been checked.** Nothing was pushed to GitHub Pages. The service
  worker only runs over HTTPS, so its change is covered by a unit test only. After publishing,
  open the live site twice and confirm Outfits appears and existing items are still there.
- **Tabs open during an update.** A tab that was already open with the old version will show
  errors after another tab upgrades the database, until it is reloaded.
- **Existing issues seen but not changed (outside this feature):**
  - The existing Collection header is about 39 px too wide on a 320 px screen, measured by a
    reviewer.
  - The existing item edit screen needs two Back presses after saving.
  - A future purchase date on an item, or a target price of zero on a wishlist item, shows an
    error toast without highlighting the field.
- **Synthetic data only.** All tests use the demo accounts and fake items. Nothing was tested
  with real photos or many real outfits.

### How to run the app and check each operation

```sh
cd closet-advisor
npm start          # Node 24+; prints an address such as http://127.0.0.1:8130/
```

Or, from the repository root, run `python3 -m http.server 8000` and open
<http://localhost:8000/closet-advisor/>. Outfits work the same in demo mode. To run the tests,
use `npm test` and `npm run test:e2e` in `closet-advisor/`. The browser tests need `npm ci` and
`npx playwright install chromium` once.

1. Choose **Alex Rivera** on the welcome screen, open **Collection**, then **Outfits**. You should
   see "No outfits yet".
2. **Create:**
   1. Press **New outfit**, then **Save outfit** with nothing filled in. Both errors appear.
   2. Type a name, choose two or more items, and save. "Outfit saved" appears, and the outfit page
      opens.
   3. Try the same name again in different capitals. It is refused.
3. **Read:** go back to **Outfits**. The card shows its name, item count and pictures. Reload the
   page; it is still there. Open an item from the outfit: its page lists the outfit under
   "Outfits".
4. **Update:**
   1. On the outfit page press **Edit outfit**, change the name, add or remove items, and press
      **Save changes**. "Saved" appears and the page shows the change.
   2. Clear the name and save. The error appears and nothing changes.
   3. Reload to confirm the last saved version stays.
5. **Delete:**
   1. Press **Delete outfit**, then **Cancel**. It is still there.
   2. Press **Delete outfit** again and confirm. "Outfit deleted" appears, and it's gone from the
      list.
   3. Reload. It stays gone, and the items are still in Collection.
