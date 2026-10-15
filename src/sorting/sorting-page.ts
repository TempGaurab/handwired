// The sorting chart's page: one requestAnimationFrame step per frame while something moves, then DOM writes from the
// program's outputs only, as the template does. The chart is drawn at a fixed size in px and scaled down to fit a
// narrow column, so pointer coordinates are divided by that scale before they reach the program.
import {compileForView, mountNetworkView, writeMeasure} from '../demo-kit/network-view.ts'
import {chart, chartWidth, createSortingMachine} from './sorting.ts'

function mountSorting() {
  const machine = createSortingMachine()
  const {built} = machine
  const view = compileForView(built.circuit, [...built.nextSource, built.output.active])
  const network = mountNetworkView(document.querySelector<HTMLElement>('#sorting-layers')!, view)
  writeMeasure(document, view.measure)

  const container = document.querySelector<HTMLElement>('#sorting-chart')!
  const area = document.querySelector<HTMLElement>('#sorting-area')!
  const flipButton = document.querySelector<HTMLButtonElement>('#sorting-flip')!
  const evaluationsText = document.querySelector<HTMLElement>('#sorting-evaluations')!
  const costText = document.querySelector<HTMLElement>('#sorting-cost')!
  // 24 px of headroom above the tallest bar for its label.
  const headroom = 24
  area.style.width = `${chartWidth}px`
  area.style.height = `${chart.height + headroom}px`
  const bars = Array.from({length: chart.bars}, () => {
    const element = document.createElement('div')
    element.className = 'chart-bar'
    element.style.width = `${chart.barWidth}px`
    element.append(document.createElement('span'))
    area.append(element)
    return element
  })

  let scale = 1
  let cost: number | null = null
  const fit = () => {
    const available = container.clientWidth - 32
    scale = Math.min(1, available / chartWidth)
    area.style.transform = `scale(${scale})`
    area.style.marginBottom = `${(chart.height + headroom) * (scale - 1)}px`
    area.style.marginLeft = `${Math.max(0, (available - chartWidth * scale) / 2)}px`
  }

  let scheduled: number | null = null
  const schedule = () => {
    scheduled ??= requestAnimationFrame(render)
  }
  function render(frameTime: number) {
    scheduled = null
    const start = performance.now()
    const countBefore = machine.evaluationCount
    const output = machine.step(frameTime)
    const count = machine.evaluationCount - countBefore
    if (count > 0) {
      const each = (performance.now() - start) / count
      cost = cost === null ? each : cost * 0.9 + each * 0.1
    }
    output.bars.forEach((bar, index) => {
      const element = bars[index]!
      element.style.transform = `translate3d(${bar.x + (chart.slot - chart.barWidth) / 2}px,0,0)`
      element.style.height = `${Math.max(0, bar.height)}px`
      element.style.setProperty('--shade', `${(bar.value - chart.minimum) / (chart.maximum - chart.minimum)}`)
      element.classList.toggle('grabbed', bar.grabbed === 1)
      element.firstElementChild!.textContent = `${bar.value}`
    })
    flipButton.textContent = output.descending === 1 ? 'Descending' : 'Ascending'
    evaluationsText.textContent = machine.evaluationCount.toLocaleString('en-US')
    costText.textContent = cost === null ? '–' : `${(cost * 1000).toFixed(0)} µs`
    network.update(machine.evaluated)
    if (machine.clock.animatedUntilMs !== null) schedule()
  }

  // Pointer coordinates in the chart's own px, whole px, with y from the top of the bars' area.
  const local = (event: PointerEvent) => {
    const box = area.getBoundingClientRect()
    return {
      x: Math.max(-4096, Math.min(4096, Math.round((event.clientX - box.left) / scale))),
      y: Math.max(-4096, Math.min(4096, Math.round((event.clientY - box.top) / scale) - headroom)),
    }
  }
  let pressed = false
  area.addEventListener('pointerdown', event => {
    pressed = true
    area.setPointerCapture(event.pointerId)
    machine.queue({kind: 'down', ...local(event), timeStamp: event.timeStamp})
    schedule()
  })
  area.addEventListener('pointermove', event => {
    if (!pressed) return
    machine.queue({kind: 'move', ...local(event), timeStamp: event.timeStamp})
    schedule()
  })
  for (const kind of ['pointerup', 'pointercancel'] as const) {
    area.addEventListener(kind, event => {
      if (!pressed) return
      pressed = false
      machine.queue({kind: 'up', timeStamp: event.timeStamp})
      schedule()
    })
  }
  document.querySelector('#sorting-shuffle')!.addEventListener('click', event => {
    const values = Array.from({length: chart.bars}, () => chart.minimum + Math.floor(Math.random() * (chart.maximum - chart.minimum + 1)))
    machine.queue({kind: 'shuffle', values, timeStamp: event.timeStamp})
    schedule()
  })
  flipButton.addEventListener('click', event => {
    machine.queue({kind: 'flip', timeStamp: event.timeStamp})
    schedule()
  })

  new ResizeObserver(() => {
    fit()
    schedule()
  }).observe(container)
  fit()
  schedule()
}

if (typeof document !== 'undefined' && document.querySelector('#sorting-demo') !== null) mountSorting()
