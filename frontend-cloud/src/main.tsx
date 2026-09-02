import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

/// One client for the whole surface.
///
/// `retry: false` because this API answers a refusal with a reason a person can
/// read — an unpriced item, a missing CSRF token, a lapsed session — and
/// retrying a 4xx just delays showing it. `ApiError.worthRetrying` names the
/// cases where a retry is honest, and callers that want one ask for it.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
    mutations: { retry: false },
  },
})

/// A skipped page turn is not an error, but it arrives as one.
///
/// The router starts the transition (`defaultViewTransition` in `router.tsx`)
/// and then awaits `updateCallbackDone`; it never touches the `ready` promise.
/// When the browser declines to run the animation — a hidden tab is the common
/// case, a second navigation arriving mid-transition the other — `ready`
/// rejects with `InvalidStateError`, nobody is listening, and an ordinary
/// navigation prints an uncaught rejection. Nothing failed: the navigation
/// committed, and the only casualty was the fade.
///
/// So the rejection is claimed here rather than left to the console. A console
/// that cries wolf every time a background tab changes screen is a console
/// nobody reads on the day something is actually wrong.
if ("startViewTransition" in document) {
  const start = document.startViewTransition.bind(document)
  document.startViewTransition = (...args) => {
    const transition = start(...args)
    transition.ready.catch(() => {})
    return transition
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
)
