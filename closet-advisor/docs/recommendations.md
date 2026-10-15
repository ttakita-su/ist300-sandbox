# Recommendations

How Rotation picks "Find similar", "Find matching" and wishlist alternatives, how it explains
them, and what a production version would add. Code: `js/engine/recommend.js`,
`js/engine/harmony.js`, `js/engine/explain.js`, `js/engine/parse-request.js`,
`js/server/ops/recs.js`. Tests: `tests/unit/recs.test.mjs`.

The rule underneath everything: a recommendation is a real catalog variant, its price comes from
a real offer, and every reason given is a relation we computed to one of the person's own items.
Nothing is invented to fill a gap. Unknown stays unknown.

## Pipeline

1. **Retrieve.** Every catalog variant is a candidate, except the seed itself and anything a
   feed section already showed.
2. **Scope by mode.**
   - `similar`: same body slot as the seed (sneakers with sneakers, outerwear with outerwear,
     straps with straps). With no seed, it ranks against the profile and the typed request.
   - `matching`: a different slot from the seed, with at least one positive relation to it (or,
     with no seed, to anything in the collection). Straps only for watches.
   - `alternatives`: honors the wishlist item's intent. `exact` suggests nothing, or only other
     colorways of the same product when the person marked the version as flexible.
     `inspiration` suggests similar items in the same slot. `complement` suggests items in that
     slot that go with the owned items linked to the wish (or the whole collection).
3. **Hard constraints, before any ranking.** Each exclusion is counted in `excluded`. In order:
   - versions the person owns (`owned`), unless `includeOwned`;
   - products dismissed with "Not my style" or "Too similar" (`dismissed`);
   - straps that don't fit by catalog specs (`incompatible`, see below);
   - size (`sizeUnavailable`): the catalog doesn't make the person's size, offers show it out of
     stock, or the product uses a different size system than the person's size;
   - price (`priceUnknown`, `overBudget`): with a price range, a typed size or "in stock only",
     an item needs offers to be checked, so items without a known price are left out unless
     `includeUnknownPrice`. Stale prices still count and are flagged.
   - stock, when `inStockOnly`;
   - in `matching`, lookalikes of owned items (`nearDuplicates`).
4. **Score** each survivor as a weighted sum (below).
5. **Select** with MMR and caps (below).
6. **Explain** each pick from its computed relations and the constraint facts.

