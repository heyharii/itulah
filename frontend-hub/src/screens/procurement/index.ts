import type { ScreenMap } from "@/screens/registry"

import { Catalogue } from "@/screens/procurement/catalogue"
import { PoImport } from "@/screens/procurement/import"
import { Outstanding } from "@/screens/procurement/outstanding"
import { PriceAmendments } from "@/screens/procurement/amendments"
import { PurchaseOrders } from "@/screens/procurement/purchase-orders"
import { Sourcing } from "@/screens/procurement/sourcing"
import { SupplierReturns } from "@/screens/procurement/supplier-returns"
import { Suppliers } from "@/screens/procurement/suppliers"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/procurement/sourcing": Sourcing,
  "/procurement/import": PoImport,
  "/procurement/orders": PurchaseOrders,
  "/procurement/outstanding": Outstanding,
  "/procurement/amendments": PriceAmendments,
  "/procurement/catalogue": Catalogue,
  "/procurement/returns": SupplierReturns,
  "/procurement/suppliers": Suppliers,
}
