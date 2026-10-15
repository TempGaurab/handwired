// Tic-tac-toe against a network that never loses, as one numeric program. You play X. In the same evaluation as your
// move, the program checks the board, scores every square for O with the rules of Newell and Simon's 1972 program
// (win, block, fork, block a fork, center, opposite corner, corner, side), and plays the best square through an
// argmax tournament. Every rule is a few ReLUs over line counts, e.g. "O has two in this line and X has none" is
// [oc - 3 × xc >= 2] = relu(s - 1) - relu(s - 2) with s = oc - 3 × xc. tic-tac-toe-reference.ts is the same game in
// plain JavaScript, and tests/tic-tac-toe plays every game against both.
import {type Wire, emitArgmax, emitCompare} from '../runtime/numeric-ui-core.ts'
import {createEvaluator, createSourceTable, event, input, list, state, stateBit} from '../runtime/cells.ts'

export const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]] as const
export const corners: readonly number[] = [0, 2, 6, 8]
export const opposite = (corner: number) => 8 - corner
// A square's score is the sum of the weights of the rules that hold there. Each rule outweighs every rule below it
// together, so the score orders squares by their best rule, and the sum stays below 1 for the argmax.
export const ruleWeights = {
  win: 128 / 256,
  block: 64 / 256,
  fork: 32 / 256,
  blockFork: 16 / 256,
  anyFork: 8 / 256,
  center: 4 / 256,
  oppositeCorner: 2 / 256,
  corner: 1 / 256,
  empty: 0.5 / 256,
} as const
export type Rule = keyof typeof ruleWeights
export const ruleNames: Record<Rule, string> = {
  win: 'Win',
  block: 'Block your line',
  fork: 'Make a fork',
  blockFork: 'Stop your fork',
  anyFork: 'Take a fork square',
  center: 'Center',
  oppositeCorner: 'Opposite corner',
  corner: 'Corner',
  empty: 'Side',
}
// The rule that decided a score: the heaviest one in it.
export function decidingRule(score: number): Rule | null {
  const rule = (Object.keys(ruleWeights) as Rule[]).find(name => score >= ruleWeights[name])
  return score > 0 && rule !== undefined ? rule : null
}

const tallyCell = () => state([0, 1_000_000], {grid: 1})
export const ticTacToeCells = {
  x: list(9, () => stateBit()),
  o: list(9, () => stateBit()),
  play: event(),
  square: input([0, 8], {grid: 1}),
  reset: event(),
  // A new game where the network moves first.
  networkFirst: event(),
  tally: {network: tallyCell(), you: tallyCell(), draws: tallyCell()},
  // The network's last move and its scores for every square then, for the page to show.
  lastMove: list(9, () => stateBit()),
  lastScores: list(9, () => state([0, 1])),
}