When fewer than three results come back, each constraint that excluded something is offered as a
**relaxation**: `raise_budget`, `any_size`, `include_used`, `any_category`,
`include_unknown_price`. Each one carries the constraint patch (`null` removes a key) and
`wouldReturn`, computed by re-running the same pipeline with the patch, so the number on the
button is the number of results the person will get. Empty results also carry `emptyReason`, a
plain sentence built from the exclusion counts ("Nothing matches every filter: 3 are over $150
at the prices we checked and 2 aren't in stock in US M 10.").

### Where each constraint comes from

| Constraint | Source, highest priority first | Default |
| --- | --- | --- |
| Category, type | typed request or arguments; a feed section's fixed scope | any |
| Price range | arguments or typed request; "around $X" allows up to 25% over; wishlist target; "too expensive" without a target means strictly cheaper than the wish at known prices | none |
| Size | typed request; the wishlist item's desired size; the profile size for that body slot | profile |
| Condition | arguments; the wishlist item | new only (listed in `applied.hard`, relaxable) |

A type narrows only its own category: "olive sneakers and a field jacket" keeps every sneaker and
only field jackets. Every applied constraint is listed in `applied.hard` or `applied.soft` with a
label, so nothing is applied or ignored silently.

### Prices and availability

Price and availability come only from `summarizeOffers` (`js/engine/offers.js`) over
`providers.offers.list(catalog, variantId, now)`, in the person's size and condition. `fromMinor`
is always the price of a real offer for that variant and size. No offers means `status:
'unknown'`, `fromMinor: null` and `availability: 'no_offers'`; it is never zero and never the list
price. When the offers provider is down, recommendations stop with "Retailer prices could not be
checked right now. Try again shortly." rather than showing a list without prices.

### Strap fit

A strap fits an owned watch only when all of these are catalog facts: the watch's version is
confirmed (not unsure or conflicting), its catalog `lugWidthMm` equals the strap's
`strapWidthMm`, and its `attachment` is `spring_bar` or `quick_release`. Integrated bracelets,
watches without a listed lug width, integrated straps, custom watches and widths the person typed
in never produce a fit claim. When a strap section is empty, the reason says which of these
applies.

## Scoring

Each component is in a fixed range and multiplied by its weight. Admins can change weights
(`config.rankingWeights`, merged over the defaults and clamped to `WEIGHT_RANGES`).

| Weight | Default | Range | What it scores |
| --- | --- | --- | --- |
| `style` | 1 | 0–3 | Style-tag overlap with the seeds (60%) and the profile styles (40%) |
| `color` | 0.6 | 0–3 | Share of the palette in liked colors, minus avoided colors |
| `harmony` | 1.2 | 0–3 | Matching: color pairing and shared style with the anchors (best plus half the second best, minus clashes). Similar: color closeness to the seed |
| `shape` | 1.5 | 0–3 | Same type, slot, materials and key specs as the seed (cut, closure, case size, movement) |
| `price` | 0.4 | 0–2 | Known price close to the seed's price (similar, alternatives) or to an "around" figure |
| `budget` | 0.5 | 0–2 | Known price within the profile budget for the category; over budget counts against |
| `request` | 1.5 | 0–3 | Typed colors, styles, materials, brands and case size; "no white" and "not too loud" count against |
| `use` | 0.3 | 0–2 | Styles associated with the person's uses (work leans classic, minimal, dressy, preppy) |
| `feedback` | 1 | 0–3 | Feedback adjustments (below) |
| `diversity` | 0.3 | 0–0.9 | MMR trade-off; 0 keeps the ranking order |

Scores are internal. They order the list and are never shown as a number or percentage.

### Color harmony

`harmony.js` returns `{ kind, strength, sentence }` for two named colors, and `paletteHarmony`
weighs every pair of significant colors in two palettes. Kinds: `classic_pair` (navy with olive,
grey, tan, khaki or white; grey with olive; brown with olive or cream; black with white...),
`earth_palette`, `tonal`, `neutral_base`, `contrast_accent`, `metal` (steel and silver suit cool
and neutral colors, gold and bronze suit warm and earth tones) and `clash` (near-misses such as
navy with black, and loud colors that compete). Clashes only count against an item; they are
never offered as a reason. Sentences are suggestions: "Olive and navy are a classic pairing",
"Steel tends to suit cool and neutral colors like navy".

## Diversity and lookalikes

- At most one version per product; two when `similar` is asked to explore colorways
  (`exploreColorways`). Exact-intent alternatives are one product by definition, so they show
  each other colorway.
- MMR picks each next item by `λ · relevance − (1 − λ) · similarity to what is already picked`,
  with `λ = 1 − diversity` and similarity from type, palette and style tags.
- While diversity is on, a lookalike of something already on the list waits until nothing else
  qualifies, so the list never runs through near-identical products.
- A very close lookalike of an owned item (same product with only the sole color changed, the
  same watch in another case size, another brand's runner in the same colors part by part) is
  never sold as new: it is `kind: 'potential_duplicate'` with a `near_duplicate` relation that
  says what differs, ranked below real alternatives and capped at two. In `matching` it is left
  out and counted, because a lookalike replaces an item rather than going with it. An owned
  version shown with `includeOwned` is also `potential_duplicate` ("Same version as your ...").

## Explanations

`explain.js` builds every sentence from a computed relation, a price from offers, or an applied
constraint, and names the specific owned or wishlist item. Each `related` entry carries one
sentence of its own:

- color pairing: "Olive and navy are a classic pairing, so this would sit well with your
  Harbor & Pine Deck Field Jacket."
- same shape: "Same low court shape as your Vela Court Low, in black."
- cheaper alternative: "$25 less than the Kestrel Runner 2 on your wishlist at the prices we
  checked."
- strap fit: "Fits your Arden Field: both 20 mm with standard spring bars, from catalog specs."
- near duplicate: "Very close to your Vela Court Low, White / Gum: only the sole color differs."

The explanation joins the strongest relation, a short "It also works with your ..." for a second
item, the constraint fact ("Within your $150 limit at the prices we checked."), and a stale-price
warning when the price is old. With nothing owned to relate to (cold start), it states which of
the person's picked styles and liked colors the item has; when none apply, it says so instead of
inventing a reason. There are no percentages, outfit counts, wear-history claims or compatibility
claims beyond catalog specs, and only related items are ever named.

## Feedback

Feedback is stored per person and applies to the next request. Removing it sets `active: false`
and results return to what they were.

| Feedback | Effect |
| --- | --- |
| More like this | Boosts items sharing that product's style tags and palette |
| Not my style | Removes the product; items sharing its tags rank lower |
| Too similar | Removes the product; lookalikes of the item it was too similar to rank lower |
| Too expensive | A soft ceiling at that product's price in its category: items at or above it rank lower |
| Saved | No ranking effect |

The same feedback twice is one record, and opposite signals about one product ("More like this"
then "Not my style") keep only the newest.

## Discover feed

`recommend({ mode: 'feed' })` returns `{ requestId, generatedAt, coldStart, sections }`. With a
collection: "Goes with your collection" (matching), alternatives for up to three inspiration or
complement wishlist items, straps that fit each watch (up to two) whose catalog specs allow a fit claim, and
"More like your ..." for the latest item when it offers more than lookalikes. With no owned items
(`coldStart`), sections per profile category ranked only by the survey: styles, colors, uses and
budgets. A variant appears in one section only; wishlist sections claim their items first.

## Help me choose

`helpMeChoose` takes one to three of the person's wishlist items and returns the same facts for
each: price in the wanted size and condition, fit with the target (or the profile budget, which
it says it used), availability, pairings with owned items and close lookalikes already owned. The
summary only restates those facts ("At the prices we checked, the Kestrel Runner 2 fits its $150
target.", "The Ridge Trail is $18 over its $100 target at the prices we checked."). It never
ranks with a score or names a winner.

## Typed requests

`parseRequest` is rule based and runs offline. It reads category and type synonyms (kicks,
trainers, timepiece, tee, pants, trousers, strap), colors and groups ("earth tones" means olive,
khaki, tan, brown and rust; "neutral"), styles, uses ("for work"), materials, brands, conditions,
price phrases (under, below, less than, max, between X and Y, $X–$Y, around), sizes ("size 10",
"women's 8", "32x32", "size m", "20mm" for a strap or lug width, "40mm" for a case) and negation
("no white", "not too loud"). Words about the person's own item ("go with my navy jacket") become
a seed hint instead of constraints, and resolve only against that person's items: category, type
and brand must match, colors and name words rank the rest, near shades ("blue" for navy) are a
loose match marked `exact: false`, and a contradicting color never matches. Each understood piece
is a chip; `constraintsFromChips` rebuilds the constraints after the person removes or edits one.
Words that matched nothing come back in `unparsed`.

## Operations

| Operation | Notes |
| --- | --- |
| `recommend` | `mode` `similar`, `matching`, `alternatives` or `feed`; `seedIds` must be the actor's own items (others get `not_found`) or catalog variants; `text` is parsed and `interpretation` is added to the result. Stores a `recRequest`; metrics carry no user ids or free text. Rate limited (`recs`). |
| `helpMeChoose` | `wishlistIds`: one to three of the actor's items, otherwise `invalid`. Rate limited. |
| `giveFeedback`, `listFeedback`, `removeFeedback` | Feedback records; another person's ids are `not_found`. |
| `parseRequest` | Chips, constraints, unparsed words and resolved seeds. |

## What a production version would add

- **AI request interpretation constrained to the vocabulary.** A language model would map free
  text to the same chip schema (categories, types, colors, styles, prices, sizes, seed hints) and
  return only values from the catalog vocabulary and the person's own item ids. The chips stay the
  contract, so the person still sees and edits how the request was read, and the rule-based
  parser stays as the fallback and the test oracle.
- **AI explanation writing constrained to retrieved facts.** A model could make explanations read
  more naturally, given only the computed relations, prices and constraints for one result, with
  a check that every item named and every number in its output appears in those inputs. Anything
  that fails the check falls back to the deterministic sentence.
- **Better retrieval.** Image and text embeddings of catalog products for "similar" beyond tags
  and named colors, with the same hard constraints and explanations on top.
- **Learned ranking with guardrails.** Weights tuned from aggregate feedback and clicks, never
  from commission, evaluated offline before an admin applies them.
- **Real size and fit data.** Brand size charts and fit notes, still never inferred from a photo.
- **Fresh offers.** Retailer feeds with stock in each size, and freshness rules per retailer.
- **Evaluation.** A labeled set of collections and acceptable matches, tracked for grounding (every
  price real, every named item related), diversity and relaxation usefulness.
