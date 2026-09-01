import { useCallback, useEffect, useState } from "react"
import { RouterProvider } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"

import { LoginForm } from "@/components/login-form"
import { MemberGate } from "@/components/member-gate"
import { auth, node } from "@/lib/api"
import { useMember } from "@/lib/member"
import { SessionProvider } from "@/lib/session"
import { router } from "@/router"
import {
  ApiError,
  type Identity,
  type NodeIdentity,
} from "@itulah/contract/client"

/// Two gates, in this order: the node session, then the member's card.
///
/// The session comes first because without it every request fails, and asking
/// somebody for a card number only to show them an error would waste the one
/// thing they had to type. The card comes second because it decides whose
/// points are on screen, and every screen behind it can then assume it exists.
export default function App() {
  // Three states, not two. `undefined` means the session has not been checked
  // yet: showing a login box during that moment makes an already-signed-in
  // person type their password for nothing.
  const [identity, setIdentity] = useState<Identity | null | undefined>(
    undefined,
  )
  const [where, setWhere] = useState<NodeIdentity | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const { memberId } = useMember()
  const queryClient = useQueryClient()

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
            : "Tidak dapat menghubungi server.",
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
        // Whatever the server said, this browser is done with the session —
        // and with the answers it fetched under it.
        queryClient.clear()
        setIdentity(null)
      }
    })()
  }, [queryClient])

  if (identity === undefined) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">Memeriksa sesi…</p>
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
            </p>
          )}
        </div>
      </main>
    )
  }

  if (memberId === null) {
    return <MemberGate />
  }

  return (
    <SessionProvider value={{ identity, node: where, signOut }}>
      <RouterProvider router={router} />
    </SessionProvider>
  )
}
