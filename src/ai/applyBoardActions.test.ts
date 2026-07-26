import { describe, expect, it, vi } from 'vitest'
import type { Editor, TLShapePartial } from 'tldraw'
import { applyBoardActions } from './boardActions'

/**
 * Minimal Editor stub. `applyBoardActions` only calls createShape,
 * createAssets and store.mergeRemoteChanges, so we record those instead of
 * standing up a real tldraw instance.
 */
function stubEditor() {
  const shapes: TLShapePartial[] = []
  const assets: unknown[] = []
  let mergedRemotely = false

  const editor = {
    createShape: vi.fn((shape: TLShapePartial) => {
      shapes.push(shape)
    }),
    createAssets: vi.fn((created: unknown[]) => {
      assets.push(...created)
    }),
    store: {
      mergeRemoteChanges: (fn: () => void) => {
        mergedRemotely = true
        fn()
      },
    },
  } as unknown as Editor

  return { editor, shapes, assets, wasMerged: () => mergedRemotely }
}

describe('applyBoardActions', () => {
  it('creates a text shape', () => {
    const { editor, shapes } = stubEditor()
    const ids = applyBoardActions(editor, [{ op: 'text', x: 10, y: 20, text: 'hello' }])

    expect(ids).toHaveLength(1)
    expect(shapes[0]).toMatchObject({ type: 'text', x: 10, y: 20 })
  })

  it('creates a note shape', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [{ op: 'note', x: 1, y: 2, text: 'sticky' }])
    expect(shapes[0]).toMatchObject({ type: 'note', x: 1, y: 2 })
  })

  it('creates a geo shape with its dimensions', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [
      { op: 'geo', shape: 'ellipse', x: 5, y: 6, w: 120, h: 80, color: 'blue' },
    ])
    expect(shapes[0].props).toMatchObject({ geo: 'ellipse', w: 120, h: 80, color: 'blue' })
  })

  it('falls back to a rectangle for an unknown geo shape', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [{ op: 'geo', shape: 'dodecahedron', x: 0, y: 0 }])
    expect(shapes[0].props).toMatchObject({ geo: 'rectangle' })
  })

  it('falls back to black for an unknown colour', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [{ op: 'note', x: 0, y: 0, text: 'x', color: 'chartreuse' }])
    expect(shapes[0].props).toMatchObject({ color: 'black' })
  })

  it('clamps non-positive geo dimensions to at least 1', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [{ op: 'geo', shape: 'rectangle', x: 0, y: 0, w: 0, h: -50 }])
    expect(shapes[0].props).toMatchObject({ w: 1, h: 1 })
  })

  it('creates an arrow with start and end points', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [{ op: 'arrow', x1: 0, y1: 0, x2: 100, y2: 50 }])
    expect(shapes[0]).toMatchObject({ type: 'arrow' })
    expect(shapes[0].props).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 100, y: 50 } })
  })

  it('creates a line as an arrow with both arrowheads removed', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [{ op: 'line', x1: 0, y1: 0, x2: 10, y2: 10 }])
    expect(shapes[0].props).toMatchObject({ arrowheadStart: 'none', arrowheadEnd: 'none' })
  })

  it('creates an image plus its backing asset', () => {
    const { editor, shapes, assets } = stubEditor()
    const ids = applyBoardActions(editor, [
      { op: 'image', url: 'https://example.com/x.png', x: 0, y: 0, w: 100, h: 50 },
    ])

    expect(ids).toHaveLength(1)
    expect(assets).toHaveLength(1)
    expect(shapes[0]).toMatchObject({ type: 'image' })
  })

  it('skips an image op with no url', () => {
    const { editor, shapes } = stubEditor()
    expect(applyBoardActions(editor, [{ op: 'image', x: 0, y: 0 }])).toEqual([])
    expect(shapes).toHaveLength(0)
  })

  it('infers the mime type from a data URL', () => {
    const { editor, assets } = stubEditor()
    applyBoardActions(editor, [
      { op: 'image', url: 'data:image/jpeg;base64,AAAA', x: 0, y: 0, w: 10, h: 10 },
    ])
    expect((assets[0] as { props: { mimeType: string } }).props.mimeType).toBe('image/jpeg')
  })

  it('defaults missing coordinates to 0', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [{ op: 'note', text: 'no coords' }])
    expect(shapes[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('ignores NaN and non-numeric coordinates', () => {
    const { editor, shapes } = stubEditor()
    applyBoardActions(editor, [{ op: 'note', x: 'left', y: Number.NaN, text: 'x' }])
    expect(shapes[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('ignores an unknown op instead of throwing', () => {
    const { editor, shapes } = stubEditor()
    expect(applyBoardActions(editor, [{ op: 'summon' }])).toEqual([])
    expect(shapes).toHaveLength(0)
  })

  it('ignores null and non-object entries', () => {
    const { editor } = stubEditor()
    expect(applyBoardActions(editor, [null, 42, 'text', undefined])).toEqual([])
  })

  it('applies the good ops even when one op in the batch throws', () => {
    const { editor, shapes } = stubEditor()
    const createShape = editor.createShape as unknown as ReturnType<typeof vi.fn>
    createShape.mockImplementationOnce(() => {
      throw new Error('tldraw rejected that shape')
    })

    const ids = applyBoardActions(editor, [
      { op: 'note', x: 0, y: 0, text: 'bad' },
      { op: 'note', x: 10, y: 10, text: 'good' },
    ])

    expect(ids).toHaveLength(1)
    expect(shapes).toHaveLength(1)
  })

  it('marks the batch as a remote change so auto-watch does not loop', () => {
    // Without this the AI's own drawing reads as a user edit, which re-triggers
    // the watcher and the AI reacts to itself forever.
    const { editor, wasMerged } = stubEditor()
    applyBoardActions(editor, [{ op: 'note', x: 0, y: 0, text: 'x' }])
    expect(wasMerged()).toBe(true)
  })

  it('returns an id per created shape, in order', () => {
    const { editor } = stubEditor()
    const ids = applyBoardActions(editor, [
      { op: 'note', x: 0, y: 0, text: 'a' },
      { op: 'text', x: 0, y: 0, text: 'b' },
      { op: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1 },
    ])
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3) // ids are unique
  })

  it('does nothing for an empty batch', () => {
    const { editor, shapes } = stubEditor()
    expect(applyBoardActions(editor, [])).toEqual([])
    expect(shapes).toHaveLength(0)
  })
})
