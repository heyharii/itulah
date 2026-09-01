import { createContext, useContext } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { auth, node } from "@/lib/api"
import { keys } from "@/lib/queries"
import {
  ApiError,
  type Identity,
  type NodeIdentity,
} from "@itulah/contract/client"

/// Who is signed in, and which node they are standing at.
///
/// `App` checks the session before it mounts the router — every operations
/// screen reads this node's work queues, and a router running behind the login
/// box would fire a page of requests that can only answer 401. That leaves the
/// identity above the routes and needed inside them, which is what this
/// carries.
export interface Session {
  readonly identity: Identity
  readonly node: NodeIdentity | null
  /// Ends the session and returns the browser to the sign-in screen. Held
  /// here so that the header, which the router owns, does not have to be
  /// handed a callback through every route.
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

/// The name to write into `actor_id`.
///
/// The node overwrites this from the authenticated principal whenever auth is
/// on, so this is not a claim the browser gets to make — it is what a node
/// running with auth disabled (a bench, a recovery) writes instead of nothing.
export function useActor(): string {
  return useSession().identity.username
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
    queryKey: keys.session(),
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
    // Asked once and then believed. Re-asking on every window focus would put
    // a sign-in check in front of somebody who just picked the tablet back up.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

/// Which node this surface is talking to.
///
/// Named under the login box as a courtesy, so failing to fetch it is not a
/// sign-in problem and must not be reported as one — hence `null` on any
/// failure rather than an error somebody would have to read past.
export function useNodeIdentity() {
  return useQuery({
    queryKey: keys.node(),
    queryFn: ({ signal }) => node.identity({ signal }).catch(() => null),
    // A node does not change identity while somebody is standing at it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
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
      client.setQueryData(keys.session(), null)
      // And with the answers fetched under it: the next person to sign in at
      // this bench must not be shown the last one's queues. Removed by domain
      // rather than by emptying the cache, because emptying it would take the
      // `null` just written with it — and an unanswered session key sends the
      // login box straight back to `/auth/me`.
      client.removeQueries({ queryKey: ["dc"] })
      client.removeQueries({ queryKey: ["inventory"] })
    },
  })
}
