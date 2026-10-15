// A bar chart that keeps itself sorted, as one numeric program. Drag a bar up or down to change its value, and every
// bar springs to its place in sorted order while you drag. The sort is items.sort(compare) without a loop: each pair
// of bars is compared once, a bar's rank is the number of bars that come before it, and its slot is that rank. With
// whole-number values every comparison is 2 operations, so the whole sort is 3 layers deep. sorting-reference.ts is
// the same chart's decisions in plain JavaScript, and tests/sorting compares the two.
import {type Wire, emitAnimatedObject, emitClampExact, emitCompare, emitSelect} from '../runtime/numeric-ui-core.ts'
import {type WriteBack, advanceFrame, defaultSpringClockConfig, springMatrixBound, springMatrixPower, springStepMatrix, stoppedSpringClock} from '../runtime/host-timing.ts'
import {type WireValues, createEvaluator, createSourceTable, event, input, inputBit, list, state, stateBit} from '../runtime/cells.ts'

export const chart = {bars: 16, slot: 36, barWidth: 26, height: 280, minimum: 12, maximum: 260} as const
export const chartWidth = chart.bars * chart.slot
export const springConstants = {stiffness: 420, damping: 38}
const matrixBound = springMatrixBound(springConstants)
const matrixEntry = input([-matrixBound, matrixBound])
// Pointer coordinates in px from the chart's top left corner, rounded by the host to whole px.
const coordinate = () => input([-4096, 4096], {grid: 1})

// The starting values, and the slots they sort into, so that the chart starts at rest.
export const startingValues = [140, 60, 210, 96, 180, 32, 250, 120, 74, 160, 44, 230, 108, 196, 20, 150]
export function ranksOf(values: readonly number[], descending = 0) {
  const ranks = values.map((value, index) => values.filter((other, otherIndex) => other < value || (other === value && otherIndex < index)).length)
  return descending === 1 ? ranks.map(rank => chart.bars - 1 - rank) : ranks
}
const startingRanks = ranksOf(startingValues)
const travel = chartWidth
const spring = (initial: number, range: readonly [number, number], grid?: number) => ({
  displacement: state([-2 * travel, 2 * travel]),
  velocity: state([-64 * travel, 64 * travel]),
  destination: state(range, grid === undefined ? {initial} : {initial, grid}),
})

export const sortingCells = {
  values: list(chart.bars, index => state([chart.minimum, chart.maximum], {grid: 1, initial: startingValues[index]!})),
  grabbed: list(chart.bars, () => stateBit()),
  descending: stateBit(),
  // A drag is relative: the press stores the grabbed bar's value plus the pointer's y, and a move sets the value to
  // that minus the new y, so a press alone changes nothing and the bar's top moves with the pointer.
  grabOffset: state([-4096, 4096 + chart.maximum], {grid: 1}),
  down: {active: event(), x: coordinate(), y: coordinate()},
  move: {active: event(), x: coordinate(), y: coordinate()},
  up: event(),
  flip: event(),
  // New values for every bar, which the host draws when the shuffle button is pressed.
  shuffle: event(),
  shuffled: list(chart.bars, () => input([chart.minimum, chart.maximum], {grid: 1, initial: chart.minimum})),
  springMatrix: [matrixEntry, matrixEntry, matrixEntry, matrixEntry] as const,
  settleCheck: inputBit(),
  snap: inputBit(),
  bars: list(chart.bars, index => ({
    x: spring(startingRanks[index]! * chart.slot, [0, (chart.bars - 1) * chart.slot], 1),
    height: spring(startingValues[index]!, [chart.minimum, chart.maximum], 1),
  })),
}

