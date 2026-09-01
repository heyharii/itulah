import { createContext, useContext } from "react"

import type { Identity, NodeIdentity } from "@itulah/contract/client"

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
