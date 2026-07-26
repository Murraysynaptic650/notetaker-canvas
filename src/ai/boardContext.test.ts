import { describe, expect, it } from 'vitest'
import type { Editor, TLShape } from 'tldraw'
import {
  boardFingerprint,
  getSelectedShapeIds,
  summarizeBoardText,
  summarizeSelection,
} from './boardContext'

/**
 * Minimal shape record — only the fields these functions actually read.
 * `id` is loosened to a plain string: TLShapeId is a branded type that would
 * otherwise force a cast at every call site in this file.
 */
function shape(partial: Omit<Partial<TLShape>, 'id'> & { id: string }): TLShape {
  return {
    x: 0,
    y: 0,
    rotation: 0,
    props: {},
    ...partial,
  } as unknown as TLShape
}

/** Editor stub backed by a fixed list of page shapes. */
function stubEditor(shapes: TLShape[], selectedIds: string[] = []) {
  return {
    getCurrentPageShapes: () => shapes,
    getSelectedShapeIds: () => selectedIds,
    getShape: (id: string) => shapes.find((s) => s.id === id),
  } as unknown as Editor
}

/** tldraw rich text: a ProseMirror-ish nested document. */
function richText(...paragraphs: string[]) {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  }
}

describe('summarizeBoardText', () => {
  it('reports an empty board explicitly', () => {
    expect(summarizeBoardText(stubEditor([]))).toBe('(The board is currently empty.)')
  })

  it('extracts plain text props', () => {
    const editor = stubEditor([shape({ id: 'a', props: { text: 'hello' } })])
    expect(summarizeBoardText(editor)).toBe('hello')
  })

  it('flattens nested rich text into plain text', () => {
    const editor = stubEditor([shape({ id: 'a', props: { richText: richText('first', 'second') } })])
    expect(summarizeBoardText(editor)).toBe('firstsecond')
  })

  it('lists each shape on its own line', () => {
    const editor = stubEditor([
      shape({ id: 'a', props: { text: 'one' } }),
      shape({ id: 'b', props: { text: 'two' } }),
    ])
    expect(summarizeBoardText(editor)).toBe('one\ntwo')
  })

  it('skips shapes with no text, such as freehand drawings', () => {
    const editor = stubEditor([
      shape({ id: 'draw', props: { segments: [{ points: [] }] } }),
      shape({ id: 'a', props: { text: 'labelled' } }),
    ])
    expect(summarizeBoardText(editor)).toBe('labelled')
  })

  it('skips whitespace-only text', () => {
    const editor = stubEditor([shape({ id: 'a', props: { text: '   ' } })])
    expect(summarizeBoardText(editor)).toBe('(The board is currently empty.)')
  })

  it('truncates past the character budget with an ellipsis', () => {
    const editor = stubEditor([shape({ id: 'a', props: { text: 'x'.repeat(100) } })])
    const summary = summarizeBoardText(editor, 20)
    expect(summary).toHaveLength(21) // 20 chars + '…'
    expect(summary.endsWith('…')).toBe(true)
  })

  it('leaves text within budget untouched', () => {
    const editor = stubEditor([shape({ id: 'a', props: { text: 'short' } })])
    expect(summarizeBoardText(editor, 20)).toBe('short')
  })
})

describe('summarizeSelection', () => {
  it('summarizes only the selected shapes', () => {
    const shapes = [
      shape({ id: 'a', props: { text: 'selected' } }),
      shape({ id: 'b', props: { text: 'not selected' } }),
    ]
    expect(summarizeSelection(stubEditor(shapes, ['a']))).toBe('selected')
  })

  it('reports when the selection carries no text', () => {
    const shapes = [shape({ id: 'a', props: { segments: [] } })]
    expect(summarizeSelection(stubEditor(shapes, ['a']))).toBe(
      '(The selected shapes have no text.)',
    )
  })

  it('ignores selected ids that no longer resolve to a shape', () => {
    const shapes = [shape({ id: 'a', props: { text: 'kept' } })]
    expect(summarizeSelection(stubEditor(shapes, ['a', 'deleted']))).toBe('kept')
  })
})

describe('getSelectedShapeIds', () => {
  it('returns a copy of the selection', () => {
    const selected = ['a', 'b']
    const ids = getSelectedShapeIds(stubEditor([], selected))
    expect(ids).toEqual(['a', 'b'])
    expect(ids).not.toBe(selected) // caller must not mutate tldraw's array
  })

  it('returns an empty array when nothing is selected', () => {
    expect(getSelectedShapeIds(stubEditor([]))).toEqual([])
  })
})

describe('boardFingerprint', () => {
  it('is stable across calls when nothing changed', () => {
    const shapes = [shape({ id: 'a', x: 10, y: 20, props: { text: 'hi' } })]
    const editor = stubEditor(shapes)
    expect(boardFingerprint(editor)).toBe(boardFingerprint(editor))
  })

  it('changes when a shape moves', () => {
    const before = boardFingerprint(stubEditor([shape({ id: 'a', x: 0, y: 0 })]))
    const after = boardFingerprint(stubEditor([shape({ id: 'a', x: 50, y: 0 })]))
    expect(before).not.toBe(after)
  })

  it('changes when a shape rotates', () => {
    const before = boardFingerprint(stubEditor([shape({ id: 'a', rotation: 0 })]))
    const after = boardFingerprint(stubEditor([shape({ id: 'a', rotation: 1.5 })]))
    expect(before).not.toBe(after)
  })

  it('changes when text is edited', () => {
    const before = boardFingerprint(stubEditor([shape({ id: 'a', props: { text: 'draft' } })]))
    const after = boardFingerprint(stubEditor([shape({ id: 'a', props: { text: 'final' } })]))
    expect(before).not.toBe(after)
  })

  it('changes when a handwriting stroke is added', () => {
    // Drawings live in props.segments — the fingerprint must notice them, or
    // auto-watch would never fire for sketching.
    const before = boardFingerprint(stubEditor([shape({ id: 'a', props: { segments: [1] } })]))
    const after = boardFingerprint(stubEditor([shape({ id: 'a', props: { segments: [1, 2] } })]))
    expect(before).not.toBe(after)
  })

  it('changes when a shape is added or removed', () => {
    const one = boardFingerprint(stubEditor([shape({ id: 'a' })]))
    const two = boardFingerprint(stubEditor([shape({ id: 'a' }), shape({ id: 'b' })]))
    expect(one).not.toBe(two)
  })

  it('ignores sub-pixel drift so tiny jitter does not re-trigger the AI', () => {
    const before = boardFingerprint(stubEditor([shape({ id: 'a', x: 10, y: 10 })]))
    const after = boardFingerprint(stubEditor([shape({ id: 'a', x: 10.4, y: 10.2 })]))
    expect(before).toBe(after)
  })

  it('is empty for a board with no shapes', () => {
    expect(boardFingerprint(stubEditor([]))).toBe('')
  })
})
