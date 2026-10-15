# Tic-tac-toe

Tic-tac-toe against a network that never loses, as one numeric program. In the evaluation of your move, the program checks the board, scores every square for O with Newell and Simon's rules (win, block, fork, stop your fork, center, opposite corner, corner, side), each rule a few ReLUs over line counts, and plays the best square through `emitArgmax`. "Stop your fork" picks a safe attack, one whose forced answer isn't a fork square for you, when you threaten two forks, e.g. after X takes opposite corners. The program is 2,247 weights in 47 layers.

```sh
bun start                     # the demo site, with the page at /tic-tac-toe/
bun test tests/tic-tac-toe    # every game, from both starts: 597 games, none lost, program equal to plain JavaScript
```

| File | What it holds |
| --- | --- |
| `tic-tac-toe.ts` | The rules and their weights, the cells, the builder code and the host |
| `tic-tac-toe-reference.ts` | The same game and strategy in plain JavaScript |
| `tic-tac-toe-page.ts` | The page: the board, the tally, the rule list and the network panel |
| [`assets/tic-tac-toe.html`](../../assets/tic-tac-toe.html) | The page, styled by [`assets/wired.css`](../../assets/wired.css) |