export function buildTicTacToe() {
  const table = createSourceTable()
  const cells = table.declare(ticTacToeCells)
  table.atMostOne('events', [cells.play, cells.reset, cells.networkFirst])
  const circuit = table.createCircuit()
  type Terms = readonly (readonly [Wire, number])[]
  const relu = (terms: Terms, bias = 0) => circuit.reglu([], 1, terms, bias)
  const sum = (terms: Terms, bias = 0) => circuit.affine(terms, bias)
  // Bits that came out of ReLUs get their 0..1 range declared, so the argmax and the comparisons accept them.
  const bit = (wire: Wire) => {
    circuit.assumeRange(wire, 0, 1)
    return wire
  }
  // JS: Math.min(1, total) for a whole number total >= 0, i.e. OR of bits.
  const any = (bits: readonly Wire[]) => {
    const total = sum(bits.map(wire => [wire, 1] as const))
    return bit(sum([[total, 1], [relu([[total, 1]], -1), -1]]))
  }
  // JS: s >= k for a whole number s, as relu(s - k + 1) - relu(s - k).
  const atLeast = (terms: Terms, k: number) => bit(sum([[relu(terms, 1 - k), 1], [relu(terms, -k), -1]]))
  // JS: s === k for a whole number s, as relu(s - k + 1) - 2 relu(s - k) + relu(s - k - 1).
  const exactly = (terms: Terms, k: number) => bit(sum([[relu(terms, 1 - k), 1], [relu(terms, -k), -2], [relu(terms, -1 - k), 1]]))
  const through = (square: number) => lines.flatMap((line, index) => (line as readonly number[]).includes(square) ? [index] : [])

  // Line counts and the game's state for one board.
  function analyze(x: readonly Wire[], o: readonly Wire[]) {
    const empty = x.map((mark, square) => bit(sum([[mark, -1], [o[square]!, -1]], 1)))
    const counts = lines.map(line => ({
      x: line.map(square => [x[square]!, 1] as const),
      o: line.map(square => [o[square]!, 1] as const),
    }))
    // JS: the line holds three X, as relu(xc - 2)
    const xWon = any(counts.map(count => relu(count.x, -2)))
    const oWon = any(counts.map(count => relu(count.o, -2)))
    const winningLines = counts.map(count => any([relu(count.x, -2), relu(count.o, -2)]))
    // JS: empty.every(bit => bit === 0)
    const full = bit(relu(empty.map(wire => [wire, -1] as const), 1))
    const over = any([xWon, oWon, full])
    return {x, o, empty, counts, xWon, oWon, full, over, winningLines}
  }

  // O's score for every square of a board, see ruleWeights.
  function score(board: ReturnType<typeof analyze>) {
    const {x, empty, counts} = board
    // s = mine - 3 × theirs: a line with any of theirs is negative, so s = 2 means two of mine and none of theirs.
    const oVsX = counts.map(count => [...count.o, ...count.x.map(([wire]) => [wire, -3] as const)])
    const xVsO = counts.map(count => [...count.x, ...count.o.map(([wire]) => [wire, -3] as const)])
    const oTwo = oVsX.map(terms => atLeast(terms, 2))
    const xTwo = xVsO.map(terms => atLeast(terms, 2))
    const oOne = oVsX.map(terms => exactly(terms, 1))
    const xOne = xVsO.map(terms => exactly(terms, 1))
    const and = (...bits: Wire[]) => bit(relu(bits.map(wire => [wire, 1] as const), 1 - bits.length))
    // JS: two or more lines through the square that hold one of mine and nothing else.
    const forkAt = (one: readonly Wire[], square: number) => and(atLeast(through(square).map(line => [one[line]!, 1] as const), 2), empty[square]!)
    const xFork = empty.map((_, square) => forkAt(xOne, square))
    const xForks = xFork.map(wire => [wire, 1] as const)
    const oneXFork = exactly(xForks, 1)
    const manyXForks = atLeast(xForks, 2)
    // A square where X's forced answer isn't an X fork.
    const safeAnswer = empty.map((wire, square) => bit(relu([[wire, 1], [xFork[square]!, -1]])))
    const scores = empty.map((isEmpty, square) => {
      // JS: some line through the square has one O and nothing else, and its other empty square is a safe answer.
      // 2 × oOne + 2 × empty + safe - 4 is 1 only when all three hold: the safe count of the line's two other squares
      // is at most 1 when the line qualifies, and can be 2 when it doesn't, e.g. when the O is on this square.
      const safeAttack = any(through(square).map(line => relu([
        [oOne[line]!, 2], [isEmpty, 2],
        ...lines[line]!.filter(other => other !== square).map(other => [safeAnswer[other]!, 1] as const),
      ], -4)))
      const rules: Record<Rule, Wire | null> = {
        win: and(any(through(square).map(line => oTwo[line]!)), isEmpty),
        block: and(any(through(square).map(line => xTwo[line]!)), isEmpty),
        fork: forkAt(oOne, square),
        blockFork: bit(sum([[and(oneXFork, xFork[square]!), 1], [and(manyXForks, safeAttack), 1]])),
        anyFork: xFork[square]!,
        center: square === 4 ? isEmpty : null,
        oppositeCorner: corners.includes(square) ? and(isEmpty, x[opposite(square)]!) : null,
        corner: corners.includes(square) ? isEmpty : null,
        empty: isEmpty,
      }
      const terms = (Object.keys(rules) as Rule[]).flatMap(rule => rules[rule] === null ? [] : [[rules[rule], ruleWeights[rule]] as const])
      const total = circuit.roundAffine(terms)
      circuit.assumeRange(total, 0, 1)
      return total
    })
    return scores
  }

  // Events: a new game clears the board. JS: if (reset || networkFirst) board = empty
  const clear = sum([[cells.reset, 1], [cells.networkFirst, 1]])
  const x0 = cells.x.map(mark => relu([[mark, 1], [clear, -1]]))
  const o0 = cells.o.map(mark => relu([[mark, 1], [clear, -1]]))
  const start = analyze(x0, o0)
  // Your move. JS: if (play && board[square] is empty && !over) x[square] = 1
  const emptyAtSquare = circuit.indexRead(cells.square, start.empty)
  const xMoves = bit(relu([[cells.play, 1], [emptyAtSquare, 1], [start.over, -1]], -1))
  const x1 = x0.map((mark, square) => sum([[mark, 1], [relu([[emitCompare(circuit, cells.square, '===', circuit.constant(square)), 1], [xMoves, 1]], -1), 1]]))
  const afterYou = analyze(x1, o0)
  // The network's move, when your move didn't end the game, or on a new game where it goes first.
  const oTurn = bit(sum([[relu([[xMoves, 1], [afterYou.over, -1]]), 1], [cells.networkFirst, 1]]))
  const scores = score(afterYou)
  const {selected} = emitArgmax(circuit, scores, circuit.constant(1))
  const oMove = selected.map(wire => relu([[wire, 1], [oTurn, 1]], -1))
  const o2 = o0.map((mark, square) => sum([[mark, 1], [oMove[square]!, 1]]))
  const end = analyze(x1, o2)

  // The tally counts a game once, in the evaluation where it ends.
  const endedNow = bit(relu([[end.over, 1], [start.over, -1]]))
  table.next(cells.x, x1)
  table.next(cells.o, o2)
  table.next(cells.tally, {
    network: sum([[cells.tally.network, 1], [relu([[endedNow, 1], [end.oWon, 1]], -1), 1]]),
    you: sum([[cells.tally.you, 1], [relu([[endedNow, 1], [end.xWon, 1]], -1), 1]]),
    draws: sum([[cells.tally.draws, 1], [relu([[endedNow, 1], [end.xWon, -1], [end.oWon, -1]]), 1]]),
  })
  // JS: lastMove = oTurn ? oMove : (clear || xMoves ? none : lastMove), and the same for the scores.
  const keep = (wire: Wire) => relu([[wire, 1], [clear, -1], [xMoves, -1]])
  table.next(cells.lastMove, oMove.map((wire, square) => sum([[wire, 1], [keep(cells.lastMove[square]!), 1]])))
  table.next(cells.lastScores, scores.map((wire, square) => sum([[relu([[wire, 1], [oTurn, 1]], -1), 1], [keep(cells.lastScores[square]!), 1]])))
  const output = {xWon: end.xWon, oWon: end.oWon, full: end.full, over: end.over, winningLines: end.winningLines}
  return {cells, output, ...table.finish()}
}