export function buildSorting() {
  const table = createSourceTable()
  const cells = table.declare(sortingCells)
  table.atMostOne('grabbed bars', cells.grabbed)
  const circuit = table.createCircuit()
  type Terms = readonly (readonly [Wire, number])[]
  const relu = (terms: Terms, bias = 0) => circuit.reglu([], 1, terms, bias)
  const and = (...bits: Wire[]) => relu(bits.map(wire => [wire, 1] as const), 1 - bits.length)
  const onGrid = (wire: Wire) => {
    circuit.assumeGrid(wire, 1)
    return wire
  }

  // A press grabs the bar whose slot it lands in, hit-testing where bars are going rather than where they're drawn,
  // so a press during an animation grabs the bar that will be there.
  const insideY = and(emitCompare(circuit, cells.down.y, '>=', circuit.constant(0)), emitCompare(circuit, cells.down.y, '<=', circuit.constant(chart.height)))
  const hits = cells.bars.map(bar => and(
    emitCompare(circuit, cells.down.x, '>=', bar.x.destination),
    emitCompare(circuit, cells.down.x, '<', circuit.affine([[bar.x.destination, 1]], chart.slot)),
    insideY,
  ))
  // JS: if (down) grabbed = hit
  const grabbedAfterDown = cells.grabbed.map((grabbed, bar) =>
    circuit.affine([[relu([[grabbed, 1], [cells.down.active, -1]]), 1], [relu([[hits[bar]!, 1], [cells.down.active, 1]], -1), 1]]))
  // JS: if (down) grabOffset = (the hit bar's value, or 0) + down.y. Bars sit in distinct slots, so at most one hit
  // is 1, and the sum of hit × value is that bar's value.
  const hitValue = onGrid(circuit.affine(hits.map((hit, bar) => [circuit.multiply(hit, cells.values[bar]!), 1] as const)))
  const grabOffset = onGrid(emitSelect(circuit, cells.down.active, cells.grabOffset, onGrid(circuit.affine([[hitValue, 1], [cells.down.y, 1]]))))
  // JS: Math.min(maximum, Math.max(minimum, grabOffset - move.y)), the value the pointer at move.y gives the bar.
  const moveValue = onGrid(emitClampExact(circuit, onGrid(circuit.roundAffine([[grabOffset, 1], [cells.move.y, -1]])),
    circuit.constant(chart.minimum), circuit.constant(chart.maximum)))
  const values = cells.values.map((value, bar) => {
    // JS: if (grabbed && move) value = moveValue
    const dragged = onGrid(emitSelect(circuit, and(grabbedAfterDown[bar]!, cells.move.active), value, moveValue))
    // JS: if (shuffle) value = shuffled[bar]
    return onGrid(emitSelect(circuit, cells.shuffle, dragged, cells.shuffled[bar]!))
  })
  // JS: if (up) grabbed = false
  const grabbed = grabbedAfterDown.map(wire => relu([[wire, 1], [cells.up, -1]]))
  // JS: if (flip) descending = !descending, as a + b - 2 × (a AND b)
  const descending = circuit.affine([[cells.descending, 1], [cells.flip, 1], [and(cells.descending, cells.flip), -2]])

  // The sort. JS: rank[i] = values.filter((v, j) => v < values[i] || (v === values[i] && j < i)).length
  // Each pair i < j is compared once: [values[j] < values[i]] counts for i, and its complement for j.
  const rankTerms: [Wire, number][][] = values.map(() => [])
  const rankBias = values.map(() => 0)
  for (let i = 0; i < chart.bars; i++) {
    for (let j = i + 1; j < chart.bars; j++) {
      const jBeforeI = emitCompare(circuit, values[j]!, '<', values[i]!)
      rankTerms[i]!.push([jBeforeI, 1])
      rankTerms[j]!.push([jBeforeI, -1])
      rankBias[j]!++
    }
  }
  const ranks = rankTerms.map((terms, bar) => onGrid(circuit.roundAffine(terms, rankBias[bar])))
  // JS: slot = descending ? bars - 1 - rank : rank
  const slots = ranks.map(rank => emitSelect(circuit, descending, rank, circuit.affine([[rank, -1]], chart.bars - 1)))
  const destinations = slots.map(slot => onGrid(circuit.affine([[slot, chart.slot]])))

  const animated = emitAnimatedObject(circuit, cells.bars.flatMap((bar, index) => [
    {matrix: cells.springMatrix, displacement: bar.x.displacement, velocity: bar.x.velocity, destination: destinations[index]!, destinationDuringSteps: bar.x.destination},
    {matrix: cells.springMatrix, displacement: bar.height.displacement, velocity: bar.height.velocity, destination: values[index]!, destinationDuringSteps: bar.height.destination},
  ]), {settleCheck: cells.settleCheck, snap: cells.snap})

  table.next(cells.values, values)
  table.next(cells.grabbed, grabbed)
  table.next(cells.descending, descending)
  table.next(cells.grabOffset, grabOffset)
  table.next(cells.bars, cells.bars.map((_, index) => ({
    x: {displacement: animated.displacements[2 * index]!, velocity: animated.velocities[2 * index]!, destination: destinations[index]!},
    height: {displacement: animated.displacements[2 * index + 1]!, velocity: animated.velocities[2 * index + 1]!, destination: values[index]!},
  })))
  const output = {
    bars: cells.bars.map((_, index) => ({
      x: animated.positions[2 * index]!,
      height: animated.positions[2 * index + 1]!,
      value: values[index]!,
      slot: slots[index]!,
      grabbed: grabbed[index]!,
    })),
    descending,
    active: animated.active,
  }
  return {cells, output, ...table.finish()}
}

