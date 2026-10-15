// The tic-tac-toe page: nine buttons, the tally, the rule list and the network panel, all drawn from the program's
// state cells and outputs after each event.
import {compileForView, mountNetworkView, writeMeasure} from '../demo-kit/network-view.ts'
import {type Rule, type TicTacToeEvent, createTicTacToeMachine, decidingRule, lines, ruleNames, ruleWeights} from './tic-tac-toe.ts'

const xMark = '<svg class="mark-x" viewBox="0 0 40 40" aria-hidden="true"><path d="M9 9L31 31M31 9L9 31" fill="none" stroke-width="4.5" stroke-linecap="round"/></svg>'
const oMark = '<svg class="mark-o" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="12" fill="none" stroke-width="4.5"/></svg>'

function mountTicTacToe() {
  const machine = createTicTacToeMachine()
  const {built} = machine
  const view = compileForView(built.circuit, [...built.nextSource, built.output.over])
  const network = mountNetworkView(document.querySelector<HTMLElement>('#ttt-layers')!, view)
  writeMeasure(document, view.measure)

  const board = document.querySelector<HTMLElement>('#ttt-board')!
  const status = document.querySelector<HTMLElement>('#ttt-status')!
  const rulesList = document.querySelector<HTMLElement>('#ttt-rules')!
  const ruleItems = new Map<Rule, HTMLLIElement>()
  for (const rule of Object.keys(ruleWeights) as Rule[]) {
    const item = document.createElement('li')
    item.textContent = ruleNames[rule]
    rulesList.append(item)
    ruleItems.set(rule, item)
  }
  const squares = Array.from({length: 9}, (_, square) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.addEventListener('click', () => apply({kind: 'play', square}))
    board.append(button)
    return button
  })

  function apply(ticTacToeEvent: TicTacToeEvent) {
    machine.apply(ticTacToeEvent)
    render()
  }

  function render() {
    const {x, o, lastMove, lastScores, tally} = machine.state
    const {over, xWon, oWon, winningLines} = machine.output
    const winning = new Set<number>(lines.flatMap((line, index) => winningLines[index] === 1 ? line : []))
    const best = Math.max(...lastScores)
    squares.forEach((button, square) => {
      const mark = x[square] === 1 ? 'X' : o[square] === 1 ? 'O' : null
      const score = lastScores[square]!
      const rule = decidingRule(score)
      button.innerHTML = (mark === 'X' ? xMark : mark === 'O' ? oMark : '')
        + (best > 0 && mark !== 'X' && (mark === null || lastMove[square] === 1)
          ? `<span class="reason">${rule === null ? '' : ruleNames[rule]}</span><span class="score"><i style="--score: ${score / best}"></i></span>`
          : '')
      button.disabled = mark !== null || over === 1
      button.classList.toggle('win', winning.has(square))
      button.classList.toggle('last', lastMove[square] === 1)
      button.setAttribute('aria-label', `Square ${square + 1}: ${mark ?? 'empty'}`)
    })
    const chosen = lastMove.indexOf(1)
    const chosenRule = chosen === -1 ? null : decidingRule(lastScores[chosen]!)
    for (const [rule, item] of ruleItems) item.classList.toggle('fired', rule === chosenRule)
    status.className = `status${over === 1 ? (oWon === 1 ? ' bad' : ' ok') : ''}`
    // One span, since .status is a flex row and would put a gap around a bare <b>.
    status.innerHTML = `<span>${over === 1
      ? (oWon === 1 ? 'The network wins.' : xWon === 1 ? 'You win. That shouldn&rsquo;t happen.' : 'Draw.')
      : chosenRule === null ? 'Your move.' : `The network played: <b>${ruleNames[chosenRule]}</b>. Your move.`}</span>`
    document.querySelector('#ttt-you')!.textContent = `${tally.you}`
    document.querySelector('#ttt-draws')!.textContent = `${tally.draws}`
    document.querySelector('#ttt-network')!.textContent = `${tally.network}`
    network.update(machine.evaluated)
  }

  document.querySelector('#ttt-new')!.addEventListener('click', () => apply({kind: 'reset'}))
  document.querySelector('#ttt-network-first')!.addEventListener('click', () => apply({kind: 'network first'}))
  render()
}

if (typeof document !== 'undefined' && document.querySelector('#ttt-demo') !== null) mountTicTacToe()
