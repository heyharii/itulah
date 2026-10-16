import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"

import { bootClient } from "@/boot-client"
import { RouteError, RouteNotFound } from "@/components/route-states"
import { cacheKey } from "@/lib/api"
import { markSignedOutElsewhere } from "@/lib/session"
import { isTenancySignOut, tenancyQueryKey } from "@/lib/tenancy"
import { hubChildren } from "@/routes"
import { RootRoute } from "@/routes/__root"
import { ApiError } from "@itulah/contract/client"

/// One client per environment: per REQUEST on the server (a client shared
/// across requests would serve one user's seeded answers inside another
/// user's HTML), one for the app's life in the browser.
///
/// `retry: false` because this API answers a refusal with a reason a person
/// can read — an unpriced item, a missing CSRF token, a lapsed session — and
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

function signOutHere(queryClient: QueryClient, error: unknown) {
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
  // cached identity and re-ask tenancy, so the gate shows the door or chooser
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

function buildRouter() {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => signOutHere(queryClient, error),
    }),
    mutationCache: new MutationCache({
      onError: (error) => signOutHere(queryClient, error),
    }),
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  })

  const router = createRouter({
    routeTree: RootRoute.addChildren(hubChildren),
    context: { queryClient },
    defaultPreload: "intent",
    // A pointer must rest on a link this long before its code and data are
    // asked for (the router's default is 50): a sweep across the menu fetches
    // nothing.
    defaultPreloadDelay: 70,
    // The screens read the signed-in user's own data; a stale answer shown
    // for a moment is better than a spinner, and Query owns freshness anyway.
    defaultPreloadStaleTime: 0,
    // A suspense query that fails lands here, in the shell, with the server's
    // sentence (`components/route-states.tsx`).
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: RouteNotFound,
  })

  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

export function getRouter() {
  if (typeof window === "undefined") return buildRouter()
  const held = globalThis as { __hubRouter?: ReturnType<typeof buildRouter> }
  if (held.__hubRouter === undefined) {
    held.__hubRouter = buildRouter()
    // The one-time client boot: device persistence, the edge-session
    // listeners, the service worker, the look. Everything that must run once
    // in the browser and never on the server. (`main.tsx`, before the
    // migration.)
    bootClient(held.__hubRouter.options.context.queryClient)
  }
  return held.__hubRouter
}

// TanStack Router's required registration shape for a router built by a
// per-request factory. getRouter() must run fresh on every SSR request so the
// QueryClient is per-request — one shared instance would leak one user's data
// into another's HTML — and Router can only register a factory through this
// utility. Not a published contract; the framework's own seam.
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
