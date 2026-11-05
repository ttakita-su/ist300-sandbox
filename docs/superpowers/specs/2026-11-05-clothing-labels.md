# Photo product search with manual labeling

This supersedes the earlier AI attribute-tagging proposal following the user's review on 2026-11-05.

## User's requested flow

Take a photo of the person's own clothes → reverse image search online → show possible products → the person confirms one. If there is no suitable match, offer **Label it myself**. Saved details remain editable.

## Requirements

- Make **Search online for this item** the primary action after uploading a photo. Explain next to it that pressing it sends a prepared copy to Microsoft Bing. No photo request on file selection, rendering, polling, or reload.
- Reuse the existing Node `/api/lens` provider and photo-result save path. Do not introduce Anthropic, a new API key, an AI tagging endpoint, or a different stack.
- Add `mode: 'online'` to `createMatchJob`. It creates a ready job with retrieval `not_run` without running the fictional catalog matcher. Existing calls default to `catalog` and retain their current behavior.
- Keep sample images explicitly labeled demo and let them use the existing on-device demo matching action.
- Keep the person's original photo on online and manually saved items. A store image remains an optional alternative.
- Show online results as possible products, never an automatic verified identity. User confirmation remains required.
- **Label it myself** is available from the photo preview and search-results screen, including no results, no suitable result, a blocked/unavailable provider, and static/demo mode.
- Manual photo labels include name, optional brand for clothing, color/version, type, and main colors. Unknown clothing brand is null. A visible descriptive name remains required. Sneakers and watches keep their existing brand rule.
- Existing custom clothing items can update name, brand, color/version, type, and colors through Edit details. Save patches only changed custom fields.
- Prevent duplicate starts while a search is pending; leaving the screen must prevent a late response from navigating the user back.
- Preserve existing ownership checks, image preparation/crop/rotation, same-origin API guards, rate limits, exports, deletion, and the existing catalog strategy.
- Existing Bing search is an educational prototype using public Bing pages. It can return lookalikes or be blocked; do not claim independently verified product recognition or production reliability.

## Verification

Node tests: online-mode jobs skip catalog processing, searches only happen after an explicit call, ownership and mode validation, no-match/manual save and editing, optional clothing brand, original-photo preservation, wishlist transfer.

Browser checks: uploaded photo → one search → pick/save; no-match → label/save → reload/edit; manual entry without any search; offline fallback; cancellation/navigation during a pending search; phone and desktop layout with keyboard access.

Run `npm test`, `npm run test:e2e`, and `git diff --check`, using local fixture responses. No real user photo is uploaded during development verification. No publish or commit requested.
