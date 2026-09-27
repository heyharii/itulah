import type { ScreenMap } from "@/screens/registry"
import { Articles } from "@/screens/master/articles"
import { Colours } from "@/screens/master/colours"
import { PaymentTemplates } from "@/screens/master/payment-templates"
import { Divisions, Sizes, Tags } from "@/screens/master/vocabulary"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Article setups is not among them, and no longer over `/master` either: a
/// setup is done to one delivery, which is a purchase, so its three sheets and
/// the trigger that opens them moved to the order book on 2026-09-12. See
/// `SetupSheets` in `procurement/setups.tsx`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/master": Articles,
  "/master/divisions": Divisions,
  "/master/colours": Colours,
  "/master/sizes": Sizes,
  "/master/tags": Tags,
  "/master/payment-templates": PaymentTemplates,
}
