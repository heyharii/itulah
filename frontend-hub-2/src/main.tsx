import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { RouterProvider } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { router } from "@/router"
import "@/styles/index.css"

/// One client for the app.
///
/// `retry: 1` rather than the default 3: this app talks to a node on the same
/// origin, so a failure is usually a real answer — a 403, a 404, a validation
/// refusal — and retrying it three times turns an instant "no" into a
/// three-second wait for the same "no". One retry still covers the genuine
/// case, a dropped connection.
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // A finance figure that silently reloads under somebody's cursor while
      // they are reading it is worse than one that is a minute old and says so.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

/// Devtools, in development only.
///
/// `import.meta.env.DEV` is a literal Vite replaces at build time, so the whole
/// branch — and the imports it reaches — is dropped from the production bundle
/// by dead-code elimination. Nothing here ships.
///
/// They earn their place on this app in particular. Every list is an infinite
/// query keyed on a filter set, and every narrowing lives in the URL: when a
/// filter returns the wrong rows the question is always "which cache entry
/// answered, and what was in the search params" — and those two panels answer
/// it in a second instead of a `console.log` round trip.
const Devtools = import.meta.env.DEV ? (
  <>
    <ReactQueryDevtools buttonPosition="bottom-left" />
    <TanStackRouterDevtools router={router} position="bottom-right" />
  </>
) : null

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      {Devtools}
    </QueryClientProvider>
  </StrictMode>,
)
