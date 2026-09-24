# Free Bet Blackjack Strategy Trainer — Lab 3 Backlog

**Course:** IST300 — Prompts to Products
**Lab:** Lab 3 — User Stories
**Date:** Sep 17, 2026

---

## MUST

### S1 — Drill random hands

**Story.** As someone who plays Free Bet Blackjack, I want to drill random hands from that variant, so that I practice the actual decisions instead of just re-reading a chart.

**Acceptance criteria**
- [ ] Given I start a session, When hands deal, Then each hand is randomly generated from a six-deck Free Bet shoe and includes the variant's free-double and free-split situations.
- [ ] Given I have played twenty hands, When I review them, Then no identical hand-plus-upcard combination repeated more than twice. *(negative)*
- [ ] Given a hand resolves, When the next deals, Then it requires no input beyond one action. *(negative — nothing between me and the next rep)*

**Evidence.** Interview 2, Sep 17 — "I wanted something that would actually give me random hands so I could practice. I couldn't find anything good, so I mostly just kept looking at the chart."

---

### S2 — Variant-accurate rules

**Story.** As someone who already knows regular blackjack, I want hands that follow Free Bet's real rules, so that I'm not drilling the wrong strategy.

**Acceptance criteria**
- [ ] Given I hold a hard 9, 10, or 11, When I double, Then no chips are deducted and it resolves as a free double.
- [ ] Given the dealer's final total is 22, When hands resolve, Then all non-busted player hands push.
- [ ] Given any decision is graded, When the verdict shows, Then it is checked against the Free Bet chart and never the standard blackjack chart. *(negative)*

**Evidence.** Interview 1, Sep 17 — "I just practiced normal blackjack and tried to remember what was different." Plus my own observed behavior: I play Free Bet and could not find a trainer for it.

---

### S3 — Graded decisions

**Story.** As someone unsure of a play, I want to be told the correct action and whether mine matched, so that the chart turns into something I actually know.

**Acceptance criteria**
- [ ] Given I act on a hand, When the verdict appears, Then it states correct or incorrect and names the optimal action.
- [ ] Given my action was optimal, When the verdict appears, Then no correction is shown. *(negative — no false flags)*
- [ ] Given I request the answer before acting, When it is shown, Then the hand is excluded from my unassisted accuracy. *(negative)*

**Evidence.** Interview 1, Sep 17 — "I looked it up later." Interview 2, Sep 17 — "I found a chart online and saved it on my phone." Both consult correct play; neither had a tool that graded them.

---

### S4 — Hand review with context preserved

**Story.** As someone who reviews a confusing hand afterward, I want the hand preserved with my decision, so that I can check it without remembering the cards.

**Acceptance criteria**
- [ ] Given a session ends, When I open the log, Then every hand shows my cards, the dealer upcard, my action, and the optimal action.
- [ ] Given I misplayed a hand, When the log displays, Then that entry is retrievable without me re-entering any card values. *(negative)*

**Evidence.** Interview 1, Sep 17 — "by the time I checked I was already starting to forget exactly what the hand was." Interview 2, Sep 17 — "I'll remember that I was confused and then forget exactly what cards I had."

---

### S5 — No account, no deposit

**Story.** As someone who wants to practice quickly, I want to start without an account or a deposit, so that a ten-minute session is actually ten minutes.

**Acceptance criteria**
- [ ] Given I land on the site, When I choose Free Bet, Then I can complete a hand with no signup and no payment details.
- [ ] Given I complete a session, When I review the flow, Then no real-money wager, deposit, or cash-out path appeared. *(negative)*

**Evidence.** My own observed behavior — I practice on free online simulators. Both interviewees used free web charts and videos rather than paid tools.

---

## SHOULD

### S6 — Explain why a play is correct

**Story.** As someone told a play was wrong, I want to know why, so that I can reason about hands the trainer never deals me.

**Acceptance criteria**
- [ ] Given a graded decision, When I request the reasoning, Then the expected value of both the optimal action and mine is shown.
- [ ] Given two actions are within 0.1% EV, When the reasoning displays, Then it states the decision is close rather than presenting one as clearly correct. *(negative)*

**Evidence.** Interview 1, Sep 17 — "I just went for it because it was free" — acted on a heuristic rather than understanding. Partial evidence only; neither interview asked for explanation directly.

---

### S7 — Session accuracy

**Story.** As someone drilling before a casino trip, I want to see my accuracy for the session, so that I know whether I'm ready.

**Acceptance criteria**
- [ ] Given a session of ten or more hands, When it ends, Then unassisted accuracy displays as a percentage with the hand count.
- [ ] Given fewer than ten hands, When the session ends, Then it reports the raw count rather than a percentage. *(negative — no trend from three hands)*

