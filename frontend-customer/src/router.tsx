import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"

import { AppShell } from "@/components/app-shell"
import { HistoryView } from "@/components/history-view"
import { HomeView } from "@/components/home-view"
import { ProfileView } from "@/components/profile-view"
import { TransactionView } from "@/components/transaction-view"

/// Where the member is, in the URL rather than in a variable.
///
/// Four routes, code-based: a codegen step earns nothing at this size, and the
/// whole tree being readable in one file is worth more than the convention.
///
/// The paths are Indonesian because the people reading this URL bar are
/// shoppers, not operators — `/riwayat` is the same word as the tab they
/// pressed to get there.
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

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profil",
  component: ProfileView,
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  historyRoute,
  transactionRoute,
  profileRoute,
])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
