const BASE_NAME = 'notetaker-board'

/**
 * Timestamped, filesystem-safe filename, e.g. `notetaker-board-2026-07-20-1432.png`.
 * Keeps repeated exports from overwriting each other in the Files app.
 */
export function buildExportFilename(format: string, now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')

  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('-')

  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`

  return `${BASE_NAME}-${stamp}-${time}.${format}`
}
