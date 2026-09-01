import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router"

import { CountsScreen } from "@/components/ops/counts-screen"
import { PackingScreen } from "@/components/ops/packing-screen"
import { PickingScreen } from "@/components/ops/picking-screen"
import { ReceivingScreen } from "@/components/ops/receiving-screen"
import { ShippingScreen } from "@/components/ops/shipping-screen"
import { TaggingScreen } from "@/components/ops/tagging-screen"
import { WorkScreen } from "@/components/ops/work-screen"
import { OutboxScreen } from "@/components/ops/outbox-screen"
import { OperationsShell } from "@/components/shell"
import { TopBar } from "@/components/top-bar"

/// Where somebody is, in the URL rather than in a variable.
///
/// A warehouse screen is left open on a mounted tablet for a whole shift and
/// reloaded when the wifi drops. A `useState` view switch would put the person
/// back at the top of the queue every time that happened, and would make it
/// impossible to send a colleague to the thing you are looking at.
///
/// Routes are code-based: eight routes do not need a codegen step, and one
/// readable file is worth more here than the convention.
const rootRoute = createRootRoute({
  component: () => (
    <OperationsShell header={<TopBar />}>
      <Outlet />
    </OperationsShell>
  ),
})

const workRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: WorkScreen,
})

const receivingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/receiving",
  component: ReceivingScreen,
})

const taggingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tagging",
  component: TaggingScreen,
})

const pickingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/picking",
  component: PickingScreen,
})

const packingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/packing",
  component: PackingScreen,
})

const shippingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/shipping",
  component: ShippingScreen,
})

const countsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/counts",
  component: CountsScreen,
})

const outboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/outbox",
  component: OutboxScreen,
})

const routeTree = rootRoute.addChildren([
  workRoute,
  receivingRoute,
  taggingRoute,
  pickingRoute,
  packingRoute,
  shippingRoute,
  countsRoute,
  outboxRoute,
])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
