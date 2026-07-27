import type { Bounds, Point } from './geometry'
import type { Direction } from './placement'

/**
 * The board as a *labelled scene graph* — the thing that makes precise
 * collaboration possible.
 *
 * The model used to receive a flat list of strings ("Cache", "Database") and a
 * picture with no coordinate frame, then had to invent absolute coordinates.
 * That is the least reliable thing a vision model can be asked to do. Instead
 * we hand it a numbered inventory with exact geometry:
 *
 *   S1 geo/rectangle (200,200)-(380,290) "Cache"
 *   S2 arrow (390,240)-(520,250) tip (520,245) heading right
 *
 * so it can say "a box at the tip of S2" and the app resolves the arithmetic.
 * Handles are per-turn labels, not persistent ids: they're regenerated from
 * reading order on every request and mapped back to real shape ids on apply.
 */

/** A shape as read off the editor, before it gets a handle. */
export interface RawShape {
  id: string
  /** tldraw shape type: geo, note, text, arrow, draw, image, … */
  type: string
  /** For geo shapes, the specific form: rectangle, ellipse, … */
  subType?: string
  bounds: Bounds
  text: string
  /** Arrow terminals in absolute page coordinates. */
  arrow?: { start: Point; end: Point }
}

/** A shape with its per-turn handle and any derived arrow geometry. */
export interface SceneShape extends RawShape {
  handle: string
  tip?: Point
  direction?: Direction
}

// Shapes whose tops are within this many pixels count as the same row, so
// handle numbering reads the way a person would scan the board.
const ROW_TOLERANCE = 60

// Per-shape text budget in the description. One verbose sticky note must not
// crowd out the geometry of everything else.
const MAX_SHAPE_TEXT = 80

/**
 * Number the shapes S1…Sn in reading order (top-to-bottom, then
 * left-to-right within a row) and derive arrow tips/headings.
 */
export function assignHandles(shapes: RawShape[]): SceneShape[] {
  return [...shapes]
    .sort(byReadingOrder)
    .map((shape, index) => ({ ...shape, handle: `S${index + 1}`, ...arrowGeometry(shape) }))
}

function byReadingOrder(a: RawShape, b: RawShape): number {
  const rowA = Math.round(a.bounds.minY / ROW_TOLERANCE)
  const rowB = Math.round(b.bounds.minY / ROW_TOLERANCE)
  if (rowA !== rowB) return rowA - rowB
  return a.bounds.minX - b.bounds.minX
}

/** An arrow's tip is where its head is; its heading is the dominant axis. */
function arrowGeometry(shape: RawShape): { tip?: Point; direction?: Direction } {
  if (!shape.arrow) return {}

  const { start, end } = shape.arrow
  const dx = end.x - start.x
  const dy = end.y - start.y

  const direction: Direction =
    Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up'

  return { tip: end, direction }
}

/**
 * Render the scene for the prompt: the visible area, the shape inventory, and
 * — when the user is pointing at something — an explicit instruction about
 * where they want the model to work.
 */
export function describeScene(
  shapes: SceneShape[],
  viewport: Bounds,
  pointer: SceneShape | null,
): string {
  const area =
    `Visible board area: (${round(viewport.minX)},${round(viewport.minY)}) to ` +
    `(${round(viewport.maxX)},${round(viewport.maxY)}).`

  if (shapes.length === 0) {
    return `${area}\nThe board is empty.`
  }

  const inventory = shapes.map(describeShape).join('\n')
  const sections = [area, `Shapes on the board (handle, kind, bounds, text):\n${inventory}`]

  if (pointer) sections.push(describePointer(pointer))

  return sections.join('\n\n')
}

function describeShape(shape: SceneShape): string {
  const { minX, minY, maxX, maxY } = shape.bounds
  const kind = shape.subType ? `${shape.type}/${shape.subType}` : shape.type
  const parts = [
    `  ${shape.handle} ${kind} (${round(minX)},${round(minY)})-(${round(maxX)},${round(maxY)})`,
  ]

  if (shape.tip && shape.direction) {
    parts.push(`tip (${round(shape.tip.x)},${round(shape.tip.y)}) heading ${shape.direction}`)
  }

  if (shape.text.trim()) {
    parts.push(`"${truncate(shape.text.trim(), MAX_SHAPE_TEXT)}"`)
  } else if (shape.type === 'draw') {
    parts.push('freehand drawing/handwriting')
  }

  return parts.join(' ')
}

/**
 * The user's "pointer" — the shape they just drew or selected. This is what
 * turns a vague gesture ("finish this") into a precise instruction, and it is
 * the main reason placement used to be hit-or-miss: the model had no idea
 * which part of the board the request was about.
 */
function describePointer(pointer: SceneShape): string {
  const base = `USER POINTER: ${pointer.handle}. The user is working here — put your response at this location unless they say otherwise.`

  if (pointer.tip && pointer.direction) {
    return `${base} It is an arrow whose tip is (${round(pointer.tip.x)},${round(
      pointer.tip.y,
    )}) heading ${pointer.direction}; continue from the tip (use "anchor":"${
      pointer.handle
    }","side":"tip").`
  }

  return `${base} Place new shapes relative to it (e.g. "anchor":"${pointer.handle}","side":"below").`
}

/**
 * Which shape the user is pointing at: their selection if they have one,
 * otherwise the shape they most recently drew or edited.
 */
export function pickPointer(
  shapes: SceneShape[],
  selectedIds: string[],
  lastEditedId: string | null,
): SceneShape | null {
  for (const id of selectedIds) {
    const selected = shapes.find((shape) => shape.id === id)
    if (selected) return selected
  }

  if (lastEditedId) {
    return shapes.find((shape) => shape.id === lastEditedId) ?? null
  }

  return null
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ')
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed
}

function round(value: number): number {
  return Math.round(value)
}
