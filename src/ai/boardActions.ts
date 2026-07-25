import {
  AssetRecordType,
  createShapeId,
  toRichText,
  type Editor,
  type TLAsset,
  type TLDefaultColorStyle,
  type TLGeoShapeGeoStyle,
  type TLShapeId,
  type TLShapePartial,
} from 'tldraw'

/**
 * Lets the LLM draw/write on the whiteboard. The model may append a fenced
 * ```tldraw block containing a JSON array of draw ops; we parse it out of the
 * reply, apply the shapes, and hand back the reply with the block stripped so
 * the chat bubble stays clean.
 */

export interface ParsedReply {
  /** Reply text with any actions block removed. */
  text: string
  /** Raw ops the model asked us to draw (unvalidated). */
  actions: unknown[]
}

// Prefer a fenced block (```tldraw or ```json or bare ```), but small models
// often forget the fence, so we also fall back to a bare JSON array of ops.
const FENCED_BLOCK = /```(?:tldraw|json)?\s*([\s\S]*?)```/i
const BARE_ARRAY = /\[\s*\{[\s\S]*\}\s*\]/

const GEO_SHAPES = new Set([
  'rectangle', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon',
  'octagon', 'star', 'rhombus', 'oval', 'trapezoid', 'cloud', 'heart',
  'x-box', 'check-box', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down',
])

const COLORS = new Set([
  'black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue', 'yellow',
  'orange', 'green', 'light-green', 'light-red', 'red', 'white',
])

export function parseReply(raw: string): ParsedReply {
  // 1) Fenced block — the format we ask for.
  const fenced = raw.match(FENCED_BLOCK)
  if (fenced) {
    const actions = parseActions(fenced[1])
    if (actions) return { text: raw.replace(fenced[0], '').trim(), actions }
  }

  // 2) Fallback: a bare JSON array of ops the model dropped into the text.
  const bare = raw.match(BARE_ARRAY)
  if (bare) {
    const actions = parseActions(bare[0])
    if (actions && looksLikeActions(actions)) {
      return { text: raw.replace(bare[0], '').trim(), actions }
    }
  }

  return { text: raw.trim(), actions: [] }
}

function parseActions(text: string): unknown[] | null {
  try {
    const parsed = JSON.parse(text.trim())
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Guard the bare-array fallback so we only grab arrays that are actually draw ops. */
function looksLikeActions(actions: unknown[]): boolean {
  return actions.some(
    (action) =>
      action !== null && typeof action === 'object' && 'op' in (action as Record<string, unknown>),
  )
}

/**
 * Apply draw ops to the board. Marked as a "remote" change so the auto-watch
 * trigger doesn't treat the AI's own drawing as a user edit (which would loop).
 * Each op is applied independently so one bad op doesn't drop the whole batch.
 * Returns the ids created, so the caller can select/reveal them.
 */
export function applyBoardActions(editor: Editor, actions: unknown[]): TLShapeId[] {
  const created: TLShapeId[] = []
  editor.store.mergeRemoteChanges(() => {
    for (const action of actions) {
      try {
        const id = applyOne(editor, action)
        if (id) created.push(id)
      } catch {
        // Skip a single malformed op rather than failing the whole reply.
      }
    }
  })
  return created
}

function applyOne(editor: Editor, action: unknown): TLShapeId | null {
  if (!action || typeof action !== 'object') return null
  const op = action as Record<string, unknown>
  const color = pickColor(op.color)
  const id = newId()

  switch (String(op.op ?? '')) {
    case 'text':
      editor.createShape({
        id,
        type: 'text',
        x: num(op.x),
        y: num(op.y),
        props: { richText: toRichText(str(op.text)), color },
      } as TLShapePartial)
      return id
    case 'note':
      editor.createShape({
        id,
        type: 'note',
        x: num(op.x),
        y: num(op.y),
        props: { richText: toRichText(str(op.text)), color },
      } as TLShapePartial)
      return id
    case 'geo':
      editor.createShape({
        id,
        type: 'geo',
        x: num(op.x),
        y: num(op.y),
        props: {
          geo: pickGeo(op.shape),
          w: Math.max(1, num(op.w, 160)),
          h: Math.max(1, num(op.h, 100)),
          color,
          richText: toRichText(str(op.text)),
        },
      } as TLShapePartial)
      return id
    case 'arrow':
      editor.createShape({
        id,
        type: 'arrow',
        x: 0,
        y: 0,
        props: {
          start: { x: num(op.x1), y: num(op.y1) },
          end: { x: num(op.x2), y: num(op.y2) },
          color,
          text: str(op.text),
        },
      } as TLShapePartial)
      return id
    case 'line':
      // A plain line = an arrow with both arrowheads removed.
      editor.createShape({
        id,
        type: 'arrow',
        x: 0,
        y: 0,
        props: {
          start: { x: num(op.x1), y: num(op.y1) },
          end: { x: num(op.x2), y: num(op.y2) },
          color,
          arrowheadStart: 'none',
          arrowheadEnd: 'none',
        },
      } as TLShapePartial)
      return id
    case 'image':
      return createImage(editor, op, id)
    default:
      return null
  }
}

/** Place an image (from a public URL or a data: URL) on the board. */
function createImage(editor: Editor, op: Record<string, unknown>, shapeId: TLShapeId): TLShapeId | null {
  const src = str(op.url)
  if (!src) return null

  const w = Math.max(1, num(op.w, 320))
  const h = Math.max(1, num(op.h, 240))
  const assetId = AssetRecordType.createId()

  editor.createAssets([
    {
      id: assetId,
      typeName: 'asset',
      type: 'image',
      props: { name: 'ai-image', src, w, h, mimeType: guessMime(src), isAnimated: false },
      meta: {},
    } as TLAsset,
  ])

  editor.createShape({
    id: shapeId,
    type: 'image',
    x: num(op.x),
    y: num(op.y),
    props: { assetId, w, h },
  } as TLShapePartial)

  return shapeId
}

function guessMime(src: string): string {
  const data = /^data:([^;]+);/.exec(src)
  if (data) return data[1]
  if (/\.png$/i.test(src)) return 'image/png'
  if (/\.jpe?g$/i.test(src)) return 'image/jpeg'
  if (/\.gif$/i.test(src)) return 'image/gif'
  if (/\.webp$/i.test(src)) return 'image/webp'
  if (/\.svg$/i.test(src)) return 'image/svg+xml'
  return 'image/png'
}

function newId(): TLShapeId {
  // tldraw's own id generator — works in insecure contexts (http:// on a LAN
  // IP), unlike crypto.randomUUID which requires a secure context.
  return createShapeId()
}

function pickColor(value: unknown): TLDefaultColorStyle {
  return (typeof value === 'string' && COLORS.has(value) ? value : 'black') as TLDefaultColorStyle
}

function pickGeo(value: unknown): TLGeoShapeGeoStyle {
  return (typeof value === 'string' && GEO_SHAPES.has(value) ? value : 'rectangle') as TLGeoShapeGeoStyle
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
