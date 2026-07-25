export type DeliveryMethod = 'share' | 'download'

/**
 * True when the browser can share these files via the native share sheet.
 * On iPad this is what surfaces "Save to Files" / "Copy" / app targets.
 */
function canShareFiles(files: File[]): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function' &&
    navigator.canShare({ files })
  )
}

/** The user dismissed the share sheet — not an error worth surfacing. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/**
 * Hand a file to the user by the best route available.
 *
 * On iPad this opens the native share sheet, where "Save to Files" puts the
 * image in iCloud Drive so it can be inserted into a Freeform board. On desktop
 * it falls back to a normal download.
 */
export async function shareOrDownload(
  blob: Blob,
  filename: string,
): Promise<DeliveryMethod> {
  const file = new File([blob], filename, { type: blob.type })

  if (canShareFiles([file])) {
    try {
      await navigator.share({ files: [file], title: filename })
      return 'share'
    } catch (error) {
      // A cancelled share is a completed interaction; don't also download.
      if (isAbortError(error)) return 'share'
      // Anything else (e.g. share unsupported for this payload) falls through
      // to the download path rather than failing the export outright.
    }
  }

  downloadBlob(blob, filename)
  return 'download'
}