export type TicTacToeEvent = {kind: 'play', square: number} | {kind: 'reset'} | {kind: 'network first'}

// The host: each event is one evaluation, whose next values are written back. The page reads the board, the tally
// and the network's last move from the source table, and the game's state from the output.
export function createTicTacToeMachine() {
  const built = buildTicTacToe()
  const {cells} = built
  const evaluate = createEvaluator(built)
  const source = new Float32Array(built.initialSource)
  // The table as the latest evaluation read it, events included, for the network panel to evaluate again.
  const evaluated = new Float32Array(source)
  let output = evaluate(source).output
  const read = (wires: readonly Wire[]) => wires.map(wire => source[wire]!)
  return {
    built,
    source,
    evaluated,
    get output() {
      return output
    },
    get state() {
      return {
        x: read(cells.x), o: read(cells.o), lastMove: read(cells.lastMove), lastScores: read(cells.lastScores),
        tally: {network: source[cells.tally.network]!, you: source[cells.tally.you]!, draws: source[cells.tally.draws]!},
      }
    },
    apply(ticTacToeEvent: TicTacToeEvent) {
      if (ticTacToeEvent.kind === 'play') {
        source[cells.play] = 1
        source[cells.square] = ticTacToeEvent.square
      } else {
        source[ticTacToeEvent.kind === 'reset' ? cells.reset : cells.networkFirst] = 1
      }
      evaluated.set(source)
      const result = evaluate(source)
      source.set(result.nextValues)
      output = result.output
      return output
    },
  }
}
