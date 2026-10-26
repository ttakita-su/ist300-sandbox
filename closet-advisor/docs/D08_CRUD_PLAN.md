# D08 CRUD plan: Outfit Collections in Rotation

IST 300 D08, Tomoyoshi Takita. Written on 2026-10-26, **before any application code was
changed**. The results are in [D08_CRUD_REPORT.md](D08_CRUD_REPORT.md).

## 1. What already exists (repository inspection)

Rotation (`closet-advisor/`) is a mobile-first web app in plain HTML, CSS and JavaScript ES
modules, with no build step.

| Area | What is there |
| --- | --- |
| Routing | Hash router (`js/lib/router.js`). Screens are modules in `js/screens/` that export `{ path, title, tab, roles, render, mount }`. |
| "Server" | An in-tab API (`js/server/api.js`) that checks the session, role and idempotency, then runs operations from `js/server/ops/*.js`. |
| Storage | IndexedDB through `js/server/db.js` (`DB_VERSION = 1`), with an in-memory fallback. The upgrade code adds missing stores and keeps existing data. |
| UI kit | `js/ui/components.js` (tiles, empty states, form fields, notices) and `js/lib/ui.js` (confirm dialog, toasts, busy buttons, inline field errors). |
| Tests | `npm test`: 265 Node unit tests, all passing on 2026-10-26 before changes. `npm run test:e2e`: 3 Playwright Chromium checks, all passing before changes. |
| Accounts | Demo sign-in already exists. Authentication is out of scope for D08 and is not changed. |

## 2. The three options

| | A. Closet inventory | B. Wishlist manager | C. Outfit collections |
| --- | --- | --- | --- |
| Fits the app because | It is the core of the closet | Users save things they want to buy | "Build outfits using their existing clothing" is part of the capstone vision |
| Exists today | All four verbs work: `createOwned` (including manual entry), the `/collection` grid, `updateOwned` on `/collection/:id/edit`, and `deleteOwned` with a confirmation dialog | Create, view and edit work. Remove only sets a "removed" status. There is no priority field. | Nothing. The only "outfit" text in the code is a retailer name and a rule that recommendations never mention outfits. |
| Work needed | Small fixes. Category can't change after saving, and catalog items can't be renamed (by design). | A priority field across about 5 shared add flows. Possibly changing delete from soft to hard. | A new store, five operations, four screens, tests and docs |
| Reuses | Everything (it is the existing feature) | Wishlist forms and screens | The owned-item views, tiles and thumbnails, the checkbox picker pattern, `confirmDialog`, `showFieldErrors`, IndexedDB, and the delete-cascade pattern |
| Risk | Low, but shows almost no new work | Moderate, because the form code is shared | Low to moderate. The change is additive. The main risks are the IndexedDB version upgrade, route order, and a stale service-worker cache. |
| Shows CRUD for D08 | Weakly, because nothing new is built | Partly | Best. All four verbs are built and tested from scratch, with real edge cases. |

**Recommendation: Option C.** The assignment said to prefer A when the options are equally
suitable, but they are not. A's CRUD is already complete, so choosing it would mean
re-testing existing work instead of implementing a feature. C is the only option that adds
a working capability to the capstone. It also builds directly on A's data, because outfits
are made from closet items. Tomoyoshi confirmed Option C on 2026-10-26 ("Lets do option C").

## 3. The four CRUD statements

- **Create:** As a Rotation user, I can build an outfit by giving it a name and choosing two
  or more items from my closet, so I can save combinations I like to wear.
- **Read:** As a Rotation user, I can see all of my saved outfits with their names and
  pieces, and open one to see every item in it.
- **Update:** As a Rotation user, I can rename an outfit, change its notes, and add or remove
  pieces, and I see my changes right away.
- **Delete:** As a Rotation user, I can delete an outfit I no longer want after confirming,
  and the clothes in it stay in my closet.

## 4. Acceptance criteria

These are the checks the implementation must pass. "Nothing is saved" means that no outfit
record is created or changed. Each check is verified in the browser or through the API.

### Create

| ID | Criterion |
| --- | --- |
| C1 | Collection and Outfits share an "Items / Outfits" switch under the Collection tab. The Outfits screen has a **New outfit** button that opens `/outfits/new`. |
| C2 | The form has a **Name** field (required, up to 60 characters), a checkbox list of my active closet items with pictures, and optional **Notes** (up to 500 characters). |
| C3 | Saving with a name and at least 2 items creates the outfit, shows "Outfit saved", and opens the outfit's page with the chosen name and items. |
| C4 | An empty or spaces-only name shows "Enter a name for this outfit" next to the field. Nothing is saved. |
| C5 | Choosing fewer than 2 items shows "Choose at least two items" next to the item list. Nothing is saved. |
| C6 | A name that matches one of my outfits, ignoring capital letters and extra spaces, shows an inline error. Nothing is saved. |
| C7 | Pressing Save twice quickly creates exactly one outfit. |
| C8 | With fewer than 2 active items, `/outfits/new` explains that an outfit needs two items and links to adding an item, instead of showing a form that cannot succeed. |

