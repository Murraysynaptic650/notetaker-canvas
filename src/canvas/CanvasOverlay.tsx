import { useEffect, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import { isPenModeEnabled, isTouchDevice, setPenMode } from './ipadTuning'
import { useEditorState } from './useEditorState'
import { useExport } from '../export/useExport'
import { useBoardFile } from '../export/useBoardFile'
import './CanvasOverlay.css'

interface CanvasOverlayProps {
  editor: Editor
}

/**
 * Floating controls layered on top of the tldraw canvas. Rendered as a plain
 * sibling <div> positioned over the canvas — not via tldraw's component
 * injection — so it only depends on the `Editor` object and `store.listen`,
 * both stable low-level APIs, rather than tldraw's `track`/`useEditor` hooks.
 *
 * Pinned to the top-LEFT, below tldraw's own menu button: tldraw's own UI
 * occupies top-right (style panel) and bottom-right (zoom/navigation), so
 * those are off-limits for custom controls.
 */
export function CanvasOverlay({ editor }: CanvasOverlayProps) {
  const [showPencilToggle, setShowPencilToggle] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const { isExporting, error: exportError, runExport, clearError: clearExportError } = useExport(editor)
  const {
    isBusy: isBoardFileBusy,
    error: boardFileError,
    saveBoard,
    loadBoard,
    clearError: clearBoardFileError,
  } = useBoardFile(editor)
  const loadInputRef = useRef<HTMLInputElement>(null)

  const isBusy = isExporting || isBoardFileBusy
  const error = exportError ?? boardFileError
  const clearError = () => {
    clearExportError()
    clearBoardFileError()
  }

  useEffect(() => {
    setShowPencilToggle(isTouchDevice())
  }, [])

  const penMode = useEditorState(editor, isPenModeEnabled)
  const hasSelection = useEditorState(
    editor,
    (e) => e.getSelectedShapeIds().length > 0,
  )
  const hasShapes = useEditorState(editor, (e) => e.getCurrentPageShapeIds().size > 0)

  const runMenuAction = (action: () => void) => {
    setIsMenuOpen(false)
    action()
  }

  const clearBoard = () => {
    const ids = [...editor.getCurrentPageShapeIds()]
    if (ids.length === 0) return
    if (!window.confirm('Clear the entire board? You can undo this with Cmd/Ctrl+Z.')) return
    // Single history entry, so one undo restores everything.
    editor.run(() => editor.deleteShapes(ids))
  }

  return (
    <div className="canvas-overlay">
      {showPencilToggle && (
        <button
          type="button"
          className={`overlay-btn${penMode ? ' overlay-btn--active' : ''}`}
          aria-pressed={penMode}
          title={
            penMode
              ? 'Pencil-only drawing is on (fingers pan/zoom). Tap to allow finger drawing.'
              : 'Allow finger drawing. Tap to require Apple Pencil for drawing.'
          }
          onClick={() => setPenMode(editor, !penMode)}
        >
          {penMode ? '✏️ Pencil only' : '👆 Touch draw'}
        </button>
      )}

      <div className="overlay-menu">
        <button
          type="button"
          className="overlay-btn"
          disabled={isBusy}
          title="Export or save the board"
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          {isBusy ? '⏳ Working…' : '⬆︎ Board ▾'}
        </button>

        {isMenuOpen && (
          <div className="overlay-menu-list">
            <button
              type="button"
              onClick={() => runMenuAction(() => void runExport('png'))}
            >
              {hasSelection ? 'Export selection (PNG)' : 'Export (PNG)'}
            </button>
            <button type="button" onClick={() => runMenuAction(() => void runExport('svg'))}>
              Export (SVG)
            </button>
            <button type="button" onClick={() => runMenuAction(() => void saveBoard())}>
              💾 Save board
            </button>
            <button
              type="button"
              onClick={() => runMenuAction(() => loadInputRef.current?.click())}
            >
              📂 Load board
            </button>
            <button
              type="button"
              className="overlay-menu-danger"
              disabled={!hasShapes}
              onClick={() => runMenuAction(clearBoard)}
            >
              🧹 Clear board
            </button>
          </div>
        )}
      </div>

      <input
        ref={loadInputRef}
        type="file"
        accept=".tldr,application/json"
        className="overlay-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void loadBoard(file)
        }}
      />

      {error && (
        <div className="overlay-error" role="alert" onClick={clearError}>
          {error}
        </div>
      )}
    </div>
  )
}
