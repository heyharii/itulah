import type { ScreenMap } from "@/screens/registry"
import { AcrossShops } from "@/screens/commercial/across-shops"
import { CommercialFleet } from "@/screens/commercial/fleet"
import { CommercialOverview } from "@/screens/commercial/overview"
import { PriceBooks } from "@/screens/commercial/price-books"
import { Prices } from "@/screens/commercial/prices"
import { Promotions } from "@/screens/commercial/promotions"
import { Simulate } from "@/screens/commercial/simulate"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/commercial": CommercialOverview,
  "/commercial/price-books": PriceBooks,
  "/commercial/across-shops": AcrossShops,
  "/commercial/prices": Prices,
  "/commercial/promotions": Promotions,
  "/commercial/simulate": Simulate,
  "/commercial/fleet": CommercialFleet,
}
