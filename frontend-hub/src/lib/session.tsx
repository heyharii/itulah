import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { auth, cacheKey, edge, edgeAuth, node, setEdgeToken } from "@/lib/api"
import { forgetPushOnSignOut } from "@/lib/push"
import { ApiError, type Identity } from "@itulah/contract/client"

/// Who is signed in, asked of the server rather than tracked by hand.
///
/// Three answers, not two, and a caller has to keep them apart. `isPending` is
/// "we have not asked yet" and must not put a login box in front of somebody
/// already signed in. `null` is "sign in". An error is a node that could not be
/// reached at all. So a lapsed session resolves to `null` rather than throwing:
/// `needsSignIn` is an answer, and dressing it as a failure puts an error
/// message on the login box about the very thing the box fixes.
export function useIdentity() {
  return useQuery({
    queryKey: cacheKey.me(),
    queryFn: async ({ signal }): Promise<Identity | null> => {
      try {
        return await auth.me(signal)
      } catch (error) {
        if (error instanceof ApiError && error.needsSignIn) return null
        throw error
      }
    },
    // A second attempt with the same cookie cannot answer differently.
    retry: false,
    // Asked once and then believed. A session does not lapse because a screen
    // remounted, and re-asking would put a sign-in check in front of somebody
    // half way through writing an order.
    staleTime: Infinity,
  })
}

/// Which node this surface is talking to. Named under the login box as a
/// courtesy, so failing to fetch it is not a sign-in problem and must not be
/// reported as one — hence `null` on any failure.
export function useNodeIdentity() {
  return useQuery({
    queryKey: cacheKey.identity(),
    queryFn: ({ signal }) => node.identity({ signal }).catch(() => null),
    staleTime: Infinity,
  })
}

/// Ending the session, from wherever the button is.
///
/// `onSettled` rather than `onSuccess`: whatever the server said — including
/// nothing at all, because the network went away — this browser is done with
/// the session, and leaving somebody signed in because the sign-out request
/// failed is the wrong way round.
export function useSignOut() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      // Revoke the local DC session while its bearer is still available. A
      // disconnected DC must not prevent the Cloud sign-out from completing.
      const edgeLogout = edge.hasBearer
        ? edgeAuth.logout().catch(() => undefined)
        : Promise.resolve()
      // This browser stops being woken for this person, and first — the
      // server only removes a subscription for the session that owns it.
      // Never throws; see `lib/push.ts` for why a shared tablet needs it.
      await forgetPushOnSignOut()
      await Promise.all([auth.logout(), edgeLogout])
    },
    onSettled: () => {
      setEdgeToken(null)
      client.setQueryData<Identity | null>(cacheKey.me(), null)
      // And every answer fetched under it — an order book, a ledger, somebody's
      // employment record — none of which the next person at this desk is
      // entitled to see. Not `client.clear()`, which would throw away the
      // `null` just written and send the login screen off to ask `/auth/me`
      // again; the two session keys are the short list, so everything else goes.
      client.removeQueries({
        predicate: (query) =>
          query.queryKey[0] !== cacheKey.me()[0] &&
          query.queryKey[0] !== cacheKey.identity()[0],
      })
    },
  })
}

/// Why the last session here ended, when it was ended from somewhere else.
///
/// Kept in `sessionStorage` so it survives the reload an operator reaches for
/// when a screen goes blank, and read once by the login box.
const PUSHED_OUT = "itulah.signed-out-elsewhere"

export function markSignedOutElsewhere() {
  try {
    sessionStorage.setItem(PUSHED_OUT, "1")
  } catch {
    // Storage blocked: the login box simply appears without the reason.
  }
}

/// The sentence the login box shows, or null — and forgets it once read by a
/// successful sign-in (`clearSignedOutElsewhere`).
export function signedOutElsewhere(): string | null {
  try {
    return sessionStorage.getItem(PUSHED_OUT) === null
      ? null
      : "You were signed out because this account signed in on another device."
  } catch {
    return null
  }
}

export function clearSignedOutElsewhere() {
  try {
    sessionStorage.removeItem(PUSHED_OUT)
  } catch {
    // Nothing to clear.
  }
}
