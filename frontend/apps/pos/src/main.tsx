import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ApiError } from "@itulah/client";
import { RouterProvider } from "@tanstack/react-router";

import { router } from "./router";

// How the till treats a failed request.
//
// A shop's edge is on the same machine or the same LAN, so a failure here is
// rarely the network — it is usually the server saying no. Retrying a refusal
// wastes the cashier's time and can look like the till is stuck, so only the
// failures that could plausibly resolve themselves are retried.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (attempt, error) =>
        attempt < 2 && (!(error instanceof ApiError) || error.worthRetrying),
      // A price book can land at any moment. Refetching when the window is
      // focused again is how a till notices without anybody pressing anything.
      refetchOnWindowFocus: true,
      staleTime: 30_000,
    },
    mutations: {
      // Never retry a sale. It carries an idempotency key, so a resend is safe
      // at the server — but a silent retry hides from the cashier that the
      // first attempt is still in flight, and two people pressing "complete"
      // is exactly how a shop ends up arguing about one receipt.
      retry: false,
    },
  },
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("the page has no root element to mount into");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
