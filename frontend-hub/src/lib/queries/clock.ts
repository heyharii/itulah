import type { ClockControlRequest, ClockStatus } from "@itulah/contract"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { clock } from "@/lib/api"
import { ApiError } from "@itulah/contract/client"

/// The virtual business clock — or the absence of one.
///
/// Polling every five seconds for something that is usually a wall clock is
/// deliberate but bounded: `retry: false` and the Time button's own rendering
/// rules mean a node without test controls is asked politely once per focus
/// and never retried into a log full of 403s.
export const clockKeys = { clock: ["clock"] as const }

/// A 403 is not "try again in five seconds" — it is "there is no clock here
/// this session". `refetchInterval` and `refetchOnWindowFocus` read the
/// query's own last error, so a control turned ON again resumes on the next
/// successful poll without being told.
function unavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403
}

export function useClockStatus() {
  return useQuery<ClockStatus>({
    queryKey: clockKeys.clock,
    queryFn: ({ signal }) => clock.status(signal),
    refetchInterval: (query) =>
      unavailable(query.state.error) ? false : 5_000,
    staleTime: 4_000,
    retry: false,
    refetchOnWindowFocus: (query) => !unavailable(query.state.error),
  })
}

/// How far business time stands from the wall clock, in ms — 0 on the wall
/// clock, and 0 for anyone the clock endpoint does not answer.
export function useBusinessOffset(): number {
  const status = useClockStatus().data
  if (status === undefined || status.virtual_now === null) return 0
  return Date.parse(status.virtual_now) - Date.parse(status.real_now)
}

/// "Now" for a calculation the screen makes itself (overdue, late, age): the
/// virtual clock's instant when time is bent, else the wall clock.
///
/// Pass the real instant the data was read at (`dataUpdatedAt`) so the answer
/// is pinned to the fetch, not to the render; without it, the instant the
/// component mounted.
export function useBusinessNow(realAt?: number): number {
  const offset = useBusinessOffset()
  const [mounted] = useState(() => Date.now())
  return (realAt ?? mounted) + offset
}

/// A refusal written for the tester, not the log. The server's 409 names
/// RFC3339 instants and plan sections; the person needs one sentence.
export function clockProblem(error: unknown): string {
  if (error instanceof ApiError && error.status === 409)
    return "Time only moves forward. Pick a moment after the current business time."
  if (error instanceof ApiError && error.status === 403)
    return "Time travel is off on this server."
  return error instanceof Error ? error.message : "The clock did not change."
}

/// Send one control op and take the returned status as the new truth, then
/// re-read everything: due/late flags and ages on every list were computed
/// at the old "now".
export function useClockControl() {
  const client = useQueryClient()
  return useMutation<ClockStatus, Error, ClockControlRequest>({
    mutationFn: (request) => clock.control(request),
    onSuccess: (status) => {
      client.setQueryData(clockKeys.clock, status)
      void client.invalidateQueries()
    },
  })
}
