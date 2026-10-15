// Runs the Game of Life program and its plain JavaScript version over the same events and compares every cell.
import {expect, test} from 'bun:test'
import {type LifeEvent, cellCount, createLifeMachine, grid, presets} from '../../src/life/life.ts'
import {createLifeReference} from '../../src/life/life-reference.ts'

function runBoth(events: readonly LifeEvent[]) {
  const machine = createLifeMachine()
  const reference = createLifeReference()
  for (const lifeEvent of events) {
    const output = machine.apply(lifeEvent)
    reference.apply(lifeEvent)
    expect(output.alive).toEqual(Array.from(reference.alive))
    expect([output.generation, output.population]).toEqual([reference.generation, reference.population])
  }
  return {machine, reference}
}

test('a glider moves one cell diagonally every 4 generations, across the wrapping edge', () => {
  const start = presets.empty()
  for (const [row, column] of [[0, 1], [1, 2], [2, 0], [2, 1], [2, 2]] as const) start[row * grid.columns + column] = 1
  const {machine} = runBoth([{kind: 'load', pattern: start}, ...Array<LifeEvent>(4 * grid.columns).fill({kind: 'step'})])
  // After 4 × 48 generations the glider has moved 48 cells right and 48 down: right around the torus and 16 rows down.
  const expected = new Array<number>(cellCount).fill(0)
  for (const [row, column] of [[0, 1], [1, 2], [2, 0], [2, 1], [2, 2]] as const) expected[(row + 48) % grid.rows * grid.columns + column] = 1
  expect(machine.output.alive).toEqual(expected)
  expect(machine.output.population).toBe(5)
})

test('every preset agrees with plain JavaScript for 120 generations', () => {
  for (const pattern of [presets.gun(), presets.pulsars(), presets.ships(), presets.bloom(), presets.soup(7)]) {
    runBoth([{kind: 'load', pattern}, ...Array<LifeEvent>(120).fill({kind: 'step'})])
  }
})

test('painting: a press flips the cell under it, a drag paints that value, a move without a press paints nothing', () => {
  const events: LifeEvent[] = [
    {kind: 'move', row: 3, column: 3},
    {kind: 'down', row: 5, column: 5},
    {kind: 'move', row: 5, column: 6},
    {kind: 'move', row: 5, column: 7},
    {kind: 'up'},
    {kind: 'move', row: 5, column: 8},
    // Erasing: a press on a live cell paints dead cells.
    {kind: 'down', row: 5, column: 6},
    {kind: 'move', row: 5, column: 7},
    {kind: 'up'},
  ]
  const {machine} = runBoth(events)
  const live = machine.output.alive.flatMap((bit, cell) => bit === 1 ? [cell] : [])
  expect(live).toEqual([5 * grid.columns + 5])
})

test('a random trace of steps, strokes and loads agrees with plain JavaScript on every cell at every event', () => {
  let seed = 12345
  const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32
  const events: LifeEvent[] = [{kind: 'load', pattern: presets.soup(3)}]
  for (let index = 0; index < 400; index++) {
    const roll = random()
    const row = Math.floor(random() * grid.rows)
    const column = Math.floor(random() * grid.columns)
    if (roll < 0.55) events.push({kind: 'step'})
    else if (roll < 0.7) events.push({kind: 'down', row, column})
    else if (roll < 0.9) events.push({kind: 'move', row, column})
    else if (roll < 0.98) events.push({kind: 'up'})
    else events.push({kind: 'load', pattern: presets.soup(index)})
  }
  runBoth(events)
})
