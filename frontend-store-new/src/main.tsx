import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"

import "./styles/index.css"
import "./styles/white.css"
import "./styles/white-shop.css"
import { App } from "@/App"
import { startPrefetch } from "@/lib/prefetch"
import { registerServiceWorker } from "@/lib/pwa"
import { queryClient } from "@/lib/query-client"
import { startPersistence } from "@/lib/query-persist"

// The device's copy of the shop's lists, read in while `/auth/me` is still
// on its way (`lib/query-persist.ts`), and the screens' data asked for as a
// link is reached rather than after the screen has drawn (`lib/prefetch.ts`).
startPersistence(queryClient)
startPrefetch(queryClient)

// The built files, kept by the browser so the app opens from this device and
// a tab left open across a node update keeps its own build (`lib/pwa.ts`).
registerServiceWorker()

// A tab asking for a lazy chunk of a build that is gone: the node updated
// itself under an open tab, and the new `web/` has none of the old build's
// files. Reloading once is better than a dead screen; once is all — a second
// failure inside half a minute is a real fault and shows as one.
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
