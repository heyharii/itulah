import { createContext, useContext } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { auth, cacheKey, node } from "@/lib/api"
import {
  ApiError,
  type Identity,
  type NodeIdentity,
} from "@itulah/contract/client"

/// The signed-in person, made reachable from inside the router.
///
/// `App` checks the session before it mounts the router — the screens below
/// all read one employee's own record and a router running behind the login
/// box would fire a page of requests that can only answer 401. That leaves the
/// identity above the routes and needed inside them, which is what this
/// carries. Sign-out lives here for the same reason: it belongs on the
/// account screen, three routes down from the component that owns the state.
export interface Session {
  readonly identity: Identity
  readonly node: NodeIdentity | null
  readonly signOut: () => void
}

const SessionContext = createContext<Session | undefined>(undefined)

export const SessionProvider = SessionContext.Provider

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (session === undefined) {
    throw new Error("useSession must be used within a SessionProvider")
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
    // Retrying a refusal only delays the login box: nothing about a second
    // attempt with the same cookie would answer differently.
    retry: false,
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
      // And with the answers fetched under it: every one of them is this
      // employee's own record.
      client.removeQueries({ queryKey: ["hr"] })
    },
  })
}
