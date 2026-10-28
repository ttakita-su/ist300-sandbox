# Feature card: Personal Closet Inventory

| | |
| --- | --- |
| **Feature** | Personal Closet Inventory: add, see, edit and delete the clothing, sneakers and watches you own |
| **App** | Rotation (`closet-advisor/`), my IST 300 capstone ("AI Closet") |
| **Owner** | Tomoyoshi Takita |
| **Status** | Working and tested locally in Chromium on 2026-10-27. Not yet checked on the live site |
| **Where** | Collection tab (`#/collection`); Add item → Enter it yourself (`#/add/manual`) |
| **Storage** | IndexedDB store `ownedItems` in this browser ([decision record](../decisions/001-inventory-storage.md)) |
| **Course work** | IST 300 D08. [Plan](../D08_INVENTORY_PLAN.md) · [Report](../D08_INVENTORY_REPORT.md) |

## User story

As someone organizing my clothes, sneakers and watches, I want to add, see, edit and remove the
items I own, so that the closet in the app matches my real one.

## The four actions

| Action | How a person does it |
| --- | --- |
| **Create** | Add item (+) → Enter it yourself. Pick Sneaker, Watch or Clothing item, fill in Brand, Name and "Color or version", then press **Add to collection** |
| **Read** | Collection lists every item, and each tile shows the brand, name and color. The item's page shows the same three plus a **Category** row |
| **Update** | On the item's page, press **Edit details**, change Brand, Name or "Color or version", then press **Save changes** (or **Cancel**) |
| **Delete** | On the item's page, press **Delete**, then confirm in "Delete this item?" (or press Cancel) |

## Acceptance checks

| # | Check | Test ID (`tests/e2e/inventory.mjs`) | Status |
| --- | --- | --- | --- |
| 1 | Creating a valid item makes it appear in the inventory | AC1, AC1d | Pass |
| 2 | Reloading the page keeps saved items | AC2 | Pass |
| 3 | Each item shows its saved details | AC3, AC3d | Pass. A Category row was added in D08 |
| 4 | Editing updates the correct record without duplicating it | AC4, N1 | Pass |
| 5 | Deleting an item removes only that item | AC5, D2 | Pass |
| 6 | An empty closet shows an empty-state message | AC6 | Pass |
| 7 | Blank required names are rejected | AC7, C1 | Pass. Zero-width-space names are rejected since D08 |
| 8 | Cancelling an edit or a deletion leaves the data unchanged | AC8, N2, U1 | Pass |

Unit tests for the same rules are in `tests/unit/inventory.test.mjs`: "a manual item needs a
visible name and brand…" and "editing a manual item rewrites only that record…".

## Out of scope for D08

- Authentication. Accounts here are demo accounts in the browser tab; real accounts are D10.
- AI recommendations, photo uploads, and any changes to outfits or the wishlist.
- Changing an item's category after it is saved. Delete it and add it again instead.
- Renaming catalog items. Their names come from the demo catalog.

## Known limitations

- After a delete, the first press of Back looks like it does nothing (a duplicate history
  entry). The second press shows "This item isn't here".
- When two tabs change the **same** field, the last save wins with no warning. The optional
  details (size, condition, price and so on) are always sent whole, so an older tab's save
  replaces another tab's changes to them.
- Names longer than 120 characters are cut to 120 with no message.
- Changing the category on the add form keeps the brand, name and color text. It doesn't keep
  the Main colors chips or the optional details.
- Tested in Chromium only, with new local accounts. No screen reader test.

## Evidence

- Browser suite: `node tests/e2e/inventory.mjs`, 20 of 20 checks passing on 2026-10-27. Before
  the D08 fixes it was 13 of 20, with 2 console errors.
- Full runs: `npm test` 292 of 292, and `npm run test:e2e` 5 of 5 suites.
- Full results, break tests and the Discovery Log evidence are in
  [D08_INVENTORY_REPORT.md](../D08_INVENTORY_REPORT.md).
