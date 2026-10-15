// The tic-tac-toe of tic-tac-toe.ts in plain JavaScript: the same board, the same events and the same strategy for the
// network's moves, the rules of Newell and Simon's 1972 program, scored the same way so that ties go to the same square.
import {type TicTacToeEvent, corners, lines as tupleLines, opposite, ruleWeights} from './tic-tac-toe.ts'

export type Board = {x: number[], o: number[]}

const lines: readonly (readonly number[])[] = tupleLines

const count = (marks: readonly number[], line: readonly number[]) => line.reduce((sum, square) => sum + marks[square]!, 0)

export function analyze({x, o}: Board) {
  const empty = x.map((mark, square) => 1 - mark - o[square]!)
  const xWon = lines.some(line => count(x, line) === 3) ? 1 : 0
  const oWon = lines.some(line => count(o, line) === 3) ? 1 : 0
  const full = empty.every(bit => bit === 0) ? 1 : 0
  return {empty, xWon, oWon, full, over: xWon || oWon || full ? 1 : 0}
}

// The network's view of a board where it plays O: a score per square, the sum of ruleWeights over the rules that hold
// there, and the square it picks, the first with the highest score.
export function decide(board: Board) {
  const {x, o} = board
  const {empty} = analyze(board)
  const through = (square: number) => lines.filter(line => line.includes(square))
  const twoOf = (mine: number[], theirs: number[], line: readonly number[]) => count(mine, line) === 2 && count(theirs, line) === 0
  const oneOf = (mine: number[], theirs: number[], line: readonly number[]) => count(mine, line) === 1 && count(theirs, line) === 0
  const xFork = empty.map((bit, square) => bit === 1 && through(square).filter(line => oneOf(x, o, line)).length >= 2 ? 1 : 0)
  const xForks = xFork.reduce<number>((sum, bit) => sum + bit, 0)
  const scores = empty.map((bit, square) => {
    if (bit === 0) return 0
    // An attack: a line through the square with one O and nothing else, so X must answer at its other empty square.
    // It's safe when that answer doesn't give X a fork.
    const safeAttack = through(square).some(line => oneOf(o, x, line) && line.some(other => other !== square && empty[other] === 1 && xFork[other] === 0))
    const rules = {
      win: through(square).some(line => twoOf(o, x, line)),
      block: through(square).some(line => twoOf(x, o, line)),
      fork: through(square).filter(line => oneOf(o, x, line)).length >= 2,
      blockFork: (xForks === 1 && xFork[square] === 1) || (xForks >= 2 && safeAttack),
      anyFork: xFork[square] === 1,
      center: square === 4,
      oppositeCorner: corners.includes(square) && x[opposite(square)] === 1,
      corner: corners.includes(square),
      empty: true,
    }
    return Object.entries(rules).reduce((sum, [rule, holds]) => sum + (holds ? ruleWeights[rule as keyof typeof ruleWeights] : 0), 0)
  })
  const best = Math.max(...scores)
  return {scores, square: scores.indexOf(best)}
}

export function createTicTacToeReference() {
  let board: Board = {x: Array<number>(9).fill(0), o: Array<number>(9).fill(0)}
  const tally = {network: 0, you: 0, draws: 0}
  let lastMove = Array<number>(9).fill(0)
  let lastScores = Array<number>(9).fill(0)

  const networkMoves = () => {
    const {scores, square} = decide(board)
    board.o[square] = 1
    lastMove = lastMove.map((_, index) => index === square ? 1 : 0)
    lastScores = scores
  }
  const finishIfOver = (wasOver: number) => {
    const after = analyze(board)
    if (after.over && !wasOver) {
      if (after.oWon) tally.network++
      else if (after.xWon) tally.you++
      else tally.draws++
    }
  }

  return {
    get board() {
      return board
    },
    tally,
    get lastMove() {
      return lastMove
    },
    get lastScores() {
      return lastScores
    },
    apply(ticTacToeEvent: TicTacToeEvent) {
      if (ticTacToeEvent.kind === 'reset' || ticTacToeEvent.kind === 'network first') {
        board = {x: Array<number>(9).fill(0), o: Array<number>(9).fill(0)}
        lastMove = Array<number>(9).fill(0)
        lastScores = Array<number>(9).fill(0)
        if (ticTacToeEvent.kind === 'network first') networkMoves()
        return
      }
      const before = analyze(board)
      if (before.over || board.x[ticTacToeEvent.square] === 1 || board.o[ticTacToeEvent.square] === 1) return
      board.x[ticTacToeEvent.square] = 1
      lastMove = Array<number>(9).fill(0)
      lastScores = Array<number>(9).fill(0)
      if (!analyze(board).over) networkMoves()
      finishIfOver(before.over)
    },
  }
}
