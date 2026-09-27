import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import "./index.css"
import App from "./App.tsx"

/// One client for the whole surface.
///
/// `retry: false` because this API answers a refusal with a reason a person
/// can read — a lapsed session, a missing CSRF token, leave that overruns a
/// balance — and retrying a 4xx just delays showing it.
///
/// `refetchOnWindowFocus` is on here, unlike the desk-bound surfaces: a phone
/// that has been in an apron pocket for four hours is showing a stale screen
/// the moment it is looked at again, and coming back to the app is exactly
/// when somebody wants to know whether their leave was approved.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: true, staleTime: 30_000 },
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