export type SortingEvent =
  | {kind: 'down' | 'move', x: number, y: number, timeStamp: number}
  | {kind: 'up' | 'flip', timeStamp: number}
  | {kind: 'shuffle', values: readonly number[], timeStamp: number}
export type SortingOutput = WireValues<ReturnType<typeof buildSorting>['output']>

// The host, as the template's: event handlers queue events, and each frame plans its evaluations with advanceFrame,
// which steps the springs to each event's timestamp before applying it.
export function createSortingMachine(writeBack: WriteBack = 'events and settle checks') {
  const built = buildSorting()
  const {cells} = built
  const evaluate = createEvaluator(built)
  const matrices = Array.from({length: defaultSpringClockConfig.maxStepsPerFrame + 1}, (_, steps) => springMatrixPower(springStepMatrix(springConstants), steps))
  const source = new Float32Array(built.initialSource)
  const copy = new Float32Array(source.length)
  // The table as the latest evaluation read it, events included, for the network panel to evaluate again.
  const evaluated = new Float32Array(source)
  let queued: SortingEvent[] = []
  let latest: SortingOutput = evaluate(source).output
  const machine = {
    built,
    source,
    evaluated,
    evaluationCount: 0,
    clock: stoppedSpringClock,
    get output() {
      return latest
    },
    queue(sortingEvent: SortingEvent) {
      queued.push(sortingEvent)
    },
    step(frameTime: number): SortingOutput {
      machine.clock = advanceFrame(machine.clock, frameTime, queued, evaluation => {
        const values = evaluation.writesBack ? source : copy
        if (!evaluation.writesBack) copy.set(source)
        const matrix = matrices[evaluation.steps]!
        cells.springMatrix.forEach((wire, index) => { values[wire] = matrix[index]! })
        values[cells.settleCheck] = evaluation.settleCheck ? 1 : 0
        values[cells.snap] = evaluation.snap ? 1 : 0
        for (const sortingEvent of evaluation.events) {
          switch (sortingEvent.kind) {
            case 'down':
            case 'move':
              values[cells[sortingEvent.kind].active] = 1
              values[cells[sortingEvent.kind].x] = sortingEvent.x
              values[cells[sortingEvent.kind].y] = sortingEvent.y
              break
            case 'shuffle':
              values[cells.shuffle] = 1
              cells.shuffled.forEach((wire, bar) => { values[wire] = sortingEvent.values[bar]! })
              break
            default:
              values[cells[sortingEvent.kind]] = 1
          }
        }
        evaluated.set(values)
        machine.evaluationCount++
        const result = evaluate(values)
        if (evaluation.writesBack) source.set(result.nextValues)
        latest = result.output
        return result.output.active > 0
      }, writeBack)
      queued = []
      return latest
    },
  }
  return machine
}
