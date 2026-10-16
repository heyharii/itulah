/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from "virtual:pwa-register"

/// The service worker: the built app kept on this device.
///
/// Every file of the build (the shell, each screen's chunk, the fonts) is
/// precached when the worker installs, so the app opens from the device
/// rather than the node — and opens while the node is restarting or updating
/// itself. The data is a separate matter (`lib/query-persist.ts`).
///
/// Only where the browser allows a worker at all: a secure context. The shop
/// PC opening `http://localhost:8082` is one; a tablet opening the node by its
/// LAN address over plain HTTP is not, and there this does nothing.
///
/// A new build is taken in quietly, never by reloading the page: reloading
/// under somebody halfway through a count is not an update. The tab keeps
/// running what it loaded and the next load is the new build. Checked hourly
/// as well as on load, since this app is left open on the counter for a whole
/// shift.
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      void update(false)
    },
    onRegisteredSW(_url, registration) {
      if (registration === undefined) return
      window.setInterval(
        () => {
          if (navigator.onLine) void registration.update().catch(() => {})
        },
        60 * 60 * 1000,
      )
    },
    onRegisterError(error: unknown) {
      // An app that cannot install a worker is still the whole app; it only
      // opens from the node rather than from the device.
      console.warn("service worker registration failed", error)
    },
  })
}
