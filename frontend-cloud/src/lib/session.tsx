import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { auth, cacheKey, node } from "@/lib/api"
import { ApiError, type Identity } from "@itulah/contract/client"

/// Who is signed in, asked of the server rather than tracked by hand.
///
/// Three answers, not two, and the caller has to be able to tell them apart:
/// `isPending` is "we have not asked yet" and must not put a login box in
/// front of somebody who is already signed in, `null` is "sign in", and an
/// error is a node that could not be reached at all. So a lapsed session
/// resolves to `null` instead of throwing — `needsSignIn` is an answer, and
/// dressing it up as a failure would make the login box carry an error
/// message about the very thing it is there to fix.
///
/// One query for the whole surface. The screens that write an `actor_id` read
/// it from here too, and when they asked under a key of their own the same
/// endpoint was fetched twice on every first load.
export function useIdentity() {
  return useQuery({
    queryKey: cacheKey.me(),
    queryFn: async ({ signal }): Promise<Identity | null> => {
      try {
        return await auth.me(signal)
      } catch (error) {
        if (error instanceof ApiError && error.needsSignIn) {
          return null
        }
        throw error
      }
    },
    // Retrying a refusal only delays the login box: nothing about a second
    // attempt with the same cookie would answer differently.
    retry: false,
    // Asked once and then believed. A session does not lapse because a screen
    // was remounted, and re-asking would put a sign-in check in front of
    // somebody in the middle of writing an order.
    staleTime: Infinity,
  })
}

/// Which node this surface is talking to.
///
/// Named under the login box as a courtesy, so failing to fetch it is not a
/// sign-in problem and must not be reported as one — hence `null` on any
/// failure rather than an error somebody would have to read past.
export function useNodeIdentity() {
  return useQuery({
    queryKey: cacheKey.identity(),
    queryFn: ({ signal }) => node.identity({ signal }).catch(() => null),
    // A node does not change identity while somebody is signed in to it.
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
    mutationFn: () => auth.logout(),
    onSettled: () => {
      client.setQueryData<Identity | null>(cacheKey.me(), null)
      // And the answers fetched under it: an order book, a ledger, somebody's
      // employment record, none of which the next person to sign in at this
      // desk is entitled to see. Not `client.clear()`, which would throw away
      // the `null` just written and send the login screen off to ask
      // `/auth/me` all over again; and not a list of domain prefixes, because
      // this surface has a dozen of them and gains one most weeks. The two
      // session keys are the short list, so everything else goes.
      client.removeQueries({
        predicate: (query) =>
          query.queryKey[0] !== cacheKey.me()[0] &&
          query.queryKey[0] !== cacheKey.identity()[0],
      })
    },
  })
}
