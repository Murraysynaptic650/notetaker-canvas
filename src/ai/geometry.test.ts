import { describe, expect, it } from 'vitest'
import { boundsOf, centerOf, expandBounds, overlaps, type Bounds } from './geometry'

const box = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({
  minX,
  minY,
  maxX,
  maxY,
})

describe('overlaps', () => {
  it('detects two boxes sharing area', () => {
    expect(overlaps(box(0, 0, 100, 100), box(50, 50, 150, 150))).toBe(true)
  })

  it('is false for separated boxes', () => {
    expect(overlaps(box(0, 0, 100, 100), box(200, 0, 300, 100))).toBe(false)
  })

  it('treats edge-touching boxes as not overlapping', () => {
    // Shapes placed exactly side by side are a valid layout, not a collision.
    expect(overlaps(box(0, 0, 100, 100), box(100, 0, 200, 100))).toBe(false)
  })

  it('detects full containment', () => {
    expect(overlaps(box(0, 0, 200, 200), box(50, 50, 100, 100))).toBe(true)
  })

  it('requires overlap on both axes', () => {
    // Same rows, different columns — no overlap.
    expect(overlaps(box(0, 0, 100, 100), box(150, 0, 250, 100))).toBe(false)
    // Same columns, different rows — no overlap.
    expect(overlaps(box(0, 0, 100, 100), box(0, 150, 100, 250))).toBe(false)
  })
})

describe('boundsOf', () => {
  it('builds bounds from a position and size', () => {
    expect(boundsOf(10, 20, 100, 50)).toEqual(box(10, 20, 110, 70))
  })
})

describe('centerOf', () => {
  it('returns the midpoint', () => {
    expect(centerOf(box(0, 0, 100, 50))).toEqual({ x: 50, y: 25 })
  })

  it('handles negative coordinates', () => {
    expect(centerOf(box(-100, -50, -50, -25))).toEqual({ x: -75, y: -37.5 })
  })
})

describe('expandBounds', () => {
  it('grows a box by the given padding on all sides', () => {
    expect(expandBounds(box(10, 10, 20, 20), 5)).toEqual(box(5, 5, 25, 25))
  })

  it('leaves the box untouched for zero padding', () => {
    expect(expandBounds(box(10, 10, 20, 20), 0)).toEqual(box(10, 10, 20, 20))
  })
})
