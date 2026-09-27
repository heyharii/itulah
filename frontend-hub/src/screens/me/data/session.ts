import type { Identity, NodeIdentity } from "@itulah/contract/client"

import { useIdentity, useNodeIdentity, useSignOut } from "@/lib/session"

export { useSignOut }

/// The employee app's session, answered by the hub's own.
///
/// The screens that moved in from frontend-employee read who is signed in
/// through `useSession()`, which that app fed from a provider above its
/// router. The hub already knows — the shell only renders once somebody is
/// signed in — so this reads the same two queries instead of a second
/// provider, and the screens did not have to change.
export interface Session {
  readonly identity: Identity
  readonly node: NodeIdentity | null
  readonly signOut: () => void
}

export function useSession(): Session {
  const identity = useIdentity()
  const node = useNodeIdentity()
  const signOut = useSignOut()
  return {
    identity: identity.data ?? {
      username: "",
      display_name: "",
      role: "CASHIER",
    },
    node: node.data ?? null,
    signOut: () => signOut.mutate(),
  }
}
