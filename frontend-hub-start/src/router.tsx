import { QueryClient } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // One client policy carried over from frontend-hub's api.ts: this API
        // answers a refusal with a reason a person can read, and retrying a
        // 4xx only delays showing it.
        retry: false,
        staleTime: 30_000,
      },
    },
  })

  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    // Queries own their staleness; preload fetches are not answers.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  })

  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

// TanStack Router's required registration shape for a router built by a
// per-request factory. getRouter() must run fresh on every SSR request so the
// QueryClient is per-request — one shared instance would leak one user's
// seeded data into another's HTML — and Router can only register a factory
// through this utility. Not a published contract; the framework's own seam.
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
