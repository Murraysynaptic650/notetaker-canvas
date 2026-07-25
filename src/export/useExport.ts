import { useCallback, useState } from 'react'
import type { Editor, TLExportType } from 'tldraw'
import { exportBoardImage } from './exportBoard'
import { buildExportFilename } from './filename'
import { shareOrDownload } from './shareOrDownload'

export interface ExportState {
  isExporting: boolean
  error: string | null
}

const INITIAL_STATE: ExportState = { isExporting: false, error: null }

/**
 * Drives a board export: render → hand off via share sheet or download,
 * exposing progress and any user-facing error.
 */
export function useExport(editor: Editor) {
  const [state, setState] = useState<ExportState>(INITIAL_STATE)

  const runExport = useCallback(
    async (format: TLExportType) => {
      setState({ isExporting: true, error: null })

      try {
        const blob = await exportBoardImage(editor, { format })
        await shareOrDownload(blob, buildExportFilename(format))
        setState(INITIAL_STATE)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Export failed. Please try again.'
        setState({ isExporting: false, error: message })
      }
    },
    [editor],
  )

  const clearError = useCallback(() => {
    setState((previous) => ({ ...previous, error: null }))
  }, [])

  return { ...state, runExport, clearError }
}
