// The Game of Life page: the board as a canvas, the controls, and the network panel. Every change to the board goes
// through createLifeMachine's program as an event, and the canvas is drawn from the program's outputs only.
import {compileForView, mountNetworkView, writeMeasure} from '../demo-kit/network-view.ts'
import {type LifeEvent, cellCount, createLifeMachine, grid, presets} from './life.ts'

function mountLife() {
  const machine = createLifeMachine()
  const {built} = machine
  const view = compileForView(built.circuit, [...built.nextSource, built.output.population])
  const network = mountNetworkView(document.querySelector<HTMLElement>('#life-layers')!, view)
  writeMeasure(document, view.measure)

  const canvas = document.querySelector<HTMLCanvasElement>('#life-board')!
  const context = canvas.getContext('2d')!
  const playButton = document.querySelector<HTMLButtonElement>('#life-play')!
  const speed = document.querySelector<HTMLInputElement>('#life-speed')!
  const speedValue = document.querySelector<HTMLOutputElement>('#life-speed-value')!
  const generationText = document.querySelector<HTMLElement>('#life-generation')!
  const populationText = document.querySelector<HTMLElement>('#life-population')!
  const costText = document.querySelector<HTMLElement>('#life-cost')!
  const style = getComputedStyle(document.documentElement)
  const colors = {ink: style.getPropertyValue('--ink').trim(), rule: style.getPropertyValue('--rule').trim(), sheet: style.getPropertyValue('--sheet').trim()}

  let playing = false
  let lastFrame: number | null = null
  let owed = 0
  let dirty = true
  let stepCost: number | null = null
  // The previous generation's cells, so cells that just died draw as a faint trail.
  let previous = new Uint8Array(cellCount)

  const apply = (lifeEvent: LifeEvent) => {
    if (lifeEvent.kind === 'step') previous = Uint8Array.from(machine.output.alive)
    const start = performance.now()
    machine.apply(lifeEvent)
    if (lifeEvent.kind === 'step') {
      const cost = performance.now() - start
      stepCost = stepCost === null ? cost : stepCost * 0.9 + cost * 0.1
    }
    if (lifeEvent.kind === 'load') previous = new Uint8Array(cellCount)
    dirty = true
    schedule()
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(width * grid.rows / grid.columns * ratio)
    dirty = true
    schedule()
  }

  function draw() {
    const {alive} = machine.output
    const size = canvas.width / grid.columns
    context.fillStyle = colors.sheet
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.strokeStyle = colors.rule
    context.lineWidth = 1
    context.beginPath()
    for (let column = 1; column < grid.columns; column++) {
      const x = Math.round(column * size) + 0.5
      context.moveTo(x, 0)
      context.lineTo(x, canvas.height)
    }
    for (let row = 1; row < grid.rows; row++) {
      const y = Math.round(row * size) + 0.5
      context.moveTo(0, y)
      context.lineTo(canvas.width, y)
    }
    context.stroke()
    const inset = Math.max(1, size * 0.08)
    for (let cell = 0; cell < cellCount; cell++) {
      const isAlive = alive[cell] === 1
      if (!isAlive && previous[cell] !== 1) continue
      context.fillStyle = isAlive ? colors.ink : 'rgb(166 77 29 / 0.22)'
      const x = (cell % grid.columns) * size
      const y = Math.floor(cell / grid.columns) * size
      context.beginPath()
      context.roundRect(x + inset, y + inset, size - 2 * inset, size - 2 * inset, size * 0.18)
      context.fill()
    }
    generationText.textContent = machine.output.generation.toLocaleString('en-US')
    populationText.textContent = machine.output.population.toLocaleString('en-US')
    costText.textContent = stepCost === null ? '–' : `${(stepCost * 1000).toFixed(0)} µs`
    network.update(machine.evaluated)
  }

  let scheduled: number | null = null
  const schedule = () => {
    scheduled ??= requestAnimationFrame(frame)
  }
  function frame(time: number) {
    scheduled = null
    if (playing) {
      const perSecond = Number(speed.value)
      owed += lastFrame === null ? 0 : (time - lastFrame) / 1000 * perSecond
      lastFrame = time
      // At most 4 generations per frame, so a stalled tab doesn't catch up all at once.
      for (let count = 0; owed >= 1 && count < 4; count++, owed--) apply({kind: 'step'})
      owed = Math.min(owed, 1)
      schedule()
    }
    if (dirty) {
      dirty = false
      draw()
    }
  }

  const setPlaying = (value: boolean) => {
    playing = value
    lastFrame = null
    owed = value ? 1 : 0
    playButton.textContent = value ? 'Pause' : 'Play'
    schedule()
  }
  playButton.addEventListener('click', () => setPlaying(!playing))
  document.querySelector('#life-step')!.addEventListener('click', () => {
    setPlaying(false)
    apply({kind: 'step'})
  })
  let soupSeed = 1
  for (const button of document.querySelectorAll<HTMLButtonElement>('#life-presets button')) {
    button.addEventListener('click', () => {
      const name = button.dataset['preset'] as keyof typeof presets
      apply({kind: 'load', pattern: name === 'soup' ? presets.soup(soupSeed++ * 7919) : presets[name]()})
    })
  }
  const showSpeed = () => { speedValue.textContent = `${speed.value}/s` }
  speed.addEventListener('input', showSpeed)
  showSpeed()

  // The pointer, as whole cells. A fast drag skips cells between two pointermove events, so the host fills the line
  // between them, one move event per cell, the way a pen would cross them.
  let last: {row: number, column: number} | null = null
  const cellAt = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect()
    const column = Math.min(grid.columns - 1, Math.max(0, Math.floor((event.clientX - box.left) / box.width * grid.columns)))
    const row = Math.min(grid.rows - 1, Math.max(0, Math.floor((event.clientY - box.top) / box.height * grid.rows)))
    return {row, column}
  }
  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId)
    last = cellAt(event)
    apply({kind: 'down', ...last})
  })
  canvas.addEventListener('pointermove', event => {
    if (last === null) return
    const to = cellAt(event)
    const steps = Math.max(Math.abs(to.row - last.row), Math.abs(to.column - last.column))
    for (let index = 1; index <= steps; index++) {
      apply({
        kind: 'move',
        row: Math.round(last.row + (to.row - last.row) * index / steps),
        column: Math.round(last.column + (to.column - last.column) * index / steps),
      })
    }
    last = to
  })
  for (const kind of ['pointerup', 'pointercancel'] as const) {
    canvas.addEventListener(kind, () => {
      if (last === null) return
      last = null
      apply({kind: 'up'})
    })
  }
  document.addEventListener('keydown', event => {
    if (event.key === ' ' && event.target === document.body) {
      event.preventDefault()
      setPlaying(!playing)
    }
  })

  new ResizeObserver(resize).observe(canvas)
  apply({kind: 'load', pattern: presets.gun()})
  setPlaying(true)
}

if (typeof document !== 'undefined' && document.querySelector('#life-demo') !== null) mountLife()
