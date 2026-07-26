import { useCallback, useSyncExternalStore } from 'react'
import type { Editor } from 'tldraw'

/**
 * Subscribes to the tldraw store and re-derives a value whenever anything
 * changes, without depending on tldraw's `track`/`useEditor` hooks — only on
 * `Editor.store.listen`, a stable low-level API.
 *
 * Built on `useSyncExternalStore` rather than useState + useEffect: it reads the
 * store during render, so there's no window between the first paint and the
 * subscription in which a change could be missed, and no setState-in-effect
 * cascade. `selector` must return a primitive (or a stable reference) — a fresh
 * object on every call would re-render forever.
 */
export function useEditorState<T>(editor: Editor, selector: (editor: Editor) => T): T {
  const subscribe = useCallback(
    (onChange: () => void) => editor.store.listen(onChange, { source: 'user', scope: 'all' }),
    [editor],
  )

  return useSyncExternalStore(
    subscribe,
    () => selector(editor),
    () => selector(editor),
  )
}
