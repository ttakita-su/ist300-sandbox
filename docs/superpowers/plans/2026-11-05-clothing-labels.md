# Photo Product Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Search for a photographed item online first and offer editable manual labels whenever no result is suitable.

**Architecture:** Reuse the existing Bing reverse-image provider and confirmed web-item save flow. A new online mode creates a photo job without demo-catalog processing. Capture and results screens expose the online/manual paths and keep demo matching for sample images.

**Tech Stack:** Existing vanilla HTML/CSS/JavaScript, Node 24+, IndexedDB, Node tests, Playwright. No new provider or runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-05-clothing-labels.md`

## Global Constraints

- No photo request on file selection, rendering, polling, or reload.
- Reuse the existing Node `/api/lens` provider and photo-result save path.
- Unknown clothing brand is null. A visible descriptive name remains required.
- Preserve unrelated weather changes, relative paths, escaping, ownership checks, prepared-image provenance, and existing catalog tests.
- No real user photo is uploaded during development verification. No publish or commit requested.

## Review Focus

- A late search response must not navigate away from a screen the user chose meanwhile.
- A blocked, empty, unavailable, or static-mode search must leave manual entry usable.
- A saved item must retain the original photo after save, reload, and edits.
- Missing clothing brand must not require an invented label; empty/invisible item names must still be rejected.
- Online results must remain user-confirmed guesses and must not acquire demo-catalog identity.

### Task 1: Online photo jobs and manual clothing records

**Files:** `closet-advisor/js/server/ops/matching.js`, `closet-advisor/js/server/records.js`, `closet-advisor/tests/unit/photo-search.test.mjs`, existing inventory tests.

**Interfaces:** `createMatchJob({ ..., mode?: 'catalog'|'online' })`; default catalog. Online jobs are immediately `done`, `result.retrieval: 'not_run'`, empty candidates/asks/notes, and no scheduled matcher. Existing `searchWebForPhoto` and `confirmMatch` handle them. Clothing custom brands normalize to null when blank; other categories retain their rules.

- [x] Write failing tests for immediately ready online jobs, explicit-only search, photo ownership, invalid modes, original-photo preservation, editable brandless clothing, and wishlist transfer.
- [x] Run `node --test tests/unit/photo-search.test.mjs` from `closet-advisor`; observe the new behavior failing.
- [x] Implement online job mode and optional clothing brands; preserve the existing catalog path.
- [x] Run targeted tests and `npm test`; update only the old clothing-brand expectations intentionally superseded by this feature.

### Task 2: Uploaded photo → search or manual labels → editable saved item

**Files:** `closet-advisor/js/screens/capture.js`, `closet-advisor/js/screens/match.js`, `closet-advisor/js/screens/collection.js`, `closet-advisor/js/screens/add.js`, `closet-advisor/tests/e2e/photo-search.mjs`, `closet-advisor/tests/e2e/run.mjs`.

**Interfaces:** Preview actions `[data-photo-search]` and `[data-photo-label]`; samples retain `[data-start]` for demo matching. Online requests begin only in the preview click handler, then navigate to existing match results. The manual action navigates to the job with `?manual=1` to open the existing custom-save sheet. Existing jobs/results remain readable. Manual and edit forms use existing type/color vocabularies and patch only changed custom fields.

- [x] Write browser checks for explicit-only search and results/save, no-match/manual save/reload/edit, direct manual entry, offline fallback, and leaving during a pending request. Use local fixture responses and no outside requests.
- [x] Run `node tests/e2e/photo-search.mjs`; observe the missing primary online/manual actions fail.
- [x] Implement preview actions, guarded pending state and cleanup, online-only results with a prominent manual fallback, type/color controls, optional clothing brand, and later editing.
- [x] Run `node tests/e2e/photo-search.mjs`, `npm test`, and `npm run test:e2e`. Inspect 390 px and desktop screenshots, errors, horizontal overflow, and keyboard access.

### Task 3: Documentation and final diff

**Files:** `closet-advisor/README.md`, `closet-advisor/ARCHITECTURE.md`, plan/spec checkboxes.

- [x] Document online-first real uploads, demo sample behavior, manual fallback/editing, browser storage, local-server requirement, and the provider's prototype limitations.
- [x] Inspect the diff, run `git diff --check`, and check referenced paths. Preserve the user's weather changes. Report actual fixture-based verification separately from live recognition accuracy.

## Review record

The user reviewed the earlier tagging plan and replaced it with online reverse-image product search plus manual fallback. This revision follows that correction and uses the already-existing provider; no Anthropic integration is needed.

## Verification record — 2026-11-05

- RED: all four new online-photo unit cases failed before implementation; the browser check failed on the absent photo-search action. A later check reproduced the required-brand restriction before that form was updated.
- GREEN: `npm test` — 315 passed, zero failures. `npm run test:e2e` — every route, sample pipeline, fixture web lookups, new photo-search/manual-label flow, 20 inventory checks, and 37 outfit checks passed.
- Inspected phone/light results and desktop/dark manual-label screenshots. Existing tests exercise keyboard entry, navigation, ownership, exports, deletion and database upgrades.
- Reviewed implementation diffs, checked paths and whitespace. No real user photo or live recognition service was used in verification. No commit or publication.
