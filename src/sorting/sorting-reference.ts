// The decisions of sorting.ts in plain JavaScript: which bar a press grabs, the values, the order and the slots. The
// springs aren't here: tests/sorting checks that they come to rest exactly on these slots. Events that share a
// timestamp apply together in the program's order: the last press, the last move, any release, any flip (a flip
// flips once however many share the timestamp), then the last shuffle.
import {quantizeTimeMs} from '../runtime/host-timing.ts'
import {type SortingEvent, chart, ranksOf, startingValues} from './sorting.ts'

export function createSortingReference() {
  let values = [...startingValues]
  let grabbed = Array<number>(chart.bars).fill(0)
  let descending = 0
  let grabOffset = 0
  const slots = () => ranksOf(values, descending)

  function applyTogether(events: readonly SortingEvent[]) {
    type Pointer = Extract<SortingEvent, {x: number}>
    const down = events.findLast((item): item is Pointer => item.kind === 'down')
    const move = events.findLast((item): item is Pointer => item.kind === 'move')
    const shuffle = events.findLast((item): item is Extract<SortingEvent, {kind: 'shuffle'}> => item.kind === 'shuffle')
    if (down !== undefined) {
      const destinations = slots().map(slot => slot * chart.slot)
      grabbed = destinations.map(left => down.x >= left && down.x < left + chart.slot && down.y >= 0 && down.y <= chart.height ? 1 : 0)
      grabOffset = values.reduce((sum, value, bar) => sum + grabbed[bar]! * value, 0) + down.y
    }
    const moveValue = (y: number) => Math.min(chart.maximum, Math.max(chart.minimum, grabOffset - y))
    if (move !== undefined) values = values.map((value, bar) => grabbed[bar] === 1 ? moveValue(move.y) : value)
    if (events.some(item => item.kind === 'up')) grabbed = grabbed.map(() => 0)
    if (events.some(item => item.kind === 'flip')) descending = 1 - descending
    if (shuffle !== undefined) values = [...shuffle.values]
  }

  return {
    get state() {
      return {values, grabbed, descending, slots: slots()}
    },
    apply(events: readonly SortingEvent[]) {
      for (let start = 0; start < events.length;) {
        const timeMs = quantizeTimeMs(events[start]!.timeStamp)
        let end = start + 1
        while (end < events.length && quantizeTimeMs(events[end]!.timeStamp) === timeMs) end++
        applyTogether(events.slice(start, end))
        start = end
      }
    },
  }
}
