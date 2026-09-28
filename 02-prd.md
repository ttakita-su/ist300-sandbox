# Product Requirements Document

## Free Bet Blackjack Strategy Trainer

| | |
| --- | --- |
| **Product** | Free Bet Blackjack Strategy Trainer |
| **Document owner** | Tomoyoshi |
| **Status** | Draft for review |
| **Last updated** | 22 September 2026 |
| **Target release** | V1, December 2026 |

---

## 1. Summary

A browser-based trainer that deals Free Bet Blackjack hands and grades every player decision against published optimal strategy.

Free play for the variant exists. Optimal strategy for it is published. Nothing currently connects the two. Players who want to learn Free Bet either read a static chart with no way to practise against it, or drill standard blackjack and try to remember the differences at the table.

V1 targets a single variant done correctly rather than several done approximately. The architecture separates the game module from the grading platform so additional variants become configuration rather than rebuilds.

---

## 2. Background

### 2.1 The problem

Learning a blackjack variant requires converting a strategy chart into decisions made at speed. That conversion needs repetitions against feedback. For standard blackjack, dozens of free tools provide exactly this. For variants, the tooling thins out sharply and, for Free Bet specifically, disappears.

The failure mode this creates is not ignorance but misapplication: players who know standard basic strategy apply it to a variant where several decisions differ, and have no mechanism to discover where they are wrong.

### 2.2 Competitive landscape

A survey of available tools was conducted on 17 September 2026.

| Game | Free play | Published strategy | Graded trainer |
| --- | --- | --- | --- |
| Standard blackjack | Extensive | Yes | Extensive |
| Spanish 21 | Yes | Yes | Yes — HitOrSplit |
| Mississippi Stud | Yes | Yes | Yes — Wizard of Odds, casinotrainer.net |
| Ultimate Texas Hold'em | Yes | Yes | Yes — dedicated product |
| Pai Gow Poker | Yes | House way only | Partial — teaches house way, not optimal |
| **Free Bet Blackjack** | **Yes** | **Yes** | **None found** |
| Blackjack Switch | Yes | Yes | None found |
| Zappit 21 | Yes | Yes | None found |
| Double Exposure | Yes | Yes | None found |

**Interpretation.** The gap is narrower than "niche games are underserved" but real. Several variants assumed to be underserved are in fact well covered. Free Bet Blackjack is the clearest verified gap among variants with an active player base.

**Counter-consideration.** One research participant plays Spanish 21, has the problem this product solves, and never located the existing Spanish 21 trainer. Part of the observed gap is discoverability rather than absence, which bounds how strongly a market claim can be made.

---

## 3. Users

### 3.1 Primary user

A recreational player who already knows standard basic strategy and wants to learn a variant before playing it for money. Practises at home, in sessions of roughly ten to thirty minutes, typically ahead of a planned casino visit.

### 3.2 Explicitly not targeted

| Segment | Why not |
| --- | --- |
| Blackjack beginners | Well served by existing standard-blackjack trainers |
| Advantage players | Card counting is a distinct skill with its own mature tooling |
| Online variant players | Different need — in-play reference, not pre-play drilling. See §7.2 |
| Recreational gamblers | The product teaches decisions; it is not a gambling product |

---

## 4. User research

Three participants, interviewed 17–22 September 2026. All three already knew standard basic strategy. Small sample; findings are directional.

### 4.1 Findings

**Players do not consult references at a physical table.** Two of three participants described making a decision under uncertainty and consulting a source only afterward. Both cited the same cause without prompting: other players waiting. One described asking the player beside him rather than checking his phone.

**Context is lost before review happens.** Both participants who reviewed a decision afterward reported being unable to recall the exact hand by the time they checked. The review therefore failed even when attempted.

**Information is available; practice is not.** Both had located a strategy chart and saved it. Neither had any means of practising against it. One asked specifically for randomly generated hands.

**The constraint is the venue, not the game.** The third participant plays online, where no other players are waiting, and does search for the correct play mid-hand. This bounds the first finding: the inhibitor is social, not informational.

### 4.2 What the research did not establish

No participant described tracking accuracy over time, drilling a specific situation deliberately, or checking table rules before sitting down. Requirements derived from those behaviours are marked as hypotheses in §6 and are scheduled after validation.

---

## 5. Goals

### 5.1 Product goals

1. A player who has never played Free Bet can complete a graded practice session without consulting any source outside the product.
2. Every decision is graded against a cited, verifiable strategy source.
3. A player can review any hand from a session without having remembered it.

### 5.2 Success metrics

| Metric | Target | How measured |
| --- | --- | --- |
| Session completion | A first-time user completes 20 hands without abandoning | Session log |
| Grading correctness | 100% agreement with the cited chart across a fixed 200-hand regression set | Automated test suite |
| Time to first hand | Under 60 seconds from landing to first decision | Manual timing |
| Unassisted accuracy improvement | Measurable improvement across three sessions for a returning user | Session summary |

### 5.3 Non-goals

Growth, retention, and monetisation are out of scope for V1. The product has no acquisition strategy and none is planned.

---

## 6. Requirements

