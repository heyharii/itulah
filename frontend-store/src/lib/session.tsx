import { createContext, useContext } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { auth, cacheKey, node } from "@/lib/api"
import {
  ApiError,
  type Identity,
  type NodeIdentity,
} from "@itulah/contract/client"

/// Who is at the till, and which node they are standing at.
///
/// `App` checks the session before it mounts the router — every screen behind
/// it reads the shop's own node, and a router running behind the login box
/// would fire a page of requests that can only answer 401. That leaves the
/// identity above the routes and needed inside them, which is what this
/// carries.
export interface Session {
  readonly identity: Identity
  readonly node: NodeIdentity | null
  /// Ends the session and returns the browser to the sign-in screen. Held here
  /// so that the header, which the router owns, does not have to be handed a
  /// callback through every route.
  readonly signOut: () => void
}

const SessionContext = createContext<Session | null>(null)

/// Mounted only once `/auth/me` has answered, so everything under it can read
/// an identity without a null check — a screen that had to handle "signed out"
/// would be handling a state it can never actually be rendered in.
export const SessionProvider = SessionContext.Provider

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (session === null) {
    throw new Error("useSession must be used inside a SessionProvider")
  }
  return session
}

/// Who is signed in, asked of the server rather than tracked by hand.
///
/// Three answers, not two, and the caller has to be able to tell them apart:
/// `isPending` is "we have not asked yet" and must not put a login box in
/// front of somebody who is already signed in, `null` is "sign in", and an
/// error is a node that could not be reached at all. So a lapsed session
/// resolves to `null` instead of throwing — `needsSignIn` is an answer, and
/// dressing it up as a failure would make the login box carry an error
/// message about the very thing it is there to fix.
export function useIdentity() {
  return useQuery({
    queryKey: cacheKey.me(),
    queryFn: async ({ signal }) => {
      try {
        return await auth.me(signal)
      } catch (error) {
        if (error instanceof ApiError && error.needsSignIn) {
          return null
        }
        throw error
      }
    },
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
    // A node does not change identity while somebody is standing at it, so it
    // is asked once.
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
      client.setQueryData(cacheKey.me(), null)
      // And with the answers fetched under it: a till is handed from one shift
      // to the next, and the takings the last person was reading are not the
      // next person's to see. Removed by domain rather than by emptying the
      // cache, because emptying it would take the `null` just written with it
      // — and an unanswered session key sends the login box straight back to
      // `/auth/me`.
      client.removeQueries({ queryKey: ["store"] })
      client.removeQueries({ queryKey: ["store-sales"] })
    },
  })
}
