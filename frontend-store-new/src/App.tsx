import { useQueryClient } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { useEffect } from "react"

import { Launch } from "@/components/brand-mark"
import { LoginForm } from "@/components/login-form"
import { ServerStatus } from "@/components/server-status"
import { SignInDoor } from "@/components/sign-in-door"
import { cacheKey } from "@/lib/api"
import { startBasket } from "@/lib/basket"
import { startSaleQueue } from "@/lib/sale-queue"
import { useIdentity } from "@/lib/session"
import { router } from "@/routes"
import { ApiError } from "@itulah/contract/client"

export function App() {
  const queryClient = useQueryClient()

  // Three states, not two. While the session query is pending nobody has been
  // asked anything: showing a login box during that moment makes an
  // already-signed-in cashier type their password for nothing.
  const session = useIdentity()

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

  // The launch screen: white, the mark in the middle — the same picture
  // `index.html` painted before any script ran.
  if (session.isPending) {
    return (
      <>
        <ServerStatus />
        <Launch />
      </>
    )
  }

  if ((session.data ?? null) === null) {
    return (
      <main className="h-svh">
        <ServerStatus />
        <SignInDoor>
          <LoginForm
            problem={problem}
            titleOnPhone={false}
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
        </SignInDoor>
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
