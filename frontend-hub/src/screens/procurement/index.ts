import { lazyScreen, type ScreenMap } from "@/screens/registry"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/procurement/sourcing": lazyScreen(
    "procurement/sourcing",
    () => import("@/screens/procurement/sourcing"),
    (m) => m.Sourcing
  ),
  "/procurement/import": lazyScreen(
    "procurement/import",
    () => import("@/screens/procurement/import"),
    (m) => m.PoImport
  ),
  "/procurement/orders": lazyScreen(
    "procurement/purchase-orders",
    () => import("@/screens/procurement/purchase-orders"),
    (m) => m.PurchaseOrders
  ),
  "/procurement/outstanding": lazyScreen(
    "procurement/outstanding",
    () => import("@/screens/procurement/outstanding"),
    (m) => m.Outstanding
  ),
  "/procurement/amendments": lazyScreen(
    "procurement/amendments",
    () => import("@/screens/procurement/amendments"),
    (m) => m.PriceAmendments
  ),
  "/procurement/catalogue": lazyScreen(
    "procurement/catalogue",
    () => import("@/screens/procurement/catalogue"),
    (m) => m.Catalogue
  ),
  // The Return PO board (owner, 10 Oct 2026): the one list, here in Procurement.
  "/procurement/returns": lazyScreen(
    "operations/board/suppliers",
    () => import("@/screens/operations/board/suppliers"),
    (m) => m.SuppliersBoard
  ),
  // The gate, not the screen: it decides online book versus cached read.
  "/procurement/suppliers": lazyScreen(
    "procurement/offline-suppliers",
    () => import("@/screens/procurement/offline-suppliers"),
    (m) => m.SuppliersGate
  ),
}
