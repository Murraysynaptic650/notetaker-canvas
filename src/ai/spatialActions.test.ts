import { describe, expect, it, vi } from 'vitest'
import type { Editor, TLShapePartial } from 'tldraw'
import { applyBoardActions } from './boardActions'
import { assignHandles, type SceneShape } from './sceneGraph'
import type { Bounds } from './geometry'

const box = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({
  minX,
  minY,
  maxX,
  maxY,
})

/** A scene with one 180x90 "Cache" box at (200,200) and an arrow out of it. */
function scene(): SceneShape[] {
  return assignHandles([
    {
      id: 'shape:cache',
      type: 'geo',
      subType: 'rectangle',
      bounds: box(200, 200, 380, 290),
      text: 'Cache',
    },
    {
      id: 'shape:arrow',
      type: 'arrow',
      bounds: box(390, 240, 520, 250),
      text: '',
      arrow: { start: { x: 390, y: 245 }, end: { x: 520, y: 245 } },
    },
  ])
}

function stubEditor() {
  const shapes: TLShapePartial[] = []
  const bindings: Array<Record<string, unknown>> = []
  const updates: TLShapePartial[] = []

  const editor = {
    createShape: vi.fn((shape: TLShapePartial) => {
      shapes.push(shape)
    }),
    updateShape: vi.fn((shape: TLShapePartial) => {
      updates.push(shape)
    }),
    createBinding: vi.fn((binding: Record<string, unknown>) => {
      bindings.push(binding)
    }),
    createAssets: vi.fn(),
    store: { mergeRemoteChanges: (fn: () => void) => fn() },
  } as unknown as Editor

  return { editor, shapes, bindings, updates }
}

describe('anchor-relative placement', () => {
  it('places a note to the right of a handle', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(
      editor,
      [{ op: 'note', anchor: 'S1', side: 'right', gap: 40, text: 'next' }],
      scene(),
    )

    expect(shapes[0].x).toBe(420) // 380 + 40 — computed, not guessed
  })

  it('places a box at the tip of an arrow handle', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(
      editor,
      [{ op: 'geo', shape: 'rectangle', anchor: 'S2', side: 'tip', w: 180, h: 90, text: 'Next' }],
      scene(),
    )

    expect(shapes[0].x).toBe(520) // the arrow's tip
    expect(shapes[0].y).toBe(200) // centred on the tip (245 - 90/2)
  })

  it('places below an anchor', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(
      editor,
      [{ op: 'geo', shape: 'rectangle', anchor: 'S1', side: 'below', gap: 30, w: 180, h: 90 }],
      scene(),
    )

    expect(shapes[0].y).toBe(320) // 290 + 30
    expect(shapes[0].x).toBe(200) // centred under the anchor
  })

  it('accepts a lowercase handle', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [{ op: 'note', anchor: 's1', side: 'right', gap: 40 }], scene())
    expect(shapes[0].x).toBe(420)
  })

  it('falls back to absolute coordinates for an unknown handle', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(
      editor,
      [{ op: 'note', anchor: 'S99', x: 700, y: 700, text: 'somewhere' }],
      scene(),
    )

    expect(shapes[0]).toMatchObject({ x: 700, y: 700 })
  })

  it('still honours absolute coordinates when no anchor is given', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [{ op: 'note', x: 900, y: 100, text: 'abs' }], scene())
    expect(shapes[0]).toMatchObject({ x: 900, y: 100 })
  })

  it('works with no scene at all, as before', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [{ op: 'note', x: 10, y: 20, text: 'plain' }])
    expect(shapes[0]).toMatchObject({ x: 10, y: 20 })
  })

  it('does not stack two shapes anchored to the same side', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(
      editor,
      [
        { op: 'geo', shape: 'rectangle', anchor: 'S1', side: 'below', w: 180, h: 90, text: 'A' },
        { op: 'geo', shape: 'rectangle', anchor: 'S1', side: 'below', w: 180, h: 90, text: 'B' },
      ],
      scene(),
    )

    expect(shapes).toHaveLength(2)
    expect(shapes[0].y).not.toBe(shapes[1].y)
  })

  it('avoids landing on top of an existing shape', () => {
    const { editor, shapes } = stubEditor()
    // Anchoring left of the arrow lands on the Cache box; it must be pushed clear.
    applyBoardActions(
      editor,
      [{ op: 'geo', shape: 'rectangle', anchor: 'S2', side: 'left', gap: 0, w: 180, h: 90 }],
      scene(),
    )

    const placed = box(
      shapes[0].x as number,
      shapes[0].y as number,
      (shapes[0].x as number) + 180,
      (shapes[0].y as number) + 90,
    )
    const cache = box(200, 200, 380, 290)
    const hit =
      placed.minX < cache.maxX &&
      placed.maxX > cache.minX &&
      placed.minY < cache.maxY &&
      placed.maxY > cache.minY
    expect(hit).toBe(false)
  })

  it('does not treat arrows as blocking space', () => {
    // The arrow S2 sits immediately right of S1. A note anchored there should
    // land at the arrow, not be shoved past it — flowcharts are mostly arrows.
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [{ op: 'note', anchor: 'S1', side: 'right', gap: 40 }], scene())
    expect(shapes[0].x).toBe(420)
  })
})

