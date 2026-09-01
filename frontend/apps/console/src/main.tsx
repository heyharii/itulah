import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ApiError } from "@itulah/client";
import { Gate } from "./Gate";
import { router } from "./router";

// A warehouse console talks to the DC's own edge, on the same machine or the
// same LAN. A refusal here is the server saying no, not the network — so only
// what could plausibly resolve itself is retried.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (attempt, error) =>
        attempt < 2 && (!(error instanceof ApiError) || error.worthRetrying),
      refetchOnWindowFocus: true,
      staleTime: 15_000,
    },
    mutations: { retry: false },
  },
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("the page has no root element to mount into");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Gate>
        <RouterProvider router={router} />
      </Gate>
    </QueryClientProvider>
  </StrictMode>,
);
