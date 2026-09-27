import { useMemo } from "react"

import { LoginForm } from "@/components/login-form"
import { cacheKey } from "@/lib/api"
import { router } from "@/router"
import {
  SessionProvider,
  useIdentity,
  useNodeIdentity,
  useSignOut,
} from "@/lib/session"
import { RouterProvider } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { ApiError } from "@itulah/contract/client"

export function App() {
  const client = useQueryClient()
  // Three states, not two. While the session query is pending nobody has been
  // asked anything yet: showing a login box during that moment makes somebody
  // already signed in type their password for nothing.
  const identity = useIdentity()
  const where = useNodeIdentity()
  const { mutate: signOut } = useSignOut()
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
        : "could not reach the server"

  const session = useMemo(
    () =>
      identity.data === null || identity.data === undefined
        ? null
        : { identity: identity.data, node: here, signOut },
    [identity.data, here, signOut]
  )

  if (identity.isPending) {
    return (
      <main className="grid min-h-svh place-items-center p-6">
        <p className="text-meta text-body">Checking your session…</p>
      </main>
    )
  }

  if (session === null) {
    return (
      <main className="grid min-h-svh place-items-center px-6">
        <LoginForm
          onSignedIn={(response) => {
            // Writing the answer rather than refetching it: the login
            // response already carries the person the server just
            // authenticated, and it clears the failure with it.
            client.setQueryData(cacheKey.me(), response.user)
          }}
          problem={problem}
          footer={
            here !== null && (
              <p className="mt-1 text-center font-mono text-id text-mute">
                {here.node_id} · {here.node_role}
                {here.site_id === undefined ? "" : ` · ${here.site_id}`}
              </p>
            )
          }
        />
      </main>
    )
  }

  return (
    // Mounted only once there is a session. Every screen below reads the
    // signed-in person's own record, so a router running behind the login box
    // would fire a page of requests that can only answer 401.
    <SessionProvider value={session}>
      <RouterProvider router={router} />
    </SessionProvider>
  )
}

export default App
