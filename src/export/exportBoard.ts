import type { Editor, TLExportType, TLShapeId } from 'tldraw'

export interface ExportOptions {
  /** Image format. PNG is the safest choice for inserting into Apple Freeform. */
  format: TLExportType
  /** Multiplies the output resolution. 2 gives crisp results on Retina/iPad. */
  pixelRatio?: number
  /** Include the canvas background instead of exporting transparent. */
  background?: boolean
}

const DEFAULT_PIXEL_RATIO = 2

/**
 * Which shapes to export: the current selection if there is one, otherwise
 * every shape on the current page.
 */
export function getExportShapeIds(editor: Editor): TLShapeId[] {
  const selected = editor.getSelectedShapeIds()
  if (selected.length > 0) return [...selected]
  return [...editor.getCurrentPageShapeIds()]
}

/**
 * Render the board (or selection) to an image blob.
 *
 * @throws if the board is empty or tldraw fails to rasterise the shapes.
 */
export async function exportBoardImage(
  editor: Editor,
  options: ExportOptions,
): Promise<Blob> {
  const shapeIds = getExportShapeIds(editor)

  if (shapeIds.length === 0) {
    throw new Error('Nothing to export — draw something first.')
  }

  const { format, pixelRatio = DEFAULT_PIXEL_RATIO, background = true } = options

  const result = await editor.toImage(shapeIds, {
    format,
    background,
    // SVG is resolution-independent, so pixelRatio only applies to bitmaps.
    ...(format === 'svg' ? {} : { pixelRatio }),
  })

  return result.blob
}