describe('arrows bound to handles', () => {
  it('creates bindings for from/to instead of a floating arrow', () => {
    const { editor, shapes, bindings } = stubEditor()
    applyBoardActions(editor, [{ op: 'arrow', from: 'S1', to: 'S2' }], scene())

    expect(shapes[0].type).toBe('arrow')
    expect(bindings).toHaveLength(2)
    expect(bindings[0]).toMatchObject({
      type: 'arrow',
      toId: 'shape:cache',
      props: { terminal: 'start' },
    })
    expect(bindings[1]).toMatchObject({ toId: 'shape:arrow', props: { terminal: 'end' } })
  })

  it('binds only the end when just `to` is given', () => {
    const { editor, bindings } = stubEditor()
    applyBoardActions(editor, [{ op: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10, to: 'S1' }], scene())

    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toMatchObject({ props: { terminal: 'end' } })
  })

  it('ignores unknown handles and leaves that end unbound', () => {
    const { editor, shapes, bindings } = stubEditor()
    applyBoardActions(editor, [{ op: 'arrow', from: 'S1', to: 'S99' }], scene())

    expect(shapes).toHaveLength(1)
    expect(bindings).toHaveLength(1) // only the resolvable end
  })

  it('still supports raw coordinate arrows', () => {
    const { editor, shapes, bindings } = stubEditor()
    applyBoardActions(editor, [{ op: 'arrow', x1: 0, y1: 0, x2: 100, y2: 50 }], scene())

    expect(shapes[0].props).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 100, y: 50 } })
    expect(bindings).toHaveLength(0)
  })

  it('seeds terminals at the two anchors’ centres', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [{ op: 'arrow', from: 'S1', to: 'S2' }], scene())

    expect(shapes[0].props).toMatchObject({
      start: { x: 290, y: 245 },
      end: { x: 455, y: 245 },
    })
  })
})

describe('referring to shapes created in the same reply', () => {
  it('connects an arrow to a box the same batch just created', () => {
    // "Complete this flowchart" needs exactly this: add a node, then wire it up.
    const { editor, shapes, bindings } = stubEditor()
    applyBoardActions(
      editor,
      [
        { op: 'geo', shape: 'rectangle', anchor: 'S2', side: 'tip', w: 180, h: 90, text: 'DB' },
        { op: 'arrow', from: 'S1', to: 'N1' },
      ],
      scene(),
    )

    expect(shapes).toHaveLength(2)
    expect(bindings).toHaveLength(2)
    // The new box's real id, not a handle string.
    expect(String(bindings[1].toId)).toBe(String(shapes[0].id))
  })

  it('numbers created shapes N1, N2, … in order', () => {
    const { editor, shapes, bindings } = stubEditor()
    applyBoardActions(
      editor,
      [
        { op: 'note', anchor: 'S1', side: 'below', text: 'first' },
        { op: 'note', anchor: 'S1', side: 'right', text: 'second' },
        { op: 'arrow', from: 'N1', to: 'N2' },
      ],
      scene(),
    )

    expect(String(bindings[0].toId)).toBe(String(shapes[0].id))
    expect(String(bindings[1].toId)).toBe(String(shapes[1].id))
  })

  it('lets a new shape be anchored to another new shape', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(
      editor,
      [
        { op: 'geo', shape: 'rectangle', x: 0, y: 0, w: 100, h: 100 },
        { op: 'geo', shape: 'rectangle', anchor: 'N1', side: 'right', gap: 20, w: 100, h: 100 },
      ],
      scene(),
    )

    expect(shapes[1].x).toBe(120) // 100 + 20, relative to the first new shape
  })
})

describe('update op', () => {
  it('rewrites the text of an existing shape', () => {
    const { editor, updates } = stubEditor()
    applyBoardActions(editor, [{ op: 'update', target: 'S1', text: 'Cache (LRU)' }], scene())

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ id: 'shape:cache' })
  })

  it('ignores an update to an unknown handle', () => {
    const { editor, updates } = stubEditor()
    applyBoardActions(editor, [{ op: 'update', target: 'S99', text: 'nope' }], scene())
    expect(updates).toHaveLength(0)
  })

  it('ignores an update with no scene to resolve against', () => {
    const { editor, updates } = stubEditor()
    applyBoardActions(editor, [{ op: 'update', target: 'S1', text: 'nope' }])
    expect(updates).toHaveLength(0)
  })

  it('does not report updated shapes as newly created', () => {
    const { editor } = stubEditor()
    const ids = applyBoardActions(editor, [{ op: 'update', target: 'S1', text: 'x' }], scene())
    expect(ids).toEqual([])
  })
})