### 6.1 Product decisions

| Area | Decision | Rationale |
| --- | --- | --- |
| Launch variant | Free Bet Blackjack | Only verified gap with an active player base |
| Platform | Responsive web, desktop and mobile browser | No install; matches where users already practise |
| Practice model | Randomly dealt hands, graded per decision | Directly requested in research |
| Feedback timing | Immediately after each decision, before the next deal | No social constraint in the practice context |
| Default rules | 6 decks · dealer hits soft 17 · dealer 22 pushes · free double on hard 9/10/11 · free split on all pairs except tens · blackjack pays 3:2 | Most common published configuration — **pending confirmation against the chosen strategy source** |
| Strategy source | One published Free Bet basic-strategy chart, cited in the repository | Grading correctness is bounded by source correctness |
| Authentication | None | Removes the largest barrier to a 60-second start |
| Persistence | Browser local storage | No backend required for V1 |
| Extensibility | Game logic and strategy data separated from the grading platform | Additional variants become configuration |

**Open dependency.** The strategy source is not yet selected. If the chosen chart assumes a rule set other than the default above, the default changes to match the chart. This blocks F2 and must be resolved before implementation begins.

### 6.2 Features

---

#### F1 · Hand engine · V1

Generates and resolves Free Bet Blackjack hands under the configured rule set.

**Functional requirements**
- Deals from a six-deck shoe; reshuffles when penetration exceeds 75%
- Applies free double on hard 9, 10 and 11
- Applies free split on all pairs except ten-value pairs
- Resolves a dealer total of 22 as a push against all non-busted hands
- Pays 3:2 on blackjack, 1:1 otherwise
- Offers hit, stand, double, split, and surrender where configured

**Constraints**
- Must not deal a card combination impossible in a real six-deck shoe
- Must not resolve any hand using standard blackjack payout rules

---

#### F2 · Decision grader · V1

Compares each player action against the strategy source and returns a verdict.

**Functional requirements**
- Resolves optimal play for the exact player total, hand composition and dealer upcard
- Returns a verdict and names the optimal action regardless of outcome
- Renders within 1 second of the action and before the next card is dealt
- Flags hands where the player requested the answer before acting, and excludes them from unassisted accuracy

**Constraints**
- Must report a gap rather than infer a verdict where the chart has no entry
- Must never return an incorrect verdict for an optimal action

**Depends on** the strategy source decision in §6.1.

---

#### F3 · Session log · V1

Records every hand for review after play.

**Functional requirements**
- Stores player cards, dealer upcard, dealer final total, action taken, optimal action, verdict, assisted flag, and timestamp
- Presents hands newest first, with misplays visually distinguished
- Persists across page refresh

**Constraints**
- Must not require re-entry of any card value to review a hand
- Must surface storage failure rather than presenting an empty history

**Addresses** the context-loss finding in §4.1.

---

#### F4 · Rule primer · V1

Explains how Free Bet differs from standard blackjack.

**Functional requirements**
- Displays the three rule differences before the first hand of a first session
- Remains reachable from a persistent control
- Pauses play and preserves hand state when opened mid-hand

**Constraints**
- Must not display automatically on return visits
- Must not deal a card while open

---

#### F5 · Session summary · V1.1 · hypothesis

Reports session performance.

**Validation status.** No research participant described tracking accuracy. This feature is scheduled after validation and is the designated cut if validation fails. Removing it does not affect V1.

**Functional requirements**
- Reports hands played, unassisted accuracy, assisted count, and most frequently misplayed situation type
- Reports raw counts rather than a percentage below ten unassisted hands

**Constraints**
- Must not present a percentage derived from fewer than ten hands
- Must not pool assisted and unassisted hands into a single figure

---

#### F6 · Decision rationale · V1.1

Explains why the optimal action is optimal.

**Functional requirements**
- Presents the expected value of both the optimal action and the action taken
- States that a decision is marginal where two actions fall within 0.1% EV

**Validation status.** Partially supported. One participant acted on a heuristic rather than understanding, which implies but does not establish the need.

---

#### F7 · Configurable house rules · V2 · hypothesis

Allows the rule set to be matched to a specific casino's table.

**Validation status.** Not supported by research. No participant described checking table rules. Deferred pending validation.

---

#### F8 · Additional variants · V2

Adds a second game module, Spanish 21 being the leading candidate.

Architecture supports this from V1; no implementation in V1.

---

### 6.3 Screens

| # | Screen | Purpose | Features |
| --- | --- | --- | --- |
| 1 | Start | Variant selection, rule primer, begin session | F4 |
| 2 | Table | Play, act, receive verdicts | F1, F2 |
| 3 | Summary | Session performance | F5 |
| 4 | Log | Hand-by-hand review | F3 |

Screens 3 and 4 may be implemented as one page with two views.

---

## 7. Scope

### 7.1 In scope for V1

F1 through F4, across screens 1, 2 and 4. The releasable increment is: read the rule differences, play randomly dealt hands under correct variant rules, receive a graded verdict on each decision, review the session afterward.

### 7.2 Out of scope, with rationale

