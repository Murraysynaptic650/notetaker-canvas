import { useEffect, useRef } from 'react'
import type { Editor } from 'tldraw'

export interface BoardWatcherOptions {
  /** Read the current board state as a comparable string. */
  getSnapshot: () => string
  /** Fired once the board has settled after a real change. */
  onSettled: (snapshot: string) => void
  /** How long the board must be idle before firing, in ms. */
  delay?: number
}

const DEFAULT_DELAY = 2500

/**
 * Watches the tldraw document for user edits and, when `enabled`, calls
 * `onSettled` after the board has been idle for `delay` ms — but only if the
 * snapshot actually changed since the last time it fired. This drives the
 * AI's proactive "react to the board" behaviour without spamming it on every
 * keystroke or on no-op changes (selection, camera, etc.).
 */
export function useBoardWatcher(
  editor: Editor,
  enabled: boolean,
  { getSnapshot, onSettled, delay = DEFAULT_DELAY }: BoardWatcherOptions,
): void {
  // Keep the latest callbacks in refs so re-renders don't re-subscribe. Written
  // in an effect rather than during render: the refs are only ever read from a
  // store listener or timer, both of which run after the effect has committed.
  const getSnapshotRef = useRef(getSnapshot)
  const onSettledRef = useRef(onSettled)
  useEffect(() => {
    getSnapshotRef.current = getSnapshot
    onSettledRef.current = onSettled
  })

  useEffect(() => {
    if (!enabled) return

    // Seed with the current board so enabling the watcher doesn't immediately
    // fire on already-present content.
    let lastSnapshot = getSnapshotRef.current()
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const snapshot = getSnapshotRef.current()
        if (snapshot === lastSnapshot) return
        lastSnapshot = snapshot
        onSettledRef.current(snapshot)
      }, delay)
    }

    const unlisten = editor.store.listen(schedule, { source: 'user', scope: 'document' })

    return () => {
      if (timer) clearTimeout(timer)
      unlisten()
    }
  }, [editor, enabled, delay])
}
