/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from "react"

import type { Identity, NodeIdentity } from "@itulah/contract/client"

interface Session {
  readonly identity: Identity
  readonly node: NodeIdentity | null
  /// Ends the session and returns the browser to the sign-in screen. Held
  /// here so that the header, which the router owns, does not have to be
  /// handed a callback through every route.
  readonly signOut: () => void
}

const SessionContext = createContext<Session | null>(null)

/// Who is signed in, and which node they are standing at.
///
/// Mounted only once `/auth/me` has answered, so everything under it can read
/// an identity without a null check — a screen that had to handle "signed out"
/// would be handling a state it can never actually be rendered in.
export function SessionProvider({
  identity,
  node,
  signOut,
  children,
}: {
  identity: Identity
  node: NodeIdentity | null
  signOut: () => void
  children: React.ReactNode
}) {
  return (
    <SessionContext.Provider value={{ identity, node, signOut }}>
      {children}
    </SessionContext.Provider>
  )
}

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
