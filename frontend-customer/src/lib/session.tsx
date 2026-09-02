import { createContext, useContext } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { cacheKey, member, node } from "@/lib/api"
import { ApiError } from "@itulah/contract/client"
import type { MemberIdentity } from "@itulah/contract"

/// Whose card this phone is showing.
///
/// It used to be a string in `localStorage` — the number somebody typed, which
/// the code was careful to describe as "a card number, not a credential",
/// because anyone who guessed one could read that member's purchases. It is
/// now the answer to `GET /api/v1/member/me`, which is to say it is whatever
/// the session cookie says and nothing the page can assert for itself.
///
/// Nothing in this app stores the member id. There is nothing to store: the
/// cookie is `HttpOnly`, so no script here or anywhere else can read the thing
/// that actually authorises a request.
export function useMemberSession() {
  return useQuery({
    queryKey: cacheKey.me(),
    // A lapsed or absent session is not a failure — it is a shopper who has
    // not paired this phone yet, and the pairing screen is the answer rather
    // than an error. Anything else IS a failure and is left to surface.
    queryFn: ({ signal }) =>
      member.me(signal).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          return null
        }
        throw error
      }),
    staleTime: 60_000,
  })
}

/// Which node answered, for the line under the pairing form.
export function useNodeIdentity() {
  return useQuery({
    queryKey: cacheKey.node(),
    queryFn: ({ signal }) => node.identity({ signal }).catch(() => null),
    staleTime: Infinity,
  })
}

/// Unpair this phone.
///
/// Revokes the session at the server rather than only forgetting it here: a
/// phone handed on, sold or lost must stop being able to read the points, and
/// a client that merely cleared its own cache would leave the cookie working.
export function useSignOut() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => member.signOut(),
    // Everything cached was scoped to the session that just ended. Clearing
    // the lot is not tidiness — a shared phone means the next person to pair
    // is somebody else, and a stale summary would be their predecessor's.
    onSettled: () => client.clear(),
  })
}

export interface Session {
  readonly member: MemberIdentity
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
