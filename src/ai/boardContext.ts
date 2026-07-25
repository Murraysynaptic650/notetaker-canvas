import type { Editor, TLShape, TLShapeId } from 'tldraw'

// Cap the board snapshot's longest edge so vision token cost (and multimodal
// preprocessing load) stays bounded regardless of how big the board is. 1024px
// keeps handwriting legible while staying cheap. Downscaled images are re-encoded
// as JPEG; small boards keep their lossless PNG.
const MAX_IMAGE_EDGE = 1280
const JPEG_QUALITY = 0.85

/**
 * Render shapes to a PNG data URL so vision-capable models can actually *see*
 * the board — handwriting, sketches and diagrams included, not just
 * extractable text. Pass `shapeIds` to capture only a selection; omit it for
 * the whole page. Returns null when there's nothing to capture or export
 * fails, so callers can fall back to the text summary alone.
 */
export async function captureBoardImage(
  editor: Editor,
  shapeIds?: TLShapeId[],
): Promise<string | null> {
  const ids = shapeIds ?? [...editor.getCurrentPageShapeIds()]
  if (ids.length === 0) return null

  try {
    const result = await editor.toImage(ids, { format: 'png', background: true, scale: 1 })
    return await downscaleToDataUrl(result.blob)
  } catch {
    return null // vision is a bonus; never block the chat on export failure.
  }
}

/**
 * A cheap string that changes whenever the board's shapes change — position,
 * rotation or props (which covers handwriting strokes, typed text, geo, etc.).
 * Used to detect *real* edits for the auto-watch trigger, so drawings count
 * too, not just typed text.
 */
export function boardFingerprint(editor: Editor): string {
  return editor
    .getCurrentPageShapes()
    .map(
      (shape) =>
        `${shape.id}:${Math.round(shape.x)}:${Math.round(shape.y)}:${Math.round(
          shape.rotation * 100,
        )}:${JSON.stringify(shape.props)}`,
    )
    .join('|')
}

/**
 * Plain-text summary of what's typed on the board (text/note/geo labels).
 * Drawings are skipped — the image capture covers those.
 */
export function summarizeBoardText(editor: Editor, maxChars = 4000): string {
  return summarizeShapes(editor.getCurrentPageShapes(), maxChars, '(The board is currently empty.)')
}

export function getSelectedShapeIds(editor: Editor): TLShapeId[] {
  return [...editor.getSelectedShapeIds()]
}

/** Text summary of just the user's current selection (their "pointer"). */
export function summarizeSelection(editor: Editor, maxChars = 4000): string {
  const shapes = editor.getSelectedShapeIds().map((id) => editor.getShape(id))
  const present = shapes.filter((shape): shape is TLShape => Boolean(shape))
  return summarizeShapes(present, maxChars, '(The selected shapes have no text.)')
}

function summarizeShapes(shapes: TLShape[], maxChars: number, emptyText: string): string {
  const lines = shapes
    .map(extractShapeText)
    .filter((line): line is string => Boolean(line && line.trim()))

  if (lines.length === 0) return emptyText

  const joined = lines.join('\n')
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}…` : joined
}

function extractShapeText(shape: TLShape): string | null {
  const props = shape.props as Record<string, unknown>
  if (typeof props.text === 'string') return props.text
  if (typeof props.richText === 'object' && props.richText !== null) {
    return extractPlainTextFromRichText(props.richText)
  }
  return null
}

function extractPlainTextFromRichText(node: unknown): string {
  if (node === null || typeof node !== 'object') return ''
  const record = node as { text?: unknown; content?: unknown }
  const own = typeof record.text === 'string' ? record.text : ''
  const children = Array.isArray(record.content)
    ? record.content.map(extractPlainTextFromRichText).join('')
    : ''
  return own + children
}

/**
 * Shrink a board snapshot to at most MAX_IMAGE_EDGE on its longest side and
 * re-encode as JPEG. Boards already within the cap keep their lossless PNG.
 * Any failure falls back to the original PNG data URL — vision must never break
 * the chat.
 */
async function downscaleToDataUrl(blob: Blob): Promise<string> {
  try {
    const bitmap = await createImageBitmap(blob)
    const longest = Math.max(bitmap.width, bitmap.height)

    if (longest <= MAX_IMAGE_EDGE) {
      bitmap.close()
      return blobToDataUrl(blob)
    }

    const scale = MAX_IMAGE_EDGE / longest
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return blobToDataUrl(blob)
    }

    // JPEG has no alpha, so lay down the board's white background first.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  } catch {
    return blobToDataUrl(blob)
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read board image.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}
