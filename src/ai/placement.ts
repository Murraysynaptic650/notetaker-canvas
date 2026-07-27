import { boundsOf, centerOf, overlaps, type Bounds, type Point } from './geometry'

/**
 * Turns a *relative* placement request from the model into exact page
 * coordinates, then de-conflicts it against whatever already occupies the
 * board.
 *
 * This exists because asking a vision model for absolute coordinates is the
 * least reliable thing we can do: it sees a flat image with no coordinate
 * frame and has to estimate numerically. The app, by contrast, knows every
 * shape's exact bounds. So the model says "a box to the right of S3" and this
 * module works out that this means x=420, y=220 — and shifts it if something
 * is already there.
 */

/** Where a new shape goes relative to its anchor. */
export type PlacementSide = 'right' | 'left' | 'above' | 'below' | 'center' | 'tip'

/** The compass heading of an arrow, used for `side: 'tip'`. */
export type Direction = 'right' | 'left' | 'up' | 'down'

/** The subset of a scene shape that placement needs. */
export interface PlacementAnchor {
  bounds: Bounds
  /** Present only for arrows: where the arrowhead is, and which way it points. */
  tip?: Point
  direction?: Direction
}

export interface PlacementRequest {
  /** Size of the shape being placed. */
  w: number
  h: number
  /** Anchor to place relative to. Absent means use `x`/`y`. */
  anchor?: PlacementAnchor
  side?: PlacementSide
  /** Space between anchor and the new shape. Negative values are ignored. */
  gap?: number
  /** Absolute coordinates, used when there's no anchor. */
  x?: number
  y?: number
}

const DEFAULT_GAP = 40

// Bounded search: each attempt shifts the candidate one step further along the
// placement direction. Enough to clear a few shapes without stalling the reply
// on a densely packed board.
const MAX_COLLISION_ATTEMPTS = 24
const MIN_STEP = 20

/**
 * Resolve a placement request to a top-left position.
 *
 * `occupied` should hold the bounds of everything already on the board *plus*
 * anything created earlier in the same batch, so a multi-shape reply doesn't
 * stack its own shapes on top of each other.
 */
export function resolvePlacement(request: PlacementRequest, occupied: Bounds[]): Point {
  const start = initialPosition(request)
  const push = pushDirection(request)
  return avoidCollisions(start, request.w, request.h, push, occupied)
}

/** Where the shape would go if the board were empty. */
function initialPosition(request: PlacementRequest): Point {
  const { anchor, w, h } = request
  if (!anchor) {
    return { x: request.x ?? 0, y: request.y ?? 0 }
  }

  const side = request.side ?? 'right'
  // Continuing from an arrowhead means starting *at* the tip — a default gap
  // there would leave a floating disconnect exactly where precision matters.
  const gap = Math.max(0, request.gap ?? (side === 'tip' ? 0 : DEFAULT_GAP))

  if (side === 'tip' && anchor.tip && anchor.direction) {
    return atArrowTip(anchor.tip, anchor.direction, gap, w, h)
  }

  const { bounds } = anchor
  const center = centerOf(bounds)

  switch (side) {
    case 'left':
      return { x: bounds.minX - gap - w, y: center.y - h / 2 }
    case 'above':
      return { x: center.x - w / 2, y: bounds.minY - gap - h }
    case 'below':
      return { x: center.x - w / 2, y: bounds.maxY + gap }
    case 'center':
      return { x: center.x - w / 2, y: center.y - h / 2 }
    case 'tip': // arrow tip requested on a non-arrow — treat as 'right'
    case 'right':
    default:
      return { x: bounds.maxX + gap, y: center.y - h / 2 }
  }
}

/**
 * Continue from an arrowhead: the new shape starts at the tip and is centred
 * across the arrow's heading, so "draw an arrow then ask for the next box"
 * lands the box exactly where the arrow is pointing.
 */
function atArrowTip(tip: Point, direction: Direction, gap: number, w: number, h: number): Point {
  switch (direction) {
    case 'left':
      return { x: tip.x - gap - w, y: tip.y - h / 2 }
    case 'up':
      return { x: tip.x - w / 2, y: tip.y - gap - h }
    case 'down':
      return { x: tip.x - w / 2, y: tip.y + gap }
    case 'right':
    default:
      return { x: tip.x + gap, y: tip.y - h / 2 }
  }
}

/**
 * Which way to shift when the chosen slot is taken. Shifting along the
 * placement direction keeps the model's intent ("to the right of S3") intact —
 * it just goes *further* right rather than somewhere unrelated.
 */
function pushDirection(request: PlacementRequest): Point {
  // An absolute placement has no directional intent to preserve, so fall
  // downward — the natural reading direction for "somewhere else that's free".
  if (!request.anchor) return { x: 0, y: 1 }

  const side = request.side ?? 'right'
  const direction = side === 'tip' ? request.anchor.direction : undefined

  switch (direction ?? side) {
    case 'left':
      return { x: -1, y: 0 }
    case 'above':
    case 'up':
      return { x: 0, y: -1 }
    case 'below':
    case 'down':
      return { x: 0, y: 1 }
    case 'right':
      return { x: 1, y: 0 }
    // Centred on the anchor: fall downward rather than sideways.
    default:
      return { x: 0, y: 1 }
  }
}

/**
 * Step the candidate along `push` until it clears everything, or until the
 * attempt budget runs out — in which case we return the last candidate rather
 * than dropping the shape. A slightly overlapping shape the user can drag is a
 * better outcome than a reply that silently drew nothing.
 */
function avoidCollisions(
  start: Point,
  w: number,
  h: number,
  push: Point,
  occupied: Bounds[],
): Point {
  let candidate = start

  for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt += 1) {
    const rect = boundsOf(candidate.x, candidate.y, w, h)
    const hit = occupied.find((taken) => overlaps(rect, taken))
    if (!hit) return candidate

    candidate = stepClear(candidate, hit, push, w, h)
  }

  return candidate
}

/** Move the candidate just past the blocking shape, plus a small margin. */
function stepClear(candidate: Point, hit: Bounds, push: Point, w: number, h: number): Point {
  if (push.x > 0) return { x: hit.maxX + MIN_STEP, y: candidate.y }
  if (push.x < 0) return { x: hit.minX - MIN_STEP - w, y: candidate.y }
  if (push.y < 0) return { x: candidate.x, y: hit.minY - MIN_STEP - h }
  return { x: candidate.x, y: hit.maxY + MIN_STEP }
}
