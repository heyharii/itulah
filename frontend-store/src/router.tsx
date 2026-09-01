/* eslint-disable react-refresh/only-export-components -- this file exports a
   router rather than components, and the lazy boundary belongs beside the
   route that is the reason for it. */
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router"
import { lazy, Suspense } from "react"

import { CatalogueView } from "@/components/catalogue"
import { Outbox } from "@/components/outbox"
import { TillShell } from "@/components/shell"

/// Loaded only when somebody asks for it.
///
/// This is not a till screen — a cashier ringing up a sale has no use for a
/// month of history. Splitting it out is not tidiness: the reporting screen
/// pulls in a charting library and a date picker, and a till that never opens
/// it should never download them. Splitting on a route rather than on a state
/// variable does not change that — the import still happens on arrival.
const SalesScreen = lazy(() =>
  import("@/components/sales/sales-screen").then((module) => ({
    default: module.SalesScreen,
  })),
)

/// Where somebody is, in the URL rather than in a variable.
///
/// A till is left running on the counter all day and reloaded when the shop's
/// wifi drops or the browser is restarted. A `useState` view switch would put
/// whoever is standing there back at the till every time that happened, and
/// would make it impossible to send a manager a link to the figures they are
/// being asked about.
///
/// Routes are code-based: three routes do not need a codegen step, and one
/// readable file is worth more here than the convention.
const rootRoute = createRootRoute({
  component: () => (
    <TillShell>
      <Outlet />
    </TillShell>
  ),
})

const tillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <div className="p-6">
      <Outbox className="max-w-md" />
    </div>
  ),
})

/// What this shop charges, read from this shop's own price book. An assistant
/// asked "how much is this" can answer without walking to a till, and be right
/// — the number comes from the same resident book the counter reads.
const pricesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prices",
  component: () => (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <CatalogueView />
    </div>
  ),
})

const salesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sales",
  component: () => (
    <Suspense
      fallback={
        <p className="text-muted-foreground p-8 text-center text-sm">
          Loading the figures…
        </p>
      }
    >
      <SalesScreen />
    </Suspense>
  ),
})

const routeTree = rootRoute.addChildren([tillRoute, pricesRoute, salesRoute])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
