import type { ClockControlRequest, ClockStatus } from "@itulah/contract"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { clock } from "@/lib/api"
import { toast } from "@/lib/toast"

/// The virtual business clock — or the absence of one.
///
/// Polling every five seconds for something that is usually a wall clock is
/// deliberate but bounded: `retry: false` and the chip's own rendering rules
/// mean a node without test controls is asked politely once per focus and
/// never retried into a log full of 403s. The query exists so the top bar can
/// answer one question — is today real? — and nothing else.
export const clockKeys = { clock: ["clock"] as const }

export function useClockStatus() {
  return useQuery<ClockStatus>({
    queryKey: clockKeys.clock,
    queryFn: ({ signal }) => clock.status(signal),
    refetchInterval: 5_000,
    staleTime: 4_000,
    retry: false,
    refetchOnWindowFocus: true,
  })
}

/// Send one control op and take the returned status as the new truth.
///
/// The node answers every successful control with the full `ClockStatus`, so
/// `setQueryData` rather than an invalidate-and-refetch: the chip updates in
/// the same frame the button came back, instead of blinking through a
/// five-second-old cache entry that briefly says the opposite.
export function useClockControl() {
  const client = useQueryClient()
  return useMutation<ClockStatus, Error, ClockControlRequest>({
    mutationFn: (request) => clock.control(request),
    onSuccess: (status) => {
      client.setQueryData(clockKeys.clock, status)
    },
    onError: (error) => {
      // The server writes its errors for a person (see `client/error.ts`);
      // pass the sentence through rather than translating it again here.
      toast.error(error.message)
    },
  })
}
