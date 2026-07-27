import { describe, expect, it } from 'vitest'
import type { Editor } from 'tldraw'
import { buildBoardScene, describeBoardScene } from './boardScene'

interface StubShape {
  id: string
  type: string
  x?: number
  y?: number
  props?: Record<string, unknown>
}

/** Editor stub exposing just what the scene reader touches. */
function stubEditor(shapes: StubShape[], selectedIds: string[] = []) {
  const bounds = new Map(
    shapes.map((shape) => [
      shape.id,
      {
        x: shape.x ?? 0,
        y: shape.y ?? 0,
        w: (shape.props?.w as number) ?? 100,
        h: (shape.props?.h as number) ?? 80,
      },
    ]),
  )

  return {
    getViewportPageBounds: () => ({ minX: 0, minY: 0, maxX: 1200, maxY: 800 }),
    getCurrentPageShapes: () => shapes,
    getSelectedShapeIds: () => selectedIds,
    getShapePageBounds: (shape: StubShape | string) => {
      const id = typeof shape === 'string' ? shape : shape.id
      const b = bounds.get(id)
      if (!b) return undefined
      return { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h }
    },
  } as unknown as Editor
}

describe('buildBoardScene', () => {
  it('reads shapes with handles and page bounds', () => {
    const editor = stubEditor([
      { id: 'a', type: 'geo', x: 200, y: 200, props: { geo: 'rectangle', w: 180, h: 90 } },
    ])
    const scene = buildBoardScene(editor, null)

    expect(scene.shapes).toHaveLength(1)
    expect(scene.shapes[0].handle).toBe('S1')
    expect(scene.shapes[0].subType).toBe('rectangle')
    expect(scene.shapes[0].bounds).toEqual({ minX: 200, minY: 200, maxX: 380, maxY: 290 })
  })

  it('extracts plain and rich text', () => {
    const editor = stubEditor([
      { id: 'a', type: 'note', y: 0, props: { text: 'plain' } },
      {
        id: 'b',
        type: 'geo',
        y: 300,
        props: {
          richText: { type: 'doc', content: [{ type: 'text', text: 'rich' }] },
        },
      },
    ])
    const scene = buildBoardScene(editor, null)
    expect(scene.shapes.map((s) => s.text)).toEqual(['plain', 'rich'])
  })

  it('converts arrow terminals from shape-local to page coordinates', () => {
    const editor = stubEditor([
      {
        id: 'arr',
        type: 'arrow',
        x: 100,
        y: 200,
        props: { start: { x: 0, y: 5 }, end: { x: 200, y: 5 } },
      },
    ])
    const scene = buildBoardScene(editor, null)

    expect(scene.shapes[0].tip).toEqual({ x: 300, y: 205 })
    expect(scene.shapes[0].direction).toBe('right')
  })

  it('skips shapes tldraw cannot give bounds for', () => {
    const editor = {
      getViewportPageBounds: () => ({ minX: 0, minY: 0, maxX: 100, maxY: 100 }),
      getCurrentPageShapes: () => [{ id: 'ghost', type: 'geo', props: {} }],
      getSelectedShapeIds: () => [],
      getShapePageBounds: () => undefined,
    } as unknown as Editor

    expect(buildBoardScene(editor, null).shapes).toEqual([])
  })

  it('resolves the pointer from the selection', () => {
    const editor = stubEditor(
      [
        { id: 'a', type: 'geo', y: 0 },
        { id: 'b', type: 'geo', y: 300 },
      ],
      ['b'],
    )
    expect(buildBoardScene(editor, null).pointer?.id).toBe('b')
  })

  it('falls back to the last edited shape when nothing is selected', () => {
    const editor = stubEditor([
      { id: 'a', type: 'geo', y: 0 },
      { id: 'b', type: 'geo', y: 300 },
    ])
    expect(buildBoardScene(editor, 'b')?.pointer?.id).toBe('b')
  })

  it('carries the viewport through', () => {
    const scene = buildBoardScene(stubEditor([]), null)
    expect(scene.viewport).toEqual({ minX: 0, minY: 0, maxX: 1200, maxY: 800 })
  })

  it('handles an empty board', () => {
    const scene = buildBoardScene(stubEditor([]), null)
    expect(scene.shapes).toEqual([])
    expect(scene.pointer).toBeNull()
  })

  it('renders a prompt section naming the pointer', () => {
    const editor = stubEditor(
      [{ id: 'a', type: 'geo', x: 200, y: 200, props: { geo: 'rectangle', w: 180, h: 90 } }],
      ['a'],
    )
    const text = describeBoardScene(buildBoardScene(editor, null))

    expect(text).toContain('S1')
    expect(text).toMatch(/POINTER/i)
  })
})
