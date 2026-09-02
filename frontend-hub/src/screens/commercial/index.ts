import type { ScreenMap } from "@/screens/registry"
import { Campaigns } from "@/screens/commercial/campaigns"
import { Pricelist } from "@/screens/commercial/pricelist"
import { Vouchers } from "@/screens/commercial/vouchers"
import { Promotions } from "@/screens/commercial/promotions"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/commercial": Pricelist,
  "/commercial/promotions": Promotions,
  "/commercial/campaigns": Campaigns,
  "/commercial/vouchers": Vouchers,
}
