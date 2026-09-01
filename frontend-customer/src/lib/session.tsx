/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import type { Identity, NodeIdentity } from "@itulah/contract/client"

/// Who is signed in to the node, and which node it is.
///
/// Held above the router so that the profile screen can show it and end it
/// without every screen between here and there passing it down. This is the
/// NODE session — not the member. The two are different things today and the
/// profile screen says so plainly rather than implying a member account
/// exists.
interface Session {
  identity: Identity
  node: NodeIdentity | null
  signOut: () => void
}

const SessionContext = React.createContext<Session | undefined>(undefined)

export function SessionProvider({
  value,
  children,
}: {
  value: Session
  children: React.ReactNode
}) {
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSession(): Session {
  const context = React.useContext(SessionContext)
  if (context === undefined) {
    throw new Error("useSession must be used within a SessionProvider")
  }
  return context
}
