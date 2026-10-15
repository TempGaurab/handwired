// The network panel that the life, tic-tac-toe and sorting demos share: a program's compiled layers drawn as what they
// are, sparse weight matrices, each with the live values it computed in the latest evaluation under it. The counts
// follow HandwiredOS's Monitor window (src/handwiredos/monitor-footer.ts): weights are the stored coefficients of every
// layer, and layers are the compiled program's layers.
import type {Circuit, Wire} from '../runtime/numeric-ui-core.ts'

type TensorProgram = ReturnType<Circuit['compileTensorProgram']>

export type ProgramMeasure = {weights: number, neurons: number, layers: number, cells: number}

export function measureProgram(program: TensorProgram): ProgramMeasure {
  let weights = 0
  let neurons = 0
  for (const layer of program.layers) {
    weights += layer.weights.length
    neurons += layer.outputSize
  }
  return {weights, neurons, layers: program.layers.length, cells: program.sourceSize}
}

// Compiles the program for `roots` once, for the panel alone: the demo's own evaluator stays the checked one from
// createEvaluator, and the panel evaluates the same source table again at most once per frame to light its layers.
export function compileForView(circuit: Circuit, roots: readonly Wire[]) {
  const program = circuit.compileTensorProgram(roots)
  const evaluate = circuit.createTensorProgramEvaluator(program)
  return {program, evaluate, measure: measureProgram(program)}
}

const tileSize = 72

// Each pixel of a weight thumbnail sums the signs of the weights that land on it, so a layer that both adds and
// subtracts the same input shows both colors side by side rather than cancelling to blank.
function drawWeights(canvas: HTMLCanvasElement, layer: TensorProgram['layers'][number]) {
  const rows = layer.outputSize + layer.gateRows.length
  const columns = Math.max(1, layer.inputSize)
  const width = Math.min(tileSize, columns)
  const height = Math.min(tileSize, rows)
  canvas.width = width
  canvas.height = height
  const positive = new Float32Array(width * height)
  const negative = new Float32Array(width * height)
  for (let row = 0; row < rows; row++) {
    const y = Math.floor(row * height / rows)
    for (let entry = layer.rowOffsets[row]!; entry < layer.rowOffsets[row + 1]!; entry++) {
      const x = Math.floor(layer.columns[entry]! * width / columns)
      const weight = layer.weights[entry]!
      if (weight > 0) positive[y * width + x]! += 1
      else if (weight < 0) negative[y * width + x]! += 1
    }
  }
  const context = canvas.getContext('2d')!
  const image = context.createImageData(width, height)
  for (let pixel = 0; pixel < width * height; pixel++) {
    const p = positive[pixel]!
    const n = negative[pixel]!
    const offset = pixel * 4
    if (p === 0 && n === 0) continue
    // Copper for positive, indigo for negative, as site.css's --copper and --wire-indigo.
    const share = p / (p + n)
    image.data[offset] = Math.round(166 * share + 51 * (1 - share))
    image.data[offset + 1] = Math.round(77 * share + 88 * (1 - share))
    image.data[offset + 2] = Math.round(29 * share + 158 * (1 - share))
    image.data[offset + 3] = Math.round(255 * Math.min(1, 0.45 + 0.2 * Math.log2(1 + p + n)))
  }
  context.putImageData(image, 0, 0)
}

export type NetworkView = {update(source: Float32Array): void}

// Fills `container` with one tile per layer. `update` evaluates the source table through the panel's own compiled
// program and paints every layer's outputs as a square of cells: a zero output is blank, a positive one copper and a
// negative one indigo, scaled by the largest magnitude in its layer.
export function mountNetworkView(container: HTMLElement, view: ReturnType<typeof compileForView>): NetworkView {
  const {program} = view
  container.replaceChildren()
  const activationCanvases: HTMLCanvasElement[] = []
  const offsets: number[] = []
  let offset = program.sourceSize
  program.layers.forEach((layer, index) => {
    const tile = document.createElement('figure')
    tile.className = 'layer-tile'
    const weights = document.createElement('canvas')
    weights.className = 'layer-weights'
    drawWeights(weights, layer)
    const activations = document.createElement('canvas')
    activations.className = 'layer-activations'
    const side = Math.ceil(Math.sqrt(layer.outputSize))
    activations.width = side
    activations.height = Math.ceil(layer.outputSize / side)
    const caption = document.createElement('figcaption')
    caption.textContent = `${index + 1}`
    caption.title = `Layer ${index + 1}: ${layer.outputSize.toLocaleString('en-US')} outputs from ${layer.inputSize.toLocaleString('en-US')} inputs, ${layer.weights.length.toLocaleString('en-US')} weights`
    tile.append(weights, activations, caption)
    container.append(tile)
    activationCanvases.push(activations)
    offsets.push(offset)
    offset += layer.outputSize
  })

  return {
    update(source) {
      view.evaluate(source)
      const values = view.evaluate.packedValues
      program.layers.forEach((layer, index) => {
        const canvas = activationCanvases[index]!
        const context = canvas.getContext('2d')!
        const image = context.createImageData(canvas.width, canvas.height)
        const start = offsets[index]!
        let largest = 0
        for (let row = 0; row < layer.outputSize; row++) largest = Math.max(largest, Math.abs(values[start + row]!))
        for (let row = 0; row < layer.outputSize; row++) {
          const value = values[start + row]!
          if (value === 0 || largest === 0) continue
          const strength = 0.3 + 0.7 * Math.abs(value) / largest
          const pixel = row * 4
          if (value > 0) image.data.set([166, 77, 29, Math.round(255 * strength)], pixel)
          else image.data.set([51, 88, 158, Math.round(255 * strength)], pixel)
        }
        context.putImageData(image, 0, 0)
      })
    },
  }
}

// The panel's numbers, e.g. "8,412 weights · 9 layers", into elements with data-measure="weights" and so on.
export function writeMeasure(root: ParentNode, measure: ProgramMeasure) {
  for (const element of root.querySelectorAll<HTMLElement>('[data-measure]')) {
    const name = element.dataset['measure']
    if (name !== undefined && name in measure) element.textContent = measure[name as keyof ProgramMeasure].toLocaleString('en-US')
  }
}
