import type { Editor } from 'tldraw'

/**
 * Returns true when running on a coarse-pointer (touch) device such as an iPad.
 * Used to decide when to surface Pencil-specific affordances.
 */
export function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  )
}

/**
 * Whether tldraw is currently in "pen mode". In pen mode only the Apple Pencil
 * draws; finger touches pan/zoom instead (palm rejection).
 */
export function isPenModeEnabled(editor: Editor): boolean {
  return editor.getInstanceState().isPenMode
}

/**
 * Toggle pen mode. Returns the new value without mutating the passed editor
 * state directly (tldraw applies the change internally via updateInstanceState).
 */
export function setPenMode(editor: Editor, enabled: boolean): void {
  editor.updateInstanceState({ isPenMode: enabled })
}

/**
 * Apply sensible defaults for iPad on first mount. We do NOT force pen mode:
 * tldraw auto-enables it the moment it detects Apple Pencil input, and forcing
 * it would stop finger-drawing for users without a Pencil. Everything below
 * only applies on coarse-pointer (touch) devices — desktop/trackpad users get
 * tldraw's regular defaults.
 */
export function applyIpadDefaults(editor: Editor): void {
  if (!isTouchDevice()) return

  // Snapping helps a lot on touch, where finger/Pencil placement is less
  // precise than a mouse; dynamic sizing keeps shape controls big enough to
  // grab reliably with a fingertip.
  editor.user.updateUserPreferences({
    isSnapMode: true,
    isDynamicSizeMode: true,
    // Slower edge-scroll than the mouse default so dragging a shape near the
    // screen edge on a small iPad viewport doesn't fling the camera.
    edgeScrollSpeed: 0.5,
  })

  // Trackpad/wheel pinch-zoom on iPad Safari fires as wheel events; a lower
  // zoomSpeed keeps two-finger pinch from overshooting during handwriting.
  editor.setCameraOptions({
    ...editor.getCameraOptions(),
    panSpeed: 1,
    zoomSpeed: 0.75,
  })
}
