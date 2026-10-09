import type { ScreenMap } from "@/screens/registry"

import { Catalogue } from "@/screens/procurement/catalogue"
import { PoImport } from "@/screens/procurement/import"
import { SuppliersGate } from "@/screens/procurement/offline-suppliers"
import { Outstanding } from "@/screens/procurement/outstanding"
import { PriceAmendments } from "@/screens/procurement/amendments"
import { PurchaseOrders } from "@/screens/procurement/purchase-orders"
import { Sourcing } from "@/screens/procurement/sourcing"
import { SuppliersBoard } from "@/screens/operations/board/suppliers"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/procurement/sourcing": Sourcing,
  "/procurement/import": PoImport,
  "/procurement/orders": PurchaseOrders,
  "/procurement/outstanding": Outstanding,
  "/procurement/amendments": PriceAmendments,
  "/procurement/catalogue": Catalogue,
  // The Return PO board (owner, 10 Oct 2026): the one list, here in Procurement.
  "/procurement/returns": SuppliersBoard,
  // The gate, not the screen: it decides online book versus cached read.
  "/procurement/suppliers": SuppliersGate,
}