### Read

| ID | Criterion |
| --- | --- |
| R1 | `/outfits` lists every one of my outfits, most recently changed first. Each card shows its name, item count and up to four thumbnails. |
| R2 | With no outfits, the screen shows "No outfits yet" and a **Build an outfit** button. |
| R3 | An outfit's page shows its name, notes and each item as a collection tile that links to that item. |
| R4 | After a browser refresh, outfits and their contents are still there (IndexedDB). |
| R5 | An item's page lists the outfits that include it and offers **Build an outfit with this**. |
| R6 | A missing or deleted outfit id, or another person's, shows a "not found" state. No outfit data is shown. |
| R7 | One person never sees another person's outfits. |

### Update

| ID | Criterion |
| --- | --- |
| U1 | The outfit page has **Edit outfit**, which opens a form prefilled with the current name, items and notes. |
| U2 | **Save changes** shows "Saved" and returns to the outfit page with the changes visible. The list shows the new name. |
| U3 | Clearing the name, or leaving fewer than 2 items, gives the same inline errors as create. The stored outfit is unchanged, including after a refresh. |
| U4 | Renaming to another outfit's name is refused. Saving an outfit under its own name, or changing only its capital letters, is allowed. |
| U5 | Several edits to the same outfit in a row each save. After a refresh, the last edit is what shows. |
| U6 | **Cancel** returns to the outfit without changing it. |

### Delete

| ID | Criterion |
| --- | --- |
| D1 | The outfit page has **Delete outfit**. It opens a confirmation that says the items stay in the collection. |
| D2 | Cancelling (Cancel button, Escape, or tapping outside) keeps the outfit. |
| D3 | Confirming removes the outfit, shows "Outfit deleted", and returns to `/outfits` without it. Its items are still in the collection. |
| D4 | After a refresh the outfit stays deleted, and its old address shows "not found". |
| D5 | Deleting a closet item removes it from every outfit. An outfit left with fewer than 2 items is kept and shows a notice suggesting adding a piece or deleting the outfit. |

### Across all four

| ID | Criterion |
| --- | --- |
| X1 | Works on a 390×844 phone and a 1280×860 desktop with no sideways scrolling, in light and dark themes. |
| X2 | Controls have labels and can be used with a keyboard. Errors are tied to their fields (`aria-invalid`, `aria-describedby`). |
| X3 | **Export my data** includes outfits. Deleting an account removes them. A demo reset clears them. |
| X4 | No console errors during the flows. `npm test` and `npm run test:e2e` still pass. |
| X5 | No authentication changes, no AI and no retailer requests. Outfits are kept out of recommendations. |
| X6 | A browser that already holds version 1 data upgrades to version 2 and keeps its items. |

## 5. Storage decision

Outfits go in a new `outfits` store in **the existing IndexedDB database**:
`{ key: 'id', indexes: ['userId'] }`, with `DB_VERSION` raised from 1 to 2.

Why this store:
- It is already operational, and the closet items that outfits point to already live there.
- localStorage would split one person's data across two places. It would also miss Export,
  account deletion and the item-delete cascade, and its size limits are small.

Record shape:

```text
outfit {
  id: 'fit_…', userId, createdAt, updatedAt,   // ISO times from the injected clock
  name,                                        // 1–60 characters after trimming and collapsing spaces
  itemIds: [ownedItem id],                     // 2–12 of the person's own items when saved
  notes                                        // '' or up to 500 characters
}
```

## 6. Implementation plan

1. **Data:** add the `outfits` store and bump `DB_VERSION` (`js/server/db.js`). Add
   `buildOutfit()` validation (`js/server/records.js`).
2. **Operations:** add `js/server/ops/outfits.js` with `listOutfits`, `getOutfit`,
   `createOutfit` (idempotent), `updateOutfit` and `deleteOutfit`.
   - All are user-only, and another person's outfit behaves like a missing one.
   - Register the module in `js/server/api.js`.
3. **Integrity:**
   - `deleteOwned` removes the item from outfits.
   - Export and account deletion include outfits (`privacy.js`).
   - The demo reseed wipes outfits (`seed.js`).
