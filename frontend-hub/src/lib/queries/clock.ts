import type { ClockControlRequest, ClockStatus } from "@itulah/contract"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { clock } from "@/lib/api"
import { toast } from "@/lib/toast"
import { ApiError } from "@itulah/contract/client"

/// The virtual business clock — or the absence of one.
///
/// Polling every five seconds for something that is usually a wall clock is
/// deliberate but bounded: `retry: false` and the chip's own rendering rules
/// mean a node without test controls is asked politely once per focus and
/// never retried into a log full of 403s. The query exists so the top bar can
/// answer one question — is today real? — and nothing else.
export const clockKeys = { clock: ["clock"] as const }

/// A 403 is not "try again in five seconds" — it is "there is no clock here
/// this session", the same fact `retry: false` already treats a single fetch
/// to. `refetchInterval` and `refetchOnWindowFocus` read the query's own last
/// error rather than a flag kept beside it, so the moment a control is turned
/// ON again the very next successful poll (a fresh tab, say) resumes it —
/// nothing here has to be told that happened.
function unavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403
}

export function useClockStatus() {
  return useQuery<ClockStatus>({
    queryKey: clockKeys.clock,
    queryFn: ({ signal }) => clock.status(signal),
    refetchInterval: (query) => (unavailable(query.state.error) ? false : 5_000),
    staleTime: 4_000,
    retry: false,
    refetchOnWindowFocus: (query) => !unavailable(query.state.error),
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
