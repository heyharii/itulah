import { lazy } from "react"
import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"

import { AppShell } from "@/components/app-shell"
import { RoutePending } from "@/components/states"

/// Where the member is, in the URL rather than in a variable.
///
/// Seven routes, code-based: a codegen step earns nothing at this size, and the
/// whole tree being readable in one file is worth more than the convention.
///
/// Each view is its own chunk, so a member pays only for the screens they
/// open — the shell and the tab bar they land on are the eager part. The
/// router wraps every match in its own Suspense boundary, and
/// `defaultPendingComponent` (`states.tsx::RoutePending`) is what that
/// boundary shows for the moment a chunk is in flight.
const HomeView = lazy(() =>
  import("@/components/home-view").then((m) => ({ default: m.HomeView })),
)
const HistoryView = lazy(() =>
  import("@/components/history-view").then((m) => ({ default: m.HistoryView })),
)
const TransactionView = lazy(() =>
  import("@/components/transaction-view").then((m) => ({
    default: m.TransactionView,
  })),
)
const RedeemView = lazy(() =>
  import("@/components/redeem-view").then((m) => ({ default: m.RedeemView })),
)
const CardView = lazy(() =>
  import("@/components/card-view").then((m) => ({ default: m.CardView })),
)
const ActivityView = lazy(() =>
  import("@/components/activity-view").then((m) => ({
    default: m.ActivityView,
  })),
)
const ProfileView = lazy(() =>
  import("@/components/profile-view").then((m) => ({
    default: m.ProfileView,
  })),
)

/// The paths are Indonesian because the people reading this URL bar are
/// shoppers, not operators — `/riwayat` is the same word as the tab they
/// pressed to get there. `/tukar-poin` follows the same rule for the same
/// reason.
const rootRoute = createRootRoute({ component: AppShell })

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeView,
})

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/riwayat",
  component: HistoryView,
})

/// One receipt. Linkable on purpose: a member showing a purchase to a cashier
/// hands over a URL, not a sequence of taps.
const transactionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/riwayat/$saleId",
  component: TransactionView,
})

/// Points redemption: the shopper asks here, a cashier confirms at the till
/// — see `redeem-view.tsx`.
const redeemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tukar-poin",
  component: RedeemView,
})

/// The member card, presented on its own: the screen a shopper holds up to a
/// scanner at the counter.
const cardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kartu",
  component: CardView,
})

/// Every change to the balance, as notifications — what the bell opens.
const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifikasi",
  component: ActivityView,
})

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profil",
  component: ProfileView,
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  historyRoute,
  transactionRoute,
  redeemRoute,
  cardRoute,
  activityRoute,
  profileRoute,
])

export const router = createRouter({
  routeTree,
  defaultPendingComponent: RoutePending,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
