import { describe, expect, it } from 'vitest'
import { buildExportFilename } from './filename'

describe('buildExportFilename', () => {
  it('builds a timestamped name from the given date', () => {
    const at = new Date(2026, 6, 20, 14, 32) // 20 Jul 2026, 14:32 local
    expect(buildExportFilename('png', at)).toBe('notetaker-board-2026-07-20-1432.png')
  })

  it('zero-pads single-digit month, day, hour and minute', () => {
    const at = new Date(2026, 0, 5, 9, 7)
    expect(buildExportFilename('svg', at)).toBe('notetaker-board-2026-01-05-0907.svg')
  })

  it('uses midnight as 0000 rather than 24 or blank', () => {
    const at = new Date(2026, 11, 31, 0, 0)
    expect(buildExportFilename('tldr', at)).toBe('notetaker-board-2026-12-31-0000.tldr')
  })

  it('carries the requested extension through', () => {
    const at = new Date(2026, 6, 20, 14, 32)
    expect(buildExportFilename('tldr', at)).toMatch(/\.tldr$/)
  })

  it('produces distinct names for exports a minute apart', () => {
    const first = buildExportFilename('png', new Date(2026, 6, 20, 14, 32))
    const second = buildExportFilename('png', new Date(2026, 6, 20, 14, 33))
    expect(first).not.toBe(second)
  })
})