4. **Screens:** add `js/screens/outfits.js` with `/outfits`, `/outfits/new`, `/outfits/:id`
   and `/outfits/:id/edit`.
   - Register them in `js/screens/index.js`, with `new` before `:id`.
   - Add the Items/Outfits switch and the item page's Outfits section (`js/screens/collection.js`).
   - Add styles in `css/screens/collection.css`.
5. **Rollout:** bump the service-worker cache name (`sw.js`, plus its unit test) so the
   published site doesn't mix old and new modules after the database upgrade.
6. **Tests:**
   - `tests/unit/outfits.test.mjs`.
   - `tests/e2e/outfits.mjs`, a real browser run on phone and desktop with refreshes,
     added to `npm run test:e2e`.
   - The smoke route list.
   - Export and delete assertions in `access.test.mjs`.
   - A one-off upgrade check from the version 1 database.
7. **Docs:** update `ARCHITECTURE.md` and `README.md`, then write the D08 report.

Plan Mode note: this run did not use Claude Code's interactive Plan Mode. Its approval stop
would have interrupted the one-shot task. Instead, this plan and its acceptance criteria were
saved to this file before any code changed, which serves the same plan-before-code purpose.

## 7. Planned break tests (at least two per verb)

| Verb | Unexpected behavior to try | Expected result |
| --- | --- | --- |
| Create | Submit the empty form | Name and item errors, nothing saved (C4, C5) |
| Create | Reuse an existing name with different capitals and spaces, and double-click Save | Name error; exactly one outfit from a double click (C6, C7) |
| Read | Open Outfits with no outfits, and with a closet of fewer than 2 items | Empty states with a next step (R2, C8) |
| Read | Refresh after adding outfits; open another person's outfit address | Still listed; not found (R4, R6, R7) |
| Update | Clear the name and uncheck items down to 1 | Inline errors, stored outfit unchanged after refresh (U3) |
| Update | Edit the same outfit three times, then refresh | The last edit persists; renaming to its own name works (U4, U5) |
| Delete | Cancel the confirmation with the button and with Escape | The outfit is kept (D2) |
| Delete | Delete, refresh and revisit the old address; delete a closet item that is in an outfit | Stays gone; the item is removed from the outfit, which is flagged (D4, D5) |

## Addendum: criteria added after review (2026-10-26, before the browser tests)

The sections above are the plan as first written. Three independent reviews of that plan (real
users and accessibility, data integrity, and the D08 rubric) found gaps, so these criteria were
added before the browser tests were written. Nothing above was changed.

| ID | Criterion |
| --- | --- |
| C9 | The item list is grouped by category. From 7 items, a filter box narrows it; chosen items stay chosen while hidden, and Enter in the filter box doesn't save. Choosing a 13th item is refused with "Choose up to 12 items". |
| C10 | A name made only of invisible characters is empty. Joiners used by emoji and Persian text are kept. A name containing HTML is shown as text. |
| R8 | An outfit only ever shows items owned by the outfit's owner, even if a stored record holds another id. |
| R9 | A signed-out visit to an outfit's address goes to sign-in and comes back after it. A broken address (a stray `%`) shows the not-found screen instead of crashing. Stylists and admins can't open outfits. |
| U7 | An item archived after it was added stays in the outfit, marked as archived and still checked in the edit form, and survives edits. |
| U8 | The edit form sends only what changed, so a rename works on an outfit that is down to one item, and an item change made in another tab isn't overwritten by a rename. |
| U9 | If an item is deleted in another tab while the form is open, saving shows the item error, removes that item from the form, and the next save works. |
| U10 | After Save, the person is on the outfit page, and one Back press leaves it without reopening the form. Cancel goes back. |
| D6 | Deleting a closet item says in its confirmation how many outfits it is taken out of. Outfit cards with fewer than 2 items say "Needs another item". |
| X7 | Long names with no spaces never widen a page or a dialog. Checks look at element edges, not only page scroll, because `body` hides sideways overflow. |
| X8 | Outfit names and notes never appear in audit rows or metrics. Export holds the person's outfits and nothing of anyone else's. |
| X9 | The rollout can't mix old and new modules. The service worker refreshes past the browser's HTTP cache, and `DB_VERSION` is never lowered. |

Changes to decisions:
- Item ids that aren't the person's get one `invalid` answer on the item list with
  `missingItemIds`, not `not_found`, so the form can mark the field. The answer is the same for
  missing, deleted and other people's ids.
- Detail and edit show "Outfit not found" inside the screen instead of throwing, so no console
  error is logged.
- The Items / Outfits switch uses the existing `.tabs` link row, not chips, which already mean
  filters.
