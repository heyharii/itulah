import { useQueryClient } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { useEffect } from "react"

import { LoginForm } from "@/components/login-form"
import { cacheKey } from "@/lib/api"
import { startOutbox } from "@/lib/outbox"
import { useIdentity, useNodeIdentity } from "@/lib/session"
import { router } from "@/routes"
import { ApiError, type Identity } from "@itulah/contract/client"

export function App() {
  const queryClient = useQueryClient()

  // Three states, not two. While the session query is pending nobody has been
  // asked anything: showing a login box during that moment makes an
  // already-signed-in picker type their password for nothing.
  const session = useIdentity()
  const where = useNodeIdentity()

  // The pump runs above the login gate, and that is deliberate. A session can
  // lapse with work still queued — the phone sat in a pocket over lunch — and
  // that work has to go on trying to reach the node. `shouldRetry` treats a 401
  // as retryable for exactly this reason: the count is good, the browser merely
  // has to sign in again, and the moment it does the backlog clears itself.
  useEffect(() => startOutbox(), [])

  // A lapsed session resolves to `null` rather than an error, so anything left
  // here is the node being unreachable or refusing for some other reason. A bare
  // login box would fail again for a cause nobody watching could see.
  const problem =
    session.error === null
      ? null
      : session.error instanceof ApiError
        ? session.error.message
        : "node gudang ini tidak bisa dihubungi"

  if (session.isPending) {
    return (
      <main className="grid h-svh place-items-center">
        <p className="text-meta text-body">Memeriksa sesi Anda…</p>
      </main>
    )
  }

  if ((session.data ?? null) === null) {
    return (
      <main className="h-svh">
        <LoginForm
          problem={problem}
          node={where.data ?? null}
          onSignedIn={(signedIn) => {
            // Writing the answer rather than refetching it: the login response
            // already carries the person the node just authenticated, and it
            // clears the failure with it.
            queryClient.setQueryData<Identity | null>(
              cacheKey.me(),
              signedIn.user,
            )
          }}
        />
      </main>
    )
  }

  return <RouterProvider router={router} />
}
