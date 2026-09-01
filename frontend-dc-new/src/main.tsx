import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import "./styles/index.css"
import { App } from "@/App"

/// One client for the whole surface.
///
/// `retry: false` because this API answers a refusal with a reason a person can
/// read — an unpriced item, a missing CSRF token, a lapsed session — and
/// retrying a 4xx only delays showing it. `ApiError.worthRetrying` names the
/// cases where a retry is honest, and callers that want one ask for it.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
    mutations: { retry: false },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
