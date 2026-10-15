# Matching evaluation (synthetic)

Generated 2026-10-15T03:31:35.845Z by `npm run eval` (seed 1). Catalog 2026-10-14.2, illustrations flat-2026-10-14.1, matcher match-2026-10-14.1.

**What this measures.** Every photo here is synthetic: a catalog illustration staged on a surface with light falloff, a color cast and noise, then put through the same steps as an upload (re-encode, processing copy, on-device features, matcher). It checks that the pipeline finds the right product, refuses to guess between versions a photo can't separate, and abstains on items the catalog doesn't have. It is not a measure of accuracy on real photos of real products, which would need the held-out photo set described in docs/PLAN.md (milestone 1).

## In-catalog photos (39)

| Measure | Result |
| --- | --- |
| Right product as the match | 33 of 39 (85%) |
| Right product among the first three | 38 of 39 (97%) |
| Exact version settled by the photo alone | 21 of 39 (54%) |
| Version left open, code asked for (versions that look alike) | 12 of 39 (31%) |
| Wrong version settled | 0 of 39 (0%) |
| No match claimed (abstained) | 6 of 39 (15%) |

| Category | Photos | Product | In top 3 | Exact version | Version left open | Wrong version | Abstained |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sneaker | 11 | 10 of 11 (91%) | 11 of 11 (100%) | 5 of 11 (46%) | 5 of 11 (46%) | 0 of 11 (0%) | 1 of 11 (9%) |
| watch | 16 | 15 of 16 (94%) | 16 of 16 (100%) | 8 of 16 (50%) | 7 of 16 (44%) | 0 of 16 (0%) | 1 of 16 (6%) |
| clothing | 12 | 8 of 12 (67%) | 11 of 12 (92%) | 8 of 12 (67%) | 0 of 12 (0%) | 0 of 12 (0%) | 4 of 12 (33%) |

No wrong version was settled.

In-catalog photos without a match claim:

- `arden-field--af40-sl-bk`: shown as similar, closest product `arden-field`
- `harbor-pine-deck-jacket--navy`: shown as similar, closest product `harbor-pine-deck-jacket`
- `kestrel-runner-2--olive-sail`: no match, closest product `kestrel-runner-2`
- `wrenfield-chore-jacket--khaki`: no match, no item separated from the surface or nothing close
- `wrenfield-chore-jacket--navy`: shown as similar, closest product `wrenfield-chore-jacket`
- `harbor-pine-deck-jacket--navy`: shown as similar, closest product `harbor-pine-deck-jacket`

## Items the catalog doesn't have (12)

| Measure | Result |
| --- | --- |
| Abstained (no match claimed) | 12 of 12 (100%) |
| Shown only as similar products | 1 of 12 (8%) |
| Wrongly claimed as a match | 0 of 12 (0%) |

## Latency

Feature extraction and matching on the processing copy: p50 14 ms, p95 26 ms (headless Chromium on the machine that ran the evaluation).

## Notes

- Synthetic: every photo is the catalog’s own illustration staged on a surface with light falloff, a color cast and noise. It measures this pipeline, not accuracy on real photos of real products.
- Out-of-catalog items are made-up color combinations on catalog silhouettes, at least 25 apart in color from every version of that silhouette.
- Some catalog products look alike in a photo (the navy Harbor & Pine Deck Field Jacket and the navy Wrenfield Chore Jacket). The matcher shows both as similar and asks for a label instead of claiming one, so those photos count as abstained here; that is the intended answer.
- A version counts as exact only when the photo alone settled it. When versions look alike (Olive / Bone and Olive / Sail, 38 and 40 mm), the matcher leaves the version open and asks for a code; that is counted separately and is the intended answer.
- Latency covers feature extraction and matching on the processing copy, not rendering the synthetic photo.
