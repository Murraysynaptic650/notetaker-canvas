/**
 * Small axis-aligned geometry helpers shared by the spatial-grounding layer.
 * Deliberately independent of tldraw so the placement logic stays pure and
 * testable — tldraw's own Box is converted to this shape at the boundary.
 */

export interface Point {
  x: number
  y: number
}

/** An axis-aligned rectangle in absolute page coordinates. */
export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Build bounds from a top-left position and a size. */
export function boundsOf(x: number, y: number, w: number, h: number): Bounds {
  return { minX: x, minY: y, maxX: x + w, maxY: y + h }
}

export function centerOf(bounds: Bounds): Point {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
}

export function expandBounds(bounds: Bounds, padding: number): Bounds {
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  }
}

/**
 * True when two rectangles share area. Edge-touching counts as *not*
 * overlapping: shapes placed exactly side by side are a deliberate layout, not
 * a collision to be resolved.
 */
export function overlaps(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}
