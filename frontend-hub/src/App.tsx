import { useQueryClient } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { useEffect } from "react"

import { LoginForm } from "@/components/login-form"
import { Toasts } from "@/components/ui/toast"
import { cacheKey } from "@/lib/api"
import { onWorkerMessage } from "@/lib/pwa"
import {
  clearSignedOutElsewhere,
  signedOutElsewhere,
  useIdentity,
} from "@/lib/session"
import { router } from "@/routes"
import { ApiError, type Identity } from "@itulah/contract/client"

export function App() {
  const queryClient = useQueryClient()

  // Three states, not two. While the session query is pending nobody has been
  // asked anything: showing a login box during that moment makes an
  // already-signed-in operator type their password for nothing.
  const session = useIdentity()

  // A notification tapped while the app is open: the worker hands over where
  // it leads and the router goes there, rather than the worker reloading the
  // page out from under whatever was on screen (`src/sw.ts`).
  useEffect(
    () =>
      onWorkerMessage((message) => {
        if (message.type === "open" && message.url?.startsWith("/")) {
          void router.navigate({ href: message.url })
        }
      }),
    []
  )

  // A lapsed session resolves to `null` rather than an error, so anything left
  // here is the node being unreachable or refusing for some other reason. A
  // bare login box would fail again for a cause nobody watching could see.
  const problem =
    session.error === null
      ? null
      : session.error instanceof ApiError
        ? session.error.message
        : "could not reach the server"

  if (session.isPending) {
    return (
      <main className="grid h-full place-items-center">
        <p className="text-meta text-body">Checking your session…</p>
      </main>
    )
  }

  if ((session.data ?? null) === null) {
    return (
      <main className="h-full">
        <LoginForm
          problem={problem ?? signedOutElsewhere()}
          onSignedIn={(signedIn) => {
            clearSignedOutElsewhere()
            // Writing the answer rather than refetching it: the login response
            // already carries the person the server just authenticated, and it
            // clears the failure with it.
            queryClient.setQueryData<Identity | null>(
              cacheKey.me(),
              signedIn.user
            )
          }}
        />
      </main>
    )
  }

  // Mounted only once there is a session: the screens all read the signed-in
  // user's own data, so a router running behind the login screen would fire a
  // page of requests that can only answer 401.
  //
  // The toaster sits beside it rather than inside a screen: a receipt outlives
  // the sheet that produced it, and a component that unmounts on the same
  // click cannot show one.
  return (
    <>
      <RouterProvider router={router} />
      <Toasts />
    </>
  )
}
