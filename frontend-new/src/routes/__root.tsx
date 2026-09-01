import { Outlet, createRootRouteWithContext } from "@tanstack/react-router"
import type { QueryClient } from "@tanstack/react-query"
import { Suspense, lazy, useState } from "react"

import { AppRail } from "@/components/app-rail"
import { AuthGate } from "@/components/auth-gate"
import { AuthProvider, useAuth } from "@/lib/auth"
import { CommandPalette } from "@/shared/search"
import { AppError, AppNotFound } from "@/components/app-shell-states"

/* Devtools are dev-only: the plugin strips them from a production build. */
const Devtools = import.meta.env.DEV
  ? lazy(async () => {
      const [router, query] = await Promise.all([
        import("@tanstack/react-router-devtools"),
        import("@tanstack/react-query-devtools"),
      ])
      return {
        default: () => (
          <>
            <router.TanStackRouterDevtools position="bottom-right" />
            <query.ReactQueryDevtools initialIsOpen={false} />
          </>
        ),
      }
    })
  : () => null

function LogoutControl() {
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  if (!auth.user) return null

  return (
    <div className="fixed top-3 right-3 z-50 flex items-center gap-2 rounded-control bg-surface/95 px-2 py-1.5 shadow-card backdrop-blur">
      <span className="max-w-[150px] truncate text-[11px] font-medium text-ink-3">
        {auth.user.name}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void auth.logout().catch(() => setBusy(false))
        }}
        className="rounded-chip px-2 py-1 text-[11px] font-semibold text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
      >
        {busy ? "Signing out…" : "Log out"}
      </button>
    </div>
  )
}

function Shell() {
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <AppRail />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
      {/* One palette for the whole suite. It lives here rather than on a screen
        * because its whole point is being reachable from a screen that knows
        * nothing about it — ⌘K from accounting, land on an article with its
        * sheet open. */}
      <CommandPalette />
      <LogoutControl />
      <Suspense fallback={null}>
        <Devtools />
      </Suspense>
    </div>
  )
}

/* Local escape hatch for looking at the screens with no backend running.
 * Off unless VITE_BYPASS_AUTH is set (see .env.local); the gate is the
 * default path and stays untouched. */
const BYPASS_AUTH = import.meta.env.VITE_BYPASS_AUTH === "1"

function RootRoute() {
  /* No domain provider lives here. `HrProvider` used to, which put the whole
   * People register in the entry chunk for all eighteen apps; it now belongs
   * to the `_people` layout route. See docs/frontend-rules.md §S6. */
  const shell = <Shell />

  /* the provider still wraps it — only the gate is skipped, so anything
   * reading the session keeps working with no user signed in */
  return (
    <AuthProvider realm="cloud">
      {BYPASS_AUTH ? shell : <AuthGate>{shell}</AuthGate>}
    </AuthProvider>
  )
}

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootRoute,

  /* Both were missing. A mistyped URL fell through to the router's default, and
   * anything thrown above a route's own boundary blanked the whole suite. */
  notFoundComponent: AppNotFound,
  errorComponent: AppError,
})
