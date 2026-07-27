import { describe, expect, it } from 'vitest'
import type { Bounds } from './geometry'
import { resolvePlacement, type PlacementRequest } from './placement'

const box = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({
  minX,
  minY,
  maxX,
  maxY,
})

/** An anchor stand-in: only the bounds (and optional arrow tip) are read. */
const anchorAt = (bounds: Bounds, arrow?: PlacementRequest['anchor']) => ({
  bounds,
  ...(arrow ?? {}),
})

function request(overrides: Partial<PlacementRequest> = {}): PlacementRequest {
  return { w: 100, h: 50, ...overrides }
}

describe('resolvePlacement — absolute fallback', () => {
  it('uses the model’s own coordinates when there is no anchor', () => {
    const placed = resolvePlacement(request({ x: 300, y: 400 }), [])
    expect(placed).toEqual({ x: 300, y: 400 })
  })

  it('defaults to the origin when neither anchor nor coordinates are given', () => {
    expect(resolvePlacement(request(), [])).toEqual({ x: 0, y: 0 })
  })
})

describe('resolvePlacement — anchor sides', () => {
  const anchor = anchorAt(box(200, 200, 380, 290)) // 180x90 box

  it('places to the right of the anchor, vertically centred', () => {
    const placed = resolvePlacement(request({ anchor, side: 'right', gap: 40 }), [])
    expect(placed.x).toBe(420) // 380 + 40
    expect(placed.y).toBe(220) // anchor centre 245, minus half of h=50
  })

  it('places to the left of the anchor', () => {
    const placed = resolvePlacement(request({ anchor, side: 'left', gap: 40 }), [])
    expect(placed.x).toBe(60) // 200 - 40 - 100
    expect(placed.y).toBe(220)
  })

  it('places below the anchor, horizontally centred', () => {
    const placed = resolvePlacement(request({ anchor, side: 'below', gap: 30 }), [])
    expect(placed.y).toBe(320) // 290 + 30
    expect(placed.x).toBe(240) // anchor centre 290, minus half of w=100
  })

  it('places above the anchor', () => {
    const placed = resolvePlacement(request({ anchor, side: 'above', gap: 30 }), [])
    expect(placed.y).toBe(120) // 200 - 30 - 50
    expect(placed.x).toBe(240)
  })

  it('centres on the anchor when asked', () => {
    const placed = resolvePlacement(request({ anchor, side: 'center', gap: 0 }), [])
    expect(placed).toEqual({ x: 240, y: 220 })
  })

  it('applies a sensible default gap when none is given', () => {
    const placed = resolvePlacement(request({ anchor, side: 'right' }), [])
    expect(placed.x).toBeGreaterThan(380)
    expect(placed.x).toBeLessThanOrEqual(380 + 80)
  })

  it('ignores a negative gap rather than overlapping the anchor', () => {
    const placed = resolvePlacement(request({ anchor, side: 'right', gap: -100 }), [])
    expect(placed.x).toBeGreaterThanOrEqual(380)
  })
})

describe('resolvePlacement — arrow tip', () => {
  it('places at the tip of an arrow, centred on its heading', () => {
    // An arrow ending at (520,245) pointing right: the new shape should start
    // at the tip and be vertically centred on it.
    const anchor = anchorAt(box(390, 240, 520, 250), {
      bounds: box(390, 240, 520, 250),
      tip: { x: 520, y: 245 },
      direction: 'right',
    })

    const placed = resolvePlacement(request({ anchor, side: 'tip' }), [])
    expect(placed.x).toBe(520)
    expect(placed.y).toBe(220) // 245 - h/2
  })

  it('defaults to no gap at a tip, so the flow stays connected', () => {
    const anchor = anchorAt(box(390, 240, 520, 250), {
      bounds: box(390, 240, 520, 250),
      tip: { x: 520, y: 245 },
      direction: 'right',
    })
    expect(resolvePlacement(request({ anchor, side: 'tip' }), []).x).toBe(520)
  })

  it('places leftward for an arrow pointing left', () => {
    const anchor = anchorAt(box(200, 240, 330, 250), {
      bounds: box(200, 240, 330, 250),
      tip: { x: 200, y: 245 },
      direction: 'left',
    })

    const placed = resolvePlacement(request({ anchor, side: 'tip', gap: 0 }), [])
    expect(placed.x).toBe(100) // tip minus the full width
    expect(placed.y).toBe(220)
  })

  it('places downward for an arrow pointing down', () => {
    const anchor = anchorAt(box(300, 200, 310, 400), {
      bounds: box(300, 200, 310, 400),
      tip: { x: 305, y: 400 },
      direction: 'down',
    })

    const placed = resolvePlacement(request({ anchor, side: 'tip', gap: 20 }), [])
    expect(placed.y).toBe(420)
    expect(placed.x).toBe(255) // centred on the tip
  })

  it('falls back to right-of-anchor when tip is asked for on a non-arrow', () => {
    const placed = resolvePlacement(
      request({ anchor: anchorAt(box(0, 0, 100, 100)), side: 'tip', gap: 10 }),
      [],
    )
    expect(placed.x).toBe(110)
  })
})

describe('resolvePlacement — collision avoidance', () => {
  const anchor = anchorAt(box(200, 200, 380, 290))

  it('leaves a clear placement untouched', () => {
    const placed = resolvePlacement(request({ anchor, side: 'right', gap: 40 }), [
      box(0, 0, 100, 100),
    ])
    expect(placed).toEqual({ x: 420, y: 220 })
  })

  it('pushes further along the placement direction when the slot is taken', () => {
    // Something already occupies the slot immediately right of the anchor.
    const occupied = [box(400, 200, 560, 300)]
    const placed = resolvePlacement(request({ anchor, side: 'right', gap: 40 }), occupied)

    expect(placed.x).toBeGreaterThanOrEqual(560)
  })

  it('pushes upward for an above placement', () => {
    const occupied = [box(200, 100, 400, 200)]
    const placed = resolvePlacement(request({ anchor, side: 'above', gap: 30 }), occupied)
    expect(placed.y + 50).toBeLessThanOrEqual(100)
  })

  it('resolves a chain of blocked slots', () => {
    const occupied = [box(400, 200, 500, 300), box(510, 200, 610, 300), box(620, 200, 720, 300)]
    const placed = resolvePlacement(request({ anchor, side: 'right', gap: 20 }), occupied)

    const result = { minX: placed.x, minY: placed.y, maxX: placed.x + 100, maxY: placed.y + 50 }
    for (const taken of occupied) {
      const hit =
        result.minX < taken.maxX &&
        result.maxX > taken.minX &&
        result.minY < taken.maxY &&
        result.maxY > taken.minY
      expect(hit).toBe(false)
    }
  })

  it('nudges an absolute placement downward when it lands on something', () => {
    const placed = resolvePlacement(request({ x: 100, y: 100 }), [box(50, 50, 250, 200)])
    expect(placed.y).toBeGreaterThanOrEqual(200)
    expect(placed.x).toBe(100) // absolute placements keep their column
  })

  it('gives up gracefully rather than looping forever on a crowded board', () => {
    // A wall of occupied space far larger than the retry budget.
    const wall: Bounds[] = []
    for (let i = 0; i < 200; i += 1) wall.push(box(400 + i * 100, 0, 500 + i * 100, 1000))

    const placed = resolvePlacement(request({ anchor, side: 'right', gap: 10 }), wall)
    expect(Number.isFinite(placed.x)).toBe(true)
    expect(Number.isFinite(placed.y)).toBe(true)
  })
})
