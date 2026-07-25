import { registerSW } from 'virtual:pwa-register'

const UPDATE_POLL_MS = 60_000

/**
 * Registers the service worker with a durable auto-update flow so the installed
 * PWA never gets stuck on a stale bundle.
 *
 * With `registerType: 'autoUpdate'`, a newly-activated worker takes control
 * (skipWaiting + clientsClaim) and the page reloads into the fresh build on its
 * own. The missing piece for an *already-open* PWA — especially on iPad, which
 * can stay "open" for days — is noticing that a new build exists. So we poll
 * `registration.update()` on an interval and whenever the app regains focus.
 */
export function setupPwaAutoUpdate(): void {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return

      const checkForUpdate = () => {
        registration.update().catch(() => {
          /* offline or transient — try again next tick */
        })
      }

      window.setInterval(checkForUpdate, UPDATE_POLL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate()
      })
    },
  })
}
