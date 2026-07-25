import type { Editor } from 'tldraw'

/** Extension for the app's own save format — a full tldraw document snapshot. */
export const BOARD_FILE_FORMAT = 'tldr'

/**
 * Serialize the whole board (all pages, not just the current selection) to
 * a JSON blob. Saving this file into iCloud Drive and opening it on another
 * device via "Load board" is how the board follows you across devices,
 * since there's no live sync server — it's manual, file-based continuity.
 */
export function exportBoardSnapshot(editor: Editor): Blob {
  const snapshot = editor.getSnapshot()
  return new Blob([JSON.stringify(snapshot)], { type: 'application/json' })
}

/**
 * Replace the current board with the contents of a previously exported
 * snapshot file.
 *
 * @throws if the file isn't valid JSON or isn't a tldraw snapshot.
 */
export async function importBoardSnapshot(editor: Editor, file: File): Promise<void> {
  const text = await file.text()

  let snapshot: unknown
  try {
    snapshot = JSON.parse(text)
  } catch {
    throw new Error('That file isn’t valid — expected a .tldr board file.')
  }

  if (typeof snapshot !== 'object' || snapshot === null) {
    throw new Error('That file isn’t a tldraw board snapshot.')
  }

  editor.loadSnapshot(snapshot as Parameters<Editor['loadSnapshot']>[0])
}
