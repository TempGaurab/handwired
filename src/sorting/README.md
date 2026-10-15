# Sorting chart

A bar chart that keeps itself sorted while you drag a bar, as one numeric program. The sort is `items.sort` without a loop: each of the 120 pairs of bars is compared once, a bar's rank counts the bars before it (ties by index, so the sort is stable), and its slot is its rank, or its mirror when the order is flipped. Heights are whole pixels, so each comparison is 2 operations and the sort is 3 layers. A press grabs the bar by where it's going, not where it's drawn, and changes nothing: the drag is relative, so the press stores the bar's value plus the pointer's y, and a move sets the value to that minus the new y. Each bar's x and height are springs, 32 in one `emitAnimatedObject`, with the template's host loop. The program is 2,920 weights in 38 layers.

```sh
bun start                 # the demo site, with the page at /sorting/
bun test tests/sorting    # decisions against plain JavaScript at every frame, and springs that land exactly on their slots
```

| File | What it holds |
| --- | --- |
| `sorting.ts` | The cells, the builder code and the host |
| `sorting-reference.ts` | The chart's decisions in plain JavaScript |
| `sorting-page.ts` | The page: the bars, the controls and the network panel |
| [`assets/sorting.html`](../../assets/sorting.html) | The page, styled by [`assets/wired.css`](../../assets/wired.css) |
