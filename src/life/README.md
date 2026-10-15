# Game of Life

Conway's Game of Life on a 48 × 32 torus as one numeric program. Each cell is one hand-wired neuron: with `s = 2 × neighbors + alive`, the rule is "s is within 5..7", which is `relu(s - 4) - relu(s - 5) - relu(s - 7) + relu(s - 8)`, exact for every whole `s`. Drawing with the pointer (a press reads the cell under it with one `indexRead`), stepping and loading a pattern are selects on each cell's next state. The program is 94,183 weights in 7 layers, about 0.5 ms per generation in Bun.

```sh
bun start                 # the demo site, with the page at /life/
bun test tests/life       # the program against plain JavaScript, on every cell at every event
```

| File | What it holds |
| --- | --- |
| `life.ts` | The cells, the builder code, the host and the patterns |
| `life-reference.ts` | The same board in plain JavaScript |
| `life-page.ts` | The page: the canvas, the controls and the network panel |
| [`assets/life.html`](../../assets/life.html) | The page, styled by [`assets/wired.css`](../../assets/wired.css) |
