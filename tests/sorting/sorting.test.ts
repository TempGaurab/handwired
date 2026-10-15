// Runs the sorting chart's program and its plain JavaScript decisions over the same frames and compares them.
import {expect, test} from 'bun:test'
import {type SortingEvent, chart, createSortingMachine, ranksOf, startingValues} from '../../src/sorting/sorting.ts'
import {createSortingReference} from '../../src/sorting/sorting-reference.ts'

function compare(machine: ReturnType<typeof createSortingMachine>, reference: ReturnType<typeof createSortingReference>) {
  const {bars, descending} = machine.output
  const expected = reference.state
  expect(bars.map(bar => bar.value)).toEqual(expected.values)
  expect(bars.map(bar => bar.grabbed)).toEqual(expected.grabbed)
  expect(bars.map(bar => bar.slot)).toEqual(expected.slots)
  expect(descending).toBe(expected.descending)
}

test('the chart starts sorted and at rest', () => {
  const machine = createSortingMachine()
  const output = machine.step(1000)
  expect(output.bars.map(bar => bar.slot)).toEqual(ranksOf(startingValues))
  expect(output.bars.map(bar => bar.x)).toEqual(ranksOf(startingValues).map(rank => rank * chart.slot))
  expect(output.bars.map(bar => bar.height)).toEqual(startingValues)
  expect(machine.clock.animatedUntilMs).toBeNull()
})

test('repeated clicks on a bar leave its value alone', () => {
  const machine = createSortingMachine()
  const before = machine.step(1000).bars.map(bar => bar.value)
  let time = 1000
  for (let click = 0; click < 5; click++) {
    machine.queue({kind: 'down', x: (chart.bars - 1) * chart.slot + 10, y: 250, timeStamp: time + 4})
    machine.queue({kind: 'up', timeStamp: time + 8})
    machine.step(time += 16)
  }
  expect(machine.output.bars.map(bar => bar.value)).toEqual(before)
})

test('a drag changes the grabbed bar, which moves to its new rank while still held, then everything settles exactly', () => {
  const machine = createSortingMachine()
  const reference = createSortingReference()
  // The tallest bar, 250, sits in the last slot. Press inside it, which changes nothing, then drag it down 300 px,
  // past the floor.
  const lastSlotX = (chart.bars - 1) * chart.slot + 10
  const frames: SortingEvent[][] = [
    [{kind: 'down', x: lastSlotX, y: 100, timeStamp: 1013}],
    [{kind: 'move', x: lastSlotX, y: 200, timeStamp: 1029}],
    [{kind: 'move', x: 5, y: 400, timeStamp: 1045}],
    [{kind: 'up', timeStamp: 1061}],
  ]
  let time = 1000
  const dragged = startingValues.indexOf(250)
  const draggedValues: number[] = []
  for (const events of frames) {
    time += 16
    for (const item of events) machine.queue(item)
    machine.step(time)
    reference.apply(events)
    compare(machine, reference)
    draggedValues.push(machine.output.bars[dragged]!.value)
  }
  // The press keeps 250, 100 px down gives 150, and 300 px down clamps at the minimum.
  expect(draggedValues).toEqual([250, 150, chart.minimum, chart.minimum])
  expect(machine.output.bars[dragged]!.value).toBe(chart.minimum)
  expect(machine.output.bars[dragged]!.slot).toBe(0)
  expect(machine.clock.animatedUntilMs).not.toBeNull()
  for (let frame = 0; frame < 300 && machine.clock.animatedUntilMs !== null; frame++) machine.step(time += 16)
  expect(machine.clock.animatedUntilMs).toBeNull()
  for (const bar of machine.output.bars) {
    expect(bar.x).toBe(bar.slot * chart.slot)
    expect(bar.height).toBe(bar.value)
  }
})

test('a random trace of presses, drags, releases, flips and shuffles agrees with plain JavaScript at every frame', () => {
  const machine = createSortingMachine()
  const reference = createSortingReference()
  let seed = 99
  const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32
  const integer = (low: number, high: number) => low + Math.floor(random() * (high - low + 1))
  let time = 1000
  for (let frame = 0; frame < 600; frame++) {
    time += 16
    const events: SortingEvent[] = []
    const count = integer(0, 3)
    for (let index = 0; index < count; index++) {
      // Some events share a timestamp, to check the order within one evaluation.
      const timeStamp = time - integer(1, 3) * 4
      const roll = random()
      if (roll < 0.25) events.push({kind: 'down', x: integer(-20, 600), y: integer(-20, 300), timeStamp})
      else if (roll < 0.7) events.push({kind: 'move', x: integer(-20, 600), y: integer(-40, 320), timeStamp})
      else if (roll < 0.85) events.push({kind: 'up', timeStamp})
      else if (roll < 0.93) events.push({kind: 'flip', timeStamp})
      else events.push({kind: 'shuffle', values: Array.from({length: chart.bars}, () => integer(chart.minimum, chart.maximum)), timeStamp})
    }
    events.sort((a, b) => a.timeStamp - b.timeStamp)
    for (const item of events) machine.queue(item)
    machine.step(time)
    reference.apply(events)
    compare(machine, reference)
    for (const bar of machine.output.bars) {
      expect(Number.isFinite(bar.x) && Number.isFinite(bar.height)).toBe(true)
    }
  }
  for (let frame = 0; frame < 400 && machine.clock.animatedUntilMs !== null; frame++) machine.step(time += 16)
  expect(machine.clock.animatedUntilMs).toBeNull()
  for (const bar of machine.output.bars) expect([bar.x, bar.height]).toEqual([bar.slot * chart.slot, bar.value])
})

test('equal values keep their order by bar, ascending and descending', () => {
  const machine = createSortingMachine()
  const reference = createSortingReference()
  const values = Array.from({length: chart.bars}, (_, bar) => [50, 50, 120, 50][bar % 4]!)
  const events: SortingEvent[][] = [[{kind: 'shuffle', values, timeStamp: 1010}], [{kind: 'flip', timeStamp: 1030}]]
  let time = 1000
  for (const frame of events) {
    for (const item of frame) machine.queue(item)
    machine.step(time += 32)
    reference.apply(frame)
    compare(machine, reference)
  }
})
