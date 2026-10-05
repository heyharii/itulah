import { LoginForm } from "@/components/login-form"
import { router } from "@/router"
import { RouterProvider } from "@tanstack/react-router"
import { cacheKey } from "@/lib/api"
import { useIdentity, useNodeIdentity } from "@/lib/session"
import { ApiError } from "@itulah/contract/client"
import { useQueryClient } from "@tanstack/react-query"

export function App() {
  const queryClient = useQueryClient()

  // Three states, not two. While the session query is pending nobody has been
  // asked anything yet: showing a login box during that moment makes an
  // already-signed-in operator type their password for nothing.
  const session = useIdentity()
  const where = useNodeIdentity()

  // `undefined` (not asked yet) and `null` (asked, could not say) mean the
  // same thing to the line that names the node.
  const here = where.data ?? null

  // Not "please sign in" — a lapsed session resolves to `null` rather than an
  // error, so anything left here is the node being unreachable or refusing for
  // some other reason. A bare login box would fail again for a cause nobody
  // watching the screen could see.
  const problem =
    session.error === null
      ? null
      : session.error instanceof ApiError
        ? session.error.message
        : "could not reach the server"

  if (session.isPending) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">Checking your session…</p>
      </main>
    )
  }

  const identity = session.data ?? null

  if (identity === null) {
    return (
      // The sign-in screen is the whole viewport now rather than a card
      // centred in one, so the session failure and the node line move inside
      // it — a single column that reads top to bottom instead of three
      // fragments stacked under a box.
      <main className="min-h-svh">
        <LoginForm
          problem={problem}
          node={here}
          onSignedIn={() => {
            // Asked again rather than written from the answer: a login
            // response carries `SessionUser`, which is not what `/auth/me`
            // answers (the Edge's `me` also names the site, the Cloud's also
            // names the job role and the sections). One round trip, once, on
            // the way in.
            void queryClient.invalidateQueries({ queryKey: cacheKey.me() })
          }}
        />
      </main>
    )
  }

  return (
    // `h-svh`, not `min-h-svh`: the buying screens below scroll inside
    // themselves — a rail, a table body, a draft — and a page that grows
    // instead would put a second scrollbar around the lot.
    <main className="flex h-svh flex-col">
      {/* No account bar across the top. Cloud Hub's shell has no global
          header — who you are and which node you are on belong at the foot of
          the rail, next to the modules, and a strip here would cost every
          screen 60px of height to say something read once a day. */}
      {/* Mounted only once there is a session. The buying routes all read
          the signed-in user's own data, so a router running behind the login
          screen would fire a page of requests that can only answer 401. */}
      <RouterProvider router={router} />
    </main>
  )
}

export default App