| Excluded | Rationale |
| --- | --- |
| Live assistance at a physical table | Research finding — two of three participants will not consult any source mid-hand, both citing other players waiting. The product would be unused at the moment it was designed for |
| Browser extension for online play | Different delivery surface and a different purpose. It assists real-money play rather than training. Viable future direction; see §10 |
| Real-money play | Changes product category, legal exposure, and audience |
| Poker | No fixed optimal-play table; correct play depends on opponent modelling. Grading model does not apply |
| Games requiring a runtime solver | Connect 4, chess, checkers. Correct play must be computed per position rather than looked up, requiring a different engine |
| Card counting and count deviations | Distinct skill, mature existing tooling, limited applicability where continuous shufflers are used |
| Accounts, profiles, leaderboards | Contradicts the no-authentication decision. No research support |
| Bankroll simulation | Chips are displayed so free doubles are legible. No bankroll is tracked. The product teaches decisions, not money management |

---

## 8. Release plan

| Release | Contents | Gate |
| --- | --- | --- |
| **V1** | F1, F2, F3, F4 | A first-time user completes 20 graded hands and reviews the session, unaided |
| **V1.1** | F5, F6 | F5 conditional on validation |
| **V2** | F7, F8 | F7 conditional on validation |

---

## 9. V1 launch readiness

V1 ships when every item below is true. Anything unchecked is a blocker, not a nice-to-have — the list is deliberately short so that it stays honest.

### 9.1 Blocking before implementation

- [ ] Strategy source selected, cited, and stored in the repository with its assumed rule set recorded
- [ ] Default rule set in §6.1 confirmed against that source, or amended to match it
- [ ] Regression set of 200 hands with known-correct actions built from the source

### 9.2 Correctness

- [ ] Free double applies on hard 9, 10 and 11, and on no other total
- [ ] Free split applies on all pairs except ten-value pairs
- [ ] Dealer 22 pushes against every non-busted hand, and only against non-busted hands
- [ ] Blackjack pays 3:2; all other wins pay 1:1
- [ ] Shoe cannot produce a card combination impossible in six decks
- [ ] Grader agrees with the cited chart on all 200 regression hands
- [ ] Grader reports a gap rather than inferring a verdict where the chart has no entry
- [ ] No optimal action is ever returned as incorrect

### 9.3 Function

- [ ] A session can be started and a first decision made within 60 seconds of landing
- [ ] No account, email address, or payment detail is requested at any point
- [ ] Verdict renders within 1 second of the action and before the next card
- [ ] Assisted hands are flagged and excluded from unassisted accuracy
- [ ] Session log records all nine fields listed in F3 and survives a page refresh
- [ ] Any hand can be reviewed without re-entering a card value
- [ ] Storage failure is surfaced rather than presented as an empty history
- [ ] Rule primer displays on a first session, not on return visits, and never deals a card while open

### 9.4 Quality

- [ ] Usable on a phone browser in portrait
- [ ] Keyboard-operable end to end, with visible focus
- [ ] No real-money wager, deposit, or cash-out path exists anywhere in the product
- [ ] Automated test coverage on the hand engine and the grader

### 9.5 Acceptance

- [ ] A user who has never played Free Bet completes 20 graded hands unaided, without consulting any source outside the product
- [ ] The same user can then identify, from the log alone, which hands they misplayed

---

## 10. Future direction

**Online play.** The research indicates that the constraint on mid-hand reference is social rather than informational. Where no other players are waiting, users do consult sources during a hand. This suggests a distinct product for online variant players — in-play reference rather than pre-play drilling — on a different delivery surface. Not pursued in this product.

**Variant expansion.** Blackjack Switch, Zappit 21 and Double Exposure show the same profile as Free Bet: free play available, strategy published, no graded trainer. Each is configuration against the V1 platform rather than new engineering.

---

## 11. Dependencies

| Dependency | Blocks | Status |
| --- | --- | --- |
| Published Free Bet strategy chart, with its assumed rule set | F2, and the rule-set decision in §6.1 | Unresolved |
| Validation of F5 and F7 hypotheses | V1.1 and V2 scope | Unresolved |

---

## 12. Risks

| Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- |
| Strategy source incorrect or assumes a different rule set | Every verdict is wrong; the product actively teaches error | Medium | Cite the source; cross-check against a second; regression-test 200 known hands |
| Variant rules implemented incorrectly | Users drill the wrong strategy | Medium | Each rule tested in isolation against F1's constraints |
| Research sample of three | Requirements rest on a narrow base | High | Hypotheses labelled rather than presented as findings; conditional features scheduled after V1 |
| Discoverability, not absence, is the real gap | The product is built and never found | Medium | Accepted. No acquisition strategy in V1 |

---

## 13. Open questions

1. Which published Free Bet chart is authoritative, and what rule set does it assume? **Blocks implementation.**
2. Do the F5 and F7 hypotheses survive further research, or are they cut?
3. When the online player searches mid-hand, does he find variant-specific guidance or standard-blackjack advice? Unasked; would sharpen §10.
4. Does the grading model need to handle composition-dependent decisions, or is total-plus-upcard sufficient for this variant?
