import { describe, expect, it } from 'vitest'
import type { Bounds } from './geometry'
import { assignHandles, describeScene, pickPointer, type RawShape } from './sceneGraph'

const box = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({
  minX,
  minY,
  maxX,
  maxY,
})

function raw(overrides: Partial<RawShape> & { id: string }): RawShape {
  return {
    type: 'geo',
    subType: 'rectangle',
    bounds: box(0, 0, 100, 100),
    text: '',
    ...overrides,
  }
}

describe('assignHandles', () => {
  it('numbers shapes S1, S2, … in reading order', () => {
    const shapes = [
      raw({ id: 'c', bounds: box(0, 300, 100, 400) }),
      raw({ id: 'a', bounds: box(0, 0, 100, 100) }),
      raw({ id: 'b', bounds: box(0, 150, 100, 250) }),
    ]
    expect(assignHandles(shapes).map((s) => [s.handle, s.id])).toEqual([
      ['S1', 'a'],
      ['S2', 'b'],
      ['S3', 'c'],
    ])
  })

  it('orders left-to-right within the same row', () => {
    const shapes = [
      raw({ id: 'right', bounds: box(400, 10, 500, 90) }),
      raw({ id: 'left', bounds: box(0, 0, 100, 100) }),
    ]
    // Both sit on roughly the same row, so x decides.
    expect(assignHandles(shapes).map((s) => s.id)).toEqual(['left', 'right'])
  })

  it('treats a clearly lower shape as a later row even if further left', () => {
    const shapes = [
      raw({ id: 'lower-left', bounds: box(0, 500, 100, 600) }),
      raw({ id: 'upper-right', bounds: box(400, 0, 500, 100) }),
    ]
    expect(assignHandles(shapes).map((s) => s.id)).toEqual(['upper-right', 'lower-left'])
  })

  it('returns an empty list for an empty board', () => {
    expect(assignHandles([])).toEqual([])
  })

  it('carries the arrow tip and direction through', () => {
    const arrow = raw({
      id: 'arr',
      type: 'arrow',
      bounds: box(100, 200, 300, 210),
      arrow: { start: { x: 100, y: 205 }, end: { x: 300, y: 205 } },
    })
    const [scene] = assignHandles([arrow])
    expect(scene.tip).toEqual({ x: 300, y: 205 })
    expect(scene.direction).toBe('right')
  })

  it('derives each compass direction from the arrow vector', () => {
    const at = (start: { x: number; y: number }, end: { x: number; y: number }) =>
      assignHandles([raw({ id: 'a', type: 'arrow', arrow: { start, end } })])[0].direction

    expect(at({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe('right')
    expect(at({ x: 100, y: 0 }, { x: 0, y: 0 })).toBe('left')
    expect(at({ x: 0, y: 0 }, { x: 0, y: 100 })).toBe('down')
    expect(at({ x: 0, y: 100 }, { x: 0, y: 0 })).toBe('up')
  })

  it('uses the dominant axis for a diagonal arrow', () => {
    const direction = assignHandles([
      raw({ id: 'a', type: 'arrow', arrow: { start: { x: 0, y: 0 }, end: { x: 200, y: 40 } } }),
    ])[0].direction
    expect(direction).toBe('right')
  })
})

describe('describeScene', () => {
  const viewport = box(0, 0, 1200, 800)

  it('states the visible area', () => {
    expect(describeScene([], viewport, null)).toContain('0,0')
    expect(describeScene([], viewport, null)).toContain('1200')
  })

  it('says so plainly when the board is empty', () => {
    expect(describeScene([], viewport, null)).toMatch(/empty/i)
  })

  it('lists each shape with its handle, type, bounds and text', () => {
    const shapes = assignHandles([
      raw({ id: 'a', bounds: box(200, 200, 380, 290), text: 'Cache' }),
    ])
    const description = describeScene(shapes, viewport, null)

    expect(description).toContain('S1')
    expect(description).toContain('200,200')
    expect(description).toContain('380,290')
    expect(description).toContain('Cache')
  })

  it('reports an arrow’s tip and heading', () => {
    const shapes = assignHandles([
      raw({
        id: 'arr',
        type: 'arrow',
        bounds: box(390, 240, 520, 250),
        arrow: { start: { x: 390, y: 245 }, end: { x: 520, y: 245 } },
      }),
    ])
    const description = describeScene(shapes, viewport, null)

    expect(description).toContain('520,245')
    expect(description).toMatch(/right/)
  })

  it('calls out the pointer shape and its handle', () => {
    const shapes = assignHandles([
      raw({ id: 'a', bounds: box(0, 0, 100, 100), text: 'one' }),
      raw({ id: 'b', bounds: box(0, 200, 100, 300), text: 'two' }),
    ])
    const description = describeScene(shapes, viewport, shapes[1])

    expect(description).toMatch(/POINTER/i)
    expect(description).toContain('S2')
  })

  it('tells the model to continue from the tip when the pointer is an arrow', () => {
    const shapes = assignHandles([
      raw({
        id: 'arr',
        type: 'arrow',
        bounds: box(390, 240, 520, 250),
        arrow: { start: { x: 390, y: 245 }, end: { x: 520, y: 245 } },
      }),
    ])
    const description = describeScene(shapes, viewport, shapes[0])
    expect(description).toContain('"side":"tip"')
  })

  it('omits the pointer section entirely when there is none', () => {
    const shapes = assignHandles([raw({ id: 'a' })])
    expect(describeScene(shapes, viewport, null)).not.toMatch(/POINTER/i)
  })

  it('describes handwriting as a drawing rather than dropping it', () => {
    // A draw shape has no text; without an entry the model can't refer to it.
    const shapes = assignHandles([raw({ id: 'd', type: 'draw', bounds: box(10, 10, 90, 60) })])
    const description = describeScene(shapes, viewport, null)

    expect(description).toContain('S1')
    expect(description).toMatch(/draw|handwriting|sketch/i)
  })

  it('collapses long shape text so one verbose note cannot flood the prompt', () => {
    const shapes = assignHandles([raw({ id: 'a', text: 'x'.repeat(500) })])
    const description = describeScene(shapes, viewport, null)
    expect(description.length).toBeLessThan(400)
  })
})

describe('pickPointer', () => {
  const shapes = () =>
    assignHandles([
      raw({ id: 'a', bounds: box(0, 0, 100, 100) }),
      raw({ id: 'b', bounds: box(0, 200, 100, 300) }),
      raw({ id: 'c', bounds: box(0, 400, 100, 500) }),
    ])

  it('prefers a single selected shape', () => {
    expect(pickPointer(shapes(), ['b'], 'c')?.id).toBe('b')
  })

  it('falls back to the last edited shape when nothing is selected', () => {
    expect(pickPointer(shapes(), [], 'c')?.id).toBe('c')
  })

  it('returns null when there is no selection and no edit history', () => {
    expect(pickPointer(shapes(), [], null)).toBeNull()
  })

  it('ignores a selection id that no longer exists', () => {
    expect(pickPointer(shapes(), ['deleted'], 'a')?.id).toBe('a')
  })

  it('ignores a stale last-edited id', () => {
    expect(pickPointer(shapes(), [], 'deleted')).toBeNull()
  })

  it('uses the first selected shape when several are selected', () => {
    // A multi-selection still gives a usable anchor rather than none.
    expect(pickPointer(shapes(), ['b', 'c'], null)?.id).toBe('b')
  })
})
