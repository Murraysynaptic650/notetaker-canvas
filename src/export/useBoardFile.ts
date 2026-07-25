import { useCallback, useState } from 'react'
import type { Editor } from 'tldraw'
import { BOARD_FILE_FORMAT, exportBoardSnapshot, importBoardSnapshot } from './boardFile'
import { buildExportFilename } from './filename'
import { shareOrDownload } from './shareOrDownload'

export interface BoardFileState {
  isBusy: boolean
  error: string | null
}

const INITIAL_STATE: BoardFileState = { isBusy: false, error: null }

/**
 * Save/load the board's own file format, for shuttling a board between
 * devices via iCloud Drive (Save → "Save to Files" into iCloud Drive → open
 * the same file with "Load board" on the other device).
 */
export function useBoardFile(editor: Editor) {
  const [state, setState] = useState<BoardFileState>(INITIAL_STATE)

  const saveBoard = useCallback(async () => {
    setState({ isBusy: true, error: null })
    try {
      const blob = exportBoardSnapshot(editor)
      await shareOrDownload(blob, buildExportFilename(BOARD_FILE_FORMAT))
      setState(INITIAL_STATE)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed. Please try again.'
      setState({ isBusy: false, error: message })
    }
  }, [editor])

  const loadBoard = useCallback(
    async (file: File) => {
      setState({ isBusy: true, error: null })
      try {
        await importBoardSnapshot(editor, file)
        setState(INITIAL_STATE)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Load failed. Please try again.'
        setState({ isBusy: false, error: message })
      }
    },
    [editor],
  )

  const clearError = useCallback(() => {
    setState((previous) => ({ ...previous, error: null }))
  }, [])

  return { ...state, saveBoard, loadBoard, clearError }
}
