import type { QueryClient } from "@tanstack/react-query"

import "@/lib/random-uuid"
import { cacheKey, edge, setEdgeToken } from "@/lib/api"
import { rememberViewport } from "@/lib/device"
import { startLook } from "@/lib/look"
import { registerServiceWorker } from "@/lib/pwa"
import { watchIdentity } from "@/lib/session"

/// The one-time client boot — `main.tsx` before the migration, minus the
/// render (Start owns mounting). Runs once per browser session, never on the
/// server; called from `router.tsx` when the client router is first built.
///
/// What the device holds of the masters a purchase order is written against
/// goes into the query cache first (`watchIdentity`), so the New PO form works
/// with no connection; and orders made that way are sent as soon as there is
/// one (`lib/offline/po-outbox.ts`). The device's stored cache is read after
/// hydration (`App`), so it can never draw ahead of the server's HTML.
let booted = false

export function bootClient(queryClient: QueryClient): void {
  if (booted) return
  booted = true

  watchIdentity(queryClient)

  // A warehouse session lapses on the node — thirty idle minutes, a restart —
  // while the screens reading it still hold its token. The first 401 for that
  // token drops it, and the Operations gate, seeing no DC session, exchanges
  // the Cloud one for a fresh session. Nobody is asked for a DC password.
  edge.onBearerRejected(() => {
    setEdgeToken(null)
    queryClient.setQueryData(cacheKey.edgeMe(), null)
  })

  // The service worker, back on (owner, 2026-10-10: "win for both worlds").
  // Under SSR the document is rendered per request; the worker keeps its
  // other two jobs — hashed assets cache-first, and Web Push.
  registerServiceWorker()

  // A tab asking for a lazy chunk of a build that is gone. The server keeps
  // the previous build's chunks for a while, so this is the rare case (a tab
  // left open for weeks); reloading once is better than a dead "Something
  // went wrong" screen, and once is all: a second failure inside half a
  // minute is a real fault and shows as one.
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault()
    try {
      const last = Number(sessionStorage.getItem("chunk-reload") ?? "0")
      if (Date.now() - last < 30_000) return
      sessionStorage.setItem("chunk-reload", String(Date.now()))
    } catch {
      return
    }
    window.location.reload()
  })

  // Before the first paint: `?aids=sidebar,zebra` in the address sets and
  // keeps a look choice.
  startLook()

  // The window's width, for the next request's server render (`lib/device.ts`).
  rememberViewport()

  // Development only: the client in the console, to see what is cached.
  if (import.meta.env.DEV)
    (window as unknown as Record<string, unknown>).__queryClient = queryClient
}
