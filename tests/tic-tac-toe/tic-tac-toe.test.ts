// Plays every game of tic-tac-toe against the network, from both starts, and compares the program with its plain
// JavaScript version after every move.
import {expect, test} from 'bun:test'
import {type TicTacToeEvent, createTicTacToeMachine, decidingRule} from '../../src/tic-tac-toe/tic-tac-toe.ts'
import {createTicTacToeReference} from '../../src/tic-tac-toe/tic-tac-toe-reference.ts'

type Outcome = {games: number, networkWins: number, draws: number, youWin: number}

// Depth first over every sequence of your moves. The network's answers are fixed, so each sequence is one game.
function playEveryGame(networkFirst: boolean): Outcome {
  const machine = createTicTacToeMachine()
  const outcome: Outcome = {games: 0, networkWins: 0, draws: 0, youWin: 0}
  const replay = (moves: readonly number[]) => {
    const reference = createTicTacToeReference()
    const events: TicTacToeEvent[] = [networkFirst ? {kind: 'network first'} : {kind: 'reset'}, ...moves.map(square => ({kind: 'play', square} as const))]
    for (const ticTacToeEvent of events) reference.apply(ticTacToeEvent)
    return reference
  }
  const explore = (moves: number[], saved: Float32Array) => {
    const reference = replay(moves)
    machine.source.set(saved)
    const state = machine.state
    expect(state.x).toEqual(reference.board.x)
    expect(state.o).toEqual(reference.board.o)
    expect(state.lastMove).toEqual(reference.lastMove)
    expect(state.lastScores).toEqual(reference.lastScores)
    if (machine.output.over === 1) {
      outcome.games++
      if (machine.output.oWon === 1) outcome.networkWins++
      else if (machine.output.xWon === 1) outcome.youWin++
      else outcome.draws++
      return
    }
    for (let square = 0; square < 9; square++) {
      if (state.x[square] === 1 || state.o[square] === 1) continue
      machine.source.set(saved)
      machine.apply({kind: 'play', square})
      explore([...moves, square], new Float32Array(machine.source))
      machine.source.set(saved)
    }
  }
  machine.apply(networkFirst ? {kind: 'network first'} : {kind: 'reset'})
  explore([], new Float32Array(machine.source))
  return outcome
}

test('you move first: the network never loses any of the games you can play', () => {
  const outcome = playEveryGame(false)
  expect(outcome.youWin).toBe(0)
  expect(outcome.games).toBeGreaterThan(100)
  console.log('you first', outcome)
})

test('the network moves first: it never loses either', () => {
  const outcome = playEveryGame(true)
  expect(outcome.youWin).toBe(0)
  console.log('network first', outcome)
})

test('the tally counts each game once, and a move on a taken square or after the end does nothing', () => {
  const machine = createTicTacToeMachine()
  const reference = createTicTacToeReference()
  const events: TicTacToeEvent[] = [
    {kind: 'play', square: 0}, {kind: 'play', square: 0}, {kind: 'play', square: 4},
    {kind: 'play', square: 8}, {kind: 'play', square: 2}, {kind: 'play', square: 6}, {kind: 'play', square: 3},
    {kind: 'play', square: 5}, {kind: 'play', square: 7}, {kind: 'play', square: 1},
    {kind: 'reset'}, {kind: 'play', square: 1}, {kind: 'play', square: 3}, {kind: 'play', square: 7}, {kind: 'play', square: 2},
    {kind: 'network first'}, {kind: 'play', square: 1}, {kind: 'play', square: 7}, {kind: 'play', square: 6},
  ]
  for (const ticTacToeEvent of events) {
    machine.apply(ticTacToeEvent)
    reference.apply(ticTacToeEvent)
    expect(machine.state.x).toEqual(reference.board.x)
    expect(machine.state.o).toEqual(reference.board.o)
    expect(machine.state.tally).toEqual(reference.tally)
  }
  expect(machine.state.tally.network + machine.state.tally.draws).toBeGreaterThan(0)
})

test('the network opens in the center, and a score names the rule that decided it', () => {
  const machine = createTicTacToeMachine()
  machine.apply({kind: 'network first'})
  expect(machine.state.o.indexOf(1)).toBe(4)
  expect(decidingRule(machine.state.lastScores[4]!)).toBe('center')
  machine.apply({kind: 'reset'})
  machine.apply({kind: 'play', square: 4})
  expect(decidingRule(Math.max(...machine.state.lastScores))).toBe('corner')
})
