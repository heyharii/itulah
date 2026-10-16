import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
///
/// `/inventory` is the owner's Store-cards Stock (4 Oct 2026), which took the
/// Overview's seat: the fleet tree it replaced still renders at
/// `/inventory/pools`, one click under the fold.
export const screens: ScreenMap = {
  "/inventory": lazyScreen(
    "inventory/stock-cards",
    () => import("@/screens/inventory/stock-cards"),
    (m) => m.StockCards
  ),
  "/inventory/exceptions": lazyScreen(
    "inventory/exceptions",
    () => import("@/screens/inventory/exceptions"),
    (m) => m.Exceptions
  ),
  "/inventory/availability": lazyScreen(
    "inventory/availability",
    () => import("@/screens/inventory/availability"),
    (m) => m.Availability
  ),
  "/inventory/pools": lazyScreen(
    "inventory/pools",
    () => import("@/screens/inventory/pools"),
    (m) => m.Pools
  ),
  "/inventory/counts": lazyScreen(
    "inventory/counts",
    () => import("@/screens/inventory/counts"),
    (m) => m.Counts
  ),
  "/inventory/stock-card": lazyScreen(
    "inventory/stock-card",
    () => import("@/screens/inventory/stock-card"),
    (m) => m.StockCard
  ),
  "/inventory/movements": lazyScreen(
    "inventory/movements",
    () => import("@/screens/inventory/movements"),
    (m) => m.Movements
  ),
  "/inventory/observations": lazyScreen(
    "inventory/observations",
    () => import("@/screens/inventory/observations"),
    (m) => m.Observations
  ),
  "/inventory/missing": lazyScreen(
    "inventory/missing",
    () => import("@/screens/inventory/missing"),
    (m) => m.Missing
  ),
  "/inventory/reconciliations": lazyScreen(
    "inventory/reconciliations",
    () => import("@/screens/inventory/reconciliations"),
    (m) => m.Reconciliations
  ),
  "/inventory/as-of": lazyScreen(
    "inventory/as-of",
    () => import("@/screens/inventory/as-of"),
    (m) => m.AsOf
  ),
  "/inventory/control": lazyScreen(
    "inventory/control",
    () => import("@/screens/inventory/control"),
    (m) => m.Control
  ),
  "/inventory/time-machine": lazyScreen(
    "inventory/time-machine",
    () => import("@/screens/inventory/time-machine"),
    (m) => m.TimeMachine
  ),
  "/inventory/flows": lazyScreen(
    "inventory/flows",
    () => import("@/screens/inventory/flows"),
    (m) => m.Flows
  ),
}
