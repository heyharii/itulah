import { useCallback, useEffect, useState } from "react"

import { LoginForm } from "@/components/login-form"
import { auth, node } from "@/lib/api"
import { router } from "@/router"
import { SessionProvider } from "@/lib/session"
import {
  ApiError,
  type Identity,
  type NodeIdentity,
} from "@itulah/contract/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
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

export function App() {
  // Three states, not two. `undefined` means the session has not been checked
  // yet: showing a login box during that moment makes an already-signed-in
  // operator type their password for nothing.
  const [identity, setIdentity] = useState<Identity | null | undefined>(
    undefined
  )
  const [where, setWhere] = useState<NodeIdentity | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      try {
        setWhere(await node.identity({ signal: controller.signal }))
      } catch {
        // Naming the node is a courtesy. Failing to do it is not a sign-in
        // problem and must not be reported as one.
      }
    })()

    void (async () => {
      try {
        setIdentity(await auth.me(controller.signal))
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        setIdentity(null)
        if (error instanceof ApiError && error.needsSignIn) {
          return
        }
        // Not "please sign in" — the node is unreachable or refusing for some
        // other reason. A bare login box here would fail again for a cause
        // nobody watching the screen could see.
        setProblem(
          error instanceof ApiError
            ? error.message
            : "could not reach the server"
        )
      }
    })()

    return () => controller.abort()
  }, [])

  const signOut = useCallback(() => {
    void (async () => {
      try {
        await auth.logout()
      } finally {
        // Whatever the server said, this browser is done with the session.
        // The cache goes with it: the next person to sign in at this bench
        // must not be shown the last one's queue.
        queryClient.clear()
        setIdentity(null)
      }
    })()
  }, [])

  if (identity === undefined) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </main>
    )
  }

  if (identity === null) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <LoginForm
            onSignedIn={(session) => {
              setProblem(null)
              setIdentity(session.user)
            }}
          />
          {problem !== null && (
            <p role="alert" className="text-center text-sm text-destructive">
              {problem}
            </p>
          )}
          {where !== null && (
            <p className="text-center text-xs text-muted-foreground">
              {where.node_id} · {where.node_role}
              {where.site_id === undefined ? "" : ` · ${where.site_id}`}
            </p>
          )}
        </div>
      </main>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      {/* Mounted only once there is a session. Every operations screen reads
          this node's work queues, so a router running behind the login screen
          would fire a page of requests that can only answer 401. */}
      <SessionProvider identity={identity} node={where} signOut={signOut}>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>
  )
}

export default App
