import { QueryClient } from "@tanstack/react-query"

import { isApiError } from "./client"

/** One cache for the whole suite; the router holds the reference. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // A 4xx will not fix itself on a retry — only transport faults will.
        if (isApiError(error) && error.status && error.status < 500) return false
        return failureCount < 2
      },
    },
  },
})
