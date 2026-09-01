import { RouterProvider } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"

import { LoginForm } from "@/components/login-form"
import { MemberGate } from "@/components/member-gate"
import { cacheKey } from "@/lib/api"
import { useMember } from "@/lib/member"
import {
  SessionProvider,
  useIdentity,
  useNodeIdentity,
  useSignOut,
} from "@/lib/session"
import { router } from "@/router"
import { ApiError } from "@itulah/contract/client"

/// Two gates, in this order: the node session, then the member's card.
///
/// The session comes first because without it every request fails, and asking
/// somebody for a card number only to show them an error would waste the one
/// thing they had to type. The card comes second because it decides whose
/// points are on screen, and every screen behind it can then assume it exists.
export default function App() {
  const client = useQueryClient()
  // Three states, not two. While the session query is pending nobody has been
  // asked anything yet: showing a login box during that moment makes an
  // already-signed-in person type their password for nothing.
  const identity = useIdentity()
  const where = useNodeIdentity()
  const { mutate: signOut } = useSignOut()
  const { memberId } = useMember()
  // `undefined` (not asked yet) and `null` (asked, could not say) mean the
  // same thing to the line under the login box.
  const here = where.data ?? null

  // Not "please sign in" — a lapsed session resolves to `null` rather than an
  // error, so anything left here is the node being unreachable or refusing for
  // some other reason. A bare login box would fail again for a cause nobody
  // watching the screen could see.
  const problem =
    identity.error === null
      ? null
      : identity.error instanceof ApiError
        ? identity.error.message
        : "Tidak dapat menghubungi server."

  if (identity.isPending) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">Memeriksa sesi…</p>
      </main>
    )
  }

  if (identity.data === null || identity.data === undefined) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <LoginForm
            onSignedIn={(session) => {
              // Writing the answer rather than refetching it: the login
              // response already carries the person the server just
              // authenticated, and it clears the failure with it.
              client.setQueryData(cacheKey.me(), session.user)
            }}
          />
          {problem !== null && (
            <p role="alert" className="text-destructive text-center text-sm">
              {problem}
            </p>
          )}
          {here !== null && (
            <p className="text-muted-foreground text-center text-xs">
              {here.node_id} · {here.node_role}
            </p>
          )}
        </div>
      </main>
    )
  }

  if (memberId === null) {
    return <MemberGate />
  }

  return (
    <SessionProvider value={{ identity: identity.data, node: here, signOut }}>
      <RouterProvider router={router} />
    </SessionProvider>
  )
}
