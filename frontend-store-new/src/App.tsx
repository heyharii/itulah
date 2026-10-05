import { useQueryClient } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { useEffect } from "react"

import { LoginForm } from "@/components/login-form"
import { ServerStatus } from "@/components/server-status"
import { cacheKey } from "@/lib/api"
import { startBasket } from "@/lib/basket"
import { startSaleQueue } from "@/lib/sale-queue"
import { useIdentity, useNodeIdentity } from "@/lib/session"
import { router } from "@/routes"
import { ApiError } from "@itulah/contract/client"

export function App() {
  const queryClient = useQueryClient()

  // Three states, not two. While the session query is pending nobody has been
  // asked anything: showing a login box during that moment makes an
  // already-signed-in cashier type their password for nothing.
  const session = useIdentity()
  const where = useNodeIdentity()

  // The pump runs above the login gate, and that is deliberate. A session can
  // lapse with sales still queued — the tablet sat idle over lunch — and those
  // sales are money that must go on trying to reach the node. `shouldRetry`
  // treats a 401 as retryable for exactly this reason: the sale is good, the
  // browser merely has to sign in again, and the moment it does the backlog
  // clears itself.
  useEffect(() => startSaleQueue(), [])

  // Two of these end up open on one tablet more often than anyone plans, and
  // both stores write the whole of their key. Without this the second tab
  // silently erases what the first one scanned.
  useEffect(() => startBasket(), [])

  // A lapsed session resolves to `null` rather than an error, so anything left
  // here is the node being unreachable or refusing for some other reason. A
  // bare login box would fail again for a cause nobody watching could see.
  const problem =
    session.error === null
      ? null
      : session.error instanceof ApiError
        ? session.error.message
        : "could not reach this shop's node"

  if (session.isPending) {
    return (
      <main className="grid h-svh place-items-center">
        <ServerStatus />
        <p className="text-meta text-body">Checking your session…</p>
      </main>
    )
  }

  if ((session.data ?? null) === null) {
    return (
      <main className="h-svh">
        <ServerStatus />
        <LoginForm
          problem={problem}
          node={where.data ?? null}
          onSignedIn={() => {
            // Asked again rather than written from the answer, and the
            // difference matters: a login response carries `SessionUser`,
            // which is NOT what `/auth/me` answers — the Edge's `me` also
            // names the site the caller stands in and the Cloud's also names
            // the job role and the sections. Writing the login's shape into
            // this cache would leave every screen reading fields the value
            // does not have. One round trip, once, on the way in.
            void queryClient.invalidateQueries({ queryKey: cacheKey.me() })
          }}
        />
      </main>
    )
  }

  return (
    <>
      <ServerStatus />
      <RouterProvider router={router} />
    </>
  )
}
