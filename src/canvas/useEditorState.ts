import { useEffect, useState } from 'react'
import type { Editor } from 'tldraw'

/**
 * Subscribes to the tldraw store and re-derives a value whenever anything
 * changes, without depending on tldraw's `track`/`useEditor` hooks — only on
 * `Editor.store.listen`, a stable low-level API.
 */
export function useEditorState<T>(editor: Editor, selector: (editor: Editor) => T): T {
  const [value, setValue] = useState(() => selector(editor))

  useEffect(() => {
    setValue(selector(editor))
    const unsubscribe = editor.store.listen(
      () => setValue(selector(editor)),
      { source: 'user', scope: 'all' },
    )
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  return value
}
