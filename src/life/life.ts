// Conway's Game of Life on a 48 × 32 torus, as one numeric program. Every cell's rule is a hand-wired neuron:
//
//   JS: next = alive ? (neighbors === 2 || neighbors === 3) : neighbors === 3
//
// With s = 2 × neighbors + alive, a live cell survives at s = 5 or 7 and a dead one is born at s = 6, so the rule is
// "s is within 5..7", which for an integer s is the difference of two ReLU steps:
//
//   next = relu(s - 4) - relu(s - 5) - (relu(s - 7) - relu(s - 8))
//
// That's one layer of 4 ReLUs reading 9 cells with weights 2 and 1, then a weighted sum: a convolution with a 3 × 3
// kernel and a fixed activation, 1,536 times. Painting with the pointer and loading a pattern are selects on top.
// life-reference.ts is the same board in plain JavaScript, and tests/life compares the two.
import {type Wire, emitCompare, emitMinimum} from '../runtime/numeric-ui-core.ts'
import {type WireValues, createEvaluator, createSourceTable, event, input, inputBit, list, state, stateBit} from '../runtime/cells.ts'

export const grid = {columns: 48, rows: 32} as const
export const cellCount = grid.columns * grid.rows
// The generation counter stops at 2^23, where FP32 still holds every integer and its sums with 1 exactly.
export const generationLimit = 2 ** 23

export const lifeCells = {
  alive: list(cellCount, () => stateBit()),
  // One generation.
  step: event(),
  // A press paints the cell under it with the opposite of its value, and a move while pressed paints that same value,
  // so a drag draws a line or erases one. The host sends at most one of the three per evaluation.
  down: event(),
  move: event(),
  up: event(),
  row: input([0, grid.rows - 1], {grid: 1}),
  column: input([0, grid.columns - 1], {grid: 1}),
  painting: stateBit(),
  paintValue: stateBit(),
  // Replaces the board with `pattern`, e.g. a preset, a random soup or an empty board.
  load: event(),
  pattern: list(cellCount, () => inputBit()),
  generation: state([0, generationLimit], {grid: 1}),
}

export function buildLife() {
  const table = createSourceTable()
  const cells = table.declare(lifeCells)
  table.atMostOne('pointer events', [cells.down, cells.move, cells.up])
  const circuit = table.createCircuit()
  const relu = (terms: readonly (readonly [Wire, number])[], bias = 0) => circuit.reglu([], 1, terms, bias)

  // Pointer. JS: if (down) paintValue = !alive[row][column]
  const index = circuit.affine([[cells.row, grid.columns], [cells.column, 1]])
  circuit.assumeRange(index, 0, cellCount - 1)
  const underPointer = circuit.indexRead(index, cells.alive)
  const paintValue = circuit.affine([[relu([[cells.paintValue, 1], [cells.down, -1]]), 1], [relu([[cells.down, 1], [underPointer, -1]]), 1]])
  // JS: painting = down || (painting && !up)
  const painting = circuit.affine([[cells.down, 1], [relu([[cells.painting, 1], [cells.down, -1], [cells.up, -1]]), 1]])
  // JS: paints = down || (move && painting)
  const paints = circuit.affine([[cells.down, 1], [relu([[cells.move, 1], [cells.painting, 1]], -1), 1]])
  // JS: row === r and column === c, one comparison per row and per column rather than one per cell, then the
  // column's bit already ANDed with `paints`.
  const onRow = Array.from({length: grid.rows}, (_, row) => emitCompare(circuit, cells.row, '===', circuit.constant(row)))
  const onColumn = Array.from({length: grid.columns}, (_, column) =>
    relu([[emitCompare(circuit, cells.column, '===', circuit.constant(column)), 1], [paints, 1]], -1))

  const wrap = (value: number, count: number) => (value + count) % count
  const alive = cells.alive.map((self, cell) => {
    const row = Math.floor(cell / grid.columns)
    const column = cell % grid.columns
    // s = 2 × neighbors + self, the neuron's input: a 3 × 3 kernel of weights 2 around a center of 1.
    const s: [Wire, number][] = [[self, 1]]
    for (const dy of [-1, 0, 1]) {
      for (const dx of [-1, 0, 1]) {
        if (dx !== 0 || dy !== 0) s.push([cells.alive[wrap(row + dy, grid.rows) * grid.columns + wrap(column + dx, grid.columns)]!, 2])
      }
    }
    // JS: s >= 5 && s <= 7, as relu(s - 4) - relu(s - 5) - relu(s - 7) + relu(s - 8)
    const life = circuit.affine([[relu(s, -4), 1], [relu(s, -5), -1], [relu(s, -7), -1], [relu(s, -8), 1]])
    // JS: if (step) alive = life
    const stepped = circuit.affine([[relu([[life, 1], [cells.step, 1]], -1), 1], [relu([[self, 1], [cells.step, -1]]), 1]])
    // JS: if (paints && row === pointerRow && column === pointerColumn) alive = paintValue
    const hit = relu([[onRow[row]!, 1], [onColumn[column]!, 1]], -1)
    const painted = circuit.affine([[relu([[stepped, 1], [hit, -1]]), 1], [relu([[paintValue, 1], [hit, 1]], -1), 1]])
    // JS: if (load) alive = pattern[cell]
    return circuit.affine([[relu([[painted, 1], [cells.load, -1]]), 1], [relu([[cells.pattern[cell]!, 1], [cells.load, 1]], -1), 1]])
  })

  // JS: generation = load ? 0 : Math.min(generationLimit, generation + step)
  const generation = emitMinimum(circuit,
    relu([[cells.generation, 1], [cells.step, 1], [cells.load, -2 * generationLimit]]),
    circuit.constant(generationLimit))
  table.next(cells.alive, alive)
  table.next(cells.painting, painting)
  table.next(cells.paintValue, paintValue)
  table.next(cells.generation, generation)
  const population = circuit.affine(alive.map(wire => [wire, 1] as const))
  const output = {alive, population, generation}
  return {cells, output, ...table.finish()}
}

