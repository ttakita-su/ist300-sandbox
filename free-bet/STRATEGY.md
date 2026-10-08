# Strategy reference and implementation bounds

## Free Bet Blackjack

Source: [Wizard of Odds — Free Bet Blackjack](https://wizardofodds.com/games/free-bet-blackjack/), checked 28 September 2026. The original-hand, free-hand, and pair charts are transcribed as decision data in `extension/strategy.js`, separately from `Engine` and the interface. The trainer (`index.html`) and the Chrome extension's side panel both load that one file, so they cannot grade from different charts. The file also lists the table rules below as `Rules`, which the side panel prints beside every Free Bet answer.

Configuration: six decks, hit soft 17, 3:2 naturals, two-card doubles including after splits, free doubles on hard 9–11, free splits except tens, maximum four hands including resplit aces, no surrender, and dealer 22 pushes surviving non-natural hands. Split aces get one card, with resplitting permitted. Dealer peeks for blackjack; insurance and side bets are omitted.

The charts' surrender entries use their printed fallback (hit, or stand for RS). Five pairs double. Original and free-hand strategies are distinct. Where a recommended double or resplit is unavailable and no fallback is printed, grading returns a gap rather than inventing a recommendation. Composition-specific exceptions are not supplied by this source and are not claimed.

`tests.cjs` checks 200 fixed chart cases plus payouts, shoe composition, aces, and unsupported states. It also runs the trainer page's own scripts to confirm the trainer grades from `extension/strategy.js`, then plays seeded trainer rounds (random legal actions, plus a split-heavy batch) through the side panel and requires the panel to log exactly the decisions, plays and verdicts the trainer graded. `extension-tests.cjs` covers the panel's hand entry, routing, logging and manifest. Run `node free-bet/tests.cjs` for all of it. These fixtures are manually transcribed from the same source, not an independent strategy audit. External user acceptance testing and an independent second-source cross-check of the Free Bet charts remain outstanding; the PRD launch checklist is not declared complete.

The app is self-contained: open `index.html` in a browser, or serve the repository. Only completed rounds persist. An unfinished round resets after refresh. There is no bankroll, backend, account, or real-money transaction.

## Regular blackjack ("Blackjack" in the side panel)

The side panel also advises on a regular blackjack table; a switch at the top of its Advisor tab picks the game for each round. The chart is `Classic` in `extension/strategy.js` and its rules are `ClassicRules`. `Games` lists both games with each one's chart, rules, source and house edge, and the panel reads everything from there. The trainer (`index.html`) stays Free Bet only: it loads the same file but grades with `Strategy`, which the second game does not change.

Rules assumed: six decks; dealer hits soft 17 and peeks for blackjack; blackjack pays 3 to 2; double on any first two cards, after splits too; split any pair up to four hands, tens included (allowed, never advised); split aces get one card each unless it is another ace, which can be resplit; no surrender; no advice on insurance, even money or side bets.

Source: [Wizard of Odds, 4–8 deck basic strategy](https://wizardofodds.com/games/blackjack/strategy/4-decks/), the chart for a dealer who hits soft 17, checked 6 October 2026. It was checked three ways, cell by cell, and all three agree on every cell:

1. Wizard of Odds' own data: the chart image, the table in its [strategy calculator](https://wizardofodds.com/games/blackjack/strategy/calculator/), and the best play recomputed from its six-deck, hits-soft-17 expected values for every two-card hand ([Appendix 9](https://wizardofodds.com/games/blackjack/appendix/9/6dh17r4/)).
2. Independent charts: Ken Smith's [Blackjack Info strategy engine](https://www.blackjackinfo.com/blackjack-basic-strategy-engine/?numdecks=6&soft17=h17&dbl=all&das=yes&surr=ns&peek=yes) set to these rules, the [blackjack-strategy.co](https://blackjack-strategy.co/blackjack-strategy-chart/blackjack-strategy-card-6-decks-pays-3-to-2-hit-17/) six-deck card for the same rules, and Mike Aponte's multi-deck chart (its surrender cells read as their no-surrender plays).
3. A calculation: an exact six-deck card-removal analysis of the first decision, conditioned on the dealer not having blackjack, alongside an infinite-deck model.

Cells are stored as printed: `Dh` doubles, otherwise hits; `Ds` doubles, otherwise stands; `-` plays the pair as its total. `Classic.best` returns H, S, D or P and never a gap. On a hand of three or more cards, `Dh` is a hit and `Ds` a stand. A pair the chart doesn't split, or can't split because four hands are in play, plays its total: 5,5 is hard 10, 10,10 is hard 20, and A,A is soft 12, which hits. Split aces stand on their one card unless it is another ace. Nothing is free: no double or split is on the house, and the hand a split makes carries a bet equal to the first.

Close calls at six decks, in units of the first bet: soft 18 vs 2 doubles by 0.003 over standing; soft 13 vs 5 doubles by 0.003 over hitting (an infinite-deck chart hits it); hard 16 vs 10 hits by 0.005 for a two-card 16, while many 16s of three or more cards should stand, a composition exception this total-based chart does not show. Three cells depend on the dealer hitting soft 17: 11 vs A, soft 18 vs 2 and soft 19 vs 6 all double here, where a stands-on-soft-17 table would hit, stand and stand. Six pair cells depend on doubling after splits: 2,2 and 3,3 vs 2 and 3, 4,4 vs 5 and 6, and 6,6 vs 2 split here and hit without it.

House edge with this chart: about 0.6%. Wizard of Odds' [house edge calculator](https://wizardofodds.com/games/blackjack/calculator/) gives 0.57% for a cut-card shoe and 0.55% when the cards are reshuffled after every hand, and the six-deck calculation gives 0.54%.

`extension-tests.cjs` checks a fixture of every two-card hand against all ten upcards (410 cells, written out by hand from the verified chart), the fallbacks, every decision state of two and three cards (68,320, none a gap and every play one the table allows), and Blackjack's replay, routing and logging, including that the same events are regraded when the game changes.
