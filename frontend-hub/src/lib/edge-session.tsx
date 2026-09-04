import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { cacheKey, edge, edgeAuth, setEdgeToken } from "@/lib/api"
import { useBenchActor } from "@/lib/operations/bench"
import { ApiError, type Identity } from "@itulah/contract/client"

/// The **warehouse** session, which is not the one in `lib/session.tsx`.
///
/// Two backends means two principals: the centre keeps its accounts in
/// Postgres, a DC edge node keeps its own — including break-glass accounts
/// that exist precisely so a warehouse can work when it cannot reach the
/// centre. So somebody signed in to the hub is not thereby signed in to the
/// warehouse, and this module says so out loud rather than letting the
/// Operations screens 401 one at a time.
///
/// Everything here is deliberately a parallel of the cloud session's hooks
/// rather than a generalisation of them. One pair of hooks taking a node
/// argument would put the two sessions one mistaken parameter apart, and the
/// mistake is invisible: it looks like it works, and shows one warehouse's
/// operator name over another node's queues.

/// The segment every warehouse cache key begins with.
///
/// It is what makes "forget the warehouse" expressible without touching the
/// centre's cache. Every key in `lib/queries/operations/*` starts with it; a
/// key that does not is a query that survives signing out of the node it came
/// from, which means showing one operator another's queues.
export const EDGE_KEY_PREFIX = "edge"

/// Who is signed in *at the node*, asked of the node rather than assumed from
/// the presence of a token. A token this browser kept can have expired on a
/// machine that was rebooted over the weekend.
export function useEdgeIdentity() {
  return useQuery({
    queryKey: cacheKey.edgeMe(),
    queryFn: async ({ signal }): Promise<Identity | null> => {
      // No token means "not signed in here", and asking would be a round trip
      // whose answer is already known — plus a 401 in the console on every
      // boot of a hub whose operator never opens Operations.
      if (!edge.hasBearer) return null
      try {
        return await edgeAuth.me(signal)
      } catch (error) {
        if (error instanceof ApiError && error.needsSignIn) {
          // The stored token is spent. Dropping it here is what stops every
          // later request from carrying a credential the node has forgotten.
          setEdgeToken(null)
          return null
        }
        throw error
      }
    },
    retry: false,
    staleTime: Infinity,
  })
}

/// Which node the Operations screens are actually reading.
///
/// Worth drawing beside the warehouse's own sign-in box: this app is served by
/// the centre, so nothing on screen otherwise says which building's numbers
/// these are. A node that cannot be reached at all resolves to `null` rather
/// than throwing — an unreachable DC is a fact about the warehouse, not a
/// failure of the hub.
export function useEdgeNodeIdentity() {
  return useQuery({
    queryKey: cacheKey.edgeIdentity(),
    queryFn: ({ signal }) => edge.identity({ signal }).catch(() => null),
    staleTime: Infinity,
  })
}

/// Signing in to the warehouse.
///
/// The token from the response body is what authorises everything after it —
/// see `lib/api.ts` for why the cookie the node also sets is not used. It is
/// stored before the identity is written to the cache, so nothing can observe
/// a signed-in identity through a client that is not yet carrying the token.
export function useEdgeSignIn() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: { username: string; password: string }) => {
      const response = await edgeAuth.login(input.username, input.password)
      setEdgeToken(response.token)
      return response
    },
    onSuccess: () => {
      // Not `setQueryData` from the login response: `LoginResponse.user` is a
      // `SessionUser` and `me` answers an `EdgeMe`, which is wider. Writing the
      // narrower shape under the wider key is how a screen ends up reading
      // `site_id` as undefined on a node that has one.
      client.invalidateQueries({ queryKey: cacheKey.edgeMe() })
    },
  })
}

/// Ending the warehouse session, leaving the hub's own session alone.
///
/// `onSettled` rather than `onSuccess`: whatever the node said — including
/// nothing at all, because the warehouse link went down — this browser is done
/// with the token, and staying signed in because the sign-out failed is the
/// wrong way round.
export function useEdgeSignOut() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => edgeAuth.logout(),
    onSettled: () => {
      setEdgeToken(null)
      client.setQueryData<Identity | null>(cacheKey.edgeMe(), null)
      // Every answer fetched from that node — the delivery on the bay, the
      // round somebody was half way through. Scoped by the `"edge"` prefix
      // every warehouse key carries, so the centre's cache is untouched: the
      // person is still signed in to the hub and should not watch it reload.
      const kept = [cacheKey.edgeMe(), cacheKey.edgeIdentity()].map((key) =>
        JSON.stringify(key)
      )
      client.removeQueries({
        predicate: (query) =>
          query.queryKey[0] === EDGE_KEY_PREFIX &&
          !kept.includes(JSON.stringify(query.queryKey)),
      })
    },
  })
}

/// The name to write into `actor_id` on a warehouse write.
///
/// The node overwrites this from its authenticated principal whenever auth is
/// on, so it is not a claim the browser gets to make. It matters on a node
/// running with auth **disabled** — a bench, a recovery, a bay with no route to
/// the centre — where the node writes what it is given.
///
/// The hub's own identity is not a fallback here, and that is the point: the
/// person at the centre is not the person at the bay, and stamping receipts
/// with a head-office username would put the wrong name on a two-person check.
export function useEdgeActor(): string {
  const identity = useEdgeIdentity()
  const where = useEdgeNodeIdentity()
  const bench = useBenchActor()
  if (where.data?.auth === "DISABLED" && bench !== null) return bench
  return identity.data?.username ?? "api"
}

/// Changing the password of whoever is signed in **at the node**.
///
/// **This ends the warehouse session.** `edge/http.rs::change_password`
/// answers through `cleared_auth_response`, which clears the session and the
/// CSRF cookie and says so in the body (`signed_out: true`). Treating it as an
/// ordinary write would leave somebody looking at a warehouse they can no
/// longer write to, and the first thing they pressed would be a 403 with no
/// explanation. So the token is dropped here exactly as sign-out drops it.
///
/// Not on `Auth` in `@itulah/contract` — that client covers login, logout and
/// `me`, and the contract package is generated and must not be edited — so the
/// path is written once here rather than at the call site.
export function useEdgeChangePassword() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { current: string; next: string }) =>
      edge.post<{ changed: boolean; signed_out: boolean }>(
        "/api/v1/auth/change-password",
        { current_password: input.current, new_password: input.next }
      ),
    onSuccess: () => {
      setEdgeToken(null)
      client.setQueryData<Identity | null>(cacheKey.edgeMe(), null)
    },
  })
}
