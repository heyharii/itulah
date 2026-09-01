import { LoginForm } from "@/components/login-form"
import { cacheKey } from "@/lib/api"
import {
  SessionProvider,
  useIdentity,
  useNodeIdentity,
  useSignOut,
} from "@/lib/session"
import { router } from "@/router"
import { ApiError } from "@itulah/contract/client"
import { useQueryClient } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"

export function App() {
  const queryClient = useQueryClient()
  // Three states, not two. While the session query is pending the session has
  // not been checked yet: showing a login box during that moment makes an
  // already-signed-in operator type their password for nothing.
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

  if (identity.isPending) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">Checking your session…</p>
      </main>
    )
  }

  if (identity.data === null || identity.data === undefined) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <LoginForm
            onSignedIn={(signedIn) => {
              // Straight into the cache: writing the identity here settles the
              // query that the whole surface is gated on, so nothing has to ask
              // the node again for something it has just been told.
              queryClient.setQueryData(cacheKey.me(), signedIn.user)
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
              {here.site_id === undefined ? "" : ` · ${here.site_id}`}
            </p>
          )}
        </div>
      </main>
    )
  }

  return (
    // Mounted only once there is a session. Every screen behind this reads the
    // shop's own node, so a router running behind the login screen would fire a
    // page of requests that can only answer 401.
    <SessionProvider value={{ identity: identity.data, node: here, signOut }}>
      <RouterProvider router={router} />
    </SessionProvider>
  )
}

export default App
