import { lazy, Suspense, useCallback, useEffect, useState } from "react"

import { CatalogueView } from "@/components/catalogue"
import { LoginForm } from "@/components/login-form"
import { Outbox } from "@/components/outbox"
import { Button } from "@/components/ui/button"
import { auth, node } from "@/lib/api"
import {
  ApiError,
  type Identity,
  type NodeIdentity,
} from "@itulah/contract/client"

/// Loaded only when somebody asks for it.
///
/// This is not a till screen — a cashier ringing up a sale has no use for a
/// month of history. Splitting it out is not tidiness: the reporting screen
/// pulls in a charting library and a date picker, and a till that never opens
/// it should never download them.
const SalesScreen = lazy(() =>
  import("@/components/sales/sales-screen").then((module) => ({
    default: module.SalesScreen,
  })),
)

/// Which of the shop's two jobs is on screen.
///
/// The till is the default and always will be: it is what the device is for.
type Area = "till" | "prices" | "sales"

export function App() {
  // Three states, not two. `undefined` means the session has not been checked
  // yet: showing a login box during that moment makes an already-signed-in
  // operator type their password for nothing.
  const [identity, setIdentity] = useState<Identity | null | undefined>(
    undefined,
  )
  const [where, setWhere] = useState<NodeIdentity | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [area, setArea] = useState<Area>("till")

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
    // `h-svh`, not `min-h-svh`: the catalogue scrolls inside itself, and a
    // page that grew instead would put a second scrollbar around the lot.
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
      {/* Three places, not a menu. A shop has a till, a price to look up, and
          a manager's view of what it took; a device that offered more choices
          than that is one somebody gets lost in mid-transaction. */}
      <nav className="flex gap-1 border-b px-4 py-2" aria-label="Areas">
        {(["till", "prices", "sales"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={area === option}
            onClick={() => setArea(option)}
            className={
              "cursor-pointer rounded-4xl px-4 py-2 text-sm font-medium capitalize transition-colors " +
              (area === option
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted")
            }
          >
            {option}
          </button>
        ))}
      </nav>

      {area === "till" ? (
        <div className="p-6">
          <Outbox className="max-w-md" />
        </div>
      ) : area === "prices" ? (
        /* What this shop charges, read from this shop's own price book. An
           assistant asked "how much is this" can answer without walking to a
           till, and be right — the number comes from the same resident book the
           counter reads. */
        <div className="flex min-h-0 flex-1 flex-col p-6">
          <CatalogueView />
        </div>
      ) : (
        <Suspense
          fallback={
            <p className="text-muted-foreground p-8 text-center text-sm">
              Loading the figures…
            </p>
          }
        >
          <SalesScreen />
        </Suspense>
      )}
    </main>
  )
}

export default App
