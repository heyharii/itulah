import { useCallback, useEffect, useState } from "react"

import { LoginForm } from "@/components/login-form"
import { router } from "@/router"
import { RouterProvider } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { auth, node } from "@/lib/api"
import {
  ApiError,
  type Identity,
  type NodeIdentity,
} from "@itulah/contract/client"

export function App() {
  // Three states, not two. `undefined` means the session has not been checked
  // yet: showing a login box during that moment makes an already-signed-in
  // operator type their password for nothing.
  const [identity, setIdentity] = useState<Identity | null | undefined>(
    undefined,
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
            : "could not reach the server",
        )
      }
    })()

    return () => controller.abort()
  }, [])

  const signOut = useCallback(async () => {
    try {
      await auth.logout()
    } finally {
      // Whatever the server said, this browser is done with the session.
      setIdentity(null)
    }
  }, [])

  if (identity === undefined) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">Checking your session…</p>
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
            <p role="alert" className="text-destructive text-center text-sm">
              {problem}
            </p>
          )}
          {where !== null && (
            <p className="text-muted-foreground text-center text-xs">
              {where.node_id} · {where.node_role}
              {where.site_id === undefined ? "" : ` · ${where.site_id}`}
            </p>
          )}
        </div>
      </main>
    )
  }

  return (
    // `h-svh`, not `min-h-svh`: the buying screens below scroll inside
    // themselves — a rail, a table body, a draft — and a page that grows
    // instead would put a second scrollbar around the lot.
    <main className="flex h-svh flex-col">
      <header className="flex items-center gap-4 border-b px-6 py-4">
        <div className="min-w-0">
          <p className="truncate font-medium">{identity.display_name}</p>
          <p className="text-muted-foreground text-xs">
            {identity.username} · {identity.role}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {where !== null && (
            <span className="text-muted-foreground hidden text-xs sm:inline">
              {where.node_id} · {where.node_role}
            </span>
          )}
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      {/* Mounted only once there is a session. The buying routes all read
          the signed-in user's own data, so a router running behind the login
          screen would fire a page of requests that can only answer 401. */}
      <RouterProvider router={router} />
    </main>
  )
}

export default App
