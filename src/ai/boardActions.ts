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
import { boundsOf, centerOf, type Bounds } from './geometry'
import { resolvePlacement, type PlacementSide } from './placement'
import type { SceneShape } from './sceneGraph'

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
//
// Global, because a reply may contain several fenced blocks — a code example
// the user asked about, then the actions block. The system prompt puts the
// actions block LAST, so we scan from the end and take the first block that
// actually looks like draw ops. Matching the first block instead would let a
// fenced JSON *data* array (which parses fine but has no `op` fields) be
// applied as ops: nothing gets drawn, the real block is ignored, and the data
// block vanishes from the chat.
const FENCED_BLOCK = /```(?:tldraw|json)?[^\S\n]*\n?([\s\S]*?)```/gi
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
  // 1) Fenced block — the format we ask for. Last matching block wins.
  for (const match of [...raw.matchAll(FENCED_BLOCK)].reverse()) {
    const actions = parseActions(match[1])
    if (actions && looksLikeActions(actions)) {
      return { text: raw.replace(match[0], '').trim(), actions }
    }
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
 * Tracks the board's occupied space across a batch, so shapes the model
 * creates in one reply don't land on the board's existing content *or* on each
 * other.
 */
interface ApplySession {
  byHandle: Map<string, SceneShape>
  occupied: Bounds[]
  /** How many shapes this batch has created, for numbering N-handles. */
  createdCount: number
}

// Connectors don't occupy space for layout purposes. A flowchart is mostly
// arrows, and treating them as blockers would shove every new shape away from
// the very places the user wants things — including the tip of the arrow they
// just drew.
const NON_BLOCKING_TYPES = new Set(['arrow', 'line', 'highlight'])

function startSession(scene?: SceneShape[]): ApplySession {
  const shapes = scene ?? []
  return {
    byHandle: new Map(shapes.map((shape) => [shape.handle, shape])),
    occupied: shapes
      .filter((shape) => !NON_BLOCKING_TYPES.has(shape.type))
      .map((shape) => shape.bounds),
    createdCount: 0,
  }
}

/**
 * Register a shape created during this batch under an `N1`, `N2`… handle, so
 * later ops in the same reply can refer to it — that's what lets the model add
 * a box and then connect an arrow to it in one go, which "complete this
 * flowchart" needs constantly.
 */
function registerCreated(
  session: ApplySession,
  id: TLShapeId,
  type: string,
  bounds: Bounds,
): void {
  session.createdCount += 1
  const handle = `N${session.createdCount}`
  session.byHandle.set(handle, { handle, id: String(id), type, bounds, text: '' })
}

/**
 * Apply draw ops to the board. Marked as a "remote" change so the auto-watch
 * trigger doesn't treat the AI's own drawing as a user edit (which would loop).
 * Each op is applied independently so one bad op doesn't drop the whole batch.
 * Returns the ids created, so the caller can select/reveal them.
 *
 * Pass `scene` (the labelled shapes sent to the model this turn) to enable
 * anchor-relative placement, arrow binding and updates — without it, ops fall
 * back to absolute coordinates exactly as before.
 */
export function applyBoardActions(
  editor: Editor,
  actions: unknown[],
  scene?: SceneShape[],
): TLShapeId[] {
  const created: TLShapeId[] = []
  const session = startSession(scene)

  editor.store.mergeRemoteChanges(() => {
    for (const action of actions) {
      try {
        const id = applyOne(editor, action, session)
        if (id) created.push(id)
      } catch {
        // Skip a single malformed op rather than failing the whole reply.
      }
    }
  })
  return created
}

// Fallback sizes, used for collision bookkeeping when the model doesn't say
// how big a shape is. Approximate is fine — they only affect spacing.
const DEFAULT_NOTE_SIZE = { w: 200, h: 200 }
const DEFAULT_TEXT_SIZE = { w: 200, h: 50 }

function applyOne(editor: Editor, action: unknown, session: ApplySession): TLShapeId | null {
  if (!action || typeof action !== 'object') return null
  const op = action as Record<string, unknown>
  const color = pickColor(op.color)
  const id = newId()

  switch (String(op.op ?? '')) {
    case 'text': {
      const at = place(op, session, DEFAULT_TEXT_SIZE.w, DEFAULT_TEXT_SIZE.h)
      editor.createShape({
        id,
        type: 'text',
        x: at.x,
        y: at.y,
        props: { richText: toRichText(str(op.text)), color },
      } as TLShapePartial)
      registerCreated(session, id, 'text', at.bounds)
      return id
    }
    case 'note': {
      const at = place(op, session, DEFAULT_NOTE_SIZE.w, DEFAULT_NOTE_SIZE.h)
      editor.createShape({
        id,
        type: 'note',
        x: at.x,
        y: at.y,
        props: { richText: toRichText(str(op.text)), color },
      } as TLShapePartial)
      registerCreated(session, id, 'note', at.bounds)
      return id
    }
    case 'geo': {
      const w = Math.max(1, num(op.w, 160))
      const h = Math.max(1, num(op.h, 100))
      const at = place(op, session, w, h)
      editor.createShape({
        id,
        type: 'geo',
        x: at.x,
        y: at.y,
        props: {
          geo: pickGeo(op.shape),
          w,
          h,
          color,
          richText: toRichText(str(op.text)),
        },
      } as TLShapePartial)
      registerCreated(session, id, 'geo', at.bounds)
      return id
    }
    case 'arrow':
      return createArrow(editor, op, id, session, color)
    case 'update':
      updateShapeText(editor, op, session)
      return null // an edit, not a creation
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
      return createImage(editor, op, id, session)
    default:
      return null
  }
}

/**
 * Resolve where a shape goes, then record the space it takes so later ops in
 * the same batch avoid it.
 *
 * This is the heart of the spatial fix: the model names an anchor and a side,
 * and the exact arithmetic happens here against real bounds — rather than the
 * model estimating coordinates off a flat image.
 */
function place(
  op: Record<string, unknown>,
  session: ApplySession,
  w: number,
  h: number,
): { x: number; y: number; bounds: Bounds } {
  const anchor = resolveHandle(op.anchor, session)

  const at = resolvePlacement(
    {
      w,
      h,
      anchor: anchor
        ? { bounds: anchor.bounds, tip: anchor.tip, direction: anchor.direction }
        : undefined,
      side: pickSide(op.side),
      gap: typeof op.gap === 'number' ? op.gap : undefined,
      x: num(op.x),
      y: num(op.y),
    },
    session.occupied,
  )

  const bounds = boundsOf(at.x, at.y, w, h)
  session.occupied.push(bounds)
  return { ...at, bounds }
}

/** Look up a scene handle like "S3" or a batch-local "N1". */
function resolveHandle(value: unknown, session: ApplySession): SceneShape | undefined {
  return typeof value === 'string' ? session.byHandle.get(value.trim().toUpperCase()) : undefined
}

const SIDES: PlacementSide[] = ['right', 'left', 'above', 'below', 'center', 'tip']

function pickSide(value: unknown): PlacementSide | undefined {
  return typeof value === 'string' && (SIDES as string[]).includes(value)
    ? (value as PlacementSide)
    : undefined
}

/**
 * Create an arrow. When `from`/`to` name scene handles we create real tldraw
 * *bindings*, so the arrow attaches to those shapes and follows them when
 * they're moved — rather than being a floating line that merely looks
 * connected.
 */
function createArrow(
  editor: Editor,
  op: Record<string, unknown>,
  id: TLShapeId,
  session: ApplySession,
  color: TLDefaultColorStyle,
): TLShapeId {
  const from = resolveHandle(op.from, session)
  const to = resolveHandle(op.to, session)

  // Seed the terminals at the bound shapes' centres; the bindings then take
  // over and tldraw routes the arrow to their edges.
  const start = from ? centerOf(from.bounds) : { x: num(op.x1), y: num(op.y1) }
  const end = to ? centerOf(to.bounds) : { x: num(op.x2), y: num(op.y2) }

  editor.createShape({
    id,
    type: 'arrow',
    x: 0,
    y: 0,
    props: { start, end, color, text: str(op.text) },
  } as TLShapePartial)

  if (from) bindArrow(editor, id, from.id, 'start')
  if (to) bindArrow(editor, id, to.id, 'end')

  return id
}

function bindArrow(
  editor: Editor,
  arrowId: TLShapeId,
  targetId: string,
  terminal: 'start' | 'end',
): void {
  editor.createBinding({
    type: 'arrow',
    fromId: arrowId,
    toId: targetId as TLShapeId,
    props: {
      terminal,
      normalizedAnchor: { x: 0.5, y: 0.5 },
      isExact: false,
      // Bind to the shape as a whole rather than a precise point, so tldraw
      // picks a sensible edge crossing as the shapes move.
      isPrecise: false,
    },
  } as Parameters<Editor['createBinding']>[0])
}

/** Rewrite an existing shape's text — "finish this label" rather than "add one". */
function updateShapeText(editor: Editor, op: Record<string, unknown>, session: ApplySession): void {
  const target = resolveHandle(op.target, session)
  if (!target) return

  editor.updateShape({
    id: target.id as TLShapeId,
    type: target.type,
    props: { richText: toRichText(str(op.text)) },
  } as TLShapePartial)
}

/** Place an image (from a public URL or a data: URL) on the board. */
function createImage(
  editor: Editor,
  op: Record<string, unknown>,
  shapeId: TLShapeId,
  session: ApplySession,
): TLShapeId | null {
  const src = str(op.url)
  if (!src) return null

  const w = Math.max(1, num(op.w, 320))
  const h = Math.max(1, num(op.h, 240))
  const at = place(op, session, w, h)
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
    x: at.x,
    y: at.y,
    props: { assetId, w, h },
  } as TLShapePartial)
  registerCreated(session, shapeId, 'image', at.bounds)

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