**Evidence.** MY OWN ASSUMPTION — not verified. Neither interviewee mentioned tracking accuracy.

---

### S8 — Targeted drills

**Story.** As someone who keeps misplaying one situation, I want to drill that situation on demand, so that I don't wait through fifty random hands.

**Acceptance criteria**
- [ ] Given I select "free double decisions," When hands deal, Then every hand presents that decision type.
- [ ] Given I am in a targeted drill, When the summary generates, Then it is labeled a drill and excluded from overall accuracy. *(negative)*

**Evidence.** MY OWN ASSUMPTION — extrapolated from both interviewees describing one specific confusing hand, but neither asked for this.

---

## COULD

### S9 — Configurable house rules

**Story.** As someone whose casino's table differs from the default, I want to set house rules, so that I'm drilling the game I'll actually play.

**Acceptance criteria**
- [ ] Given I set dealer-hits-soft-17, When hands deal, Then the dealer follows it and grading uses the matching chart.
- [ ] Given I change a rule mid-session, When it applies, Then prior stats are separated rather than blended. *(negative)*

**Evidence.** MY OWN ASSUMPTION — not verified. Neither interviewee mentioned checking house rules.

---

### S10 — Second variant

**Story.** As someone who also plays Spanish 21, I want a second variant available, so that I can drill both from one place.

**Acceptance criteria**
- [ ] Given a second module is installed, When I open the picker, Then both variants list with their own rule summaries.
- [ ] Given I switch variants, When stats load, Then accuracy reports per variant and never pools across them. *(negative)*

**Evidence.** Interview 2, Sep 17 — plays Spanish 21 and described the same problem. Weak as a feature request; they never asked for one tool covering both.

---

### S11 — Rule-difference summary

**Story.** As someone new to Free Bet, I want the rule differences summarized, so that I know what I'm drilling before I start.

**Acceptance criteria**
- [ ] Given my first session, When the game loads, Then free doubles, free splits, and the dealer-22 push are summarized before the first hand.
- [ ] Given I have played before, When I start, Then the summary does not auto-display. *(negative)*

**Evidence.** Interview 1, Sep 17 — "Free Bet has some different rules, so I looked up a strategy chart and watched a couple videos about it."

---

## WON'T (this semester)

**W1 — Live mid-hand assistance at the table.**
Cut on evidence, not scope. Both interviewees independently refused to consult anything mid-hand. Interview 1: "I didn't want to slow the table down." Interview 2: "it feels kind of awkward pulling your phone out while everyone is waiting." Building for a moment users will not use it in.

**W2 — Real money play.**
The job is learning correct play. Money changes the product category, the legal exposure, and the audience.

**W3 — Games requiring a runtime solver (Connect 4, chess, checkers).**
Correct play must be computed per position rather than looked up in a table. That is a different engine from the chart lookup this platform is built on.

**W4 — Poker (Hold'em, Omaha).**
No fixed optimal-play table; correct play depends on opponent modeling. Named as an interest in my brief, cut as scope.

**W5 — Card counting and count-based deviations.**
A separate skill from basic strategy, already well served by existing free trainers, and less useful in Free Bet specifically where continuous shufflers are common.

**W6 — Accounts, profiles, leaderboards.**
Directly contradicts S5, and no evidence from either interview that anyone wanted to compare scores.

---

## MVP SLICE

**S11 → S1 → S2 → S3**

Read the rule differences, drill random Free Bet hands under real variant rules, and get each decision graded against the Free Bet chart.

**End-to-end test.** Someone who knows regular blackjack opens the site, reads what is different, plays twenty random hands, sees a verdict on each, and finishes. No step requires saying "and then imagine it saves."

Note this slice is smaller than the Must column — S4 and S5 are Musts but are not in the slice.

---

## WHAT I COULDN'T WRITE

Nobody in either interview described wanting session stats, targeted drills, or house-rule configuration. S7, S8 and S9 are my own assumptions and are labeled as such rather than dressed up as findings.

The story I wanted and had no evidence for was a "pre-trip readiness check" — both interviewees practice before going to a casino, but neither described wanting to be told when they were ready.

I also drafted immediate mid-hand correction as the core feature of this product. Both interviews killed it: neither person will consult anything at a live table, and both gave the same reason. It is now W1. The gap they actually described was random practice hands at home, which is why S1 replaced it as the Must.

---

## RESEARCH NOTE

Existing tools were checked before writing this backlog. Free play for Free Bet Blackjack exists and optimal charts are published, but no trainer was found that grades decisions against Free Bet optimal play — while standard blackjack has dozens of graded trainers. Spanish 21 does have a free graded trainer (HitOrSplit), yet Interview 2 has the problem and never found it, which suggests discoverability is part of the gap and not only absence.