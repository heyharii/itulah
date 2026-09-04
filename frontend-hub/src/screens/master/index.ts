import type { ScreenMap } from "@/screens/registry"
import { Articles } from "@/screens/master/articles"
import { Colours } from "@/screens/master/colours"
import { Suppliers } from "@/screens/master/suppliers"
import { Divisions, Sizes, Tags } from "@/screens/master/vocabulary"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Article setups is not among them, and not because it was dropped: a setup
/// is done to one delivery, so it is three sheets over `/master` rather than a
/// screen of its own. See `SetupSheets` in `setups.tsx`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/master": Articles,
  "/master/suppliers": Suppliers,
  "/master/divisions": Divisions,
  "/master/colours": Colours,
  "/master/sizes": Sizes,
  "/master/tags": Tags,
}
