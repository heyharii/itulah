import type { ScreenMap } from "@/screens/registry"
import { Member } from "@/screens/storeops/customer"
import { Overview } from "@/screens/storeops/overview"
import { Returns } from "@/screens/storeops/returns"
import { Sales } from "@/screens/storeops/sales"
import { Stores } from "@/screens/storeops/stores"

/// Screens this module has written. Keys must be paths declared in
/// `lib/navigation.ts`; anything not listed here renders `Placeholder`.
///
/// Each module owns this file alone, so two modules being built at once never
/// touch the same registry.
export const screens: ScreenMap = {
  "/storeops": Overview,
  "/storeops/sales": Sales,
  "/storeops/returns": Returns,
  "/storeops/stores": Stores,
  "/storeops/customer": Member,
}
