# Strategy reference and implementation bounds

Source: [Wizard of Odds — Free Bet Blackjack](https://wizardofodds.com/games/free-bet-blackjack/), checked 28 September 2026. The original-hand, free-hand, and pair charts are transcribed as decision data in `index.html`, separately from `Engine` and the interface.

Configuration: six decks, hit soft 17, 3:2 naturals, two-card doubles including after splits, free doubles on hard 9–11, free splits except tens, maximum four hands including resplit aces, no surrender, and dealer 22 pushes surviving non-natural hands. Split aces get one card, with resplitting permitted. Dealer peeks for blackjack; insurance and side bets are omitted.

The charts' surrender entries use their printed fallback (hit, or stand for RS). Five pairs double. Original and free-hand strategies are distinct. Where a recommended double or resplit is unavailable and no fallback is printed, grading returns a gap rather than inventing a recommendation. Composition-specific exceptions are not supplied by this source and are not claimed.

`tests.cjs` checks 200 fixed chart cases plus payouts, shoe composition, aces, and unsupported states. Run `node free-bet/tests.cjs`. These fixtures are manually transcribed from the same source, not an independent strategy audit. External user acceptance testing and an independent second-source cross-check remain outstanding; the PRD launch checklist is not declared complete.

The app is self-contained: open `index.html` in a browser, or serve the repository. Only completed rounds persist. An unfinished round resets after refresh. There is no bankroll, backend, account, or real-money transaction.
