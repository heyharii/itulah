import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import "./styles/index.css"
import App from "./App.tsx"
import { MemberProvider } from "@/components/member-provider"

/// One client for the whole surface.
///
/// `retry: false` because this API answers a refusal with a reason a person can
/// read — a lapsed session, a receipt that is not yours — and retrying a 4xx
/// just delays showing it. `ApiError.worthRetrying` names the cases where a
/// retry is honest, and the error state offers the button then.
///
/// `refetchOnWindowFocus` is on here, unlike the operator surfaces: a member
/// puts the phone down at the counter, the cashier rings the sale through, and
/// they look again — that is exactly the moment the points figure should be
/// refetched rather than left stale.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: true, staleTime: 30_000 },
    mutations: { retry: false },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MemberProvider>
        <App />
      </MemberProvider>
    </QueryClientProvider>
  </StrictMode>,
)
