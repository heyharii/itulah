import { OrderDetail } from "@/components/po/order-detail"
import { PoDraft } from "@/components/po/po-draft"
import { PriceAmendmentsView } from "@/components/po/price-amendments-view"
import { PurchaseOrdersView } from "@/components/po/purchase-orders-view"
import { BasketView } from "@/components/sourcing/basket-view"
import { SourcingView } from "@/components/sourcing/sourcing-view"
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router"

/// Where the buyer is, in the URL rather than in a variable.
///
/// This replaced a `useState` discriminated union in a `Workspace` component,
/// and the difference is not tidiness. A draft purchase order could not be
/// linked to, could not survive a reload, and the browser's back button left
/// the app entirely — three things a person reasonably expects of a screen
/// they are half way through filling in.
///
/// Routes are code-based rather than file-based: six routes do not need a
/// codegen step, and keeping the tree in one readable file is worth more here
/// than the convention.
const rootRoute = createRootRoute({ component: Outlet })

const sourcingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: SourcingView,
})

const basketRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/basket",
  component: BasketView,
})

const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders",
  component: PurchaseOrdersView,
})

/// The draft names only its supplier, and reads the quantities from the basket
/// when it opens.
///
/// Deliberately not "the lines I was handed at the moment I was opened": a
/// route that carried a snapshot of the basket could be reloaded into a draft
/// that disagreed with the basket it came from. Naming the supplier and reading
/// the rest means the link stays honest whenever it is followed.
const draftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders/new/$supplierId",
  component: PoDraft,
})

const orderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders/$purchaseOrderId",
  component: OrderDetail,
})

const amendmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/amendments",
  component: PriceAmendmentsView,
})

const routeTree = rootRoute.addChildren([
  sourcingRoute,
  basketRoute,
  ordersRoute,
  draftRoute,
  orderRoute,
  amendmentsRoute,
])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

export { draftRoute, orderRoute }
