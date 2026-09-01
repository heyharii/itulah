import { useCallback, useEffect, useMemo, useState } from "react"

import { LoginForm } from "@/components/login-form"
import { auth, node } from "@/lib/api"
import { router } from "@/router"
import { SessionProvider } from "@/lib/session"
import { RouterProvider } from "@tanstack/react-router"
import {
  ApiError,
  type Identity,
  type NodeIdentity,
} from "@itulah/contract/client"

export function App() {
  // Three states, not two. `undefined` means the session has not been checked
  // yet: showing a login box during that moment makes somebody already signed
  // in type their password for nothing.
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
        setIdentity(null)
      }
    })()
  }, [])

  const session = useMemo(
    () =>
      identity === null || identity === undefined
        ? null
        : { identity, node: where, signOut },
    [identity, where, signOut]
  )

  if (identity === undefined) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </main>
    )
  }

  if (session === null) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <LoginForm
            onSignedIn={(response) => {
              setProblem(null)
              setIdentity(response.user)
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
    // Mounted only once there is a session. Every screen below reads the
    // signed-in person's own record, so a router running behind the login box
    // would fire a page of requests that can only answer 401.
    <SessionProvider value={session}>
      <RouterProvider router={router} />
    </SessionProvider>
  )
}

export default App
