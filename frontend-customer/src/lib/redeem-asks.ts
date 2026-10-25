import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { cacheKey, member } from "@/lib/api"
import { useDocumentVisible } from "@/lib/motion"
import type { RedeemRequest } from "@itulah/contract"

/// The cashier's asks to spend this member's points, and the one of them that
/// is waiting on an answer right now.
///
/// A shopper never starts a redemption: the cashier asks at the till, and the
/// phone is where it is answered. So nothing here can wait for the shopper to
/// open a screen — an ask has to find them wherever they are in the app.

/// How often the redeem screen asks while it is open. The cashier is standing
/// there with the till waiting on the answer, and so is the shopper.
export const WATCH_MS = 3_000

/// How often the rest of the app asks, while it is on screen. Calmer: the
/// phone is usually in a pocket, and a tab in the background asks nothing.
export const ASK_POLL_MS = 6_000

/// A read younger than this is not asked again by a screen that mounts, so
/// moving between tabs costs nothing — but coming back to the app after the
/// phone was put down does, which is the moment an ask is most likely waiting.
const FRESH_MS = 2_000

/// Reads the asks, and picks out the live one.
///
/// `every` is how often to re-ask while the app is visible, or `false` to only
/// read what somebody else's poll has already fetched. Exactly one place polls
/// at a time (`AskNotifier`, or the redeem screen when it is open): every
/// observer with an interval fires its own request, so three screens each
/// asking every few seconds would be three times the traffic for one answer.
export function useLiveAsk(every: number | false = false) {
  const visible = useDocumentVisible()
  const requests = useQuery({
    queryKey: cacheKey.redeemRequests(),
    queryFn: ({ signal }) => member.redeemRequests(signal),
    staleTime: FRESH_MS,
    refetchInterval: every !== false && visible ? every : false,
  })

  const candidate = newestPending(requests.data, requests.dataUpdatedAt)

  // The clock running out is not something the server announces, so the ask
  // goes when its own `expires_at` passes, whether or not a poll has landed.
  const [lapsed, setLapsed] = useState<string | null>(null)
  const candidateId = candidate?.request_id
  const expiresAt = candidate?.expires_at
  useEffect(() => {
    if (candidateId === undefined || expiresAt === undefined) return
    const timer = setTimeout(
      () => setLapsed(candidateId),
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [candidateId, expiresAt])

  const ask = candidate !== undefined && candidate.request_id !== lapsed ? candidate : undefined
  return { requests, ask }
}

/// The newest ask still pending as of `readAt` — the instant the list was
/// read, so this stays a plain function of what was fetched. A list read a
/// while ago may still call an ask PENDING after its time has gone; comparing
/// against the read keeps that one from being shown.
function newestPending(
  requests: readonly RedeemRequest[] | undefined,
  readAt: number,
): RedeemRequest | undefined {
  let newest: RedeemRequest | undefined
  for (const request of requests ?? []) {
    if (request.status !== "PENDING" || Date.parse(request.expires_at) <= readAt) continue
    if (newest === undefined || Date.parse(request.requested_at) > Date.parse(newest.requested_at)) {
      newest = request
    }
  }
  return newest
}
