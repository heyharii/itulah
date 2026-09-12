import type { ScreenMap } from "@/screens/registry"

import { Catalogue } from "@/screens/procurement/catalogue"
import { Destinations } from "@/screens/procurement/destinations"
import { Outstanding } from "@/screens/procurement/outstanding"
import { PriceAmendments } from "@/screens/procurement/amendments"
import { PurchaseOrders } from "@/screens/procurement/purchase-orders"
import { Sourcing } from "@/screens/procurement/sourcing"
import { Suppliers } from "@/screens/procurement/suppliers"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
export const screens: ScreenMap = {
  "/procurement/sourcing": Sourcing,
  "/procurement/orders": PurchaseOrders,
  "/procurement/outstanding": Outstanding,
  "/procurement/amendments": PriceAmendments,
  "/procurement/catalogue": Catalogue,
  "/procurement/destinations": Destinations,
  "/procurement/suppliers": Suppliers,
}
