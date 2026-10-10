import "@/lib/random-uuid"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"

import "./styles/index.css"
import { App } from "@/App"
import { cacheKey, edge, setEdgeToken } from "@/lib/api"
import { markSignedOutElsewhere, watchIdentity } from "@/lib/session"
import { startPersistence } from "@/lib/query-persist"
import { hydrateReference } from "@/lib/offline/reference"
import { startOutbox } from "@/lib/offline/po-outbox"
import {
  isTenancySignOut,
  tenancyQueryKey,
  TenancyProvider,
} from "@/lib/tenancy"
import { ApiError } from "@itulah/contract/client"

/// One client for the whole surface.
///
/// `retry: false` because this API answers a refusal with a reason a person can
/// read — an unpriced item, a missing CSRF token, a lapsed session — and
/// retrying a 4xx only delays showing it. `ApiError.worthRetrying` names the
/// cases where a retry is honest, and callers that want one ask for it.
///
/// One user, one device (2026-09-26): signing in somewhere else ends this
/// session on the server, and the first request after that says so. Any read
/// or write that hears it drops the session here too, so the login box comes
/// up at once with the reason — rather than a screen of red errors that only
/// a reload would explain.
function pushedOut(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.needsSignIn &&
    /another device/.test(error.message)
  )
}

function signOutHere(error: unknown) {
  if (pushedOut(error)) {
    markSignedOutElsewhere()
    queryClient.setQueryData(cacheKey.me(), null)
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== cacheKey.me()[0],
    })
    return
  }
  // Sandbox tenancy: any `/api/*` call — not just the startup one — can
  // answer this once a business is removed out from under an open tab, or
  // never chosen at all. Treated exactly like a lapsed session: drop the
  // cached identity and re-ask tenancy, so `App` shows the door or chooser
  // instead of a screen of failures.
  if (isTenancySignOut(error)) {
    queryClient.setQueryData(cacheKey.me(), null)
    queryClient.removeQueries({
      predicate: (query) =>
        query.queryKey[0] !== cacheKey.me()[0] &&
        query.queryKey[0] !== tenancyQueryKey[0],
    })
    void queryClient.invalidateQueries({ queryKey: tenancyQueryKey })
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: signOutHere }),
  mutationCache: new MutationCache({ onError: signOutHere }),
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
    mutations: { retry: false },
  },
})

/// What the device holds of the masters a purchase order is written against —
/// suppliers, divisions, units — goes into the query cache first, so the New
/// PO form works with no connection; and orders made that way are sent as soon
/// as there is one (`lib/offline/po-outbox.ts`).
watchIdentity(queryClient)
/// The last answers of the lists on this device (`lib/query-persist.ts`), and
/// the first data of the screens fetched before they are opened
/// (`lib/prefetch.ts`). Persistence first: its read of the device's storage
/// overlaps the sign-in questions already on their way.
startPersistence(queryClient)
// No warm-up of other screens at load (owner, 2026-10-10: it slowed the first screen).
// `startPrefetch(queryClient)` from `lib/prefetch.ts` is intentionally not called.
// Development only: the client in the console, to see what is cached.
if (import.meta.env.DEV)
  (window as unknown as Record<string, unknown>).__queryClient = queryClient
hydrateReference(queryClient)
startOutbox(queryClient)

/// A warehouse session lapses on the node — thirty idle minutes, a restart —
/// while the screens reading it still hold its token. The first 401 for that
/// token drops it, and the Operations gate, seeing no DC session, exchanges
/// the Cloud one for a fresh session. Nobody is asked for a DC password.
edge.onBearerRejected(() => {
  setEdgeToken(null)
  queryClient.setQueryData(cacheKey.edgeMe(), null)
})

/// No service worker (owner, 2026-10-10: the offline worker misbehaves on
/// Windows and holds an old build in the browser). One that an earlier visit
/// installed is removed, with the caches it made. `public/sw.js` of this build
/// is a worker that does the same, so a browser still controlled by the old one
/// is freed on its next update check.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((all) => Promise.all(all.map((one) => one.unregister())))
    .catch(() => {})
  void caches
    ?.keys()
    .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    .catch(() => {})
}

/// A tab asking for a lazy chunk of a build that is gone. The server keeps the
/// previous build's chunks for a while, so this is the rare case (a tab left
/// open for weeks); reloading once is better than a dead "Something went
/// wrong" screen, and once is all: a second failure inside half a minute is a
/// real fault and shows as one.
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
      <TenancyProvider>
        <App />
      </TenancyProvider>
    </QueryClientProvider>
  </StrictMode>
)
