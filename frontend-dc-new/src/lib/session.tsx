import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { auth, cacheKey, node } from "@/lib/api"
import { useBenchActor } from "@/lib/bench"
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
    // half way through a pick round.
    staleTime: Infinity,
  })
}

/// Which node this surface is talking to.
///
/// Named under the login box as a courtesy, so failing to fetch it is not a
/// sign-in problem and must not be reported as one — hence `null` on any
/// failure. This is also `GET /api/v1/health`: the node's own statement of its
/// role, its site, whether authentication is on, and which operations it
/// performs locally.
export function useNodeIdentity() {
  return useQuery({
    queryKey: cacheKey.identity(),
    queryFn: ({ signal }) => node.identity({ signal }).catch(() => null),
    staleTime: Infinity,
  })
}

/// The name to write into `actor_id`.
///
/// The node overwrites this from the authenticated principal whenever auth is
/// on, so it is not a claim the browser gets to make — it is what a node
/// running with auth **disabled** (a bench, a recovery, a bay with no route to
/// the centre) writes instead of nothing.
///
/// On such a node the bench may name the person at it, and that name wins. Not
/// a convenience: receiving is two people by database constraint, so a node
/// where every write carries one principal cannot complete a delivery at all.
/// See `lib/bench.ts`.
export function useActor(): string {
  const identity = useIdentity()
  const where = useNodeIdentity()
  const bench = useBenchActor()
  if (where.data?.auth === "DISABLED" && bench !== null) return bench
  return identity.data?.username ?? "api"
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
    mutationFn: () => auth.logout(),
    onSettled: () => {
      client.setQueryData<Identity | null>(cacheKey.me(), null)
      // And every answer fetched under it — the delivery on the bay, the
      // round somebody was half way through — none of which the next person
      // at this bench should be shown as theirs. Not `client.clear()`, which
      // would throw away the `null` just written and send the login screen off
      // to ask `/auth/me` again; the two session keys are the short list, so
      // everything else goes.
      client.removeQueries({
        predicate: (query) =>
          query.queryKey[0] !== cacheKey.me()[0] &&
          query.queryKey[0] !== cacheKey.identity()[0],
      })
    },
  })
}

/// Changing the password of whoever is signed in.
///
/// **This ends the session.** `edge/http.rs::change_password` answers through
/// `cleared_auth_response`, which clears the session *and* the CSRF cookie and
/// says so in the body (`signed_out: true`). A screen that treated this as an
/// ordinary write would leave somebody looking at a warehouse they can no
/// longer write to, and the first thing they pressed would be a 403 with no
/// explanation. So the local session is torn down here, exactly as sign-out
/// does it, and the login box comes back.
///
/// Not on `Auth` in `@itulah/contract` — that client covers login, logout and
/// `me`, and the contract package is generated and must not be edited — so the
/// path is written once here rather than at the call site.
export function useChangePassword() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { current: string; next: string }) =>
      node.post<{ changed: boolean; signed_out: boolean }>(
        "/api/v1/auth/change-password",
        { current_password: input.current, new_password: input.next }
      ),
    onSuccess: () => {
      client.setQueryData<Identity | null>(cacheKey.me(), null)
      client.removeQueries({
        predicate: (query) =>
          query.queryKey[0] !== cacheKey.me()[0] &&
          query.queryKey[0] !== cacheKey.identity()[0],
      })
    },
  })
}
