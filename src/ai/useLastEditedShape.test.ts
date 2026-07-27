import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Editor } from 'tldraw'
import { useLastEditedShape } from './useLastEditedShape'

type Listener = (entry: {
  changes: {
    added: Record<string, { id: string; typeName: string }>
    updated: Record<string, [{ id: string; typeName: string }, { id: string; typeName: string }]>
    removed: Record<string, { id: string; typeName: string }>
  }
}) => void

/** Editor stub that lets the test drive store events by hand. */
function stubEditor() {
  let listener: Listener | null = null
  let unlistened = false

  const editor = {
    store: {
      listen: (fn: Listener) => {
        listener = fn
        return () => {
          unlistened = true
        }
      },
    },
  } as unknown as Editor

  const shape = (id: string) => ({ id, typeName: 'shape' })

  return {
    editor,
    wasUnlistened: () => unlistened,
    added: (...ids: string[]) =>
      listener?.({
        changes: {
          added: Object.fromEntries(ids.map((id) => [id, shape(id)])),
          updated: {},
          removed: {},
        },
      }),
    updated: (...ids: string[]) =>
      listener?.({
        changes: {
          added: {},
          updated: Object.fromEntries(ids.map((id) => [id, [shape(id), shape(id)]])),
          removed: {},
        },
      }),
    removed: (...ids: string[]) =>
      listener?.({
        changes: {
          added: {},
          updated: {},
          removed: Object.fromEntries(ids.map((id) => [id, shape(id)])),
        },
      }),
    addedNonShape: () =>
      listener?.({
        changes: {
          added: { 'camera:x': { id: 'camera:x', typeName: 'camera' } },
          updated: {},
          removed: {},
        },
      }),
  }
}

describe('useLastEditedShape', () => {
  it('starts with nothing', () => {
    const { editor } = stubEditor()
    const { result } = renderHook(() => useLastEditedShape(editor))
    expect(result.current.current).toBeNull()
  })

  it('records a newly drawn shape', () => {
    const stub = stubEditor()
    const { result } = renderHook(() => useLastEditedShape(stub.editor))

    stub.added('shape:a')
    expect(result.current.current).toBe('shape:a')
  })

  it('records an edited shape', () => {
    const stub = stubEditor()
    const { result } = renderHook(() => useLastEditedShape(stub.editor))

    stub.updated('shape:b')
    expect(result.current.current).toBe('shape:b')
  })

  it('keeps the most recent of several events', () => {
    const stub = stubEditor()
    const { result } = renderHook(() => useLastEditedShape(stub.editor))

    stub.added('shape:a')
    stub.added('shape:b')
    expect(result.current.current).toBe('shape:b')
  })

  it('prefers a newly added shape over one merely updated in the same event', () => {
    const stub = stubEditor()
    const { result } = renderHook(() => useLastEditedShape(stub.editor))

    stub.added('shape:new')
    stub.updated('shape:old')
    stub.added('shape:newest')
    expect(result.current.current).toBe('shape:newest')
  })

  it('ignores non-shape records such as camera moves', () => {
    const stub = stubEditor()
    const { result } = renderHook(() => useLastEditedShape(stub.editor))

    stub.added('shape:a')
    stub.addedNonShape()
    expect(result.current.current).toBe('shape:a')
  })

  it('forgets a shape once it is deleted', () => {
    const stub = stubEditor()
    const { result } = renderHook(() => useLastEditedShape(stub.editor))

    stub.added('shape:a')
    stub.removed('shape:a')
    expect(result.current.current).toBeNull()
  })

  it('keeps the pointer when a different shape is deleted', () => {
    const stub = stubEditor()
    const { result } = renderHook(() => useLastEditedShape(stub.editor))

    stub.added('shape:a')
    stub.removed('shape:other')
    expect(result.current.current).toBe('shape:a')
  })

  it('unsubscribes on unmount', () => {
    const stub = stubEditor()
    const { unmount } = renderHook(() => useLastEditedShape(stub.editor))

    unmount()
    expect(stub.wasUnlistened()).toBe(true)
  })
})