export type LifeEvent =
  | {kind: 'step'}
  | {kind: 'down' | 'move', row: number, column: number}
  | {kind: 'up'}
  | {kind: 'load', pattern: ArrayLike<number>}
export type LifeOutput = WireValues<ReturnType<typeof buildLife>['output']>

// The host: each event is one evaluation, whose next values are written back.
export function createLifeMachine() {
  const built = buildLife()
  const {cells} = built
  const evaluate = createEvaluator(built)
  const source = new Float32Array(built.initialSource)
  // The table as the latest evaluation read it, events included, for the network panel to evaluate again.
  const evaluated = new Float32Array(source)
  let latest = evaluate(source).output
  return {
    built,
    source,
    evaluated,
    get output() {
      return latest
    },
    apply(lifeEvent: LifeEvent): LifeOutput {
      if (lifeEvent.kind === 'load') {
        cells.pattern.forEach((wire, cell) => { source[wire] = lifeEvent.pattern[cell]! })
        source[cells.load] = 1
      } else if (lifeEvent.kind === 'down' || lifeEvent.kind === 'move') {
        source[cells[lifeEvent.kind]] = 1
        source[cells.row] = lifeEvent.row
        source[cells.column] = lifeEvent.column
      } else {
        source[cells[lifeEvent.kind]] = 1
      }
      evaluated.set(source)
      const result = evaluate(source)
      source.set(result.nextValues)
      latest = result.output
      return latest
    },
  }
}

// Patterns written as rows of "." and "O", placed with their top left corner at (row, column) on an empty board.
export type Stamp = {rows: readonly string[], row: number, column: number}
export function patternFromStamps(stamps: readonly Stamp[]): Uint8Array {
  const pattern = new Uint8Array(cellCount)
  for (const {rows, row, column} of stamps) {
    rows.forEach((line, dy) => {
      for (let dx = 0; dx < line.length; dx++) {
        if (line[dx] === 'O') pattern[((row + dy) % grid.rows) * grid.columns + (column + dx) % grid.columns] = 1
      }
    })
  }
  return pattern
}

const gosperGun = [
  '........................O...........',
  '......................O.O...........',
  '............OO......OO............OO',
  '...........O...O....OO............OO',
  'OO........O.....O...OO..............',
  'OO........O...O.OO....O.O...........',
  '..........O.....O.......O...........',
  '...........O...O....................',
  '............OO......................',
]
const pulsar = [
  '..OOO...OOO..',
  '.............',
  'O....O.O....O',
  'O....O.O....O',
  'O....O.O....O',
  '..OOO...OOO..',
  '.............',
  '..OOO...OOO..',
  'O....O.O....O',
  'O....O.O....O',
  'O....O.O....O',
  '.............',
  '..OOO...OOO..',
]
const glider = ['.O.', '..O', 'OOO']
const lightweightShip = ['.O..O', 'O....', 'O...O', 'OOOO.']
const rPentomino = ['.OO', 'OO.', '.O.']

export const presets = {
  gun: () => patternFromStamps([{rows: gosperGun, row: 2, column: 2}]),
  pulsars: () => patternFromStamps([{rows: pulsar, row: 2, column: 4}, {rows: pulsar, row: 2, column: 30}, {rows: pulsar, row: 17, column: 17}]),
  ships: () => patternFromStamps([
    {rows: glider, row: 2, column: 2}, {rows: glider, row: 8, column: 12}, {rows: glider, row: 20, column: 6},
    {rows: lightweightShip, row: 4, column: 30}, {rows: lightweightShip, row: 14, column: 22}, {rows: lightweightShip, row: 24, column: 36},
  ]),
  bloom: () => patternFromStamps([{rows: rPentomino, row: 14, column: 22}]),
  // A seeded soup, about one cell in three alive, from a small linear congruential generator.
  soup: (seed: number) => {
    const pattern = new Uint8Array(cellCount)
    let state = seed >>> 0
    for (let cell = 0; cell < cellCount; cell++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      pattern[cell] = state / 2 ** 32 < 0.33 ? 1 : 0
    }
    return pattern
  },
  empty: () => new Uint8Array(cellCount),
}
