import { useCallback, useState } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { applyIpadDefaults } from './ipadTuning'
import { CanvasOverlay } from './CanvasOverlay'
import { AiPanel } from '../ai/AiPanel'

/**
 * Local persistence key. tldraw stores the whole document in the browser's
 * IndexedDB under this key, so the board survives reloads and works offline.
 * Phase 3 swaps this for a tldraw sync connection for multi-device sync.
 */
const PERSISTENCE_KEY = 'notetaker-board-v1'

export function Whiteboard() {
  const [editor, setEditor] = useState<Editor | null>(null)

  const handleMount = useCallback((mountedEditor: Editor) => {
    applyIpadDefaults(mountedEditor)
    setEditor(mountedEditor)
  }, [])

  return (
    <div className="tldraw-host">
      <Tldraw persistenceKey={PERSISTENCE_KEY} onMount={handleMount} />
      {/* Rendered as a plain sibling, positioned over the canvas via CSS,
          rather than through tldraw's component-injection system. */}
      {editor && <CanvasOverlay editor={editor} />}
      {editor && <AiPanel editor={editor} />}
    </div>
  )
}
