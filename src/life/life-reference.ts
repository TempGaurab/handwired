// The board of life.ts in plain JavaScript, with the same order within one event: step, then paint, then load.
import {type LifeEvent, cellCount, generationLimit, grid} from './life.ts'

export function createLifeReference() {
  let alive = new Uint8Array(cellCount)
  let painting = 0
  let paintValue = 0
  let generation = 0
  const at = (row: number, column: number) =>
    alive[((row + grid.rows) % grid.rows) * grid.columns + (column + grid.columns) % grid.columns]!

  function step() {
    const next = new Uint8Array(cellCount)
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        let neighbors = 0
        for (const dy of [-1, 0, 1]) {
          for (const dx of [-1, 0, 1]) {
            if (dx !== 0 || dy !== 0) neighbors += at(row + dy, column + dx)
          }
        }
        const self = at(row, column)
        next[row * grid.columns + column] = (self === 1 ? neighbors === 2 || neighbors === 3 : neighbors === 3) ? 1 : 0
      }
    }
    alive = next
    generation = Math.min(generationLimit, generation + 1)
  }

  return {
    get alive() {
      return alive
    },
    get generation() {
      return generation
    },
    get population() {
      return alive.reduce((sum, bit) => sum + bit, 0)
    },
    apply(lifeEvent: LifeEvent) {
      switch (lifeEvent.kind) {
        case 'step':
          step()
          break
        case 'down':
          paintValue = 1 - alive[lifeEvent.row * grid.columns + lifeEvent.column]!
          painting = 1
          alive[lifeEvent.row * grid.columns + lifeEvent.column] = paintValue
          break
        case 'move':
          if (painting === 1) alive[lifeEvent.row * grid.columns + lifeEvent.column] = paintValue
          break
        case 'up':
          painting = 0
          break
        case 'load':
          alive = Uint8Array.from(lifeEvent.pattern)
          generation = 0
          break
      }
    },
  }
}
