import { useEffect, useRef, type MutableRefObject } from 'react'
import type { Editor, TLRecord } from 'tldraw'

/**
 * Tracks the shape the user most recently drew or edited.
 *
 * This is the fallback "pointer" for spatial grounding: when the user draws an
 * arrow and says "continue from here" without selecting anything, this is how
 * the app knows which shape "here" means.
 *
 * Returns a ref rather than state on purpose — this fires on every pen stroke,
 * and re-rendering the chat panel that often would be painful on an iPad. Only
 * the next request reads it.
 *
 * Scoped to `source: 'user'`, so shapes the AI itself creates (applied inside
 * `mergeRemoteChanges`) never become the pointer.
 */
export function useLastEditedShape(editor: Editor): MutableRefObject<string | null> {
  const lastEditedId = useRef<string | null>(null)

  useEffect(() => {
    const unlisten = editor.store.listen(
      (entry) => {
        const { added, updated, removed } = entry.changes

        // A shape the user deleted can't be pointed at any more.
        for (const record of Object.values(removed) as TLRecord[]) {
          if (record.id === lastEditedId.current) lastEditedId.current = null
        }

        // Prefer a freshly drawn shape over one merely nudged: creating
        // something is the stronger signal of where attention is.
        const addedShape = lastShapeId(Object.values(added) as TLRecord[])
        if (addedShape) {
          lastEditedId.current = addedShape
          return
        }

        const updatedShape = lastShapeId(
          (Object.values(updated) as [TLRecord, TLRecord][]).map(([, to]) => to),
        )
        if (updatedShape) lastEditedId.current = updatedShape
      },
      { source: 'user', scope: 'document' },
    )

    return unlisten
  }, [editor])

  return lastEditedId
}

/** The last shape id in a batch of records, ignoring non-shape records. */
function lastShapeId(records: TLRecord[]): string | null {
  const shapes = records.filter((record) => record.typeName === 'shape')
  return shapes.length > 0 ? String(shapes[shapes.length - 1].id) : null
}
