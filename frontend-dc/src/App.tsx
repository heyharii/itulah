import { LoginForm } from "@/components/login-form"
import { keys } from "@/lib/queries"
import { router } from "@/router"
import {
  SessionProvider,
  useIdentity,
  useNodeIdentity,
  useSignOut,
} from "@/lib/session"
import { ApiError } from "@itulah/contract/client"
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"

/// One client for the whole surface.
///
/// `retry: false` because this app talks to a node in the same building. A
/// request that failed here failed for a reason a person can act on — the node
/// is down, the session lapsed, the rule refused — and three silent retries
/// only delay them being told.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      // A warehouse screen is looked at, walked away from, and looked at
      // again. Refetching when it comes back into focus is what stops somebody
      // acting on a queue that emptied while they were at the racks.
      refetchOnWindowFocus: true,
      staleTime: 5_000,
    },
  },
})

/// The client is mounted above the sign-in screen, not below it.
///
/// The login box and the session check are themselves cache entries — that is
/// what lets signing in fill `auth/me` directly instead of a second round trip,
/// and what lets signing out empty the session's answers in one call.
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Gate />
    </QueryClientProvider>
  )
}

function Gate() {
  const client = useQueryClient()
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
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </main>
    )
  }

  if (identity.data === null || identity.data === undefined) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <LoginForm
            onSignedIn={(signedIn) => {
              // Writing the answer rather than refetching it: the login
              // response already carries the person the server just
              // authenticated, and it clears the failure with it.
              client.setQueryData(keys.session(), signedIn.user)
            }}
          />
          {problem !== null && (
            <p role="alert" className="text-center text-sm text-destructive">
              {problem}
            </p>
          )}
          {here !== null && (
            <p className="text-center text-xs text-muted-foreground">
              {here.node_id} · {here.node_role}
              {here.site_id === undefined ? "" : ` · ${here.site_id}`}
            </p>
          )}
        </div>
      </main>
    )
  }

  return (
    // Mounted only once there is a session. Every operations screen reads this
    // node's work queues, so a router running behind the login screen would
    // fire a page of requests that can only answer 401.
    <SessionProvider value={{ identity: identity.data, node: here, signOut }}>
      <RouterProvider router={router} />
    </SessionProvider>
  )
}

export default App
